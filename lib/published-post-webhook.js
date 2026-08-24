import { buildN8nPayload } from "@/lib/published-post-utils";
import { isCanonicalMediaUrl } from "@/lib/published-post-remote-media";
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

  function checkUrl(value, label) {
    if (!value) return null;
    if (typeof value !== "string" || !isCanonicalMediaUrl(value)) {
      return {
        success: false,
        code: "N8N_MEDIA_URL_NOT_PUBLIC",
        error: "The post was saved, but its media is not available at a public URL.",
      };
    }
    return null;
  }

  let err;

  err = checkUrl(payload.video_url, "video_url");
  if (err) return err;
  err = checkUrl(payload.thumbnail_url, "thumbnail_url");
  if (err) return err;
  if (payload.media_url) {
    err = checkUrl(payload.media_url, "media_url");
    if (err) return err;
  }

  if (Array.isArray(payload.files)) {
    for (let i = 0; i < payload.files.length; i++) {
      const f = payload.files[i];
      if (f.image_url) {
        err = checkUrl(f.image_url, `files[${i}].image_url`);
        if (err) return err;
      }
      if (f.video_url) {
        err = checkUrl(f.video_url, `files[${i}].video_url`);
        if (err) return err;
      }
      if (f.document_url) {
        err = checkUrl(f.document_url, `files[${i}].document_url`);
        if (err) return err;
      }
    }
  }

  if (Array.isArray(payload.media)) {
    for (let i = 0; i < payload.media.length; i++) {
      err = checkUrl(payload.media[i].url, `media[${i}].url`);
      if (err) return err;
    }
  }

  return null;
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

  // Payload construction is distinct from the network send below — give it
  // its own error code so a construction bug (e.g. an unexpected media shape)
  // is never indistinguishable from a network/timeout/non-2xx failure. Without
  // this, a thrown error here would previously escape uncaught to each call
  // site's own generic catch block, losing the distinction entirely.
  try {
    // Send the exact stored payload. Rebuild only when it is missing or corrupt.
    if (!payload || typeof payload !== "object") {
      payload = buildN8nPayload({ ...post }, media || [], brandName);
    }

    if (!payload) {
      return { success: false, code: "N8N_PAYLOAD_BUILD_FAILED", error: "Failed to build payload." };
    }

    // Always set the authoritative brand name, even when the stored payload
    // predates this field. Never trust a client-submitted brand value.
    if (!brandName) {
      return { success: false, code: "N8N_PAYLOAD_BUILD_FAILED", error: "Brand name is required for n8n payload." };
    }
    payload.brand = brandName;

    // Adapt to the legacy n8n contract at the webhook boundary (LinkedIn only).
    payload = adaptPublishedPostPayloadForN8n(payload);
  } catch (buildError) {
    console.error("[PublishedPosts] n8n payload construction failed", buildError);
    return {
      success: false,
      code: "N8N_PAYLOAD_BUILD_FAILED",
      error: "The post was saved, but its data could not be prepared for sending to n8n.",
    };
  }


  console.log("[PublishedPosts] auto sending n8n payload", {
    postId: post.id,
    mediaCount: payload.media_count,
    hasFiles: Array.isArray(payload.files),
    webhookConfigured: true,
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
