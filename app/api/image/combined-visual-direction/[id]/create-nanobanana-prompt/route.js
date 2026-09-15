import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireResourceBrandAccess } from "@/lib/brand-access";
import { generateWithPromptTemplate } from "@/lib/ai";
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

export async function POST(request, { params }) {
  try {
    const { id } = await params;

    const access = await requireResourceBrandAccess("combinedVisualDirection", id);
    if (!access.ok) {
      return NextResponse.json(
        { success: false, error: access.error },
        { status: access.status },
      );
    }
    console.log("[NanobananaPrompt] POST for CombinedVisualDirection id:", id);
    const body = await request.json().catch(() => ({}));
    const useEditedJson = body.useEditedJson !== false;

    // ── Shared style/preset resolution ───────────────────────────────────────
    // Invalid explicit selections return a structured 400 JSON instead of being
    // silently dropped (previously the reference flow never resolved the
    // cinematic style at all, so the selection was lost from the final prompt).
    if (body?.visualControls !== undefined && body?.visualControls !== null && typeof body.visualControls !== "object") {
      return NextResponse.json(
        { success: false, code: "INVALID_VISUAL_CONTROLS", error: "visualControls must be an object." },
        { status: 400 }
      );
    }
    const resolved = resolveImageStyleAndPreset(body?.visualControls);
    if (!resolved.ok) {
      const { body: errorBody, status } = imageStylePresetErrorResponse(resolved.errors);
      return NextResponse.json(errorBody, { status });
    }
    const visualControls = normalizeVisualControls(body.visualControls);
    const visualControlsBlock = serializeVisualControls(visualControls);

    // ── Load CombinedVisualDirection ──────────────────────────────────────────
    const cvd = await prisma.combinedVisualDirection.findUnique({ where: { id } });
    if (!cvd) {
      return NextResponse.json({ success: false, error: "Combined visual direction not found." }, { status: 404 });
    }

    // ── Resolve the direction to use ─────────────────────────────────────────
    let directionObj;
    try {
      const raw = (useEditedJson && cvd.editedJson) ? cvd.editedJson : cvd.jsonOutput;
      directionObj = JSON.parse(raw ?? "{}");
    } catch {
      directionObj = {};
    }

    // ── Load linked reference image analysis for concrete composition data ────
    let refAnalysisData = null;
    if (cvd.referenceImageAnalysisId) {
      const refRow = await prisma.referenceImageAnalysis.findUnique({
        where: { id: cvd.referenceImageAnalysisId },
      });
      if (refRow?.jsonOutput) {
        try { refAnalysisData = JSON.parse(refRow.jsonOutput); } catch {}
      }
    }

    // ── Convert to text block for rawImageIdea ────────────────────────────────
    const directionText = JSON.stringify(directionObj, null, 2);

    // ── Extract structured visual details from directionObj ───────────────────
    // Tries multiple possible key names defensively; returns null when absent.
    function pick(obj, ...keys) {
      for (const key of keys) {
        const parts = key.split(".");
        let val = obj;
        for (const p of parts) val = val?.[p];
        if (val !== undefined && val !== null && val !== "") {
          if (Array.isArray(val)) return val.filter(Boolean).join("; ");
          if (typeof val === "string") return val.trim();
          if (typeof val === "object") return JSON.stringify(val);
        }
      }
      return null;
    }

    function pickRef(...keys) {
      return pick(refAnalysisData, ...keys) || pick(directionObj, ...keys);
    }

    const colorPalette = pick(
      directionObj,
      "colorPalette", "colours", "colors", "colourPalette",
      "brandVisualIdentity.colors", "brandVisualIdentity.colorPalette",
      "brandVisualIdentity.colours", "visualIdentity.colors",
      "brand_identity_preservation.brand_colors_to_preserve",
      "combined_visual_direction.recommended_color_application"
    );
    const typography = pick(
      directionObj,
      "typography", "fonts", "typeface", "fontStyle",
      "brandVisualIdentity.typography", "brandVisualIdentity.fonts",
      "brandVisualIdentity.fontStyle",
      "brand_identity_preservation.typography_rules_to_preserve",
      "combined_visual_direction.recommended_typography_application"
    );
    const composition = pick(
      directionObj,
      "composition", "layoutAndComposition", "layout", "visualComposition",
      "brandVisualIdentity.composition", "brandVisualIdentity.layout",
      "brandVisualIdentity.layoutAndComposition",
      "combined_visual_direction.recommended_composition",
      "combined_visual_direction.recommended_layout"
    );
    const imageTreatment = pick(
      directionObj,
      "imageTreatment", "imageStyle", "photoStyle", "visualStyle",
      "imageAndVideoStyle",
      "brandVisualIdentity.imageTreatment", "brandVisualIdentity.imageStyle",
      "brandVisualIdentity.imageAndVideoStyle",
      "combined_visual_direction.recommended_photo_or_illustration_style",
      "combined_visual_direction.recommended_subject_treatment"
    );
    const mood = pick(
      directionObj,
      "mood", "atmosphere", "moodAndAtmosphere", "visualMood", "feeling",
      "brandVisualIdentity.mood", "brandVisualIdentity.atmosphere",
      "brandVisualIdentity.visualMood",
      "brand_identity_preservation.visual_mood_to_preserve",
      "combined_visual_direction.visual_mood"
    );
    const brandRules = pick(
      directionObj,
      "brandPreservationRules", "brandRules", "preservationRules",
      "brandDoAndDont", "usageRules",
      "brandVisualIdentity.colorUsageRules", "brandVisualIdentity.usageRules",
      "brandVisualIdentity.placementRules",
      "brand_consistency_rules.non_negotiable_brand_rules",
      "brand_consistency_rules.do_not"
    );
    const creativeBrief = pick(
      directionObj,
      "finalCreativeBrief", "creativeBrief", "summary", "brief",
      "brandVisualIdentity.summary",
      "combined_visual_direction.style_description",
      "final_creative_brief.one_sentence_direction"
    );

    const compositionMap = pickRef(
      "compositionMap", "spatialLayout", "objectPlacement",
      "referenceImageInfluence.compositionMap", "referenceImageInfluence.spatialLayout",
      "referenceImageInfluence.objectPlacement"
    );
    const objects = pickRef(
      "objects", "elements", "mainObjects", "keyElements", "visibleElements",
      "compositionMap.objects", "compositionMap.elements", "compositionMap.mainObjects",
      "referenceImageInfluence.objects", "referenceImageInfluence.elements"
    );
    const objectPositions = pickRef(
      "objectPositions", "positions", "elementPositions",
      "compositionMap.positions", "compositionMap.placement",
      "referenceImageInfluence.placement"
    );
    const focalPoint = pickRef(
      "focalPoint", "focalObject", "focus", "visualFocus", "mainSubject",
      "compositionMap.focalPoint", "compositionMap.focalObject",
      "referenceImageInfluence.focalPoint"
    );
    const foregroundBackground = pickRef(
      "foregroundBackground", "layering", "depth", "layers", "sceneStructure",
      "compositionMap.foregroundBackground", "compositionMap.layering",
      "referenceImageInfluence.layering", "referenceImageInfluence.sceneStructure"
    );
    const negativeSpace = pickRef(
      "negativeSpace", "emptySpace", "whitespace", "breathingRoom",
      "compositionMap.negativeSpace", "compositionMap.emptySpace"
    );
    const compositionType = pickRef(
      "compositionType", "layoutType", "gridType",
      "compositionMap.compositionType", "compositionMap.layoutType"
    );

    // Extracted avoid/negative content
    const extractedAvoid = [
      pick(
        directionObj,
        "avoid", "avoidElements", "doNotInclude", "negativePrompt",
        "negativeElements", "risk", "qualityControl", "doNot", "avoidRules",
        "avoidList", "thingsToAvoid",
        "brandVisualIdentity.avoidRules", "brandVisualIdentity.doNotRules",
        "brandVisualIdentity.avoidElements", "brandVisualIdentity.avoid",
        "brand_consistency_rules.do_not",
        "reference_image_influence.elements_to_avoid_from_reference",
        "ai_image_generation_guidance.negative_prompt_elements"
      ),
    ].filter(Boolean);

    // ── Build concrete reference composition block from extracted data ────────
    const concreteCompositionBlock = buildConcreteReferenceCompositionBlock(refAnalysisData, directionObj);

    // ── Build extra visual direction paragraph ────────────────────────────────
    const detailLines = [
      colorPalette   && `Colour palette: ${colorPalette}`,
      typography     && `Typography: ${typography}`,
      composition    && `Layout and composition: ${composition}`,
      imageTreatment && `Image treatment: ${imageTreatment}`,
      mood           && `Mood and atmosphere: ${mood}`,
      brandRules     && `Brand preservation rules: ${brandRules}`,
      creativeBrief  && `Final creative brief: ${creativeBrief}`,
    ].filter(Boolean);

    const spatialDetailLines = [
      compositionMap      && `Reference composition map: ${compositionMap}`,
      objects             && `Objects/elements present: ${objects}`,
      objectPositions     && `Object positions and placement: ${objectPositions}`,
      focalPoint          && `Focal point / main subject: ${focalPoint}`,
      foregroundBackground && `Foreground/background layering: ${foregroundBackground}`,
      negativeSpace       && `Negative/empty space: ${negativeSpace}`,
      compositionType     && `Composition type: ${compositionType}`,
    ].filter(Boolean);

    const additionalDirection = [
      "additional detailed visual direction:",
      "This prompt is derived from a reference image. The final image prompt must reproduce the reference image's SPATIAL COMPOSITION faithfully — same objects, same positions, same scale relationships, same layering — while adapting colours and style to the brand.",
      "The prompt must clearly address: which objects appear, where each object is placed in the frame, their relative sizes, foreground/background layering, the focal point, negative space regions, and composition type.",
      ...(spatialDetailLines.length > 0 ? [
        "",
        "REFERENCE IMAGE SPATIAL DETAILS (preserve these in the final prompt):",
        ...spatialDetailLines,
      ] : []),
      ...(detailLines.length > 0 ? [
        "",
        "BRAND VISUAL DETAILS (adapt style from these):",
        ...detailLines,
      ] : [
        "Refer to the raw image idea above for all visual specifics.",
      ]),
    ].join("\n");

    // ── Build avoid / negative prompt section ─────────────────────────────────
    const fallbackAvoidItems = [
      "blurry or low quality output",
      "distorted anatomy or proportions",
      "random text or misspelled text",
      "watermarks",
      "logos not provided by the brand",
      "overcrowded composition",
      "inconsistent brand colours",
      "generic stock photo look",
      "excessive filters or over-processing",
      "messy or distracting backgrounds",
      "unrelated objects or elements",
    ];

    const avoidSection = [
      "avoid / negative prompt requirements:",
      "The generated image prompt must explicitly instruct the image model to avoid all of the following:",
      ...[...extractedAvoid, ...fallbackAvoidItems].map((item) => `- ${item}`),
    ].join("\n");

    // ── Build userInput for the Nanobanana template ───────────────────────────
    // The template expects: Brand visual identity, post type, image text requirements, raw image idea
    const userInputParts = [
      "Brand visual identity:",
      detailLines.length > 0 ? detailLines.join("\n") : "See combined visual direction below.",
      "",
      "post type:",
      cvd.rawIdeaOrPostInformation
        ? (cvd.rawIdeaOrPostInformation.split("\n")[0] || "Instagram branded post")
        : "Instagram branded post",
      "",
      "image text requirements:",
      cvd.textRequirements || "No specific text requirements.",
      "",
      "raw image idea:",
      directionText,
      "",
      additionalDirection,
      "",
      concreteCompositionBlock,
      "",
      avoidSection,
    ];

    // ── Shared style/preset production section ─────────────────────────────────
    // Combined block: manual controls (1) > visual preset (2) > cinematic style (3).
    // Previously this route NEVER resolved the cinematic style and had no preset
    // support, so explicit selections were silently dropped from the prompt.
    const productionSection = buildProductionControlsSection({
      manualControlsBlock: visualControlsBlock, // already serialized above
      cinematicStyle: resolved.cinematicStyle,
      preset: resolved.preset,
    });
    if (productionSection) {
      userInputParts.push(
        "",
        productionSection,
        "",
        "These selections are intentional user constraints. Apply them as production/style direction only. They must NOT alter the reference image's required identity — objects, logos, products, people, artwork, colours, and text — nor the brand's preserved assets or structural composition. Where a selection conflicts with required reference or brand preservation, apply it in the closest compatible way (for example, a lighting or colour-treatment choice may shift mood and grade but must not redesign the product or replace brand assets). Never invent a different subject or asset.",
      );
    }

    // ── Preserve / Change instruction (the user's attractionNotes) ─────────────
    // This is the explicit "what to keep vs. what to change" the user authored
    // in the 6-step reference flow. It is REQUIRED to reach the final prompt.
    const attractionNotes = (cvd?.attractionNotes || "").toString().trim();
    if (attractionNotes) {
      userInputParts.push(
        "",
        "=== REFERENCE IMAGE — PRESERVE / CHANGE INSTRUCTIONS ===",
        attractionNotes,
        "",
        "Follow these preserve/change instructions precisely. Preserve every element the user marked as 'keep' or 'preserve' exactly (objects, logos, products, people, artwork, colours, text, and structural composition). Apply only the changes the user explicitly requested, and apply them in the closest compatible manner without altering anything else.",
      );
    }

    const userInput = userInputParts.join("\n");

    console.log("[NanobananaPrompt] userInput length:", userInput.length);

    // ── Call AI ───────────────────────────────────────────────────────────────
    let finalPrompt;
    try {
      const result = await generateWithPromptTemplate({
        templateSlug: "image-prompt-from-brand-and-post-without-reference",
        variables: {},
        userInput,
      });

      finalPrompt = typeof result.content === "string"
        ? result.content
        : JSON.stringify(result.content, null, 2);

      finalPrompt = stripRatioMentions(finalPrompt) + concreteCompositionBlock;

      console.log("[NanobananaPrompt] Generated prompt length:", finalPrompt.length);
    } catch (aiErr) {
      console.error("[NanobananaPrompt] AI error:", aiErr.message);
      return NextResponse.json({
        success: false,
        code: "PROMPT_BUILD_FAILED",
        error: "Prompt generation failed. Please try again.",
        details: aiErr.message,
      }, { status: 500 });
    }

    // ── Save to CombinedVisualDirection ───────────────────────────────────────
    await prisma.combinedVisualDirection.update({
      where: { id },
      data: { finalNanobananaPrompt: finalPrompt },
    });

    // ── Best-effort cleanup: keep only the latest 10 history rows for this
    // brand + sourceFlow. Never let a cleanup failure fail prompt generation.
    try {
      if (cvd.brandId && cvd.sourceFlow) {
        const old = await prisma.combinedVisualDirection.findMany({
          where: {
            brandId: cvd.brandId,
            sourceFlow: cvd.sourceFlow,
            finalNanobananaPrompt: { not: null },
          },
          orderBy: { createdAt: "desc" },
          skip: 10,
          select: { id: true },
        });
        if (old.length > 0) {
          await prisma.combinedVisualDirection.deleteMany({
            where: { id: { in: old.map((r) => r.id) } },
          });
          console.log(`[NanobananaPrompt] Trimmed ${old.length} old history row(s) for brandId=${cvd.brandId} sourceFlow=${cvd.sourceFlow}`);
        }
      }
    } catch (cleanupErr) {
      console.error("[NanobananaPrompt] History cleanup failed (non-fatal):", cleanupErr.message);
    }

    return NextResponse.json({
      success: true,
      finalNanobananaPrompt: finalPrompt,
      combinedVisualDirection: { id, finalNanobananaPrompt: finalPrompt },
    });

  } catch (err) {
    console.error("[NanobananaPrompt] Unhandled error:", err);
    return NextResponse.json({
      success: false,
      error: "Failed to create Nanobanana prompt. Please try again.",
      details: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
