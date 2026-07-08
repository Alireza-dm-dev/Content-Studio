/**
 * Brand Identity output is split into two top-level sections:
 *   - brandVisualIdentity        → everything about how the brand LOOKS
 *   - brandToneInformationAndData → everything about the brand's words, business, audience
 *
 * `normalizeBrandIdentityOutput` accepts a BrandIdentity record (old mixed-schema
 * or new split-schema `jsonOutput`) and always returns both sections in the new
 * shape, with every nested key present (never undefined, never throws).
 *
 * The compact summary helpers below take the *normalized* `brandVisualIdentity`
 * object only — image/video prompt generation must never see tone/business data
 * or the full raw JSON.
 */

// ─── Empty / default shapes ──────────────────────────────────────────────────

function emptyVisualIdentity() {
  return {
    summary: "",
    colors: {
      primaryColors: [],
      secondaryColors: [],
      accentColors: [],
      neutralColors: [],
      colorUsageRules: "",
    },
    typography: {
      fontStyle: "",
      headingStyle: "",
      bodyTextStyle: "",
      typographyUsageRules: "",
    },
    logoUsage: {
      logoDescription: "",
      placementRules: "",
      sizeRules: "",
      backgroundRules: "",
      avoidRules: "",
    },
    shapesAndGraphicElements: {
      commonShapes: "",
      iconStyle: "",
      illustrationStyle: "",
      patternStyle: "",
      graphicMotifs: "",
    },
    layoutAndComposition: {
      layoutStyle: "",
      spacingStyle: "",
      alignmentRules: "",
      compositionRules: "",
    },
    imageAndVideoStyle: {
      imageStyle: "",
      photoStyle: "",
      videoStyle: "",
      lightingMood: "",
      environmentStyle: "",
      preferredSubjects: "",
    },
    visualMood: "",
    visualDoRules: [],
    visualDontRules: [],
    strictImagePromptRules: [],
    imagePromptGuidance: "",
    videoPromptGuidance: "",
    toneRadar: {},
  };
}

function emptyToneInformation() {
  return {
    brandName: "",
    industry: "",
    servicesOrProducts: [],
    targetAudience: "",
    locationOrMarket: "",
    brandPersonality: [],
    toneOfVoice: [],
    contentStyle: "",
    businessGoals: [],
    keyMessages: [],
    offers: [],
    contactInformation: "",
    website: "",
    socialLinks: [],
    contentDoRules: [],
    contentDontRules: [],
    notes: "",
  };
}

// ─── Small coercion helpers (never throw, always return the expected type) ──

function toArr(val) {
  if (val == null) return [];
  if (Array.isArray(val)) {
    return val
      .map((v) => (typeof v === "string" ? v.trim() : toStr(v)))
      .filter((v) => v && v.trim());
  }
  if (typeof val === "string") return val.trim() ? [val.trim()] : [];
  const str = toStr(val);
  return str ? [str] : [];
}

function toStr(val) {
  if (val == null) return "";
  if (Array.isArray(val)) return val.filter(Boolean).map(toStr).join(", ");
  if (typeof val === "object") {
    // Some older extractions describe list entries as objects, e.g.
    // { name: "cyan", approx_hex: "#10CFE8", usage: "..." } — prefer a
    // human-readable label over dumping raw JSON into prompt summaries.
    const label = val.name ?? val.label ?? val.title ?? val.value ?? val.color ?? null;
    if (typeof label === "string" && label.trim()) return label.trim();
    try { return JSON.stringify(val); } catch { return ""; }
  }
  return String(val).trim();
}

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}){1,2}$/;

function toColorArr(val) {
  if (val == null) return [];
  const items = Array.isArray(val) ? val : [val];
  return items
    .map((v) => {
      if (typeof v === "string") {
        const trimmed = v.trim();
        if (!trimmed) return null;
        if (HEX_COLOR_RE.test(trimmed)) return trimmed;
        return trimmed;
      }
      if (typeof v === "object" && v !== null) {
        for (const k of ["approx_hex", "hex", "color", "value"]) {
          if (typeof v[k] === "string" && HEX_COLOR_RE.test(v[k].trim())) return v[k].trim();
        }
        const label = v.name ?? v.label ?? v.title ?? null;
        if (typeof label === "string" && label.trim()) return label.trim();
      }
      return null;
    })
    .filter(Boolean);
}

function truncate(str, max) {
  const s = toStr(str);
  if (!s) return "";
  return s.length <= max ? s : s.slice(0, max) + "...";
}

// ─── Merge partial sections onto the default shape (fills missing keys) ─────

function mergeVisualIdentity(partial) {
  const base = emptyVisualIdentity();
  if (!partial || typeof partial !== "object") return base;

  return {
    ...base,
    summary: toStr(partial.summary) || base.summary,
    colors: { ...base.colors, ...(partial.colors && typeof partial.colors === "object" ? {
      primaryColors: toColorArr(partial.colors.primaryColors),
      secondaryColors: toColorArr(partial.colors.secondaryColors),
      accentColors: toColorArr(partial.colors.accentColors),
      neutralColors: toColorArr(partial.colors.neutralColors),
      colorUsageRules: toStr(partial.colors.colorUsageRules),
    } : {}) },
    typography: { ...base.typography, ...(partial.typography && typeof partial.typography === "object" ? {
      fontStyle: toStr(partial.typography.fontStyle),
      headingStyle: toStr(partial.typography.headingStyle),
      bodyTextStyle: toStr(partial.typography.bodyTextStyle),
      typographyUsageRules: toStr(partial.typography.typographyUsageRules),
    } : {}) },
    logoUsage: { ...base.logoUsage, ...(partial.logoUsage && typeof partial.logoUsage === "object" ? {
      logoDescription: toStr(partial.logoUsage.logoDescription),
      placementRules: toStr(partial.logoUsage.placementRules),
      sizeRules: toStr(partial.logoUsage.sizeRules),
      backgroundRules: toStr(partial.logoUsage.backgroundRules),
      avoidRules: toStr(partial.logoUsage.avoidRules),
    } : {}) },
    shapesAndGraphicElements: { ...base.shapesAndGraphicElements, ...(partial.shapesAndGraphicElements && typeof partial.shapesAndGraphicElements === "object" ? {
      commonShapes: toStr(partial.shapesAndGraphicElements.commonShapes),
      iconStyle: toStr(partial.shapesAndGraphicElements.iconStyle),
      illustrationStyle: toStr(partial.shapesAndGraphicElements.illustrationStyle),
      patternStyle: toStr(partial.shapesAndGraphicElements.patternStyle),
      graphicMotifs: toStr(partial.shapesAndGraphicElements.graphicMotifs),
    } : {}) },
    layoutAndComposition: { ...base.layoutAndComposition, ...(partial.layoutAndComposition && typeof partial.layoutAndComposition === "object" ? {
      layoutStyle: toStr(partial.layoutAndComposition.layoutStyle),
      spacingStyle: toStr(partial.layoutAndComposition.spacingStyle),
      alignmentRules: toStr(partial.layoutAndComposition.alignmentRules),
      compositionRules: toStr(partial.layoutAndComposition.compositionRules),
    } : {}) },
    imageAndVideoStyle: { ...base.imageAndVideoStyle, ...(partial.imageAndVideoStyle && typeof partial.imageAndVideoStyle === "object" ? {
      imageStyle: toStr(partial.imageAndVideoStyle.imageStyle),
      photoStyle: toStr(partial.imageAndVideoStyle.photoStyle),
      videoStyle: toStr(partial.imageAndVideoStyle.videoStyle),
      lightingMood: toStr(partial.imageAndVideoStyle.lightingMood),
      environmentStyle: toStr(partial.imageAndVideoStyle.environmentStyle),
      preferredSubjects: toStr(partial.imageAndVideoStyle.preferredSubjects),
    } : {}) },
    visualMood: toStr(partial.visualMood),
    visualDoRules: toArr(partial.visualDoRules),
    visualDontRules: toArr(partial.visualDontRules),
    strictImagePromptRules: toArr(partial.strictImagePromptRules),
    imagePromptGuidance: toStr(partial.imagePromptGuidance),
    videoPromptGuidance: toStr(partial.videoPromptGuidance),
    toneRadar: (partial.toneRadar && typeof partial.toneRadar === "object" && !Array.isArray(partial.toneRadar))
      ? { ...partial.toneRadar }
      : {},
  };
}

function mergeToneInformation(partial) {
  const base = emptyToneInformation();
  if (!partial || typeof partial !== "object") return base;

  return {
    brandName: toStr(partial.brandName),
    industry: toStr(partial.industry),
    servicesOrProducts: toArr(partial.servicesOrProducts),
    targetAudience: toStr(partial.targetAudience),
    locationOrMarket: toStr(partial.locationOrMarket),
    brandPersonality: toArr(partial.brandPersonality),
    toneOfVoice: toArr(partial.toneOfVoice),
    contentStyle: toStr(partial.contentStyle),
    businessGoals: toArr(partial.businessGoals),
    keyMessages: toArr(partial.keyMessages),
    offers: toArr(partial.offers),
    contactInformation: toStr(partial.contactInformation),
    website: toStr(partial.website),
    socialLinks: toArr(partial.socialLinks),
    contentDoRules: toArr(partial.contentDoRules),
    contentDontRules: toArr(partial.contentDontRules),
    notes: toStr(partial.notes),
  };
}

// ─── Legacy (pre-split) schema → new split schema ────────────────────────────
// Maps the old mixed `brand_overview / color_palette / visual_style / ...`
// shape (as produced by the previous brand-visual-identity-extractor template)
// into the new { brandVisualIdentity, brandToneInformationAndData } shape.

function mapLegacyBrandIdentity(parsed) {
  const ov          = parsed.brand_overview          ?? parsed.brandOverview          ?? {};
  const logo        = parsed.logo_identity           ?? parsed.logoIdentity           ?? {};
  const colors      = parsed.color_palette           ?? parsed.colorPalette           ?? {};
  const typography  = parsed.typography              ?? {};
  const visual      = parsed.visual_style            ?? parsed.visualStyle            ?? {};
  const imagery     = parsed.imagery_direction       ?? parsed.imageryDirection       ?? {};
  const content     = parsed.content_style           ?? parsed.contentStyle           ?? {};
  const dosDonts    = parsed.design_dos_and_donts    ?? parsed.designDosAndDonts      ?? {};
  const aiGuidance  = parsed.ai_generation_guidelines ?? parsed.aiGenerationGuidelines ?? {};

  const brandVisualIdentity = mergeVisualIdentity({
    summary: aiGuidance.prompt_style_summary || visual.overall_style || "",
    colors: {
      primaryColors: toArr(colors.primary_colors),
      secondaryColors: toArr(colors.secondary_colors),
      accentColors: toArr(colors.accent_colors),
      neutralColors: [...toArr(colors.background_colors), ...toArr(colors.text_colors)],
      colorUsageRules: toStr(colors.color_usage_notes),
    },
    typography: {
      fontStyle: toStr(typography.font_style),
      headingStyle: toStr(typography.heading_style),
      bodyTextStyle: toStr(typography.body_text_style),
      typographyUsageRules: [typography.font_weight_patterns, typography.capitalization_style, typography.readability_notes]
        .filter(Boolean).join(" "),
    },
    logoUsage: {
      logoDescription: toStr(logo.logo_description),
      placementRules: toStr(logo.logo_usage_style),
      sizeRules: "",
      backgroundRules: "",
      avoidRules: "",
    },
    shapesAndGraphicElements: {
      commonShapes: "",
      iconStyle: toStr(visual.graphic_elements),
      illustrationStyle: "",
      patternStyle: toStr(visual.texture_or_background_patterns),
      graphicMotifs: "",
    },
    layoutAndComposition: {
      layoutStyle: toStr(visual.layout_style),
      spacingStyle: toStr(visual.spacing_style),
      alignmentRules: "",
      compositionRules: toStr(visual.composition_patterns),
    },
    imageAndVideoStyle: {
      imageStyle: toStr(imagery.image_editing_style),
      photoStyle: toStr(imagery.photo_style),
      videoStyle: "",
      lightingMood: toStr(imagery.lighting_style),
      environmentStyle: toStr(imagery.environment_style),
      preferredSubjects: [imagery.people_style, imagery.product_or_service_visuals].filter(Boolean).join(", "),
    },
    visualMood: toStr(visual.design_mood),
    visualDoRules: toArr(dosDonts.dos),
    visualDontRules: toArr(dosDonts.donts),
    imagePromptGuidance: toStr(aiGuidance.prompt_style_summary),
    videoPromptGuidance: "",
  });

  const brandToneInformationAndData = mergeToneInformation({
    brandName: toStr(ov.business_name),
    industry: toStr(ov.industry),
    servicesOrProducts: toArr(ov.main_services_or_products),
    targetAudience: toStr(ov.target_audience),
    locationOrMarket: "",
    brandPersonality: toArr(ov.brand_personality),
    toneOfVoice: toArr(ov.tone_of_voice),
    contentStyle: toStr(content.headline_style || content.caption_style),
    businessGoals: [],
    keyMessages: toArr(content.message_themes),
    offers: [],
    contactInformation: "",
    website: "",
    socialLinks: [],
    contentDoRules: toArr(content.cta_language),
    contentDontRules: [],
    notes: toStr(ov.brand_positioning),
  });

  return { brandVisualIdentity, brandToneInformationAndData };
}

// ─── Public: normalize any BrandIdentity record into the split shape ─────────

/**
 * Always returns `{ brandVisualIdentity, brandToneInformationAndData, rawOriginal }`
 * with every nested field present — never throws, never returns undefined fields.
 * Supports both the new split-schema `jsonOutput` and the legacy mixed schema.
 */
export function normalizeBrandIdentityOutput(brandIdentity) {
  if (!brandIdentity) {
    return {
      brandVisualIdentity: emptyVisualIdentity(),
      brandToneInformationAndData: emptyToneInformation(),
      rawOriginal: null,
    };
  }

  const raw = brandIdentity.jsonOutput?.trim();
  let parsed = null;
  if (raw) {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      brandVisualIdentity: emptyVisualIdentity(),
      brandToneInformationAndData: emptyToneInformation(),
      rawOriginal: parsed,
    };
  }

  // Some older extractions wrap the legacy mixed structure in a
  // "brand_identity_analysis" envelope — unwrap it before mapping.
  const unwrapped = (parsed.brand_identity_analysis && typeof parsed.brand_identity_analysis === "object")
    ? parsed.brand_identity_analysis
    : parsed;

  const visualSection = unwrapped.brandVisualIdentity ?? unwrapped.brand_visual_identity;
  const toneSection   = unwrapped.brandToneInformationAndData ?? unwrapped.brand_tone_information_and_data;

  if (visualSection || toneSection) {
    return {
      brandVisualIdentity: mergeVisualIdentity(visualSection),
      brandToneInformationAndData: mergeToneInformation(toneSection),
      rawOriginal: parsed,
    };
  }

  return {
    ...mapLegacyBrandIdentity(unwrapped),
    rawOriginal: parsed,
  };
}

// ─── Compact visual-only summaries for prompt generation ────────────────────
// Both take the *normalized* `brandVisualIdentity` object only (never the full
// identity, never tone/business data) — they must stay short and concrete.

function listOrNull(label, arr, max = 6) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return `${label}: ${arr.slice(0, max).join(", ")}`;
}

/**
 * Compact visual-identity summary for IMAGE prompt generation (e.g. Nanobanana).
 * Mentions only: color palette, typography, shapes/graphics, layout/composition,
 * logo usage, image style, visual mood, and do/don't rules.
 */
export function createCompactBrandVisualIdentitySummaryForImagePrompt(brandVisualIdentity) {
  const v = brandVisualIdentity ?? emptyVisualIdentity();
  const lines = [];

  // Strict, user-confirmed hard constraints (e.g. exact HEX codes, logo bans,
  // single-solid-background rules, exact text/typography specs). These are
  // never sliced/truncated like the general do/don't rules below, and are
  // placed first so they survive the overall length cap further down.
  const strictRules = Array.isArray(v.strictImagePromptRules)
    ? v.strictImagePromptRules.filter((r) => typeof r === "string" && r.trim())
    : [];
  if (strictRules.length) {
    lines.push(
      ["Strict image prompt rules:", ...strictRules.map((r) => `- ${r}`), "These override general visual style guidance"].join("\n")
    );
  }

  const colorParts = [
    listOrNull("Primary", v.colors.primaryColors),
    listOrNull("Secondary", v.colors.secondaryColors),
    listOrNull("Accent", v.colors.accentColors),
    listOrNull("Neutral", v.colors.neutralColors),
  ].filter(Boolean);
  if (colorParts.length) lines.push(`Color palette — ${colorParts.join("; ")}`);
  if (v.colors.colorUsageRules) lines.push(`Color usage: ${truncate(v.colors.colorUsageRules, 140)}`);

  const typographyParts = [v.typography.fontStyle, v.typography.headingStyle, v.typography.bodyTextStyle].filter(Boolean);
  if (typographyParts.length) lines.push(`Typography: ${typographyParts.join(", ")}`);

  const shapeParts = [v.shapesAndGraphicElements.commonShapes, v.shapesAndGraphicElements.iconStyle, v.shapesAndGraphicElements.illustrationStyle, v.shapesAndGraphicElements.patternStyle].filter(Boolean);
  if (shapeParts.length) lines.push(`Shapes & graphics: ${shapeParts.join(", ")}`);

  const layoutParts = [v.layoutAndComposition.layoutStyle, v.layoutAndComposition.spacingStyle, v.layoutAndComposition.compositionRules].filter(Boolean);
  if (layoutParts.length) lines.push(`Layout & composition: ${layoutParts.join(", ")}`);

  const logoParts = [v.logoUsage.logoDescription, v.logoUsage.placementRules, v.logoUsage.avoidRules].filter(Boolean);
  if (logoParts.length) lines.push(`Logo usage: ${logoParts.join(" — ")}`);

  const imageStyleParts = [v.imageAndVideoStyle.imageStyle, v.imageAndVideoStyle.photoStyle, v.imageAndVideoStyle.lightingMood, v.imageAndVideoStyle.environmentStyle].filter(Boolean);
  if (imageStyleParts.length) lines.push(`Image style: ${imageStyleParts.join(", ")}`);

  if (v.visualMood) lines.push(`Visual mood: ${truncate(v.visualMood, 140)}`);

  if (v.imagePromptGuidance) lines.push(`Image prompt guidance: ${truncate(v.imagePromptGuidance, 160)}`);

  if (v.visualDoRules.length) lines.push(`Do: ${v.visualDoRules.slice(0, 5).join("; ")}`);
  if (v.visualDontRules.length) lines.push(`Don't: ${v.visualDontRules.slice(0, 5).join("; ")}`);

  if (lines.length === 0 && v.summary) lines.push(v.summary);
  if (lines.length === 0) return "No visual identity details available.";

  const text = lines.join(". ");
  return text.length <= 900 ? text : text.slice(0, 900) + "...";
}

/**
 * Compact visual-identity summary for VIDEO prompt / storyboard generation.
 * Mentions only: color palette, visual mood, image/video style, environment
 * style, logo usage rules, graphic elements, and do/don't rules.
 */
export function createCompactBrandVisualIdentitySummaryForVideoPrompt(brandVisualIdentity) {
  const v = brandVisualIdentity ?? emptyVisualIdentity();
  const lines = [];

  const colorParts = [
    listOrNull("Primary", v.colors.primaryColors),
    listOrNull("Secondary", v.colors.secondaryColors),
    listOrNull("Accent", v.colors.accentColors),
  ].filter(Boolean);
  if (colorParts.length) lines.push(`Color palette — ${colorParts.join("; ")}`);

  if (v.visualMood) lines.push(`Visual mood: ${truncate(v.visualMood, 140)}`);

  const styleParts = [v.imageAndVideoStyle.imageStyle, v.imageAndVideoStyle.videoStyle, v.imageAndVideoStyle.photoStyle].filter(Boolean);
  if (styleParts.length) lines.push(`Image & video style: ${styleParts.join(", ")}`);

  if (v.imageAndVideoStyle.lightingMood) lines.push(`Lighting & mood: ${v.imageAndVideoStyle.lightingMood}`);
  if (v.imageAndVideoStyle.environmentStyle) lines.push(`Environment: ${v.imageAndVideoStyle.environmentStyle}`);
  if (v.imageAndVideoStyle.preferredSubjects) lines.push(`Preferred subjects: ${v.imageAndVideoStyle.preferredSubjects}`);

  const logoParts = [v.logoUsage.logoDescription, v.logoUsage.placementRules, v.logoUsage.avoidRules].filter(Boolean);
  if (logoParts.length) lines.push(`Logo usage: ${logoParts.join(" — ")}`);

  const graphicParts = [v.shapesAndGraphicElements.commonShapes, v.shapesAndGraphicElements.iconStyle, v.shapesAndGraphicElements.graphicMotifs, v.shapesAndGraphicElements.patternStyle].filter(Boolean);
  if (graphicParts.length) lines.push(`Graphic elements: ${graphicParts.join(", ")}`);

  if (v.videoPromptGuidance) lines.push(`Video guidance: ${truncate(v.videoPromptGuidance, 160)}`);

  if (v.visualDoRules.length) lines.push(`Do: ${v.visualDoRules.slice(0, 5).join("; ")}`);
  if (v.visualDontRules.length) lines.push(`Don't: ${v.visualDontRules.slice(0, 5).join("; ")}`);

  if (lines.length === 0 && v.summary) lines.push(v.summary);
  if (lines.length === 0) return "No visual identity details available.";

  const text = lines.join(". ");
  return text.length <= 1200 ? text : text.slice(0, 1200) + "...";
}
