import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateWithPromptTemplate } from "@/lib/ai";
import { normalizeBrandIdentityOutput, createCompactBrandVisualIdentitySummaryForImagePrompt } from "@/lib/brand-identity-utils";
import {
  fetchAndExtractResource,
  classifyResourceType,
  extractCandidateArticleLinks,
} from "@/lib/url-resource-utils";
import { getCurrentUser, getBrandCalendarAccess } from "@/lib/auth";
import { resolveCalendarAttachmentContext } from "@/lib/calendar-attachment-context";
import { buildLanguageInstruction, normalizeLanguageCode } from "@/lib/content-language";

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
  if (/blocked|rate limited/i.test(message)) {
    return { status: 403, error: "The resource URL was blocked or rate limited.", details: message };
  }
  if (/could not fetch/i.test(message)) {
    return { status: 502, error: "Could not reach that URL.", details: message };
  }
  if (/failed with status/i.test(message)) {
    return { status: 502, error: "The resource URL returned an error.", details: message };
  }
  if (/too many redirects/i.test(message)) {
    return { status: 502, error: "The resource URL redirected too many times.", details: message };
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

// Checks whether a new post's hook is a near-duplicate of any already-accepted
// post — normalized lowercased alphanumeric comparison with containment checks
// to catch rephrased or shortened variants.
function isDuplicatePost(newPost, existingPosts) {
  const normalize = (s) => (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const newHook = normalize(newPost.suggestedHook);
  if (!newHook) return false;
  return existingPosts.some((ex) => {
    const exHook = normalize(ex.suggestedHook);
    return exHook && (exHook === newHook || exHook.includes(newHook) || newHook.includes(exHook));
  });
}

// Reassigns articleIndex / referenceLink / inspirationSource across a set
// of normalized posts so available articles are used distinctly before any
// single article is reused. Content of each post is preserved — only the
// source-mapping fields are overridden to match the assigned article.
// When articles.length <= 1 (single specific URL) the list is returned
// unchanged so multiple ideas from one article still work.
function distributeArticlesAcrossPosts(posts, articles) {
  if (articles.length <= 1) return posts;
  return posts.map((post, idx) => {
    const articleIndex = idx % articles.length;
    const article = articles[articleIndex];
    return {
      ...post,
      referenceLink: article.url,
      inspirationSource: post.inspirationSource || article.title,
      contentOrigin: "reference",
    };
  });
}

export async function POST(request) {
  console.log("[LinkedInSuggestPosts] POST /api/content-calendar/linkedin/suggest-posts");

  // ── 1. Authenticate ─────────────────────────────────────────────────────────
  const user = await getCurrentUser();
  if (!user) {
    return errorResponse(401, "Authentication required");
  }

  // ── 2. Parse + validate body ────────────────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse(400, "Invalid request body.", e.message);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse(400, "Invalid request body.");
  }

  const { brandId, resourceUrl, numberOfPosts, attachmentIds } = body;

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

  // ── 3. Brand access ─────────────────────────────────────────────────────────
  const access = await getBrandCalendarAccess(brandId);
  if (!access.allowed) {
    return errorResponse(403, "Brand access required");
  }

  // ── 4. Resolve attachment context ───────────────────────────────────────────
  const attachmentContext = await resolveCalendarAttachmentContext({
    attachmentIds: attachmentIds,
    brandId,
    mode: "creation",
  });

  if (!attachmentContext.ok) {
    return errorResponse(attachmentContext.status, attachmentContext.error);
  }

  // ── 5. Load brand + latest identity ─────────────────────────────────────────
  const [brand, identity] = await Promise.all([
    prisma.brand.findUnique({ where: { id: brandId } }),
    prisma.brandIdentity.findFirst({ where: { brandId }, orderBy: { createdAt: "desc" } }),
  ]);

  if (!brand) {
    return errorResponse(404, "Brand not found.");
  }

  const contentLanguage = normalizeLanguageCode(brand.contentLanguage);

  // ── 6. Resolve the resource ──────────────────────────────────────────────────
  let extracted;
  try {
    extracted = await fetchAndExtractResource(resourceUrl);
  } catch (err) {
    console.error("[LinkedInSuggestPosts] Resource fetch error:", err.message);
    const { status, error, details } = classifyFetchError(err);
    return errorResponse(status, error, details);
  }

  const resourceType = classifyResourceType(resourceUrl, extracted);

  // ── 7. Build the grounded article list ───────────────────────────────────────
  let articles;
  let usedFallback = false;

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

    // If all candidate article fetches failed, build a fallback article from
    // the original page content (title, description, bodyText preview) plus
    // the candidate titles/snippets/URLs. This lets listing/homepage pages
    // still produce grounded suggestions even when individual article pages
    // are unreachable.
    if (!articles.length) {
      const snippetLines = candidates
        .slice(0, 10)
        .map((c, i) => `${i + 1}. "${c.title}"${c.snippet !== c.title ? ` — ${c.snippet}` : ""} (${c.url})`);

      const fallbackText = [
        extracted.title && `Page Title: ${extracted.title}`,
        extracted.description && `Description: ${extracted.description}`,
        extracted.bodyText && `Page content preview:\n${extracted.bodyText.slice(0, 3000)}`,
        snippetLines.length && `\nCandidate articles found on this page:\n${snippetLines.join("\n")}`,
      ].filter(Boolean).join("\n\n");

      articles = [{
        url: extracted.finalUrl || resourceUrl,
        title: extracted.title || extracted.finalUrl || resourceUrl,
        text: fallbackText,
      }];
      usedFallback = true;

      console.warn(
        `[LinkedInSuggestPosts] Fallback for listing page "${articles[0].title}": ` +
        `0/${selected.length} candidate fetches succeeded; using ${snippetLines.length} candidate snippets`
      );
    }
  }

  // ── 8. Build prompt + call AI (single call) ──────────────────────────────────
  const brandIdentitySummary = buildIdentitySummary(identity, brand);

  let userInputSections = [
    "=== BRAND INFORMATION ===",
    brandIdentitySummary || "Not yet extracted.",
  ];

  if (attachmentContext.block) {
    userInputSections.push(
      "",
      "=== INTERPRETED UPLOADED REFERENCE MATERIAL ===",
      attachmentContext.block,
    );
  }

  userInputSections.push("", buildLanguageInstruction(contentLanguage));

  const articlesBlock = articles
    .map((a, i) => [
      `=== ARTICLE ${i} ===`,
      `Title: ${a.title}`,
      `URL: ${a.url}`,
      `Content:`,
      (a.text || "").slice(0, ARTICLE_TEXT_CHARS_IN_PROMPT),
    ].join("\n"))
    .join("\n\n");

  userInputSections.push(
    "",
    `=== ARTICLES (${articles.length}) ===`,
    articlesBlock,
  );

  let userInput = userInputSections.join("\n");

  if (articles.length > 1) {
    userInput += [
      "",
      "",
      "=== ARTICLE DISTRIBUTION INSTRUCTION ===",
      `You have ${articles.length} articles available for ${safeCount} LinkedIn post idea(s).`,
      "Assign DIFFERENT articleIndex values to DIFFERENT post ideas.",
      `Do NOT reuse the same articleIndex for more than one post idea unless ${safeCount} exceeds ${articles.length}.`,
      "Prefer articles that seem most recently published and most professionally relevant for LinkedIn.",
      `Valid articleIndex values are 0 through ${articles.length - 1}.`,
      "Every post MUST include a valid articleIndex matching the article it is based on.",
    ].join("\n");
  }

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

  // ── 9. Extract + normalize posts ─────────────────────────────────────────────
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

  const initialGeneratedCount = suggestions.length;

  // ── 10. Retry shortfall ────────────────────────────────────────────────────
  // If the AI returned fewer posts than requested, retry up to 3 times for the
  // remaining count. Each retry explicitly lists already-used hooks to avoid
  // duplicates and asks the AI to vary angles/formats if the source is limited.
  const MAX_RETRY_ATTEMPTS = 3;

  let totalUsage = suggestResult.usage ? { ...suggestResult.usage } : null;

  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS && suggestions.length < safeCount; attempt++) {
    const remaining = safeCount - suggestions.length;
    console.log(`[LinkedInSuggestPosts] Retry ${attempt + 1}: have ${suggestions.length}, need ${remaining} more`);

    const existingHooks = suggestions.map((s) => s.suggestedHook).filter(Boolean);
    const retryUserInput = [
      userInput,
      "",
      "=== RETRY INSTRUCTION ===",
      `The previous request returned only ${suggestions.length} ideas out of ${safeCount} requested.`,
      `Generate exactly ${remaining} ADDITIONAL LinkedIn post idea${remaining !== 1 ? "s" : ""} that ${remaining !== 1 ? "are" : "is"} DIFFERENT from the ones already returned below.`,
      "Do NOT repeat or closely paraphrase any of these already-used hooks or angles:",
      ...existingHooks.map((h, i) => `  ${i + 1}. "${h}"`),
      "",
      "Stay grounded in the same provided articles above.",
      `Vary the hook, angle, format (Static vs Carousel), or draw from a different section of the article${articles.length > 1 ? " or a different article" : ""} if the source has limited content.`,
      `Return exactly ${remaining} new post idea${remaining !== 1 ? "s" : ""}.`,
      "Return ONLY the new posts, never the already-returned ones.",
    ].join("\n");

    const retryVariables = {
      ...variables,
      numberOfPosts: String(remaining),
    };

    let retryResult;
    try {
      retryResult = await generateWithPromptTemplate({
        templateSlug: "linkedin-post-from-reference",
        variables: retryVariables,
        userInput: retryUserInput,
        responseFormat: "json_object",
      });
    } catch (err) {
      console.warn(`[LinkedInSuggestPosts] Retry ${attempt + 1} failed:`, err.message);
      continue;
    }

    // Accumulate token usage across retries
    if (retryResult.usage) {
      totalUsage = {
        prompt_tokens: (totalUsage?.prompt_tokens || 0) + (retryResult.usage.prompt_tokens || 0),
        completion_tokens: (totalUsage?.completion_tokens || 0) + (retryResult.usage.completion_tokens || 0),
        total_tokens: (totalUsage?.total_tokens || 0) + (retryResult.usage.total_tokens || 0),
      };
    }

    // Extract posts from retry result (same extraction pattern as the initial call)
    let retryRaw = [];
    const retryContent = retryResult.content;
    if (Array.isArray(retryContent)) {
      retryRaw = retryContent;
    } else if (retryContent && typeof retryContent === "object") {
      const arrayValues = Object.values(retryContent).filter((v) => Array.isArray(v));
      retryRaw = retryContent.posts ?? retryContent.postIdeas ?? retryContent.suggestions ?? arrayValues[0] ?? [];
    }
    if (!Array.isArray(retryRaw)) retryRaw = [];

    // Normalize, deduplicate against all already-accepted posts (including any
    // from prior retries within this loop iteration), then append
    const newSuggestions = [];
    for (const p of retryRaw) {
      const normalized = normaliseLinkedInPost(p, newSuggestions.length, articles);
      if (!isDuplicatePost(normalized, [...suggestions, ...newSuggestions])) {
        newSuggestions.push(normalized);
      }
    }

    if (newSuggestions.length > 0) {
      suggestions.push(...newSuggestions);
      console.log(`[LinkedInSuggestPosts] Retry ${attempt + 1}: got ${newSuggestions.length} new unique ideas`);
    } else {
      console.warn(`[LinkedInSuggestPosts] Retry ${attempt + 1}: no new unique ideas returned`);
    }
  }

  // ── 11. Enforce article distribution across all posts ────────────────────────
  suggestions = distributeArticlesAcrossPosts(suggestions, articles);

  // Final cap to safeCount and renumber sequentially so postNumber stays clean
  // after merging results from multiple calls
  if (suggestions.length > safeCount) suggestions = suggestions.slice(0, safeCount);
  suggestions.forEach((p, i) => { p.postNumber = i + 1; });

  const retryGeneratedCount = suggestions.length - initialGeneratedCount;
  const finalReturnedCount = suggestions.length;

  console.log(
    `[LinkedInSuggestPosts] requestedCount=${safeCount} | ` +
    `initialGeneratedCount=${initialGeneratedCount} | ` +
    `retryGeneratedCount=${retryGeneratedCount} | ` +
    `finalReturnedCount=${finalReturnedCount} | ` +
    `articles=${articles.length}`
  );

  return NextResponse.json({
    success: true,
    suggestions,
    posts: suggestions, // alias for compatibility with the existing review UI's `data.posts` shape
    resourceType,
    articlesUsed: articles.map((a) => ({ url: a.url, title: a.title })),
    requestedCount: safeCount,
    returnedCount: suggestions.length,
    shortfall: finalReturnedCount < safeCount,
    shortfallMessage: finalReturnedCount < safeCount
      ? `Only ${finalReturnedCount} of ${safeCount} post ideas could be generated. Try adding more resources or reducing the requested count.`
      : undefined,
    usage: totalUsage,
    model: suggestResult.model,
    ...(usedFallback ? { usedFallback: true } : {}),
  });
}
