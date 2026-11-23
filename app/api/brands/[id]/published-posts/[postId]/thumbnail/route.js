import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBrandAccess } from "@/lib/brand-access";
import { safeParseJson, serializePublishedPost } from "@/lib/published-post-utils";
import { uploadPublishedPostMedia } from "@/lib/published-post-remote-media";
import {
  validateThumbnailFile,
  saveThumbnailFile,
  removeThumbnailFiles,
} from "@/lib/published-post-thumbnail";
import {
  postTypeSupportsCover,
  COVER_NOT_SUPPORTED_CODE,
  COVER_NOT_SUPPORTED_MESSAGE,
} from "@/lib/published-post-cover";

export const dynamic = "force-dynamic";

// Thumbnail / cover image for an existing Instagram Published Post.
//   PUT    multipart "thumbnail" — add or replace (old file deleted after the DB update).
//                                  Reel / Video only; Static / Carousel → 400 COVER_NOT_SUPPORTED.
//   DELETE                       — remove the thumbnail only; media is never touched
//
// Same authorization as editing the post: brand access, and the post must
// belong to the brand in the URL. Changes are stored (DB column + stored n8n
// payload's existing thumbnail_url field) but not auto-sent to n8n; "Send to
// n8n" or the next edit carries them, exactly like other stored payload data.

function fail(error, status, code) {
  return NextResponse.json({ success: false, error, ...(code ? { code } : {}) }, { status });
}

async function loadPost(request, params) {
  const { id, postId } = await params;
  const access = await requireBrandAccess(id);
  if (!access.ok) return { response: fail(access.error, access.status) };

  const post = await prisma.publishedPost.findFirst({
    where: { id: postId, brandId: id },
    include: { media: { orderBy: { order: "asc" } }, _count: { select: { comments: true } } },
  });
  if (!post) return { response: fail("Published post not found", 404) };
  if (post.platform !== "Instagram") {
    return { response: fail("Thumbnails can only be managed on Instagram posts here.", 400, "UNSUPPORTED_PLATFORM") };
  }
  return { id, postId, post };
}

function payloadWithThumbnail(post, thumbnailValue) {
  const payload = safeParseJson(post.jsonPayload);
  if (!payload || typeof payload !== "object") return post.jsonPayload;
  return JSON.stringify({ ...payload, thumbnail_url: thumbnailValue }, null, 2);
}

async function saveAndRespond(id, postId, data) {
  const updated = await prisma.publishedPost.update({
    where: { id: postId },
    data,
    include: { media: { orderBy: { order: "asc" } }, _count: { select: { comments: true } } },
  });
  return NextResponse.json({ success: true, post: serializePublishedPost(updated) });
}

export async function PUT(request, { params }) {
  const ctx = await loadPost(request, params);
  if (ctx.response) return ctx.response;
  const { id, postId, post } = ctx;

  // Only Reel / Video posts take a separate cover. DELETE stays allowed for any
  // type so a legacy cover on an old Static/Carousel row can still be cleared.
  if (!postTypeSupportsCover(post.postType)) {
    return fail(COVER_NOT_SUPPORTED_MESSAGE, 400, COVER_NOT_SUPPORTED_CODE);
  }

  let form;
  try { form = await request.formData(); } catch { return fail("Invalid multipart request", 400); }
  const v = await validateThumbnailFile(form.get("thumbnail") ?? form.get("file"));
  if (!v.ok) return fail(v.error, 400, "INVALID_THUMBNAIL");

  let localUrl;
  try {
    localUrl = await saveThumbnailFile(id, postId, v);
  } catch (err) {
    console.error("[PublishedPosts] thumbnail write failed", { postId, message: err?.message });
    return fail("Thumbnail upload failed. Please try again.", 500);
  }

  // Best-effort: publish the thumbnail on the public media server (thumbnail
  // only, no media re-upload), same as the create path. On failure the payload
  // keeps the local path, and "Send to n8n" re-uploads before sending.
  let remoteUrl = null;
  try {
    const remote = await uploadPublishedPostMedia({
      post: { ...post, thumbnailUrl: localUrl },
      mediaRecords: [],
      brandId: id,
    });
    if (remote?.success && remote.thumbnailUrl) remoteUrl = remote.thumbnailUrl;
  } catch (err) {
    console.warn("[PublishedPosts] thumbnail remote upload failed", { postId, message: err?.message });
  }

  try {
    const res = await saveAndRespond(id, postId, {
      thumbnailUrl: localUrl,
      jsonPayload: payloadWithThumbnail(post, remoteUrl || localUrl),
    });
    await removeThumbnailFiles(id, postId, { keepUrl: localUrl });
    return res;
  } catch (err) {
    await removeThumbnailFiles(id, postId, { onlyUrl: localUrl }).catch(() => {});
    console.error("[PublishedPosts] thumbnail update failed", { postId, message: err?.message });
    return fail("Thumbnail upload failed. Please try again.", 500);
  }
}

export async function DELETE(request, { params }) {
  const ctx = await loadPost(request, params);
  if (ctx.response) return ctx.response;
  const { id, postId, post } = ctx;

  try {
    const res = await saveAndRespond(id, postId, {
      thumbnailUrl: null,
      jsonPayload: payloadWithThumbnail(post, ""),
    });
    await removeThumbnailFiles(id, postId);
    return res;
  } catch (err) {
    console.error("[PublishedPosts] thumbnail remove failed", { postId, message: err?.message });
    return fail("Could not remove the thumbnail. Please try again.", 500);
  }
}
