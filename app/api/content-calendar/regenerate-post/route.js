import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, getBrandCalendarAccess } from "@/lib/auth";
import { generateWithPromptTemplate } from "@/lib/ai";
import { normalizeBrandIdentityOutput, createCompactBrandVisualIdentitySummaryForImagePrompt } from "@/lib/brand-identity-utils";
import { resolveCalendarAttachmentContext } from "@/lib/calendar-attachment-context";
import { buildLanguageInstruction, normalizeLanguageCode } from "@/lib/content-language";
import {
  validateOutputImageTextRequirements,
  buildFallbackOutputImageTextRequirements,
  normalizeOutputImageTextRequirementsStructured,
  formatOutputImageTextRequirementsForDisplay,
} from "@/lib/calendar-post-utils";

// ── Scope → allowed updatable fields ──────────────────────────────────────────
const VISUAL_FIELDS = [
  "contentStructure", "visualDirection", "outputImageTextRequirements", "outputImageTextRequirementsStructured",
  "imageText", "structure", "inspiration",
  "videoConceptTitleAndThumbnailTitleIdea", "videoRawIdea",
  "mainIntegratedScenario", "thumbnailIdeaForReel",
  "narrationOrDialogueOfCharacterOrCharacters", "rawImageIdeaForFirstFrame",
  "whatHappens", "characterObjectOrEnvironmentAction",
  "cameraMovement", "speedRamp", "camera", "lens", "focalLength", "aperture",
  "visualMood", "textOnVideo",
];

const CONTENT_FIELDS = [
  "hookTitle", "mainAngle", "coreMessage", "caption", "hashtags",
];

const SCOPE_FIELDS = {
  visual_only:        VISUAL_FIELDS,
  visual_ideas_only:  VISUAL_FIELDS,
  entire_post:        [...CONTENT_FIELDS, ...VISUAL_FIELDS],
  custom_instruction: ["format", ...CONTENT_FIELDS, ...VISUAL_FIELDS],
  image_text_only:    ["outputImageTextRequirementsStructured", "outputImageTextRequirements", "imageText"],
};

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

function buildBrandSummary(identity, brand) {
  if (!identity) {
    return [
      brand.name           && `Brand: ${brand.name}`,
      brand.businessType   && `Type: ${brand.businessType}`,
      brand.brandTone      && `Tone: ${brand.brandTone}`,
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

const CUSTOM_INSTRUCTION_CLEARABLE_FIELDS = new Set([
  "narrationOrDialogueOfCharacterOrCharacters",
  "rawImageIdeaForFirstFrame",
  "whatHappens",
  "characterObjectOrEnvironmentAction",
  "cameraMovement",
  "visualMood",
  "textOnVideo",
  "videoConceptTitleAndThumbnailTitleIdea",
  "videoRawIdea",
  "mainIntegratedScenario",
  "thumbnailIdeaForReel",
]);

function applyScopedPostRegeneration(original, aiPost, scope) {
  const allowed = SCOPE_FIELDS[scope] ?? SCOPE_FIELDS.entire_post;
  const result = { ...original };
  for (const field of allowed) {
    const val = aiPost[field];
    if (val !== undefined && val !== null) {
      if (val === "" && scope === "custom_instruction" && CUSTOM_INSTRUCTION_CLEARABLE_FIELDS.has(field)) {
        result[field] = "";
      } else if (val !== "") {
        result[field] = val;
      }
    }
  }
  result.postNumber = original.postNumber;
  return result;
}

function parseAiJson(raw) {
  if (!raw?.trim()) throw new Error("AI returned empty response.");
  let text = raw.trim();
  try { return JSON.parse(text); } catch {}
  text = text.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/im, "").trim();
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  throw new Error("Could not parse AI response as JSON.");
}

function buildOutputImageTextRules(isCarousel, isVideo) {
  const shared = [
    "outputImageTextRequirementsStructured is a STRATEGIC field — the exact on-image text plan, derived in this priority order from: (1) Format, (2) Hook/Title, (3) Main Angle + Core Message, (4) Content Structure, (5) Visual Direction.",
    "Return a real structured object (NOT a string): { type: 'static'|'carousel'|'video', items: [...] } for static/video, or { type: 'carousel', slides: [ { slideNumber, slideRole, fields } ] } for carousel.",
    "Each item/slide `fields` uses ONLY these keys (omit any without real content): main_headline, subheadline, supporting_text, call_to_action, badge_or_label, offer_or_promotion, date_or_time, website_or_contact, logo_text, additional_text_notes. Never return a key with an empty string — omit it entirely.",
    "Never repeat the same headline (or near-identical phrasing) across slides/items. Never copy the full caption into on-image text — on-image text is substantive and stands on its own; the caption is a separate field entirely. Never invent offers, dates, or contact info that aren't in the brand identity, campaign details, or caption.",
    "AVOID GENERIC RESTATEMENT (CRITICAL): do NOT simply copy hookTitle into main_headline, coreMessage into subheadline, and mainAngle into badge_or_label — pull out the SPECIFIC fact, step, number, benefit, mistake, quote, or detail that makes this post's image useful.",
    "badge_or_label must be a meaningful on-image label (a real step name, stat, category, or callout) — never a generic content-type tag like 'Educational Insight', 'Tip', or 'Did You Know', and never the raw mainAngle value, unless that exact phrase is genuinely meant to appear on the image.",
    "subheadline/supporting_text must add information BEYOND the headline — a concrete detail, step, number, benefit, or reason to care, never a vaguer restatement of the headline or coreMessage. Never use placeholder text ('N/A', 'Coming soon', 'Educational Insight', etc.).",
    "For educational/how-it-works/process/consultation posts, pull the ACTUAL steps, stages, checklist items, mistakes, or takeaways from contentStructure or the caption. For testimonial/proof posts, use a short concrete quote or result from the caption — never invented. Keep on-image text design-ready and substantive: main_headline should make a complete, specific claim; subheadline / supporting_text must add concrete value beyond the headline — use the space to be useful rather than artificially brief.",
  ];

  if (isVideo) {
    return [
      ...shared,
      "This is a VIDEO/REEL post: return { type: 'video', items: [] } unless a thumbnail or end card needs on-screen text. If it does, return ONE item using only main_headline, subheadline, supporting_text, call_to_action, badge_or_label, website_or_contact, logo_text, additional_text_notes — set additional_text_notes to 'Use as thumbnail, cover, or end card only.'",
    ];
  }
  if (isCarousel) {
    return [
      ...shared,
      "This is a CAROUSEL post: return { type: 'carousel', slides: [...] } with EXACTLY one slide per slide in contentStructure — never fewer, never more, never skipped. Slide numbers must be sequential 1..N with no gaps or duplicates.",
      "Slide 1's main_headline is derived from hookTitle — sharpened into the strongest on-image claim, not copied verbatim. The final slide should usually carry call_to_action pulled from the caption's actual CTA.",
      "CAROUSEL MIDDLE SLIDES (MANDATORY): Every middle slide MUST include both main_headline AND at least one of supporting_text or subheadline — never return main_headline alone for a middle slide. The supporting_text or subheadline must pull a SPECIFIC detail, benefit, step, stat, concrete claim, or mini-explanation from that slide's OWN Content Structure entry. A vague one-liner or generic restatement is not acceptable.",
      "For educational carousel slides, add sub_supporting_text_1 to most middle/informative slides and sub_supporting_text_2 to the most complex slides to provide deeper explanation, practical examples, or proof points. Hook and CTA slides should stay concise.",
      "`slideRole` is a short label for the slide's role in the flow (e.g. 'Hook', 'Tip 1', 'Proof', 'CTA'). Match the Visual Direction's style (checklist → short list-style lines, comparison → compare/contrast phrasing, steps → numbered action phrasing) and the Main Angle's tone (education → explain/teach, promotion → offer + CTA, trust → proof/credibility).",
      "CAROUSEL QUALITY EXAMPLE — middle slide: GOOD: { main_headline: 'Plan Your Social Content Early', supporting_text: 'Get match-day posts ready 2 weeks before kickoff' } | BAD: { main_headline: 'Plan your content' } — headline only with no supporting detail.",
    ];
  }
  return [
    ...shared,
    "This is a STATIC IMAGE post: return { type: 'static', items: [ { ...fields } ] } with exactly ONE item. main_headline is the strongest on-image hook (often derived from hookTitle, but rephrase if a more specific angle fits better); subheadline/supporting_text is a SPECIFIC detail, step, stat, or benefit beyond coreMessage — never a restatement; badge_or_label is a meaningful on-image label/callout for THIS post — never the raw mainAngle value; call_to_action only if the caption has a clear, specific CTA.",
  ];
}

function buildJsonHint(isCarousel, isVideo) {
  const oitrHint = isVideo
    ? '  "outputImageTextRequirementsStructured": { "type": "video", "items": [] } — or one item with on-screen text ONLY if a thumbnail/end card needs it (see rules above),\n'
    : isCarousel
      ? '  "outputImageTextRequirementsStructured": { "type": "carousel", "slides": [ { "slideNumber": 1, "slideRole": "Hook", "fields": { "main_headline": "sharpened hook from hookTitle", "badge_or_label": "short label" } }, { "slideNumber": 2, "slideRole": "Tip 1", "fields": { "main_headline": "specific claim from this slide in contentStructure", "supporting_text": "concrete detail or benefit — REQUIRED for every middle slide" } }, ... one entry per contentStructure slide, sequential 1..N — every middle slide MUST have main_headline + supporting_text or subheadline, final slide usually carrying call_to_action ] },\n'
      : '  "outputImageTextRequirementsStructured": { "type": "static", "items": [ { "main_headline": "the strongest on-image hook (not just hookTitle restated)", "subheadline": "a specific supporting detail, step, stat, or benefit — not a restatement of coreMessage", "badge_or_label": "a meaningful on-image label/callout (not the raw mainAngle value)", "call_to_action": "from caption CTA if present" } ] },\n';

  return [
    "Return ONLY valid JSON matching this exact structure (no markdown, no code blocks):",
    "{",
    '  "postNumber": (keep same),',
    '  "date": (keep same),',
    '  "platform": (keep same),',
    '  "format": "...",',
    '  "hookTitle": "...",',
    '  "mainAngle": "...",',
    '  "coreMessage": "...",',
    '  "caption": "detailed caption — at least 5 lines, maximum 3 paragraphs, ending with CTA",',
    '  "hashtags": ["#tag1", "#tag2"],',
    '  "contentStructure": "...",',
    isCarousel
      ? '  "visualDirection": "Overall carousel visual system: [...]. Slide 1: [...]. Slide 2: [...]. etc.",'
      : '  "visualDirection": "Specific creative direction for layout, colors, composition, branding.",',
    oitrHint,
    '  "imageText": "",',
    '  "structure": "...",',
    '  "inspiration": "...",',
    '  "videoConceptTitleAndThumbnailTitleIdea": "...",',
    '  "videoRawIdea": "...",',
    '  "mainIntegratedScenario": "...",',
    '  "thumbnailIdeaForReel": "...",',
    isVideo
      ? '  "narrationOrDialogueOfCharacterOrCharacters": "Complete voiceover or dialogue script covering the hook/title, core message, main angle, promised value, key supporting points, and CTA/closing line where relevant. Must be usable as written — not a one-line placeholder.",'
      : '  "narrationOrDialogueOfCharacterOrCharacters": "" (empty for non-video posts — leave blank if narration is not needed),',
    '  "rawImageIdeaForFirstFrame": "...",',
    '  "whatHappens": "...",',
    '  "characterObjectOrEnvironmentAction": "...",',
    '  "cameraMovement": "...",',
    '  "speedRamp": "...",',
    '  "camera": "...",',
    '  "lens": "...",',
    '  "focalLength": "...",',
    '  "aperture": "...",',
    '  "visualMood": "...",',
    '  "textOnVideo": "..."',
    "}",
  ].filter(Boolean);
}

function buildOutputImageTextRulesForCustomInstruction() {
  return [
    "outputImageTextRequirementsStructured is a STRATEGIC field — the exact on-image text plan, derived in this priority order from: (1) Format, (2) Hook/Title, (3) Main Angle + Core Message, (4) Content Structure, (5) Visual Direction.",
    "Return a real structured object (NOT a string): { type: 'static'|'carousel'|'video', items: [...] } for static/video, or { type: 'carousel', slides: [ { slideNumber, slideRole, fields } ] } for carousel.",
    "Each item/slide `fields` uses ONLY these keys (omit any without real content): main_headline, subheadline, supporting_text, call_to_action, badge_or_label, offer_or_promotion, date_or_time, website_or_contact, logo_text, additional_text_notes. Never return a key with an empty string — omit it entirely.",
    "Never repeat the same headline (or near-identical phrasing) across slides/items. Never copy the full caption into on-image text — on-image text is substantive and stands on its own; the caption is a separate field entirely. Never invent offers, dates, or contact info that aren't in the brand identity, campaign details, or caption.",
    "AVOID GENERIC RESTATEMENT (CRITICAL): do NOT simply copy hookTitle into main_headline, coreMessage into subheadline, and mainAngle into badge_or_label — pull out the SPECIFIC fact, step, number, benefit, mistake, quote, or detail that makes this post's image useful.",
    "badge_or_label must be a meaningful on-image label (a real step name, stat, category, or callout) — never a generic content-type tag like 'Educational Insight', 'Tip', or 'Did You Know', and never the raw mainAngle value, unless that exact phrase is genuinely meant to appear on the image.",
    "subheadline/supporting_text must add information BEYOND the headline — a concrete detail, step, number, benefit, or reason to care, never a vaguer restatement of the headline or coreMessage. Never use placeholder text ('N/A', 'Coming soon', 'Educational Insight', etc.).",
    "For educational/how-it-works/process/consultation posts, pull the ACTUAL steps, stages, checklist items, mistakes, or takeaways from contentStructure or the caption. For testimonial/proof posts, use a short concrete quote or result from the caption — never invented. Keep on-image text design-ready and substantive: main_headline should make a complete, specific claim; subheadline / supporting_text must add concrete value beyond the headline — use the space to be useful rather than artificially brief.",
    "CRITICAL — FORMAT-AWARE IMAGE TEXT: Choose the correct type based on the FINAL format you return — not the original post format.",
    "If final format is Carousel → return { type: 'carousel', slides: [...] } with EXACTLY one slide per slide in contentStructure. Slide 1's main_headline from hookTitle (sharpened). Each middle slide MUST include both main_headline AND at least one of supporting_text or subheadline — pull a specific detail, benefit, step, or claim from that slide's own contentStructure entry. For educational carousel slides, add sub_supporting_text_1 to most middle/informative slides and sub_supporting_text_2 to the most complex slides for deeper explanation, practical examples, or proof points. Hook and CTA slides should stay concise. Final slide usually carries call_to_action. slideRole is a short label (e.g. 'Hook', 'Tip 1', 'CTA').",
    "If final format is Reel/video/story → return { type: 'video', items: [] } unless a thumbnail or end card needs on-screen text. If so, return ONE item — set additional_text_notes to 'Use as thumbnail, cover, or end card only.'",
    "If final format is Static Image → return { type: 'static', items: [ { ...fields } ] } with exactly ONE item. main_headline is the strongest on-image hook; subheadline/supporting_text is a specific detail; badge_or_label is a meaningful callout; call_to_action only if caption has a clear CTA.",
    "NEVER return { type: 'static' } when final format is carousel. NEVER return { type: 'carousel' } when final format is static or video.",
  ];
}

function buildJsonHintForCustomInstruction() {
  const oitrHint = [
    '  "outputImageTextRequirementsStructured": — choose type based on FINAL format:',
    '    carousel → { "type": "carousel", "slides": [ { "slideNumber": 1, "slideRole": "Hook", "fields": { "main_headline": "sharpened hook", "badge_or_label": "label" } }, { "slideNumber": 2, "slideRole": "Tip 1", "fields": { "main_headline": "specific claim from this slide in contentStructure", "supporting_text": "concrete detail or benefit — REQUIRED for every middle slide" } }, ... one entry per contentStructure slide, sequential 1..N — every middle slide MUST have main_headline + supporting_text or subheadline, final slide usually with call_to_action ] }',
    '    Reel/video → { "type": "video", "items": [] } or ONE thumbnail/end card item if needed',
    '    static → { "type": "static", "items": [ { "main_headline": "strongest on-image hook", "subheadline": "specific detail beyond coreMessage", "badge_or_label": "meaningful callout", "call_to_action": "from caption CTA if present" } ] }',
  ].join("\n");

  return [
    "Return ONLY valid JSON matching this exact structure (no markdown, no code blocks):",
    "{",
    '  "postNumber": (keep same),',
    '  "date": (keep same),',
    '  "platform": (keep same),',
    '  "format": "updated format if the instruction changes it — otherwise keep same",',
    '  "hookTitle": "...",',
    '  "mainAngle": "...",',
    '  "coreMessage": "...",',
    '  "caption": "detailed caption — at least 5 lines, maximum 3 paragraphs, ending with CTA",',
    '  "hashtags": ["#tag1", "#tag2"],',
    '  "contentStructure": "updated to match final format if it changed",',
    '  "visualDirection": "updated to describe the final format",',
    oitrHint + ",",
    '  "imageText": "",',
    '  "structure": "updated to match final format",',
    '  "inspiration": "...",',
    '  "videoConceptTitleAndThumbnailTitleIdea": "fill if final format is Reel/video — empty string if not",',
    '  "videoRawIdea": "fill if final format is Reel/video — empty string if not",',
    '  "mainIntegratedScenario": "fill if final format is Reel/video — empty string if not",',
    '  "thumbnailIdeaForReel": "fill if final format is Reel/video — empty string if not",',
    '  "narrationOrDialogueOfCharacterOrCharacters": "Complete voiceover or dialogue script if final format is Reel/video. EMPTY STRING if final format is NOT Reel/video.",',
    '  "rawImageIdeaForFirstFrame": "fill for video/Reel — empty string if not applicable",',
    '  "whatHappens": "fill for video/Reel — empty string if not applicable",',
    '  "characterObjectOrEnvironmentAction": "...",',
    '  "cameraMovement": "...",',
    '  "speedRamp": "...",',
    '  "camera": "...",',
    '  "lens": "...",',
    '  "focalLength": "...",',
    '  "aperture": "...",',
    '  "visualMood": "...",',
    '  "textOnVideo": "fill for video/Reel — empty string if not applicable"',
    "}",
  ].filter(Boolean);
}

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

    const validScopes = ["visual_only", "visual_ideas_only", "entire_post", "custom_instruction", "image_text_only"];
    if (!validScopes.includes(scope)) {
      return NextResponse.json(
        { success: false, error: `Invalid scope. Must be one of: ${validScopes.join(", ")}.` },
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
    const fmtLower = (current.format || "").toLowerCase();
    const isCarousel = fmtLower.includes("carousel");
    const isVideo    = /reel|story|video|live/.test(fmtLower);

    // ── Build AI prompt ───────────────────────────────────────────────────────
    const attachmentBlock = attachmentContext.block
      ? `\n=== INTERPRETED UPLOADED REFERENCE MATERIAL ===\n${attachmentContext.block}`
      : null;

    let userInput;

    if (scope === "custom_instruction") {
      userInput = [
        "You are an expert social media strategist, copywriter, visual creative director, and AI content production planner.",
        "You are updating one selected post from a content calendar based on a specific user instruction.",
        "",
        "=== BRAND ===",
        brandSummary,
        "",
        "=== LANGUAGE INSTRUCTION ===",
        buildLanguageInstruction(contentLanguage),
        "",
        "=== CALENDAR CONTEXT ===",
        calendarContext?.mainMonthlySubject ? `Monthly subject: ${calendarContext.mainMonthlySubject}` : null,
        calendarContext?.mainGoal           ? `Main goal: ${calendarContext.mainGoal}` : null,
        calendarContext?.mainOfferOrMessage ? `Offer / message: ${calendarContext.mainOfferOrMessage}` : null,
        "",
        attachmentBlock,
        "",
        "=== CURRENT POST ===",
        `Post #${current.postNumber || "?"}`,
        `Platform: ${current.platform || ""}`,
        `Format: ${current.format || ""}`,
        (current.hookTitle || current.suggestedHook)   ? `Hook / Title: ${current.hookTitle || current.suggestedHook}` : null,
        current.mainAngle                               ? `Main angle: ${current.mainAngle}` : null,
        current.coreMessage                             ? `Core message: ${current.coreMessage}` : null,
        (current.caption || current.suggestedCaption)  ? `Caption: ${current.caption || current.suggestedCaption}` : null,
        current.hashtags                                ? `Hashtags: ${Array.isArray(current.hashtags) ? current.hashtags.join(" ") : current.hashtags}` : null,
        current.visualDirection                         ? `Visual direction: ${current.visualDirection}` : null,
        current.contentStructure                        ? `Content structure: ${current.contentStructure}` : null,
        currentOitrDisplay                              ? `Output image text: ${currentOitrDisplay}` : null,
        current.structure                               ? `Structure: ${current.structure}` : null,
        current.inspiration                             ? `Inspiration: ${current.inspiration}` : null,
        "",
        "=== USER INSTRUCTION ===",
        customInstruction.trim(),
        "",
        "=== RULES ===",
        "1. Follow the user instruction above carefully and completely.",
        "2. NEVER change postNumber — preserve it exactly.",
        "3. Keep the post aligned with the brand, audience, platform, and calendar strategy.",
        "4. INTENT-AWARE UPDATING — apply only what the instruction requires:",
        "   • Copy/wording change only (rewrite caption, new headline, adjust tone): update hookTitle, mainAngle, coreMessage, caption, hashtags. Leave visual, format, and video production fields unchanged.",
        "   • Visual-only change (different style, colors, mood, layout): update visualDirection and outputImageTextRequirementsStructured. Leave format, copy, and video production fields unchanged.",
        "   • Format/structure change (static → carousel, static → Reel, carousel → static, change to video, etc.): update ALL dependent fields required for consistency — see Rule 5.",
        "5. FORMAT CHANGE CONSISTENCY — when format changes (or the instruction converts one post type to another), regenerate and align ALL of these fields:",
        "   • format (the new requested format)",
        "   • contentStructure (must match new format: slide list for carousel, scene breakdown for Reel, single-image layout for static)",
        "   • visualDirection (must describe the new format: per-slide carousel system, Reel scene mood, or static composition)",
        "   • structure (must reflect new format: 'carousel layout' / 'Reel' / 'static image' — not the old format label)",
        "   • outputImageTextRequirementsStructured (type and slides/items must match new format — see Rule 6)",
        "   • video production fields and narrationOrDialogueOfCharacterOrCharacters — fill completely if new format is Reel/video",
        "   • clear video production fields (set to empty string \"\") if new format is NOT Reel/video and those fields are no longer relevant",
        "6. IMAGE TEXT FORMAT ALIGNMENT (CRITICAL) — outputImageTextRequirementsStructured type MUST match the FINAL format you return:",
        "   • Final format is carousel → type MUST be 'carousel' with slides array, one slide per contentStructure slide — NEVER return type 'static'",
        "   • Final format is Reel/video → type MUST be 'video' with items array — NEVER return type 'carousel' or 'static'",
        "   • Final format is static → type MUST be 'static' with exactly one item — NEVER return type 'carousel'",
        "7. Return only this one updated post — not a full calendar.",
        "8. Return only valid JSON. Do not use markdown. Do not use code blocks.",
        "9. If the instruction asks to change Image Text, image copy, on-image text, headline text, overlay text, slide text, or visual copy, you MUST return a new outputImageTextRequirementsStructured object. Follow the OUTPUT IMAGE TEXT REQUIREMENTS rules below exactly.",
        "",
        "=== CAPTION GENERATION RULES ===",
        "If the instruction modifies or regenerates the caption, the new caption must follow these rules:",
        "  - At least 5 visible lines of substantive content",
        "  - Maximum 3 paragraphs, separated by natural blank line breaks",
        "  - Always include a clear call-to-action in the final paragraph",
        "  - Do not artificially shorten captions to a fixed character limit — let content and depth dictate the length",
        "  - Use natural line breaks between paragraphs to improve readability",
        "",
        "CAPTION DEPTH BY POST TYPE:",
        "  - Educational posts (mainAngle: education): captions must be more detailed than regular posts. Use longer explanations, practical examples, steps, reasons, mini-frameworks, or key takeaways. Aim for at least 2 substantial paragraphs when the content supports it. Do not add filler — useful depth only.",
        "  - Static posts: Since a static post has only one visual, the caption must carry more explanation and context. Include a hook/opening, explanation/context, practical value or proof, and a CTA. Aim for at least 2 substantial paragraphs when the content supports it.",
        "  - Educational static posts: Receive the richest captions — usually 2-3 substantial paragraphs with explanation, practical value, and a clear next step.",
        "  - Other posts: Follow the base rules above (at least 5 visible lines, max 3 paragraphs, ending with CTA).",
        "",
        "=== OUTPUT IMAGE TEXT REQUIREMENTS ===",
        ...buildOutputImageTextRulesForCustomInstruction(),
        "",
        ...buildJsonHintForCustomInstruction(),
      ].filter(v => v !== null && v !== false && v !== undefined).join("\n");
    } else if (scope === "image_text_only") {
      // Normalize: accept new array guidedReasons or fall back to legacy string guidedReason
      const normalizedReasons = Array.isArray(guidedReasons) && guidedReasons.length
        ? guidedReasons
        : (guidedReason ? [guidedReason] : []);
      userInput = [
        "You are an expert social media visual copywriter and on-image text strategist.",
        "Your ONLY task is to regenerate outputImageTextRequirementsStructured for the post below.",
        "You MUST NOT change any other field. Return only the JSON fields shown in the schema below.",
        "",
        "=== BRAND ===",
        brandSummary,
        "",
        "=== LANGUAGE INSTRUCTION ===",
        buildLanguageInstruction(contentLanguage),
        "",
        attachmentBlock,
        "",
        "=== CURRENT POST (READ-ONLY CONTEXT — do NOT change these fields) ===",
        `Post #${current.postNumber || "?"}`,
        `Platform: ${current.platform || ""}`,
        `Format: ${current.format || ""}`,
        (current.hookTitle || current.suggestedHook)  ? `Hook / Title: ${current.hookTitle || current.suggestedHook}` : null,
        current.mainAngle    ? `Main angle: ${current.mainAngle}` : null,
        current.coreMessage  ? `Core message: ${current.coreMessage}` : null,
        (current.caption || current.suggestedCaption) ? `Caption: ${current.caption || current.suggestedCaption}` : null,
        current.contentStructure ? `Content structure: ${current.contentStructure}` : null,
        current.visualDirection  ? `Visual direction: ${current.visualDirection}` : null,
        currentOitrDisplay       ? `Current image text: ${currentOitrDisplay}` : null,
        "",
        normalizedReasons.length ? `=== GUIDED REASONS ===\n${normalizedReasons.map(r => `- ${r}`).join("\n")}` : null,
        guidedFeatures?.length   ? `=== GUIDED FEATURES ===\n${guidedFeatures.map(f => `- ${f}`).join("\n")}` : null,
        imageTextInstruction?.trim() ? `=== EXTRA INSTRUCTION ===\n${imageTextInstruction.trim()}` : null,
        "",
        "=== TASK ===",
        "Regenerate outputImageTextRequirementsStructured to produce better, more specific on-image copy for this post.",
        normalizedReasons.length ? `Address ALL of the following identified issues: ${normalizedReasons.join("; ")}.` : null,
        guidedFeatures?.length   ? `Ensure these specific improvements are reflected: ${guidedFeatures.join("; ")}.` : null,
        imageTextInstruction?.trim() ? `Also apply this extra instruction: ${imageTextInstruction.trim()}` : null,
        "The Image Text MUST accurately reflect hookTitle, coreMessage, mainAngle, contentStructure, caption, and visualDirection.",
        "Do NOT return or modify hookTitle, mainAngle, coreMessage, caption, contentStructure, visualDirection, hashtags, or any other field.",
        "",
        "=== OUTPUT IMAGE TEXT REQUIREMENTS ===",
        ...buildOutputImageTextRules(isCarousel, isVideo),
        "",
        "Return ONLY valid JSON matching this exact structure (no markdown, no code blocks):",
        "{",
        '  "postNumber": (keep same),',
        isVideo
          ? '  "outputImageTextRequirementsStructured": { "type": "video", "items": [] } — or one item with on-screen text ONLY if a thumbnail/end card needs it,'
          : isCarousel
            ? '  "outputImageTextRequirementsStructured": { "type": "carousel", "slides": [ { "slideNumber": 1, "slideRole": "Hook", "fields": { "main_headline": "...", "badge_or_label": "..." } }, { "slideNumber": 2, "slideRole": "...", "fields": { "main_headline": "topic from contentStructure", "supporting_text": "..." } }, ... one entry per contentStructure slide, sequential 1..N, final slide usually carrying call_to_action ] },'
            : '  "outputImageTextRequirementsStructured": { "type": "static", "items": [ { "main_headline": "the strongest on-image hook (not just hookTitle restated)", "subheadline": "a specific supporting detail, step, stat, or benefit — not a restatement of coreMessage", "badge_or_label": "a meaningful on-image label/callout (not the raw mainAngle value)", "call_to_action": "from caption CTA if present" } ] },',
        '  "imageText": ""',
        "}",
      ].filter(v => v !== null && v !== false && v !== undefined).join("\n");
    } else {
      const isVisualScope = scope === "visual_only" || scope === "visual_ideas_only";
      const scopeLabel = isVisualScope
        ? "Regenerate ONLY the visual direction, output image text requirements, and related design and video production fields. Keep hookTitle, coreMessage, mainAngle, caption, and hashtags exactly as they are."
        : "Regenerate the entire post content, visuals, and production fields.";

      userInput = [
        "=== BRAND ===",
        brandSummary,
        "",
        "=== LANGUAGE INSTRUCTION ===",
        buildLanguageInstruction(contentLanguage),
        "",
        "=== CURRENT POST (keep postNumber, date, platform, format unchanged) ===",
        `Post #${current.postNumber || "?"}`,
        `Platform: ${current.platform || ""}`,
        `Format: ${current.format || ""}`,
        (current.hookTitle || current.suggestedHook) ? `Hook / Title: ${current.hookTitle || current.suggestedHook}` : null,
        current.mainAngle    ? `Main angle: ${current.mainAngle}` : null,
        current.coreMessage  ? `Core message: ${current.coreMessage}` : null,
        (current.caption || current.suggestedCaption) ? `Caption: ${current.caption || current.suggestedCaption}` : null,
        current.contentStructure ? `Content structure: ${current.contentStructure}` : null,
        current.visualDirection ? `Current visual direction: ${current.visualDirection}` : null,
        "",
        "=== CALENDAR CONTEXT ===",
        calendarContext?.mainMonthlySubject ? `Monthly subject: ${calendarContext.mainMonthlySubject}` : null,
        calendarContext?.mainGoal           ? `Main goal: ${calendarContext.mainGoal}` : null,
        calendarContext?.mainOfferOrMessage ? `Offer / message: ${calendarContext.mainOfferOrMessage}` : null,
        "",
        attachmentBlock,
        "",
        `=== TASK: ${scopeLabel} ===`,
        isVisualScope
          ? "IMPORTANT: outputImageTextRequirements MUST be regenerated using the hookTitle, coreMessage, mainAngle, contentStructure, and updated visualDirection above."
          : null,
        isVideo
          ? "IMPORTANT: narrationOrDialogueOfCharacterOrCharacters MUST be regenerated as a complete voiceover or dialogue script — cover hook/title, core message, main angle, promised value, key supporting points, and CTA/closing line where relevant. A one-line placeholder is not acceptable."
          : null,
        "",
        "=== CAPTION GENERATION RULES ===",
        "  - At least 5 visible lines of substantive content",
        "  - Maximum 3 paragraphs, separated by natural blank line breaks",
        "  - Always include a clear call-to-action in the final paragraph",
        "  - Do not artificially shorten captions to a fixed character limit — let content and depth dictate the length",
        "  - Use natural line breaks between paragraphs to improve readability",
        "",
        "CAPTION DEPTH BY POST TYPE:",
        "  - Educational posts (mainAngle: education): captions must be more detailed than regular posts. Use longer explanations, practical examples, steps, reasons, mini-frameworks, or key takeaways. Aim for at least 2 substantial paragraphs when the content supports it. Do not add filler — useful depth only.",
        "  - Static posts: Since a static post has only one visual, the caption must carry more explanation and context. Include a hook/opening, explanation/context, practical value or proof, and a CTA. Aim for at least 2 substantial paragraphs when the content supports it.",
        "  - Educational static posts: Receive the richest captions — usually 2-3 substantial paragraphs with explanation, practical value, and a clear next step.",
        "  - Other posts: Follow the base rules above (at least 5 visible lines, max 3 paragraphs, ending with CTA).",
        "",
        "=== OUTPUT IMAGE TEXT REQUIREMENTS ===",
        ...buildOutputImageTextRules(isCarousel, isVideo),
        "",
        ...buildJsonHint(isCarousel, isVideo),
      ].filter(v => v !== null && v !== false && v !== undefined).join("\n");
    }
 
    // ── Call AI ───────────────────────────────────────────────────────────────
    let aiResult;
    try {
      aiResult = await generateWithPromptTemplate({
        templateSlug: "content-calendar-generator",
        variables: {},
        userInput,
        maxTokens: 2000,
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
    const hashtags = (() => {
      const v = merged.hashtags;
      if (Array.isArray(v)) return v;
      if (typeof v === "string" && v.trim()) return v.split(/[\s,]+/).filter(Boolean);
      return [];
    })();
    merged.hashtags = hashtags;

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
