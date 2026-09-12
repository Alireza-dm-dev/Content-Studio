import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireResourceBrandAccess } from "@/lib/brand-access";
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

// ── Normalize post ────────────────────────────────────────────────────────────

function resolvePost(post) {
  let meta = {};
  if (post.postData) {
    try { meta = typeof post.postData === "string" ? JSON.parse(post.postData) : post.postData; }
    catch {}
  }
  const p = { ...meta, ...post };

  return {
    id:          p.id,
    postNumber:  p.postNumber  ?? p.post_number,
    platform:    p.platform    ?? "",
    format:      p.format      ?? p.contentType ?? "",
    hookTitle:   p.hookTitle   ?? p.hook_title   ?? p.suggestedHook ?? p.hook ?? "",
    mainAngle:   p.mainAngle   ?? p.main_angle   ?? p.contentPillar ?? "",
    coreMessage: p.coreMessage ?? p.core_message ?? p.mainAngleAndCoreMessage ?? "",
    caption:     p.caption     ?? p.suggestedCaption ?? "",
    visualDirection: p.visualDirection ?? p.visual_direction ?? "",
    contentStructure: p.contentStructure ?? p.content_structure ?? "",
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

// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request, { params }) {
  const { calendarId, postId } = await params;

  // The calendar owns the brand; authorize against it before doing any work.
  const access = await requireResourceBrandAccess("calendar", calendarId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  console.log("[VideoStoryboard] POST calendarId:", calendarId, "postId:", postId);

  try {
    let body;
    try { body = await request.json(); }
    catch (e) {
      return NextResponse.json({ success: false, error: "Invalid request body.", details: e.message }, { status: 400 });
    }

    const {
      brandId,
      targetVideoCreatorModel = "Higgsfield",
      duration = "15 seconds",
      aspectRatio = "9:16",
      videoFormat = "",
      videoGoal = "",
    } = body;

    if (!brandId?.trim()) {
      return NextResponse.json({ success: false, error: "Brand is required." }, { status: 400 });
    }

    // ── Load required data ────────────────────────────────────────────────────
    const [calendar, post, brand, identity] = await Promise.all([
      prisma.contentCalendar.findUnique({ where: { id: calendarId } }),
      prisma.calendarPost.findUnique({ where: { id: postId } }),
      prisma.brand.findUnique({ where: { id: brandId } }),
      prisma.brandIdentity.findFirst({ where: { brandId }, orderBy: { createdAt: "desc" } }),
    ]);

    if (!calendar) return NextResponse.json({ success: false, error: "Calendar not found." }, { status: 404 });
    if (!post)     return NextResponse.json({ success: false, error: "Calendar post not found." }, { status: 404 });
    if (!brand)    return NextResponse.json({ success: false, error: "Brand not found." }, { status: 404 });
    if (!identity) return NextResponse.json({
      success: false,
      error: "Please create or approve brand identity before creating a storyboard from this calendar post.",
    }, { status: 400 });

    const norm = resolvePost(post);
    const { brandVisualIdentity } = normalizeBrandIdentityOutput(identity);
    const brandSummary = createCompactBrandVisualIdentitySummaryForVideoPrompt(brandVisualIdentity);

    // ── Cinematic Controls (resolved from postData, fallback to "infer from context") ─
    const cinematicControls = {
      speedRamp:      cinematicValue(norm.speedRamp),
      cameraMovement: cinematicValue(norm.cameraMovement),
      camera:         cinematicValue(norm.camera),
      lens:           cinematicValue(norm.lens),
      focalLength:    cinematicValue(norm.focalLength),
      aperture:       cinematicValue(norm.aperture),
    };

    // ── Build rawInput ────────────────────────────────────────────────────────
    const brandObj = {
      id:   brand.id,
      name: brand.name,
      businessType: brand.businessType,
      targetAudience: brand.targetAudience,
      brandTone: brand.brandTone,
      brandVisualStyle: brand.brandVisualStyle,
      businessLocation: brand.businessLocation,
    };

    const rawInputObj = {
      brand: brandObj,
      brandVisualIdentity,
      calendarPost: norm,
      videoPlanningDetails: {
        videoConceptTitleAndThumbnailTitleIdea: norm.videoConceptTitleAndThumbnailTitleIdea,
        videoRawIdea: norm.videoRawIdea,
        mainIntegratedScenario: norm.mainIntegratedScenario,
        thumbnailIdeaForReel: norm.thumbnailIdeaForReel,
      },
      productionDetails: {
        narrationOrDialogueOfCharacterOrCharacters: norm.narrationOrDialogueOfCharacterOrCharacters,
        rawImageIdeaForFirstFrame: norm.rawImageIdeaForFirstFrame,
        whatHappens: norm.whatHappens,
        characterObjectOrEnvironmentAction: norm.characterObjectOrEnvironmentAction,
        cameraMovement: norm.cameraMovement,
        visualMood: norm.visualMood,
        textOnVideo: norm.textOnVideo,
      },
      cinematicControls,
      videoSettings: {
        targetVideoCreatorModel,
        duration,
        aspectRatio,
        videoFormat: videoFormat || norm.format || "video",
        videoGoal,
      },
    };

    // ── Build userInput for template ──────────────────────────────────────────
    const userInput = [
      "=== BRAND VISUAL IDENTITY ===",
      brandSummary,
      "",
      "=== CALENDAR POST ===",
      norm.postNumber && `Post #${norm.postNumber}`,
      `Platform: ${norm.platform || calendar.platform || "social media"}`,
      `Format: ${norm.format || "video"}`,
      norm.hookTitle  && `Hook / Title: ${norm.hookTitle}`,
      norm.mainAngle  && `Main angle: ${norm.mainAngle}`,
      norm.coreMessage && `Core message: ${norm.coreMessage}`,
      norm.caption    && `Caption: ${norm.caption}`,
      norm.visualDirection && `Visual direction: ${norm.visualDirection}`,
      norm.contentStructure && `Content structure: ${norm.contentStructure}`,
      "",
      "=== VIDEO PLANNING DETAILS ===",
      norm.videoConceptTitleAndThumbnailTitleIdea && `Video concept / thumbnail: ${norm.videoConceptTitleAndThumbnailTitleIdea}`,
      norm.videoRawIdea           && `Video raw idea: ${norm.videoRawIdea}`,
      norm.mainIntegratedScenario && `Main integrated scenario: ${norm.mainIntegratedScenario}`,
      norm.thumbnailIdeaForReel   && `Thumbnail idea: ${norm.thumbnailIdeaForReel}`,
      "",
      "=== PRODUCTION DETAILS ===",
      norm.narrationOrDialogueOfCharacterOrCharacters && `Narration / dialogue: ${norm.narrationOrDialogueOfCharacterOrCharacters}`,
      norm.rawImageIdeaForFirstFrame && `First frame idea: ${norm.rawImageIdeaForFirstFrame}`,
      norm.whatHappens               && `What happens: ${norm.whatHappens}`,
      norm.characterObjectOrEnvironmentAction && `Character / object / environment action: ${norm.characterObjectOrEnvironmentAction}`,
      norm.cameraMovement && `Camera movement: ${norm.cameraMovement}`,
      norm.visualMood     && `Visual mood: ${norm.visualMood}`,
      norm.textOnVideo    && `Text on video: ${norm.textOnVideo}`,
      "",
      "=== CALENDAR CONTEXT ===",
      calendar.mainMonthlySubject && `Monthly subject: ${calendar.mainMonthlySubject}`,
      calendar.mainGoal           && `Main goal: ${calendar.mainGoal}`,
      calendar.mainOfferOrMessage && `Offer / message: ${calendar.mainOfferOrMessage}`,
      "",
      "=== CINEMATIC CONTROLS (requested) ===",
      cinematicLine("Speed ramp", cinematicControls.speedRamp),
      cinematicLine("Camera movement", cinematicControls.cameraMovement),
      cinematicLine("Camera", cinematicControls.camera),
      cinematicLine("Lens", cinematicControls.lens),
      cinematicLine("Focal length", cinematicControls.focalLength),
      cinematicLine("Aperture", cinematicControls.aperture),
      "",
      "=== VIDEO SETTINGS ===",
      `Target video creator model: ${targetVideoCreatorModel}`,
      `Duration: ${duration}`,
      `Aspect ratio: ${aspectRatio}`,
      `Video format: ${videoFormat || norm.format || "video"}`,
      videoGoal && `Video goal: ${videoGoal}`,
    ].filter(v => v !== null && v !== false && v !== undefined && v !== "").join("\n");

    console.log("[VideoStoryboard] userInput length:", userInput.length);

    // ── Call AI ───────────────────────────────────────────────────────────────
    let storyboardOutput;
    try {
      const result = await generateWithPromptTemplate({
        templateSlug: "video-storyboard-generator",
        variables: {},
        userInput,
        maxTokens: 4000,
      });

      storyboardOutput = typeof result.content === "string"
        ? result.content
        : JSON.stringify(result.content, null, 2);

      if (!storyboardOutput?.trim()) throw new Error("AI returned empty storyboard.");
    } catch (aiErr) {
      console.error("[VideoStoryboard] AI error:", aiErr.message);
      if (aiErr.message?.includes("not found")) {
        return NextResponse.json({
          success: false,
          error: "Video storyboard template is missing. Please add video-storyboard-generator to the prompt library.",
          details: aiErr.message,
        }, { status: 500 });
      }
      return NextResponse.json({
        success: false,
        error: "Storyboard generation failed. Please try again.",
        details: aiErr.message,
      }, { status: 500 });
    }

    // ── Save to VideoStoryboard ───────────────────────────────────────────────
    let saved;
    try {
      saved = await prisma.videoStoryboard.create({
        data: {
          brandId:       brandId    || null,
          calendarId:    calendarId || null,
          calendarPostId: postId   || null,
          rawInput:      JSON.stringify(rawInputObj),
          storyboardOutput,
          status:        "draft",
        },
      });
      console.log("[VideoStoryboard] Saved VideoStoryboard id:", saved.id);
    } catch (dbErr) {
      console.error("[VideoStoryboard] DB save error:", dbErr.message);
      return NextResponse.json({
        success: false,
        error: "Storyboard generated but could not be saved. Please try again.",
        details: dbErr.message,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      videoStoryboard: {
        id:                saved.id,
        brandId:           saved.brandId,
        calendarId:        saved.calendarId,
        calendarPostId:    saved.calendarPostId,
        rawInput:          rawInputObj,
        storyboardOutput:  saved.storyboardOutput,
        approvedStoryboard: null,
        status:            saved.status,
        createdAt:         saved.createdAt,
        updatedAt:         saved.updatedAt,
      },
    });

  } catch (err) {
    console.error("[VideoStoryboard] Unhandled error:", err);
    return NextResponse.json({
      success: false,
      error: "Video storyboard creation failed. Please try again.",
      details: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
