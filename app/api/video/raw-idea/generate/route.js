import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminAccess } from "@/lib/auth";
import { generateWithPromptTemplate } from "@/lib/ai";
import { selectCameraMovement } from "@/lib/video-camera-movements";
import { buildVideoStyleBlock, resolveCinematicStyle } from "@/lib/cinematic-styles";

// The video-prompt-enhancer-raw-idea template always starts its final
// structured prompt with this exact sentence. If the model instead detects
// a (real or perceived) conflict, it returns a clarifying question instead —
// that response won't start with this prefix, so it must not be treated as
// a successful, saveable video prompt.
const EXPECTED_PROMPT_PREFIX = "Generate a video with the following prompt";

const CINEMATIC_FALLBACK = "Auto — infer from context";

function resolveCameraMovement(rawValue, context = {}) {
  if (rawValue && rawValue !== "Auto" && rawValue !== "Auto — infer from context") {
    const selected = selectCameraMovement({ ...context, userMovement: rawValue });
    return `${selected.label} — ${selected.execution}, ${selected.speed} speed, ends ${selected.endFrame}`;
  }
  const selected = selectCameraMovement(context);
  return `${selected.label} — ${selected.execution}, ${selected.speed} speed, ends ${selected.endFrame}`;
}

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

export async function POST(request) {
  const access = await getAdminAccess();
  if (!access.user) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status });
  }

  console.log("[VideoRawIdea] POST /api/video/raw-idea/generate");

  try {
    let body;
    try { body = await request.json(); }
    catch (e) {
      return NextResponse.json({ success: false, error: "Invalid request body.", details: e.message }, { status: 400 });
    }

    const {
      rawVideoIdea,
      targetVideoCreatorModel,
      duration,
      aspectRatio,
      videoType,
      speedRamp,
      cameraMovement,
      camera,
      lens,
      focalLength,
      aperture,
      cinematicStyle,
    } = body;

    // ── Validation ────────────────────────────────────────────────────────────
    if (!rawVideoIdea?.trim()) {
      return NextResponse.json({ success: false, error: "Raw video idea is required." }, { status: 400 });
    }
    if (!targetVideoCreatorModel?.trim()) {
      return NextResponse.json({ success: false, error: "Target video creator model is required." }, { status: 400 });
    }
    if (!duration) {
      return NextResponse.json({ success: false, error: "Video duration is required." }, { status: 400 });
    }
    if (!aspectRatio) {
      return NextResponse.json({ success: false, error: "Aspect ratio is required." }, { status: 400 });
    }
    if (!videoType?.trim()) {
      return NextResponse.json({ success: false, error: "Video type is required." }, { status: 400 });
    }

    // ── Cinematic style validation ─────────────────────────────────────────────
    // Invalid explicit selections return a clean 400 instead of being silently
    // downgraded to "auto" or failing later. Missing/blank/"auto" → AI decides.
    const cinematic = resolveCinematicStyle(cinematicStyle);
    if (cinematic.error) {
      return NextResponse.json({ success: false, error: cinematic.error }, { status: 400 });
    }

    // ── Cinematic Controls (optional requested values) ──────────────────────────
    const effectiveCamStyle = cinematic.style !== "auto" ? cinematic.style : videoType;
    const cameraMovementLine = resolveCameraMovement(cameraMovement, {
      genre: videoType,
      style: effectiveCamStyle,
      actionLevel: "medium",
    });

    const cinematicControls = {
      speedRamp:      cinematicValue(speedRamp),
      cameraMovement: cameraMovementLine,
      camera:         cinematicValue(camera),
      lens:           cinematicValue(lens),
      focalLength:    cinematicValue(focalLength),
      aperture:       cinematicValue(aperture),
    };

    const inputs = { rawVideoIdea: rawVideoIdea.trim(), targetVideoCreatorModel, duration, aspectRatio, videoType, cinematicControls };
    console.log("[VideoRawIdea] inputs:", inputs);

    // ── Build userInput block ─────────────────────────────────────────────────
    const userInputParts = [
      `Raw video idea: ${rawVideoIdea.trim()}`,
      `Target video creator model: ${targetVideoCreatorModel}`,
      `Duration: ${duration}`,
      `Aspect ratio: ${aspectRatio}`,
      `Video type: ${videoType}`,
      "",
      "=== CINEMATIC CONTROLS (requested) ===",
      cinematicLine("Speed ramp", cinematicControls.speedRamp),
      cinematicLine("Camera movement", cinematicControls.cameraMovement),
      cinematicLine("Camera", cinematicControls.camera),
      cinematicLine("Lens", cinematicControls.lens),
      cinematicLine("Focal length", cinematicControls.focalLength),
      cinematicLine("Aperture", cinematicControls.aperture),
    ];

    if (cinematic.style !== "auto") {
      const styleBlock = buildVideoStyleBlock(cinematic.style);
      if (styleBlock) {
        userInputParts.push("", styleBlock);
      }
    }

    const userInput = userInputParts.join("\n");

    // ── Call AI ───────────────────────────────────────────────────────────────
    let finalPrompt;
    try {
      const result = await generateWithPromptTemplate({
        templateSlug: "video-prompt-enhancer-raw-idea",
        variables: {},
        userInput,
      });

      console.log("[VideoRawIdea] Raw AI output length:", result.raw?.length ?? 0);

      finalPrompt = typeof result.content === "string"
        ? result.content
        : JSON.stringify(result.content, null, 2);

      if (!finalPrompt?.trim()) {
        throw new Error("AI returned empty prompt.");
      }
    } catch (aiErr) {
      console.error("[VideoRawIdea] AI error:", aiErr.message);
      if (aiErr.message?.includes("not configured")) {
        return NextResponse.json({
          success: false,
          code: "OPENAI_NOT_CONFIGURED",
          error: "OpenAI is not configured. Ask an administrator to add the API key in Settings.",
        }, { status: 503 });
      }
      // Detect missing template error
      if (aiErr.message?.includes("not found")) {
        return NextResponse.json({
          success: false,
          error: "Video prompt template is missing. Please add video_prompt_enhancer_raw_idea to the prompt library.",
          details: aiErr.message,
        }, { status: 500 });
      }
      return NextResponse.json({
        success: false,
        error: "Video prompt generation failed. Please try again.",
        details: aiErr.message,
      }, { status: 500 });
    }

    console.log("[VideoRawIdea] Final prompt length:", finalPrompt.length);

    // ── Guard against clarification responses ────────────────────────────────
    // A valid structured prompt always starts with EXPECTED_PROMPT_PREFIX. If it
    // doesn't, the model likely returned a clarifying question instead of a
    // usable video prompt — do not save or report that as success.
    if (!finalPrompt.trim().startsWith(EXPECTED_PROMPT_PREFIX)) {
      console.error("[VideoRawIdea] AI returned a non-prompt response (likely a clarification request):", finalPrompt.slice(0, 500));
      return NextResponse.json({
        success: false,
        error: "The AI needs clarification before it can generate a video prompt. Please review its response and adjust your inputs.",
        details: finalPrompt,
      }, { status: 422 });
    }

    // ── Save to GeneratedPrompt ───────────────────────────────────────────────
    let saved;
    try {
      saved = await prisma.generatedPrompt.create({
        data: {
          type:        "video",
          mode:        "raw_idea",
          targetTool:  targetVideoCreatorModel,
          rawInput:    JSON.stringify(inputs),
          finalPrompt,
        },
      });
      console.log("[VideoRawIdea] Saved GeneratedPrompt id:", saved.id);
    } catch (dbErr) {
      console.error("[VideoRawIdea] DB save error:", dbErr.message);
      return NextResponse.json({
        success: false,
        error: "Prompt generated but could not be saved. Please try again.",
        details: dbErr.message,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      generatedPrompt: {
        id:          saved.id,
        type:        saved.type,
        mode:        saved.mode,
        targetTool:  saved.targetTool,
        rawInput:    inputs,
        finalPrompt: saved.finalPrompt,
        createdAt:   saved.createdAt,
        updatedAt:   saved.updatedAt,
      },
    });

  } catch (err) {
    console.error("[VideoRawIdea] Unhandled error:", err);
    return NextResponse.json({
      success: false,
      error: "Video prompt generation failed. Please check your inputs and try again.",
      details: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
