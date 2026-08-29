import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, getBrandCalendarAccess } from "@/lib/auth";
import { generateWithPromptTemplate } from "@/lib/ai";
import {
  validateOutputImageTextRequirements,
  buildFallbackOutputImageTextRequirements,
  normalizeOutputImageTextRequirementsStructured,
  formatOutputImageTextRequirementsForDisplay,
  createCompactToneInformationSummary,
  CAPTION_GENERATION_RULES_LINES,
  mergeHashtagsIntoCaption,
} from "@/lib/calendar-post-utils";
import { normalizeBrandIdentityOutput, createCompactBrandVisualIdentitySummaryForImagePrompt } from "@/lib/brand-identity-utils";
import { resolveCalendarAttachmentContext } from "@/lib/calendar-attachment-context";
import { buildCalendarGenerationUserInput } from "@/lib/calendar-generation-user-input";
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

  const rawCaption = (() => {
    const c = get("caption", "suggestedCaption", "suggested_caption", "captionText", "copy", "text");
    const cta = get("cta", "CTA", "callToAction", "call_to_action");
    if (c && cta && !c.includes(cta)) return `${c}\n\n${cta}`;
    return c || cta;
  })();

  // Single source of truth for hashtags is the caption's final line — the AI
  // returns a structured hashtags array (reliable count control), and we
  // deterministically merge it into the caption here rather than trusting the
  // AI to embed exactly 5 hashtags inline (see lib/calendar-post-utils.js).
  const { caption, hashtags: mergedHashtags } = mergeHashtagsIntoCaption(rawCaption, hashtags);

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
    hashtags: mergedHashtags,
    hashtagsMergedIntoCaption: mergedHashtags.length > 0,

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
    // Assembly lives in lib/calendar-generation-user-input.js so the final
    // provider input can be asserted against directly in tests.
    function buildUserInput({ count, batchContext, acceptedSummaries }) {
      return buildCalendarGenerationUserInput({
        count,
        batchContext,
        acceptedSummaries,
        safeCount,
        formFields,
        brand,
        identitySummary,
        selectedPosts,
        selectedPostIdeasText,
        attachmentBlock: attachmentContext.block,
        contentLanguage,
      });
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
