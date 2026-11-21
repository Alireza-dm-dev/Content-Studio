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
import {
  SLIDE_COUNT_FIELDS,
  extractSourceSlides,
  formatSourceSlidesForPrompt,
  parseExplicitDrops,
} from "./calendar-slide-count.js";

// ── Scope → allowed updatable fields ──────────────────────────────────────────
// visual_only / visual_ideas_only : visual and video production fields only
// entire_post                     : all content + visual fields
// custom_instruction              : all fields including format (AI follows user instruction)
// image_text_only                 : on-image text fields only
// enrich_post                     : textual content only — deepen the SAME post
// change_slide_count              : the five slide-based fields only — same post, different slide structure

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

// Enrichment deepens the post's written content and nothing else.
// Deliberately excluded:
//   mainAngle  — the post's angle is part of its identity and must survive
//   hashtags   — enrichment is not a hashtag operation; the existing list is
//                re-merged into the enriched caption by the standard policy
//   every visual / image-text / video production field — see VISUAL_FIELDS
export const ENRICHMENT_FIELDS = ["hookTitle", "coreMessage", "caption"];

export const SCOPE_FIELDS = {
  visual_only:        VISUAL_FIELDS,
  visual_ideas_only:  VISUAL_FIELDS,
  // Entire Post rewrites the post's execution, not its strategy: mainAngle is
  // preserved server-side (see applyScopedPostRegeneration).
  entire_post:        [...CONTENT_FIELDS.filter((f) => f !== "mainAngle"), ...VISUAL_FIELDS],
  custom_instruction: ["format", ...CONTENT_FIELDS, ...VISUAL_FIELDS],
  image_text_only:    ["outputImageTextRequirementsStructured", "outputImageTextRequirements", "imageText"],
  enrich_post:        ENRICHMENT_FIELDS,
  change_slide_count: SLIDE_COUNT_FIELDS,
};

// ── Scope → hashtag policy ────────────────────────────────────────────────────
// Three behaviours, decided here rather than in either route:
//
//   rewrites the caption AND owns hashtags  → entire_post, custom_instruction
//       the standard merge runs: the model's hashtags, plus Instagram's
//       exactly-5 padding from known brand context.
//   rewrites the caption but does NOT own hashtags  → enrich_post
//       the existing list is re-attached verbatim — no padding, no derivation.
//   leaves the caption alone  → visual_only, visual_ideas_only, image_text_only
//       caption and hashtags are both untouched.
const HASHTAG_OWNING_SCOPES = new Set(["entire_post", "custom_instruction"]);
const HASHTAG_PRESERVING_SCOPES = new Set(["enrich_post"]);

/** True when the scope rewrites caption text at all (either of the first two). */
export function scopeRewritesCaption(scope) {
  return HASHTAG_OWNING_SCOPES.has(scope) || HASHTAG_PRESERVING_SCOPES.has(scope);
}

/** True when the scope must re-attach the post's existing hashtags unchanged. */
export function scopePreservesHashtags(scope) {
  return HASHTAG_PRESERVING_SCOPES.has(scope);
}

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
// Main Angle policy (server-side, never left to the model):
//   enrich_post, change_slide_count, image_text_only, visual_only,
//   visual_ideas_only, entire_post → mainAngle is never written.
//   custom_instruction → written ONLY when the user's instruction explicitly asks
//   to change the angle (instructionRequestsMainAngleChange), else preserved.
export function applyScopedPostRegeneration(original, aiPost, scope, { allowMainAngleChange = false } = {}) {
  const allowed = (SCOPE_FIELDS[scope] ?? SCOPE_FIELDS.entire_post).filter(
    (f) => f !== "mainAngle" || (scope === "custom_instruction" && allowMainAngleChange),
  );
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

// ── Explicit Main Angle change detection (Custom Instruction only) ────────────
// Deliberately conservative and deterministic: the angle may change only when
// the instruction names the angle/positioning AND asks to change it, or moves
// the post "from <angle> to <angle>". Anything ambiguous preserves the angle.
const ANGLE_WORD = /\b(?:main\s+angle|content\s+angle|strategic\s+angle|post\s+angle|angle|positioning|strategic\s+approach|content\s+strategy)\b|زاویه/i;
const ANGLE_CHANGE_VERB = /\b(?:change|switch|set|turn|convert|shift|move|swap|make|reposition|re-position|update|use)\b|تغییر|عوض/i;
const ANGLE_KEEP = /\b(?:keep|preserve|maintain|retain|same|unchanged|don'?t|do\s+not|without|never)\b[^.!?\n]{0,30}\b(?:angle|positioning)\b/i;
const ANGLE_VOCAB = /^(?:educational|education|informative|teaching|promotional|promotion|sales|sales-led|offer|authority|authority-led|expert|expertise|thought[- ]leadership|trust|trust-building|credibility|problem[/-]?solution|problem|storytelling|story|narrative|inspirational|inspiration|entertaining|entertainment|engagement|community|behind[- ]the[- ]scenes|testimonial|social[- ]proof|awareness|announcement|seasonal|myth[- ]busting|comparison|how[- ]to)$/i;

// Photographic/visual "angles" are not the post's strategic angle.
const VISUAL_ANGLE = /\b(?:camera|shot|shooting|filming|viewing|view|lens|low|high|wide|side|top|overhead|eye[- ]level|dutch|bird'?s[- ]eye|close[- ]up|photo|photography|image|picture|visual|frame|composition)\s+angles?\b/gi;

export function instructionRequestsMainAngleChange(instruction) {
  const text = typeof instruction === "string" ? instruction.replace(VISUAL_ANGLE, " ").trim() : "";
  if (!text) return false;
  if (ANGLE_KEEP.test(text)) return false;
  // "Reposition the post as …" names a positioning change on its own.
  if (/\bre-?position(?:s|ed|ing)?\b/i.test(text)) return true;
  // "Make this problem/solution instead" / "Reframe it as storytelling": a change
  // verb plus a recognised angle name plus explicit replacement wording.
  for (const sentence of text.split(/[.!?\n]+/)) {
    if (!/\b(?:make|turn|convert|rewrite|reframe|switch|change)\b/i.test(sentence)) continue;
    if (!/\binstead\b|\breframe\b|\bas an?\b/i.test(sentence)) continue;
    const words = sentence.toLowerCase().match(/[a-z]+(?:[/-][a-z]+)*/g) || [];
    if (words.some((w) => ANGLE_VOCAB.test(w.replace(/-(?:led|based|focused|driven|first)$/, "")))) return true;
  }
  // "Change the Main Angle to promotional." / "Make the angle problem/solution."
  for (const sentence of text.split(/[.!?\n]+/)) {
    if (ANGLE_WORD.test(sentence) && ANGLE_CHANGE_VERB.test(sentence)) {
      const verbAt = sentence.search(ANGLE_CHANGE_VERB);
      const angleAt = sentence.search(ANGLE_WORD);
      if (verbAt >= 0 && angleAt >= 0 && verbAt < angleAt + 40) return true;
    }
  }
  // "Change this from educational to authority-led."
  const m = /\b(?:change|switch|turn|convert|shift|move|reposition)\b[^.!?\n]*?\bfrom\s+(?:an?\s+|the\s+)?([\w/-]+(?:[ -][\w/-]+)?)\s+(?:post\s+|angle\s+)?to\s+(?:an?\s+|the\s+)?([\w/-]+(?:[ -]led)?)/i.exec(text);
  if (m) {
    const strip = (w) => w.replace(/[-\s](?:led|based|focused|driven|first)$/i, "").trim();
    const a = strip(m[1]), b = strip(m[2]);
    if (ANGLE_VOCAB.test(a) && ANGLE_VOCAB.test(b)) return true;
  }
  return false;
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

// ── Shared post specification (every regeneration mode) ───────────────────────
// One snapshot of the post's STRATEGY, placed before anything else in every
// mode's prompt, so no mode can forget the Main Angle, platform, or format,
// and so the model sees which fields this mode may change before it writes.
// The writable/preserved lists are derived from SCOPE_FIELDS — the same
// whitelist the merge step enforces — so the prompt cannot drift from it.

const FIELD_LABELS = {
  format: "format", hookTitle: "hookTitle", mainAngle: "mainAngle", coreMessage: "coreMessage",
  caption: "caption", hashtags: "hashtags", contentStructure: "contentStructure",
  visualDirection: "visualDirection", imageText: "imageText",
  outputImageTextRequirements: "outputImageTextRequirements (on-image text)",
  outputImageTextRequirementsStructured: "outputImageTextRequirementsStructured (on-image text)",
  structure: "structure", inspiration: "inspiration",
};
const VIDEO_FIELD_SET = new Set(VISUAL_FIELDS.slice(VISUAL_FIELDS.indexOf("videoConceptTitleAndThumbnailTitleIdea")));
const ALWAYS_PRESERVED = ["postNumber", "date (schedule)", "platform", "status"];

function describeFieldList(fields) {
  const plain = fields.filter((f) => !VIDEO_FIELD_SET.has(f)).map((f) => FIELD_LABELS[f] || f);
  const hasVideo = fields.some((f) => VIDEO_FIELD_SET.has(f));
  return [...new Set(plain), ...(hasVideo ? ["video production fields"] : [])].join(", ");
}

/** Fields a scope may write, and every content field it must leave as-is. */
export function scopeFieldContract(scope, { allowMainAngleChange = false } = {}) {
  const writable = (SCOPE_FIELDS[scope] ?? SCOPE_FIELDS.entire_post).filter(
    (f) => f !== "mainAngle" || (scope === "custom_instruction" && allowMainAngleChange),
  );
  const all = ["format", ...CONTENT_FIELDS, ...VISUAL_FIELDS];
  const preserved = all.filter((f) => !writable.includes(f));
  return { writable, preserved };
}

// Generic interpretation of the stored Main Angle. Works for any value; the
// hints only sharpen common angles and never replace the stored value itself.
const ANGLE_HINTS = [
  [/educat|teach|learn|how[- ]?to|explain|tutorial|tips?\b|آموزش/i, "teach and explain: the reader should understand something new. Prioritise usefulness — depth comes from explanation, steps, reasons and examples. Sales pressure stays secondary unless the current post already sells: a useful takeaway is a complete ending, any CTA is a light next step (learn more, ask a question), never a hard sell, and campaign offers are not introduced."],
  [/promot|offer|sale|sell|discount|launch|deal|campaign|تبلیغ|فروش|تخفیف/i, "promote: conversion emphasis is appropriate — lead with the offer or service and its concrete value, and a stronger, direct call to action is expected."],
  [/authority|expert|credib|trust|proof|thought[- ]?leader|تخصص|اعتماد/i, "build authority and trust: expert, precise, evidence-conscious; show competence through specifics rather than claims of being the best, and close on credibility rather than a sales push."],
  [/problem|solution|pain|fix|mistake|myth/i, "keep the problem → consequence → solution logic: name the problem, show why it matters, then the solution."],
  [/story|narrat|journey|behind|case|testimonial|داستان|روایت/i, "keep the narrative framing: a situation, what happened, and what it means — told as a story, not converted into a list or a pitch, with an ending consistent with the narrative."],
  [/engag|community|question|poll|interact/i, "invite interaction: keep the conversational, question-led framing that gets the audience to respond."],
];

export function mainAngleGuidance(angle) {
  const value = typeof angle === "string" ? angle.trim() : "";
  if (!value) return null;
  const hint = ANGLE_HINTS.find(([re]) => re.test(value))?.[1];
  return hint
    ? `What "${value}" means for this post: ${hint}`
    : `Interpret "${value}" literally as the post's strategic purpose, and keep every part of the output serving it.`;
}

function platformNote(platform) {
  const p = String(platform || "").toLowerCase();
  if (p.includes("linkedin")) return "LinkedIn — professional register, value-led, scannable short paragraphs; not an Instagram-style caption.";
  if (p.includes("instagram")) return "Instagram — phone-readable, strong opening lines, short paragraphs.";
  if (p.includes("facebook")) return "Facebook — plain, practical, readable.";
  return "follow this platform's existing conventions.";
}

function formatNote(format) {
  const f = String(format || "").toLowerCase();
  if (f.includes("carousel")) return "Carousel — a structured progression across slides; each slide carries one step of the argument.";
  if (/reel|story|video|live|short/.test(f)) return "Reel/Video — a hook and a spoken/visual sequence suited to motion; the caption complements the video rather than repeating it.";
  if (/static|single|image|photo|graphic|infographic|quote/.test(f)) return "Static/single image — one focused communication unit; the caption carries the explanation.";
  if (/document|pdf|slide/.test(f)) return "Document/slides — a structured page-by-page progression.";
  if (/text|article|newsletter/.test(f)) return "Text-led — the written copy carries the whole message.";
  if (f) return `interpret "${format}" by its usual conventions on this platform, and keep it this format.`;
  return null;
}

export const SOURCE_PRIORITY_LINES = [
  "=== SOURCE PRIORITY & CONTEXT TYPES ===",
  "1. CURRENT USER INSTRUCTION — highest priority for WHAT to change, within the fields this mode may change. It never licenses inventing brand facts.",
  "2. FACTUAL SOURCES — Brand Knowledge source material and uploaded reference material: authoritative for brand facts (offers, prices, durations, policies, names, specifications). Using a fact is not the same as promoting it.",
  "3. POST STRATEGY (binding) — the specification above: Main Angle, core message, format, platform, and the post's existing purpose and CTA intent.",
  "4. BRAND IDENTITY / PROFILE — voice, tone, audience.",
  "5. OPTIONAL CAMPAIGN CONTEXT — the calendar's subject, goal and offer/message: background only, never a mandatory mention or CTA (see its OFFER POLICY).",
  "6. General knowledge — never as a source for brand-specific facts.",
  "The Main Angle and every field this mode must preserve stay binding even when a higher-priority source supplies new facts: use the facts inside the existing strategy, do not let them change it.",
];

/**
 * The strategic brief every regeneration mode starts from.
 * @param {object} current  merged post (editor fields + stored columns)
 * @param {{scope: string}} opts
 */
export function buildPostSpecificationLines(current, { scope, allowMainAngleChange = false } = {}) {
  const c = current || {};
  const angle = typeof c.mainAngle === "string" && c.mainAngle.trim() ? c.mainAngle.trim() : "";
  const combined = !angle && typeof c.mainAngleAndCoreMessage === "string" && c.mainAngleAndCoreMessage.trim()
    ? c.mainAngleAndCoreMessage.trim() : "";
  const date = c.date instanceof Date ? c.date.toISOString().slice(0, 10) : (c.date ? String(c.date) : "");
  const { writable, preserved } = scopeFieldContract(scope, { allowMainAngleChange });
  const angleMayChange = writable.includes("mainAngle");

  return [
    "=== EXISTING POST SPECIFICATION — POST STRATEGY (binding; read this first — it is the brief you are working within) ===",
    `Platform: ${c.platform || "(not set)"} — ${platformNote(c.platform)}`,
    `Format: ${c.format || "(not set)"}${formatNote(c.format) ? ` — ${formatNote(c.format)}` : ""}`,
    `Post #: ${c.postNumber ?? "?"}${date ? ` | Scheduled: ${date}` : ""}`,
    angle ? `Main Angle: ${angle}` : null,
    combined ? `Main Angle + Core Message (stored together): ${combined}` : null,
    (c.coreMessage && angle) ? `Core Message: ${c.coreMessage}` : null,
    (c.hookTitle || c.suggestedHook) ? `Hook / Title: ${c.hookTitle || c.suggestedHook}` : null,
    "",
    "MAIN ANGLE IS A STRATEGIC CONSTRAINT:",
    angle || combined
      ? `  - The stored Main Angle${angle ? ` "${angle}"` : " (see above)"} defines this post's purpose, tone, structure and how strongly it sells. Everything you write must still read as that angle.`
      : "  - No Main Angle is stored; infer the post's purpose from its core message and current content, and keep it.",
    angle ? `  - ${mainAngleGuidance(angle)}` : null,
    "  - Never shift the post to a different angle — e.g. do not turn an educational post into a sales pitch, a promotion into a story, or a story into a checklist.",
    angleMayChange
      ? "  - The user's instruction explicitly asks to change the Main Angle: return the new mainAngle it requests, and make every other change consistent with that new angle."
      : "  - mainAngle is read-only here and the application keeps the stored value whatever you return: do not return it, and do not write toward a different angle.",
    "",
    "=== FIELDS THIS MODE MAY CHANGE ===",
    describeFieldList(writable),
    "=== FIELDS YOU MUST PRESERVE (read-only context — never return or alter them) ===",
    [describeFieldList(preserved), ...ALWAYS_PRESERVED].filter(Boolean).join(", "),
    "Read-only fields are still part of the brief: read them, and keep your output consistent with them.",
    "",
    ...SOURCE_PRIORITY_LINES,
  ].filter((v) => v !== null && v !== undefined);
}

const PROMOTIONAL_ANGLE = /promot|offer|sale|sell|discount|launch|deal|conversion|تبلیغ|فروش|تخفیف/i;

function postMentions(current, phrase) {
  const text = [current?.hookTitle, current?.suggestedHook, current?.coreMessage, current?.mainAngleAndCoreMessage,
    current?.caption, current?.suggestedCaption].filter((v) => typeof v === "string").join("\n").toLowerCase();
  const p = String(phrase || "").toLowerCase().trim();
  if (!p || !text) return false;
  if (text.includes(p)) return true;
  const words = p.match(/[\p{L}\p{N}]{4,}/gu) || [];
  return words.length > 0 && words.every((w) => text.includes(w));
}

/**
 * The parent calendar's subject/goal/offer, labelled as OPTIONAL background
 * with an explicit offer policy. The offer used to sit under a plain
 * "CALENDAR CONTEXT" heading and was read as part of the brief, so posts that
 * never mentioned it (e.g. educational ones) gained a sales close.
 */
export function campaignContextLines(calendarCtx, current) {
  const subject = calendarCtx?.mainMonthlySubject;
  const goal = calendarCtx?.mainGoal;
  const offer = typeof calendarCtx?.mainOfferOrMessage === "string" ? calendarCtx.mainOfferOrMessage.trim() : "";
  const angle = typeof current?.mainAngle === "string" ? current.mainAngle : (current?.mainAngleAndCoreMessage || "");
  const promotional = PROMOTIONAL_ANGLE.test(angle);
  const mentioned = offer && postMentions(current, offer);
  return [
    "=== OPTIONAL CAMPAIGN CONTEXT (background only — not an instruction, not a list of things to mention) ===",
    subject ? `Campaign subject: ${subject}` : null,
    goal ? `Campaign goal: ${goal}` : null,
    offer ? `Campaign offer / message: ${offer}` : null,
    "OFFER POLICY:",
    offer && mentioned
      ? "  - The current post already references this campaign offer: you may keep it. Never remove a factual offer the post already makes."
      : null,
    offer && !mentioned && promotional
      ? "  - The Main Angle is promotional: you may feature this campaign offer where it genuinely strengthens the post."
      : null,
    offer && !mentioned && !promotional
      ? "  - The current post does NOT mention this campaign offer and its Main Angle is not promotional: do NOT introduce the offer, a booking/sales push, or a \"free …\" invitation — unless the user's instruction explicitly asks for it."
      : null,
    "  - The same rule applies to offers that appear in Brand Knowledge, reference material or the brand profile: a fact being available is not a reason to promote it.",
  ].filter((v) => v !== null && v !== undefined);
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
    '  "caption": "detailed caption — at least 5 lines, maximum 3 paragraphs, closing as the CTA policy above directs (no mandatory sales CTA). Do NOT include hashtags in this field — they go in the separate hashtags field below and are appended automatically.",',
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
    '  "caption": "detailed caption — at least 5 lines, maximum 3 paragraphs, closing as the CTA policy above directs (no mandatory sales CTA). Do NOT include hashtags in this field — they go in the separate hashtags field below and are appended automatically.",',
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

// CTA policy shared by every caption-writing regeneration mode. Replaces the
// calendar-generation rule "Always include a clear call-to-action", which made
// every regenerated caption close with a sales push regardless of strategy.
export const STRATEGY_CTA_LINES = [
  "  - Closing / call to action — decided by, in order: (1) the user's explicit instruction, (2) the current post's existing CTA intent, (3) the Main Angle. There is NO global requirement to end with a CTA.",
  "      Educational: a useful takeaway is a complete ending; add at most a light, helpful next step if it fits. Authority: a credibility-oriented close. Storytelling: an ending consistent with the narrative. Promotional: a clear conversion CTA is appropriate.",
  "      If the current post already has a CTA, keep its intent (you may sharpen the wording) unless the instruction asks to change it. Never upgrade a soft CTA into a sales push on your own.",
  "  - If the caption closes with a CTA or contact details, put them in their own short final paragraph, separated by a blank line. Contact details are optional — include them only when the current post already does, the angle is promotional, or the user asks.",
];

const SHARED_CTA_LINE = "  - Always include a clear call-to-action in the final paragraph, before any hashtags";
const SHARED_CTA_PARAGRAPH_LINE = "  - The CTA + contact-info paragraph must be its own short paragraph, visually separated (blank line) from the main hook/value content above it — never blended into the same paragraph as the main explanation";

/** Shared caption formatting rules with the strategy-driven CTA policy; Enrich omits the HASHTAGS section it does not own. */
export function regenerationCaptionRules({ includeHashtags = true } = {}) {
  const cut = CAPTION_GENERATION_RULES_LINES.indexOf("HASHTAGS:");
  const base = !includeHashtags && cut > 0 ? CAPTION_GENERATION_RULES_LINES.slice(0, cut) : CAPTION_GENERATION_RULES_LINES;
  return base.flatMap((line) => {
    if (line === SHARED_CTA_LINE) return STRATEGY_CTA_LINES;
    if (line === SHARED_CTA_PARAGRAPH_LINE) return [];
    return [line];
  });
}

const CAPTION_DEPTH_LINES = [
  "",
  "CAPTION DEPTH BY POST TYPE:",
  "  - Educational posts (Main Angle is educational / teaching): captions must be more detailed than regular posts. Use longer explanations, practical examples, steps, reasons, mini-frameworks, or key takeaways. Aim for at least 2 substantial paragraphs when the content supports it. Do not add filler — useful depth only.",
  "  - Static posts: Since a static post has only one visual, the caption must carry more explanation and context. Include a hook/opening, explanation/context, practical value or proof, and a close that fits the CTA policy above. Aim for at least 2 substantial paragraphs when the content supports it.",
  "  - Educational static posts: Receive the richest captions — usually 2-3 substantial paragraphs with explanation, practical value, and a useful takeaway (a next step only if it fits).",
  "  - Other posts: Follow the base rules above (at least 5 visible lines, max 3 paragraphs, closing as the CTA policy above directs).",
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
  allowMainAngleChange = false,
}) {
  return [
    "You are an expert social media strategist, copywriter, visual creative director, and AI content production planner.",
    "You are updating one selected post from a content calendar based on a specific user instruction.",
    "The instruction changes the dimension it names (tone, depth, audience, wording, format…); everything else in the post's specification stays in force.",
    "",
    ...buildPostSpecificationLines(current, { scope: "custom_instruction", allowMainAngleChange }),
    "",
    "=== BRAND ===",
    brandSummary,
    "",
    "=== LANGUAGE INSTRUCTION ===",
    buildLanguageInstruction(contentLanguage),
    "",
    ...campaignContextLines(calendarContext, current),
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
    "   • Copy/wording change only (rewrite caption, new headline, adjust tone, make it more technical/simpler/longer): update hookTitle, coreMessage, caption, hashtags as needed. Leave visual, format, and video production fields unchanged.",
    "   • Main Angle: change mainAngle ONLY when the instruction explicitly asks to change the post's angle, purpose, or strategy. \"Make it more technical for electricians\" on an educational post means a MORE TECHNICAL EDUCATIONAL post — not a new angle.",
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
    ...regenerationCaptionRules(),
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
    ...buildPostSpecificationLines(current, { scope: "image_text_only" }),
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
    "Write the on-image text in the voice of the post's Main Angle (see the specification above) and give each slide/item the role it has in contentStructure. When the text states a brand fact (offer, duration, price, specification), take it verbatim from Brand Knowledge or the reference material, or leave it out.",
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
        "You may regenerate broadly — this is a full rewrite of the post's EXECUTION while staying aligned with the brand, calendar strategy, Brand Knowledge, and uploaded reference material.",
        "STRATEGY STAYS: the stored Main Angle is read-only in this mode (the application preserves it), and so are the post's platform, format, schedule and status. Keep the post's purpose and core idea. Rewrite how the post delivers that strategy — hook, core message wording, caption, hashtags, visuals — not what the post is for.",
      ];

  return [
    ...buildPostSpecificationLines(current, { scope }),
    "",
    "=== BRAND ===",
    brandSummary,
    "",
    "=== LANGUAGE INSTRUCTION ===",
    buildLanguageInstruction(contentLanguage),
    "",
    "=== CURRENT POST (keep postNumber, date, platform, format unchanged) ===",
    ...buildCurrentPostContextLines(current, currentOitrDisplay),
    "",
    ...campaignContextLines(calendarContext, current),
    "",
    attachmentBlock,
    "",
    `=== TASK: ${isVisualScope ? "Regenerate visual direction and production fields" : "Full post regeneration"} ===`,
    ...taskLines,
    isVideo
      ? "IMPORTANT: narrationOrDialogueOfCharacterOrCharacters MUST be regenerated as a complete voiceover or dialogue script — cover hook/title, core message, main angle, promised value, key supporting points, and CTA/closing line where relevant. A one-line placeholder is not acceptable."
      : null,
    "",
    ...regenerationCaptionRules(),
    ...CAPTION_DEPTH_LINES,
    "",
    "=== OUTPUT IMAGE TEXT REQUIREMENTS ===",
    ...buildOutputImageTextRules(isCarousel, isVideo),
    "",
    ...buildJsonHint(isCarousel, isVideo),
  ].filter(v => v !== null && v !== false && v !== undefined).join("\n");
}

// ── enrich_post scope userInput ───────────────────────────────────────────────
// "Same post, professional version" — not a new post.
//
// Everything below is a preservation contract first and an improvement brief
// second: the model is told what must survive before it is told what to
// deepen, because the failure mode this mode exists to avoid is a richer post
// about a slightly different idea.

export const ENRICHMENT_PRESERVATION_LINES = [
  "PRESERVE EXACTLY — this is an approved post concept, not a brief for a new one:",
  "  - The topic and the post idea. Do NOT replace the concept with a different or 'better' one.",
  "  - The main angle, campaign purpose, and funnel intent.",
  "  - The target audience and who the post speaks to.",
  "  - The offer, product, or service being discussed — including which one, and how it is positioned.",
  "  - The CTA intent (what the reader is asked to do). You may sharpen its wording; you may not change what is being asked.",
  "  - Every factual claim already present: numbers, dates, prices, names, locations, contact details, certifications, guarantees. Carry them through unchanged.",
  "  - The post format, platform, schedule, hashtags, visual direction, on-image text, and all video production fields — these are NOT yours to touch in this mode and are not part of your output.",
  "  - Hashtags specifically: the post's existing hashtags are preserved by the application and re-attached to the end of your caption automatically. Do NOT write hashtags anywhere in the caption, do NOT propose new ones, and do NOT return a hashtags field.",
  "  - The brand voice, tone, and register already established by the brand information above.",
  "  - The content language (see LANGUAGE INSTRUCTION above) — never switch or mix languages.",
  "  - The hook's promise: you may make the hook sharper and more specific, but it must still promise the same thing.",
];

export const ENRICHMENT_IMPROVEMENT_LINES = [
  "ENRICH — make the same post substantially more useful, specific, and professional. Choose only what genuinely fits THIS post:",
  "  - Explain the 'why' behind claims the post currently states without support.",
  "  - Add concrete, checkable specifics in place of vague generalities (what exactly is done, checked, included, delivered).",
  "  - Add practical implications, consequences, or what the reader should do with the information.",
  "  - Add a relevant example, scenario, or typical case the audience recognises.",
  "  - Use correct domain/industry terminology where a professional would — and explain it briefly if the audience is not expert.",
  "  - Add reasoning and logical connective tissue in the shape the Main Angle calls for (e.g. concept → why it matters → how → takeaway when teaching; problem → consequence → solution for problem/solution; offer → benefit → action when promoting; situation → turn → meaning for a story).",
  "  - Add caveats, nuances, or conditions where they make the post more honest and more expert.",
  "  - Improve flow and transitions so the post reads as one argument rather than a list of statements.",
  "  - Where the post ALREADY connects its content to a service, product, or action, make that link clearer. Do not add a sales link, offer, or pitch that the post does not already make.",
  "Do NOT force every one of these into the post. A short post that gains two genuinely useful paragraphs is a success; one padded with all nine is a failure.",
  "Every addition must serve the stored Main Angle. An educational post gains explanation, not selling; a promotional post gains concrete benefit and a clearer offer, not a lecture; an authority post gains expert precision, not hype.",
  "Avoid repeating the hook in the core message or the core message in the caption's opening — each of the three fields should add something.",
];

export const ENRICHMENT_ANTI_FLUFF_LINES = [
  "DO NOT PAD — length is not the goal. Every added sentence must carry information the reader did not already have. Specifically, never add:",
  "  - Generic filler, throat-clearing, or motivational padding.",
  "  - Restatements of something the post already says.",
  "  - Exaggerated or superlative marketing claims (\"the best\", \"world-leading\", \"guaranteed results\") that the brand data does not support.",
  "  - Invented statistics, percentages, survey results, studies, research citations, or expert quotes.",
  "  - Fabricated testimonials, case studies, client names, or results.",
  "  - Unverifiable numbers of any kind — timeframes, prices, savings, failure rates, response times.",
  "  - Jargon used for authority rather than clarity.",
  "  - Redundant paragraphs or off-topic information.",
];

// Enrichment rewrites wording, which is exactly where a precise commercial
// claim quietly mutates into a similar-sounding but different promise (a
// real run turned a "100% money-back guarantee" into a "100% satisfaction
// guarantee"). Anything precise enough to be checked, priced, or enforced
// must survive as-is or be left out — no brand-specific wording here, the
// rule is about the SHAPE of the claim.
export const ENRICHMENT_PRECISE_CLAIM_LINES = [
  "PRECISE CLAIMS — REUSE THE EXACT WORDING, NEVER A SIMILAR-SOUNDING ONE:",
  "When the current post, the brand information, the calendar context, or the reference material contains a precise factual or commercial statement, you must carry its meaning through exactly, and you should quote the supplied wording verbatim when you use it. This covers:",
  "  - guarantee, warranty, and refund wording",
  "  - prices, fees, rates, discounts, and any numeric offer",
  "  - certifications, accreditations, memberships, and regulatory or compliance statements",
  "  - technical specifications, ratings, capacities, and standards",
  "  - named products, services, packages, or tiers",
  "  - durations, timeframes, response times, deadlines, and dates",
  "  - phone numbers, email addresses, URLs, and physical addresses",
  "NEVER swap one commercial promise for a different-but-similar one. A guarantee about getting money back is not a guarantee about being satisfied; a fixed price is not a 'from' price; an accreditation is not a general claim of being approved; 'next working day' is not 'same day'. If you cannot reproduce the exact claim, describe the benefit generally without stating the claim at all, or leave it out entirely.",
  "Do not upgrade, round, intensify, or soften any number, percentage, or named standard that appears in the supplied context.",
];

// A named offer is a label, not a description, and enrichment is where a label
// quietly turns into a paraphrase of itself (a real run referred to a listed
// "Free site visit" as a "free consultation" — same idea, different thing the
// business would have to honour). Names get their own rule because the
// wording-level rule above did not stop a rename.
export const ENRICHMENT_NAMED_OFFER_LINES = [
  "NAMED OFFERS AND SERVICES — USE THE SUPPLIED NAME, EXACTLY AS GIVEN:",
  "This rule is about HOW to name an offer you are already allowed to use under the OFFER POLICY — it is never a reason to add one.",
  "When the context gives something an explicit name or label — an offer, promotion, service, package, product, tier, plan, assessment, course, guarantee, or certification — that name is the thing itself. Refer to it using the supplied name, character for character.",
  "Do NOT rename it, shorten it, expand it, translate it, generalize it, upgrade it, soften it, or substitute a near-synonym — even when your wording sounds more natural or more appealing.",
  "Generic examples of the rule:",
  "  • Context lists \"Free site visit\" → write \"Book your Free site visit\". Do NOT write \"book a free consultation\", \"free survey\", \"free quote\", or \"free assessment\" — those name different things.",
  "  • Context lists \"Starter Plan\" → write \"Starter Plan\". Do NOT write \"Basic Plan\", \"entry-level plan\", or \"starter package\".",
  "You may introduce a named offer with ordinary sentence wording around it, but the name inside that sentence stays untouched.",
  "If the exact named offer does not fit the enriched post, OMIT it entirely. Leaving it out is always correct; renaming it never is.",
];

export const ENRICHMENT_FACTUAL_SAFETY_LINES = [
  "FACTUAL SAFETY (CRITICAL) — depth must come from real context, never from invention. You may draw ONLY on:",
  "  - Facts already present in the current post.",
  "  - The brand information and brand identity above.",
  "  - The calendar context and campaign information above.",
  "  - The interpreted uploaded reference material above, when present — use it to add real detail, correct terminology, and specifics instead of generic statements.",
  "  - The Brand Knowledge excerpts above, when present — they are authoritative for brand facts. Use relevant facts from it verbatim (e.g. a stated duration, policy, or specification) and ignore excerpts that do not fit this post.",
  "If a precise statistic, regulation, standard, certification, price, date, technical specification, or any other hard fact is NOT supported by the context above: do not invent it. Make the point generally instead (e.g. 'checked on a regular schedule' rather than 'checked every 90 days'), or leave it out.",
  "It is always better to return a shorter, fully-supported post than a longer one containing one invented fact.",
];

// Enrichment uses the same strategy-driven CTA policy as every other mode, but
// leaves out the HASHTAGS section — it tells the model to return 5 hashtags,
// contradicting Enrich's contract that hashtags are preserved by the application.
export const ENRICH_CAPTION_RULES_LINES = regenerationCaptionRules({ includeHashtags: false });

function enrichmentPlatformLines(platform) {
  const p = (platform || "").toLowerCase();
  if (p.includes("linkedin")) {
    return [
      "PLATFORM — LinkedIn: a deeper professional and educational treatment is appropriate. Expert reasoning, industry context, and practical takeaways are welcome. Keep it scannable with short paragraphs; do not turn it into an essay without structure.",
    ];
  }
  if (p.includes("instagram")) {
    return [
      "PLATFORM — Instagram: the caption may become richer, but it must stay readable on a phone. Keep short paragraphs with blank lines between them, keep the opening lines strong, and keep the existing hashtag handling exactly as it is.",
    ];
  }
  if (p.includes("facebook")) {
    return [
      "PLATFORM — Facebook: keep it readable and practical. Favour plain, useful explanation over formal or academic phrasing.",
    ];
  }
  return [
    "PLATFORM: respect the existing platform conventions already visible in the current post — its length, register, structure, and formatting habits.",
  ];
}

function enrichmentFormatLines(isCarousel, isVideo) {
  if (isCarousel) {
    return [
      "CAROUSEL POST — enrich the progression, not just the words:",
      "  - Keep the central carousel concept, the main angle, and the existing number and order of slides described in the content structure. Do not re-plan the carousel.",
      "  - Deepen the substance of each slide's idea so the sequence teaches something real: setup → explanation → specifics → implication → conclusion/CTA.",
      "  - Make the logical progression between slides explicit, so each slide earns the next.",
      "  - Keep individual slides tight — a slide that gains one sharp, specific point is better than a slide that gains a paragraph.",
      "  - The caption must carry the deeper explanation the slides cannot fit.",
    ];
  }
  if (isVideo) {
    return [
      "VIDEO / REEL POST — enrich only the written content (hook, core message, caption). The scenario, narration script, and all video production fields are outside this mode and must not appear in your output.",
      "  - Make the hook more specific and the caption a genuinely useful companion to the video rather than a restatement of it.",
    ];
  }
  return [
    "STATIC / SINGLE POST — the caption carries everything:",
    "  - Sharpen the hook so it promises the same thing more specifically.",
    "  - Build out the explanation: what the reader needs to understand, why it matters, what it looks like in practice.",
    "  - Add the supporting reasoning and concrete detail that a single image cannot show.",
    "  - Keep the original concept intact — this is the same post, explained properly.",
  ];
}

export function buildEnrichPostUserInput({
  current,
  currentOitrDisplay,
  brandSummary,
  contentLanguage,
  calendarContext,
  attachmentBlock,
  enrichmentInstruction,
}) {
  const fmtLower = (current.format || "").toLowerCase();
  const isCarousel = fmtLower.includes("carousel");
  const isVideo = /reel|story|video|live/.test(fmtLower);
  const extra = typeof enrichmentInstruction === "string" ? enrichmentInstruction.trim() : "";

  return [
    "You are a senior subject-matter expert and editor for this brand.",
    "You are enriching ONE existing, already-approved post from a content calendar.",
    "Your job is to return the SAME post in a substantially more professional, more useful, more specific version — NOT a different post.",
    "ENRICH MEANS: more specificity, usefulness, depth, clarity, practical detail, audience relevance and factual grounding — all in service of the post's existing strategy. It does NOT mean \"rewrite this post however you like\".",
    "",
    ...buildPostSpecificationLines(current, { scope: "enrich_post" }),
    "",
    "=== BRAND ===",
    brandSummary,
    "",
    "=== LANGUAGE INSTRUCTION ===",
    buildLanguageInstruction(contentLanguage),
    "",
    ...campaignContextLines(calendarContext, current),
    "",
    attachmentBlock,
    "",
    "=== CURRENT POST (the post you are enriching — everything here is READ-ONLY context) ===",
    ...buildCurrentPostContextLines(current, currentOitrDisplay),
    "",
    "=== TASK: ENRICH THIS POST ===",
    "STANDARD POST → SAME POST, PROFESSIONAL VERSION. Never STANDARD POST → DIFFERENT POST.",
    "",
    ...ENRICHMENT_PRESERVATION_LINES,
    "",
    ...ENRICHMENT_IMPROVEMENT_LINES,
    "",
    ...ENRICHMENT_ANTI_FLUFF_LINES,
    "",
    ...ENRICHMENT_FACTUAL_SAFETY_LINES,
    "",
    ...ENRICHMENT_PRECISE_CLAIM_LINES,
    "",
    ...ENRICHMENT_NAMED_OFFER_LINES,
    "",
    "BRAND VOICE: enrich in THIS brand's register, drawn from the brand information above — a clinical brand becomes professional and evidence-conscious, a technical brand expert and practical, a local service accessible and trustworthy, an educational brand informative and clear. Do not convert every brand into the same generic 'thought leadership' voice.",
    "",
    ...enrichmentPlatformLines(current.platform),
    "",
    ...enrichmentFormatLines(isCarousel, isVideo),
    extra ? "" : null,
    extra ? "=== WHAT THE USER ASKED TO ENRICH (guidance only) ===" : null,
    extra ? extra : null,
    extra
      ? "Treat this as guidance about WHERE to add depth. It does NOT license you to change the topic, concept, angle, audience, offer, CTA intent, or any preserved field above. If it appears to ask for a different post, enrich in that direction only as far as the preservation contract allows."
      : null,
    "",
    ...ENRICH_CAPTION_RULES_LINES,
    ...CAPTION_DEPTH_LINES,
    "",
    "=== OUTPUT ===",
    "Return ONLY valid JSON with EXACTLY these fields — no markdown, no code blocks, no other field:",
    "{",
    '  "postNumber": (keep same),',
    '  "hookTitle": "the same promise, sharper and more specific",',
    '  "coreMessage": "the same core message, stated with more precision and substance",',
    '  "caption": "the enriched caption — same idea, real added depth, no invented facts, no hashtags inside the text"',
    "}",
    "Do NOT return mainAngle, hashtags, format, platform, date, contentStructure, visualDirection, outputImageTextRequirements, imageText, or any video production field. They are preserved by the application and anything you return for them is discarded.",
  ].filter(v => v !== null && v !== false && v !== undefined).join("\n");
}

// ── change_slide_count scope userInput ────────────────────────────────────────
// "Same post, different slide structure" — a STRUCTURE transformation, never a
// request for a new or better post. The model returns a strict `slides` array;
// the application assembles contentStructure / visualDirection / structured
// image text from it (lib/calendar-slide-count.js), so the fields cannot
// disagree on slide count.

export const SLIDE_COUNT_PRESERVATION_LINES = [
  "PRESERVE — this is an approved post; only its slide structure changes:",
  "  - The topic, core idea, main angle, audience, campaign intent, and the offer/service/product being discussed.",
  "  - The CTA intent, brand voice, platform, and the content language (see LANGUAGE INSTRUCTION — never translate or mix languages).",
  "  - Every factual detail: numbers, dates, prices, names, locations, contact details, guarantees, certifications. Carry them through exactly as written.",
  "  - Named offers/services exactly as named; precise commercial claims word-for-word. Never swap a claim for a similar-sounding one.",
  "  - The caption, hashtags, hook title, main angle, core message, format, schedule and video fields are NOT yours to change and are not part of your output.",
  "  - The overall visual system (palette, typography, layout language, branding). Slides you keep keep their existing visual note.",
  "  - Information from the uploaded reference material above must not be lost or contradicted when slides are merged or split.",
];

export const SLIDE_COUNT_REDUCE_LINES = [
  "REDUCING SLIDES — consolidate, do not delete:",
  "  - Combine the key ideas of merged source slides into ONE coherent slide. Do not concatenate them mechanically; write them as one point.",
  "  - Keep every important fact, step, number and claim from the source slides. Remove only true duplication.",
  "  - Delete a source slide's content ONLY if the user's redistribution instruction explicitly says to remove it.",
  "  - Keep a logical progression (hook → body → CTA) and keep each resulting slide readable — on-image text may be denser on merged slides, but must stay scannable (use supporting_text and sub_supporting_text_1/2 for the merged detail).",
];

export const SLIDE_COUNT_INCREASE_LINES = [
  "INCREASING SLIDES — split, do not invent:",
  "  - Split the existing content into smaller logical units: one idea, step, or point per slide.",
  "  - Do NOT invent new facts, statistics, examples, offers, or claims to fill slides. Do NOT add filler, restatements, or generic padding slides.",
  "  - Use the extra slides to improve clarity and pacing of the SAME message (e.g. separate a multi-part explanation into steps, or give the CTA its own slide).",
  "  - Do not add visual elements, contact details, offers, or content types (e.g. testimonials, logos, phone numbers) that the current post does not already contain, and do not make a slide that only describes imagery — every slide must carry its own distinct piece of the existing message.",
  "  - Every new slide must be justified by content that already exists in the current post, the brand information, the calendar context, or the reference material.",
];

export function buildChangeSlideCountUserInput({
  current,
  currentOitrDisplay,
  brandSummary,
  contentLanguage,
  calendarContext,
  attachmentBlock,
  currentCount,
  targetCount,
  slideCountInstruction,
}) {
  const instruction = typeof slideCountInstruction === "string" ? slideCountInstruction.trim() : "";
  const reducing = targetCount < currentCount;
  const sourceSlides = extractSourceSlides(current);
  const explicitDrops = parseExplicitDrops(instruction, currentCount);

  return [
    "You are a senior carousel editor for this brand.",
    "You are restructuring ONE existing, already-approved carousel post into a different number of slides.",
    "CURRENT POST → SAME POST → DIFFERENT SLIDE STRUCTURE. This is NOT a request for a new or better post.",
    "",
    ...buildPostSpecificationLines(current, { scope: "change_slide_count" }),
    "",
    "=== BRAND ===",
    brandSummary,
    "",
    "=== LANGUAGE INSTRUCTION ===",
    buildLanguageInstruction(contentLanguage),
    "",
    ...campaignContextLines(calendarContext, current),
    "",
    attachmentBlock,
    "",
    "=== CURRENT POST (READ-ONLY context) ===",
    ...buildCurrentPostContextLines(current, currentOitrDisplay),
    "",
    `=== CURRENT SLIDES (${currentCount}) ===`,
    formatSourceSlidesForPrompt(sourceSlides),
    "",
    `=== TASK: CHANGE SLIDE COUNT FROM ${currentCount} TO ${targetCount} ===`,
    `Return EXACTLY ${targetCount} slides, numbered 1 to ${targetCount} with no gaps and no duplicates — never more, never fewer.`,
    `Direction: ${reducing ? `REDUCE ${currentCount} → ${targetCount}` : `INCREASE ${currentCount} → ${targetCount}`}.`,
    "Think in terms of source-to-target mapping: decide which CURRENT slides feed each NEW slide, then write each new slide from those sources. Do not rely only on the numbers.",
    "",
    ...SLIDE_COUNT_PRESERVATION_LINES,
    "",
    ...(reducing ? SLIDE_COUNT_REDUCE_LINES : SLIDE_COUNT_INCREASE_LINES),
    "FLOW BY MAIN ANGLE — group or split slides by meaning in the shape the stored Main Angle needs, never by slide number alone: an educational carousel keeps setup → explanation → takeaway/CTA; a problem/solution carousel keeps problem → consequence → solution → CTA; a story keeps its narrative order; a promotional carousel keeps offer → benefit → action. Keep the core message intact across the new structure and keep an existing CTA slide as the final slide.",
    "",
    instruction ? "=== USER REDISTRIBUTION INSTRUCTION (follow closely) ===" : null,
    instruction || null,
    instruction
      ? `Slide numbers in this instruction refer to the CURRENT slides above. Follow its mapping exactly (e.g. "keep slide 1 as-is" means new slide 1 reuses current slide 1's content, visual note and on-image text with minimal change). The requested total of ${targetCount} slides always wins: if the instruction cannot be satisfied at exactly ${targetCount} slides, follow it as far as possible — still return ${targetCount} slides. Do not treat the instruction as permission to change the topic, caption, hashtags or any preserved field.`
      : "No redistribution instruction was given: choose the most logical mapping yourself — keep the hook as slide 1 and the call-to-action as the final slide, and group or split the middle content by meaning.",
    instruction ? "" : null,
    "=== SOURCE MAPPING CONTRACT (machine-checked — output is rejected if it fails) ===",
    "`sourceSlides` is part of the transformation, not descriptive metadata. For EVERY new slide, list the CURRENT slide numbers (integers, 1.." + currentCount + ") whose content that slide actually contains. It must be non-empty and truthful.",
    reducing
      ? "REDUCTION: every CURRENT slide 1.." + currentCount + " must appear in exactly one new slide's sourceSlides — merge it there; do not leave any out and do not list one current slide under several new slides."
      : "INCREASE: every CURRENT slide 1.." + currentCount + " must appear in at least one new slide's sourceSlides. One current slide MAY feed several new slides when you split it; new slides must never claim a current slide they do not draw from.",
    explicitDrops.length
      ? `EXPLICIT REMOVAL requested by the user: current slide${explicitDrops.length > 1 ? "s" : ""} ${explicitDrops.join(", ")}. Only ${explicitDrops.length > 1 ? "these" : "this one"} may be omitted from sourceSlides; every other current slide must still be covered.`
      : "No slide was explicitly removed by the user, so NO current slide may be omitted: all " + currentCount + " must be covered.",
    "CONCRETE TEXT ONLY: each slide's contentStructure and visualDirection must state the actual points, facts, names and visual elements of that slide. NEVER write meta-descriptions such as \"merge of slides 2–6\", \"combined notes\", \"summary of the middle slides\" or \"as above\". Do not repeat the role label inside contentStructure (the application adds \"Slide N: Role —\" itself). Keep every distinct fact, offer, program/service name, number and CTA from the source slides, using their exact names.",
    "A new slide's content must be consistent with its sourceSlides: carry the important facts of every listed source into it.",
    "",
    "Slides you carry over unchanged must keep their existing wording; only merged or split slides are rewritten.",
    "",
    "=== OUTPUT IMAGE TEXT REQUIREMENTS (for each slide's `fields`) ===",
    ...buildOutputImageTextRules(true, false),
    "Where this conflicts with preservation (e.g. a slide you keep from the current post), preservation wins: reuse that slide's existing on-image text.",
    "",
    "=== OUTPUT ===",
    "Return ONLY valid JSON (no markdown, no code blocks) with EXACTLY these fields:",
    "{",
    '  "postNumber": (keep same),',
    '  "overallVisualDirection": "the existing overall carousel visual system, reused as-is (the part of the current Visual direction that is not slide-specific)",',
    '  "slides": [',
    `    ${JSON.stringify({
      slideNumber: 1,
      sourceSlides: [1],
      slideRole: "Hook",
      contentStructure: "what this slide says/covers, combining its source slides",
      visualDirection: "visual note for this slide, consistent with the overall system",
      fields: { main_headline: "…", supporting_text: "…" },
    })},`,
    `    … exactly ${targetCount} entries, slideNumber 1..${targetCount}, each with sourceSlides (the CURRENT slide numbers it draws from)`,
    "  ]",
    "}",
    "`fields` uses ONLY the allowed on-image text keys listed above; omit any key without real content. Do NOT return caption, hashtags, hookTitle, mainAngle, coreMessage, format, platform, date, video fields, or any other field — they are preserved by the application and anything you return for them is discarded.",
  ].filter(v => v !== null && v !== false && v !== undefined).join("\n");
}
