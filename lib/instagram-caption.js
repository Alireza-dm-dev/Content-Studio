// Instagram caption rules — DETERMINISTIC layer only.
//
// Pure and client-safe (no prisma, no AI): the upload form uses the same
// validator the server uses as its save gate, so the two can never disagree.
//
// Final caption contract (Instagram only; LinkedIn is never touched):
//
//   content paragraph
//                                  ← exactly one blank line between blocks
//   content paragraph
//
//   Brand footer (one line per field, built ONLY from stored Brand data)
//
//   #five #unique #valid #hash #tags   ← always the last line
//
// This module never rewrites wording. It only changes whitespace, moves
// hashtags into the final line, splits over-long paragraphs at sentence
// boundaries, and (re)builds the Brand footer. Grammar / tone / clarity are
// the AI layer's job (lib/instagram-caption-check.js).


// ── Configurable rules ───────────────────────────────────────────────────────
// Rendered line count depends on screen/font, so "≤ 3 lines" is approximated
// textually. Chosen from local data: calendar-generated Instagram paragraphs
// sit at ≤ 3 sentences / ~260 chars at p90; uploaded ones ran to 900+.
export const CAPTION_RULES = Object.freeze({
  hashtagCount: 5,
  maxSentencesPerParagraph: 3,
  maxParagraphChars: 280,
});

export const CAPTION_FAILURE_MESSAGES = Object.freeze({
  EMPTY_CAPTION: "The caption has no text before the Brand footer and hashtags.",
  SPACING: "Paragraphs must be separated by exactly one blank line (no double blank lines, blank-looking lines or trailing spaces).",
  HASHTAG_COUNT: "The caption must end with exactly 5 unique, valid hashtags on the last line.",
  HASHTAGS_OUTSIDE_BLOCK: "Hashtags must only appear in the final hashtag line.",
  FOOTER_MISSING: "The Brand information block must appear right before the hashtags.",
});

// ── Hashtags ─────────────────────────────────────────────────────────────────
// Characters kept inside a tag. Deliberately matches extractHashtags() in
// published-post-utils (ASCII word chars + Arabic/Persian + Cyrillic blocks), so
// the n8n "Hashtags" field always equals the caption's hashtag line.
const TAG_BODY = "A-Za-z0-9_\\u0600-\\u06FF\\u0400-\\u04FF";
const VALID_TAG_RE = new RegExp(`^#[${TAG_BODY}]+$`);
const HAS_LETTER_RE = /[A-Za-z؀-ۯۺ-ۿЀ-ӿ]/; // not digits only
// A raw token as a user types it: '#' then anything up to whitespace.
const RAW_TAG_RE = /#[^\s#]+/g;

/**
 * Normalise one hashtag. Returns "#Tag" or null when it cannot be made valid.
 * Removes ZWNJ (Instagram ends a tag there) and Latin diacritics; strips
 * trailing punctuation. Never invents characters.
 */
export function normalizeHashtag(raw) {
  let tag = String(raw ?? "").trim();
  if (!tag) return null;
  if (!tag.startsWith("#")) tag = `#${tag}`;
  tag = "#" + tag
    .slice(1)
    .replace(/‌/g, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .normalize("NFC")
    .replace(/[.,;:!?؟،؛)\]}"'»«…]+$/u, "");
  if (!VALID_TAG_RE.test(tag)) return null;
  if (!HAS_LETTER_RE.test(tag)) return null;
  if (tag.length > 60) return null;
  return tag;
}

/** De-duplicate case-insensitively, keeping the first spelling and order. */
export function uniqueHashtags(tags) {
  const seen = new Set();
  const out = [];
  for (const t of tags) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function wordsOf(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3);
}

// Relevance = how many words of the tag (CamelCase-split) appear, as a prefix
// match, in the caption body or the Brand data. Purely lexical and explainable.
export function hashtagRelevance(tag, contextText) {
  const ctx = wordsOf(contextText);
  const parts = tag
    .slice(1)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_]+/)
    .flatMap((p) => wordsOf(p));
  const whole = wordsOf(tag.slice(1));
  let score = 0;
  for (const p of new Set([...parts, ...whole])) {
    const stem = p.slice(0, Math.max(4, Math.ceil(p.length * 0.75)));
    if (ctx.some((w) => w.startsWith(stem) || p.startsWith(w.slice(0, Math.max(4, w.length))))) score++;
  }
  return score;
}

// Generic / engagement-bait tags the generation rules already forbid
// (CAPTION_GENERATION_RULES_LINES). Ranked below any topical tag.
export const GENERIC_HASHTAGS = new Set([
  "love", "instagood", "follow", "followme", "like", "like4like", "likeforlike", "viral",
  "trending", "fyp", "foryou", "explore", "explorepage", "photooftheday", "instadaily",
  "random", "tbt", "picoftheday", "instalike", "reels", "reelsinstagram",
]);

/**
 * Pick exactly `count` hashtags from more than `count`: highest relevance
 * first, ties keep the user's original order; output stays in original order.
 */
export function selectMostRelevantHashtags(tags, contextText, count = CAPTION_RULES.hashtagCount) {
  if (tags.length <= count) return [...tags];
  const ranked = tags
    .map((tag, index) => ({
      tag,
      index,
      score: GENERIC_HASHTAGS.has(tag.slice(1).toLowerCase()) ? -1 : hashtagRelevance(tag, contextText),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, count)
    .sort((a, b) => a.index - b.index);
  return ranked.map((r) => r.tag);
}

// ── Deterministic hashtag padding (no AI) ────────────────────────────────────
// Only SAFE structured sources: the Brand name, the city part of the location,
// services ONLY when that field is a short list (never prose), the business
// type and the Main Angle. Every candidate is at most 3 words; article-led
// phrases ("The Uk") and list headings ("B2c sales:") are rejected. If this
// cannot reach 5, the caller warns instead of inventing tags.
const ARTICLES = new Set(["the", "a", "an"]);
const MAX_PADDING_WORDS = 3;

function phraseToHashtag(text) {
  const raw = String(text ?? "").trim();
  if (!raw || /:\s*$/.test(raw)) return null;
  const words = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (!words.length || words.length > MAX_PADDING_WORDS) return null;
  if (ARTICLES.has(words[0].toLowerCase())) return null;
  const tag = words
    // only the first letter is touched: acronyms and brand names stay verbatim
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
  return tag.length >= 2 && tag.length <= 24 ? `#${tag}` : null;
}

// A services field is list-like when it has no sentence in it.
function listItems(value) {
  const s = String(value ?? "").trim();
  if (!s || /[.!?](\s|$)/.test(s) || s.length > 300) return [];
  return s.split(/\n|,|;|\/|\band\b/i).map((x) => x.trim()).filter(Boolean);
}

export function safeBrandHashtags(context = {}, captionText = "") {
  const services = listItems(context.mainServicesOrProducts)
    .map((item, index) => ({ item, index, score: hashtagRelevance(`#${item.replace(/\s+/g, "")}`, captionText) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.item);
  const city = String(context.businessLocation ?? "").split(",")[0];
  return [context.brandName, city, ...services, context.businessType, context.mainAngle]
    .map(phraseToHashtag)
    .filter(Boolean);
}

// ── Brand footer ─────────────────────────────────────────────────────────────
const PHONE_RE = /(?:\+|00)?\d[\d\s().-]{7,}\d/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function digitsOnly(s) {
  return String(s ?? "")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/\D/g, "");
}

export function displayWebsite(url) {
  const s = String(url ?? "").trim();
  if (!s) return "";
  return s.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");
}

/**
 * Brand information used for the footer, from STORED data only.
 *   name, website, location  ← Brand columns
 *   phone, email             ← exact phone/email patterns found in the Brand
 *                              Identity "contactInformation" text (never prose)
 * Missing fields are omitted, never invented.
 */
export function extractBrandFooterInfo(brand, toneInformation) {
  const contact = String(toneInformation?.contactInformation ?? "");
  const phones = (contact.match(PHONE_RE) || [])
    .map((p) => p.trim())
    .filter((p) => digitsOnly(p).length >= 9 && digitsOnly(p).length <= 15);
  const emails = contact.match(EMAIL_RE) || [];
  const website = brand?.website || toneInformation?.website || "";
  return {
    name: String(brand?.name ?? "").trim(),
    website: displayWebsite(website),
    location: String(brand?.businessLocation ?? "").trim(),
    phone: phones[0] || "",
    email: emails[0] || "",
  };
}

const FOOTER_LINES = [
  ["location", "📍"],
  ["website", "🌐"],
  ["phone", "📞"],
  ["email", "✉️"],
];

function footerFieldPresent(field, value, text) {
  if (!value || !text) return false;
  const hay = String(text).toLowerCase();
  if (field === "phone") {
    const d = digitsOnly(value);
    return d.length >= 7 && digitsOnly(text).includes(d.slice(-9));
  }
  if (field === "website") return hay.includes(displayWebsite(value).toLowerCase());
  return hay.includes(String(value).toLowerCase());
}

/**
 * buildCaptionBrandFooter(info, { precedingText })
 *
 * One line per available field, Brand name first. Language-neutral (emoji
 * markers, no translated labels). A field already present in the paragraph
 * immediately above the footer is omitted to avoid repeating it. If nothing
 * but the name is known, the footer is the name alone.
 */
export function buildCaptionBrandFooter(info, { precedingText = "" } = {}) {
  const name = String(info?.name ?? "").trim();
  const lines = [];
  if (name) lines.push(name);
  for (const [field, marker] of FOOTER_LINES) {
    const value = String(info?.[field] ?? "").trim();
    if (!value) continue;
    if (footerFieldPresent(field, value, precedingText)) continue;
    lines.push(`${marker} ${value}`);
  }
  return lines.join("\n");
}

// Every line our footer could contain for this Brand (used to recognise and
// rebuild an existing footer instead of stacking a second one).
function candidateFooterLines(info) {
  const set = new Set();
  const name = String(info?.name ?? "").trim();
  if (name) set.add(name.toLowerCase());
  for (const [field, marker] of FOOTER_LINES) {
    const value = String(info?.[field] ?? "").trim();
    if (value) set.add(`${marker} ${value}`.toLowerCase());
  }
  return set;
}

function isFooterBlock(block, info) {
  const candidates = candidateFooterLines(info);
  if (!candidates.size) return false;
  const lines = block.split("\n").map((l) => l.trim().toLowerCase()).filter(Boolean);
  return lines.length > 0 && lines.every((l) => candidates.has(l));
}

// ── Sentences / paragraphs ───────────────────────────────────────────────────
const ABBREVIATIONS = new Set([
  "e.g", "i.e", "etc", "vs", "mr", "mrs", "ms", "dr", "st", "no", "ltd", "inc", "co",
  "u.k", "u.s", "a.m", "p.m", "approx", "dept", "est", "jr", "sr", "prof",
]);

/**
 * Split text into sentences at [.!?؟…] + whitespace. Never splits inside a URL,
 * e-mail, decimal number, known abbreviation or single-letter initial, because
 * those have no whitespace after the dot or are explicitly skipped.
 */
export function splitSentences(text) {
  const s = String(text ?? "");
  const out = [];
  let start = 0;
  const re = /[.!?؟…]+["'»”’)\]]*(?=\s+)/gu;
  let m;
  while ((m = re.exec(s))) {
    const end = m.index + m[0].length;
    const before = s.slice(start, m.index);
    const lastWord = (before.match(/(\S+)$/) || [""])[0].toLowerCase().replace(/^[("'«“]+/, "");
    if (m[0].startsWith(".") && (ABBREVIATIONS.has(lastWord) || /^\p{L}$/u.test(lastWord))) continue;
    const sentence = s.slice(start, end).trim();
    if (sentence) out.push(sentence);
    start = end;
  }
  const tail = s.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

export function paragraphTooLong(paragraph) {
  const p = String(paragraph ?? "").trim();
  if (!p) return false;
  return (
    p.length > CAPTION_RULES.maxParagraphChars ||
    splitSentences(p.replace(/\n/g, " ")).length > CAPTION_RULES.maxSentencesPerParagraph
  );
}

/**
 * Split ONE single-line paragraph at sentence boundaries into chunks of at
 * most maxSentences sentences / maxParagraphChars characters. A single
 * sentence longer than the limit is kept whole (never cut mid-sentence).
 */
export function splitLongParagraph(paragraph) {
  const sentences = splitSentences(paragraph);
  if (sentences.length <= 1) return [String(paragraph).trim()];
  const chunks = [];
  let current = [];
  for (const sentence of sentences) {
    const candidate = [...current, sentence].join(" ");
    if (
      current.length &&
      (current.length >= CAPTION_RULES.maxSentencesPerParagraph ||
        candidate.length > CAPTION_RULES.maxParagraphChars)
    ) {
      chunks.push(current.join(" "));
      current = [sentence];
    } else {
      current.push(sentence);
    }
  }
  if (current.length) chunks.push(current.join(" "));
  return chunks;
}

// ── Parsing ──────────────────────────────────────────────────────────────────
function cleanLines(text) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[  -   　]/g, " ") // exotic spaces (not ZWNJ)
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim());
}

function toBlocks(lines) {
  const blocks = [];
  let cur = [];
  for (const line of lines) {
    if (!line) {
      if (cur.length) blocks.push(cur.join("\n"));
      cur = [];
    } else cur.push(line);
  }
  if (cur.length) blocks.push(cur.join("\n"));
  return blocks;
}

const HASHTAG_ONLY_LINE_RE = /^(?:#[^\s#]+[\s,.•·|]*)+$/u;

/**
 * Pull every hashtag out of the text without deleting words:
 *  - a hashtag-only line is removed;
 *  - a trailing run of hashtags at the end of a text line is removed;
 *  - a hashtag in the middle of a sentence keeps its word ("#CCTV" → "CCTV").
 * Returns { lines, rawTags, inlineMoved }.
 */
function extractHashtagsFromLines(lines) {
  const rawTags = [];
  const inlineMoved = [];
  const out = [];
  for (const line of lines) {
    if (!line) {
      out.push(line);
      continue;
    }
    if (HASHTAG_ONLY_LINE_RE.test(line)) {
      rawTags.push(...(line.match(RAW_TAG_RE) || []));
      continue;
    }
    let text = line;
    const trailing = text.match(/(?:\s+#[^\s#]+)+\s*$/u);
    if (trailing) {
      rawTags.push(...(trailing[0].match(RAW_TAG_RE) || []));
      text = text.slice(0, trailing.index).trimEnd();
    }
    text = text.replace(RAW_TAG_RE, (tok) => {
      rawTags.push(tok);
      inlineMoved.push(tok);
      return tok.slice(1);
    });
    out.push(text);
  }
  return { lines: out, rawTags, inlineMoved };
}

// ── Normalise ────────────────────────────────────────────────────────────────
/**
 * normalizeInstagramCaption(text, options)
 *
 * options:
 *   footerInfo      — from extractBrandFooterInfo()
 *   hashtagContext  — { brandName, mainServicesOrProducts, businessLocation,
 *                       businessType, mainAngle } for deterministic padding
 *   hashtags        — optional explicit hashtag list (e.g. from the AI layer);
 *                     when given it replaces the tags found in `text`
 *
 * Returns { caption, body, footer, hashtags, changes, warnings }.
 */
export function normalizeInstagramCaption(text, options = {}) {
  const { footerInfo = null, hashtagContext = {}, hashtags: explicitTags = null } = options;
  const changes = [];
  const warnings = [];
  const original = String(text ?? "");

  // 1. whitespace
  const lines = cleanLines(original);
  const { lines: noTagLines, rawTags, inlineMoved } = extractHashtagsFromLines(lines);
  if (inlineMoved.length) {
    changes.push({ type: "hashtags", message: `Moved in-text hashtags to the hashtag line: ${inlineMoved.join(" ")}` });
  }

  // 2. blocks, minus any existing (possibly duplicated) Brand footer
  let blocks = toBlocks(noTagLines);
  if (footerInfo) {
    const before = blocks.length;
    blocks = blocks.filter((b) => !isFooterBlock(b, footerInfo));
    if (blocks.length !== before) changes.push({ type: "footer", message: "Rebuilt the existing Brand information block." });
  }

  // 3. paragraph length — split single-line paragraphs at sentence boundaries;
  //    multi-line blocks (lists, CTA blocks) are preserved as written.
  const body = [];
  for (const block of blocks) {
    if (!block.includes("\n") && paragraphTooLong(block)) {
      const parts = splitLongParagraph(block);
      if (parts.length > 1) changes.push({ type: "paragraphs", message: `Split a long paragraph into ${parts.length} shorter paragraphs.` });
      body.push(...parts);
    } else {
      body.push(block);
    }
  }
  for (const p of body) {
    if (paragraphTooLong(p)) {
      warnings.push({ code: "PARAGRAPH_TOO_LONG", message: `A paragraph is still longer than ${CAPTION_RULES.maxSentencesPerParagraph} sentences / ${CAPTION_RULES.maxParagraphChars} characters and could not be split safely: "${p.slice(0, 60)}…"` });
    }
  }

  // 4. hashtags
  const sourceTags = explicitTags ?? rawTags;
  const normalized = [];
  const dropped = [];
  for (const raw of sourceTags) {
    const tag = normalizeHashtag(raw);
    if (tag) normalized.push(tag);
    else dropped.push(raw);
  }
  if (dropped.length) changes.push({ type: "hashtags", message: `Removed malformed hashtags: ${dropped.join(" ")}` });
  let tags = uniqueHashtags(normalized);
  if (tags.length < normalized.length) changes.push({ type: "hashtags", message: "Removed duplicate hashtags." });

  const relevanceContext = [
    body.join(" "),
    hashtagContext.brandName,
    hashtagContext.mainServicesOrProducts,
    hashtagContext.businessLocation,
    hashtagContext.businessType,
    hashtagContext.mainAngle,
  ].filter(Boolean).join(" ");

  if (tags.length > CAPTION_RULES.hashtagCount) {
    const kept = selectMostRelevantHashtags(tags, relevanceContext);
    const removed = tags.filter((t) => !kept.includes(t));
    changes.push({ type: "hashtags", message: `Kept the 5 most relevant hashtags; removed ${removed.join(" ")}` });
    tags = kept;
  }
  if (tags.length < CAPTION_RULES.hashtagCount) {
    const padding = safeBrandHashtags(hashtagContext, body.join(" "))
      .map(normalizeHashtag)
      .filter(Boolean);
    const added = uniqueHashtags([...tags, ...padding]).slice(tags.length, CAPTION_RULES.hashtagCount);
    if (added.length) {
      changes.push({ type: "hashtags", message: `Added hashtags from stored Brand data: ${added.join(" ")}` });
      tags = [...tags, ...added];
    }
  }
  if (tags.length < CAPTION_RULES.hashtagCount) {
    warnings.push({
      code: "HASHTAGS_INSUFFICIENT",
      message: `Only ${tags.length} valid hashtag(s) could be found without inventing tags. Add ${CAPTION_RULES.hashtagCount - tags.length} relevant hashtag(s) manually.`,
    });
  }

  // 5. footer (deduped against the paragraph right above it)
  const footer = footerInfo
    ? buildCaptionBrandFooter(footerInfo, { precedingText: body[body.length - 1] || "" })
    : "";

  const caption = [body.join("\n\n"), footer, tags.join(" ")].filter(Boolean).join("\n\n");
  if (caption !== original) {
    const spacingOnly = cleanLines(original).join("\n") !== original;
    if (spacingOnly) changes.unshift({ type: "spacing", message: "Cleaned blank lines, duplicate spaces and trailing spaces." });
  }
  return { caption, body, footer, hashtags: tags, changes, warnings };
}

// ── Validate (the save gate) ─────────────────────────────────────────────────
/**
 * validateInstagramCaption(caption, { footerInfo })
 * → { ok, failures: [{code, message}], warnings: [{code, message}] }
 *
 * Required (block save): non-empty body, clean spacing, footer right before
 * the hashtag line, exactly 5 unique valid hashtags as the last line and no
 * hashtags anywhere else. Paragraph length is a warning (it is approximate).
 */
export function validateInstagramCaption(caption, { footerInfo } = {}) {
  const failures = [];
  const warnings = [];
  const fail = (code) => failures.push({ code, message: CAPTION_FAILURE_MESSAGES[code] });
  const text = String(caption ?? "");

  if (
    /\r/.test(text) ||
    /[ \t]+$/m.test(text) ||
    /^[ \t]+\S/m.test(text) ||
    /\n[ \t]*\n[ \t]*\n/.test(text) ||
    /\n[ \t]+\n/.test(text) ||
    text !== text.trim()
  ) {
    fail("SPACING");
  }

  const blocks = toBlocks(cleanLines(text));
  const last = blocks[blocks.length - 1] || "";
  // A hashtag-only last line IS the hashtag line, whatever its count, so a
  // wrong count is reported once instead of cascading into other failures.
  const lastIsTagLine = !last.includes("\n") && HASHTAG_ONLY_LINE_RE.test(last);
  const lastTags = lastIsTagLine ? last.split(" ") : [];
  const tagLineOk =
    lastTags.length === CAPTION_RULES.hashtagCount &&
    lastTags.every((t) => normalizeHashtag(t) === t) &&
    uniqueHashtags(lastTags).length === CAPTION_RULES.hashtagCount;
  if (!tagLineOk) fail("HASHTAG_COUNT");

  const rest = lastIsTagLine ? blocks.slice(0, -1) : blocks;
  if (rest.some((b) => /(^|\s)#[^\s#]+/u.test(b))) fail("HASHTAGS_OUTSIDE_BLOCK");

  let body = rest;
  if (footerInfo) {
    // Only treat the last block as the footer when it looks like one; a
    // caption with no footer yet keeps all its text as body (so it is not
    // misreported as an empty caption).
    const footerBlock = rest[rest.length - 1] || "";
    if (isFooterBlock(footerBlock, footerInfo)) body = rest.slice(0, -1);
    const expected = buildCaptionBrandFooter(footerInfo, { precedingText: body[body.length - 1] || "" });
    if (!expected || footerBlock !== expected) fail("FOOTER_MISSING");
  }

  if (!body.some((b) => b.trim())) fail("EMPTY_CAPTION");

  for (const p of body) {
    if (paragraphTooLong(p)) {
      warnings.push({ code: "PARAGRAPH_TOO_LONG", message: `Paragraph exceeds ${CAPTION_RULES.maxSentencesPerParagraph} sentences / ${CAPTION_RULES.maxParagraphChars} characters: "${p.slice(0, 60)}…"` });
    }
  }
  return { ok: failures.length === 0, failures, warnings };
}

/**
 * Split a raw caption into what the AI layer should review:
 *   body              — content paragraphs only (no footer, no hashtags)
 *   existingHashtags  — the user's valid, unique tags, unselected and unpadded
 */
export function parseInstagramCaption(text, footerInfo) {
  const { lines, rawTags } = extractHashtagsFromLines(cleanLines(text));
  let blocks = toBlocks(lines);
  if (footerInfo) blocks = blocks.filter((b) => !isFooterBlock(b, footerInfo));
  const existingHashtags = uniqueHashtags(rawTags.map(normalizeHashtag).filter(Boolean));
  return { body: blocks.join("\n\n"), existingHashtags };
}

export const INSTAGRAM_MAIN_ANGLES = ["Educational", "Promotional", "Authority", "Storytelling", "Engagement"];
