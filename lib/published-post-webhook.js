import { buildN8nPayload } from "@/lib/published-post-utils";
import { prisma } from "@/lib/prisma";

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
      if (valid) return valid;
    }
  } catch {
    // DB unavailable — fall through to env var
  }
  if (process.env.N8N_PUBLISHED_POST_WEBHOOK_URL) {
    return validateWebhookUrl(process.env.N8N_PUBLISHED_POST_WEBHOOK_URL);
  }
  return null;
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

export async function sendPublishedPostToN8n({ post, media, brandName }) {
  const webhookUrl = await getN8nWebhookUrl();
  if (!webhookUrl) {
    return {
      success: false,
      code: "N8N_WEBHOOK_NOT_CONFIGURED",
      error: "n8n webhook URL is not configured.",
    };
  }

  let payload = null;
  if (post.jsonPayload) {
    try {
      payload =
        typeof post.jsonPayload === "string"
          ? JSON.parse(post.jsonPayload)
          : post.jsonPayload;
    } catch {
      // corrupt — fall through to rebuild
    }
  }

  // Send the exact stored payload. Rebuild only when it is missing or corrupt.
  if (!payload || typeof payload !== "object") {
    payload = buildN8nPayload({ ...post }, media || [], brandName);
  }

  if (!payload) {
    return { success: false, error: "Failed to build payload." };
  }

  // Always set the authoritative brand name, even when the stored payload
  // predates this field. Never trust a client-submitted brand value.
  if (!brandName) {
    return { success: false, error: "Brand name is required for n8n payload." };
  }
  payload.brand = brandName;

  // Adapt to the legacy n8n contract at the webhook boundary (LinkedIn only).
  payload = adaptPublishedPostPayloadForN8n(payload);


  console.log("[PublishedPosts] auto sending n8n payload", {
    postId: post.id,
    mediaCount: payload.media_count,
    hasFiles: Array.isArray(payload.files),
    webhookConfigured: true,
  });

  // Normalize relative media URLs if PUBLIC_APP_URL is set
  const publicAppUrl = process.env.PUBLIC_APP_URL;
  if (publicAppUrl) {
    const normalizeUrl = (url) => {
      if (typeof url !== "string" || url.startsWith("http")) return url;
      return `${publicAppUrl}${url}`;
    };
    if (Array.isArray(payload.files)) {
      payload.files = payload.files.map((f) => ({
        ...f,
        image_url: f.image_url ? normalizeUrl(f.image_url) : null,
        video_url: f.video_url ? normalizeUrl(f.video_url) : null,
      }));
    }
    if (Array.isArray(payload.media)) {
      payload.media = payload.media.map((m) => ({
        ...m,
        url: normalizeUrl(m.url),
      }));
    }
    payload.video_url = payload.video_url ? normalizeUrl(payload.video_url) : "";
    payload.thumbnail_url = payload.thumbnail_url ? normalizeUrl(payload.thumbnail_url) : "";
  } else {
    console.log("[PublishedPosts] PUBLIC_APP_URL missing; sending relative media URLs");
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let n8nResponse;
    try {
      n8nResponse = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!n8nResponse.ok) {
      console.error("[PublishedPosts] auto n8n send failed", {
        status: n8nResponse.status,
      });
      return {
        success: false,
        code: "N8N_WEBHOOK_FAILED",
        webhookStatus: n8nResponse.status,
        error: "The post was saved, but it could not be sent to n8n.",
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
