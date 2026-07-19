// Safe URL fetch + light HTML extraction for the LinkedIn resource-based
// calendar journey. No external dependencies — built-in fetch + regex-based
// tag stripping only. Not a general-purpose scraper: good enough to pull a
// title/description/body text and candidate links out of a normal server-
// rendered HTML page.

const FETCH_TIMEOUT_MS = 20000;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_BODY_TEXT_CHARS = 12000;
const MAX_CANDIDATE_LINKS = 20;
const MAX_REDIRECTS = 3;
// Status codes fetch's own redirect:"follow" mode treats as redirects — kept
// identical here so manual redirect handling doesn't change which responses
// are considered redirects, only how their targets get validated.
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const LISTING_PATH_RE = /\/(blog|blogs|articles|news)(\/|$)/i;
const ARTICLE_PATH_HINTS_RE = /\b(blog|blogs|article|articles|news|insights|resources)\b/i;
const EXCLUDED_LINK_RE = /\b(login|signup|sign-up|register|cart|checkout|privacy|terms|cookie|contact|about|pricing|category|categories|tag|tags|author|page|search|feed|rss)\b/i;
const SOCIAL_HOST_RE = /(facebook|twitter|x\.com|linkedin|instagram|youtube|tiktok|pinterest)\.com$/i;

const JINA_TIMEOUT_MS = 30000;

// ─── normalizeResourceUrl ──────────────────────────────────────────────────────
// Validates and normalizes a user-supplied resource URL. Throws on anything
// that isn't a safe, well-formed http(s) URL.
export function normalizeResourceUrl(inputUrl) {
  if (typeof inputUrl !== "string" || !inputUrl.trim()) {
    throw new Error("A resource URL is required.");
  }

  const trimmed = inputUrl.trim();

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    // A bare domain or domain+path ("example.com", "example.com/blog") has no
    // scheme, so it isn't a parseable absolute URL on its own — that's what
    // users naturally paste, so retry assuming https:// before giving up.
    // URLs with an explicit (even disallowed) scheme, like "ftp://example.com",
    // already parsed successfully above and never reach this fallback.
    try {
      parsed = new URL(`https://${trimmed}`);
    } catch {
      throw new Error(
        `Enter a valid website URL, for example https://example.com/blog or example.com/blog. ("${trimmed}" isn't a usable URL.)`
      );
    }
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http:// and https:// URLs are supported.");
  }

  if (!parsed.hostname) {
    throw new Error(
      "Enter a valid website URL, for example https://example.com/blog or example.com/blog."
    );
  }

  if (isObviouslyPrivateHost(parsed.hostname)) {
    throw new Error("Local, private, or internal network URLs are not allowed.");
  }

  // Drop the fragment — it never affects server-rendered content — and any
  // trailing slash duplication, but keep query string as-is (some listing
  // pages page through query params).
  parsed.hash = "";
  let normalized = parsed.toString();
  if (normalized.endsWith("/") && parsed.pathname !== "/") {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

function isObviouslyPrivateHost(hostname) {
  const host = hostname.toLowerCase();

  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "0.0.0.0" || host === "::1") return true;

  // IPv4 literal — check for loopback/private/link-local ranges.
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [, a, b] = ipv4.map(Number);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local
    if (a === 0) return true; // "this" network
    return false;
  }

  // Bare IPv6 loopback / link-local, written with or without brackets.
  // Guard on ":" first — colons never appear in DNS hostnames but always
  // appear in IPv6 literals, so without this guard the "fc"/"fd" unique-local
  // prefix check below would also match ordinary public domains that happen
  // to start with those letters (e.g. "fcbarcelona.com", "fdicorp.com").
  const ipv6 = host.replace(/^\[|\]$/g, "");
  if (ipv6.includes(":")) {
    if (ipv6 === "::1") return true;
    if (ipv6.startsWith("fe80:")) return true; // link-local
    if (ipv6.startsWith("fc") || ipv6.startsWith("fd")) return true; // unique local
  }

  return false;
}

// ─── fetchAndExtractResource ───────────────────────────────────────────────────
// Fetches a normalized URL and extracts a lightweight content summary from it.
export async function fetchAndExtractResource(inputUrl) {
  let url = normalizeResourceUrl(inputUrl);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response;
    try {
      // redirect: "manual" — a public URL can redirect to a private/internal
      // one (e.g. http://169.254.169.254/), and fetch's automatic redirect
      // following would land there without ever re-checking the host. Each
      // hop is re-validated through normalizeResourceUrl below instead.
      let redirectCount = 0;
      for (;;) {
        let attempt;
        try {
          attempt = await fetch(url, {
            signal: controller.signal,
            redirect: "manual",
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; ContentStudioBot/1.0; +resource-import)",
              "Accept": "text/html,application/xhtml+xml",
            },
          });
        } catch (err) {
          if (err.name === "AbortError") {
            throw new Error(`Timed out fetching ${url} after ${FETCH_TIMEOUT_MS}ms.`);
          }
          // Differentiate blocked requests (the most common non-timeout failure)
          // from other network errors so the front end can show a useful message.
          const lower = err.message.toLowerCase();
          if (/blocked|cors|forbidden|429|403/i.test(lower)) {
            throw new Error(`Request blocked or rate limited while fetching ${url}. The website may have rejected the request.`);
          }
          throw new Error(`Could not fetch ${url}: ${err.message}`);
        }

        if (!REDIRECT_STATUSES.has(attempt.status)) {
          response = attempt;
          break;
        }

        redirectCount += 1;
        if (redirectCount > MAX_REDIRECTS) {
          throw new Error(`Too many redirects (more than ${MAX_REDIRECTS}) while fetching ${inputUrl}.`);
        }

        const location = attempt.headers.get("location");
        if (!location || !location.trim()) {
          throw new Error(`Redirect from ${url} did not include a usable Location header.`);
        }

        let resolved;
        try {
          resolved = new URL(location.trim(), url);
        } catch {
          throw new Error(`Redirect from ${url} pointed to an invalid URL: "${location.trim()}".`);
        }

        try {
          url = normalizeResourceUrl(resolved.toString());
        } catch (err) {
          throw new Error(`Redirect target was rejected: ${err.message}`);
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`Fetching ${url} failed with status ${response.status}.`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      throw new Error(`Unsupported content type for ${url}: "${contentType}". Expected an HTML page.`);
    }

    const finalUrl = response.url || url;

    const html = await readBodyCapped(response, MAX_BODY_BYTES);
    const rawHtmlLength = html.length;

    const title = extractTitle(html);
    const description = extractMetaDescription(html);
    const bodyText = extractBodyText(html);
    const links = extractLinks(html, finalUrl);
    const ogTitle = extractOgTitle(html);
    const ogImage = extractOgImage(html);
    const ogSiteName = extractOgSiteName(html);

    return { url, finalUrl, title: title || ogTitle, description, bodyText, links, ogImage, ogSiteName, rawHtmlLength };
  } catch (err) {
    // Direct fetch failed — try Jina Reader as a zero-config proxy that
    // handles bot protection, JS rendering, and paywalls.
    try {
      return await fetchViaJina(url);
    } catch {
      // Jina also failed — surface the original error so the route's
      // classifyFetchError maps it to the right HTTP status.
      throw err;
    }
  }
}

// Reads a Response body as text, stopping once MAX_BODY_BYTES worth of bytes
// have been read (rather than buffering an unbounded response fully).
async function readBodyCapped(response, maxBytes) {
  if (!response.body || typeof response.body.getReader !== "function") {
    // Environments without a streamable body (rare) — fall back to a plain
    // read, still capped after the fact.
    const text = await response.text();
    return text.length > maxBytes ? text.slice(0, maxBytes) : text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let received = 0;
  let out = "";

  while (received < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();

  try { await reader.cancel(); } catch {}

  return out.length > maxBytes ? out.slice(0, maxBytes) : out;
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(collapseWhitespace(m[1])) : "";
}

function extractMetaDescription(html) {
  const patterns = [
    /<meta[^>]+name=["']description["'][^>]*content=["']([\s\S]*?)["'][^>]*>/i,
    /<meta[^>]+content=["']([\s\S]*?)["'][^>]*name=["']description["'][^>]*>/i,
    /<meta[^>]+property=["']og:description["'][^>]*content=["']([\s\S]*?)["'][^>]*>/i,
    /<meta[^>]+content=["']([\s\S]*?)["'][^>]*property=["']og:description["'][^>]*>/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decodeEntities(collapseWhitespace(m[1]));
  }
  return "";
}

function extractOgTitle(html) {
  const patterns = [
    /<meta[^>]+property=["']og:title["'][^>]*content=["']([\s\S]*?)["'][^>]*>/i,
    /<meta[^>]+content=["']([\s\S]*?)["'][^>]*property=["']og:title["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:title["'][^>]*content=["']([\s\S]*?)["'][^>]*>/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decodeEntities(collapseWhitespace(m[1]));
  }
  return "";
}

function extractOgImage(html) {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]*content=["']([\s\S]*?)["'][^>]*>/i,
    /<meta[^>]+content=["']([\s\S]*?)["'][^>]*property=["']og:image["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image["'][^>]*content=["']([\s\S]*?)["'][^>]*>/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decodeEntities(collapseWhitespace(m[1]));
  }
  return "";
}

function extractOgSiteName(html) {
  const patterns = [
    /<meta[^>]+property=["']og:site_name["'][^>]*content=["']([\s\S]*?)["'][^>]*>/i,
    /<meta[^>]+content=["']([\s\S]*?)["'][^>]*property=["']og:site_name["'][^>]*>/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decodeEntities(collapseWhitespace(m[1]));
  }
  return "";
}

function extractBodyText(html) {
  let stripped = stripNonContentTags(html);
  // Turn common block-level boundaries into line breaks before stripping the
  // remaining tags, so paragraphs/headings don't run together.
  stripped = stripped.replace(/<\/(p|div|h[1-6]|li|br|section|article|header|footer)>/gi, "\n");
  stripped = stripped.replace(/<[^>]+>/g, " ");
  const text = decodeEntities(collapseWhitespace(stripped));
  return text.length > MAX_BODY_TEXT_CHARS ? text.slice(0, MAX_BODY_TEXT_CHARS) : text;
}

function stripNonContentTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

function extractLinks(html, baseUrl) {
  const cleaned = stripNonContentTags(html);
  const linkRe = /<a\s+[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set();
  const links = [];

  let m;
  while ((m = linkRe.exec(cleaned)) !== null) {
    const rawHref = m[1].trim();
    const text = decodeEntities(collapseWhitespace(m[2].replace(/<[^>]+>/g, " ")));

    let resolved;
    try {
      resolved = new URL(rawHref, baseUrl);
    } catch {
      continue;
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;

    resolved.hash = "";
    const href = resolved.toString();
    const key = `${href}::${text}`;
    if (seen.has(key)) continue;
    seen.add(key);

    links.push({ href, text });
  }

  return links;
}

// ─── fetchViaJina ───────────────────────────────────────────────────────────────
// Fallback when the origin server blocks, rate-limits, or times out the direct
// fetch. Uses Jina Reader (https://r.jina.ai) as a proxy — it renders JS,
// bypasses basic bot protection, and returns clean markdown/text. No API key
// required. Zero-config in 10 lines. Returns the same shape as
// fetchAndExtractResource so callers see no difference.
async function fetchViaJina(sourceUrl) {
  const jinaUrl = `https://r.jina.ai/${encodeURIComponent(sourceUrl)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(jinaUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ContentStudioBot/1.0; +resource-import)",
        "Accept": "text/plain, text/markdown",
      },
    });
  } catch (jinaErr) {
    const lower = jinaErr.message.toLowerCase();
    if (/blocked|cors|forbidden|429|403/i.test(lower)) {
      throw new Error(`Metadata service (Jina) was blocked while reaching ${sourceUrl}.`);
    }
    if (jinaErr.name === "AbortError") {
      throw new Error(`Metadata service (Jina) timed out reaching ${sourceUrl}.`);
    }
    throw new Error(`Metadata service (Jina) could not reach ${sourceUrl}.`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Metadata service (Jina) returned status ${response.status} for ${sourceUrl}.`);
  }

  const text = await response.text();
  if (!text.trim()) {
    throw new Error(`Metadata service (Jina) returned empty content for ${sourceUrl}.`);
  }

  return parseJinaResponse(text, sourceUrl);
}

function parseJinaResponse(text, sourceUrl) {
  let title = "";
  let description = "";
  let bodyText = "";

  // Jina returns structured markdown in this format:
  //   Title: The Page Title
  //   URL Source: https://...
  //   Markdown Content:
  //   ...
  const titleLine = text.match(/^Title:\s*(.+)$/m);
  const contentMarker = text.match(/^Markdown Content:\s*$/m);

  if (titleLine) {
    title = titleLine[1].trim();
  }

  if (contentMarker) {
    // Everything after "Markdown Content:" is the markdown body
    const afterMarker = text.slice(contentMarker.index + contentMarker[0].length).trim();
    bodyText = stripMarkdown(afterMarker);
    if (!title) {
      // Try first # heading as title fallback when Title: header is missing
      const heading = afterMarker.match(/^#\s+(.+)$/m);
      if (heading) title = heading[1].trim();
    }
  } else {
    // Unstructured response — treat entire body as text
    bodyText = stripMarkdown(text);
    if (!title) {
      const firstLine = text.split("\n").find((l) => l.trim());
      if (firstLine) title = firstLine.replace(/^#+\s*/, "").trim();
    }
  }

  description = title;

  // Extract links from markdown [text](url) syntax
  const links = [];
  const seen = new Set();
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
  let m;
  while ((m = linkRe.exec(text)) !== null) {
    const href = m[2].trim();
    const textContent = m[1].trim();
    if (!href || !textContent) continue;
    try {
      const parsed = new URL(href, sourceUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      const key = `${parsed.origin}${parsed.pathname}::${textContent}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ href: parsed.toString(), text: textContent });
    } catch {
      // unparseable URL — skip
    }
  }

  return {
    url: sourceUrl,
    finalUrl: sourceUrl,
    title: title || sourceUrl,
    description,
    bodyText: bodyText.slice(0, MAX_BODY_TEXT_CHARS),
    links,
    rawHtmlLength: text.length,
  };
}

function stripMarkdown(md) {
  return md
    .replace(/^#+\s+/gm, "")           // headings
    .replace(/\*\*(.+?)\*\*/g, "$1")   // bold
    .replace(/\*(.+?)\*/g, "$1")       // italic
    .replace(/~~(.+?)~~/g, "$1")       // strikethrough
    .replace(/`{1,3}[^`]*`{1,3}/g, "") // inline code
    .replace(/```[\s\S]*?```/g, "")    // code blocks
    .replace(/^>\s+/gm, "")            // blockquotes
    .replace(/^[-*+]\s+/gm, "")        // unordered list markers
    .replace(/^\d+\.\s+/gm, "")        // ordered list markers
    .replace(/^---+\s*$/gm, "")        // horizontal rules
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links -> visible text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1") // images -> alt text
    .replace(/\n{3,}/g, "\n\n")        // collapse excessive newlines
    .trim();
}

// ─── classifyResourceType ───────────────────────────────────────────────────────
// Best-effort classification of a resource URL as a single article, a blog
// listing page, or a general website — used to decide how suggestion
// generation should treat the resource.
export function classifyResourceType(inputUrl, extracted) {
  let path = "";
  try { path = new URL(inputUrl).pathname; } catch { path = ""; }

  const candidateLinks = extractCandidateArticleLinks(inputUrl, extracted);
  const bodyText = extracted?.bodyText || "";
  const hasSubstantialBody = bodyText.length > 800;
  const hasClearTitle = Boolean(extracted?.title && extracted.title.trim());

  if (LISTING_PATH_RE.test(path) || candidateLinks.length >= 6) {
    return "listing";
  }

  if (hasSubstantialBody && hasClearTitle && candidateLinks.length < 6) {
    return "article";
  }

  return "website";
}

// ─── extractCandidateArticleLinks ───────────────────────────────────────────────
// Filters extracted.links down to links that plausibly point at blog/article
// content, ranked by how strongly their path suggests an article, deduped
// and capped to a reasonable number for downstream LLM ranking.
export function extractCandidateArticleLinks(inputUrl, extracted) {
  const links = extracted?.links;
  if (!Array.isArray(links) || !links.length) return [];

  let originHost = "";
  try { originHost = new URL(inputUrl).hostname; } catch {}

  const seenUrls = new Set();
  const candidates = [];

  for (const { href, text } of links) {
    let parsed;
    try { parsed = new URL(href); } catch { continue; }

    // Keep to the same site — cross-site links in nav/footers are never the
    // "next article" a listing page is pointing at.
    if (originHost && parsed.hostname !== originHost) continue;
    if (SOCIAL_HOST_RE.test(parsed.hostname)) continue;

    const path = parsed.pathname || "/";
    if (path === "/" || path === "") continue;
    if (EXCLUDED_LINK_RE.test(path)) continue;

    const title = (text || "").trim();
    if (!title || title.length < 8) continue; // nav/icon links rarely have real titles

    const normalizedUrl = `${parsed.origin}${path}`;
    if (seenUrls.has(normalizedUrl)) continue;
    seenUrls.add(normalizedUrl);

    const looksLikeArticle = ARTICLE_PATH_HINTS_RE.test(path);
    // Slugs with several hyphen-separated words are a strong article signal
    // (e.g. /blog/five-tips-for-x) beyond just the section name.
    const lastSegment = path.split("/").filter(Boolean).pop() || "";
    const slugWordCount = lastSegment.split("-").filter(Boolean).length;

    candidates.push({
      url: normalizedUrl,
      title,
      snippet: title,
      _score: (looksLikeArticle ? 2 : 0) + (slugWordCount >= 3 ? 1 : 0),
    });
  }

  candidates.sort((a, b) => b._score - a._score);

  return candidates.slice(0, MAX_CANDIDATE_LINKS).map(({ url, title, snippet }) => ({ url, title, snippet }));
}

function collapseWhitespace(str) {
  return (str || "").replace(/\s+/g, " ").trim();
}

function decodeEntities(str) {
  if (!str) return "";
  return str
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}
