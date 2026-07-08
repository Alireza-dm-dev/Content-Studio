import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateWithPromptTemplate } from "@/lib/ai";
import { normalizeBrandIdentityOutput, createCompactBrandVisualIdentitySummaryForImagePrompt } from "@/lib/brand-identity-utils";
import {
  fetchAndExtractResource,
  classifyResourceType,
  extractCandidateArticleLinks,
} from "@/lib/url-resource-utils";

const ALLOWED_FORMATS = ["Static", "Carousel"];
const MAX_ARTICLES_TO_FETCH = 10;
const MAX_NUMBER_OF_POSTS = 50;
const ARTICLE_TEXT_CHARS_IN_PROMPT = 4000;

const str = (v) => (typeof v === "string" ? v : Array.isArray(v) ? v.join(" ") : "");

const toHashtagArray = (v) => {
  if (Array.isArray(v)) return v.map(String).map(s => s.trim()).filter(Boolean);
  if (typeof v === "string") return v.split(/[\s,]+/).filter(Boolean);
  return [];
};

function errorResponse(status, error, details) {
  return NextResponse.json(
    { success: false, error, ...(details ? { details } : {}) },
    { status }
  );
}

// Maps a thrown url-resource-utils error message to an HTTP status — mirrors
// the classification used in the resolve-resource route.
function classifyFetchError(err) {
  const message = err instanceof Error ? err.message : String(err);
  if (/timed out/i.test(message)) {
    return { status: 504, error: "The resource URL took too long to respond.", details: message };
  }
  if (/could not fetch/i.test(message)) {
    return { status: 502, error: "Could not reach that URL.", details: message };
  }
  if (/failed with status/i.test(message)) {
    return { status: 502, error: "The resource URL returned an error.", details: message };
  }
  if (/unsupported content type/i.test(message)) {
    return { status: 422, error: "That URL doesn't point to an HTML page.", details: message };
  }
  return { status: 400, error: "That URL could not be used as a resource.", details: message };
}

/**
 * Compact brand summary for grounding the LinkedIn prompt — mirrors what
 * StepSuggestorForm already shows the user (editableSummary, else a compact
 * visual-identity summary), kept intentionally lighter than the full
 * tone-information dump used by the Instagram suggest-posts route.
 */
function buildIdentitySummary(identity, brand) {
  const base = [
    brand.name && `Brand: ${brand.name}`,
    brand.businessType && `Type: ${brand.businessType}`,
    brand.brandTone && `Tone: ${brand.brandTone}`,
    brand.targetAudience && `Audience: ${brand.targetAudience}`,
    brand.mainServicesOrProducts && `Services: ${brand.mainServicesOrProducts}`,
  ].filter(Boolean).join(". ");

  if (!identity) return base;

  const { brandVisualIdentity } = normalizeBrandIdentityOutput(identity);
  const preview = identity.editableSummary?.trim()
    || createCompactBrandVisualIdentitySummaryForImagePrompt(brandVisualIdentity);

  return [base, preview].filter(Boolean).join("\n");
}

function normalizeLinkedInFormat(raw) {
  const v = str(raw).trim().toLowerCase();
  if (v.startsWith("carousel")) return "Carousel";
  return "Static"; // safe default for Static, empty, or any disallowed format (Reel/Story/Video/etc.)
}

// Normalizes one AI-returned idea into a calendar-post-shaped object, forcing
// every field that must never vary from AI output: platform, format,
// contentOrigin, and referenceLink (resolved from our own fetched article
// list — never trusted verbatim from the model).
function normaliseLinkedInPost(p, idx, articles) {
  const rawIndex = Number(p?.articleIndex);
  const articleIndex = Number.isInteger(rawIndex) && articles[rawIndex] ? rawIndex : 0;
  const article = articles[articleIndex] ?? articles[0];

  return {
    postNumber: p?.postNumber ?? idx + 1,
    platform: "LinkedIn",
    format: normalizeLinkedInFormat(p?.format ?? p?.contentType),
    suggestedHook: str(p?.suggestedHook ?? p?.hook ?? p?.headline ?? p?.title ?? ""),
    mainAngleAndCoreMessage: str(p?.mainAngleAndCoreMessage ?? p?.coreMessage ?? p?.mainAngle ?? p?.angle ?? ""),
    suggestedCaption: str(p?.suggestedCaption ?? p?.caption ?? p?.text ?? ""),
    visualDirection: str(p?.visualDirection ?? p?.visual ?? ""),
    contentStructure: str(p?.contentStructure ?? p?.structure ?? ""),
    hashtags: toHashtagArray(p?.hashtags ?? p?.tags),
    inspirationSource: str(p?.inspirationSource ?? p?.inspiration ?? "") || article.title,
    contentOrigin: "reference",
    referenceLink: article.url,
  };
}

export async function POST(request) {
  console.log("[LinkedInSuggestPosts] POST /api/content-calendar/linkedin/suggest-posts");

  // ── 1. Parse + validate body ────────────────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse(400, "Invalid request body.", e.message);
  }

  const { brandId, resourceUrl, numberOfPosts } = body || {};

  if (!brandId || typeof brandId !== "string") {
    return errorResponse(400, "brandId is required.");
  }
  if (!resourceUrl || typeof resourceUrl !== "string") {
    return errorResponse(400, "resourceUrl is required.");
  }

  const safeCount = parseInt(String(numberOfPosts), 10);
  if (!Number.isInteger(safeCount) || safeCount < 1) {
    return errorResponse(400, "numberOfPosts must be a positive integer.");
  }
  if (safeCount > MAX_NUMBER_OF_POSTS) {
    return errorResponse(400, `numberOfPosts must be ${MAX_NUMBER_OF_POSTS} or fewer.`);
  }

  // ── 2. Load brand + latest identity ─────────────────────────────────────────
  const [brand, identity] = await Promise.all([
    prisma.brand.findUnique({ where: { id: brandId } }),
    prisma.brandIdentity.findFirst({ where: { brandId }, orderBy: { createdAt: "desc" } }),
  ]);

  if (!brand) {
    return errorResponse(404, "Brand not found.");
  }

  // ── 3. Resolve the resource ──────────────────────────────────────────────────
  let extracted;
  try {
    extracted = await fetchAndExtractResource(resourceUrl);
  } catch (err) {
    console.error("[LinkedInSuggestPosts] Resource fetch error:", err.message);
    const { status, error, details } = classifyFetchError(err);
    return errorResponse(status, error, details);
  }

  const resourceType = classifyResourceType(resourceUrl, extracted);

  // ── 4. Build the grounded article list ───────────────────────────────────────
  let articles;
  if (resourceType === "article") {
    // Already have the full text from the resolve fetch above — no need to
    // fetch it again.
    articles = [{
      url: extracted.finalUrl || resourceUrl,
      title: extracted.title || extracted.finalUrl || resourceUrl,
      text: extracted.bodyText,
    }];
  } else {
    const candidates = extractCandidateArticleLinks(resourceUrl, extracted);
    if (!candidates.length) {
      return errorResponse(
        422,
        "No article links could be found on that page. Try pasting a specific article URL instead."
      );
    }

    // Candidates already come back ranked (article-path strength, slug
    // quality) and in page order, so taking the top slice covers "near top
    // of page" + "stronger titles" heuristics without a second AI call.
    const selected = candidates.slice(0, Math.min(MAX_ARTICLES_TO_FETCH, candidates.length));

    const fetched = await Promise.allSettled(
      selected.map((c) => fetchAndExtractResource(c.url))
    );

    articles = fetched
      .map((result, i) => {
        if (result.status !== "fulfilled") {
          console.warn(`[LinkedInSuggestPosts] Failed to fetch candidate ${selected[i].url}:`, result.reason?.message);
          return null;
        }
        const art = result.value;
        return {
          url: art.finalUrl || selected[i].url,
          title: art.title || selected[i].title,
          text: art.bodyText,
        };
      })
      .filter(Boolean);

    if (!articles.length) {
      return errorResponse(502, "Could not fetch content from any candidate article on that page.");
    }
  }

  // ── 5. Build prompt + call AI (single call) ──────────────────────────────────
  const brandIdentitySummary = buildIdentitySummary(identity, brand);

  const articlesBlock = articles
    .map((a, i) => [
      `=== ARTICLE ${i} ===`,
      `Title: ${a.title}`,
      `URL: ${a.url}`,
      `Content:`,
      (a.text || "").slice(0, ARTICLE_TEXT_CHARS_IN_PROMPT),
    ].join("\n"))
    .join("\n\n");

  const userInput = [
    "=== BRAND INFORMATION ===",
    brandIdentitySummary || "Not yet extracted.",
    "",
    `=== ARTICLES (${articles.length}) ===`,
    articlesBlock,
  ].join("\n");

  const variables = {
    brandName: brand.name,
    platform: "LinkedIn",
    numberOfPosts: String(safeCount),
    resourceType,
  };

  let suggestResult;
  try {
    suggestResult = await generateWithPromptTemplate({
      templateSlug: "linkedin-post-from-reference",
      variables,
      userInput,
      responseFormat: "json_object",
    });
  } catch (err) {
    console.error("[LinkedInSuggestPosts] AI error:", err.message);
    return errorResponse(500, "LinkedIn post idea generation failed. Please try again.", err.message);
  }

  // ── 6. Extract + normalize posts ─────────────────────────────────────────────
  let raw = [];
  const content = suggestResult.content;
  if (Array.isArray(content)) {
    raw = content;
  } else if (content && typeof content === "object") {
    const arrayValues = Object.values(content).filter((v) => Array.isArray(v));
    raw = content.posts ?? content.postIdeas ?? content.suggestions ?? arrayValues[0] ?? [];
  }
  if (!Array.isArray(raw)) raw = [];

  let suggestions = raw.map((p, i) => normaliseLinkedInPost(p, i, articles));
  if (suggestions.length > safeCount) suggestions = suggestions.slice(0, safeCount);

  if (!suggestions.length) {
    return errorResponse(422, "No post ideas were returned. Please try again or use a different resource.");
  }

  console.log(
    `[LinkedInSuggestPosts] resourceType=${resourceType} | articles=${articles.length} | posts=${suggestions.length}/${safeCount}`
  );

  return NextResponse.json({
    success: true,
    suggestions,
    posts: suggestions, // alias for compatibility with the existing review UI's `data.posts` shape
    resourceType,
    articlesUsed: articles.map((a) => ({ url: a.url, title: a.title })),
    requestedCount: safeCount,
    returnedCount: suggestions.length,
    usage: suggestResult.usage,
    model: suggestResult.model,
  });
}
