import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminAccess } from "@/lib/auth";
import { generateWithPromptTemplate } from "@/lib/ai";
import { normalizeBrandIdentityOutput, createCompactBrandVisualIdentitySummaryForVideoPrompt } from "@/lib/brand-identity-utils";

// ── Cinematic Controls helpers ────────────────────────────────────────────────
// Resolved postData values for speed ramp, camera movement, camera, lens,
// focal length, and aperture. When missing/empty, fall back to a consistent
// "infer from context" signal for the AI.
const CINEMATIC_FALLBACK = "Auto — infer from context";

function cinematicValue(value) {
  if (value === undefined || value === null) return CINEMATIC_FALLBACK;
  const str = String(value).trim();
  return str ? str : CINEMATIC_FALLBACK;
}

// Reword Auto values so the AI infers a real choice instead of echoing "Auto".
function cinematicLine(label, value) {
  if (value === "Auto" || value === CINEMATIC_FALLBACK) {
    return `${label}: Auto selected by user — choose the best actual ${label.toLowerCase()} for this scene and write that value in the final output. Do not write "Auto" or "Auto — infer from context".`;
  }
  return `${label}: ${value}`;
}

// ── Normalize post from DB record (merges postData JSON) ─────────────────────

function resolvePost(post) {
  let meta = {};
  if (post.postData) {
    try { meta = typeof post.postData === "string" ? JSON.parse(post.postData) : post.postData; }
    catch {}
  }
  const p = { ...meta, ...post };

  return {
    id:          p.id,
    postNumber:  p.postNumber   ?? p.post_number,
    platform:    p.platform     ?? "",
    format:      p.format       ?? p.contentType ?? "",
    hookTitle:   p.hookTitle    ?? p.hook_title   ?? p.suggestedHook ?? p.hook ?? p.title ?? "",
    mainAngle:   p.mainAngle    ?? p.main_angle   ?? p.contentPillar ?? "",
    coreMessage: p.coreMessage  ?? p.core_message ?? p.mainAngleAndCoreMessage ?? "",
    caption:     p.caption      ?? p.suggestedCaption ?? "",
    visualDirection: p.visualDirection ?? p.visual_direction ?? "",
    videoConceptTitleAndThumbnailTitleIdea: p.videoConceptTitleAndThumbnailTitleIdea ?? p.video_concept_title_and_thumbnail_title_idea ?? "",
    videoRawIdea:           p.videoRawIdea           ?? p.video_raw_idea           ?? "",
    mainIntegratedScenario: p.mainIntegratedScenario ?? p.main_integrated_scenario ?? "",
    thumbnailIdeaForReel:   p.thumbnailIdeaForReel   ?? p.thumbnail_idea_for_reel   ?? "",
    narrationOrDialogueOfCharacterOrCharacters: p.narrationOrDialogueOfCharacterOrCharacters ?? p.narration_or_dialogue_of_character_or_characters ?? "",
    rawImageIdeaForFirstFrame: p.rawImageIdeaForFirstFrame ?? p.raw_image_idea_for_first_frame ?? "",
    whatHappens:               p.whatHappens ?? p.what_happens ?? "",
    characterObjectOrEnvironmentAction: p.characterObjectOrEnvironmentAction ?? p.character_object_or_environment_action ?? "",
    cameraMovement: p.cameraMovement ?? p.camera_movement ?? "",
    visualMood:     p.visualMood    ?? p.visual_mood    ?? "",
    textOnVideo:    p.textOnVideo   ?? p.text_on_video   ?? "",
    speedRamp:      p.speedRamp     ?? p.speed_ramp     ?? "",
    camera:         p.camera        ?? "",
    lens:           p.lens          ?? "",
    focalLength:    p.focalLength   ?? p.focal_length   ?? "",
    aperture:       p.aperture      ?? "",
  };
}

// ── Build calendar post summary text ─────────────────────────────────────────

function buildCalendarPostSummary(norm) {
  const lines = [];
  if (norm.postNumber) lines.push(`Post #${norm.postNumber}`);
  if (norm.platform)   lines.push(`Platform: ${norm.platform}`);
  if (norm.format)     lines.push(`Format: ${norm.format}`);
  if (norm.hookTitle)  lines.push(`Hook / Title: ${norm.hookTitle}`);
  if (norm.mainAngle)  lines.push(`Main angle: ${norm.mainAngle}`);
  if (norm.coreMessage) lines.push(`Core message: ${norm.coreMessage}`);
  if (norm.visualDirection) lines.push(`Visual direction: ${norm.visualDirection}`);
  if (norm.videoConceptTitleAndThumbnailTitleIdea) lines.push(`Video concept / thumbnail: ${norm.videoConceptTitleAndThumbnailTitleIdea}`);
  if (norm.videoRawIdea)           lines.push(`Video raw idea: ${norm.videoRawIdea}`);
  if (norm.mainIntegratedScenario) lines.push(`Integrated scenario: ${norm.mainIntegratedScenario}`);
  if (norm.narrationOrDialogueOfCharacterOrCharacters) lines.push(`Narration / dialogue: ${norm.narrationOrDialogueOfCharacterOrCharacters}`);
  if (norm.whatHappens)  lines.push(`What happens: ${norm.whatHappens}`);
  if (norm.cameraMovement) lines.push(`Camera movement: ${norm.cameraMovement}`);
  if (norm.visualMood)   lines.push(`Visual mood: ${norm.visualMood}`);
  if (norm.textOnVideo)  lines.push(`Text on video: ${norm.textOnVideo}`);
  return lines.join("\n");
}

// ── POST /api/video-storyboards/[id]/generate-final-prompt ───────────────────

export async function POST(request, { params }) {
  const { id } = await params;

  const access = await getAdminAccess();
  if (!access.user) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status });
  }

  console.log("[FinalVideoPrompt] POST storyboardId:", id);

  try {
    let body;
    try { body = await request.json(); }
    catch (e) {
      return NextResponse.json(
        { success: false, error: "Invalid request body.", details: e.message },
        { status: 400 }
      );
    }

    const {
      targetVideoCreatorModel = "Higgsfield",
      duration = "15 seconds",
      aspectRatio = "9:16",
      videoFormat = "Reel",
      videoGoal = "",
    } = body;

    // ── 1. Load storyboard ──────────────────────────────────────────────────
    const storyboard = await prisma.videoStoryboard.findUnique({ where: { id } });

    if (!storyboard) {
      return NextResponse.json(
        { success: false, error: "Storyboard not found." },
        { status: 404 }
      );
    }

    if (storyboard.status !== "approved") {
      return NextResponse.json(
        { success: false, error: "Please approve the storyboard before generating the final video prompt." },
        { status: 400 }
      );
    }

    const approvedStoryboard = storyboard.approvedStoryboard?.trim();
    if (!approvedStoryboard) {
      return NextResponse.json(
        { success: false, error: "Approved storyboard is empty. Please save and approve the storyboard again." },
        { status: 400 }
      );
    }

    const { brandId, calendarId, calendarPostId } = storyboard;

    if (!brandId) {
      return NextResponse.json(
        { success: false, error: "Storyboard is missing a brand reference. Please regenerate it." },
        { status: 400 }
      );
    }

    // ── 2. Load related records ────────────────────────────────────────────
    const [brand, identity, post] = await Promise.all([
      prisma.brand.findUnique({ where: { id: brandId } }),
      prisma.brandIdentity.findFirst({ where: { brandId }, orderBy: { createdAt: "desc" } }),
      calendarPostId
        ? prisma.calendarPost.findUnique({ where: { id: calendarPostId } })
        : Promise.resolve(null),
    ]);

    if (!brand) {
      return NextResponse.json(
        { success: false, error: "Brand not found." },
        { status: 404 }
      );
    }

    if (!identity) {
      return NextResponse.json(
        { success: false, error: "Please create or approve brand identity before generating the final video prompt." },
        { status: 400 }
      );
    }

    const { brandVisualIdentity } = normalizeBrandIdentityOutput(identity);
    const brandSummary = createCompactBrandVisualIdentitySummaryForVideoPrompt(brandVisualIdentity);
    const norm = post ? resolvePost(post) : null;
    const calendarPostSummary = norm ? buildCalendarPostSummary(norm) : "";

    // ── Cinematic Controls (resolved from post context, fallback to "infer from context") ─
    const cinematicControls = {
      speedRamp:      cinematicValue(norm?.speedRamp),
      cameraMovement: cinematicValue(norm?.cameraMovement),
      camera:         cinematicValue(norm?.camera),
      lens:           cinematicValue(norm?.lens),
      focalLength:    cinematicValue(norm?.focalLength),
      aperture:       cinematicValue(norm?.aperture),
    };

    // ── 3. Build combined raw video input ──────────────────────────────────
    const combinedRawVideoInput = [
      "Brand Identity Summary:",
      brandSummary,
      "",
      calendarPostSummary ? "Calendar Post:" : null,
      calendarPostSummary || null,
      "",
      "Approved Storyboard:",
      approvedStoryboard,
      "",
      "Cinematic Controls (requested):",
      cinematicLine("Speed ramp", cinematicControls.speedRamp),
      cinematicLine("Camera movement", cinematicControls.cameraMovement),
      cinematicLine("Camera", cinematicControls.camera),
      cinematicLine("Lens", cinematicControls.lens),
      cinematicLine("Focal length", cinematicControls.focalLength),
      cinematicLine("Aperture", cinematicControls.aperture),
      "",
      "Video Settings:",
      `Target video creator model: ${targetVideoCreatorModel}`,
      `Duration: ${duration}`,
      `Aspect ratio: ${aspectRatio}`,
      `Video format: ${videoFormat}`,
      videoGoal ? `Video goal: ${videoGoal}` : null,
      "",
      "Instructions:",
      "Create a final production-ready video generation prompt based on the approved storyboard above.",
      "Preserve the storyboard structure and scene sequence.",
      "Apply the brand identity naturally — colors, tone, visual style, do and do not rules.",
      `Keep the prompt suitable for ${targetVideoCreatorModel}.`,
      `Use duration: ${duration}, aspect ratio: ${aspectRatio}, video format: ${videoFormat}.`,
      "Include camera movement, visual mood, scene actions, transitions, pacing, narration or dialogue, and text on video where relevant.",
      "Do not add visual elements that conflict with the approved storyboard.",
      "Do not return a storyboard again. Return the final video generation prompt only.",
    ].filter(l => l !== null).join("\n");

    // ── 4. Generate prompt ─────────────────────────────────────────────────
    let finalPrompt;
    try {
      const result = await generateWithPromptTemplate({
        templateSlug: "video-prompt-enhancer-raw-idea",
        variables: {
          rawVideoIdea:            combinedRawVideoInput,
          targetVideoCreatorModel,
          duration,
          aspectRatio,
          videoType:               videoFormat,
        },
        responseFormat: "text",
        maxTokens: 2000,
      });

      finalPrompt = typeof result.content === "string"
        ? result.content
        : JSON.stringify(result.content, null, 2);

      if (!finalPrompt?.trim()) throw new Error("AI returned empty prompt.");
    } catch (aiErr) {
      console.error("[FinalVideoPrompt] AI error:", aiErr.message);
      if (aiErr.message?.includes("not found") || aiErr.message?.includes("placeholder")) {
        return NextResponse.json({
          success: false,
          error: "Video prompt template is missing. Please add video-prompt-enhancer-raw-idea to the prompt library.",
          details: aiErr.message,
        }, { status: 500 });
      }
      return NextResponse.json({
        success: false,
        error: "Final video prompt generation failed. Please try again.",
        details: aiErr.message,
      }, { status: 500 });
    }

    // ── 5. Save to GeneratedPrompt ─────────────────────────────────────────
    const rawInputRecord = {
      brandId,
      calendarId:    calendarId    || null,
      calendarPostId: calendarPostId || null,
      videoStoryboardId: id,
      brandIdentitySummary: brandSummary,
      calendarPost:  norm || null,
      approvedStoryboard,
      cinematicControls,
      targetVideoCreatorModel,
      duration,
      aspectRatio,
      videoFormat,
      videoGoal: videoGoal || null,
      combinedRawVideoInput,
    };

    let saved;
    try {
      saved = await prisma.generatedPrompt.create({
        data: {
          type:          "video",
          mode:          "storyboard_based",
          targetTool:    targetVideoCreatorModel,
          brandId:       brandId        || null,
          calendarId:    calendarId     || null,
          calendarPostId: calendarPostId || null,
          rawInput:      JSON.stringify(rawInputRecord),
          finalPrompt,
        },
      });
      console.log("[FinalVideoPrompt] Saved GeneratedPrompt id:", saved.id);
    } catch (dbErr) {
      console.error("[FinalVideoPrompt] DB save error:", dbErr.message);
      return NextResponse.json({
        success: false,
        error: "Prompt generated but could not be saved. Please try again.",
        details: dbErr.message,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      generatedPrompt: {
        id:            saved.id,
        type:          saved.type,
        mode:          saved.mode,
        targetTool:    saved.targetTool,
        brandId:       saved.brandId,
        calendarId:    saved.calendarId,
        calendarPostId: saved.calendarPostId,
        rawInput:      rawInputRecord,
        finalPrompt:   saved.finalPrompt,
        createdAt:     saved.createdAt,
        updatedAt:     saved.updatedAt,
      },
    });

  } catch (err) {
    console.error("[FinalVideoPrompt] Unhandled error:", err);
    return NextResponse.json({
      success: false,
      error: "Final video prompt creation failed. Please try again.",
      details: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
