import { readdir, unlink } from "fs/promises";
import path from "path";
import { formatScheduledDateInTz } from "@/lib/timezone";

const VALID_POST_TYPES = new Set(["static", "carousel", "reel"]);

export const POST_TYPE_STATIC = "static";
export const POST_TYPE_CAROUSEL = "carousel";
export const POST_TYPE_REEL = "reel";

export const STATUS_DRAFT = "draft";
export const STATUS_PUBLISHED = "published";
export const STATUS_ARCHIVED = "archived";

const VALID_STATUSES = new Set([STATUS_DRAFT, STATUS_PUBLISHED, STATUS_ARCHIVED]);

export function isValidPostType(type) {
  return VALID_POST_TYPES.has(type);
}

export function isValidStatus(status) {
  return VALID_STATUSES.has(status);
}

export function normalizePostType(type) {
  if (!type) return null;
  const lower = type.toLowerCase().trim();
  if (lower === "video") return POST_TYPE_REEL;
  if (VALID_POST_TYPES.has(lower)) return lower;
  return null;
}

export function formatPostId(postNumber) {
  if (postNumber == null) return null;
  return `POST-${String(postNumber).padStart(4, "0")}`;
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo", "video/mpeg"]);

export function getMediaTypeFromMime(fileType) {
  if (!fileType) return null;
  const lower = fileType.toLowerCase();
  if (IMAGE_TYPES.has(lower)) return "IMAGE";
  if (VIDEO_TYPES.has(lower)) return "VIDEO";
  return null;
}

export function extractHashtags(text) {
  if (!text) return "";
  const matches = text.match(/#[\w\u0600-\u06FF\u0400-\u04FF]+/g);
  return matches ? matches.join(" ") : "";
}

export function mapN8nPostType(postType) {
  if (!postType) return "single_image";
  const lower = postType.toLowerCase().trim();
  if (lower === "static") return "single_image";
  if (lower === "carousel") return "carousel";
  if (lower === "reel" || lower === "video" || lower === "reels") return "reels";
  return "single_image";
}

// LinkedIn posts are represented as a LinkedIn PDF carousel in the n8n payload.
// The JSON "Platform" value must be exactly "Linkedin" (capital L, lowercase
// inkedin) while the internal app/database value remains "LinkedIn".
export function mapN8nPlatform(platform) {
  if (platform === "LinkedIn") return "Linkedin";
  return "Instagram";
}

// Canonical internal/database platform normalizer.
// "LinkedIn" / "Linkedin" / "linkedin" / "LINKEDIN" -> "LinkedIn"
// "Instagram" and casing variants -> "Instagram"
// Anything else -> null (caller should reject).
export function normalizePublishedPostPlatform(value) {
  const normalized = String(value || "").trim().toLowerCase();

  if (!normalized || normalized === "instagram") {
    return "Instagram";
  }

  if (normalized === "linkedin") {
    return "LinkedIn";
  }

  return null;
}

export function safeParseJson(value) {
  if (value == null) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function isPublicUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url.trim());
}

// Build a media array whose URLs are the public (remote) URLs already stored in
// the post's jsonPayload, falling back to the Prisma media URL only when no
// valid public URL exists. This prevents PATCH metadata edits from replacing
// remote SFTP URLs with local /uploads paths.
export function buildRemoteAwareMedia(existingMedia, existingPayload) {
  const payloadMedia = Array.isArray(existingPayload?.media)
    ? existingPayload.media
    : [];
  const payloadFiles = Array.isArray(existingPayload?.files)
    ? existingPayload.files
    : [];

  const mediaByOrder = {};
  for (const m of payloadMedia) {
    if (m && typeof m.order === "number") mediaByOrder[m.order] = m;
  }

  return (existingMedia || []).map((m, idx) => {
    let url = m.url;

    // Preferred: stored payload media[] matched by order.
    const storedMedia = mediaByOrder[m.order];
    if (storedMedia && isPublicUrl(storedMedia.url)) {
      url = storedMedia.url;
    } else {
      // Fallback: stored payload files[] by position.
      const fileEntry = payloadFiles[idx];
      if (fileEntry) {
        const fileUrl =
          m.mediaType === "VIDEO"
            ? fileEntry.video_url
            : m.mediaType === "document"
            ? fileEntry.document_url
            : fileEntry.image_url;
        if (isPublicUrl(fileUrl)) url = fileUrl;
      }
    }

    return { ...m, url };
  });
}

function formatWebhookSentAt(date) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const y = date.getFullYear();
  const m = months[date.getMonth()];
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

export function buildN8nPayload(post, media, brandName) {
  if (!post) return null;

  const orderedMedia = (media || []).sort((a, b) => a.order - b.order);
  const mediaCount = orderedMedia.length;
  const isCarousel =
    post.postType === POST_TYPE_CAROUSEL || mediaCount > 1;
  const firstVideo = orderedMedia.find((m) => m.mediaType === "VIDEO");

  // Format scheduled date if present (always in America/Vancouver)
  let scheduledDateStr = "";
  if (post.scheduledDate) {
    scheduledDateStr = formatScheduledDateInTz(post.scheduledDate);
  }

  // Preserve existing webhook metadata when provided (e.g. during PATCH),
  // otherwise generate sensible defaults. The formatter uses one consistent
  // format so newly created values never corrupt existing stored ones.
  const now = new Date();
  const webhookSentAt =
    post.webhookSentAt != null ? post.webhookSentAt : formatWebhookSentAt(now);
  const errorLog = post.errorLog != null ? post.errorLog : "";
  const payloadData = post.payloadData != null ? post.payloadData : "";
  const payloadOutput = post.payloadOutput != null ? post.payloadOutput : "";
  const fromSmartcc = post.fromSmartcc != null ? post.fromSmartcc : false;

  const postId = formatPostId(post.postNumber) || post.id;

  const platform = post.platform || "Instagram";
  const isLinkedIn = platform === "LinkedIn";
  const n8nPostType = mapN8nPostType(post.postType);

  // Canonical LinkedIn PDF carousel payload: a single document entry using
  // document_url (no image_url, no media_url). Instagram keeps its own contract.
  const files = orderedMedia.map((m) => {
    if (isLinkedIn && m.mediaType === "document") {
      return { media_type: "document", document_url: m.url };
    }
    const entry = { media_type: m.mediaType };
    if (m.mediaType === "IMAGE") {
      entry.image_url = m.url;
    } else if (m.mediaType === "VIDEO") {
      entry.video_url = m.url;
    } else if (m.mediaType === "document") {
      entry.document_url = m.url;
    } else {
      entry.video_url = m.url;
    }
    return entry;
  });

  const mediaList = orderedMedia.map((m) => ({
    order: m.order,
    url: m.url,
    media_type: isLinkedIn && m.mediaType === "document" ? "document" : m.mediaType,
  }));

  // media_url follows the Instagram contract: reels omit it, carousels/static
  // include it. LinkedIn stores a canonical document payload and must NOT
  // include media_url — the legacy image_url/media_url shape is only ever
  // produced by the webhook-boundary adapter in lib/published-post-webhook.js.
  const includeMediaUrl = !isLinkedIn && n8nPostType !== "reels";
  let mediaUrl = "";
  if (includeMediaUrl) {
    mediaUrl = orderedMedia[0] ? orderedMedia[0].url : "";
  }

  return {
    brand: brandName || "",
    row_number: post.postNumber || 0,
    "Post ID": postId,
    Platform: isLinkedIn ? "LinkedIn" : mapN8nPlatform(post.platform),
    "Post Type": n8nPostType,
    "Scheduled Date": scheduledDateStr,
    Caption: post.caption || "",
    Hashtags: extractHashtags(post.caption),
    "Account / Profile": "",
    Status: post.status || "draft",
    "Webhook Sent At": webhookSentAt,
    "Error Log": errorLog,
    Notes: post.notes || "",
    data: payloadData,
    output: payloadOutput,
    from_smartcc: fromSmartcc,
    ...(includeMediaUrl ? { media_url: mediaUrl } : {}),
    files,
    media: mediaList,
    media_count: mediaCount,
    is_carousel: isCarousel,
    video_url: firstVideo ? firstVideo.url : "",
    thumbnail_url: post.thumbnailUrl || "",
  };
}

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

export { MAX_FILE_SIZE, IMAGE_TYPES, VIDEO_TYPES };

export async function deletePublishedPostFiles(postId, brandId) {
  const uploadDir = path.join(
    process.cwd(),
    "public",
    "uploads",
    brandId,
    "published-posts",
    postId,
  );

  try {
    const entries = await readdir(uploadDir, { withFileTypes: true });
    for (const entry of entries) {
      try {
        await unlink(path.join(uploadDir, entry.name));
      } catch {}
    }
    try {
      await unlink(uploadDir);
    } catch {}
  } catch {
    // Directory does not exist — nothing to clean up
  }
}
