import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateWithPromptTemplate } from "@/lib/ai";
import { normalizeBrandIdentityOutput, createCompactBrandVisualIdentitySummaryForVideoPrompt } from "@/lib/brand-identity-utils";

// ── Cinematic Controls helpers ────────────────────────────────────────────────
// Optional per-request overrides for speed ramp, camera movement, camera,
// lens, focal length, and aperture. When missing/empty, fall back to a
// consistent "infer from context" signal for the AI.
const CINEMATIC_FALLBACK = "Auto — infer from context";

// The video-prompt-enhancer-raw-idea template always starts its final
// structured prompt with this exact sentence. If the model instead detects
// a (real or perceived) conflict, it returns a clarifying question instead —
// that response won't start with this prefix, so it must not be treated as
// a successful, saveable video prompt.
const EXPECTED_PROMPT_PREFIX = "Generate a video with the following prompt";

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

// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request) {
  console.log("[VideoBrandBased] POST /api/video/brand-based/generate");

  try {
    let body;
    try { body = await request.json(); }
    catch (e) {
      return NextResponse.json({ success: false, error: "Invalid request body.", details: e.message }, { status: 400 });
    }

    const {
      brandId,
      rawVideoIdea,
      platform,
      videoFormat,
      videoGoal,
      targetVideoCreatorModel,
      duration,
      aspectRatio,
      speedRamp,
      cameraMovement,
      camera,
      lens,
      focalLength,
      aperture,
    } = body;

    // ── Validation ────────────────────────────────────────────────────────────
    if (!brandId?.trim())                  return NextResponse.json({ success: false, error: "Brand is required." }, { status: 400 });
    if (!rawVideoIdea?.trim())             return NextResponse.json({ success: false, error: "Raw video idea is required." }, { status: 400 });
    if (!platform?.trim())                 return NextResponse.json({ success: false, error: "Platform is required." }, { status: 400 });
    if (!videoFormat?.trim())              return NextResponse.json({ success: false, error: "Video format is required." }, { status: 400 });
    if (!videoGoal?.trim())                return NextResponse.json({ success: false, error: "Video goal is required." }, { status: 400 });
    if (!targetVideoCreatorModel?.trim())  return NextResponse.json({ success: false, error: "Target video creator model is required." }, { status: 400 });
    if (!duration)                         return NextResponse.json({ success: false, error: "Duration is required." }, { status: 400 });
    if (!aspectRatio)                      return NextResponse.json({ success: false, error: "Aspect ratio is required." }, { status: 400 });

    console.log("[VideoBrandBased] brandId:", brandId, "| model:", targetVideoCreatorModel, "| format:", videoFormat);

    // ── Load brand + identity ─────────────────────────────────────────────────
    const [brand, identity] = await Promise.all([
      prisma.brand.findUnique({ where: { id: brandId } }),
      prisma.brandIdentity.findFirst({ where: { brandId }, orderBy: { createdAt: "desc" } }),
    ]);

    if (!brand) return NextResponse.json({ success: false, error: "Brand not found." }, { status: 404 });

    if (!identity) {
      return NextResponse.json({
        success: false,
        error: "Please create or approve brand identity before generating a brand based video prompt.",
      }, { status: 400 });
    }

    // ── Build brand visual identity summary (visual-only, never tone/business data) ─
    const { brandVisualIdentity } = normalizeBrandIdentityOutput(identity);
    const brandIdentitySummary = createCompactBrandVisualIdentitySummaryForVideoPrompt(brandVisualIdentity);
    console.log("[VideoBrandBased] Brand identity summary length:", brandIdentitySummary.length);

    // ── Cinematic Controls (optional requested values) ──────────────────────────
    const cinematicControls = {
      speedRamp:      cinematicValue(speedRamp),
      cameraMovement: cinematicValue(cameraMovement),
      camera:         cinematicValue(camera),
      lens:           cinematicValue(lens),
      focalLength:    cinematicValue(focalLength),
      aperture:       cinematicValue(aperture),
    };

    // ── Prepare combined raw video idea ───────────────────────────────────────
    const combinedRawVideoIdea = [
      "=== BRAND VISUAL IDENTITY ===",
      brandIdentitySummary,
      "",
      "=== USER RAW VIDEO IDEA ===",
      rawVideoIdea.trim(),
      "",
      "=== VIDEO REQUIREMENTS ===",
      `Platform: ${platform}`,
      `Video format: ${videoFormat}`,
      `Video goal: ${videoGoal}`,
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
      "",
      "=== INSTRUCTIONS ===",
      "Create a video prompt that follows the user's idea and the video requirements above, while clearly applying the brand identity.",
      "Use the brand colors, visual style, mood, environment, theme, location, and video creation rules where relevant.",
      "Do not add anything that conflicts with the brand do-not rules.",
      "Keep the output suitable for the selected target video creator model.",
    ].join("\n");

    console.log("[VideoBrandBased] Combined input length:", combinedRawVideoIdea.length);

    // ── Call AI ───────────────────────────────────────────────────────────────
    // The video-prompt-enhancer-raw-idea template is a system instruction.
    // We pass all data (including brand) via userInput (appended after template).
    let finalPrompt;
    try {
      const result = await generateWithPromptTemplate({
        templateSlug: "video-prompt-enhancer-raw-idea",
        variables: {},
        userInput: combinedRawVideoIdea,
      });

      console.log("[VideoBrandBased] Raw AI output length:", result.raw?.length ?? 0);

      finalPrompt = typeof result.content === "string"
        ? result.content
        : JSON.stringify(result.content, null, 2);

      if (!finalPrompt?.trim()) throw new Error("AI returned empty prompt.");
    } catch (aiErr) {
      console.error("[VideoBrandBased] AI error:", aiErr.message);
      if (aiErr.message?.includes("not found")) {
        return NextResponse.json({
          success: false,
          error: "Video prompt template is missing. Please add video_prompt_enhancer_raw_idea to the prompt library.",
          details: aiErr.message,
        }, { status: 500 });
      }
      return NextResponse.json({
        success: false,
        error: "Brand based video prompt generation failed. Please try again.",
        details: aiErr.message,
      }, { status: 500 });
    }

    console.log("[VideoBrandBased] Final prompt length:", finalPrompt.length);

    // ── Guard against clarification responses ────────────────────────────────
    // A valid structured prompt always starts with EXPECTED_PROMPT_PREFIX. If it
    // doesn't, the model likely returned a clarifying question instead of a
    // usable video prompt — do not save or report that as success.
    if (!finalPrompt.trim().startsWith(EXPECTED_PROMPT_PREFIX)) {
      console.error("[VideoBrandBased] AI returned a non-prompt response (likely a clarification request):", finalPrompt.slice(0, 500));
      return NextResponse.json({
        success: false,
        error: "The AI needs clarification before it can generate a video prompt. Please review its response and adjust your inputs.",
        details: finalPrompt,
      }, { status: 422 });
    }

    // ── Save to GeneratedPrompt ───────────────────────────────────────────────
    const rawInputRecord = {
      brandId, brandIdentitySummary, rawVideoIdea: rawVideoIdea.trim(),
      platform, videoFormat, videoGoal, targetVideoCreatorModel, duration, aspectRatio,
      cinematicControls,
      combinedRawVideoIdea,
    };

    let saved;
    try {
      saved = await prisma.generatedPrompt.create({
        data: {
          type:        "video",
          mode:        "brand_based",
          targetTool:  targetVideoCreatorModel,
          brandId:     brandId || null,
          rawInput:    JSON.stringify(rawInputRecord),
          finalPrompt,
        },
      });
      console.log("[VideoBrandBased] Saved GeneratedPrompt id:", saved.id);
    } catch (dbErr) {
      console.error("[VideoBrandBased] DB save error:", dbErr.message);
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
        brandId:     saved.brandId,
        rawInput:    rawInputRecord,
        finalPrompt: saved.finalPrompt,
        createdAt:   saved.createdAt,
        updatedAt:   saved.updatedAt,
      },
    });

  } catch (err) {
    console.error("[VideoBrandBased] Unhandled error:", err);
    return NextResponse.json({
      success: false,
      error: "Brand based video prompt generation failed. Please check your inputs and try again.",
      details: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
