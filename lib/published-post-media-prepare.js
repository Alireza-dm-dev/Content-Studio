import { prisma } from "@/lib/prisma";
import { uploadPublishedPostMedia, isCanonicalMediaUrl } from "@/lib/published-post-remote-media";
import { buildN8nPayload } from "@/lib/published-post-utils";

// Public media preparation for an already SAVED post: upload whatever media
// is not yet on the public media server, persist the public URLs in the stored
// payload, and return the reloaded post. Shared by the manual production send
// (send-webhook) and the trial media recovery ("Upload Media & Run Trial").
// It never sends any webhook.
//
// Only media rows whose URL is not already a canonical public URL are
// uploaded. Rows created by the upload form always hold local /uploads paths,
// so for them this is exactly the previous behaviour (every row uploaded).
// Reused canonical rows (adaptation) are kept as they are and never uploaded
// again.

/** True when every media URL in the stored payload is already public. */
export function storedPayloadHasCanonicalUrls(post) {
  if (!post.jsonPayload) return false;
  try {
    const p = typeof post.jsonPayload === "string"
      ? JSON.parse(post.jsonPayload)
      : post.jsonPayload;
    if (p.video_url && !isCanonicalMediaUrl(p.video_url)) return false;
    if (p.thumbnail_url && !isCanonicalMediaUrl(p.thumbnail_url)) return false;
    if (Array.isArray(p.files)) {
      for (const f of p.files) {
        if (f.image_url && !isCanonicalMediaUrl(f.image_url)) return false;
        if (f.video_url && !isCanonicalMediaUrl(f.video_url)) return false;
        if (f.document_url && !isCanonicalMediaUrl(f.document_url)) return false;
      }
    }
    if (Array.isArray(p.media)) {
      for (const m of p.media) {
        if (!isCanonicalMediaUrl(m.url)) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export async function reloadPublishedPost(postId) {
  return prisma.publishedPost.findUnique({
    where: { id: postId },
    include: { media: { orderBy: { order: "asc" } } },
  });
}

function uploadFailure(remoteResult) {
  return {
    success: false,
    code: "REMOTE_MEDIA_UPLOAD_FAILED",
    error: "The post's media could not be uploaded to the public media server.",
    detailCode: remoteResult.detailCode || "SFTP_UPLOAD_FAILED",
    details: remoteResult.error || remoteResult.details || remoteResult.detailCode || null,
    ...(remoteResult.fileSize != null ? { fileSize: remoteResult.fileSize } : {}),
    ...(remoteResult.duration != null ? { duration: remoteResult.duration } : {}),
    skipped: Boolean(remoteResult.skipped),
  };
}

/**
 * Returns
 *   { ok: true, post, uploaded: false }   media already public (nothing uploaded)
 *   { ok: true, post, uploaded: true }    missing media uploaded + persisted
 *   { ok: false, failure }                upload failed (post unchanged)
 * `post` includes `media` (remote URLs mapped in when uploaded).
 */
export async function preparePublicMedia({ post, brand, brandId, logPrefix = "[PublishedPosts]" }) {
  if (storedPayloadHasCanonicalUrls(post)) return { ok: true, post, uploaded: false };

  const startedAt = Date.now();
  const pending = (post.media || []).filter((m) => !isCanonicalMediaUrl(m.url));
  let remoteResult;
  try {
    remoteResult = await uploadPublishedPostMedia({ post, mediaRecords: pending, brandId });
  } catch (error) {
    remoteResult = {
      success: false,
      detailCode: error?.detailCode || "SFTP_UPLOAD_FAILED",
      error: error?.message || "Remote media upload failed.",
    };
  }

  if (!remoteResult.success) {
    console.error(`${logPrefix} remote media upload failed`, {
      postId: post.id,
      detailCode: remoteResult.detailCode,
      error: remoteResult.error,
      skipped: remoteResult.skipped,
      localPath: remoteResult.localPath,
      durationMs: Date.now() - startedAt,
    });
    return { ok: false, failure: uploadFailure(remoteResult) };
  }

  // Verify media count match — do not persist a partial mapping
  if (remoteResult.media.length !== pending.length) {
    console.error(`${logPrefix} remote media count mismatch`, {
      detailCode: "SFTP_MEDIA_COUNT_MISMATCH",
      expected: pending.length,
      got: remoteResult.media.length,
    });
    return {
      ok: false,
      failure: {
        success: false,
        code: "REMOTE_MEDIA_UPLOAD_FAILED",
        error: "The post's media could not be uploaded to the public media server.",
        detailCode: "SFTP_MEDIA_COUNT_MISMATCH",
        details: `Remote media count mismatch: expected ${pending.length}, got ${remoteResult.media.length}`,
      },
    };
  }

  console.log(`${logPrefix} remote media upload succeeded`, {
    postId: post.id,
    uploaded: remoteResult.media.length,
    thumbnailUrl: remoteResult.thumbnailUrl || null,
    urls: remoteResult.media.map((m) => m.fileUrl),
    durationMs: Date.now() - startedAt,
  });

  const remoteUrlByOrder = {};
  for (const r of remoteResult.media) remoteUrlByOrder[r.order] = r;
  const withRemote = (rows) => (rows || []).map((m) => {
    const remote = remoteUrlByOrder[m.order];
    return remote ? { ...m, url: remote.fileUrl, remoteUrl: remote.fileUrl } : m;
  });

  const updatedThumbnail = remoteResult.thumbnailUrl || post.thumbnailUrl;

  // Reload post to get clean state before persisting remote URLs
  const fresh = await reloadPublishedPost(post.id);
  if (!fresh) return { ok: false, notFound: true };

  const remotePayload = buildN8nPayload(
    { ...fresh, thumbnailUrl: updatedThumbnail },
    withRemote(fresh.media),
    brand.name,
    brand.timezone,
  );
  const payloadJson = remotePayload ? JSON.stringify(remotePayload, null, 2) : null;
  if (payloadJson) {
    await prisma.publishedPost.update({
      where: { id: post.id },
      data: { jsonPayload: payloadJson, thumbnailUrl: updatedThumbnail },
    });
  }

  // Reload after persistence so the returned post matches DB
  const persisted = await reloadPublishedPost(post.id);
  const finalPost = persisted ? { ...persisted, media: withRemote(persisted.media) } : { ...fresh, media: withRemote(fresh.media) };
  return { ok: true, post: finalPost, uploaded: true };
}
