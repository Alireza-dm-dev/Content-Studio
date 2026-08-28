import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, getBrandCalendarAccess } from "@/lib/auth";
import { generateWithPromptTemplate } from "@/lib/ai";
import { resolveCalendarAttachmentContext } from "@/lib/calendar-attachment-context";
import { normalizeLanguageCode } from "@/lib/content-language";
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
// in lib/calendar-regeneration-prompt.js (shared with the saved-post route).

const VALID_SCOPES = Object.keys(SCOPE_FIELDS);

// ── POST /api/content-calendar/regenerate-post ────────────────────────────────
// Regenerates an unsaved calendar post during the Review Calendar step.
// Accepts the full post object inline — does not load from or write to DB.
export async function POST(request) {
  console.log("[RegeneratePost] POST /api/content-calendar/regenerate-post");

  // ── 1. Authenticate ────────────────────────────────────────────────────────
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    // ── 2. Parse request body ────────────────────────────────────────────────
    let body;
    try { body = await request.json(); }
    catch (e) {
      return NextResponse.json(
        { success: false, error: "Invalid request body.", details: e.message },
        { status: 400 }
      );
    }

    // ── 3. Validate required fields ──────────────────────────────────────────
    const { post, brandId, calendarContext, scope = "visual_only", customInstruction, guidedReason, guidedReasons, guidedFeatures, imageTextInstruction, attachmentIds } = body;

    if (!post || typeof post !== "object") {
      return NextResponse.json(
        { success: false, error: "post is required." },
        { status: 400 }
      );
    }
    if (!brandId) {
      return NextResponse.json(
        { success: false, error: "brandId is required." },
        { status: 400 }
      );
    }

    // ── 4. Authorize brand access ────────────────────────────────────────────
    const access = await getBrandCalendarAccess(brandId);
    if (!access.allowed) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }

    // ── 5. Resolve calendar attachment context (creation mode) ───────────────
    const attachmentContext = await resolveCalendarAttachmentContext({
      attachmentIds,
      brandId,
      mode: "creation",
    });

    if (!attachmentContext.ok) {
      return NextResponse.json(
        { success: false, error: attachmentContext.error },
        { status: attachmentContext.status }
      );
    }

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

    // ── Load brand and identity from DB ───────────────────────────────────────
    const [brand, identity] = await Promise.all([
      prisma.brand.findUnique({ where: { id: brandId } }),
      prisma.brandIdentity.findFirst({ where: { brandId }, orderBy: { createdAt: "desc" } }),
    ]);

    if (!brand) {
      return NextResponse.json({ success: false, error: "Brand not found." }, { status: 404 });
    }

    const contentLanguage = normalizeLanguageCode(brand.contentLanguage);

    // ── Use the inline post directly — no DB lookup or postData merge needed ──
    const current = post;
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
      calendarContext,
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
      console.log(`[RegeneratePost] outputImageTextRequirements validation failed (${oitrCheck.reason}), applying fallback`);
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

    // ── Normalize hashtags ────────────────────────────────────────────────────
    // Only scopes that actually regenerate caption/hashtags run the merge —
    // visual_only/visual_ideas_only/image_text_only promise to leave caption
    // and hashtags untouched, so re-running the merge there would risk
    // silently reformatting an old-format post's caption outside its scope.
    const scopeTouchesCaption = scope === "entire_post" || scope === "custom_instruction";
    if (scopeTouchesCaption) {
      const mergeResult = mergeHashtagsIntoCaption(merged.caption, merged.hashtags);
      merged.caption = mergeResult.caption;
      merged.hashtags = mergeResult.hashtags;
      merged.hashtagsMergedIntoCaption = mergeResult.hashtags.length > 0;
    } else {
      merged.hashtags = (() => {
        const v = merged.hashtags;
        if (Array.isArray(v)) return v;
        if (typeof v === "string" && v.trim()) return v.split(/[\s,]+/).filter(Boolean);
        return [];
      })();
      merged.hashtagsMergedIntoCaption = current.hashtagsMergedIntoCaption ?? false;
    }

    // ── Return regenerated post — no DB write ─────────────────────────────────
    console.log("[RegeneratePost] Done. scope:", scope, "postNumber:", merged.postNumber);
    return NextResponse.json({ success: true, post: merged, scope });

  } catch (err) {
    console.error("[RegeneratePost] Unhandled error:", err);
    return NextResponse.json({
      success: false,
      error: "Post regeneration failed. Please try again.",
      details: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
