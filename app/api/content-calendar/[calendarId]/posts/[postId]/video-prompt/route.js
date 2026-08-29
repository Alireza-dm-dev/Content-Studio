import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateWithPromptTemplate } from "@/lib/ai";
import { normalizeBrandIdentityOutput, createCompactBrandVisualIdentitySummaryForVideoPrompt } from "@/lib/brand-identity-utils";
import { selectCameraMovement } from "@/lib/video-camera-movements";
import { buildVideoStyleBlock, resolveCinematicStyle } from "@/lib/cinematic-styles";

// ── Cinematic Controls helpers ────────────────────────────────────────────────
const CINEMATIC_FALLBACK = "Auto — infer from context";

function cinematicValue(value) {
  if (value === undefined || value === null) return CINEMATIC_FALLBACK;
  const str = String(value).trim();
  return str ? str : CINEMATIC_FALLBACK;
}

function cinematicLine(label, value) {
  if (value === "Auto" || value === CINEMATIC_FALLBACK) {
    return `${label}: Auto selected by user — choose the best actual ${label.toLowerCase()} for this scene and write that value in the final output. Do not write "Auto" or "Auto — infer from context".`;
  }
  return `${label}: ${value}`;
}

function resolveCameraMovement(rawValue, context = {}) {
  if (rawValue && rawValue !== "Auto" && rawValue !== "Auto — infer from context") {
    const selected = selectCameraMovement({ ...context, userMovement: rawValue });
    return `${selected.label} — ${selected.execution}, ${selected.speed} speed, ends ${selected.endFrame}`;
  }
  const selected = selectCameraMovement(context);
  return `${selected.label} — ${selected.execution}, ${selected.speed} speed, ends ${selected.endFrame}`;
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
  console.log("[VideoPrompt] POST calendarId:", calendarId, "postId:", postId);

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
      videoGoal = "",
      cinematicStyle,
    } = body;

    if (!brandId?.trim()) {
      return NextResponse.json({ success: false, error: "Brand is required." }, { status: 400 });
    }
    if (!targetVideoCreatorModel?.trim()) {
      return NextResponse.json({ success: false, error: "Target video creator model is required." }, { status: 400 });
    }

    // ── Cinematic style validation ─────────────────────────────────────────────
    // Invalid explicit selections return a clean 400 instead of being silently
    // downgraded to "auto" or failing later. Missing/blank/"auto" → AI decides.
    const cinematic = resolveCinematicStyle(cinematicStyle);
    if (cinematic.error) {
      return NextResponse.json({ success: false, error: cinematic.error }, { status: 400 });
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
      error: "Please create or approve brand identity before creating prompts from this calendar post.",
    }, { status: 400 });

    const norm = resolvePost(post);
    const { brandVisualIdentity } = normalizeBrandIdentityOutput(identity);
    const brandSummary = createCompactBrandVisualIdentitySummaryForVideoPrompt(brandVisualIdentity);

    // ── Cinematic Controls (resolved from postData, deterministic camera movement) ─
    const effectiveCamStyle = cinematic.style !== "auto" ? cinematic.style : (norm.visualMood || "social-media");
    const genre = (norm.videoRawIdea || norm.format || "social-media-reel").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const cameraMovementLine = resolveCameraMovement(norm.cameraMovement, {
      genre,
      style: effectiveCamStyle,
      platform: norm.platform || "",
      actionLevel: "medium",
    });

    const cinematicControls = {
      speedRamp:      cinematicValue(norm.speedRamp),
      cameraMovement: cameraMovementLine,
      camera:         cinematicValue(norm.camera),
      lens:           cinematicValue(norm.lens),
      focalLength:    cinematicValue(norm.focalLength),
      aperture:       cinematicValue(norm.aperture),
    };

    const effectivePlatform    = norm.platform    || calendar.platform || "";
    const effectiveVideoFormat = norm.format      || "";
    const effectiveVideoGoal   = videoGoal?.trim() || norm.mainAngle || norm.coreMessage || "";

    // ── Build combined raw video input ────────────────────────────────────────
    const combinedRawVideoInput = [
      "=== BRAND VISUAL IDENTITY ===",
      brandSummary,
      "",
      "=== CALENDAR POST ===",
      norm.postNumber && `Post #${norm.postNumber}`,
      norm.hookTitle  && `Hook / Title: ${norm.hookTitle}`,
      norm.mainAngle  && `Main angle: ${norm.mainAngle}`,
      norm.coreMessage && `Core message: ${norm.coreMessage}`,
      norm.caption    && `Caption: ${norm.caption}`,
      norm.visualDirection && `Visual direction: ${norm.visualDirection}`,
      "",
      "=== VIDEO PLANNING DETAILS ===",
      norm.videoConceptTitleAndThumbnailTitleIdea && `Video concept / thumbnail: ${norm.videoConceptTitleAndThumbnailTitleIdea}`,
      norm.videoRawIdea          && `Video raw idea: ${norm.videoRawIdea}`,
      norm.mainIntegratedScenario && `Main integrated scenario: ${norm.mainIntegratedScenario}`,
      norm.thumbnailIdeaForReel  && `Thumbnail idea: ${norm.thumbnailIdeaForReel}`,
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
      "=== VIDEO REQUIREMENTS ===",
      effectivePlatform    && `Platform: ${effectivePlatform}`,
      effectiveVideoFormat && `Video format: ${effectiveVideoFormat}`,
      effectiveVideoGoal   && `Video goal: ${effectiveVideoGoal}`,
      `Target video creator model: ${targetVideoCreatorModel}`,
      `Duration: ${duration}`,
      `Aspect ratio: ${aspectRatio}`,
      "",
      "=== CINEMATIC CONTROLS (requested) ===",
      cinematicLine("Speed ramp", cinematicControls.speedRamp),
      cinematicLine("Camera movement", cinematicControls.cameraMovement),
      cinematicLine("Camera", cinematicControls.camera),
      cinematicLine("Lens", cinematicControls.lens),
      cinematicLine("Focal length", cinematicControls.focalLength),
      cinematicLine("Aperture", cinematicControls.aperture),
    ];

    // ── Cinematic Style Block ──────────────────────────────────────────────────
    if (cinematic.style !== "auto") {
      const styleBlock = buildVideoStyleBlock(cinematic.style);
      if (styleBlock) {
        combinedRawVideoInput.push("", styleBlock);
      }
    }

    combinedRawVideoInput.push(
      "",
      "=== CALENDAR CONTEXT ===",
      calendar.mainMonthlySubject && `Monthly subject: ${calendar.mainMonthlySubject}`,
      calendar.mainGoal           && `Main goal: ${calendar.mainGoal}`,
      calendar.mainOfferOrMessage && `Offer / message: ${calendar.mainOfferOrMessage}`,
      "",
      "=== INSTRUCTIONS ===",
      "Create a video prompt that follows the post idea and video requirements above, while clearly applying the brand identity.",
      "Use the brand colors, visual style, mood, environment, theme, and video creation rules where relevant.",
      "Do not add anything that conflicts with the brand do-not rules.",
      "Keep the output suitable for the selected target video creator model.",
    );

    console.log("[VideoPrompt] Combined input length:", combinedRawVideoInput.length);

    // generateWithPromptTemplate expects a string; join the assembled lines.
    const combinedUserInput = combinedRawVideoInput.filter(Boolean).join("\n");

    // ── Call AI ───────────────────────────────────────────────────────────────
    let finalPrompt;
    try {
      const result = await generateWithPromptTemplate({
        templateSlug: "video-prompt-enhancer-raw-idea",
        variables: {},
        userInput: combinedUserInput,
      });

      finalPrompt = typeof result.content === "string"
        ? result.content
        : JSON.stringify(result.content, null, 2);

      if (!finalPrompt?.trim()) throw new Error("AI returned empty prompt.");
    } catch (aiErr) {
      console.error("[VideoPrompt] AI error:", aiErr.message);
      if (aiErr.message?.includes("not found")) {
        return NextResponse.json({
          success: false,
          error: "Video prompt template is missing. Please add video-prompt-enhancer-raw-idea to the prompt library.",
          details: aiErr.message,
        }, { status: 500 });
      }
      return NextResponse.json({
        success: false,
        error: "Video prompt generation failed. Please try again.",
        details: aiErr.message,
      }, { status: 500 });
    }

    // ── Save to GeneratedPrompt ───────────────────────────────────────────────
    const rawInputRecord = {
      brandId,
      calendarId,
      calendarPostId: postId,
      calendarPost: norm,
      brandIdentitySummary: brandSummary,
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
      targetVideoCreatorModel,
      duration,
      aspectRatio,
      videoFormat: effectiveVideoFormat,
      videoGoal: effectiveVideoGoal,
      combinedRawVideoInput,
    };

    let saved;
    try {
      saved = await prisma.generatedPrompt.create({
        data: {
          type:          "video",
          mode:          "calendar_post",
          targetTool:    targetVideoCreatorModel,
          brandId:       brandId    || null,
          calendarId:    calendarId || null,
          calendarPostId: postId   || null,
          rawInput:      JSON.stringify(rawInputRecord),
          finalPrompt,
        },
      });
      console.log("[VideoPrompt] Saved GeneratedPrompt id:", saved.id);
    } catch (dbErr) {
      console.error("[VideoPrompt] DB save error:", dbErr.message);
      return NextResponse.json({
        success: false,
        error: "Prompt generated but could not be saved. Please try again.",
        details: dbErr.message,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      generatedPrompt: {
        id:           saved.id,
        type:         saved.type,
        mode:         saved.mode,
        targetTool:   saved.targetTool,
        brandId:      saved.brandId,
        calendarId:   saved.calendarId,
        calendarPostId: saved.calendarPostId,
        rawInput:     rawInputRecord,
        finalPrompt:  saved.finalPrompt,
        createdAt:    saved.createdAt,
        updatedAt:    saved.updatedAt,
      },
    });

  } catch (err) {
    console.error("[VideoPrompt] Unhandled error:", err);
    return NextResponse.json({
      success: false,
      error: "Video prompt creation failed. Please try again.",
      details: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
