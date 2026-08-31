// Shared utilities for calendar post data — importable from both server and client code.

// ─── Caption / hashtag generation — shared across generate + both regenerate routes ──
//
// Hashtags are asked from the AI as a structured array (for reliable count
// control) but the caption text is the single source of truth for display:
// mergeHashtagsIntoCaption() strips any hashtag-only line the AI embedded on
// its own and appends the normalized 5 as the caption's final line. Callers
// also stamp `hashtagsMergedIntoCaption: true` on the resulting post so the
// grid/export can stop showing them a second time in the separate "Hashtags"
// column — old records without the flag keep rendering exactly as before.

export function normalizeHashtagList(rawList) {
  const seen = new Set();
  const out = [];
  const list = Array.isArray(rawList) ? rawList : (rawList ? [rawList] : []);
  for (const raw of list) {
    let tag = String(raw ?? "").trim().replace(/\s+/g, "");
    if (!tag) continue;
    if (!tag.startsWith("#")) tag = `#${tag}`;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 5) break;
  }
  return out;
}

// Strips every hashtag token wherever it appears in the caption body — inline
// mid-sentence, on its own line, or in a trailing run — defending against the
// AI embedding its own hashtags despite being told not to. Scanning the whole
// body (not just the end) is what guarantees no duplicate/stray AI-authored
// hashtag block survives once the canonical 5 are appended, and that no
// hashtags are left scattered through the caption text. The Unicode-aware
// token class also covers Arabic/Cyrillic-script hashtags.
const HASHTAG_TOKEN_RE = /#[\w؀-ۿЀ-ӿ]+/g;

function stripAllHashtags(caption) {
  const withoutTags = String(caption ?? "").replace(HASHTAG_TOKEN_RE, "");
  // Clean up the whitespace/blank-lines a removed token leaves behind.
  return withoutTags
    .split("\n")
    .map(line => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Deterministic hashtag fallback derivation ─────────────────────────────────
// When the AI returns fewer than 5 hashtags for a platform that requires
// exactly 5 (Instagram), the shortfall is filled from KNOWN structured brand/
// post context only — never invented. Each candidate is a real fact already
// present in the brand or post data (business name, services/products,
// location, category, campaign subject, this post's own angle) turned into a
// hashtag deterministically, e.g. "BE Academy" -> "#BEAcademy",
// "Manchester" -> "#Manchester", "CCTV Training" -> "#CCTVTraining".

// Converts a short phrase into a CamelCase hashtag. Only the first letter of
// each word is touched (capitalized) — the rest of the word is left exactly
// as provided, so real acronyms in brand data (e.g. "BE") survive untouched
// instead of being mangled into "Be". Phrases longer than maxWords are
// rejected outright: a long free-text sentence turned into one giant hashtag
// is exactly the kind of low-quality tag this must avoid.
function _hashtagFromPhrase(text, maxWords = 5) {
  if (!text) return null;
  const words = String(text)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (!words.length || words.length > maxWords) return null;
  const tag = words.map(w => w[0].toUpperCase() + w.slice(1)).join("");
  if (tag.length < 2) return null;
  return `#${tag}`;
}

// Splits a free-form "A, B and C" / "A; B / C" list (or an actual array) into
// individual short phrases — used for multi-value fields like
// mainServicesOrProducts or a "City, Country" location string.
function _splitList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value !== "string" || !value.trim()) return [];
  return value.split(/,|;|\/| and /i).map(s => s.trim()).filter(Boolean);
}

// Derives up to `needed` new hashtags from known context, skipping anything
// that duplicates (case-insensitively) an already-accepted hashtag. Priority
// mirrors the requested mix: service/product, brand name, location/service
// area, niche/category, campaign subject, and — only as a last resort — this
// post's own category-like mainAngle (e.g. "education" -> "#Education").
export function deriveFallbackHashtags(existingHashtags, context, needed) {
  if (needed <= 0) return [];
  const ctx = context || {};
  const seen = new Set((existingHashtags || []).map(t => String(t).toLowerCase()));
  const out = [];

  const tryAdd = (text) => {
    if (out.length >= needed) return;
    const tag = _hashtagFromPhrase(text);
    if (!tag) return;
    const key = tag.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(tag);
  };

  _splitList(ctx.mainServicesOrProducts).forEach(tryAdd);
  tryAdd(ctx.brandName);
  _splitList(ctx.businessLocation).forEach(tryAdd);
  tryAdd(ctx.businessType);
  tryAdd(ctx.campaignSubject);
  tryAdd(ctx.mainAngle);

  return out.slice(0, needed);
}

// The exactly-5 rule (and its deterministic fallback padding) is an
// Instagram-specific requirement — it must NOT be inherited by LinkedIn
// (intentionally 0-3, see CAPTION_GENERATION_RULES_LINES), Facebook, any
// other current/future platform, or a missing/unknown platform value. Only a
// platform that safely, exactly normalizes to "instagram" (case-insensitive,
// trimmed) opts in; every other case — including undefined — falls through to
// the existing default behavior (normalizeHashtagList's cap-at-5, no padding).
function _isInstagramPlatform(platform) {
  return String(platform ?? "").trim().toLowerCase() === "instagram";
}

export function mergeHashtagsIntoCaption(caption, hashtagsRaw, options = {}) {
  const { platform, context } = options;
  let hashtags = normalizeHashtagList(hashtagsRaw);

  if (hashtags.length < 5 && _isInstagramPlatform(platform)) {
    const fallback = deriveFallbackHashtags(hashtags, context, 5 - hashtags.length);
    if (fallback.length) hashtags = normalizeHashtagList([...hashtags, ...fallback]);
  }

  const base = stripAllHashtags(caption);
  if (!hashtags.length) return { caption: base, hashtags };
  const merged = base ? `${base}\n\n${hashtags.join(" ")}` : hashtags.join(" ");
  return { caption: merged, hashtags };
}

// Shared caption-generation prompt rules — used by the initial generation
// route and both regenerate routes so the three prompts can't drift apart.
export const CAPTION_GENERATION_RULES_LINES = [
  "=== CAPTION GENERATION RULES ===",
  "Captions must be substantive, readable, multi-paragraph content:",
  "  - At least 5 visible lines of substantive content per post",
  "  - Maximum 3 paragraphs, separated by a blank line",
  "  - Formatting: insert a blank line after every 2-3 lines so the caption never reads as one large text block — but never break a sentence early just to hit that count; let natural sentence/paragraph boundaries decide exactly where each blank line falls",
  "  - Always include a clear call-to-action in the final paragraph, before any hashtags",
  "  - The CTA + contact-info paragraph must be its own short paragraph, visually separated (blank line) from the main hook/value content above it — never blended into the same paragraph as the main explanation",
  "  - Do not artificially shorten captions to a fixed character limit — let the content and depth dictate the length",
  "  - Write for the platform's audience: LinkedIn posts should be professional and value-rich; other platforms can match their respective tone",
  "",
  "CONTACT INFORMATION — never invent:",
  "  - If the Brand Information / Brand Identity sections above include real contact details (website, phone, email, WhatsApp, address, social handles), the CTA may reference them naturally.",
  "  - Never invent a phone number, email address, website, physical address, WhatsApp number, or any other contact detail that is not explicitly present in the brand data provided.",
  "  - Choose only the most useful 1-3 contact/business details for this specific post (e.g. location + website, or phone + booking link) — do not dump every available field into one caption.",
  "  - Never repeat the same contact detail more than once in the caption.",
  "  - If no specific contact detail is available, close with a CTA that does not reference specific contact info, e.g. \"Contact us to learn more\" or \"Send us a message to get started.\"",
  "",
  "EMOJI USAGE — use sparingly and only where they add value:",
  "  - Usually 1-4 emojis in the entire caption, depending on length — never one at the start of every sentence or paragraph (that stereotypical AI pattern must be avoided).",
  "  - Each emoji must add real scanning/meaning value, e.g. 📍 location, 📞 phone, 🌐 website, 📅 date, 🎓 course/training, 🔧 practical/technical topic, ✅ benefit or checkpoint.",
  "  - Do not use long strings of decorative emojis or emojis unrelated to the sentence they sit in.",
  "  - Match brand tone: professional/B2B brands should use fewer emojis (0-2) than casual/lifestyle brands.",
  "",
  "HASHTAGS:",
  "  - Do NOT type hashtags inside the caption text yourself — return them ONLY in the separate \"hashtags\" field. They will be appended to the caption automatically.",
  "  - Instagram posts: return exactly 5 hashtags, each starting with #, no more and no fewer.",
  "  - LinkedIn posts: hashtags are optional and secondary to Instagram — return 0-3 professional/industry hashtags only if they add genuine discovery value; never force the count up to 5 on LinkedIn.",
  "  - Hashtags must be relevant to the specific post, the brand, the topic, and the platform — avoid generic/spam hashtags (e.g. #love #instagood #follow #viral) and irrelevant high-volume tags entirely, no matter how popular they are.",
  "  - Aim for a sensible mix: one or two service/product-specific tags, a local/geographic tag when the business serves a specific area, a niche/industry-category tag, and a branded/campaign tag ONLY if the brand actually uses one or it is clearly derived from the business name — never invent a branded hashtag.",
  "  - Never return near-duplicate hashtags that say the same thing (e.g. #CCTVTraining and #CCTVCourses together) — each of the 5 should add distinct discoverability value.",
];

// Compact brand tone/business summary shared by the generate route and both
// regenerate routes (previously duplicated verbatim in all three files).
// Includes contact-relevant fields (contactInformation/website/socialLinks)
// so the CAPTION GENERATION RULES contact-info instruction above has real
// data to draw from instead of silently having nothing to work with.
export function createCompactToneInformationSummary(tone) {
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
    tone.contactInformation      && `Contact information: ${tone.contactInformation}`,
    tone.website                 && `Website: ${tone.website}`,
    tone.socialLinks.length      && `Social links: ${tone.socialLinks.join(", ")}`,
    tone.contentDoRules.length   && `Content do's: ${tone.contentDoRules.join("; ")}`,
    tone.contentDontRules.length && `Content don'ts: ${tone.contentDontRules.join("; ")}`,
  ].filter(Boolean).join("\n");
}

// ─── Output Image Text Requirements — canonical structured schema ─────────────
//
//   Static / Video : { type: "static" | "video", items: [ {fields...} ] }
//   Carousel       : { type: "carousel", slides: [ { slideNumber, slideRole, fields } ] }
//
// `fields` is always a flat object using ONLY the canonical keys below — any
// other keys the AI invents are dropped, and any blank/empty values are omitted
// entirely (this is what makes the "omit blank keys" requirement structural
// rather than a display-time patch).

const OITR_FIELD_KEYS = [
  "main_headline", "subheadline", "supporting_text",
  "sub_supporting_text_1", "sub_supporting_text_2",
  "call_to_action",
  "badge_or_label", "offer_or_promotion", "date_or_time",
  "website_or_contact", "logo_text", "additional_text_notes",
];

function _cleanFields(fields) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return {};
  const out = {};
  for (const key of OITR_FIELD_KEYS) {
    const v = fields[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim();
  }
  return out;
}

const _KEY_LABELS = {
  main_headline: "Headline",
  subheadline: "Subheadline",
  supporting_text: "Supporting text",
  sub_supporting_text_1: "Sub-supporting text 1",
  sub_supporting_text_2: "Sub-supporting text 2",
  call_to_action: "CTA",
  badge_or_label: "Badge / label",
  offer_or_promotion: "Offer",
  date_or_time: "Date / time",
  website_or_contact: "Website",
  logo_text: "Logo text",
  additional_text_notes: "Additional notes",
};

function _fieldKeyToLabel(key) {
  if (_KEY_LABELS[key]) return _KEY_LABELS[key];
  return key
    .split(/[_\s-]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function _fieldsToDisplayString(fields) {
  const cleaned = _cleanFields(fields);
  const keys = Object.keys(cleaned);
  if (!keys.length) return null;
  return keys.map(k => `${_fieldKeyToLabel(k)}: ${cleaned[k]}`).join("\n");
}

// Parses `{key: 'val', key2: "val2", key3: bareVal, ...}`-ish strings (the
// loose, often-unquoted shape models tend to emit) into a plain fields object.
function _parseInlineFieldsString(str) {
  if (!str) return {};
  let inner = str.trim();
  if (inner.startsWith("{")) inner = inner.slice(1);
  if (inner.endsWith("}")) inner = inner.slice(0, -1);

  const out = {};
  const re = /(\w+)\s*:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|([^,}]*))/g;
  let m;
  while ((m = re.exec(inner)) !== null) {
    const key = m[1];
    const val = (m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : (m[4] ?? "")).trim();
    if (!val || val === "null" || val === "undefined") continue;
    out[key] = val;
  }
  return out;
}

// ─── parseSlideCountFromContentStructure ──────────────────────────────────────
// Derives the authoritative slide count from the Content Structure text so
// generation, validation, and the fallback builder all agree on the same number.
export function parseSlideCountFromContentStructure(contentStructure) {
  const text = (contentStructure || "").trim();
  if (!text) return 0;

  const numbers = [...text.matchAll(/Slide\s+(\d+)/gi)]
    .map(m => parseInt(m[1], 10))
    .filter(n => !isNaN(n) && n > 0);
  if (numbers.length) return Math.max(...numbers);

  // No explicit "Slide N" labels — fall back to counting distinct lines/bullets,
  // which is how step/scene breakdowns are usually written for carousels.
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  if (lines.length > 1) return lines.length;

  return 0;
}

// ─── normalizeOutputImageTextRequirementsStructured ────────────────────────────
// Best-effort conversion of ANY stored representation (the new structured
// object, a JSON string of it, the older "Slide N: {...}" / "Static Image: {...}"
// strings, a bare array of slide objects, or a single flat fields object) into
// the canonical { type, items | slides } shape — or null if nothing usable is
// found. This is what lets old saved calendars keep working: their string data
// gets parsed into the same shape new structured data already has.
export function normalizeOutputImageTextRequirementsStructured(value) {
  if (value === null || value === undefined) return null;

  // ── Already an object ──────────────────────────────────────────────────────
  if (typeof value === "object" && !Array.isArray(value)) {
    const type = (value.type || "").toLowerCase();

    if (type === "carousel" && Array.isArray(value.slides)) {
      const slides = value.slides
        .map((s, i) => {
          const fields = _cleanFields(s?.fields ?? s);
          if (!Object.keys(fields).length) return null;
          return {
            slideNumber: Number(s?.slideNumber) || i + 1,
            slideRole: (typeof s?.slideRole === "string" && s.slideRole.trim()) ? s.slideRole.trim() : null,
            fields,
          };
        })
        .filter(Boolean);
      return slides.length ? { type: "carousel", slides } : null;
    }

    if ((type === "static" || type === "video") && Array.isArray(value.items)) {
      const items = value.items.map(it => _cleanFields(it)).filter(f => Object.keys(f).length);
      if (items.length) return { type, items };
      return type === "video" ? { type: "video", items: [] } : null;
    }

    // Bare fields object with no `type`/`items`/`slides` wrapper — treat it as
    // a single static item (this is the shape the older prompt produced when
    // it returned one flat object for a static post).
    const fields = _cleanFields(value);
    if (Object.keys(fields).length) return { type: "static", items: [fields] };

    return null;
  }

  // ── Array — legacy "one entry per slide" array of plain field objects ─────
  if (Array.isArray(value)) {
    const slides = value
      .map((item, i) => {
        const fields = _cleanFields(item?.fields ?? item);
        if (!Object.keys(fields).length) return null;
        return {
          slideNumber: Number(item?.slideNumber) || i + 1,
          slideRole: (typeof item?.slideRole === "string" && item.slideRole.trim()) ? item.slideRole.trim() : null,
          fields,
        };
      })
      .filter(Boolean);
    return slides.length ? { type: "carousel", slides } : null;
  }

  // ── String ─────────────────────────────────────────────────────────────────
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // JSON-encoded structured object/array
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      const result = normalizeOutputImageTextRequirementsStructured(parsed);
      if (result) return result;
    } catch { /* not JSON — fall through to text parsing below */ }
  }

  // "Slide N: {...}" sequence → carousel
  if (/Slide\s+\d+\s*:/i.test(trimmed)) {
    const parts = trimmed.split(/(?=Slide\s+\d+\s*:)/i).map(s => s.trim()).filter(Boolean);
    const slides = parts
      .map(part => {
        const m = part.match(/^Slide\s+(\d+)\s*:\s*([\s\S]*)$/i);
        if (!m) return null;
        const fields = _cleanFields(_parseInlineFieldsString(m[2]));
        if (!Object.keys(fields).length) return null;
        return { slideNumber: parseInt(m[1], 10), slideRole: null, fields };
      })
      .filter(Boolean);
    return slides.length ? { type: "carousel", slides } : null;
  }

  // "Static Image: {...}" / "Video Cover: {...}" / bare "{...}"
  const labelMatch = trimmed.match(/^(Static Image|Video Cover|Image|Cover)\s*:\s*([\s\S]*)$/i);
  const body = (labelMatch ? labelMatch[2] : trimmed).trim();
  if (body.startsWith("{")) {
    const fields = _cleanFields(_parseInlineFieldsString(body));
    if (Object.keys(fields).length) {
      const isVideo = /video|cover|reel/i.test(labelMatch?.[1] || "");
      return { type: isVideo ? "video" : "static", items: [fields] };
    }
  }

  return null;
}

// ─── formatOutputImageTextRequirementsForDisplay ───────────────────────────────
// Cleans outputImageTextRequirements for table & edit-panel display:
//   • Normalizes whatever is stored (structured object OR legacy string) into
//     the canonical schema, then renders it as "Slide N: {...}" / "{...}" text
//   • Strips key-value pairs whose value is empty / null / undefined
//   • Never mutates saved data — display only
//
// This is also the single source of truth for the clean string representation
// that gets persisted into the `outputImageTextRequirements` column for
// backward compatibility (export, search, legacy readers).
export function formatOutputImageTextRequirementsForDisplay(value) {
  if (!value) return null;

  const structured = normalizeOutputImageTextRequirementsStructured(value);
  if (structured) {
    if (structured.type === "carousel") {
      const lines = structured.slides
        .slice()
        .sort((a, b) => a.slideNumber - b.slideNumber)
        .map(s => {
          const body = _fieldsToDisplayString(s.fields);
          return body ? `Slide ${s.slideNumber}:\n${body}` : null;
        })
        .filter(Boolean);
      return lines.length ? lines.join("\n\n") : null;
    }

    const items = structured.items || [];
    const lines = items
      .map((fields, i) => {
        const body = _fieldsToDisplayString(fields);
        if (!body) return null;
        return items.length > 1 ? `Image ${i + 1}:\n${body}` : body;
      })
      .filter(Boolean);
    return lines.length ? lines.join("\n\n") : null;
  }

  // ── Could not normalize into the canonical schema — clean as free text ─────
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const cleaned = trimmed
    .replace(/\w+:\s*''\s*,?\s*/g, "")
    .replace(/\w+:\s*""\s*,?\s*/g, "")
    .replace(/,\s*}/g, "}")
    .trim();
  return cleaned || null;
}

// ─── TABLE_VIEWS ──────────────────────────────────────────────────────────────
// Shared by StepCalendarOutput and CalendarDetailClient.
// All tabs use overflow-x-auto — the scroll wrapper is always applied.

export const CALENDAR_TABLE_VIEWS = [
  {
    id: "schedule",
    label: "Schedule",
    columns: [
      { key: "postNumber",  label: "#",            width: "min-w-[48px] w-12",   short: true },
      { key: "date",        label: "Date",          width: "min-w-[140px]",       short: true },
      { key: "hookTitle",   label: "Hook / Title",  width: "min-w-[260px]" },
      { key: "format",      label: "Format",        width: "min-w-[120px]",       short: true },
      { key: "mainAngle",   label: "Main Angle",    width: "min-w-[220px]" },
      { key: "coreMessage", label: "Core Message",  width: "min-w-[360px]" },
      // No separate Hashtags column — new-format posts carry hashtags as the
      // caption's final line (see mergeHashtagsIntoCaption); legacy posts'
      // separate hashtags field is still viewable/editable via the edit panel.
      { key: "caption",     label: "Caption",       width: "min-w-[520px]" },
      { key: "referenceLink", label: "Reference",   width: "min-w-[160px]" },
    ],
  },
  {
    id: "visual",
    label: "Visual",
    columns: [
      { key: "postNumber",   label: "#",                          width: "min-w-[48px] w-12",  short: true },
      { key: "contentStructure", label: "Content Structure",     width: "min-w-[160px]" },
      { key: "visualDirection",  label: "Visual Direction",      width: "min-w-[280px]" },
      { key: "imageText",        label: "Image Text",            width: "min-w-[280px]" },
      { key: "structure",        label: "Structure",             width: "min-w-[130px]" },
      { key: "inspiration",      label: "Inspiration",           width: "min-w-[150px]" },
      { key: "videoConceptTitleAndThumbnailTitleIdea", label: "Video Concept / Thumbnail", width: "min-w-[210px]" },
      { key: "videoRawIdea",     label: "Video Raw Idea",        width: "min-w-[180px]" },
      { key: "mainIntegratedScenario", label: "Integrated Scenario", width: "min-w-[210px]" },
      { key: "thumbnailIdeaForReel",   label: "Thumbnail Idea",      width: "min-w-[180px]" },
    ],
  },
  {
    id: "video",
    label: "Video Production",
    columns: [
      { key: "postNumber",   label: "#",                  width: "min-w-[48px] w-12",   short: true },
      { key: "narrationOrDialogueOfCharacterOrCharacters", label: "Narration / Dialogue", width: "min-w-[210px]" },
      { key: "rawImageIdeaForFirstFrame", label: "First Frame Idea", width: "min-w-[200px]" },
      { key: "whatHappens",              label: "What Happens",      width: "min-w-[200px]" },
      { key: "characterObjectOrEnvironmentAction", label: "Character / Action", width: "min-w-[180px]" },
      { key: "cameraMovement", label: "Camera movement", width: "min-w-[160px]" },
      { key: "speedRamp",      label: "Speed ramp",      width: "min-w-[140px]" },
      { key: "camera",         label: "Camera",          width: "min-w-[140px]" },
      { key: "lens",           label: "Lens",            width: "min-w-[140px]" },
      { key: "focalLength",    label: "Focal length",    width: "min-w-[120px]" },
      { key: "aperture",       label: "Aperture",        width: "min-w-[140px]" },
      { key: "visualMood",     label: "Visual Mood",     width: "min-w-[150px]" },
      { key: "textOnVideo",    label: "Text on Video",   width: "min-w-[150px]" },
    ],
  },
];

// ─── normalizePost ─────────────────────────────────────────────────────────────
// Converts any post object (DB record, AI output, or old format) to a unified
// camelCase shape. Reads postData JSON blob for fields not in DB columns.
//
//   imageText                              — the single user-facing "Image Text"
//                                            field; a manual value wins, otherwise
//                                            falls back to the formatted Output
//                                            Image Text Requirements content
//   outputImageTextRequirements            — clean slide-by-slide text, as a string
//                                            (always present for display/export/search)
//   outputImageTextRequirementsStructured  — the same content as a structured
//                                            object (preferred source for the
//                                            image-prompt flow); normalized at
//                                            load time so old string-only posts
//                                            get parsed into the same shape too

export function normalizePost(raw, idx) {
  if (!raw) return emptyNormalizedPost(idx);

  // Merge postData JSON string under raw fields.
  // raw wins so DB scalar columns always take precedence over the blob.
  let meta = {};
  if (raw.postData) {
    try {
      meta = typeof raw.postData === "string"
        ? JSON.parse(raw.postData)
        : raw.postData;
    } catch { /* ignore malformed JSON */ }
  }
  const p = { ...meta, ...raw };

  const hashtags = (() => {
    const v = p.hashtags ?? meta.hashtags ?? p.tags ?? "";
    if (Array.isArray(v)) return v;
    if (typeof v === "string" && v.trim()) {
      try {
        const parsed = JSON.parse(v);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
      return v.split(/[\s,]+/).filter(Boolean);
    }
    return [];
  })();

  const dateStr = (() => {
    const d = p.date;
    if (!d) return "";
    if (typeof d === "string") return d.slice(0, 10);
    try { return new Date(d).toISOString().slice(0, 10); } catch { return ""; }
  })();

  const outputImageTextRequirements = p.outputImageTextRequirements ?? p.output_image_text_requirements ?? "";

  // Prefer a structured value stored alongside it; otherwise derive one from
  // the saved string so older calendars (string-only) work the same way.
  const outputImageTextRequirementsStructured =
    normalizeOutputImageTextRequirementsStructured(p.outputImageTextRequirementsStructured) ||
    normalizeOutputImageTextRequirementsStructured(outputImageTextRequirements);

  // imageText is the single user-facing "Image Text" field (the dedicated
  // Output Image Text Requirements column has been removed). A manually
  // entered value always wins; otherwise fall back to the best available
  // Output Image Text Requirements content so old and new posts that only
  // have OITR data still show useful text here.
  const rawImageText = (p.imageText ?? p.image_text ?? "").toString();
  const imageText = rawImageText.trim()
    || formatOutputImageTextRequirementsForDisplay(outputImageTextRequirementsStructured)
    || outputImageTextRequirements
    || "";

  return {
    _id:        p._id ?? p.id ?? `p-${idx}`,
    postNumber: p.postNumber ?? p.post_number ?? idx + 1,
    date:       dateStr,
    platform:   p.platform ?? "",
    format:     p.format ?? p.contentType ?? p.content_type ?? "",

    mainAngle:   p.mainAngle  ?? p.main_angle  ?? p.contentPillar ?? p.content_pillar ?? "",
    coreMessage: p.coreMessage ?? p.core_message ?? p.mainAngleAndCoreMessage ?? "",
    hookTitle:   p.hookTitle  ?? p.hook_title  ?? p.suggestedHook ?? p.suggested_hook ?? p.hook ?? p.headline ?? p.title ?? "",
    caption:     p.caption    ?? p.suggestedCaption ?? p.suggested_caption ?? "",
    hashtags,
    hashtagsMergedIntoCaption: p.hashtagsMergedIntoCaption ?? meta.hashtagsMergedIntoCaption ?? false,

    contentStructure: p.contentStructure ?? p.content_structure ?? "",
    visualDirection:  p.visualDirection  ?? p.visual_direction  ?? "",

    outputImageTextRequirements,
    outputImageTextRequirementsStructured,

    imageText,

    structure:   p.structure ?? "",
    inspiration: p.inspiration ?? p.inspirationSource ?? p.inspiration_source ?? "",

    videoConceptTitleAndThumbnailTitleIdea: p.videoConceptTitleAndThumbnailTitleIdea ?? p.video_concept_title_and_thumbnail_title_idea ?? "",
    videoRawIdea:            p.videoRawIdea ?? p.video_raw_idea ?? "",
    mainIntegratedScenario:  p.mainIntegratedScenario ?? p.main_integrated_scenario ?? "",
    thumbnailIdeaForReel:    p.thumbnailIdeaForReel   ?? p.thumbnail_idea_for_reel   ?? "",

    narrationOrDialogueOfCharacterOrCharacters: p.narrationOrDialogueOfCharacterOrCharacters ?? p.narration_or_dialogue_of_character_or_characters ?? "",
    rawImageIdeaForFirstFrame: p.rawImageIdeaForFirstFrame ?? p.raw_image_idea_for_first_frame ?? "",
    whatHappens:               p.whatHappens ?? p.what_happens ?? "",
    characterObjectOrEnvironmentAction: p.characterObjectOrEnvironmentAction ?? p.character_object_or_environment_action ?? "",
    cameraMovement: p.cameraMovement ?? p.camera_movement ?? "",
    speedRamp:      p.speedRamp      ?? p.speed_ramp      ?? "Auto",
    camera:         p.camera         ?? "Auto",
    lens:           p.lens           ?? "Auto",
    focalLength:    p.focalLength    ?? p.focal_length    ?? "50",
    aperture:       p.aperture       ?? "f/4 moderate",
    visualMood:     p.visualMood    ?? p.visual_mood    ?? "",
    textOnVideo:    p.textOnVideo   ?? p.text_on_video   ?? "",

    status:        p.status        ?? "Draft",
    contentOrigin: p.contentOrigin ?? p.content_origin ?? "original",
    referenceLink: p.referenceLink  ?? p.reference_link  ?? "",
  };
}

function emptyNormalizedPost(idx) {
  return {
    _id: `p-${idx}`, postNumber: idx + 1, date: "", platform: "", format: "",
    mainAngle: "", coreMessage: "", hookTitle: "", caption: "", hashtags: [], hashtagsMergedIntoCaption: false,
    contentStructure: "", visualDirection: "",
    outputImageTextRequirements: "", outputImageTextRequirementsStructured: null, imageText: "",
    structure: "", inspiration: "",
    videoConceptTitleAndThumbnailTitleIdea: "", videoRawIdea: "", mainIntegratedScenario: "", thumbnailIdeaForReel: "",
    narrationOrDialogueOfCharacterOrCharacters: "", rawImageIdeaForFirstFrame: "", whatHappens: "",
    characterObjectOrEnvironmentAction: "", cameraMovement: "",
    speedRamp: "Auto", camera: "Auto", lens: "Auto", focalLength: "50", aperture: "f/4 moderate",
    visualMood: "", textOnVideo: "",
    status: "Draft", contentOrigin: "original", referenceLink: "",
  };
}

// ─── validateOutputImageTextRequirements ──────────────────────────────────────
// Returns { valid: boolean, reason: string } for a normalized post (or AI raw
// post — both expose `format`, `contentStructure`, `outputImageTextRequirements*`).
// Used by the generation and regeneration routes to decide whether to apply the
// fallback builder. Validates against the CONTENT STRUCTURE slide count so a
// 6-slide carousel that only returns "Slide 1" and "Slide 4" is correctly
// rejected, not silently accepted.
function _slidesAreAllIdentical(slides) {
  if (slides.length < 2) return false;
  const sigs = new Set(slides.map(s => JSON.stringify(s.fields)));
  return sigs.size === 1;
}

export function validateOutputImageTextRequirements(post) {
  const format     = (post.format ?? "").toLowerCase();
  const isVideo    = /reel|story|video|live/.test(format);
  const isCarousel = format.includes("carousel");

  const structured =
    normalizeOutputImageTextRequirementsStructured(post.outputImageTextRequirementsStructured) ||
    normalizeOutputImageTextRequirementsStructured(post.outputImageTextRequirements);

  // Videos with no thumbnail requirement → empty is fine
  if (isVideo && !structured) return { valid: true, reason: "ok_video_empty" };
  if (!structured) return { valid: false, reason: "empty" };

  if (isCarousel) {
    if (structured.type !== "carousel" || !structured.slides.length) {
      return { valid: false, reason: "not_carousel_shape" };
    }

    const slides = structured.slides.slice().sort((a, b) => a.slideNumber - b.slideNumber);
    const expected = parseSlideCountFromContentStructure(post.contentStructure);

    if (expected > 0 && slides.length !== expected) {
      return { valid: false, reason: "slide_count_mismatch" };
    }
    if (slides.length < 2) {
      return { valid: false, reason: "truncated" };
    }

    // Sequential 1..N numbering — catches "Slide 1, Slide 4" style gaps
    const sequential = slides.every((s, i) => s.slideNumber === i + 1);
    if (!sequential) return { valid: false, reason: "non_sequential_slides" };

    // Each slide needs at least a headline or supporting text to be useful
    const incomplete = slides.some(s => !s.fields.main_headline && !s.fields.supporting_text);
    if (incomplete) return { valid: false, reason: "incomplete_slide" };

    if (_slidesAreAllIdentical(slides)) return { valid: false, reason: "duplicate_slides" };

    return { valid: true, reason: "ok" };
  }

  if (isVideo) {
    if (structured.type !== "video" || !Array.isArray(structured.items)) return { valid: false, reason: "type_mismatch" };
    const ok = structured.items.some(f => f.main_headline || f.additional_text_notes);
    return ok ? { valid: true, reason: "ok" } : { valid: false, reason: "incomplete_video" };
  }

  // Static
  if (!Array.isArray(structured.items)) return { valid: false, reason: "missing_items" };
  const item = structured.items[0];
  if (!item || (!item.main_headline && !item.supporting_text)) {
    return { valid: false, reason: "missing_meaningful_field" };
  }
  return { valid: true, reason: "ok" };
}

// ─── buildFallbackOutputImageTextRequirements ─────────────────────────────────
// Constructs a structured outputImageTextRequirements object from the other
// post fields. Used when the AI output is missing, empty, incomplete, or
// fails validation (e.g. wrong slide count, duplicated slides).
//
//   • Carousel — one slide per Content Structure entry, Slide 1 anchored to the
//     Hook/Title, middle slides split into a headline + detail where the
//     structure line allows it (Core Message is only a last-resort detail),
//     final slide carrying the CTA pulled from the caption (never invented).
//   • Static — main_headline from Hook/Title (or the caption's opening line);
//     subheadline drawn from Content Structure or a concrete caption sentence,
//     with Core Message only as a last resort; badge_or_label reframed from
//     Main Angle into a design-ready callout rather than echoed verbatim; any
//     remaining Content Structure / caption detail surfaces as short bullets
//     in additional_text_notes.
//   • Video/Reel — empty (per the rules, video text is opt-in only).
// Truncates to maxLen without cutting a word in half — falls back to a hard
// cut only if no word boundary is available, so on-image text never ends
// mid-word (e.g. "windo" instead of "window").
function _truncateAtWord(text, maxLen) {
  if (!text || text.length <= maxLen) return text || "";
  const cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim();
}

function _extractCtaFromCaption(caption) {
  const ctaMatch = (caption || "").match(
    /\b(?:click|tap|swipe up|book|message|dm|call us|visit|learn more|discover|get started|follow|save|share|comment|link in bio)[^\n.!?]{0,60}/i
  );
  return ctaMatch ? _truncateAtWord(ctaMatch[0].trim(), 60) : "";
}

function _slideRoleForIndex(i, count) {
  if (i === 0) return "Hook";
  if (i === count - 1) return "CTA";
  return "Body";
}

// Splits free text into clean, trimmed lines — strips "Slide N:" labels,
// bullets, and numbering — so the fallback can pull concrete per-line detail
// out of Content Structure instead of repeating Core Message everywhere.
function _extractDetailLines(text, maxLines = 6, maxLen = 90) {
  if (!text) return [];
  return text
    .split(/\n|(?=Slide\s+\d+\s*[:\-])/i)
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => l.replace(/^(?:Slide\s*\d+\s*[:\-]?\s*|[•\-*]\s*|\d+[.)]\s*)/i, "").trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .map(l => _truncateAtWord(l, maxLen));
}

// Splits a "Label — detail" / "Label: detail" line into a headline + a
// distinct supporting detail, so one Content Structure entry can yield both
// instead of repeating Core Message under every slide.
function _splitLineParts(line) {
  const m = (line || "").match(/^(.{3,60}?)\s*(?:—|–|-)\s+(.{3,})$/);
  if (m) return { head: m[1].trim(), detail: m[2].trim() };
  return { head: (line || "").trim(), detail: "" };
}

// Splits a caption into concrete sentences — drops hashtags, the CTA
// sentence, and very short fragments — leaving sentences specific enough to
// stand in for a generic Core Message restatement.
function _extractCaptionDetails(caption, maxLen = 90) {
  if (!caption) return [];
  const cta = _extractCtaFromCaption(caption);
  return caption
    .replace(/#\w+/g, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 12)
    .filter(s => !cta || !s.toLowerCase().includes(cta.toLowerCase().slice(0, 20)))
    .map(s => _truncateAtWord(s, maxLen));
}

// Reframes a strategic Main Angle as a short, design-ready badge/callout —
// brand-agnostic and never invents specifics; just avoids echoing the raw
// angle value (e.g. "Educational") verbatim as the on-image label.
const ANGLE_BADGES = {
  education: "How It Works",
  educational: "How It Works",
  trust: "Why It Matters",
  promotion: "Limited Time",
  engagement: "Join In",
  "behind the scenes": "Behind The Scenes",
  "objection handling": "Common Question",
  "case study": "Real Results",
};

function _badgeForAngle(angle) {
  return ANGLE_BADGES[(angle || "").trim().toLowerCase()] || "";
}

export function buildFallbackOutputImageTextRequirements(post) {
  const format     = (post.format ?? "").toLowerCase();
  const isVideo    = /reel|story|video|live/.test(format);
  const isCarousel = format.includes("carousel");

  if (isVideo) return { type: "video", items: [] };

  const hook  = _truncateAtWord((post.hookTitle   || post.coreMessage || "").trim(), 80);
  const core  = _truncateAtWord((post.coreMessage || "").trim(), 100);
  const angle = (post.mainAngle   || "").trim();
  const cta   = _extractCtaFromCaption(post.caption);

  if (!isCarousel) {
    const structureLines = _extractDetailLines(post.contentStructure, 4, 90);
    const captionLines   = _extractCaptionDetails(post.caption, 90);

    const headline = hook || captionLines[0] || "";

    // Supporting line: prefer a concrete Content Structure or caption detail
    // over Core Message — Core Message is only used when nothing else exists.
    const supportingCandidate =
      structureLines[0] ||
      captionLines.find(s => s.toLowerCase() !== headline.toLowerCase()) ||
      (core && core.toLowerCase() !== headline.toLowerCase() ? _truncateAtWord(core, 90) : "");

    // Any leftover specifics become short on-image bullets.
    const bulletSource = structureLines.length > 1 ? structureLines.slice(1, 4) : captionLines.slice(1, 4);
    const bulletLines = bulletSource.filter(l =>
      l.toLowerCase() !== headline.toLowerCase() && l.toLowerCase() !== (supportingCandidate || "").toLowerCase()
    );

    const item = _cleanFields({
      main_headline:  headline,
      subheadline:    supportingCandidate,
      badge_or_label: _badgeForAngle(angle),
      additional_text_notes: bulletLines.length ? bulletLines.map(l => `• ${l}`).join("  ") : "",
      call_to_action: cta,
    });
    return { type: "static", items: Object.keys(item).length ? [item] : [] };
  }

  // ── Carousel: derive one slide per Content Structure entry ────────────────
  const structure = post.contentStructure || "";
  const rawLines = structure
    .split(/\n|(?=Slide\s+\d+\s*[:\-])/i)
    .map(l => l.trim())
    .filter(Boolean);
  const descs = rawLines
    .map(l => l.replace(/^(?:Slide\s*\d+\s*[:\-]?\s*|[•\-]\s*|\d+\.\s*)/i, "").trim())
    .filter(Boolean);

  const expected = parseSlideCountFromContentStructure(structure);
  const count = Math.max(expected, descs.length, 3);

  const slides = [];
  for (let i = 0; i < count; i++) {
    const n    = i + 1;
    const desc = _truncateAtWord(descs[i] || "", 90);
    const role = _slideRoleForIndex(i, count);
    const { head, detail } = _splitLineParts(desc);

    let fields;
    if (i === 0) {
      fields = _cleanFields({
        main_headline:  hook || head || `Slide ${n}`,
        subheadline:    detail || (desc && desc.toLowerCase() !== hook.toLowerCase() ? _truncateAtWord(desc, 70) : ""),
        badge_or_label: _badgeForAngle(angle),
      });
    } else if (i === count - 1) {
      fields = _cleanFields({
        main_headline:  head || "Ready to get started?",
        call_to_action: cta,
        badge_or_label: cta ? "" : _badgeForAngle(angle),
      });
    } else {
      fields = _cleanFields({
        main_headline:   head || `Key point ${n}`,
        supporting_text: detail || (core ? _truncateAtWord(core, 80) : ""),
      });
    }

    if (Object.keys(fields).length) slides.push({ slideNumber: n, slideRole: role, fields });
  }

  return { type: "carousel", slides };
}

// ─── serializePostForSave ──────────────────────────────────────────────────────
// Maps a normalized post back to the DB record shape (scalar columns + postData Json).
// Both the clean string (`outputImageTextRequirements`, kept as the DB scalar
// column for export/search/legacy readers) and the structured object
// (`outputImageTextRequirementsStructured`, stored only inside postData — no
// migration needed) are persisted side by side, per the backward-compatible
// MVP storage approach.

export function serializePostForSave(norm, defaultPlatform) {
  const hashtags = Array.isArray(norm.hashtags) ? norm.hashtags : [];
  const hashtagStr = hashtags.join(" ") || null;

  const meta = {
    mainAngle:   norm.mainAngle   || null,
    coreMessage: norm.coreMessage || null,
    hookTitle:   norm.hookTitle   || null,
    caption:     norm.caption     || null,
    hashtags,
    hashtagsMergedIntoCaption: norm.hashtagsMergedIntoCaption ?? false,
    imageText:   norm.imageText   || null,
    outputImageTextRequirements: norm.outputImageTextRequirements || null,
    outputImageTextRequirementsStructured: norm.outputImageTextRequirementsStructured || null,
    structure:   norm.structure   || null,
    inspiration: norm.inspiration || null,
    videoConceptTitleAndThumbnailTitleIdea: norm.videoConceptTitleAndThumbnailTitleIdea || null,
    videoRawIdea:           norm.videoRawIdea           || null,
    mainIntegratedScenario: norm.mainIntegratedScenario || null,
    thumbnailIdeaForReel:   norm.thumbnailIdeaForReel   || null,
    narrationOrDialogueOfCharacterOrCharacters: norm.narrationOrDialogueOfCharacterOrCharacters || null,
    rawImageIdeaForFirstFrame: norm.rawImageIdeaForFirstFrame || null,
    whatHappens:               norm.whatHappens               || null,
    characterObjectOrEnvironmentAction: norm.characterObjectOrEnvironmentAction || null,
    cameraMovement: norm.cameraMovement || null,
    speedRamp:      norm.speedRamp      || null,
    camera:         norm.camera         || null,
    lens:           norm.lens           || null,
    focalLength:    norm.focalLength    || null,
    aperture:       norm.aperture       || null,
    visualMood:     norm.visualMood     || null,
    textOnVideo:    norm.textOnVideo    || null,
  };

  return {
    date:         norm.date     || null,
    postNumber:   norm.postNumber,
    platform:     norm.platform || defaultPlatform || null,
    format:       norm.format   || null,
    // backward-compat DB columns (so old loading code still works)
    suggestedHook:              norm.hookTitle   || null,
    mainAngleAndCoreMessage:    [norm.mainAngle, norm.coreMessage].filter(Boolean).join(". ") || null,
    suggestedCaption:           norm.caption     || null,
    hashtags:                   hashtagStr,
    visualDirection:            norm.visualDirection   || null,
    contentStructure:           norm.contentStructure  || null,
    // store the dedicated outputImageTextRequirements (clean string) in its DB column
    outputImageTextRequirements: norm.outputImageTextRequirements || null,
    inspirationSource:          norm.inspiration       || null,
    contentOrigin:              norm.contentOrigin     || "original",
    referenceLink:              norm.referenceLink     || null,
    status:                     (norm.status ?? "Draft").toLowerCase(),
    postData:                   JSON.stringify(meta),
  };
}
