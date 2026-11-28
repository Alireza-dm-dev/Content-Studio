import { buildCanonicalPublishPayload } from "@/lib/published-post-utils";
import { isCanonicalMediaUrl } from "@/lib/published-post-remote-media";
import { prisma } from "@/lib/prisma";

// Which source getN8nWebhookUrl() last resolved the URL from — logged on send so
// a stale Settings row is not mistaken for the .env value.
let lastWebhookUrlSource = "unknown";

function validateWebhookUrl(url) {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

export async function getN8nWebhookUrl() {
  try {
    const setting = await prisma.settings.findUnique({
      where: { key: "N8N_PUBLISHED_POST_WEBHOOK_URL" },
    });
    if (setting?.value) {
      const valid = validateWebhookUrl(setting.value);
      if (valid) {
        lastWebhookUrlSource = "Settings table";
        return valid;
      }
      console.warn("[PublishedPosts] n8n webhook URL in Settings is invalid, ignoring it", {
        value: setting.value,
      });
    }
  } catch {
    // DB unavailable — fall through to env var
  }
  if (process.env.N8N_PUBLISHED_POST_WEBHOOK_URL) {
    lastWebhookUrlSource = "N8N_PUBLISHED_POST_WEBHOOK_URL env var";
    return validateWebhookUrl(process.env.N8N_PUBLISHED_POST_WEBHOOK_URL);
  }
  lastWebhookUrlSource = "none";
  return null;
}

/**
 * Where the production publish webhook URL resolves from, WITHOUT returning it:
 * "settings" | "environment" | "none". Mirrors getN8nWebhookUrl()'s priority and
 * validity rules exactly (Settings row first, then env var).
 */
export async function getN8nWebhookUrlStatus() {
  try {
    const setting = await prisma.settings.findUnique({
      where: { key: "N8N_PUBLISHED_POST_WEBHOOK_URL" },
    });
    if (setting?.value && validateWebhookUrl(setting.value)) return "settings";
  } catch {
    // DB unavailable — fall through to env var
  }
  if (process.env.N8N_PUBLISHED_POST_WEBHOOK_URL && validateWebhookUrl(process.env.N8N_PUBLISHED_POST_WEBHOOK_URL)) {
    return "environment";
  }
  return "none";
}

// Temporary external-contract adapter: the live n8n workflow expects the legacy
// Instagram-mirrored LinkedIn shape (image_url + media_url), not the canonical
// document_url payload we now store in the DB. Convert ONLY here, immediately
// before the webhook POST, and ONLY for LinkedIn document payloads. The stored
// jsonPayload and all preview/copy/download output remain canonical. If the
// n8n workflow is later updated to accept document_url, delete this function.
function adaptPublishedPostPayloadForN8n(payload) {
  if (!payload || typeof payload !== "object") return payload;

  const isLinkedInDoc =
    (payload.Platform === "LinkedIn" || payload.Platform === "Linkedin") &&
    Array.isArray(payload.files) &&
    payload.files.some((f) => f && typeof f.document_url === "string");
  if (!isLinkedInDoc) return payload;

  const pdfUrl =
    payload.files.find((f) => f && f.document_url)?.document_url ||
    (Array.isArray(payload.media) && payload.media[0]?.url) ||
    "";

  return {
    ...payload,
    Platform: "Linkedin",
    files: [{ media_type: "IMAGE", image_url: pdfUrl }],
    media: [{ order: 1, url: pdfUrl, media_type: "IMAGE" }],
    media_url: pdfUrl,
    media_count: 1,
    is_carousel: true,
    video_url: "",
  };
}

/**
 * Every media URL field of an outbound payload, in the exact order the
 * production send validates them: [{ field, value }]. Empty values are skipped.
 */
export function collectPayloadMediaUrls(payload) {
  const out = [];
  if (!payload || typeof payload !== "object") return out;
  const add = (field, value) => { if (value) out.push({ field, value }); };
  add("video_url", payload.video_url);
  add("thumbnail_url", payload.thumbnail_url);
  add("media_url", payload.media_url);
  if (Array.isArray(payload.files)) {
    payload.files.forEach((f, i) => {
      if (!f) return;
      add(`files[${i}].image_url`, f.image_url);
      add(`files[${i}].video_url`, f.video_url);
      add(`files[${i}].document_url`, f.document_url);
    });
  }
  if (Array.isArray(payload.media)) {
    payload.media.forEach((m, i) => add(`media[${i}].url`, m?.url));
  }
  return out;
}

/** Media URL fields that are not public HTTPS URLs under the configured media base. */
export function findNonPublicMediaFields(payload) {
  return collectPayloadMediaUrls(payload).filter(
    ({ value }) => typeof value !== "string" || !isCanonicalMediaUrl(value),
  );
}

// Validate every URL in the payload is a public HTTPS URL.
// Returns null if valid, or a structured error response if any URL is not public.
function validatePayloadUrls(payload) {
  if (!payload || typeof payload !== "object") {
    return {
      success: false,
      code: "N8N_MEDIA_URL_NOT_PUBLIC",
      error: "The post was saved, but its media is not available at a public URL.",
    };
  }
  const [bad] = findNonPublicMediaFields(payload);
  if (!bad) return null;
  console.error("[PublishedPosts] payload URL rejected as non-public", {
    field: bad.field,
    value: typeof bad.value === "string" ? bad.value : typeof bad.value,
    expectedPublicBase:
      process.env.PUBLISHED_MEDIA_PUBLIC_BASE_URL || "https://files.leadsagna.com",
  });
  return {
    success: false,
    code: "N8N_MEDIA_URL_NOT_PUBLIC",
    error: "The post was saved, but its media is not available at a public URL.",
    details: `${bad.field} is not a public HTTPS URL under the configured media base`,
  };
}

/**
 * The exact outbound publish request body for a saved post, shared by the
 * production send and the trial send: canonical payload (stored payload, Brand
 * name, server-normalized schedule fields) → LinkedIn legacy adapter → JSON.
 * Returns { ok: true, canonical, payload, body } | { ok: false, success: false, code, error }.
 * `canonical` is the pre-adapter payload; `payload`/`body` are what is sent.
 */
export function buildOutboundPublishBody({ post, media, brandName, brandTimezone }) {
  const built = buildCanonicalPublishPayload({ post, media, brandName, brandTimezone });
  if (!built.ok) return built;
  const canonical = built.payload;
  const payload = adaptPublishedPostPayloadForN8n(canonical);
  return { ok: true, canonical, payload, body: JSON.stringify(payload) };
}

export async function sendPublishedPostToN8n({ post, media, brandName, brandTimezone }) {
  const webhookUrl = await getN8nWebhookUrl();
  if (!webhookUrl) {
    console.error("[PublishedPosts] no n8n webhook URL configured", {
      postId: post?.id,
      source: lastWebhookUrlSource,
    });
    return {
      success: false,
      code: "N8N_WEBHOOK_NOT_CONFIGURED",
      error: "n8n webhook URL is not configured.",
    };
  }

  // Same canonical payload the JSON preview endpoint returns; the legacy
  // LinkedIn adapter is applied only here (buildOutboundPublishBody), right
  // before the POST. The trial send serializes through the same function.
  const built = buildOutboundPublishBody({ post, media, brandName, brandTimezone });
  if (!built.ok) {
    const { ok: _ok, ...failure } = built; // same failure shape as before
    return failure;
  }
  const { payload } = built;

  console.log("[PublishedPosts] auto sending n8n payload", {
    postId: post.id,
    scheduledDateUtc: payload.scheduled_date_utc,
    brandTimezone: payload.brand_timezone,
    n8nScheduledDate: payload["Scheduled Date"],
    mediaCount: payload.media_count,
    hasFiles: Array.isArray(payload.files),
    webhookConfigured: true,
    webhookUrl,
    webhookUrlSource: lastWebhookUrlSource,
    isTestWebhook: webhookUrl.includes("/webhook-test/"),
  });

  // Validate every media URL is a publicly fetchable HTTPS URL.
  // Never fabricate a public URL from a local /uploads path.
  const urlError = validatePayloadUrls(payload);
  if (urlError) {
    return urlError;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let n8nResponse;
    try {
      n8nResponse = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: built.body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!n8nResponse.ok) {
      let responseBody = "";
      try {
        responseBody = (await n8nResponse.text()).slice(0, 1000);
      } catch {
        responseBody = "(response body could not be read)";
      }
      console.error("[PublishedPosts] auto n8n send failed", {
        postId: post.id,
        status: n8nResponse.status,
        statusText: n8nResponse.statusText,
        webhookUrl,
        webhookUrlSource: lastWebhookUrlSource,
        responseBody,
        hint:
          n8nResponse.status === 404
            ? "n8n returned 404: the workflow is not active, or the /webhook vs /webhook-test path does not match the workflow's current mode."
            : undefined,
      });
      return {
        success: false,
        code: "N8N_WEBHOOK_FAILED",
        webhookStatus: n8nResponse.status,
        error: "The post was saved, but it could not be sent to n8n.",
        details: `n8n responded ${n8nResponse.status}: ${responseBody.slice(0, 200)}`,
      };
    }

    return {
      success: true,
      sentAt: new Date().toISOString(),
      webhookStatus: n8nResponse.status,
    };
  } catch (error) {
    if (error && typeof error === "object" && error.name === "AbortError") {
      return {
        success: false,
        code: "N8N_WEBHOOK_TIMEOUT",
        error: "The post was saved, but n8n took too long to respond.",
      };
    }
    console.error("[PublishedPosts] auto n8n send failed", error);
    return {
      success: false,
      code: "N8N_WEBHOOK_FAILED",
      error: "The post was saved, but it could not be sent to n8n.",
    };
  }
}
