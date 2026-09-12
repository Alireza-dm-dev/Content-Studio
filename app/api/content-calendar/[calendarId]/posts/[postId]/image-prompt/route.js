import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireResourceBrandAccess } from "@/lib/brand-access";
import { generateWithPromptTemplate } from "@/lib/ai";
import { normalizeBrandIdentityOutput, createCompactBrandVisualIdentitySummaryForImagePrompt } from "@/lib/brand-identity-utils";
import { normalizeOutputImageTextRequirementsStructured, formatOutputImageTextRequirementsForDisplay } from "@/lib/calendar-post-utils";
import { normalizeVisualControls, serializeVisualControls } from "@/lib/image-visual-controls";
import {
  resolveImageStyleAndPreset,
  imageStylePresetErrorResponse,
  buildProductionControlsSection,
} from "@/lib/image-style-preset-resolution";

function stripRatioMentions(prompt) {
  return prompt
    .replace(/[^.\n]*\b(?:aspect|size|canvas|output)\s+ratio\b[^.\n]*[.\n]?/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildConcreteReferenceCompositionBlock(refAnalysis, cvdObj) {
  function extractVal(obj, ...keys) {
    if (!obj || typeof obj !== "object") return null;
    for (const key of keys) {
      const parts = key.split(".");
      let val = obj;
      for (const p of parts) val = val?.[p];
      if (val == null || val === "") continue;
      if (Array.isArray(val)) {
        const items = val.filter(Boolean).map(v =>
          typeof v === "object" ? Object.entries(v).map(([k, vv]) => `${k}: ${vv}`).join(", ") : String(v)
        );
        if (items.length) return items.join("; ");
      } else if (typeof val === "string" && val.trim()) {
        return val.trim();
      } else if (typeof val === "number") {
        return String(val);
      } else if (typeof val === "object") {
        const entries = Object.entries(val).filter(([, v]) => v != null && v !== "");
        if (entries.length) return entries.map(([k, v]) =>
          `${k}: ${Array.isArray(v) ? v.join(", ") : typeof v === "object" ? Object.values(v).filter(Boolean).join(", ") : v}`
        ).join("; ");
      }
    }
    return null;
  }

  const sources = [refAnalysis, cvdObj].filter(Boolean);
  if (!sources.length) {
    return [
      "",
      "=== REFERENCE IMAGE COMPOSITION TO PRESERVE ===",
      "Reference image concrete object data was not available. Use the uploaded image itself as the source of object placement, scale, layering, and visual hierarchy.",
      "",
      "(If an image is uploaded, consider that image idea in aspect and objects, and their placement)",
    ].join("\n");
  }

  function get(...keys) {
    for (const src of sources) {
      const val = extractVal(src, ...keys);
      if (val) return val;
    }
    return null;
  }

  const f = {
    mainObjects: get(
      "compositionMap.mainObjects", "compositionMap.objects", "compositionMap.elements",
      "objects", "elements", "mainObjects", "keyElements", "visibleElements",
      "referenceImageInfluence.objects", "reference_image_influence.usable_style_elements"),
    objectCount: get("compositionMap.objectCount"),
    placement: get(
      "compositionMap.placement", "compositionMap.positions",
      "objectPositions", "positions", "placement", "elementPositions",
      "referenceImageInfluence.placement"),
    relativeScale: get(
      "compositionMap.relativeScale", "compositionMap.scale",
      "referenceImageInfluence.relativeScale"),
    orientation: get(
      "compositionMap.orientation", "compositionMap.rotationOrAngle",
      "referenceImageInfluence.orientation"),
    overlapAndLayering: get(
      "compositionMap.overlapAndLayering", "compositionMap.layering",
      "referenceImageInfluence.overlapAndLayering"),
    foreground: get("compositionMap.foreground", "referenceImageInfluence.foreground"),
    background: get("compositionMap.background", "referenceImageInfluence.background"),
    foregroundBackground: get(
      "foregroundBackground", "layering", "depth", "sceneStructure",
      "compositionMap.foregroundBackground",
      "referenceImageInfluence.layering"),
    focalObject: get(
      "compositionMap.focalObject", "compositionMap.focalPoint",
      "focalPoint", "focalObject", "focus", "mainSubject",
      "referenceImageInfluence.focalPoint"),
    negativeSpace: get(
      "compositionMap.negativeSpace", "compositionMap.emptySpace",
      "negativeSpace", "emptySpace"),
    compositionType: get(
      "compositionMap.compositionType", "compositionMap.layoutType",
      "compositionType", "layoutType",
      "reference_image_influence.composition_inspiration"),
    visualHierarchy: get(
      "visualHierarchy", "compositionMap.visualHierarchy",
      "referenceImageInfluence.visualHierarchy"),
    spacing: get("compositionMap.spacing"),
    alignment: get("compositionMap.alignment"),
    reusableGuidance: get(
      "reusableReferenceGuidance", "referenceImageInfluence.reusableReferenceGuidance"),
  };

  const brand = {
    colors: get(
      "brand_identity_preservation.brand_colors_to_preserve",
      "brandVisualIdentity.colors", "brandVisualIdentity.colorPalette",
      "colorPalette", "colours", "colors"),
    typography: get(
      "brand_identity_preservation.typography_rules_to_preserve",
      "brandVisualIdentity.typography", "typography"),
    logoRules: get(
      "brand_identity_preservation.logo_usage_rules",
      "brandVisualIdentity.logoUsageRules"),
    visualMood: get(
      "brand_identity_preservation.visual_mood_to_preserve",
      "brandVisualIdentity.mood", "combined_visual_direction.visual_mood"),
    colorApplication: get(
      "combined_visual_direction.recommended_color_application"),
    typographyApplication: get(
      "combined_visual_direction.recommended_typography_application"),
    doNot: get(
      "brand_consistency_rules.do_not",
      "brandVisualIdentity.avoidRules"),
  };

  const sections = [];

  if (f.mainObjects) {
    const count = f.objectCount ? ` (${f.objectCount} total)` : "";
    sections.push(`Objects to preserve:\n* ${f.mainObjects}${count}`);
  }
  if (f.placement) sections.push(`Object placement:\n* ${f.placement}`);
  if (f.relativeScale) sections.push(`Scale relationships:\n* ${f.relativeScale}`);
  if (f.orientation) sections.push(`Orientation / angle:\n* ${f.orientation}`);

  const layerLines = [];
  if (f.overlapAndLayering) layerLines.push(`* Overlap/layering: ${f.overlapAndLayering}`);
  if (f.foreground) layerLines.push(`* Foreground: ${f.foreground}`);
  if (f.background) layerLines.push(`* Background: ${f.background}`);
  if (f.foregroundBackground && !f.overlapAndLayering) layerLines.push(`* Layering: ${f.foregroundBackground}`);
  if (layerLines.length) sections.push(`Foreground / background layering:\n${layerLines.join("\n")}`);

  if (f.negativeSpace) sections.push(`Negative space:\n* ${f.negativeSpace}`);

  const hierLines = [];
  if (f.focalObject) hierLines.push(`* Focal point: ${f.focalObject}`);
  if (f.visualHierarchy) hierLines.push(`* Visual hierarchy: ${f.visualHierarchy}`);
  if (hierLines.length) sections.push(`Visual hierarchy:\n${hierLines.join("\n")}`);

  if (f.compositionType) sections.push(`Composition type:\n* ${f.compositionType}`);

  const spacingParts = [f.spacing, f.alignment].filter(Boolean);
  if (spacingParts.length) sections.push(`Spacing / alignment:\n* ${spacingParts.join("; ")}`);

  if (f.reusableGuidance) sections.push(`Additional reference guidance:\n* ${f.reusableGuidance}`);

  const brandLines = [];
  if (brand.colors) brandLines.push(`Colors: ${brand.colors}`);
  if (brand.typography) brandLines.push(`Typography: ${brand.typography}`);
  if (brand.logoRules) brandLines.push(`Logo placement: ${brand.logoRules}`);
  if (brand.visualMood) brandLines.push(`Visual mood: ${brand.visualMood}`);
  if (brand.colorApplication) brandLines.push(`Color application: ${brand.colorApplication}`);
  if (brand.typographyApplication) brandLines.push(`Typography application: ${brand.typographyApplication}`);
  if (brand.doNot) brandLines.push(`Avoid: ${brand.doNot}`);

  if (sections.length > 0) {
    const parts = [
      "",
      "=== REFERENCE IMAGE COMPOSITION TO PRESERVE ===",
      ...sections,
    ];
    if (brandLines.length > 0) {
      parts.push("", "=== BRAND IDENTITY TO APPLY ===", ...brandLines);
    }
    parts.push(
      "",
      "Use these reference composition details and brand identity values as mandatory constraints. Object presence, placement, scale, orientation, layering, and visual hierarchy must match the reference image. Apply the exact brand colors, typography, and mood specified above.",
      "",
      "(If an image is uploaded, consider that image idea in aspect and objects, and their placement)"
    );
    return parts.join("\n");
  }

  const fallbackParts = [
    "",
    "=== REFERENCE IMAGE COMPOSITION TO PRESERVE ===",
    "Reference image concrete object data was not available. Use the uploaded image itself as the source of object placement, scale, layering, and visual hierarchy.",
  ];
  if (brandLines.length > 0) {
    fallbackParts.push("", "=== BRAND IDENTITY TO APPLY ===", ...brandLines);
  }
  fallbackParts.push(
    "",
    "(If an image is uploaded, consider that image idea in aspect and objects, and their placement)"
  );
  return fallbackParts.join("\n");
}

// ── Normalize post with postData merge ───────────────────────────────────────

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
    date:        p.date,
    platform:    p.platform     ?? "",
    format:      p.format       ?? p.contentType ?? "",
    hookTitle:   p.hookTitle    ?? p.hook_title   ?? p.suggestedHook ?? p.suggested_hook ?? p.hook ?? "",
    mainAngle:   p.mainAngle    ?? p.main_angle   ?? p.contentPillar ?? "",
    coreMessage: p.coreMessage  ?? p.core_message ?? p.mainAngleAndCoreMessage ?? "",
    caption:     p.caption      ?? p.suggestedCaption ?? "",
    contentStructure: p.contentStructure ?? p.content_structure ?? "",
    visualDirection:  p.visualDirection  ?? p.visual_direction  ?? "",
    // Keep these as separate fields — outputImageTextRequirements is the slide-by-slide text,
    // imageText is the legacy simpler version. outputImageTextRequirementsStructured (when
    // present) is the higher-quality structured source — normalized here so old
    // string-only posts get parsed into the same shape too (see Part 10/11).
    outputImageTextRequirements: p.outputImageTextRequirements ?? p.output_image_text_requirements ?? "",
    outputImageTextRequirementsStructured: normalizeOutputImageTextRequirementsStructured(
      p.outputImageTextRequirementsStructured ?? p.outputImageTextRequirements ?? p.output_image_text_requirements ?? null
    ),
    imageText:    p.imageText   ?? p.image_text ?? "",
    videoRawIdea: p.videoRawIdea ?? p.video_raw_idea ?? "",
    mainIntegratedScenario: p.mainIntegratedScenario ?? p.main_integrated_scenario ?? "",
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
  console.log("[ImagePrompt] POST calendarId:", calendarId, "postId:", postId);

  try {
    let body;
    try { body = await request.json(); }
    catch (e) {
      return NextResponse.json({ success: false, error: "Invalid request body.", details: e.message }, { status: 400 });
    }

    const {
      brandId,
      outputImageTextRequirements = "",
      carouselMode = "not_carousel",  // "full_carousel" | "exact_slide" | "not_carousel"
      carouselSlideNumber = null,
      combinedVisualDirectionId = null,
      currentPrompt = "",
      refinementFeedback = "",
      promptGuidance = "",
      visualControls = null,
    } = body;

    const isRefinement = currentPrompt.trim().length > 0 && refinementFeedback.trim().length > 0;

    // ── Shared style/preset resolution ─────────────────────────────────────────
    // Invalid explicit selections return a clean structured 400 instead of being
    // silently downgraded to "auto" or failing later.
    if (visualControls !== undefined && visualControls !== null && typeof visualControls !== "object") {
      return NextResponse.json(
        { success: false, code: "INVALID_VISUAL_CONTROLS", error: "visualControls must be an object." },
        { status: 400 }
      );
    }
    const resolved = resolveImageStyleAndPreset(visualControls);
    if (!resolved.ok) {
      const { body, status } = imageStylePresetErrorResponse(resolved.errors);
      return NextResponse.json(body, { status });
    }

    // ── Visual Production Controls (optional) ───────────────────────────────
    // Normalize untrusted client input; unknown values collapse to "auto" and
    // are omitted from prompt serialization. Never throws on bad input.
    const normalizedVisualControls = normalizeVisualControls(visualControls);
    const visualControlsBlock = serializeVisualControls(normalizedVisualControls);

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

    if (!calendar)  return NextResponse.json({ success: false, error: "Calendar not found." }, { status: 404 });
    if (!post)      return NextResponse.json({ success: false, error: "Calendar post not found." }, { status: 404 });
    if (!brand)     return NextResponse.json({ success: false, error: "Brand not found." }, { status: 404 });
    if (!identity)  return NextResponse.json({
      success: false,
      error: "Please create or approve brand identity before creating prompts from this calendar post.",
    }, { status: 400 });

    const norm = resolvePost(post);
    const { brandVisualIdentity } = normalizeBrandIdentityOutput(identity);
    const brandSummary = createCompactBrandVisualIdentitySummaryForImagePrompt(brandVisualIdentity);

    // ── Load combined visual direction (with-reference mode) ──────────────────
    let rawImageIdea = "";
    let cvdId = combinedVisualDirectionId || null;
    let cvdDirectionObj = null;

    let refAnalysisData = null;

    if (combinedVisualDirectionId) {
      const cvd = await prisma.combinedVisualDirection.findUnique({ where: { id: combinedVisualDirectionId } });
      if (cvd) {
        const raw = cvd.editedJson || cvd.jsonOutput;
        try {
          cvdDirectionObj = JSON.parse(raw);
          rawImageIdea = JSON.stringify(cvdDirectionObj, null, 2);
        } catch {
          rawImageIdea = raw ?? "";
        }
        if (cvd.referenceImageAnalysisId) {
          const refRow = await prisma.referenceImageAnalysis.findUnique({
            where: { id: cvd.referenceImageAnalysisId },
          });
          if (refRow?.jsonOutput) {
            try { refAnalysisData = JSON.parse(refRow.jsonOutput); } catch {}
          }
        }
      }
    }

    const concreteCompositionBlock = combinedVisualDirectionId
      ? buildConcreteReferenceCompositionBlock(refAnalysisData, cvdDirectionObj)
      : "";

    if (!rawImageIdea) {
      rawImageIdea = [
        norm.visualDirection       && `Visual direction: ${norm.visualDirection}`,
        norm.videoRawIdea          && `Raw idea: ${norm.videoRawIdea}`,
        norm.mainIntegratedScenario && `Integrated scenario: ${norm.mainIntegratedScenario}`,
      ].filter(Boolean).join("\n") || "Create a branded social media image based on the post content above.";
    }

    // ── Effective image text requirements ─────────────────────────────────────
    // Priority (Part 10): 1) explicit override from the modal (already cleaned
    // by the user), 2) the structured version formatted into clean text — the
    // higher-quality source when it exists, 3) the cleaned-parsed legacy string
    // (normalizeOutputImageTextRequirementsStructured already parsed it for us
    // so old string-only posts go through the exact same clean formatter),
    // 4) the legacy simple imageText field.
    const effectiveImageTextReqs = outputImageTextRequirements?.trim()
      || formatOutputImageTextRequirementsForDisplay(norm.outputImageTextRequirementsStructured ?? norm.outputImageTextRequirements)
      || norm.imageText
      || "";

    // ── Carousel context block ────────────────────────────────────────────────
    const carouselBlock = (() => {
      if (carouselMode === "full_carousel") {
        return [
          "=== CAROUSEL SETTINGS ===",
          "Mode: Full carousel — create a prompt covering all slides.",
          norm.contentStructure && `Carousel content structure: ${norm.contentStructure}`,
        ].filter(Boolean).join("\n");
      }
      if (carouselMode === "exact_slide") {
        return [
          "=== CAROUSEL SETTINGS ===",
          `Mode: Exact slide — create a prompt for slide ${carouselSlideNumber} only.`,
          norm.contentStructure && `Full carousel structure for context: ${norm.contentStructure}`,
        ].filter(Boolean).join("\n");
      }
      return null;
    })();

    // ── Build userInput ───────────────────────────────────────────────────────
    const isCarouselPost = (norm.format || "").toLowerCase().includes("carousel");

    const userInput = [
      "Brand visual identity:",
      brandSummary,
      "",
      "Post type:",
      [norm.format && norm.format, norm.platform && `for ${norm.platform}`].filter(Boolean).join(" ") || "Social media post",
      "",
      isCarouselPost
        ? "Output image text requirements (slide-by-slide):"
        : "Output image text requirements:",
      effectiveImageTextReqs || "No specific text requirements.",
      "",
      "Visual direction:",
      norm.visualDirection || "Create based on brand identity and post context.",
      "",
      "Raw image idea:",
      rawImageIdea,
      "",
      "=== CALENDAR POST CONTEXT ===",
      norm.postNumber && `Post #${norm.postNumber}`,
      norm.hookTitle  && `Hook / Title: ${norm.hookTitle}`,
      norm.mainAngle  && `Main angle: ${norm.mainAngle}`,
      norm.coreMessage && `Core message: ${norm.coreMessage}`,
      norm.caption    && `Caption: ${norm.caption}`,
      norm.contentStructure && `Content structure: ${norm.contentStructure}`,
      carouselBlock,
      "",
      "=== CALENDAR CONTEXT ===",
      calendar.mainMonthlySubject && `Monthly subject: ${calendar.mainMonthlySubject}`,
      calendar.mainGoal           && `Main goal: ${calendar.mainGoal}`,
      calendar.mainOfferOrMessage && `Offer / message: ${calendar.mainOfferOrMessage}`,
      ...(promptGuidance.trim() ? [
        "",
        "=== USER GUIDANCE FOR FINAL PROMPT ===",
        promptGuidance.trim(),
        "",
        "Use this guidance to shape the final image prompt.",
        "Preserve brand alignment, post intent, and post content.",
        "Apply the guidance only where it improves the final prompt and does not conflict with the required post context.",
      ] : []),
      ...(combinedVisualDirectionId ? [
        concreteCompositionBlock,
      ] : []),
    ].filter(v => v !== null && v !== false && v !== undefined && v !== "").join("\n");

    // ── Append shared style/preset production section ──────────────────────
    // One combined block: manual controls (1) > visual preset (2) > cinematic
    // style (3), all surfaced as explicit instructions — never just the id — with
    // the documented precedence rule. Missing/auto selections contribute nothing.
    const productionSection = buildProductionControlsSection({
      manualControlsBlock: visualControlsBlock,
      cinematicStyle: resolved.cinematicStyle,
      preset: resolved.preset,
    });
    const baseUserInput = productionSection
      ? `${userInput}\n\n${productionSection}\n\nPriority: treat the selected visual production controls, preset, and cinematic style as explicit user constraints, but never override required brand identity, supplied reference composition, or visible text/logos/products. If a selection conflicts with required identity, preserve the required identity and apply the control in the closest compatible manner without redesigning logos, products, people, artwork, or required text.`
      : userInput;

    // ── Append refinement block when refining an existing prompt ────────────
    const finalUserInput = isRefinement
      ? [
          baseUserInput,
          "",
          "=== CURRENT NANOBANANA PROMPT TO REFINE ===",
          currentPrompt.trim(),
          "",
          "=== USER REFINEMENT REQUEST ===",
          refinementFeedback.trim(),
          "",
          "Refine the current Nanobanana prompt according to the user's request.",
          "Preserve everything that the user did not ask to change.",
          "Keep the same post content and brand alignment.",
          "Output only the refined Nanobanana prompt text.",
          "Do not include explanations, markdown, or commentary.",
        ].join("\n")
      : baseUserInput;

    console.log(`[ImagePrompt] ${isRefinement ? "REFINE" : "GENERATE"} | userInput length: ${finalUserInput.length}`);

    // ── Call AI ───────────────────────────────────────────────────────────────
    let finalPrompt;
    try {
      const result = await generateWithPromptTemplate({
        templateSlug: "image-prompt-from-brand-and-post-without-reference",
        variables: {},
        userInput: finalUserInput,
      });

      finalPrompt = typeof result.content === "string"
        ? result.content
        : JSON.stringify(result.content, null, 2);

      if (!finalPrompt?.trim()) throw new Error("AI returned empty prompt.");

      if (combinedVisualDirectionId) {
        finalPrompt = stripRatioMentions(finalPrompt) + concreteCompositionBlock;
      }
    } catch (aiErr) {
      console.error("[ImagePrompt] AI error:", aiErr.message);
      if (aiErr.message?.includes("not found")) {
        return NextResponse.json({
          success: false,
          error: "Image prompt template is missing. Please add image-prompt-from-brand-and-post-without-reference to the prompt library.",
          details: aiErr.message,
        }, { status: 500 });
      }
      return NextResponse.json({
        success: false,
        error: "Prompt generation failed. Please try again.",
        details: aiErr.message,
      }, { status: 500 });
    }

    // ── Save to GeneratedPrompt ───────────────────────────────────────────────
    const baseMode = combinedVisualDirectionId ? "calendar_post_with_reference" : "calendar_post_without_reference";
    const mode = isRefinement ? `${baseMode}_refined` : baseMode;
    const rawInputRecord = {
      brandId,
      calendarId,
      calendarPostId: postId,
      calendarPost: norm,
      imageMode: combinedVisualDirectionId ? "with_reference" : "without_reference",
      combinedVisualDirectionId: cvdId,
      carouselMode,
      carouselSlideNumber: carouselSlideNumber || null,
      outputImageTextRequirements: effectiveImageTextReqs || null,
    };

    const referenceData = isRefinement
      ? JSON.stringify({ refinementFeedback: refinementFeedback.trim(), previousPrompt: currentPrompt.trim() })
      : null;

    let saved;
    try {
      saved = await prisma.generatedPrompt.create({
        data: {
          type:          "image",
          mode,
          targetTool:    "Nanobanana",
          brandId:       brandId       || null,
          calendarId:    calendarId    || null,
          calendarPostId: postId       || null,
          rawInput:      JSON.stringify(rawInputRecord),
          referenceData,
          finalPrompt,
        },
      });
      console.log("[ImagePrompt] Saved GeneratedPrompt id:", saved.id);
    } catch (dbErr) {
      console.error("[ImagePrompt] DB save error:", dbErr.message);
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
    console.error("[ImagePrompt] Unhandled error:", err);
    return NextResponse.json({
      success: false,
      error: "Image prompt creation failed. Please try again.",
      details: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
