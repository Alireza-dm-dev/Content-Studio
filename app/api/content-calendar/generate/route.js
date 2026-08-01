import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, getBrandCalendarAccess } from "@/lib/auth";
import { generateWithPromptTemplate } from "@/lib/ai";
import {
  validateOutputImageTextRequirements,
  buildFallbackOutputImageTextRequirements,
  normalizeOutputImageTextRequirementsStructured,
  formatOutputImageTextRequirementsForDisplay,
} from "@/lib/calendar-post-utils";
import { normalizeBrandIdentityOutput, createCompactBrandVisualIdentitySummaryForImagePrompt } from "@/lib/brand-identity-utils";
import { resolveCalendarAttachmentContext } from "@/lib/calendar-attachment-context";
import { buildLanguageInstruction, normalizeLanguageCode } from "@/lib/content-language";

// ─── Batching constants ──────────────────────────────────────────────────────
const BATCH_SIZE = 4;
const MAX_RETRIES_PER_BATCH = 2;
const MAX_SUPPLEMENTAL_ATTEMPTS = 3;
const SUPPLEMENTAL_BUFFER = 2;

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
// Distribute dates across the selected calendar period for posts that are missing
// or have an invalid/out-of-range date — using any chosen seasonal/event dates as
// preferred anchors where they fall inside that period — and attach a default
// practical time of day. Valid AI-provided dates inside the range are preserved.
// Runs whenever a valid date range exists, regardless of publishingFrequency.

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_FALLBACK_TIMES = ["10:00", "12:00", "15:00", "18:00"];

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

function formatFallbackDate(date, time) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d} ${time}`;
}

// Returns true if the post has a valid date string that falls on or after start
// and on or before end (inclusive). Returns false if date is missing, unparseable,
// or outside the range.
function isValidDateInRange(dateStr, start, end) {
  if (!dateStr) return false;
  const d = parseToUtcDate(dateStr);
  return d !== null && d >= start && d <= end;
}

function applyFallbackDates(posts, { calendarPeriodStart, calendarPeriodEnd, publishingFrequency, seasonalDates = [] }) {
  const start = parseToUtcDate(calendarPeriodStart);
  const end = parseToUtcDate(calendarPeriodEnd);
  if (!start || !end || end < start) return posts;

  const candidates = posts.map(p => ({
    post: p,
    hasValidDate: isValidDateInRange(p.date, start, end),
  }));

  const toFill = candidates.filter(c => !c.hasValidDate);
  if (toFill.length === 0) return posts;

  const totalDays = Math.floor((end - start) / MS_PER_DAY) + 1;

  const anchors = seasonalDates
    .map(d => parseToUtcDate(d?.date))
    .filter(d => d && d >= start && d <= end)
    .sort((a, b) => a - b);

  let anchorIdx = 0;
  let fillIdx = 0;

  return posts.map((p, i) => {
    if (candidates[i].hasValidDate) return p;

    const time = DEFAULT_FALLBACK_TIMES[fillIdx % DEFAULT_FALLBACK_TIMES.length];

    const target = anchorIdx < anchors.length
      ? anchors[anchorIdx++]
      : new Date(start.getTime() + Math.min(totalDays - 1, Math.floor((fillIdx * totalDays) / toFill.length)) * MS_PER_DAY);

    fillIdx++;
    return { ...p, date: formatFallbackDate(target, time) };
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

// ─── Keyword helpers for reference relevance ─────────────────────────────────────
// Returns true when the source reference clearly supports the generated post
// topic. Uses keyword overlap — no AI calls, no schema changes.

const STOP_WORDS = new Set([
  "the", "this", "that", "and", "for", "are", "was", "has", "had", "but",
  "not", "you", "all", "can", "its", "also", "just", "our", "your", "how",
  "why", "who", "what", "when", "where", "which", "with", "from", "they",
  "them", "their", "will", "would", "could", "should", "about", "into",
  "over", "than", "then", "now", "get", "got", "way", "use", "used", "using",
  "new", "one", "two", "more", "much", "many", "some", "each", "every",
  "well", "very", "make", "made", "like", "take", "need", "work", "help",
]);

const GENERIC_MARKETING_WORDS = new Set([
  "business", "service", "services", "expert", "professional", "solution",
  "solutions", "trusted", "quality", "today", "learn", "guide", "tips",
  "strategy", "strategies", "brand", "digital", "online", "marketing",
  "content", "social", "media", "value", "growth", "results", "success",
]);

function normalizeKeywordText(value) {
  if (!value) return "";
  return String(value)
    .toLowerCase()
    .replace(/https?:\/\/[^\s]+/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSignificantKeywords(value) {
  const text = normalizeKeywordText(value);
  if (!text) return [];
  const tokens = text.split(/\s+/).filter(w => w.length >= 3);
  const multiWord = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    multiWord.push(tokens[i] + "_" + tokens[i + 1]);
  }
  return tokens
    .concat(multiWord)
    .filter(w => !STOP_WORDS.has(w) && !GENERIC_MARKETING_WORDS.has(w));
}

function isReferenceRelevant(post, source) {
  const refLink = (source?.referenceLink || "").trim();
  if (!refLink) return false;

  const postFields = [
    post.hookTitle, post.coreMessage, post.caption,
    post.mainAngle, post.contentStructure, post.imageText,
  ];
  const postText = postFields.filter(Boolean).join(" ");
  if (!postText.trim()) return false;

  const postKeywords = extractSignificantKeywords(postText);

  const sourceText = [
    source.inspirationSource, source.inspiration,
    source.contentOrigin, source.referenceLink,
  ].filter(Boolean).join(" ");
  const sourceKeywords = extractSignificantKeywords(sourceText);

  if (!postKeywords.length || !sourceKeywords.length) return false;

  // Check single-word overlap (must have at least 2 shared significant words)
  const postWords = new Set(postKeywords.filter(w => !w.includes("_")));
  const sourceWords = sourceKeywords.filter(w => !w.includes("_"));
  const sharedWords = sourceWords.filter(w => postWords.has(w));
  const singleWordOverlap = sharedWords.length >= 2;

  // Check multi-word phrase overlap (one matching phrase is strong signal)
  const postPhrases = new Set(postKeywords.filter(w => w.includes("_")));
  const sourcePhrases = sourceKeywords.filter(w => w.includes("_"));
  const sharedPhrases = sourcePhrases.filter(w => postPhrases.has(w));
  const phraseOverlap = sharedPhrases.length >= 1;

  return singleWordOverlap || phraseOverlap;
}

// ─── Source field merger ─────────────────────────────────────────────────────────
// After AI generation, copy source fields (referenceLink, contentOrigin,
// inspiration) from selectedPosts into generated posts deterministically by
// index mapping — the AI is never asked to preserve these fields, avoiding
// ambiguous "substantially derived" instructions that cause error responses.
//
// Mapping strategy:
//   - LinkedIn (resource-based): build a deduplicated pool of sources with
//     distinct referenceLinks, then cycle through it by modulo so duplicate
//     article URLs are only used as often as necessary. Existing referenceLink
//     values the AI may have set on a post are preserved.
//   - Other platforms:    1:1 mapping; posts beyond selectedPosts length
//                           keep their existing field values unchanged
//
// Reference relevance:
//   A referenceLink is only attached when the source clearly supports the
//   generated post topic, determined by keyword overlap. Unrelated references
//   are skipped — the post keeps an empty referenceLink.

function mergeSourceFields(generatedPosts, selectedPosts, platforms) {
  if (!selectedPosts || selectedPosts.length === 0) return generatedPosts;

  const isLinkedIn = (platforms || "").toLowerCase().includes("linkedin");
  const hasAnySource = selectedPosts.some(
    p => p.referenceLink || p.contentOrigin || p.inspirationSource || p.inspiration
  );
  if (!hasAnySource) return generatedPosts;

  // For LinkedIn, collect sources that have a referenceLink, deduplicated by
  // URL — so the round-robin cycles through distinct article URLs before
  // wrapping. Entries without a referenceLink are excluded from the pool;
  // if no source has one, the pool falls back to all selectedPosts.
  const linkedInPool = isLinkedIn
    ? (() => {
        const seen = new Set();
        return selectedPosts.filter(p => {
          const ref = (p.referenceLink || "").trim();
          if (!ref) return false;
          if (seen.has(ref)) return false;
          seen.add(ref);
          return true;
        });
      })()
    : [];

  return generatedPosts.map((post, idx) => {
    // ── Non-LinkedIn — 1:1 mapping with relevance check ──────────────────────
    if (!isLinkedIn) {
      if (idx >= selectedPosts.length) return post;
      const src = selectedPosts[idx];
      const refRelevant = isReferenceRelevant(post, src);
      const refLink = refRelevant ? (src.referenceLink || "") : "";
      if (src.referenceLink && !refRelevant) {
        console.log("[CalendarGenerate] skipped unrelated reference", {
          postTitle: (post.hookTitle || "").slice(0, 60),
          referenceLink: src.referenceLink,
          sourceTitleOrSummary: (src.inspirationSource || src.inspiration || "").slice(0, 60),
        });
      }
      return {
        ...post,
        referenceLink: refLink,
        contentOrigin: refLink ? (src.contentOrigin || "original") : "original",
        inspiration: src.inspiration || src.inspirationSource || post.inspiration || "",
      };
    }

    // ── LinkedIn — cycle through the deduplicated pool with relevance check ───
    const pool = linkedInPool.length > 0 ? linkedInPool : selectedPosts;
    const srcIdx = idx % pool.length;
    const src = pool[srcIdx];

    // Preserve any referenceLink the AI already assigned on this post; only
    // fall back to the cycled source when the post has none AND the source is
    // relevant to the post topic.
    const existingRef = (post.referenceLink || "").trim();
    const fallbackRef = (src?.referenceLink || "").trim();
    const refRelevant = fallbackRef && isReferenceRelevant(post, src);
    const finalRef = existingRef || (refRelevant ? fallbackRef : "");

    if (fallbackRef && !refRelevant) {
      console.log("[CalendarGenerate] skipped unrelated reference", {
        postTitle: (post.hookTitle || "").slice(0, 60),
        referenceLink: fallbackRef,
        sourceTitleOrSummary: (src?.inspirationSource || src?.inspiration || "").slice(0, 60),
      });
    }

    return {
      ...post,
      referenceLink: finalRef,
      contentOrigin: finalRef
        ? (src?.contentOrigin || "reference")
        : (src?.contentOrigin || "original"),
      inspiration: post.inspiration || src?.inspiration || src?.inspirationSource || "",
    };
  });
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request) {
  console.log("[ContentCalendar] POST /api/content-calendar/generate");

  // ── 1. Authenticate ────────────────────────────────────────────────────────
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    // ── 2. Parse request body ────────────────────────────────────────────────
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

    const { brandId, attachmentIds, selectedPosts = [], calendarPeriodStart, calendarPeriodEnd, chosenSeasonalDates = [], ...formFields } = body;

    if (!brandId) {
      return NextResponse.json(
        { success: false, error: "brandId is required." },
        { status: 400 }
      );
    }

    // ── 3. Authorize brand access ────────────────────────────────────────────
    const access = await getBrandCalendarAccess(brandId);
    if (!access.allowed) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }

    // ── 3b. Resolve attachment context (creation mode) ───────────────────────
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

    // ── 4. Load brand + identity ─────────────────────────────────────────────
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

    const contentLanguage = normalizeLanguageCode(brand.contentLanguage);

    // ── 3. Derive safe post count ────────────────────────────────────────────
    // Source of truth: Calendar Setup numberOfPostsNeeded from the user.
    // Selected post ideas are inspiration inputs, not a hard cap.
    const rawCount = parseInt(String(formFields.numberOfPostsNeeded ?? ""), 10);
    let safeCount;
    let countSource;

    if (!isNaN(rawCount) && rawCount >= 1) {
      safeCount = Math.min(rawCount, 60);
      countSource = "formFields.numberOfPostsNeeded";
    } else if (selectedPosts.length > 0) {
      // Fallback: use selectedPosts count only when numberOfPostsNeeded is
      // missing or invalid — this protects against stale/default values
      // without letting selectedPosts.length override the user's request.
      safeCount = Math.min(selectedPosts.length, 60);
      countSource = "fallback-selectedPosts";
    } else {
      safeCount = 12;
      countSource = "fallback-default-12";
    }

    console.log("[CalendarGenerate] count resolution", {
      platform: formFields.platforms,
      requestedCount: formFields.numberOfPostsNeeded,
      selectedPostsCount: selectedPosts.length,
      safeCount,
      countSource,
    });

    // ── 4. Build context strings ─────────────────────────────────────────────
    const identitySummary = buildIdentitySummary(identity, brand);

    const selectedPostIdeasText = selectedPosts.length > 0
      ? selectedPosts.map((p, i) =>
          `${i + 1}. Hook: "${p.suggestedHook ?? ""}"` +
          (p.mainAngleAndCoreMessage ? ` | Core: "${p.mainAngleAndCoreMessage}"` : "") +
          (p.platform ? ` | Platform: ${p.platform}` : "") +
          (p.format ? ` | Format: ${p.format}` : "") +
          (p.inspirationSource ? ` | Source: "${p.inspirationSource}"` : (p.inspiration ? ` | Source: "${p.inspiration}"` : ""))
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
      targetAudience:         formFields.targetAudience         ?? "",
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

    // ── 6. Build userInput block (parameterized function) ───────────────────
    const row = (label, value) => value ? `${label}: ${value}` : null;

    function buildUserInput({ count, batchContext, acceptedSummaries }) {
      return [
        "IMPORTANT: Use the campaign details below as the primary source.",
        "Proceed directly to generating the calendar. Do not report conflicts.",
        "",
        ...(batchContext
          ? [
              `=== BATCH CONTEXT ===`,
              `This is batch ${batchContext.current} of ${batchContext.total}.`,
              `Total requested: ${safeCount} posts across ${formFields.platforms}.`,
              `This batch: generate ${count} posts.`,
              batchContext.formats
                ? `Formats for this batch: ${batchContext.formats}.`
                : null,
              acceptedSummaries && acceptedSummaries.length > 0
                ? `Already generated (DO NOT duplicate these hooks/titles): ${acceptedSummaries.slice(0, 6).map(s => `"${s}"`).join(", ")}`
                : null,
              "",
            ].filter(Boolean)
          : []),
        "=== BRAND INFORMATION ===",
        row("Brand Name",        brand.name),
        row("Business Type",     brand.businessType),
        row("Location",          brand.businessLocation),
        row("Website",           brand.website),
        row("Instagram",         brand.instagramPage),
        row("Brand Tone",        brand.brandTone),
        row("Target Audience",   brand.targetAudience),
        row("Campaign Target Audience", formFields.targetAudience),
        row("Services/Products", brand.mainServicesOrProducts),
        row("Visual Style",      brand.brandVisualStyle),
        "",
        "When Campaign Target Audience is provided, use it as the primary audience for THIS calendar and adapt tone, hooks, captions, CTAs, image text, and content angles specifically to that group. Do not confuse it with the brand's general audience listed above.",
        "",
        "=== BRAND IDENTITY ===",
        identitySummary || "Not extracted yet.",
        "",
        "=== SELECTED POST IDEAS (INSPIRATION ONLY — NOT A HARD CAP) ===",
        `You must generate exactly ${count} posts in this batch. The overall calendar needs ${safeCount} posts. Selected ideas below are inspiration inputs only — they do not limit the final count.`,
        selectedPosts.length < safeCount
          ? `If fewer ideas than needed (${selectedPosts.length} selected, ${safeCount} required), expand their themes into additional distinct posts to reach ${safeCount}. Do not duplicate posts.`
          : `If more ideas than needed (${selectedPosts.length} selected, ${safeCount} required), use only the most relevant ones.`,
        "",
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
        ...(attachmentContext.block
          ? [
              "",
              "=== INTERPRETED UPLOADED REFERENCE MATERIAL ===",
              attachmentContext.block,
              "",
            ]
          : []),
        "=== POSTING SCHEDULE ===",
        row("Platforms",                   formFields.platforms),
        row("Number of Posts (this batch)", String(count)),
        row("Total Calendar Posts",        String(safeCount)),
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
        "=== LANGUAGE INSTRUCTION ===",
        buildLanguageInstruction(contentLanguage),
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
      "2. Every item/slide has a `fields` object using ONLY these 12 keys (omit any that don't apply): main_headline, subheadline, supporting_text, sub_supporting_text_1, sub_supporting_text_2, call_to_action, badge_or_label, offer_or_promotion, date_or_time, website_or_contact, logo_text, additional_text_notes.",
      "3. For Carousel, the number of generated slides MUST exactly match the Content Structure slide count — never fewer, never more, never skipped (a 6-slide structure needs Slide 1 through Slide 6 — not just Slide 1 and Slide 4).",
      "4. Slide numbers must be sequential starting at 1 (slideNumber: 1, 2, 3 ... N) with no gaps and no duplicates.",
      "5. Slide 1's main_headline is drawn from hookTitle — but sharpen or rephrase it into the strongest on-image claim rather than copying it verbatim. If hookTitle is a question, convert it to a specific answer or benefit. If it is generic, pull a concrete detail from contentStructure or the caption.",
      "6. Each middle slide must reflect its OWN topic from its OWN Content Structure entry — specific, not interchangeable with other slides. Every middle slide MUST include both main_headline AND at least one of supporting_text or subheadline — never return main_headline alone. The supporting_text or subheadline must surface a specific detail, benefit, step, stat, or concrete claim from that slide's Content Structure entry, not a vague restatement.",
      "7. The final slide should usually carry the call_to_action, pulled from the caption's actual CTA — never invented.",
      "8. Do not repeat the same headline (or near-identical phrasing) across multiple slides or items.",
      "9. Do not use the full caption as slide text — on-image text is substantive and stands on its own; the caption is a separate field entirely.",
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
      "9. Keep on-image text design-ready and substantive: main_headline should make a complete, specific claim; subheadline / supporting_text must add concrete value beyond the headline — use the space to be useful rather than artificially brief.",
      "",
      "=== FORBIDDEN PATTERNS IN IMAGE TEXT (CRITICAL) ===",
      "Every field value in outputImageTextRequirementsStructured must be FINAL VISIBLE COPY — the exact text a viewer reads on the image, not a description of what the image is about.",
      "Forbidden in all fields:",
      "- Meta-descriptive phrases: 'Emphasis on...', 'Highlight...', 'Focus on...', 'Overview of...', 'A look at...', 'Discussion about...', 'Explore the concept of...'",
      "- Instruction-style text: 'Provide useful tips on...', 'Explain how to...', 'Describe the benefits of...', 'Share examples of...'",
      "- Section labels used as visible content: 'Call to Action', 'Value Proposition', 'Key Benefit', 'Main Point' — unless that exact text is genuinely the intended on-image copy",
      "",
      "Every field must read as if it is printed on the image:",
      "- main_headline: a complete, specific claim, promise, question, or CTA — not a topic label",
      "- subheadline / supporting_text: a concrete detail, step, statistic, benefit, or proof point — not a vague restatement of the headline",
      "- sub_supporting_text_1 / sub_supporting_text_2: additional depth when a slide needs more explanation — add a why, a proof point, a practical detail, or audience-specific context. Never repeat the headline or supporting_text. Never generic filler. Never designer instructions.",
      "- call_to_action: an actual next step for the viewer — not the generic label 'Call to Action'",
      "- badge_or_label: a real category name or callout — not the raw Main Angle value",
      "",
      "=== SUB-SUPPORTING TEXT DEPTH RULES ===",
      "sub_supporting_text_1 and sub_supporting_text_2 are OPTIONAL deeper copy fields for slides that need more explanation, proof, or context beyond the headline and supporting_text.",
      "",
      "WHEN TO USE THEM (carousel posts):",
      "- Educational, technical, service, B2B, trust-building, myth/truth, mistake/fix, checklist, diagnostic, and comparison slides should USUALLY include at least sub_supporting_text_1.",
      "- For a 5-slide carousel on an educational, technical, or service-based topic, at least 2\u20133 slides should include sub_supporting_text_1.",
      "- Use sub_supporting_text_2 when a slide needs a second concrete detail, proof point, example, warning, or audience-specific clarification.",
      "",
      "Use them for:",
      "- explaining WHY the headline matters or why the viewer should care",
      "- adding a practical detail, example, or concrete step that supports supporting_text",
      "- adding a specific benefit, result, or proof point from the brand info or source material",
      "- making a complex or technical topic clearer with plain-language context",
      "- surfacing audience-specific relevance (e.g. 'For security teams managing multiple sites')",
      "",
      "Do NOT use them for:",
      "- repeating the headline or supporting_text in different words",
      "- generic claims that could apply to any slide ('Learn more', 'Contact us today', 'Find out how')",
      "- instructions to a designer ('Explain the benefit here', 'Add a stat about this')",
      "- long paragraphs \u2014 keep each sub-supporting line short enough to fit on a slide",
      "- filling them in on every slide \u2014 simple hook slides and short CTA slides should omit them",
      "",
      "CAROUSEL DEPTH EXAMPLES (strongly prefer this richer style for non-trivial slides):",
      "",
      "Slide 2 (educational/technical \u2014 GOOD use of both sub-supporting fields):",
      "  main_headline: 'Why Cheap CCTV Misses Key Details'",
      "  supporting_text: 'Low-quality cameras often fail when lighting changes.'",
      "  sub_supporting_text_1: 'Poor night vision can hide faces and number plates.'",
      "  sub_supporting_text_2: 'Weak placement can leave blind spots near entrances.'",
      "",
      "Slide 3 (service/trust-building \u2014 GOOD use of sub_supporting_text_1):",
      "  main_headline: 'Professional Setup Covers the Risk Zones'",
      "  supporting_text: 'A proper survey maps entrances, tills, stock rooms, and blind spots.'",
      "  sub_supporting_text_1: 'Camera angle matters as much as camera quality.'",
      "",
      "Simple slide (hook \u2014 correctly omits sub-supporting fields):",
      "  main_headline: '6 Things Your Business Needs Before World Cup Season'",
      "  badge_or_label: 'Checklist'",
      "",
      "Simple slide (CTA \u2014 correctly omits sub-supporting fields):",
      "  main_headline: 'Ready for World Cup Season?'",
      "  call_to_action: 'Book a free consultation today'",
      "  badge_or_label: 'Limited Spots'",
      "",
      "BAD vs GOOD examples:",
      "",
      "BAD: main_headline: 'Emphasis on tailored safety solutions', supporting_text: 'Highlight the importance of professional installation'",
      "GOOD: main_headline: 'Safer Homes Start With Expert Installation', supporting_text: 'CCTV, alarms, and access control fitted by British Engineers.'",
      "",
      "BAD: main_headline: 'Call to Action', call_to_action: 'Encourage viewers to book a consultation'",
      "GOOD: main_headline: 'Book Your Security Consultation', call_to_action: 'Get expert support for CCTV, alarms, and access control.'",
      "",
      "=== FORMAT-SPECIFIC RULES ===",
      "STATIC: Return { type: 'static', items: [ { ...fields } ] } with exactly ONE item. main_headline is the strongest on-image hook (often derived from hookTitle, but rephrase if a more specific angle fits better); subheadline/supporting_text is a SPECIFIC detail, step, stat, or benefit that goes beyond Core Message — never a restatement of it; sub_supporting_text_1/sub_supporting_text_2 optionally add depth for complex topics; badge_or_label is a meaningful on-image label/callout relevant to THIS post — never the raw Main Angle value; call_to_action ONLY if the caption has a clear, specific CTA.",
      "CAROUSEL: Return { type: 'carousel', slides: [ { slideNumber, slideRole, fields } ] }. Parse the slide count from Content Structure, cross-check against Visual Direction, and generate exactly one slide entry per Content Structure slide, in order. `slideRole` is a short label for that slide's role in the flow (e.g. 'Hook', 'Problem', 'Tip 1', 'Proof', 'Offer', 'CTA'). Every middle slide (not Slide 1 or the final CTA slide) MUST include both main_headline AND at least one of supporting_text or subheadline — the supporting detail must pull the specific fact, step, benefit, or claim from that slide's own Content Structure entry. Educational, technical, service, and trust-building slides SHOULD also include sub_supporting_text_1 and sometimes sub_supporting_text_2 for richer on-image depth. The final output must be complete and sequential from Slide 1 to Slide N. Omit blank keys.",
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
      "=== CAPTION GENERATION RULES ===",
      "Captions must be substantive multi-paragraph content:",
      "  - At least 5 visible lines of substantive content per post",
      "  - Maximum 3 paragraphs, separated by natural blank line breaks",
      "  - Always include a clear call-to-action in the final paragraph",
      "  - Do not artificially shorten captions to a fixed character limit — let the content and depth dictate the length",
      "  - Use natural line breaks between paragraphs to improve readability",
      "  - Write for the platform's audience: LinkedIn posts should be professional and value-rich; other platforms can match their respective tone",
      "",
      "CAPTION DEPTH BY POST TYPE:",
      "  - Educational posts (mainAngle: education): captions must be more detailed than regular posts. Use longer explanations, practical examples, steps, reasons, mini-frameworks, or key takeaways. Aim for at least 2 substantial paragraphs when the content supports it. Do not add filler — useful depth only.",
      "  - Static posts: Since a static post has only one visual, the caption must carry more explanation and context. Include a hook/opening, explanation/context, practical value or proof, and a CTA. Aim for at least 2 substantial paragraphs when the content supports it.",
      "  - Educational static posts: Receive the richest captions — usually 2-3 substantial paragraphs with explanation, practical value, and a clear next step.",
      "  - Other posts: Follow the base rules above (at least 5 visible lines, max 3 paragraphs, ending with CTA).",
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
      "=== STORYTELLING STRUCTURE REQUIREMENT (CRITICAL) ===",
      "Before creating carousel slides or reel narration/dialogues, select ONE storytelling structure that best fits the post goal, audience, and content type. The selected structure must guide the entire sequence. Do not mix multiple storytelling structures in one post. The output should feel like one connected story, not separate tips or scenes.",
      "",
      "Available storytelling structures:",
      "",
      "1. Problem → Agitation → Solution → CTA",
      "   Best for: lead generation, service posts, objection handling",
      "   Carousel: Slide 1 problem → Slide 2 why it matters → Slide 3 solution → Slide 4 benefit → Slide 5 CTA",
      "   Reel: Start with visible problem → create tension → reveal solution → end with action",
      "",
      "2. Hook → Context → Insight → Action",
      "   Best for: educational posts, expert positioning",
      "   Carousel: Hook → context → insight → practical advice → CTA",
      "   Reel: Question/bold statement → explanation → useful takeaway → CTA",
      "",
      "3. Before → After → Bridge",
      "   Best for: transformation, training, service value",
      "   Carousel: Before → pain/friction → bridge/process → after → CTA",
      "   Reel: Show old situation → improved situation → what creates the change",
      "",
      "4. Myth → Truth → Explanation → CTA",
      "   Best for: awareness, trust building, misconception correction",
      "",
      "5. Mistake → Consequence → Fix → Result",
      "   Best for: educational, warning, local service, B2B",
      "",
      "6. Question → Answer → Example → CTA",
      "   Best for: FAQ, simple educational content",
      "",
      "7. Checklist / Step-by-step",
      "   Best for: processes, tutorials, course/service breakdowns",
      "",
      "8. Objection → Reframe → Proof → Next Step",
      "   Best for: sales resistance, trust building",
      "",
      "9. Situation → Action → Outcome → Lesson",
      "   Best for: case studies, testimonials, proof content. Use only factual proof from source material.",
      "",
      "10. Old Way → New Way → Why It Works",
      "    Best for: innovation, AI, modern positioning",
      "",
      "11. Symptom → Root Cause → Fix",
      "    Best for: diagnostic/service explanation",
      "",
      "12. Story Character → Goal → Obstacle → Resolution",
      "    Best for: emotional storytelling, human-centered campaigns",
      "",
      "13. Reveal / Curiosity Gap",
      "    Best for: high-retention content",
      "",
      "14. Do This / Not That",
      "    Best for: practical comparisons",
      "",
      "15. Mini Framework",
      "    Best for: expert content, B2B, strategy",
      "",
      "For carousel image text:",
      "- Each slide must contain final visible copy only",
      "- The slide sequence must clearly follow the selected storytelling structure",
      "- Do not create disconnected educational points, repeated headlines, generic descriptions, or instructions for designers",
      "- Each slide should advance the story",
      "",
      "For reels:",
      "- Narration and dialogues must follow the chosen structure",
      "- Scene 1 must create attention and hook the viewer",
      "- Middle scenes must develop the story and build toward the conclusion",
      "- Final scene must provide resolution and clear next step or CTA",
      "- Dialogue must sound like spoken words, not production notes or camera directions",
      "- Do not write camera directions inside narration or dialogue fields",
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
      `Generate exactly ${count} posts in the "posts" array.`,
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
      '      "caption": "detailed caption — at least 5 lines, maximum 3 paragraphs, ending with CTA. Educational and static posts get richer, more explanatory captions (see CAPTION DEPTH BY POST TYPE above).",',
      '      "hashtags": ["#tag1", "#tag2", "#tag3"],',
      '      "contentStructure": "slide-by-slide or scene-by-scene breakdown",',
      '      "visualDirection": "Creative direction for the designer. Static posts: describe layout, colors, composition, branding, CTA placement. Carousel posts: write Overall carousel visual system: [...] then Slide 1: [...] Slide 2: [...] etc. Video/Reel posts: describe thumbnail look, key visual frames, cover frame direction.",',
      '      "outputImageTextRequirementsStructured": <object — FOLLOW THE OUTPUT IMAGE TEXT REQUIREMENTS GENERATION RULES AND FORMAT-SPECIFIC RULES ABOVE EXACTLY. Return a real nested JSON object (not a string): { "type": "static"|"video", "items": [ { "main_headline": "...", ... } ] } OR { "type": "carousel", "slides": [ { "slideNumber": 1, "slideRole": "Hook", "fields": { "main_headline": "sharpened hook", "badge_or_label": "label" } }, { "slideNumber": 2, "slideRole": "Tip 1", "fields": { "main_headline": "specific claim from this slide in contentStructure", "supporting_text": "concrete detail or benefit — REQUIRED for every middle slide" } }, ... one entry per Content Structure slide — every middle slide MUST have main_headline + supporting_text or subheadline ] }. Use ONLY the 12 allowed field keys. Omit blank keys entirely. Carousel slide count MUST equal the Content Structure slide count.>,',
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
      `- posts array must contain exactly ${count} complete objects.`,
      "- hashtags must always be a JSON array of strings starting with #.",
      "- outputImageTextRequirementsStructured must be a real nested JSON object/array (NOT a stringified JSON, NOT plain text) following the schema and rules given above.",
      "- postNumber starts at 1 and increments by 1.",
      "- Every field must be present. Use empty string \"\" for fields that do not apply.",
      "- Never return an error object. Always return the {\\\"posts\\\": [...]} structure shown above.",
      "- If any field is missing or not applicable, use an empty string and continue.",
      "- Return only the JSON object. Nothing before or after it.",
    ].filter(v => v !== null).join("\n");
    }

    // ── 7. Format distribution across batches ────────────────────────────────
    function parseFormats(raw) {
      if (!raw || !raw.trim()) return [];
      const parts = raw.split(",").map(s => s.trim()).filter(Boolean);
      return parts.reduce((acc, p) => {
        const m = p.match(/^(\d+)\s+(.+)/);
        if (m) {
          const n = parseInt(m[1], 10);
          for (let i = 0; i < n; i++) acc.push(m[2]);
        } else {
          acc.push(p);
        }
        return acc;
      }, []);
    }

    function distributeFormats(total, formatList) {
      if (formatList.length === 0) return [];
      const result = [];
      for (let i = 0; i < total; i++) {
        result.push(formatList[i % formatList.length]);
      }
      return result;
    }

    const parsedFormats = parseFormats(formFields.requiredPostFormats);
    const distributedFormats = distributeFormats(safeCount, parsedFormats);

    // ── 8. Batch loop ────────────────────────────────────────────────────────
    function extractPostsFromResult(result) {
      let parsed;
      if (result.content && typeof result.content === "object") {
        parsed = result.content;
      } else {
        parsed = parseAiJsonOutput(result.raw);
      }

      if (!parsed || typeof parsed !== "object") {
        const preview = String(result.raw ?? "").slice(0, 300).replace(/[\x00-\x1f]/g, " ");
        console.error(`[ContentCalendar] parsed fail. finish=${result.finishReason} preview=${preview}`);
        return [];
      }

      if (Array.isArray(parsed)) return parsed;

      const topLevel =
        parsed.posts ?? parsed.calendar ?? parsed.postIdeas ??
        parsed.calendarPosts ?? parsed.entries ?? parsed.content_calendar ??
        parsed.schedule ?? null;

      if (Array.isArray(topLevel) && topLevel.length > 0) return topLevel;

      const found = deepFindPostArrays(parsed);
      if (found.length > 0) {
        found.sort((a, b) => b.arr.length - a.arr.length);
        return found[0].arr;
      }
      return [];
    }

    async function runBatch({ batchCount, batchContext, acceptedSummaries }) {
      const batchInput = buildUserInput({ count: batchCount, batchContext, acceptedSummaries });
      console.log(`[ContentCalendar] Batch ${batchContext.current}/${batchContext.total}: ${batchCount} posts, input ${batchInput.length} chars`);

      const result = await generateWithPromptTemplate({
        templateSlug: "content-calendar-generator",
        variables,
        userInput: batchInput,
        maxTokens: 8192,
      });

      console.log(`[ContentCalendar] Batch ${batchContext.current} raw: ${result.raw?.length ?? 0} chars, finish=${result.finishReason}`);

      const rawPosts = extractPostsFromResult(result);
      const normalized = rawPosts.map((p, i) => normalisePost(p, i, formFields.platforms));
      return normalized;
    }

    // Build batch plan
    const totalBatches = Math.ceil(safeCount / BATCH_SIZE);
    const allPosts = [];
    let totalAttempts = 0;
    const MAX_TOTAL_ATTEMPTS = totalBatches * (1 + MAX_RETRIES_PER_BATCH) + 2;

    for (let b = 0; b < totalBatches; b++) {
      const batchStart = b * BATCH_SIZE;
      let batchCount = Math.min(BATCH_SIZE, safeCount - batchStart);
      if (batchCount <= 0) break;

      const batchFormats = distributedFormats.slice(batchStart, batchStart + batchCount);
      const formatsStr = batchFormats.length > 0 ? batchFormats.join(", ") : undefined;

      const batchContext = {
        current: b + 1,
        total: totalBatches,
        formats: formatsStr,
      };

      const acceptedSummaries = allPosts.map(p => p.hookTitle || p.coreMessage || "").filter(Boolean);

      let batchPosts = [];
      let retries = 0;

      while (batchPosts.length < batchCount && totalAttempts < MAX_TOTAL_ATTEMPTS) {
        totalAttempts++;
        try {
          const posts = await runBatch({
            batchCount,
            batchContext,
            acceptedSummaries: retries > 0 ? acceptedSummaries : undefined,
          });
          batchPosts = batchPosts.concat(posts);
          const seen = new Set();
          batchPosts = batchPosts.filter(p => {
            const hook = (p.hookTitle || p.coreMessage || "").toLowerCase().trim();
            const angle = (p.mainAngle || p.coreMessage || "").toLowerCase().trim();
            const fmt = (p.format || "").toLowerCase().trim();
            const key = `${hook}||${angle}||${fmt}`;
            if (!hook || seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          batchPosts = batchPosts.slice(0, batchCount);
          // Apply batch-assigned formats so each post matches the planned distribution
          if (batchFormats.length > 0) {
            batchPosts = batchPosts.map((p, i) => ({
              ...p,
              format: batchFormats[i] || p.format,
            }));
          }
        } catch (err) {
          console.error(`[ContentCalendar] Batch ${b + 1} attempt ${retries + 1} failed:`, err.message);
        }

        if (batchPosts.length >= batchCount) break;
        retries++;
        if (retries > MAX_RETRIES_PER_BATCH) break;
        console.log(`[ContentCalendar] Batch ${b + 1} retry ${retries}/${MAX_RETRIES_PER_BATCH}: got ${batchPosts.length}/${batchCount}`);
      }

      allPosts.push(...batchPosts);
    }

    console.log(`[ContentCalendar] Total after batching: ${allPosts.length}/${safeCount}`);

    // ── 9. Deduplicate across all batches ──────────────────────────────────────
    function deduplicatePosts(posts) {
      const seen = new Set();
      return posts.filter(p => {
        const hook = (p.hookTitle || p.coreMessage || p.caption?.slice(0, 60) || "").toLowerCase().trim();
        const angle = (p.mainAngle || p.coreMessage || "").toLowerCase().trim();
        const fmt = (p.format || "").toLowerCase().trim();
        const key = `${hook}||${angle}||${fmt}`;
        if (!hook) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    let allUnique = deduplicatePosts(allPosts);

    // ── 9b. Supplemental phase — targeted format-aware collection ───────────
    // After batching and dedup, if we are still short, make focused supplemental
    // requests. Each supplemental request:
    //   - knows the current accepted-pool state
    //   - requests (remaining + buffer) candidates to hedge against duplicates
    //   - tracks format deficits so underrepresented formats are prioritised
    //   - preserves the authoritative language instruction
    //   - preserves attachment context
    //   - stays within the bounded attempt budget

    function computeFormatDeficits(currentPosts, distributedFormats, totalNeeded) {
      const formatCount = {};
      for (const p of currentPosts) {
        const f = (p.format || "").trim();
        if (f) formatCount[f] = (formatCount[f] || 0) + 1;
      }
      const expected = {};
      for (const f of distributedFormats.slice(0, totalNeeded)) {
        expected[f] = (expected[f] || 0) + 1;
      }
      const deficits = [];
      for (const [fmt, need] of Object.entries(expected)) {
        const have = formatCount[fmt] || 0;
        if (have < need) deficits.push(`${fmt}: need ${need - have} more of ${need} total`);
      }
      return deficits;
    }

    function buildSupplementalPromptContent({
      count,
      acceptedPosts,
      formatDeficits,
      languageInstruction,
      attachmentBlock,
      brandName,
    }) {
      const lines = [
        "=== SUPPLEMENTAL GENERATION ===",
        `The calendar currently has ${acceptedPosts.length} accepted posts but needs more.`,
        `Generate exactly ${count} ADDITIONAL posts that are DIFFERENT from the accepted list below.`,
        "",
        "=== ACCEPTED POSTS (do NOT duplicate) ===",
        ...acceptedPosts.map((p, i) =>
          `${i + 1}. Date: ${p.date || "unset"} | Format: ${p.format || ""} | ` +
          `Hook: "${(p.hookTitle || p.coreMessage || "").slice(0, 80)}"`
        ),
      ];

      if (formatDeficits.length > 0) {
        lines.push(
          "",
          "=== FORMAT DEFICITS ===",
          "Prioritise the following formats:",
          ...formatDeficits.map(d => `  - ${d}`),
        );
      }

      if (languageInstruction) {
        lines.push("", languageInstruction);
      }

      if (attachmentBlock) {
        lines.push("", attachmentBlock);
      }

      lines.push(
        "",
        "Each post must use the standard schema and be valid for the same brand and campaign.",
        "Return ONLY valid JSON with a 'posts' array.",
      );

      return lines.join("\n");
    }

    let finalBatch = allUnique.slice(0, safeCount);

    for (let s = 0; s < MAX_SUPPLEMENTAL_ATTEMPTS && finalBatch.length < safeCount && totalAttempts < MAX_TOTAL_ATTEMPTS; s++) {
      const remaining = safeCount - finalBatch.length;
      const requestCount = Math.min(remaining + SUPPLEMENTAL_BUFFER, 5);
      const deficits = computeFormatDeficits(finalBatch, distributedFormats, safeCount);

      console.log(`[ContentCalendar] Supplemental ${s + 1}/${MAX_SUPPLEMENTAL_ATTEMPTS}: have ${finalBatch.length}/${safeCount}, requesting ${requestCount}, deficits:`, deficits);

      totalAttempts++;

      try {
        const supInput = buildSupplementalPromptContent({
          count: requestCount,
          acceptedPosts: finalBatch,
          formatDeficits: deficits,
          languageInstruction: buildLanguageInstruction(contentLanguage),
          attachmentBlock: attachmentContext.block,
          brandName: brand.name,
        });

        const supResult = await generateWithPromptTemplate({
          templateSlug: "content-calendar-generator",
          variables,
          userInput: supInput,
          maxTokens: 8192,
        });

        console.log(`[ContentCalendar] Supplemental ${s + 1} raw chars=${supResult.raw?.length ?? 0} finish=${supResult.finishReason}`);

        const rawPosts = extractPostsFromResult(supResult);
        const normalized = rawPosts.map((p, i) => normalisePost(p, i, formFields.platforms));

        console.log(`[ContentCalendar] Supplemental ${s + 1}: parsed ${normalized.length} raw candidates`);

        const merged = deduplicatePosts([...finalBatch, ...normalized]).slice(0, safeCount);
        if (merged.length > finalBatch.length) {
          console.log(`[ContentCalendar] Supplemental ${s + 1}: gained ${merged.length - finalBatch.length} new unique posts (total ${merged.length}/${safeCount})`);
        } else {
          console.log(`[ContentCalendar] Supplemental ${s + 1}: no new unique posts gained`);
        }
        finalBatch = merged;
      } catch (err) {
        console.error(`[ContentCalendar] Supplemental ${s + 1} failed:`, err.message);
      }

      if (finalBatch.length >= safeCount) break;
    }

    console.log(`[ContentCalendar] Total after supplemental: ${finalBatch.length}/${safeCount}`);

    if (finalBatch.length < safeCount) {
      console.error(`[ContentCalendar] shortfall: ${finalBatch.length}/${safeCount} after ${totalAttempts} total attempts`);
      return NextResponse.json(
        {
          success: false,
          code: "CALENDAR_POST_COUNT_INCOMPLETE",
          error: `The calendar generator created ${finalBatch.length} of ${safeCount} posts. Please retry, or reduce the number of posts if the issue continues.`,
          generatedCount: finalBatch.length,
          requestedCount: safeCount,
        },
        { status: 422 }
      );
    }

    // ── 10. Assign final numbering and dates centrally ───────────────────────
    const numbered = finalBatch.map((p, i) => ({ ...p, postNumber: i + 1 }));

    const datedPosts = applyFallbackDates(numbered, {
      calendarPeriodStart,
      calendarPeriodEnd,
      publishingFrequency: formFields.publishingFrequency,
      seasonalDates: chosenSeasonalDates,
    });

    datedPosts.sort((a, b) => {
      if (a.date && b.date) return a.date.localeCompare(b.date);
      if (a.date) return -1;
      if (b.date) return 1;
      return a.postNumber - b.postNumber;
    });
    const sorted = datedPosts.map((p, i) => ({ ...p, postNumber: i + 1 }));

    // ── 11. Validate outputImageTextRequirements ─────────────────────────────
    const posts = sorted.map(p => {
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

    // ── 12. Merge source fields from selectedPosts ──────────────────────────
    const finalPosts = mergeSourceFields(posts, selectedPosts, formFields.platforms);

    // ── 13. Return ───────────────────────────────────────────────────────────
    return NextResponse.json({
      success: true,
      posts: finalPosts,
      tables: null,
    });

  } catch (err) {
    const code = err?.code;
    let status = 500;
    let error;
    let respCode;

    if (code === "AI_CONNECTION_ERROR") {
      status = 503;
      error = "Couldn't reach the AI service. Please check your connection and try again — your inputs are fine.";
    } else if (code === "AI_NOT_CONFIGURED") {
      status = 503;
      error = "OpenAI API key is not configured. Go to Settings and add your OpenAI API key, then restart the server.";
    } else if (code === "AI_TIMEOUT") {
      status = 504;
      error = "The AI provider did not respond in time. Please try again.";
    } else if (err.message?.includes("Could not parse") || err.message?.includes("JSON")) {
      status = 422;
      respCode = "CALENDAR_OUTPUT_INVALID";
      error = "The AI returned an unexpected response. Please retry the generation.";
    } else if (err.message?.includes("placeholder") || err.message?.includes("OPENAI_API_KEY")) {
      status = 503;
      error = "OpenAI API key is not configured. Go to Settings and add your OpenAI API key, then restart the server.";
    } else if (err.name === "AbortError") {
      status = 504;
      respCode = "AI_TIMEOUT";
      error = "The request timed out. Please try again.";
    } else {
      error = "Content calendar generation failed. Please try again.";
    }

    console.error(`[ContentCalendar] ${respCode || "INTERNAL_ERROR"} status=${status}:`, err.message || err);

    return NextResponse.json(
      {
        success: false,
        ...(respCode ? { code: respCode } : {}),
        error,
        ...(status < 500 ? { generatedCount: 0, requestedCount: safeCount } : {}),
      },
      { status }
    );
  }
}
