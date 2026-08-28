// Shared prompt-assembly for AI post regeneration.
//
// Single source of truth for BOTH regeneration routes:
//   - app/api/content-calendar/regenerate-post/route.js  (pre-save, Review step)
//   - app/api/calendar-posts/[id]/regenerate/route.js    (saved post detail)
//
// The two routes previously carried near-identical copies of these builders
// and had already drifted apart. Consolidation keeps their prompts identical
// and makes the assembled provider input directly testable.
//
// ⚠ Server-side only in spirit: pure string builders, no DB or network access,
// so they are safe to import from deterministic tests.

import {
  CAPTION_GENERATION_RULES_LINES,
  createCompactToneInformationSummary,
} from "./calendar-post-utils.js";
import { buildLanguageInstruction } from "./content-language.js";

// ── Scope → allowed updatable fields ──────────────────────────────────────────
// visual_only / visual_ideas_only : visual and video production fields only
// entire_post                     : all content + visual fields
// custom_instruction              : all fields including format (AI follows user instruction)
// image_text_only                 : on-image text fields only

export const VISUAL_FIELDS = [
  "contentStructure", "visualDirection", "outputImageTextRequirements", "outputImageTextRequirementsStructured",
  "imageText", "structure", "inspiration",
  "videoConceptTitleAndThumbnailTitleIdea", "videoRawIdea",
  "mainIntegratedScenario", "thumbnailIdeaForReel",
  "narrationOrDialogueOfCharacterOrCharacters", "rawImageIdeaForFirstFrame",
  "whatHappens", "characterObjectOrEnvironmentAction",
  "cameraMovement", "speedRamp", "camera", "lens", "focalLength", "aperture",
  "visualMood", "textOnVideo",
];

export const CONTENT_FIELDS = [
  "hookTitle", "mainAngle", "coreMessage", "caption", "hashtags",
];

export const SCOPE_FIELDS = {
  visual_only:        VISUAL_FIELDS,
  visual_ideas_only:  VISUAL_FIELDS,
  entire_post:        [...CONTENT_FIELDS, ...VISUAL_FIELDS],
  custom_instruction: ["format", ...CONTENT_FIELDS, ...VISUAL_FIELDS],
  image_text_only:    ["outputImageTextRequirementsStructured", "outputImageTextRequirements", "imageText"],
};

export const CUSTOM_INSTRUCTION_CLEARABLE_FIELDS = new Set([
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

// ── Merge scoped AI output into original post ─────────────────────────────────
// Applies only allowed fields. Never overwrites postNumber or technical IDs.
export function applyScopedPostRegeneration(original, aiPost, scope) {
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
  result.postNumber = original.postNumber; // always preserve
  return result;
}

// ── Parse AI JSON output ──────────────────────────────────────────────────────
export function parseAiJson(raw) {
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

// ── Brand summary ─────────────────────────────────────────────────────────────
// Regeneration needs BOTH visual identity (for visual direction fields) and
// tone/brand data (for hooks, captions, angles) — build a balanced summary
// covering both sections rather than dumping raw JSON.

import { normalizeBrandIdentityOutput, createCompactBrandVisualIdentitySummaryForImagePrompt } from "./brand-identity-utils.js";

export function buildBrandSummary(identity, brand) {
  if (!identity) {
    return [
      brand.name           && `Brand: ${brand.name}`,
      brand.businessType   && `Type: ${brand.businessType}`,
      brand.brandTone      && `Tone: ${brand.brandTone}`,
      brand.targetAudience && `Audience: ${brand.targetAudience}`,
      brand.mainServicesOrProducts && `Services: ${brand.mainServicesOrProducts}`,
      brand.brandVisualStyle && `Visual style: ${brand.brandVisualStyle}`,
      brand.website         && `Website: ${brand.website}`,
      brand.instagramPage   && `Instagram: ${brand.instagramPage}`,
      brand.linkedinPage    && `LinkedIn: ${brand.linkedinPage}`,
      brand.facebookPage    && `Facebook: ${brand.facebookPage}`,
      brand.businessLocation && `Location: ${brand.businessLocation}`,
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

// ── Targeted-edit preservation contract ───────────────────────────────────────
// The core fix for "minor instruction rewrote the whole post": custom-instruction
// regeneration defaults to surgical-edit semantics, with an explicit escape
// hatch so genuine full-rewrite requests still work.

export const TARGETED_EDIT_RULES_LINES = [
  "4. TARGETED EDIT vs FULL REWRITE — detect the instruction's intent before writing:",
  "   • DEFAULT — TARGETED EDIT. Most instructions are small edits (e.g. \"add this point\", \"mention X\", \"make this sentence shorter\", \"change the CTA\", \"make the second speaker more confident\", \"make the background darker\"). For these:",
  "     – Preserve the existing topic, concept, intent, structure, factual content, numbers, dates, CTA, contact details, and hashtags unless the instruction explicitly asks to change them.",
  "     – Change ONLY the parts necessary to satisfy the instruction. Reuse the existing wording wherever possible.",
  "     – NEVER rewrite an entire caption, headline, or script for a small edit — return the original text with only the requested modification applied.",
  "     – Do not remove existing useful information unless the instruction requires it.",
  "     – Dialogue/narration edits: keep the scene, concept, speakers, and unaffected lines exactly as they are; modify only the requested part; keep speaker intent and continuity consistent. Do not create a totally new dialogue unless explicitly requested.",
  "     – Visual edits: apply the requested change ON TOP of the existing visual direction; keep the subject, composition, layout system, branding, and CTA concept unless they directly conflict with the instruction.",
  "   • FULL REWRITE — allowed ONLY when the instruction explicitly requests it (e.g. \"rewrite completely\", \"replace the concept\", \"create a new version\", \"regenerate the entire post\", \"start over\"). Then you may regenerate broadly while staying aligned with the brand, calendar strategy, and uploaded reference material.",
  "   • UNCHANGED FIELDS MUST BE RETURNED VERBATIM: when a field does not need to change, copy its CURRENT value from the CURRENT POST section above exactly — do not paraphrase, polish, translate, reorder, or 'improve' untouched fields.",
];

// ── Current-post context lines ────────────────────────────────────────────────
// Complete existing-post context for targeted editing: text, hashtags, dialogue,
// video production, and visual fields. Fields absent from the post are omitted
// rather than emitted empty, so prompts stay relevant per mode.

export function buildCurrentPostContextLines(current, currentOitrDisplay) {
  const cinematic = [
    current.cameraMovement, current.speedRamp, current.camera,
    current.lens, current.focalLength, current.aperture,
  ].filter(Boolean).join(" | ");

  return [
    `Post #${current.postNumber || "?"}`,
    `Platform: ${current.platform || ""}`,
    `Format: ${current.format || ""}`,
    (current.hookTitle || current.suggestedHook) ? `Hook / Title: ${current.hookTitle || current.suggestedHook}` : null,
    current.mainAngle ? `Main angle: ${current.mainAngle}` : null,
    current.coreMessage ? `Core message: ${current.coreMessage}` : null,
    (current.caption || current.suggestedCaption) ? `Caption: ${current.caption || current.suggestedCaption}` : null,
    current.hashtags
      ? `Hashtags: ${Array.isArray(current.hashtags) ? current.hashtags.join(" ") : current.hashtags}`
      : null,
    current.visualDirection ? `Visual direction: ${current.visualDirection}` : null,
    current.contentStructure ? `Content structure: ${current.contentStructure}` : null,
    currentOitrDisplay ? `Output image text: ${currentOitrDisplay}` : null,
    current.structure ? `Structure: ${current.structure}` : null,
    current.inspiration ? `Inspiration: ${current.inspiration}` : null,
    current.narrationOrDialogueOfCharacterOrCharacters ? `Narration/dialogue script: ${current.narrationOrDialogueOfCharacterOrCharacters}` : null,
    current.videoConceptTitleAndThumbnailTitleIdea ? `Video concept & thumbnail title idea: ${current.videoConceptTitleAndThumbnailTitleIdea}` : null,
    current.videoRawIdea ? `Video raw idea: ${current.videoRawIdea}` : null,
    current.mainIntegratedScenario ? `Main integrated scenario: ${current.mainIntegratedScenario}` : null,
    current.thumbnailIdeaForReel ? `Thumbnail idea for Reel: ${current.thumbnailIdeaForReel}` : null,
    current.rawImageIdeaForFirstFrame ? `Raw image idea for first frame: ${current.rawImageIdeaForFirstFrame}` : null,
    current.whatHappens ? `What happens: ${current.whatHappens}` : null,
    current.characterObjectOrEnvironmentAction ? `Character/object/environment action: ${current.characterObjectOrEnvironmentAction}` : null,
    cinematic ? `Camera settings (movement | speed ramp | camera | lens | focal length | aperture): ${cinematic}` : null,
    current.visualMood ? `Visual mood: ${current.visualMood}` : null,
    current.textOnVideo ? `Text on video: ${current.textOnVideo}` : null,
  ].filter(v => v !== null && v !== undefined);
}

function calendarContextLines(calendarCtx) {
  return [
    calendarCtx?.mainMonthlySubject ? `Monthly subject: ${calendarCtx.mainMonthlySubject}` : null,
    calendarCtx?.mainGoal           ? `Main goal: ${calendarCtx.mainGoal}` : null,
    calendarCtx?.mainOfferOrMessage ? `Offer / message: ${calendarCtx.mainOfferOrMessage}` : null,
  ].filter(Boolean);
}

// ── Output image text requirements rules preamble (all scopes) ────────────────
// Mirrors the OUTPUT IMAGE TEXT REQUIREMENTS GENERATION RULES used by initial
// generation — same structured schema, same derivation hierarchy — so
// regeneration never produces weaker results than the original generation pass.

export function buildOutputImageTextRules(isCarousel, isVideo) {
  const shared = [
    "outputImageTextRequirementsStructured is a STRATEGIC field — the exact on-image text plan, derived in this priority order from: (1) Format, (2) Hook/Title, (3) Main Angle + Core Message, (4) Content Structure, (5) Visual Direction.",
    "Return a real structured object (NOT a string): { type: 'static'|'carousel'|'video', items: [...] } for static/video, or { type: 'carousel', slides: [ { slideNumber, slideRole, fields } ] } for carousel.",
    "Each item/slide `fields` uses ONLY these keys (omit any without real content): main_headline, subheadline, supporting_text, sub_supporting_text_1, sub_supporting_text_2, call_to_action, badge_or_label, offer_or_promotion, date_or_time, website_or_contact, logo_text, additional_text_notes. Never return a key with an empty string — omit it entirely.",
    "Never repeat the same headline (or near-identical phrasing) across slides/items. Never copy the full caption into on-image text — on-image text is substantive and stands on its own; the caption is a separate field entirely. Never invent offers, dates, or contact info that aren't in the brand identity, campaign details, or caption.",
    "AVOID GENERIC RESTATEMENT (CRITICAL): do NOT simply copy hookTitle into main_headline, coreMessage into subheadline, and mainAngle into badge_or_label — pull out the SPECIFIC fact, step, number, benefit, mistake, quote, or detail that makes this post's image useful.",
    "badge_or_label must be a meaningful on-image label (a real step name, stat, category, or callout) — never a generic content-type tag like 'Educational Insight', 'Tip', or 'Did You Know', and never the raw mainAngle value, unless that exact phrase is genuinely meant to appear on the image.",
    "subheadline/supporting_text must add information BEYOND the headline — a concrete detail, step, number, benefit, or reason to care, never a vaguer restatement of the headline or coreMessage. Never use placeholder text ('N/A', 'Coming soon', 'Educational Insight', etc.).",
    "For educational/how-it-works/process/consultation posts, pull the ACTUAL steps, stages, checklist items, mistakes, or takeaways from contentStructure or the caption. For testimonial/proof posts, use a short concrete quote or result from the caption — never invented. Keep on-image text design-ready and substantive: main_headline should make a complete, specific claim; subheadline / supporting_text must add concrete value beyond the headline — use the space to be useful rather than artificially brief.",
    "sub_supporting_text_1 and sub_supporting_text_2 are optional depth fields. Use sub_supporting_text_1 on informative middle slides to add a second layer of detail, explanation, or context beyond supporting_text. Use sub_supporting_text_2 on the most detailed slides for a third layer — a specific proof point, warning, statistic, example, or mini-step. Hook/CTA slides should omit these fields and stay concise.",
  ];

  if (isVideo) {
    return [
      ...shared,
      "This is a VIDEO/REEL post: return { type: 'video', items: [] } unless a thumbnail or end card needs on-screen text. If it does, return ONE item using only main_headline, subheadline, supporting_text, sub_supporting_text_1, sub_supporting_text_2, call_to_action, badge_or_label, website_or_contact, logo_text, additional_text_notes — set additional_text_notes to 'Use as thumbnail, cover, or end card only.'",
    ];
  }
  if (isCarousel) {
    return [
      ...shared,
      "This is a CAROUSEL post: return { type: 'carousel', slides: [...] } with EXACTLY one slide per slide in contentStructure — never fewer, never more, never skipped. Slide numbers must be sequential 1..N with no gaps or duplicates.",
      "Slide 1's main_headline is derived from hookTitle — sharpened into the strongest on-image claim, not copied verbatim. The final slide should usually carry call_to_action pulled from the caption's actual CTA.",
      "CAROUSEL MIDDLE SLIDES (MANDATORY): Every middle slide MUST include both main_headline AND at least one of supporting_text or subheadline — never return main_headline alone for a middle slide. The supporting_text or subheadline must pull a SPECIFIC detail, benefit, step, stat, concrete claim, or mini-explanation from that slide's OWN Content Structure entry. A vague one-liner or generic restatement is not acceptable.",
      "For educational carousel slides, add sub_supporting_text_1 to most middle/informative slides and sub_supporting_text_2 to the most complex slides to provide deeper explanation, practical examples, or proof points. Hook and CTA slides should stay concise.",
      "For informative middle slides, consider adding sub_supporting_text_1 (and sub_supporting_text_2 for the most detailed slides) to add deeper explanation, context, or supporting points — hook/CTA slides should omit these and stay concise.",
      "`slideRole` is a short label for the slide's role in the flow (e.g. 'Hook', 'Tip 1', 'Proof', 'CTA'). Match the Visual Direction's style (checklist → short list-style lines, comparison → compare/contrast phrasing, steps → numbered action phrasing) and the Main Angle's tone (education → explain/teach, promotion → offer + CTA, trust → proof/credibility).",
      "CAROUSEL QUALITY EXAMPLE — middle slide: GOOD: { main_headline: 'Plan Your Social Content Early', supporting_text: 'Get match-day posts ready 2 weeks before kickoff', sub_supporting_text_1: 'Create a content checklist for each match — types of posts, required visuals, approval flow.', sub_supporting_text_2: 'Pro tip: Batch-create 3 months of evergreen posts to free up time for real-time coverage.' } | BETTER: same but with sub_supporting_text depth | BAD: { main_headline: 'Plan your content' } — headline only with no supporting detail.",
    ];
  }
  return [
    ...shared,
    "This is a STATIC IMAGE post: return { type: 'static', items: [ { ...fields } ] } with exactly ONE item. main_headline is the strongest on-image hook (often derived from hookTitle, but rephrase if a more specific angle fits better); subheadline/supporting_text is a SPECIFIC detail, step, stat, or benefit beyond coreMessage — never a restatement; badge_or_label is a meaningful on-image label/callout for THIS post — never the raw mainAngle value; call_to_action only if the caption has a clear, specific CTA.",
  ];
}

export function buildOutputImageTextRulesForCustomInstruction() {
  return [
    ...buildOutputImageTextRules(false, false),
    "CRITICAL — FORMAT-AWARE IMAGE TEXT: Choose the correct type based on the FINAL format you return — not the original post format.",
    "If final format is Carousel → return { type: 'carousel', slides: [...] } with EXACTLY one slide per slide in contentStructure. Slide 1's main_headline from hookTitle (sharpened). Each middle slide MUST include both main_headline AND at least one of supporting_text or subheadline — pull a specific detail, benefit, step, or claim from that slide's own contentStructure entry. For educational carousel slides, add sub_supporting_text_1 to most middle/informative slides and sub_supporting_text_2 to the most complex slides for deeper explanation, practical examples, or proof points. Hook and CTA slides should stay concise. Final slide usually carries call_to_action. slideRole is a short label (e.g. 'Hook', 'Tip 1', 'CTA').",
    "If final format is Reel/video/story → return { type: 'video', items: [] } unless a thumbnail or end card needs on-screen text. If so, return ONE item — set additional_text_notes to 'Use as thumbnail, cover, or end card only.'",
    "If final format is Static Image → return { type: 'static', items: [ { ...fields } ] } with exactly ONE item. main_headline is the strongest on-image hook; subheadline/supporting_text is a specific detail; badge_or_label is a meaningful callout; call_to_action only if caption has a clear CTA.",
    "NEVER return { type: 'static' } when final format is carousel. NEVER return { type: 'carousel' } when final format is static or video.",
  ];
}

// ── Shared JSON schema hint for all scopes ────────────────────────────────────
export function buildJsonHint(isCarousel, isVideo) {
  const oitrHint = isVideo
    ? '  "outputImageTextRequirementsStructured": { "type": "video", "items": [] } — or one item with on-screen text ONLY if a thumbnail/end card needs it (see rules above),\n'
    : isCarousel
      ? '  "outputImageTextRequirementsStructured": { "type": "carousel", "slides": [ { "slideNumber": 1, "slideRole": "Hook", "fields": { "main_headline": "sharpened hook from hookTitle", "badge_or_label": "short label" } }, { "slideNumber": 2, "slideRole": "Tip 1", "fields": { "main_headline": "specific claim from this slide in contentStructure", "supporting_text": "concrete detail or benefit — REQUIRED for every middle slide", "sub_supporting_text_1": "additional depth when the slide needs more explanation (optional)", "sub_supporting_text_2": "second useful detail, proof point, warning, or example when needed (optional)" } }, ... one entry per contentStructure slide, sequential 1..N — every middle slide MUST have main_headline + supporting_text or subheadline, final slide usually carrying call_to_action ] },\n'
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
    '  "caption": "detailed caption — at least 5 lines, maximum 3 paragraphs, ending with CTA. Do NOT include hashtags in this field — they go in the separate hashtags field below and are appended automatically.",',
    '  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],',
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

export function buildJsonHintForCustomInstruction() {
  const oitrHint = [
    '  "outputImageTextRequirementsStructured": — choose type based on FINAL format:',
    '    carousel → { "type": "carousel", "slides": [ { "slideNumber": 1, "slideRole": "Hook", "fields": { "main_headline": "sharpened hook", "badge_or_label": "label" } }, { "slideNumber": 2, "slideRole": "Tip 1", "fields": { "main_headline": "specific claim from this slide in contentStructure", "supporting_text": "concrete detail or benefit — REQUIRED for every middle slide", "sub_supporting_text_1": "additional depth when the slide needs more explanation (optional)", "sub_supporting_text_2": "second useful detail, proof point, warning, or example when needed (optional)" } }, ... one entry per contentStructure slide, sequential 1..N — every middle slide MUST have main_headline + supporting_text or subheadline, final slide usually with call_to_action ] }',
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
    '  "caption": "detailed caption — at least 5 lines, maximum 3 paragraphs, ending with CTA. Do NOT include hashtags in this field — they go in the separate hashtags field below and are appended automatically.",',
    '  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],',
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

const CAPTION_DEPTH_LINES = [
  "",
  "CAPTION DEPTH BY POST TYPE:",
  "  - Educational posts (mainAngle: education): captions must be more detailed than regular posts. Use longer explanations, practical examples, steps, reasons, mini-frameworks, or key takeaways. Aim for at least 2 substantial paragraphs when the content supports it. Do not add filler — useful depth only.",
  "  - Static posts: Since a static post has only one visual, the caption must carry more explanation and context. Include a hook/opening, explanation/context, practical value or proof, and a CTA. Aim for at least 2 substantial paragraphs when the content supports it.",
  "  - Educational static posts: Receive the richest captions — usually 2-3 substantial paragraphs with explanation, practical value, and a clear next step.",
  "  - Other posts: Follow the base rules above (at least 5 visible lines, max 3 paragraphs, ending with CTA).",
];

// ── custom_instruction scope userInput ────────────────────────────────────────
export function buildCustomInstructionUserInput({
  current,
  currentOitrDisplay,
  brandSummary,
  contentLanguage,
  calendarContext,
  attachmentBlock,
  customInstruction,
}) {
  return [
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
    ...calendarContextLines(calendarContext),
    "",
    attachmentBlock,
    "",
    "=== CURRENT POST ===",
    ...buildCurrentPostContextLines(current, currentOitrDisplay),
    "",
    "=== USER INSTRUCTION ===",
    customInstruction.trim(),
    "",
    "=== RULES ===",
    "1. Follow the user instruction above carefully and completely.",
    "2. NEVER change postNumber — preserve it exactly.",
    "3. Keep the post aligned with the brand, audience, platform, and calendar strategy.",
    ...TARGETED_EDIT_RULES_LINES,
    "5. INTENT-AWARE FIELD SELECTION — apply only what the instruction requires:",
    "   • Copy/wording change only (rewrite caption, new headline, adjust tone): update hookTitle, mainAngle, coreMessage, caption, hashtags. Leave visual, format, and video production fields unchanged.",
    "   • Visual-only change (different style, colors, mood, layout): update visualDirection and outputImageTextRequirementsStructured. Leave format, copy, and video production fields unchanged.",
    "   • Dialogue/narration-only change: update narrationOrDialogueOfCharacterOrCharacters only. Leave copy, visual, format, and other video production fields unchanged.",
    "   • Format/structure change (static → carousel, static → Reel, carousel → static, change to video, etc.): update ALL dependent fields required for consistency — see Rule 6.",
    "6. FORMAT CHANGE CONSISTENCY — when format changes (or the instruction converts one post type to another), regenerate and align ALL of these fields:",
    "   • format (the new requested format)",
    "   • contentStructure (must match new format: slide list for carousel, scene breakdown for Reel, single-image layout for static)",
    "   • visualDirection (must describe the new format: per-slide carousel system, Reel scene mood, or static composition)",
    "   • structure (must reflect new format: 'carousel layout' / 'Reel' / 'static image' — not the old format label)",
    "   • outputImageTextRequirementsStructured (type and slides/items must match new format — see Rule 7)",
    "   • video production fields and narrationOrDialogueOfCharacterOrCharacters — fill completely if new format is Reel/video",
    "   • clear video production fields (set to empty string \"\") if new format is NOT Reel/video and those fields are no longer relevant",
    "7. IMAGE TEXT FORMAT ALIGNMENT (CRITICAL) — outputImageTextRequirementsStructured type MUST match the FINAL format you return:",
    "   • Final format is carousel → type MUST be 'carousel' with slides array, one slide per contentStructure slide — NEVER return type 'static'",
    "   • Final format is Reel/video → type MUST be 'video' with items array — NEVER return type 'carousel' or 'static'",
    "   • Final format is static → type MUST be 'static' with exactly one item — NEVER return type 'carousel'",
    "8. Return only this one updated post — not a full calendar.",
    "9. Return only valid JSON. Do not use markdown. Do not use code blocks.",
    "10. If the instruction asks to change Image Text, image copy, on-image text, headline text, overlay text, slide text, or visual copy, you MUST return a new outputImageTextRequirementsStructured object. Follow the OUTPUT IMAGE TEXT REQUIREMENTS rules below exactly.",
    "",
    "If the instruction modifies or regenerates the caption, the new caption must follow these rules:",
    ...CAPTION_GENERATION_RULES_LINES,
    ...CAPTION_DEPTH_LINES,
    "",
    "=== OUTPUT IMAGE TEXT REQUIREMENTS ===",
    ...buildOutputImageTextRulesForCustomInstruction(),
    "",
    ...buildJsonHintForCustomInstruction(),
  ].filter(v => v !== null && v !== false && v !== undefined).join("\n");
}

// ── image_text_only scope userInput ───────────────────────────────────────────
export function buildImageTextOnlyUserInput({
  current,
  currentOitrDisplay,
  brandSummary,
  contentLanguage,
  attachmentBlock,
  guidedReasons,
  guidedFeatures,
  imageTextInstruction,
}) {
  const normalizedReasons = Array.isArray(guidedReasons) && guidedReasons.length
    ? guidedReasons
    : [];
  const fmtLower = (current.format || "").toLowerCase();
  const isCarousel = fmtLower.includes("carousel");
  const isVideo = /reel|story|video|live/.test(fmtLower);

  return [
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
    ...buildCurrentPostContextLines(current, currentOitrDisplay),
    "",
    normalizedReasons.length ? `=== GUIDED REASONS ===\n${normalizedReasons.map(r => `- ${r}`).join("\n")}` : null,
    guidedFeatures?.length ? `=== GUIDED FEATURES ===\n${guidedFeatures.map(f => `- ${f}`).join("\n")}` : null,
    imageTextInstruction?.trim() ? `=== EXTRA INSTRUCTION ===\n${imageTextInstruction.trim()}` : null,
    "",
    "=== TASK ===",
    "Regenerate ONLY the outputImageTextRequirementsStructured to produce better, more specific on-image copy for this post.",
    "PRESERVE the post idea, hook, core message, caption, hashtags, visual direction, video fields, schedule, and source/reference exactly as they are.",
    normalizedReasons.length ? `Address ALL of the following identified issues: ${normalizedReasons.join("; ")}.` : null,
    guidedFeatures?.length ? `Ensure these specific improvements are reflected: ${guidedFeatures.join("; ")}.` : null,
    imageTextInstruction?.trim() ? `Also apply this extra instruction: ${imageTextInstruction.trim()}` : null,
    "The Image Text MUST accurately reflect hookTitle, coreMessage, mainAngle, contentStructure, caption, and visualDirection.",
    "DEPTH BEHAVIOR (CRITICAL): When the user asks for deeper, more detail, richer text, supporting details, sub-supporting text, or more insight: add sub_supporting_text_1 to most middle/informative carousel slides and sub_supporting_text_2 to at least some complex slides where useful. Keep hook/CTA slides shorter. Preserve the existing slide concept — do not replace the post idea or only rewrite headlines. Expand the existing image text rather than replacing the entire slide concept or copying text from hookTitle or caption verbatim.",
    "Do NOT return or modify hookTitle, mainAngle, coreMessage, caption, contentStructure, visualDirection, hashtags, platform, format, date, postNumber, or any other field outside image text.",
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
        ? '  "outputImageTextRequirementsStructured": { "type": "carousel", "slides": [ { "slideNumber": 1, "slideRole": "Hook", "fields": { "main_headline": "...", "badge_or_label": "..." } }, { "slideNumber": 2, "slideRole": "...", "fields": { "main_headline": "topic from contentStructure", "supporting_text": "...", "sub_supporting_text_1": "additional explanation or context for this slide (optional)", "sub_supporting_text_2": "second useful detail, proof point, warning, or example when needed (optional)" } }, ... one entry per contentStructure slide, sequential 1..N, final slide usually carrying call_to_action ] },'
        : '  "outputImageTextRequirementsStructured": { "type": "static", "items": [ { "main_headline": "the strongest on-image hook (not just hookTitle restated)", "subheadline": "a specific supporting detail, step, stat, or benefit — not a restatement of coreMessage", "badge_or_label": "a meaningful on-image label/callout (not the raw mainAngle value)", "call_to_action": "from caption CTA if present" } ] },',
    '  "imageText": ""',
    "}",
  ].filter(v => v !== null && v !== false && v !== undefined).join("\n");
}

// ── visual_only / visual_ideas_only / entire_post scope userInput ─────────────
export function buildVisualOrEntirePostUserInput({
  scope,
  current,
  currentOitrDisplay,
  brandSummary,
  contentLanguage,
  calendarContext,
  attachmentBlock,
}) {
  const isVisualScope = scope === "visual_only" || scope === "visual_ideas_only";
  const fmtLower = (current.format || "").toLowerCase();
  const isCarousel = fmtLower.includes("carousel");
  const isVideo = /reel|story|video|live/.test(fmtLower);

  const taskLines = isVisualScope
    ? [
        "Regenerate ONLY the visual direction, output image text requirements, and related design and video production fields. Keep hookTitle, coreMessage, mainAngle, caption, and hashtags exactly as they are.",
        "CONTINUITY REQUIREMENT: build ON TOP of the CURRENT visual direction above — evolve it rather than discarding unrelated requirements. Preserve the post concept, campaign intent, subject/product/service presentation, composition system, and branding unless they directly conflict with producing better visuals for this post.",
        "IMPORTANT: outputImageTextRequirements MUST be regenerated using the hookTitle, coreMessage, mainAngle, contentStructure, and updated visualDirection above.",
      ]
    : [
        "Regenerate the entire post content, visuals, and production fields.",
        "You may regenerate broadly — this is a full rewrite of the post while staying aligned with the brand, calendar strategy, and uploaded reference material.",
      ];

  return [
    "=== BRAND ===",
    brandSummary,
    "",
    "=== LANGUAGE INSTRUCTION ===",
    buildLanguageInstruction(contentLanguage),
    "",
    "=== CURRENT POST (keep postNumber, date, platform, format unchanged) ===",
    ...buildCurrentPostContextLines(current, currentOitrDisplay),
    "",
    "=== CALENDAR CONTEXT ===",
    ...calendarContextLines(calendarContext),
    "",
    attachmentBlock,
    "",
    `=== TASK: ${isVisualScope ? "Regenerate visual direction and production fields" : "Full post regeneration"} ===`,
    ...taskLines,
    isVideo
      ? "IMPORTANT: narrationOrDialogueOfCharacterOrCharacters MUST be regenerated as a complete voiceover or dialogue script — cover hook/title, core message, main angle, promised value, key supporting points, and CTA/closing line where relevant. A one-line placeholder is not acceptable."
      : null,
    "",
    ...CAPTION_GENERATION_RULES_LINES,
    ...CAPTION_DEPTH_LINES,
    "",
    "=== OUTPUT IMAGE TEXT REQUIREMENTS ===",
    ...buildOutputImageTextRules(isCarousel, isVideo),
    "",
    ...buildJsonHint(isCarousel, isVideo),
  ].filter(v => v !== null && v !== false && v !== undefined).join("\n");
}
