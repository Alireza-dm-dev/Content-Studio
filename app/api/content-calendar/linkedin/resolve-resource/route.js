import { NextResponse } from "next/server";
import {
  normalizeResourceUrl,
  fetchAndExtractResource,
  classifyResourceType,
  extractCandidateArticleLinks,
} from "@/lib/url-resource-utils";

const BODY_TEXT_PREVIEW_CHARS = 500;

function errorResponse(status, error, details) {
  return NextResponse.json(
    { success: false, error, ...(details ? { details } : {}) },
    { status }
  );
}

// Maps a thrown fetchAndExtractResource() error message to an HTTP status —
// timeouts/network failures are upstream problems (502/504), everything else
// from that function is a validation problem (400).
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

export async function POST(request) {
  console.log("[LinkedInResolveResource] POST /api/content-calendar/linkedin/resolve-resource");

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse(400, "Invalid request body.", e.message);
  }

  const { url } = body || {};

  // ── 1. Validate URL ────────────────────────────────────────────────────────
  let normalizedUrl;
  try {
    normalizedUrl = normalizeResourceUrl(url);
  } catch (err) {
    return errorResponse(400, err.message);
  }

  // ── 2. Fetch + extract ─────────────────────────────────────────────────────
  let extracted;
  try {
    extracted = await fetchAndExtractResource(normalizedUrl);
  } catch (err) {
    console.error("[LinkedInResolveResource] Fetch/extract error:", err.message);
    const { status, error, details } = classifyFetchError(err);
    return errorResponse(status, error, details);
  }

  const hasTitle = Boolean(extracted.title && extracted.title.trim());
  const hasBody = Boolean(extracted.bodyText && extracted.bodyText.trim().length >= 50);
  if (!hasTitle && !hasBody) {
    return errorResponse(422, "No useful content could be extracted from that URL.");
  }

  // ── 3. Classify + find candidates ──────────────────────────────────────────
  const resourceType = classifyResourceType(normalizedUrl, extracted);
  const candidates =
    resourceType === "article"
      ? []
      : extractCandidateArticleLinks(normalizedUrl, extracted);

  const bodyTextPreview = (extracted.bodyText || "").slice(0, BODY_TEXT_PREVIEW_CHARS);

  console.log(
    `[LinkedInResolveResource] ${normalizedUrl} -> ${resourceType} (${candidates.length} candidates)`
  );

  return NextResponse.json({
    success: true,
    resourceType,
    resource: {
      url: extracted.finalUrl || normalizedUrl,
      title: extracted.title || "",
      description: extracted.description || "",
      bodyTextPreview,
    },
    candidates,
  });
}
