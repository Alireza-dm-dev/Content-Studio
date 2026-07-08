import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateWithPromptTemplate } from "@/lib/ai";
import {
  validateOutputImageTextRequirements,
  buildFallbackOutputImageTextRequirements,
  normalizeOutputImageTextRequirementsStructured,
  formatOutputImageTextRequirementsForDisplay,
} from "@/lib/calendar-post-utils";
import { normalizeBrandIdentityOutput, createCompactBrandVisualIdentitySummaryForImagePrompt } from "@/lib/brand-identity-utils";

// ─── JSON output parser ────────────────────────────────────────────────────────
// Handles: direct JSON, markdown-fenced JSON, JSON embedded in surrounding text.

function parseAiJsonOutput(raw) {
  if (!raw || !raw.trim()) {
    throw new Error("AI returned an empty response. Please try again.");
  }

  let text = raw.trim();

  // 1. Direct parse
  try { return JSON.parse(text); } catch {}

  // 2. Strip markdown fences (```json … ``` or ``` … ```)
  text = text
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```\s*$/im, "")
    .trim();
  try { return JSON.parse(text); } catch {}

  // 3. Extract first { … } block
  const objStart = text.indexOf("{");
  const objEnd   = text.lastIndexOf("}");
  if (objStart !== -1 && objEnd > objStart) {
    try { return JSON.parse(text.slice(objStart, objEnd + 1)); } catch {}
  }

  // 4. Extract first [ … ] block (bare array)
  const arrStart = text.indexOf("[");
  const arrEnd   = text.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd > arrStart) {
    try { return JSON.parse(text.slice(arrStart, arrEnd + 1)); } catch {}
  }

  console.error("[ContentCalendar] Could not parse AI output:", text.slice(0, 500));
  throw new Error(
    "Could not parse the AI response as JSON. The model may have returned text instead of JSON. Try again or reduce the number of posts."
  );
}

// ─── Post normaliser ───────────────────────────────────────────────────────────
// Maps AI output (any field naming convention) → unified camelCase shape used
// across the UI and saved to postData.

function normalisePost(p, idx, defaultPlatform) {
  const get = (...keys) => {
    for (const k of keys) {
      if (p[k] !== undefined && p[k] !== null && p[k] !== "") return String(p[k]);
      const norm = k.toLowerCase().replace(/[_\s-]/g, "");
      for (const pk of Object.keys(p)) {
        if (pk.toLowerCase().replace(/[_\s-]/g, "") === norm) {
          const v = p[pk];
          if (v !== undefined && v !== null && v !== "") return String(v);
        }
      }
    }
    return "";
  };

  // Like `get`, but returns the raw value (object/array/string) without
  // stringifying — needed for outputImageTextRequirementsStructured, which the
  // AI returns as a nested object, not a string.
  const getRaw = (...keys) => {
    for (const k of keys) {
      if (p[k] !== undefined && p[k] !== null && p[k] !== "") return p[k];
      const norm = k.toLowerCase().replace(/[_\s-]/g, "");
      for (const pk of Object.keys(p)) {
        if (pk.toLowerCase().replace(/[_\s-]/g, "") === norm) {
          const v = p[pk];
          if (v !== undefined && v !== null && v !== "") return v;
        }
      }
    }
    return null;
  };

  const hashtags = (() => {
    const v = p.hashtags ?? p.Hashtags ?? p.tags ?? p.Tags ?? "";
    if (Array.isArray(v)) return v;
    if (typeof v === "string" && v.trim()) {
      try { const a = JSON.parse(v); if (Array.isArray(a)) return a; } catch {}
      return v.split(/[\s,]+/).filter(Boolean);
    }
    return [];
  })();

  const caption = (() => {
    const c = get("caption", "suggestedCaption", "suggested_caption", "captionText", "copy", "text");
    const cta = get("cta", "CTA", "callToAction", "call_to_action");
    if (c && cta && !c.includes(cta)) return `${c}\n\n${cta}`;
    return c || cta;
  })();

  // The AI returns the structured object (preferred — see the generation rules
  // below); normalize whatever shape it actually came back as, then derive the
  // clean display string from it deterministically (single source of truth —
  // never asked from the AI redundantly, which would risk the two diverging).
  const outputImageTextRequirementsStructured = normalizeOutputImageTextRequirementsStructured(
    getRaw(
      "outputImageTextRequirementsStructured", "output_image_text_requirements_structured",
      "outputImageTextRequirements", "output_image_text_requirements",
      "outputImageText", "output_image_text"
    )
  );
  const outputImageTextRequirements = formatOutputImageTextRequirementsForDisplay(outputImageTextRequirementsStructured) || "";

  return {
    postNumber: Number(get("postNumber", "post_number", "number")) || idx + 1,
    date:       get("date", "scheduledDate", "scheduled_date", "publish_date"),
    platform:   get("platform") || defaultPlatform || "",
    format:     get("format", "contentType", "content_type", "postFormat"),

    mainAngle:   get("mainAngle",   "main_angle",   "contentPillar", "content_pillar", "angle"),
    coreMessage: get("coreMessage", "core_message", "mainAngleAndCoreMessage", "core_idea", "message"),
    hookTitle:   get("hookTitle",   "hook_title",   "suggestedHook", "suggested_hook", "hook", "headline", "title", "topic"),
    caption,
    hashtags,

    contentStructure: get("contentStructure", "content_structure", "structure_detail"),
    visualDirection:  get("visualDirection",  "visual_direction"),
    imageText:        get("imageText", "image_text", "designNotes", "design_notes"),
    outputImageTextRequirements,
    outputImageTextRequirementsStructured,
    structure:        get("structure"),
    inspiration:      get("inspiration", "inspirationSource", "inspiration_source"),

    videoConceptTitleAndThumbnailTitleIdea: get("videoConceptTitleAndThumbnailTitleIdea", "video_concept_title_and_thumbnail_title_idea", "videoConceptTitle"),
    videoRawIdea:           get("videoRawIdea",           "video_raw_idea"),
    mainIntegratedScenario: get("mainIntegratedScenario",  "main_integrated_scenario"),
    thumbnailIdeaForReel:   get("thumbnailIdeaForReel",    "thumbnail_idea_for_reel"),

    narrationOrDialogueOfCharacterOrCharacters: get("narrationOrDialogueOfCharacterOrCharacters", "narration_or_dialogue_of_character_or_characters"),
    rawImageIdeaForFirstFrame: get("rawImageIdeaForFirstFrame", "raw_image_idea_for_first_frame"),
    whatHappens:               get("whatHappens",               "what_happens"),
    characterObjectOrEnvironmentAction: get("characterObjectOrEnvironmentAction", "character_object_or_environment_action"),
    cameraMovement: get("cameraMovement", "camera_movement"),
    speedRamp:      get("speedRamp",      "speed_ramp") || "Auto",
    camera:         get("camera") || "Auto",
    lens:           get("lens") || "Auto",
    focalLength:    get("focalLength",    "focal_length") || "50",
    aperture:       get("aperture") || "f/4 moderate",
    visualMood:     get("visualMood",     "visual_mood"),
    textOnVideo:    get("textOnVideo",    "text_on_video"),

    status:        get("status") || "Draft",
    contentOrigin: get("contentOrigin", "content_origin") || "original",
    referenceLink: get("referenceLink", "reference_link", "link", "url"),
  };
}

// ─── Fallback date/time assignment ─────────────────────────────────────────────
// When publishingFrequency is empty and the AI didn't assign a date to a post,
// distribute a date across the selected calendar period — using any chosen
// seasonal/event dates as preferred anchors where they fall inside that period —
// and attach a default practical time of day. Posts that already have a date,
// or requests where publishingFrequency is set, are returned unchanged.

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_FALLBACK_TIME = "10:00";

// Parses "YYYY-MM-DD" (calendar period inputs) or "Month DD, YYYY" (seasonal
// dates) into a UTC midnight Date, or null if unparseable.
function parseToUtcDate(value) {
  const str = (value ?? "").toString().trim();
  if (!str) return null;

  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return new Date(Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3])));
  }

  const parsed = new Date(str);
  if (isNaN(parsed.getTime())) return null;
  return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
}

function formatFallbackDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d} ${DEFAULT_FALLBACK_TIME}`;
}

function applyFallbackDates(posts, { calendarPeriodStart, calendarPeriodEnd, publishingFrequency, seasonalDates = [] }) {
  // User-entered publishing frequency has priority — leave dates as the AI returned them.
  if ((publishingFrequency ?? "").trim()) return posts;

  const start = parseToUtcDate(calendarPeriodStart);
  const end = parseToUtcDate(calendarPeriodEnd);
  if (!start || !end || end < start) return posts;

  const missingCount = posts.filter(p => !p.date).length;
  if (missingCount === 0) return posts;

  const totalDays = Math.floor((end - start) / MS_PER_DAY) + 1;

  const anchors = seasonalDates
    .map(d => parseToUtcDate(d?.date))
    .filter(d => d && d >= start && d <= end)
    .sort((a, b) => a - b);

  let anchorIdx = 0;
  let missingIdx = 0;

  return posts.map(p => {
    if (p.date) return p; // AI-provided date preserved as-is

    const target = anchorIdx < anchors.length
      ? anchors[anchorIdx++]
      : new Date(start.getTime() + Math.min(totalDays - 1, Math.floor((missingIdx * totalDays) / missingCount)) * MS_PER_DAY);

    missingIdx++;
    return { ...p, date: formatFallbackDate(target) };
  });
}

// ─── Brand identity helpers ────────────────────────────────────────────────────
// The calendar generator needs BOTH visual identity (for visual direction fields)
// and tone/brand data (for hooks, captions, angles) — so unlike the image/video
// prompt flows (visual-only), build a balanced summary covering both sections.

function createCompactToneInformationSummary(tone) {
  return [
    tone.brandName               && `Brand name: ${tone.brandName}`,
    tone.industry                && `Industry: ${tone.industry}`,
    tone.servicesOrProducts.length && `Services/products: ${tone.servicesOrProducts.join(", ")}`,
    tone.targetAudience          && `Target audience: ${tone.targetAudience}`,
    tone.locationOrMarket        && `Location/market: ${tone.locationOrMarket}`,
    tone.brandPersonality.length && `Brand personality: ${tone.brandPersonality.join(", ")}`,
    tone.toneOfVoice.length      && `Tone of voice: ${tone.toneOfVoice.join(", ")}`,
    tone.contentStyle            && `Content style: ${tone.contentStyle}`,
    tone.businessGoals.length    && `Business goals: ${tone.businessGoals.join(", ")}`,
    tone.keyMessages.length      && `Key messages: ${tone.keyMessages.join(", ")}`,
    tone.offers.length           && `Offers: ${tone.offers.join(", ")}`,
    tone.contentDoRules.length   && `Content do's: ${tone.contentDoRules.join("; ")}`,
    tone.contentDontRules.length && `Content don'ts: ${tone.contentDontRules.join("; ")}`,
  ].filter(Boolean).join("\n");
}

function buildIdentitySummary(identity, brand) {
  if (!identity) {
    return [
      brand.name          && `Brand: ${brand.name}`,
      brand.businessType  && `Type: ${brand.businessType}`,
      brand.brandTone     && `Tone: ${brand.brandTone}`,
      brand.targetAudience && `Audience: ${brand.targetAudience}`,
      brand.mainServicesOrProducts && `Services: ${brand.mainServicesOrProducts}`,
      brand.brandVisualStyle && `Visual style: ${brand.brandVisualStyle}`,
    ].filter(Boolean).join(". ");
  }

  const { brandVisualIdentity, brandToneInformationAndData } = normalizeBrandIdentityOutput(identity);
  const visualSummary = createCompactBrandVisualIdentitySummaryForImagePrompt(brandVisualIdentity);
  const toneSummary = createCompactToneInformationSummary(brandToneInformationAndData);

  return [
    "--- Visual Identity ---",
    visualSummary || "(not extracted)",
    "",
    "--- Tone & Brand Data ---",
    toneSummary || "(not extracted)",
  ].join("\n");
}

// ─── Deep-search for post-like arrays ─────────────────────────────────────────

function isPostLike(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const keys = Object.keys(item).map(k => k.toLowerCase());
  return keys.some(k =>
    k.includes("hook") || k.includes("caption") || k.includes("post") ||
    k.includes("content") || k.includes("format") || k.includes("platform") ||
    k.includes("date") || k.includes("visual") || k.includes("message") ||
    k.includes("topic") || k.includes("title") || k.includes("number")
  );
}

function deepFindPostArrays(obj, path = "", results = []) {
  if (Array.isArray(obj)) {
    if (obj.length > 0 && isPostLike(obj[0])) results.push({ path, arr: obj });
  } else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      deepFindPostArrays(v, path ? `${path}.${k}` : k, results);
    }
  }
  return results;
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request) {
  console.log("[ContentCalendar] POST /api/content-calendar/generate");

  try {
    // ── 1. Parse request body ────────────────────────────────────────────────
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return NextResponse.json(
        { success: false, error: "Invalid request body.", details: e.message },
        { status: 400 }
      );
    }

    console.log("[ContentCalendar] brandId:", body.brandId, "| posts requested:", body.numberOfPostsNeeded);

    const { brandId, selectedPosts = [], calendarPeriodStart, calendarPeriodEnd, chosenSeasonalDates = [], ...formFields } = body;

    if (!brandId) {
      return NextResponse.json(
        { success: false, error: "brandId is required." },
        { status: 400 }
      );
    }

    // ── 2. Load brand + identity ─────────────────────────────────────────────
    const [brand, identity] = await Promise.all([
      prisma.brand.findUnique({ where: { id: brandId } }),
      prisma.brandIdentity.findFirst({ where: { brandId }, orderBy: { createdAt: "desc" } }),
    ]);

    if (!brand) {
      return NextResponse.json(
        { success: false, error: "Brand not found." },
        { status: 404 }
      );
    }

    // ── 3. Derive safe post count ────────────────────────────────────────────
    const rawCount = parseInt(String(formFields.numberOfPostsNeeded ?? 12), 10);
    const safeCount = isNaN(rawCount) || rawCount < 1 ? 12 : Math.min(rawCount, 60);

    // ── 4. Build context strings ─────────────────────────────────────────────
    const identitySummary = buildIdentitySummary(identity, brand);

    const selectedPostIdeasText = selectedPosts.length > 0
      ? selectedPosts.map((p, i) =>
          `${i + 1}. Hook: "${p.suggestedHook ?? ""}"` +
          (p.mainAngleAndCoreMessage ? ` | Core: "${p.mainAngleAndCoreMessage}"` : "") +
          (p.platform ? ` | Platform: ${p.platform}` : "") +
          (p.format ? ` | Format: ${p.format}` : "")
        ).join("\n")
      : "None provided.";

    // ── 5. Template variables ({{placeholder}} syntax) ───────────────────────
    const variables = {
      brandName:              brand.name,
      brandTone:              brand.brandTone              ?? "",
      targetAudience:         brand.targetAudience         ?? "",
      mainServicesOrProducts: brand.mainServicesOrProducts ?? "",
      brandVisualStyle:       brand.brandVisualStyle       ?? "",
      brandIdentitySummary:   identitySummary,
      selectedPostIdeas:      selectedPostIdeasText,
      mainMonthlySubject:     formFields.mainMonthlySubject     ?? "",
      mainLandingPageOrServicePage: formFields.mainLandingPageOrServicePage ?? "",
      mainGoal:               formFields.mainGoal               ?? "",
      mainOfferOrMessage:     formFields.mainOfferOrMessage     ?? "",
      importantDetailsToInclude: formFields.importantDetailsToInclude ?? "",
      detailsNotToInvent:     formFields.detailsNotToInvent     ?? "",
      sourceMaterial:         formFields.sourceMaterial         ?? "",
      priorityContentIdeas:   formFields.priorityContentIdeas   ?? "",
      platforms:              formFields.platforms              ?? "",
      numberOfPostsNeeded:    String(safeCount),
      publishingFrequency:    formFields.publishingFrequency    ?? "",
      requiredPostFormats:    formFields.requiredPostFormats     ?? "",
      videoCreationTool:      formFields.videoCreationTool      ?? "",
      videoProductionLimitation: formFields.videoProductionLimitation ?? "",
      contentStrategyRules:   formFields.contentStrategyRules   ?? "",
      audienceLanguageRules:  formFields.audienceLanguageRules  ?? "",
      writingStyleRules:      formFields.writingStyleRules      ?? "",
    };

    // ── 6. Build userInput block ─────────────────────────────────────────────
    const row = (label, value) => value ? `${label}: ${value}` : null;

    const userInput = [
      "IMPORTANT: Use the campaign details below as the primary source.",
      "Proceed directly to generating the calendar. Do not report conflicts.",
      "",
      "=== BRAND INFORMATION ===",
      row("Brand Name",        brand.name),
      row("Business Type",     brand.businessType),
      row("Location",          brand.businessLocation),
      row("Website",           brand.website),
      row("Instagram",         brand.instagramPage),
      row("Brand Tone",        brand.brandTone),
      row("Target Audience",   brand.targetAudience),
      row("Services/Products", brand.mainServicesOrProducts),
      row("Visual Style",      brand.brandVisualStyle),
      "",
      "=== BRAND IDENTITY ===",
      identitySummary || "Not extracted yet.",
      "",
      "=== SELECTED POST IDEAS (use as inspiration) ===",
      selectedPostIdeasText,
      "",
      "=== CAMPAIGN & CALENDAR DETAILS ===",
      row("Monthly Subject",             formFields.mainMonthlySubject),
      row("Landing / Service Page",      formFields.mainLandingPageOrServicePage),
      row("Main Goal",                   formFields.mainGoal),
      row("Offer / Key Message",         formFields.mainOfferOrMessage),
      row("Important Details",           formFields.importantDetailsToInclude),
      row("Do NOT Invent",               formFields.detailsNotToInvent),
      row("Source Material",             formFields.sourceMaterial),
      row("Priority Content Ideas",      formFields.priorityContentIdeas),
      "",
      "=== POSTING SCHEDULE ===",
      row("Platforms",                   formFields.platforms),
      row("Number of Posts",             String(safeCount)),
      row("Publishing Frequency",        formFields.publishingFrequency),
      row("Required Formats",            formFields.requiredPostFormats),
      row("Video Creation Tool",         formFields.videoCreationTool),
      row("Video Production Limits",     formFields.videoProductionLimitation),
      "",
      "=== CONTENT RULES ===",
      row("Content Strategy Rules",      formFields.contentStrategyRules),
      row("Audience Language Rules",     formFields.audienceLanguageRules),
      row("Writing Style Rules",         formFields.writingStyleRules),
      "",
      // ── Output Image Text Requirements: dedicated rules section ─────────────
      // These rules appear BEFORE the JSON schema so the AI has context when
      // filling in outputImageTextRequirementsStructured. It is a STRATEGIC
      // field — the exact on-image text plan — derived from the other fields,
      // never generated in isolation or copied from the caption.
      "=== OUTPUT IMAGE TEXT REQUIREMENTS GENERATION RULES ===",
      "`outputImageTextRequirementsStructured` describes the EXACT TEXT that should appear INSIDE the image or carousel slides — the on-image text plan, not the caption and not the visual direction.",
      "It MUST be derived from the other fields, in this priority order:",
      "  1. Format — determines the shape (static/video → one item; carousel → one slide per Content Structure entry)",
      "  2. Hook / Title — the main_headline must be a sharper, more specific distillation of hookTitle that surfaces the post's strongest single claim. hookTitle is raw material to refine, not a line to copy verbatim. If the hook is a question, convert it to a specific answer, numbered promise, or benefit. If it is generic, pull a concrete detail from Content Structure or the caption instead.",
      "  3. Main Angle and Core Message — Image Text must accurately reflect the actual claim these fields make. Subheadlines and supporting text surface the specific 'why' — the concrete benefit, step, number, or proof point — not a vague restatement.",
      "  4. Content Structure — drives the slide-by-slide breakdown for carousels; each slide's own topic comes from its own structure entry",
      "  5. Visual Direction — informs each slide's text style (checklist → short list-style lines, comparison → compare/contrast phrasing, steps → numbered action phrasing)",
      "  6. Generate fitting, format-appropriate text from the above — never generic filler, never invented details",
      "",
      "Rules:",
      "1. Return a structured object: { type: 'static' | 'carousel' | 'video', items: [...] } for static/video, or { type: 'carousel', slides: [...] } for carousel.",
      "2. Every item/slide has a `fields` object using ONLY these 10 keys (omit any that don't apply): main_headline, subheadline, supporting_text, call_to_action, badge_or_label, offer_or_promotion, date_or_time, website_or_contact, logo_text, additional_text_notes.",
      "3. For Carousel, the number of generated slides MUST exactly match the Content Structure slide count — never fewer, never more, never skipped (a 6-slide structure needs Slide 1 through Slide 6 — not just Slide 1 and Slide 4).",
      "4. Slide numbers must be sequential starting at 1 (slideNumber: 1, 2, 3 ... N) with no gaps and no duplicates.",
      "5. Slide 1's main_headline is drawn from hookTitle — but sharpen or rephrase it into the strongest on-image claim rather than copying it verbatim. If hookTitle is a question, convert it to a specific answer or benefit. If it is generic, pull a concrete detail from contentStructure or the caption.",
      "6. Each middle slide must reflect its OWN topic from its OWN Content Structure entry — specific, not interchangeable with other slides. Every middle slide MUST include both main_headline AND at least one of supporting_text or subheadline — never return main_headline alone. The supporting_text or subheadline must surface a specific detail, benefit, step, stat, or concrete claim from that slide's Content Structure entry, not a vague restatement.",
      "7. The final slide should usually carry the call_to_action, pulled from the caption's actual CTA — never invented.",
      "8. Do not repeat the same headline (or near-identical phrasing) across multiple slides or items.",
      "9. Do not use the full caption as slide text — on-image text is short, punchy, and scannable; the caption is a separate field entirely.",
      "10. Do not invent offers, dates, contact info, or promotions that are not present in the brand identity, campaign details, or caption.",
      "11. Only include keys that hold useful, specific content for that slide/item — never fill a key with a generic placeholder like 'N/A' or a repeated label.",
      "12. Omit blank or empty keys entirely — never return a key with an empty string.",
      "",
      "=== AVOID GENERIC RESTATEMENT (CRITICAL) ===",
      "outputImageTextRequirementsStructured must contain the ACTUAL words a designer will place on the image — not a summary of the post's metadata.",
      "1. Do NOT simply copy Hook/Title into main_headline, Core Message into subheadline, and Main Angle into badge_or_label — pull out the SPECIFIC fact, step, number, benefit, mistake, quote, or detail that makes THIS post's image useful.",
      "2. badge_or_label must be a meaningful on-image label (a real step name, stat, category, or callout) — never a generic content-type tag like 'Educational Insight', 'Tip', or 'Did You Know', and never the raw Main Angle value, unless that exact phrase is genuinely meant to appear on the image.",
      "3. subheadline / supporting_text must add information BEYOND the headline — a concrete detail, step, number, benefit, or reason to care. Never a vaguer restatement of the headline or Core Message.",
      "4. Never use placeholder or filler text ('N/A', 'Coming soon', 'More info inside', 'Educational Insight', etc.) as a stand-in for real content.",
      "5. Educational / how-it-works / process / consultation posts: pull the ACTUAL steps, stages, checklist items, mistakes, or takeaways from Content Structure or the caption and surface them as headline / supporting_text / additional_text_notes — describe WHAT the steps or points actually are, not THAT steps exist.",
      "6. Testimonial / proof / case-study posts: use a short, concrete quote, result, or proof point pulled from the caption or brand details — never invented.",
      "7. Carousel posts: each slide's text must be the specific on-slide copy for THAT slide's own topic — a designer should be able to place it directly with no further writing.",
      "8. Reel/video posts that need on-screen text: give the actual thumbnail headline and any specific on-screen text moments — not a generic 'watch to learn more'.",
      "9. Keep on-image text concise and design-ready: main_headline around 60 characters or fewer, subheadline / supporting_text around 90 characters or fewer, while staying specific.",
      "",
      "=== FORMAT-SPECIFIC RULES ===",
      "STATIC: Return { type: 'static', items: [ { ...fields } ] } with exactly ONE item. main_headline is the strongest on-image hook (often derived from hookTitle, but rephrase if a more specific angle fits better); subheadline/supporting_text is a SPECIFIC detail, step, stat, or benefit that goes beyond Core Message — never a restatement of it; badge_or_label is a meaningful on-image label/callout relevant to THIS post — never the raw Main Angle value; call_to_action ONLY if the caption has a clear, specific CTA.",
      "CAROUSEL: Return { type: 'carousel', slides: [ { slideNumber, slideRole, fields } ] }. Parse the slide count from Content Structure, cross-check against Visual Direction, and generate exactly one slide entry per Content Structure slide, in order. `slideRole` is a short label for that slide's role in the flow (e.g. 'Hook', 'Problem', 'Tip 1', 'Proof', 'Offer', 'CTA'). Every middle slide (not Slide 1 or the final CTA slide) MUST include both main_headline AND at least one of supporting_text or subheadline — the supporting detail must pull the specific fact, step, benefit, or claim from that slide's own Content Structure entry. The final output must be complete and sequential from Slide 1 to Slide N. Omit blank keys.",
      "VIDEO/REEL: Return { type: 'video', items: [] } unless a thumbnail or end card needs on-screen text. If it does, return ONE item using only main_headline, subheadline, supporting_text, call_to_action, badge_or_label, website_or_contact, logo_text, additional_text_notes — and set additional_text_notes to 'Use as thumbnail, cover, or end card only.'",
      "",
      "=== QUALITY REFERENCE EXAMPLE (World Cup marketing checklist — 6-slide carousel) ===",
      "Content Structure: 'Slide 1: Hook — \"6 things your business needs before World Cup season\" / Slide 2: Point 1 — Update your menu or offers / Slide 3: Point 2 — Plan your social content early / Slide 4: Point 3 — Prepare limited-time promotions / Slide 5: Point 4 — Get your team ready for rush hours / Slide 6: CTA — Book a free consultation before the season starts'",
      "Visual Direction: 'Bold checklist-style carousel — each slide shows one numbered checklist item with a bold icon and short supporting line, color-coded backgrounds per slide, final slide is a clear CTA card with contact details.'",
      "Target outputImageTextRequirementsStructured for that example:",
      "{ type: 'carousel', slides: [",
      "  { slideNumber: 1, slideRole: 'Hook',  fields: { main_headline: '6 Things Your Business Needs Before World Cup Season', badge_or_label: 'Checklist' } },",
      "  { slideNumber: 2, slideRole: 'Tip 1', fields: { main_headline: 'Update Your Menu or Offers', supporting_text: 'Match your specials to the World Cup buzz' } },",
      "  { slideNumber: 3, slideRole: 'Tip 2', fields: { main_headline: 'Plan Your Social Content Early', supporting_text: 'Get match-day posts ready before kickoff' } },",
      "  { slideNumber: 4, slideRole: 'Tip 3', fields: { main_headline: 'Prepare Limited-Time Promotions', supporting_text: 'Create urgency around match days' } },",
      "  { slideNumber: 5, slideRole: 'Tip 4', fields: { main_headline: 'Get Your Team Ready for Rush Hours', supporting_text: 'Plan staffing around big match times' } },",
      "  { slideNumber: 6, slideRole: 'CTA',   fields: { main_headline: 'Ready for World Cup Season?', call_to_action: 'Book a free consultation today', badge_or_label: 'Limited Spots' } }",
      "] }",
      "This is the quality bar: every slide carries its OWN specific text from its OWN Content Structure point, Slide 1 carries the hook, the final slide carries the CTA, no slide is skipped or duplicated, and only keys with real content appear.",
      "",
      "=== STATIC POST QUALITY REFERENCE EXAMPLE ===",
      "hookTitle: What Happens During a Security Consultation?",
      "coreMessage: We assess your property and recommend the right security upgrades.",
      "mainAngle: education",
      "contentStructure: Entry point assessment, existing risk review, upgrade recommendation.",
      "",
      "BAD outputImageTextRequirementsStructured (copies hookTitle verbatim, restates coreMessage, uses generic badge):",
      "{ \"type\": \"static\", \"items\": [ { \"main_headline\": \"What Happens During a Security Consultation?\", \"subheadline\": \"We assess your property and recommend the right security upgrades.\", \"badge_or_label\": \"Educational Insight\" } ] }",
      "",
      "BETTER outputImageTextRequirementsStructured (distills hookTitle into a concrete promise, subheadline adds a real detail from contentStructure, badge names the format):",
      "{ \"type\": \"static\", \"items\": [ { \"main_headline\": \"3 Checks Before We Recommend Any Security System\", \"subheadline\": \"Entry points, existing risks, and the right upgrade path for your property\", \"badge_or_label\": \"Consultation Checklist\" } ] }",
      "Why BETTER wins: main_headline turns the question into a numbered, concrete promise; subheadline lists the actual three things from contentStructure rather than restating coreMessage; badge_or_label names the format, not the angle category.",
      "",
      // ── Video narration/dialogue generation rules ──────────────────────────
      "=== VIDEO NARRATION & DIALOGUE GENERATION RULES ===",
      "For Reels and video posts, narrationOrDialogueOfCharacterOrCharacters must be a complete, usable script — not a one-line placeholder.",
      "It must cover all of the following:",
      "  - Hook / title: open with the post's core promise or question",
      "  - Core message: deliver the single key idea the audience must remember",
      "  - Main angle: reflect the strategic angle (education, trust, promotion, etc.)",
      "  - Promised value: give the audience what the title promised",
      "  - Key supporting points: include the main steps, reasons, tips, or proof points",
      "  - CTA / closing line where relevant: end with a clear next step or memorable close",
      "For character or dialogue-based posts: write complete character lines that convey the scene and the message — not stage directions.",
      "For narrator or voiceover-based posts: write a complete voiceover script with natural spoken flow.",
      "For short Reels: keep it concise but still complete — hook, key idea, at least one supporting point, closing line.",
      "Do NOT use vague filler lines as the full narration. One generic sentence is never enough. Examples of what NOT to write:",
      "  BAD: Narrator: \"Start your morning with these simple steps.\"",
      "  BAD: Character: \"This is the product you need.\"",
      "BETTER example — narrator voiceover for a Reel titled '5 Simple Steps to a Better Morning Routine':",
      "  Narrator: \"A smoother morning does not need a complicated routine. Start with five small steps: prepare your essentials the night before, choose one priority for the day, keep your workspace clear, block your first focused task before checking messages, and do a quick plan review before the day gets busy. Small habits make the whole day easier to manage.\"",
      "Do not use unfinished dialogue, ellipsis, or placeholder text.",
      "Empty string is allowed ONLY for non-video and non-Reel posts where narration or dialogue is genuinely not needed.",
      "",
      // ── Planning-to-output consistency: ensure the output delivers what the
      // planning fields promise. Without this block the AI often names a
      // structure (myths vs facts, FAQ, steps, comparison) in the hook/angle but
      // then produces generic output that does not actually contain those items.
      "=== PLANNING TO OUTPUT CONSISTENCY RULES ===",
      "The final output MUST deliver what the planning fields promise. If hookTitle, coreMessage, mainAngle, or contentStructure names or implies a specific structure, the actual structured content must appear in the output fields — not just in the planning labels.",
      "",
      "STRUCTURED PROMISE DETECTION — if any planning field contains or implies one of the following patterns, treat it as a delivery promise that must be fulfilled in the output:",
      "  myth vs fact / myth-busting → produce actual myth/fact pairs (state the myth, then state the fact)",
      "  FAQ / questions and answers → produce actual questions with their specific answers",
      "  comparison / vs / compared → produce the actual items being compared on both sides",
      "  checklist → produce the actual checkable items",
      "  step by step / steps / how to → produce actual numbered steps",
      "  tips → produce the actual specific tips (not 'here are some tips')",
      "  mistakes / what not to do → produce actual mistakes and their corrections",
      "  benefits / advantages / why → produce the actual listed benefits",
      "  examples → produce actual concrete examples",
      "  before and after → produce actual before/after states",
      "  reasons → produce the actual stated reasons",
      "  pros and cons → produce actual pros and actual cons",
      "  do and don't → produce actual do/don't pairs",
      "  common objections → produce actual objections with responses",
      "  process stages / phases → produce the actual named stages",
      "",
      "FORMAT-SPECIFIC DELIVERY RULES:",
      "STATIC: Deliver the promised content in caption or outputImageTextRequirementsStructured. If the list is long, caption carries the full content and Image Text carries a concise version of the key items.",
      "CAROUSEL: The promised structure drives the slides — myths vs facts → slide-by-slide myth/fact pairs; FAQ → question-and-answer slides; steps → one step per slide; checklist → one item per slide; mistakes → mistake + correction per slide; comparison → compared items across slides.",
      "REEL/VIDEO: The promised structure must appear in narrationOrDialogueOfCharacterOrCharacters, textOnVideo, whatHappens, mainIntegratedScenario, or caption. Myths vs facts → state actual myths and facts in narration. FAQ → include real questions with spoken answers. Steps → walk through the actual steps in order. Comparison → state both sides clearly.",
      "",
      "CONSISTENCY PASS — before returning the JSON, verify each post:",
      "  • If planning says FAQ → real Q&A pairs must appear in slides, narration, or caption — not just a mention that FAQs exist.",
      "  • If planning says myths vs facts → actual myths and facts must be stated — not just 'learn the truth about X'.",
      "  • If planning says steps → actual numbered steps must appear — not just 'follow these steps'.",
      "  • If planning says comparison → actual items being compared must appear — not just 'compare your options'.",
      "  • If planning says checklist → actual checkable items must appear — not just 'here is a checklist'.",
      "  • Do not only name the structure in the planning fields. Deliver the actual content in the output fields.",
      "",
      "BAD vs BETTER EXAMPLES:",
      "",
      "Bad — Myths vs Facts, static post:",
      "  hookTitle: 'Myths vs Facts About Product Care'",
      "  caption: 'Learn the truth about caring for your product.' (no actual myths or facts — structure promised but not delivered)",
      "Better:",
      "  caption: 'Myth: You need to treat it every day. Fact: A thorough clean once a week extends its lifespan far better. Myth: Any cleaning product works. Fact: Harsh chemicals damage the surface — use the recommended formula for lasting results.'",
      "",
      "Bad — FAQ, carousel:",
      "  hookTitle: 'FAQ About Our Service'",
      "  Slides: generic slides listing service benefits without any actual questions or answers.",
      "Better:",
      "  Slide 1 main_headline: 'Your Questions About Our Service, Answered'",
      "  Slide 2 main_headline: 'Q: How long does it take?' supporting_text: 'A: Most jobs are completed within one business day.'",
      "  Slide 3 main_headline: 'Q: Do I need to be there?' supporting_text: 'A: No — we handle everything and send you a full summary.'",
      "  Slide 4 main_headline: 'Q: What if I need changes?' supporting_text: 'A: One revision round is included at no extra cost.'",
      "",
      // ── Critical: override the template's "three tables" instruction ────────
      // The template has outputType="json" (JSON mode) but was written for
      // markdown tables. This block gives the AI the exact schema to return.
      "=== REQUIRED JSON OUTPUT FORMAT ===",
      "Return ONLY valid JSON. No markdown. No code blocks. No explanations.",
      "Do not return tables. Do not return a text acknowledgment.",
      `Generate exactly ${safeCount} posts in the "posts" array.`,
      "",
      "Each post must follow this EXACT JSON structure (all fields required, use empty string if not applicable):",
      "{",
      '  "posts": [',
      "    {",
      '      "postNumber": 1,',
      '      "date": "YYYY-MM-DD or empty string",',
      `      "platform": "${formFields.platforms?.split(",")[0]?.trim() || "Instagram"}",`,
      '      "format": "Carousel | Reel | Static | Story | Live",',
      '      "mainAngle": "strategic angle: education | trust | promotion | engagement | behind the scenes | objection handling | case study",',
      '      "coreMessage": "the single key message the audience must remember",',
      '      "hookTitle": "opening hook or first-slide headline",',
      '      "caption": "full caption text with CTA",',
      '      "hashtags": ["#tag1", "#tag2", "#tag3"],',
      '      "contentStructure": "slide-by-slide or scene-by-scene breakdown",',
      '      "visualDirection": "Creative direction for the designer. Static posts: describe layout, colors, composition, branding, CTA placement. Carousel posts: write Overall carousel visual system: [...] then Slide 1: [...] Slide 2: [...] etc. Video/Reel posts: describe thumbnail look, key visual frames, cover frame direction.",',
      '      "outputImageTextRequirementsStructured": <object — FOLLOW THE OUTPUT IMAGE TEXT REQUIREMENTS GENERATION RULES AND FORMAT-SPECIFIC RULES ABOVE EXACTLY. Return a real nested JSON object (not a string): { "type": "static"|"video", "items": [ { "main_headline": "...", ... } ] } OR { "type": "carousel", "slides": [ { "slideNumber": 1, "slideRole": "Hook", "fields": { "main_headline": "sharpened hook", "badge_or_label": "label" } }, { "slideNumber": 2, "slideRole": "Tip 1", "fields": { "main_headline": "specific claim from this slide in contentStructure", "supporting_text": "concrete detail or benefit — REQUIRED for every middle slide" } }, ... one entry per Content Structure slide — every middle slide MUST have main_headline + supporting_text or subheadline ] }. Use ONLY the 10 allowed field keys. Omit blank keys entirely. Carousel slide count MUST equal the Content Structure slide count.>,',
      '      "imageText": "short legacy image text note if needed; leave empty if outputImageTextRequirementsStructured is filled",',
      '      "structure": "carousel sequence | reel sequence | static layout | story sequence | video flow",',
      '      "inspiration": "where this idea comes from: selected post idea | brand strategy | audience pain point | seasonal event",',
      '      "videoConceptTitleAndThumbnailTitleIdea": "for video formats: concept title and thumbnail title idea; leave empty for non-video",',
      '      "videoRawIdea": "for video formats: raw video idea in simple language; empty for non-video",',
      '      "mainIntegratedScenario": "for video formats: full scenario from start to end; empty for non-video",',
      '      "thumbnailIdeaForReel": "for video formats: thumbnail frame description; empty for non-video",',
      '      "narrationOrDialogueOfCharacterOrCharacters": "For video/Reel: complete voiceover or dialogue script covering hook/title, core message, main angle, promised value, supporting points, and CTA/closing line where relevant. Must be usable as written, not a one-line placeholder. Empty only for non-video posts where narration or dialogue is not needed.",',
      '      "rawImageIdeaForFirstFrame": "description of the first frame for image/video generation",',
      '      "whatHappens": "main action or sequence in the video; empty for non-video",',
      '      "characterObjectOrEnvironmentAction": "what the character, object, or environment does",',
      '      "cameraMovement": "e.g. slow push in, static shot, gentle pan, tracking shot",',
      '      "speedRamp": "speed ramp style, e.g. None, Ramp in, Ramp out, Speed up, Slow motion — or \\"Auto\\" if not specified",',
      '      "camera": "camera type/model, or \\"Auto\\" if not specified",',
      '      "lens": "lens type or characteristic, or \\"Auto\\" if not specified",',
      '      "focalLength": "focal length in mm, or \\"50\\" if not specified",',
      '      "aperture": "aperture / depth of field, or \\"f/4 moderate\\" if not specified",',
      '      "visualMood": "mood, lighting, atmosphere, and visual vibe",',
      '      "textOnVideo": "overlay text for video; note if text should be added manually in editing",',
      '      "status": "Draft"',
      "    }",
      "  ]",
      "}",
      "",
      "Strict rules:",
      `- posts array must contain exactly ${safeCount} complete objects.`,
      "- hashtags must always be a JSON array of strings starting with #.",
      "- outputImageTextRequirementsStructured must be a real nested JSON object/array (NOT a stringified JSON, NOT plain text) following the schema and rules given above.",
      "- postNumber starts at 1 and increments by 1.",
      "- Every field must be present. Use empty string \"\" for fields that do not apply.",
      "- Return only the JSON object. Nothing before or after it.",
    ].filter(v => v !== null).join("\n");

    console.log("[ContentCalendar] userInput length:", userInput.length, "chars");

    // ── 7. Call AI ───────────────────────────────────────────────────────────
    const result = await generateWithPromptTemplate({
      templateSlug: "content-calendar-generator",
      variables,
      userInput,
      maxTokens: 16384, // Use the highest practical output budget — detailed calendars include long narration and visual production fields. Very large calendars may still need chunked generation.
    });

    console.log("[ContentCalendar] Raw AI output length:", result.raw?.length ?? 0, "chars");

    // ── 8. Parse output ──────────────────────────────────────────────────────
    let parsed;
    if (result.content && typeof result.content === "object") {
      // ai.js already parsed it into an object
      parsed = result.content;
    } else {
      // ai.js returned raw string (JSON.parse failed inside ai.js, or not JSON mode)
      parsed = parseAiJsonOutput(result.raw);
    }

    // ── 9. Extract posts array from whatever shape the AI returned ───────────
    let rawPosts = [];

    if (Array.isArray(parsed)) {
      rawPosts = parsed;
    } else if (parsed && typeof parsed === "object") {
      // Standard key names first
      const topLevel =
        parsed.posts ?? parsed.calendar ?? parsed.postIdeas ??
        parsed.calendarPosts ?? parsed.entries ?? parsed.content_calendar ??
        parsed.schedule ?? null;

      if (Array.isArray(topLevel) && topLevel.length > 0) {
        rawPosts = topLevel;
      } else {
        // Deep-search
        const found = deepFindPostArrays(parsed);
        if (found.length > 0) {
          found.sort((a, b) => b.arr.length - a.arr.length);
          rawPosts = found[0].arr;
        }
      }
    }

    console.log("[ContentCalendar] Parsed posts count:", rawPosts.length, "| requested:", safeCount);

    const normalized = rawPosts.map((p, i) => normalisePost(p, i, formFields.platforms));

    // ── 9b. Fallback date/time assignment for posts missing a date ───────────
    const datedPosts = applyFallbackDates(normalized, {
      calendarPeriodStart,
      calendarPeriodEnd,
      publishingFrequency: formFields.publishingFrequency,
      seasonalDates: chosenSeasonalDates,
    });

    // ── 10. Post-process: apply fallback for weak outputImageTextRequirements ─
    // Validate the structured object the AI produced (slide count vs Content
    // Structure, sequential numbering, no duplicate/blank slides, etc). If it
    // fails, build a structured fallback from the post's own fields and derive
    // the clean display string from THAT — so the two never disagree.
    const posts = datedPosts.map(p => {
      const check = validateOutputImageTextRequirements(p);
      if (!check.valid) {
        console.log(`[ContentCalendar] Post #${p.postNumber} outputImageTextRequirements validation failed (${check.reason}), applying fallback`);
        const fallbackStructured = buildFallbackOutputImageTextRequirements(p);
        return {
          ...p,
          outputImageTextRequirementsStructured: fallbackStructured,
          outputImageTextRequirements: formatOutputImageTextRequirementsForDisplay(fallbackStructured) || "",
        };
      }
      return p;
    });

    // ── 11. Return ───────────────────────────────────────────────────────────
    return NextResponse.json({
      success: true,
      posts,
      tables: null,
      raw: result.raw,
      usage: result.usage,
      model: result.model,
    });

  } catch (err) {
    console.error("[ContentCalendar] Unhandled error:", err);
    // A connection failure to the AI service isn't an input problem — telling
    // the user to "check the inputs" sends them down the wrong path. Surface
    // an accurate, actionable message instead (see lib/ai.js retry handling).
    const isConnectionError = err?.code === "AI_CONNECTION_ERROR";
    return NextResponse.json(
      {
        success: false,
        error: isConnectionError
          ? "Couldn't reach the AI service. Please check your connection and try again — your inputs are fine."
          : "Content calendar generation failed. Please check the inputs and try again.",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: isConnectionError ? 503 : 500 }
    );
  }
}
