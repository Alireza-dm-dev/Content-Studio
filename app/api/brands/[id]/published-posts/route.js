import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import {
  isValidStatus,
  normalizePostType,
  getMediaTypeFromMime,
  buildN8nPayload,
  deletePublishedPostFiles,
  normalizePublishedPostPlatform,
  MAX_FILE_SIZE,
  POST_TYPE_STATIC,
  POST_TYPE_CAROUSEL,
  POST_TYPE_REEL,
} from "@/lib/published-post-utils";
import { sendPublishedPostToN8n } from "@/lib/published-post-webhook";
import { uploadPublishedPostMedia } from "@/lib/published-post-remote-media";
import { normalizeScheduledDate } from "@/lib/timezone";

const MAX_POSTS_PER_BRAND = 21;

export async function GET(request, { params }) {
  const { id } = await params;

  const brand = await prisma.brand.findUnique({ where: { id } });
  if (!brand) {
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }

  const where = { brandId: id };
  try {
    const platformParam = new URL(request.url).searchParams.get("platform");
    if (platformParam) {
      const normalized = normalizePublishedPostPlatform(platformParam);
      if (normalized) {
        where.platform = normalized;
      }
    }
  } catch {
    // ignore malformed URL; fall back to returning all posts
  }

  const posts = await prisma.publishedPost.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      media: { orderBy: { order: "asc" } },
      _count: { select: { comments: true } },
    },
  });

  const serialized = posts.map((p) => {
    const { _count, ...rest } = p;
    return { ...rest, commentCount: _count?.comments ?? 0 };
  });

  return NextResponse.json(serialized);
}

async function enforcePublishedPostsLimit(brandId) {
  try {
    const posts = await prisma.publishedPost.findMany({
      where: { brandId, platform: "Instagram" },
      orderBy: { createdAt: "desc" },
      include: { media: true },
    });

    if (posts.length <= MAX_POSTS_PER_BRAND) return;

    const toDelete = posts.slice(MAX_POSTS_PER_BRAND);
    for (const post of toDelete) {
      try {
        await prisma.publishedPost.delete({ where: { id: post.id } });
        await deletePublishedPostFiles(post.id, brandId);
      } catch (err) {
        console.error("[PublishedPosts] cleanup failed for post", post.id, err.message);
      }
    }
    console.log(`[PublishedPosts] cleaned up ${toDelete.length} old posts for brand ${brandId}`);
  } catch (err) {
    console.error("[PublishedPosts] enforce limit failed", err.message);
  }
}

export async function POST(request, { params }) {
  try {
    const { id } = await params;

    const brand = await prisma.brand.findUnique({ where: { id } });
    if (!brand) {
      return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    }

    let formData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    }

// ── Read fields ──────────────────────────────────────────────────────────────
  const rawFiles = formData.getAll("files") || formData.getAll("file") || [];
  const rawPostType = formData.get("postType") || formData.get("post_type") || "";
  const caption = formData.get("caption") || "";
  const rawPlatform = formData.get("platform");

  // Canonical internal platform: "LinkedIn" (never "Linkedin").
  const platform = normalizePublishedPostPlatform(rawPlatform);
  if (!platform) {
    return NextResponse.json(
      { error: "Unsupported platform. Must be Instagram or LinkedIn." },
      { status: 400 }
    );
  }
  
  const rawScheduledDate = formData.get("scheduledDate") || formData.get("scheduled_date") || "";
  const notes = formData.get("notes") || "";
  const rawStatus = formData.get("status") || "draft";
  const thumbnailFile = formData.get("thumbnail");
  
  const mediaFiles = rawFiles.filter((f) => f && typeof f !== "string");
  if (mediaFiles.length === 0) {
    return NextResponse.json({ error: "At least one media file is required" }, { status: 400 });
  }

  const postType = normalizePostType(rawPostType);
  if (!postType) {
    return NextResponse.json({
      error: "Invalid postType. Must be one of: static, carousel, reel (or video mapped to reel)",
    }, { status: 400 });
  }

  const status = isValidStatus(rawStatus) ? rawStatus : "draft";

  let scheduledDate = null;
  if (rawScheduledDate) {
    const date = normalizeScheduledDate(rawScheduledDate);
    if (!date) {
      return NextResponse.json(
        { error: "Invalid scheduled date." },
        { status: 400 },
      );
    }
    scheduledDate = date;
  }

  // ── Platform + postType specific validation ──────────────────────────────────
  if (platform === "LinkedIn") {
    // LinkedIn posts always use exactly one media file.
    if (mediaFiles.length !== 1) {
      if (postType === POST_TYPE_CAROUSEL) {
        return NextResponse.json(
          { error: "LinkedIn carousel posts require exactly one PDF file." },
          { status: 400 },
        );
      }
      if (postType === POST_TYPE_REEL) {
        return NextResponse.json(
          { error: "LinkedIn video posts require exactly one video file." },
          { status: 400 },
        );
      }
      return NextResponse.json(
        { error: "LinkedIn single-image posts require exactly one image file." },
        { status: 400 },
      );
    }

    const single = mediaFiles[0];
    const singleMime = single.type;
    const singleExt = path.extname(single.name).toLowerCase();

    if (postType === POST_TYPE_CAROUSEL) {
      const isPdf =
        singleMime === "application/pdf" ||
        singleMime.startsWith("application/pdf") ||
        singleExt === ".pdf";
      if (!isPdf) {
        return NextResponse.json(
          { error: "LinkedIn carousel file must be a PDF." },
          { status: 400 },
        );
      }
    } else if (postType === POST_TYPE_REEL) {
      if (getMediaTypeFromMime(singleMime) !== "VIDEO") {
        return NextResponse.json(
          { error: "LinkedIn video post file must be a supported video." },
          { status: 400 },
        );
      }
    } else if (postType === POST_TYPE_STATIC) {
      if (getMediaTypeFromMime(singleMime) !== "IMAGE") {
        return NextResponse.json(
          {
            error:
              "LinkedIn single-image file must be a JPEG, PNG, or WebP image.",
          },
          { status: 400 },
        );
      }
    }

    if (single.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File exceeds 100 MB limit." },
        { status: 413 },
      );
    }
  }

  // For Instagram static, accept first file only (older clients may send more).
  if (
    platform === "Instagram" &&
    postType === POST_TYPE_STATIC &&
    mediaFiles.length > 1
  ) {
    mediaFiles.splice(1);
  }

  // ── Validate file types ──────────────────────────────────────────────────────
  const validatedMedia = [];
  for (const file of mediaFiles) {
    const rawType = file.type;
    let mediaType = getMediaTypeFromMime(rawType);
    let isPDFDocument = false;

    if (platform === "LinkedIn" && postType === POST_TYPE_CAROUSEL) {
      const ext = path.extname(file.name).toLowerCase();
      if (
        (rawType === "application/pdf" || rawType.startsWith("application/pdf")) &&
        ext === ".pdf"
      ) {
        mediaType = "document";
        isPDFDocument = true;
      }
    }

    if (!mediaType && !isPDFDocument) {
      return NextResponse.json({
        error: `Unsupported file type: ${rawType}. Only images, videos, and LinkedIn PDF documents are allowed.`,
      }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({
        error: "File exceeds 100 MB limit.",
      }, { status: 413 });
    }
    validatedMedia.push({ file, mediaType, isPDFDocument });
  }

  // If carousel was auto-detected via normalize but we only have one file, stay as-is
  // If static but user sent multiple, already truncated above

  // ── Compute next postNumber ──────────────────────────────────────────────────
  const lastPost = await prisma.publishedPost.findFirst({
    where: { brandId: id },
    orderBy: { postNumber: "desc" },
    select: { postNumber: true },
  });
  const nextPostNumber = (lastPost?.postNumber ?? 0) + 1;

  // ── Create post + media in transaction ───────────────────────────────────────
  const result = await prisma.$transaction(async (tx) => {
    const post = await tx.publishedPost.create({
      data: {
        brandId: id,
        postType,
        caption: caption || null,
        platform,
        status,
        scheduledDate,
        notes: notes || null,
        postNumber: nextPostNumber,
      },
    });

    // Create upload directory
    const uploadDir = path.join(
      process.cwd(), "public", "uploads", id, "published-posts", post.id,
    );

    // Save each media file
    const mediaRecords = [];
    for (let i = 0; i < validatedMedia.length; i++) {
      const { file, mediaType } = validatedMedia[i];
      const ext = path.extname(file.name) || "";
      const safeBase = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.[^.]*$/, "") || "media";
      const fileName = `${Date.now()}-${i}-${safeBase}${ext}`;
      const absPath = path.join(uploadDir, fileName);

      await mkdir(uploadDir, { recursive: true });
      const bytes = await file.arrayBuffer();
      await writeFile(absPath, Buffer.from(bytes));

      const url = `/uploads/${id}/published-posts/${post.id}/${fileName}`;
      const rec = await tx.publishedPostMedia.create({
        data: {
          publishedPostId: post.id,
          url,
          mediaType,
          order: i + 1,
          fileType: file.type,
          fileName: file.name,
        },
      });
      mediaRecords.push(rec);
    }

    // Save thumbnail if provided
    let thumbnailUrl = null;
    if (thumbnailFile && typeof thumbnailFile !== "string") {
      const thumbMediaType = getMediaTypeFromMime(thumbnailFile.type);
      if (thumbMediaType === "IMAGE") {
        if (thumbnailFile.size > MAX_FILE_SIZE) {
          // Thumbnail too large — skip, don't fail
          console.warn(`[PublishedPost] Thumbnail exceeds limit, skipping.`);
        } else {
          const thumbExt = path.extname(thumbnailFile.name) || ".jpg";
          const thumbName = `thumbnail${thumbExt}`;
          const thumbPath = path.join(uploadDir, thumbName);
          await mkdir(uploadDir, { recursive: true });
          const thumbBytes = await thumbnailFile.arrayBuffer();
          await writeFile(thumbPath, Buffer.from(thumbBytes));
          thumbnailUrl = `/uploads/${id}/published-posts/${post.id}/${thumbName}`;
        }
      }
    }

    // Build and save n8n payload
    const payload = buildN8nPayload(
      { ...post, thumbnailUrl },
      mediaRecords,
    );
    const payloadJson = payload ? JSON.stringify(payload, null, 2) : null;

    const updated = await tx.publishedPost.update({
      where: { id: post.id },
      data: {
        jsonPayload: payloadJson,
        thumbnailUrl,
      },
    });

    return { ...updated, media: mediaRecords };
  });

  // ── Remote media upload (best-effort) ──────────────────────────────────────
  let remoteResult;
  try {
    remoteResult = await uploadPublishedPostMedia({
      post: result,
      mediaRecords: result.media || [],
      brandId: id,
    });
  } catch (error) {
    remoteResult = {
      success: false,
      error: error.message || "Remote media upload failed.",
      code: error.code,
      details: error.message,
    };
    console.error("[PublishedPosts] remote media upload failed", {
      error: error.message,
      code: error.code,
    });
  }

  // Rebuild jsonPayload with remote URLs if remote upload succeeded
  if (remoteResult?.success) {
    try {
      const remoteUrlByOrder = {};
      for (const r of remoteResult.media) {
        remoteUrlByOrder[r.order] = r;
      }

      const updatedMedia = (result.media || []).map((m) => {
        const remote = remoteUrlByOrder[m.order];
        return remote
          ? { ...m, url: remote.fileUrl, remoteUrl: remote.fileUrl }
          : m;
      });

      const updatedThumbnailUrl = remoteResult.thumbnailUrl || result.thumbnailUrl;

      const remotePayload = buildN8nPayload(
        { ...result, thumbnailUrl: updatedThumbnailUrl },
        updatedMedia,
      );
      const remotePayloadJson = remotePayload
        ? JSON.stringify(remotePayload, null, 2)
        : null;

      if (remotePayloadJson) {
        await prisma.publishedPost.update({
          where: { id: result.id },
          data: {
            jsonPayload: remotePayloadJson,
            thumbnailUrl: updatedThumbnailUrl,
          },
        });
        result.jsonPayload = remotePayloadJson;
        result.thumbnailUrl = updatedThumbnailUrl;
      }
    } catch (error) {
      console.error("[PublishedPosts] failed to update payload with remote URLs", error);
    }
  }

  // ── Auto-send to n8n ────────────────────────────────────────────────────────
  let webhookResult = null;
  try {
    webhookResult = await sendPublishedPostToN8n({
      post: result,
      media: result.media || [],
    });
  } catch {
    webhookResult = { success: false, error: "Failed to send to n8n webhook." };
  }

  await enforcePublishedPostsLimit(id);

  return NextResponse.json({ ...result, webhookResult, remoteResult }, { status: 201 });
  } catch (error) {
    console.error("[PublishedPosts] upload failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 500 },
    );
  }
}
