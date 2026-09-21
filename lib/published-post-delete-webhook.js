/**
 * External deletion webhook for published posts (n8n).
 *
 * When a published Instagram or LinkedIn post is deleted in Content Studio,
 * the real post on the social network has to be deleted too. n8n owns that
 * side, so the delete route calls this module BEFORE removing the local row —
 * the row (and its stored jsonPayload) carries the only identifiers n8n has
 * for matching the external post, so deleting locally first would lose them.
 *
 * Configuration mirrors lib/published-post-webhook.js: the Settings table wins,
 * then the environment. There is deliberately NO hardcoded fallback — the
 * production URL is environment-specific and must never live in source. When
 * nothing is configured, deletion of an Instagram/LinkedIn post fails safely
 * and the local row is kept. Never call this from client code — the URL is
 * server-side only.
 */

import { prisma } from "@/lib/prisma";
import {
  buildN8nPayload,
  formatPostId,
  safeParseJson,
} from "@/lib/published-post-utils";

export const PUBLISHED_POST_DELETE_EVENT = "published_post.delete";

// n8n has no published idempotency protocol of its own, so we send a
// deterministic key the workflow can de-duplicate on: a retry after a lost
// response carries the exact same value as the call that was lost.
export function buildDeleteEventId(postId) {
  return `published-post-delete:${postId}`;
}

const SETTINGS_KEY = "N8N_PUBLISHED_POST_DELETE_WEBHOOK_URL";

export const DELETE_WEBHOOK_TIMEOUT_MS = 30000;

// Which source getPublishedPostDeleteWebhookUrl() last resolved the URL from.
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

/**
 * Platforms whose deletion must be mirrored externally.
 *
 * Deliberately stricter than normalizePublishedPostPlatform(), which treats an
 * empty/missing platform as "Instagram". Gating a destructive external call on
 * a default would fire the webhook for records that never named a platform, so
 * only an explicit, recognised value counts here.
 */
export function normalizeDeleteWebhookPlatform(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[\s_-]/g, "");
  if (normalized === "instagram") return "Instagram";
  if (normalized === "linkedin") return "LinkedIn";
  return null;
}

export function requiresExternalDeleteWebhook(platform) {
  return normalizeDeleteWebhookPlatform(platform) !== null;
}

export async function getPublishedPostDeleteWebhookUrl() {
  try {
    const setting = await prisma.settings.findUnique({
      where: { key: SETTINGS_KEY },
    });
    if (setting?.value) {
      const valid = validateWebhookUrl(setting.value);
      if (valid) {
        lastWebhookUrlSource = "Settings table";
        return valid;
      }
      console.warn(
        "[PublishedPostDelete] delete webhook URL in Settings is invalid, ignoring it",
      );
    }
  } catch {
    // DB unavailable — fall through to env var
  }

  const fromEnv = process.env.N8N_PUBLISHED_POST_DELETE_WEBHOOK_URL;
  if (fromEnv) {
    const valid = validateWebhookUrl(fromEnv);
    if (valid) {
      lastWebhookUrlSource = "N8N_PUBLISHED_POST_DELETE_WEBHOOK_URL env var";
      return valid;
    }
    console.warn(
      "[PublishedPostDelete] delete webhook URL in the environment is invalid, ignoring it",
    );
  }

  lastWebhookUrlSource = "none";
  return null;
}

/**
 * The delete payload.
 *
 * Top level carries what n8n needs to route the event; `post` carries the exact
 * publish payload this post was last sent with (stored jsonPayload preferred,
 * rebuilt only when missing or corrupt), because those public media URLs and
 * the "Post ID" are the identifiers n8n matched the external post on.
 *
 * The model has no externalPostId/permalink column, so no such field is
 * invented here.
 */
export function buildPublishedPostDeletePayload({ post, media, brand, user }) {
  if (!post) return null;

  const platform = normalizeDeleteWebhookPlatform(post.platform);
  const brandName = brand?.name || "";

  let publishPayload = safeParseJson(post.jsonPayload);
  if (!publishPayload || typeof publishPayload !== "object") {
    publishPayload = buildN8nPayload({ ...post }, media || [], brandName);
  }
  if (publishPayload && typeof publishPayload === "object") {
    publishPayload = { ...publishPayload, brand: brandName };
  }

  return {
    event: PUBLISHED_POST_DELETE_EVENT,
    action: "delete",
    eventId: buildDeleteEventId(post.id),
    requestedAt: new Date().toISOString(),
    postId: post.id,
    postRef: formatPostId(post.postNumber) || post.id,
    row_number: post.postNumber || 0,
    platform,
    Platform: platform,
    brandId: post.brandId,
    brandName,
    brand: brandName,
    postType: post.postType || null,
    status: post.status || null,
    scheduledDate: post.scheduledDate
      ? new Date(post.scheduledDate).toISOString()
      : null,
    createdAt: post.createdAt ? new Date(post.createdAt).toISOString() : null,
    deletedBy: user ? { userId: user.id, role: user.role || null } : null,
    post: publishPayload || null,
  };
}

/**
 * POST the delete event to n8n.
 *
 * Returns { success: true } only when n8n answered 2xx and its body did not
 * explicitly report a failure. Every other outcome — timeout, network error,
 * non-2xx, failure body — returns success: false with a distinguishing code so
 * the caller can refuse to delete the local row.
 */
export async function sendPublishedPostDeleteToN8n({ post, media, brand, user }) {
  const platform = normalizeDeleteWebhookPlatform(post?.platform);
  if (!platform) {
    return {
      success: false,
      code: "DELETE_WEBHOOK_NOT_APPLICABLE",
      error: "This platform does not use the external deletion webhook.",
    };
  }

  const webhookUrl = await getPublishedPostDeleteWebhookUrl();
  if (!webhookUrl) {
    console.error("[PublishedPostDelete] no delete webhook URL configured", {
      postId: post?.id,
      source: lastWebhookUrlSource,
    });
    return {
      success: false,
      code: "DELETE_WEBHOOK_NOT_CONFIGURED",
      error: "Published-post delete webhook is not configured.",
    };
  }

  let payload;
  try {
    payload = buildPublishedPostDeletePayload({ post, media, brand, user });
    if (!payload) throw new Error("payload is null");
  } catch (buildError) {
    console.error("[PublishedPostDelete] payload construction failed", buildError);
    return {
      success: false,
      code: "DELETE_WEBHOOK_PAYLOAD_BUILD_FAILED",
      error: "The deletion request could not be prepared.",
    };
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELETE_WEBHOOK_TIMEOUT_MS);

  let response;
  try {
    try {
      response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": payload.eventId,
          "X-Event-Id": payload.eventId,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    if (error && typeof error === "object" && error.name === "AbortError") {
      console.error("[PublishedPostDelete] delete webhook timed out", {
        postId: post.id,
        platform,
        durationMs,
      });
      return {
        success: false,
        code: "DELETE_WEBHOOK_TIMEOUT",
        durationMs,
        error: `Could not delete the published ${platform} post. The external deletion service did not respond in time.`,
      };
    }
    console.error("[PublishedPostDelete] delete webhook network error", {
      postId: post.id,
      platform,
      durationMs,
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      code: "DELETE_WEBHOOK_NETWORK_ERROR",
      durationMs,
      error: `Could not delete the published ${platform} post. The external deletion service could not be reached.`,
    };
  }

  const durationMs = Date.now() - startedAt;
  let bodyText = "";
  try {
    bodyText = (await response.text()).slice(0, 1000);
  } catch {
    bodyText = "";
  }

  if (!response.ok) {
    console.error("[PublishedPostDelete] delete webhook rejected", {
      postId: post.id,
      platform,
      status: response.status,
      durationMs,
      responseBody: bodyText.slice(0, 200),
    });
    return {
      success: false,
      code: "DELETE_WEBHOOK_FAILED",
      webhookStatus: response.status,
      durationMs,
      error: `Could not delete the published ${platform} post. The external deletion service did not confirm success.`,
      details: `n8n responded ${response.status}`,
    };
  }

  // A 2xx body that explicitly reports failure is a failure. Anything else
  // (empty body, plain text, JSON without a failure marker) counts as success —
  // n8n workflows commonly answer 200 with no body.
  const parsed = safeParseJson(bodyText);
  const reportsFailure =
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    (parsed.success === false ||
      parsed.ok === false ||
      parsed.deleted === false ||
      typeof parsed.error === "string");

  if (reportsFailure) {
    console.error("[PublishedPostDelete] delete webhook reported failure", {
      postId: post.id,
      platform,
      status: response.status,
      durationMs,
    });
    return {
      success: false,
      code: "DELETE_WEBHOOK_REPORTED_FAILURE",
      webhookStatus: response.status,
      durationMs,
      error: `Could not delete the published ${platform} post. The external deletion service did not confirm success.`,
      details:
        typeof parsed.error === "string" ? parsed.error.slice(0, 200) : undefined,
    };
  }

  console.log("[PublishedPostDelete] delete webhook confirmed", {
    postId: post.id,
    platform,
    status: response.status,
    durationMs,
  });

  return {
    success: true,
    webhookStatus: response.status,
    durationMs,
    eventId: payload.eventId,
  };
}
