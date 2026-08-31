import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateWithPromptTemplate } from "@/lib/ai";
import { getCurrentUser, getBrandCalendarAccess } from "@/lib/auth";
import { resolveCalendarAttachmentContext } from "@/lib/calendar-attachment-context";
import { normalizeLanguageCode } from "@/lib/content-language";
import { MAX_ATTACHMENT_FILES } from "@/lib/calendar-attachment-utils";
import {
  validateOutputImageTextRequirements,
  buildFallbackOutputImageTextRequirements,
  normalizeOutputImageTextRequirementsStructured,
  formatOutputImageTextRequirementsForDisplay,
  mergeHashtagsIntoCaption,
} from "@/lib/calendar-post-utils";
import {
  SCOPE_FIELDS,
  applyScopedPostRegeneration,
  parseAiJson,
  buildBrandSummary,
  buildCustomInstructionUserInput,
  buildImageTextOnlyUserInput,
  buildVisualOrEntirePostUserInput,
} from "@/lib/calendar-regeneration-prompt";

// ── Scope validation ──────────────────────────────────────────────────────────
// Scope → allowed updatable fields, merge policy, and all prompt assembly live
// in lib/calendar-regeneration-prompt.js (shared with the pre-save route).

const VALID_SCOPES = Object.keys(SCOPE_FIELDS);

// ── POST /api/calendar-posts/[id]/regenerate ──────────────────────────────────
export async function POST(request, { params }) {
  const { id } = await params;
  console.log("[PostRegenerate] POST postId:", id);

  try {
    // ── 1. Authenticate before anything else ─────────────────────────────
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: "Authentication required." },
        { status: 401 }
      );
    }

    // ── 2. Load post with parent calendar to determine brand ownership ────
    const post = await prisma.calendarPost.findUnique({
      where: { id },
      include: {
        calendar: {
          select: {
            brandId: true, status: true,
            mainMonthlySubject: true, mainGoal: true, mainOfferOrMessage: true,
          },
        },
      },
    });
    if (!post) {
      return NextResponse.json({ success: false, error: "Selected post not found." }, { status: 404 });
    }

    // ── 3. Verify brand access ───────────────────────────────────────────
    const access = await getBrandCalendarAccess(post.calendar.brandId);
    if (!access.allowed) {
      return NextResponse.json(
        { success: false, error: access.error },
        { status: access.status }
      );
    }

    // ── 4. Non-admin may only regenerate posts in draft calendars ────────
    if (!access.isAdmin && post.calendar.status !== "draft") {
      return NextResponse.json(
        { success: false, error: "Regeneration is only available for posts in draft calendars." },
        { status: 403 }
      );
    }

    // ── 5. Load post-specific attachment IDs ─────────────────────────────
    const postSpecificAttachments = await prisma.uploadedFile.findMany({
      where: {
        brandId: post.calendar.brandId,
        calendarId: post.calendarId,
        calendarPostId: id,
        purpose: "calendar_post_regeneration_reference",
        interpretationStatus: "complete",
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: [
        { createdAt: "asc" },
        { id: "asc" },
      ],
      select: { id: true },
      take: MAX_ATTACHMENT_FILES,
    });

    const postSpecificAttachmentIds = postSpecificAttachments.map(a => a.id);

    // ── 6. Load calendar-level attachment IDs (remaining capacity) ───────
    const remainingCalendarSlots =
      MAX_ATTACHMENT_FILES - postSpecificAttachmentIds.length;

    let calendarAttachmentIds = [];
    if (remainingCalendarSlots > 0) {
      const calendarAttachments = await prisma.uploadedFile.findMany({
        where: {
          brandId: post.calendar.brandId,
          calendarId: post.calendarId,
          calendarPostId: null,
          purpose: "calendar_reference",
          interpretationStatus: "complete",
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } },
          ],
        },
        orderBy: [
          { createdAt: "asc" },
          { id: "asc" },
        ],
        select: { id: true },
        take: remainingCalendarSlots,
      });
      calendarAttachmentIds = calendarAttachments.map(a => a.id);
    }

    // ── 7. Combine with post-specific priority ───────────────────────────
    const seenIds = new Set();
    const combinedAttachmentIds = [];
    for (const attId of [...postSpecificAttachmentIds, ...calendarAttachmentIds]) {
      if (!seenIds.has(attId)) {
        seenIds.add(attId);
        combinedAttachmentIds.push(attId);
      }
    }

    // ── 8. Resolve interpreted attachment context (post mode) ────────────
    const attachmentContext = await resolveCalendarAttachmentContext({
      attachmentIds: combinedAttachmentIds,
      brandId: post.calendar.brandId,
      mode: "post",
      calendarId: post.calendarId,
      calendarPostId: id,
    });

    if (!attachmentContext.ok) {
      return NextResponse.json(
        { success: false, error: attachmentContext.error },
        { status: attachmentContext.status }
      );
    }

    // ── 9. Parse request body ────────────────────────────────────────────
    let body;
    try { body = await request.json(); }
    catch (e) {
      return NextResponse.json(
        { success: false, error: "Invalid request body.", details: e.message },
        { status: 400 }
      );
    }

    const { scope = "visual_only", brandId: bodyBrandId, calendarId, customInstruction, guidedReason, guidedReasons, guidedFeatures, imageTextInstruction, currentPost } = body;

    // ── 6. Reject context mismatches ─────────────────────────────────────
    if (bodyBrandId && bodyBrandId !== post.calendar.brandId) {
      return NextResponse.json(
        { success: false, error: "Brand mismatch." },
        { status: 400 }
      );
    }
    if (calendarId && calendarId !== post.calendarId) {
      return NextResponse.json(
        { success: false, error: "Calendar mismatch." },
        { status: 400 }
      );
    }
    if (currentPost?.id && currentPost.id !== id) {
      return NextResponse.json(
        { success: false, error: "Post ID mismatch." },
        { status: 400 }
      );
    }

    // ── 7. Validate scope ────────────────────────────────────────────────
    if (!VALID_SCOPES.includes(scope)) {
      return NextResponse.json(
        { success: false, error: `Invalid scope. Must be one of: ${VALID_SCOPES.join(", ")}.` },
        { status: 400 }
      );
    }

    if (scope === "custom_instruction") {
      if (!customInstruction?.trim() || customInstruction.trim().length < 5) {
        return NextResponse.json(
          { success: false, error: "Please write what you want AI to change." },
          { status: 400 }
        );
      }
    }

    // ── 8. Load brand & identity from the post's own brand ────────────────
    const brandId = post.calendar.brandId;
    const [brand, identity] = await Promise.all([
      prisma.brand.findUnique({ where: { id: brandId } }),
      prisma.brandIdentity.findFirst({ where: { brandId }, orderBy: { createdAt: "desc" } }),
    ]);
    if (!brand) return NextResponse.json({ success: false, error: "Brand not found." }, { status: 404 });

    const contentLanguage = normalizeLanguageCode(brand.contentLanguage);

    const calendar = calendarId ? post.calendar : null;

    // ── Merge postData JSON string into current post fields ───────────────────
    let meta = {};
    if (post.postData) {
      try { meta = typeof post.postData === "string" ? JSON.parse(post.postData) : post.postData; }
      catch {}
    }
    const current = { ...meta, ...post };
    // If the frontend sent the current in-memory post state, use its content
    // fields as the source of truth for the AI prompt. This preserves unsaved
    // edits the user made before triggering regeneration.
    const CURRENT_EDITABLE_FIELDS = new Set([
      "hookTitle", "mainAngle", "coreMessage", "caption", "hashtags",
      "contentStructure", "visualDirection", "imageText",
      "outputImageTextRequirements", "outputImageTextRequirementsStructured",
      "structure", "inspiration",
      "videoConceptTitleAndThumbnailTitleIdea", "videoRawIdea",
      "mainIntegratedScenario", "thumbnailIdeaForReel",
      "narrationOrDialogueOfCharacterOrCharacters", "rawImageIdeaForFirstFrame",
      "whatHappens", "characterObjectOrEnvironmentAction",
      "cameraMovement", "speedRamp", "camera", "lens", "focalLength", "aperture",
      "visualMood", "textOnVideo", "format", "platform",
    ]);
    if (currentPost && typeof currentPost === "object") {
      for (const key of CURRENT_EDITABLE_FIELDS) {
        if (currentPost[key] !== undefined && currentPost[key] !== null) {
          current[key] = currentPost[key];
        }
      }
    }
    const currentOitrDisplay = formatOutputImageTextRequirementsForDisplay(
      current.outputImageTextRequirementsStructured ?? current.outputImageTextRequirements
    );
    const brandSummary = buildBrandSummary(identity, brand);

    // ── Build AI prompt ───────────────────────────────────────────────────────
    const attachmentBlock = attachmentContext.block
      ? `\n=== INTERPRETED UPLOADED REFERENCE MATERIAL ===\n${attachmentContext.block}`
      : null;

    const promptContext = {
      current,
      currentOitrDisplay,
      brandSummary,
      contentLanguage,
      calendarContext: calendar,
      attachmentBlock,
    };

    let userInput;

    if (scope === "custom_instruction") {
      userInput = buildCustomInstructionUserInput({
        ...promptContext,
        customInstruction,
      });
    } else if (scope === "image_text_only") {
      // Normalize: accept new array guidedReasons or fall back to legacy string guidedReason
      userInput = buildImageTextOnlyUserInput({
        ...promptContext,
        guidedReasons: Array.isArray(guidedReasons) && guidedReasons.length
          ? guidedReasons
          : (guidedReason ? [guidedReason] : []),
        guidedFeatures,
        imageTextInstruction,
      });
    } else {
      userInput = buildVisualOrEntirePostUserInput({
        ...promptContext,
        scope,
      });
    }
 
     // ── Call AI ───────────────────────────────────────────────────────────────
    let aiResult;
    try {
      aiResult = await generateWithPromptTemplate({
        templateSlug: "content-calendar-generator",
        variables: {},
        userInput,
        maxTokens: 8192,
      });
    } catch (aiErr) {
      return NextResponse.json({
        success: false,
        error: "AI generation failed. Please try again.",
        details: aiErr.message,
      }, { status: 500 });
    }

    let aiPost;
    try {
      const raw = aiResult.raw ?? (typeof aiResult.content === "string" ? aiResult.content : JSON.stringify(aiResult.content));
      const parsed = parseAiJson(raw);
      aiPost = Array.isArray(parsed) ? parsed[0] : parsed;
    } catch (parseErr) {
      return NextResponse.json({
        success: false,
        error: "AI could not regenerate this post. Please try again.",
        details: parseErr.message,
      }, { status: 500 });
    }

    // ── Apply allowed fields from AI output ───────────────────────────────────
    const merged = applyScopedPostRegeneration(current, aiPost, scope);

    // ── Validate / fall back for outputImageTextRequirements ──────────────────
    // Same safety net as initial generation: normalize whatever the AI (or the
    // carried-over original) produced, validate it against the post's own
    // contentStructure/format, and fall back to a derived structured object if
    // it's empty, incomplete, mismatched in slide count, or duplicated. The
    // clean display string is then derived from the final structured object —
    // never asked from the AI redundantly — so the two can never disagree.
    const candidateStructured =
      normalizeOutputImageTextRequirementsStructured(merged.outputImageTextRequirementsStructured) ||
      normalizeOutputImageTextRequirementsStructured(merged.outputImageTextRequirements);

    const oitrCheck = validateOutputImageTextRequirements({
      format: merged.format,
      contentStructure: merged.contentStructure,
      outputImageTextRequirementsStructured: candidateStructured,
      outputImageTextRequirements: null,
    });

    let finalOitrStructured = candidateStructured;
    if (!oitrCheck.valid) {
      console.log(`[PostRegenerate] outputImageTextRequirements validation failed (${oitrCheck.reason}), applying fallback`);
      finalOitrStructured = buildFallbackOutputImageTextRequirements({
        format: merged.format,
        contentStructure: merged.contentStructure,
        hookTitle: merged.hookTitle,
        coreMessage: merged.coreMessage,
        mainAngle: merged.mainAngle,
        caption: merged.caption,
      });
    }
    merged.outputImageTextRequirementsStructured = finalOitrStructured;
    merged.outputImageTextRequirements = formatOutputImageTextRequirementsForDisplay(finalOitrStructured) || "";
    // Keep the displayed Image Text column in sync with regenerated OITR.
    merged.imageText = merged.outputImageTextRequirements;

    // ── Prepare DB update ─────────────────────────────────────────────────────
    // Only scopes that actually regenerate caption/hashtags run the merge —
    // visual_only/visual_ideas_only/image_text_only promise to leave caption
    // and hashtags untouched, so re-running the merge there would risk
    // silently reformatting an old-format post's caption outside its scope.
    const scopeTouchesCaption = scope === "entire_post" || scope === "custom_instruction";
    let hashtags;
    let hashtagsMergedIntoCaption;
    if (scopeTouchesCaption) {
      const mergeResult = mergeHashtagsIntoCaption(merged.caption, merged.hashtags, {
        platform: merged.platform,
        context: {
          brandName:              brand.name,
          mainServicesOrProducts: brand.mainServicesOrProducts,
          businessLocation:       brand.businessLocation,
          businessType:           brand.businessType,
          campaignSubject:        post.calendar?.mainMonthlySubject,
          mainAngle:              merged.mainAngle,
        },
      });
      merged.caption = mergeResult.caption;
      hashtags = mergeResult.hashtags;
      hashtagsMergedIntoCaption = hashtags.length > 0;
    } else {
      hashtags = (() => {
        const v = merged.hashtags;
        if (Array.isArray(v)) return v;
        if (typeof v === "string" && v.trim()) return v.split(/[\s,]+/).filter(Boolean);
        return [];
      })();
      hashtagsMergedIntoCaption = current.hashtagsMergedIntoCaption ?? false;
    }

    const newMeta = {
      mainAngle:   merged.mainAngle   || null,
      coreMessage: merged.coreMessage || null,
      hookTitle:   merged.hookTitle   || null,
      caption:     merged.caption     || null,
      hashtags,
      hashtagsMergedIntoCaption,
      imageText:   merged.imageText   || null,
      outputImageTextRequirements: merged.outputImageTextRequirements || null,
      outputImageTextRequirementsStructured: merged.outputImageTextRequirementsStructured || null,
      structure:   merged.structure   || null,
      inspiration: merged.inspiration || null,
      videoConceptTitleAndThumbnailTitleIdea: merged.videoConceptTitleAndThumbnailTitleIdea || null,
      videoRawIdea:           merged.videoRawIdea           || null,
      mainIntegratedScenario: merged.mainIntegratedScenario || null,
      thumbnailIdeaForReel:   merged.thumbnailIdeaForReel   || null,
      narrationOrDialogueOfCharacterOrCharacters: merged.narrationOrDialogueOfCharacterOrCharacters || null,
      rawImageIdeaForFirstFrame: merged.rawImageIdeaForFirstFrame || null,
      whatHappens:               merged.whatHappens               || null,
      characterObjectOrEnvironmentAction: merged.characterObjectOrEnvironmentAction || null,
      cameraMovement: merged.cameraMovement || null,
      speedRamp:      merged.speedRamp      || null,
      camera:         merged.camera         || null,
      lens:           merged.lens           || null,
      focalLength:    merged.focalLength    || null,
      aperture:       merged.aperture       || null,
      visualMood:     merged.visualMood     || null,
      textOnVideo:    merged.textOnVideo    || null,
    };

    const dbData = {
      suggestedHook:           merged.hookTitle   || undefined,
      mainAngleAndCoreMessage: [merged.mainAngle, merged.coreMessage].filter(Boolean).join(". ") || undefined,
      suggestedCaption:        merged.caption     || undefined,
      hashtags:                hashtags.join(" ") || undefined,
      visualDirection:         merged.visualDirection         || undefined,
      contentStructure:        merged.contentStructure        || undefined,
      outputImageTextRequirements: merged.outputImageTextRequirements || undefined,
      postData:                JSON.stringify(newMeta),
    };

    // custom_instruction may change format — update the dedicated DB column
    if (scope === "custom_instruction" && merged.format) {
      dbData.format = merged.format;
    }

    const updated = await prisma.calendarPost.update({ where: { id }, data: dbData });

    console.log("[PostRegenerate] Saved post id:", updated.id, "scope:", scope);

    return NextResponse.json({
      success: true,
      post: { ...updated, postData: undefined, ...newMeta, format: merged.format ?? updated.format },
      scope,
    });

  } catch (err) {
    console.error("[PostRegenerate] Unhandled error:", err);
    return NextResponse.json({
      success: false,
      error: "Post regeneration failed. Please try again.",
      details: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
