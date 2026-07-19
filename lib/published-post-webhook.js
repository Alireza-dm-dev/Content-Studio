import { buildN8nPayload } from "@/lib/published-post-utils";

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

export async function sendPublishedPostToN8n({ post, media }) {
  const webhookUrl = process.env.N8N_PUBLISHED_POST_WEBHOOK_URL;
  if (!webhookUrl) {
    return { success: false, error: "n8n webhook URL is not configured." };
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
    payload = buildN8nPayload({ ...post }, media || []);
  }

  if (!payload) {
    return { success: false, error: "Failed to build payload." };
  }

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
    const n8nResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!n8nResponse.ok) {
      const text = await n8nResponse.text();
      console.error("[PublishedPosts] auto n8n send failed", {
        status: n8nResponse.status,
        details: text.slice(0, 500),
      });
      return {
        success: false,
        webhookStatus: n8nResponse.status,
        error: "n8n webhook rejected the payload.",
        details: text ? text.slice(0, 1000) : null,
      };
    }

    return {
      success: true,
      sentAt: new Date().toISOString(),
      webhookStatus: n8nResponse.status,
      payload,
    };
  } catch (error) {
    console.error("[PublishedPosts] auto n8n send failed", error);
    return {
      success: false,
      error: "Failed to send to n8n webhook.",
    };
  }
}
