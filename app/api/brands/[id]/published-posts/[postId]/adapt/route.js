import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeFile, mkdir, rm } from "fs/promises";
import path from "path";
import { randomUUID } from "node:crypto";
import {
  isValidStatus,
  normalizePostType,
  getMediaTypeFromMime,
  buildN8nPayload,
  deletePublishedPostFiles,
  normalizePublishedPostPlatform,
  MAX_FILE_SIZE,
  extractHashtags,
} from "@/lib/published-post-utils";
import { sendPublishedPostToN8n } from "@/lib/published-post-webhook";
import { uploadPublishedPostMedia, isCanonicalMediaUrl } from "@/lib/published-post-remote-media";
import { normalizeScheduledDate } from "@/lib/timezone";

function isValidSourcePlatform(platform) {
  return platform === "Instagram" || platform === "LinkedIn";
}

function canReuseSourceMedia(sourceUrl) {
  return typeof sourceUrl === "string" && isCanonicalMediaUrl(sourceUrl);
}

export async function POST(request, { params }) {
  try {
    const { id, postId } = await params;

    // ── Authenticate ──────────────────────────────────────────────────────────
    const { getCurrentUser, assertBrandAccess } = await import("@/lib/auth");
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    const hasAccess = await assertBrandAccess(id);
    if (!hasAccess) {
      return NextResponse.json({ error: "Brand access denied." }, { status: 403 });
    }

    // ── Verify source post ────────────────────────────────────────────────────
    const sourcePost = await prisma.publishedPost.findFirst({
      where: { id: postId, brandId: id },
      include: { media: { orderBy: { order: "asc" } } },
    });

    if (!sourcePost) {
      return NextResponse.json({ error: "Source published post not found." }, { status: 404 });
    }

    if (!isValidSourcePlatform(sourcePost.platform)) {
      return NextResponse.json(
        { error: "Source post must be an Instagram or LinkedIn post." },
        { status: 400 },
      );
    }

    const brand = await prisma.brand.findUnique({ where: { id } });
    if (!brand) {
      return NextResponse.json({ error: "Brand not found." }, { status: 404 });
    }

    // ── Parse form data ──────────────────────────────────────────────────────
    let formData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
    }

    const rawTargetPlatform = formData.get("targetPlatform") || "";
    const targetPlatform = normalizePublishedPostPlatform(rawTargetPlatform);
    if (!targetPlatform) {
      return NextResponse.json(
        { error: "Unsupported target platform. Must be Instagram or LinkedIn." },
        { status: 400 },
      );
    }

    // Target platform must be opposite of source
    if (sourcePost.platform === targetPlatform) {
      return NextResponse.json(
        { error: "Target platform must be different from source platform." },
        { status: 400 },
      );
    }

    const rawTargetPostType = formData.get("targetPostType") || "";
    const targetPostType = normalizePostType(rawTargetPostType);
    if (!targetPostType) {
      return NextResponse.json(
        { error: "Invalid targetPostType. Must be static, carousel, or reel." },
        { status: 400 },
      );
    }

    const caption = formData.get("caption") || "";
    const rawHashtags = formData.get("hashtags") || "";
    const publishTitle = formData.get("publishTitle") || "";
    const documentTitle = formData.get("documentTitle") || "";
    const mediaStrategy = formData.get("mediaStrategy") || "reuse";
    const rawManifest = formData.get("orderedMediaManifest") || "[]";
    const rawScheduledDate = formData.get("scheduledDate") || "";
    const rawStatus = formData.get("status") || "draft";
    const files = formData.getAll("files") || [];
    const thumbnailFile = formData.get("thumbnail");
    const sendToN8nStr = formData.get("sendToN8n") || "false";

    const status = isValidStatus(rawStatus) ? rawStatus : "draft";
    const sendToN8n = sendToN8nStr === "true";

    let orderedManifest;
    try {
      orderedManifest = JSON.parse(rawManifest);
      if (!Array.isArray(orderedManifest)) throw new Error("not an array");
    } catch {
      return NextResponse.json(
        { error: "Invalid orderedMediaManifest: must be a JSON array." },
        { status: 400 },
      );
    }

    let scheduledDate = null;
    if (rawScheduledDate) {
      const date = normalizeScheduledDate(rawScheduledDate);
      if (!date) {
        return NextResponse.json({ error: "Invalid scheduled date." }, { status: 400 });
      }
      scheduledDate = date;
    }

    // ── Extract media files from form ────────────────────────────────────────
    const mediaFiles = (files || []).filter((f) => f && typeof f !== "string");

    // ── Build target media records from manifest ──────────────────────────────
    const builtMedia = [];
    let newFileIndex = 0;

    for (const item of orderedManifest) {
      if (item.action === "reuse") {
        if (!canReuseSourceMedia(item.sourceUrl)) {
          return NextResponse.json(
            { error: `Cannot reuse media URL: ${item.sourceUrl || "missing"}. Only canonical public URLs can be reused.` },
            { status: 400 },
          );
        }
        builtMedia.push({
          sourceUrl: item.sourceUrl,
          mediaType: item.mediaType,
          order: item.order,
          isReused: true,
        });
      } else if (item.action === "new") {
        const file = mediaFiles[newFileIndex];
        if (!file) {
          return NextResponse.json(
            { error: `Missing uploaded file for manifest item at order ${item.order}.` },
            { status: 400 },
          );
        }
        newFileIndex++;
        const rawType = file.type;
        let mediaType = item.mediaType;
        if (!mediaType) {
          mediaType = getMediaTypeFromMime(rawType);
        }
        if (!mediaType && item.mediaType === "document") {
          const ext = path.extname(file.name).toLowerCase();
          if (rawType === "application/pdf" || ext === ".pdf") {
            mediaType = "document";
          }
        }
        if (!mediaType) {
          return NextResponse.json(
            { error: `Unsupported file type for uploaded file: ${file.name}.` },
            { status: 400 },
          );
        }
        if (file.size > MAX_FILE_SIZE) {
          return NextResponse.json({ error: "File exceeds 100 MB limit." }, { status: 413 });
        }
        builtMedia.push({
          file,
          mediaType,
          order: item.order,
          isReused: false,
        });
      }
    }

    // ── Validate target platform compatibility ────────────────────────────────
    if (targetPlatform === "LinkedIn") {
      if (targetPostType === "carousel") {
        const allImages = builtMedia.every((m) => m.mediaType === "IMAGE");
        const isSinglePdf = builtMedia.length === 1 && builtMedia[0].mediaType === "document";
        if (!allImages && !isSinglePdf) {
          return NextResponse.json(
            { error: "LinkedIn carousel requires images or a single PDF document." },
            { status: 400 },
          );
        }
        if (isSinglePdf && !documentTitle) {
          return NextResponse.json(
            { error: "Document title is required for LinkedIn PDF posts." },
            { status: 400 },
          );
        }
      }
      if (targetPostType === "static") {
        if (builtMedia.length !== 1 || builtMedia[0].mediaType !== "IMAGE") {
          return NextResponse.json(
            { error: "LinkedIn single-image posts require exactly one image." },
            { status: 400 },
          );
        }
      }
      if (targetPostType === "reel") {
        if (builtMedia.length !== 1 || builtMedia[0].mediaType !== "VIDEO") {
          return NextResponse.json(
            { error: "LinkedIn video posts require exactly one video." },
            { status: 400 },
          );
        }
      }
    }

    if (targetPlatform === "Instagram") {
      if (targetPostType === "static") {
        if (builtMedia.length !== 1 || builtMedia[0].mediaType !== "IMAGE") {
          return NextResponse.json(
            { error: "Instagram Static posts require exactly one image." },
            { status: 400 },
          );
        }
      }
      if (targetPostType === "carousel") {
        if (builtMedia.length < 2) {
          return NextResponse.json(
            { error: "Instagram Carousel posts require at least two images." },
            { status: 400 },
          );
        }
        if (!builtMedia.every((m) => m.mediaType === "IMAGE")) {
          return NextResponse.json(
            { error: "Instagram Carousel posts require all items to be images." },
            { status: 400 },
          );
        }
      }
      if (targetPostType === "reel") {
        if (builtMedia.length !== 1 || builtMedia[0].mediaType !== "VIDEO") {
          return NextResponse.json(
            { error: "Instagram Reel posts require exactly one video." },
            { status: 400 },
          );
        }
      }
    }

    // ── Compute next postNumber ──────────────────────────────────────────────
    const lastPost = await prisma.publishedPost.findFirst({
      where: { brandId: id },
      orderBy: { postNumber: "desc" },
      select: { postNumber: true },
    });
    const nextPostNumber = (lastPost?.postNumber ?? 0) + 1;
    const newPostId = randomUUID();
    const uploadDir = path.join(process.cwd(), "public", "uploads", id, "published-posts", newPostId);

    // ── Process media: write new files, build media records ─────────────────
    const mediaRecordsData = [];
    let hasNewFiles = false;
    let thumbnailUrl = null;

    try {
      await mkdir(uploadDir, { recursive: true });

      for (const item of builtMedia) {
        if (item.isReused) {
          // Reuse canonical URL directly — no local file write needed
          mediaRecordsData.push({
            url: item.sourceUrl,
            mediaType: item.mediaType,
            order: item.order,
            fileType: null,
            fileName: item.sourceUrl.split("/").pop() || "media",
            isReused: true,
          });
        } else {
          hasNewFiles = true;
          const ext = path.extname(item.file.name) || "";
          const safeBase = item.file.name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.[^.]*$/, "") || "media";
          const fileName = `${Date.now()}-${item.order - 1}-${safeBase}${ext}`;
          const absPath = path.join(uploadDir, fileName);

          const bytes = await item.file.arrayBuffer();
          await writeFile(absPath, Buffer.from(bytes));

          mediaRecordsData.push({
            url: `/uploads/${id}/published-posts/${newPostId}/${fileName}`,
            mediaType: item.mediaType,
            order: item.order,
            fileType: item.file.type,
            fileName: item.file.name,
            isReused: false,
          });
        }
      }

      // Save thumbnail if provided
      if (thumbnailFile && typeof thumbnailFile !== "string") {
        const thumbMediaType = getMediaTypeFromMime(thumbnailFile.type);
        if (thumbMediaType === "IMAGE") {
          if (thumbnailFile.size <= MAX_FILE_SIZE) {
            const thumbExt = path.extname(thumbnailFile.name) || ".jpg";
            const thumbName = `thumbnail${thumbExt}`;
            const thumbPath = path.join(uploadDir, thumbName);
            const thumbBytes = await thumbnailFile.arrayBuffer();
            await writeFile(thumbPath, Buffer.from(thumbBytes));
            thumbnailUrl = `/uploads/${id}/published-posts/${newPostId}/${thumbName}`;
          }
        }
      }
    } catch (fileError) {
      await rm(uploadDir, { recursive: true, force: true }).catch(() => {});
      console.error("[AdaptPost] file write failed", fileError);
      return NextResponse.json({ error: "File upload failed. Please try again." }, { status: 500 });
    }

    // ── Build source metadata ────────────────────────────────────────────────
    const crossPlatformMeta = {
      _crossPlatformSource: {
        postId: sourcePost.id,
        platform: sourcePost.platform,
        adaptedAt: new Date().toISOString(),
      },
    };

    // ── Create new post + media in transaction ──────────────────────────────
    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        const newPost = await tx.publishedPost.create({
          data: {
            id: newPostId,
            brandId: id,
            postType: targetPostType,
            caption: caption || null,
            platform: targetPlatform,
            status,
            scheduledDate,
            postNumber: nextPostNumber,
            notes: publishTitle || null,
          },
        });

        const mediaRecords = [];
        for (const md of mediaRecordsData) {
          const rec = await tx.publishedPostMedia.create({
            data: {
              publishedPostId: newPost.id,
              url: md.url,
              mediaType: md.mediaType,
              order: md.order,
              fileType: md.fileType,
              fileName: md.fileName,
            },
          });
          mediaRecords.push(rec);
        }

        // Build initial payload with local URLs
        const payload = buildN8nPayload(
          { ...newPost, thumbnailUrl },
          mediaRecords,
          brand.name,
        );

        // Inject cross-platform source metadata into a private block
        let payloadObj = payload ? JSON.parse(JSON.stringify(payload)) : {};
        payloadObj._crossPlatformSource = crossPlatformMeta._crossPlatformSource;

        const payloadJson = payload ? JSON.stringify(payloadObj, null, 2) : null;

        const updated = await tx.publishedPost.update({
          where: { id: newPost.id },
          data: {
            jsonPayload: payloadJson,
            thumbnailUrl,
          },
        });

        return { ...updated, media: mediaRecords };
      });
    } catch (dbError) {
      await rm(uploadDir, { recursive: true, force: true }).catch(() => {});
      console.error("[AdaptPost] DB creation failed", dbError);
      return NextResponse.json({ error: "Failed to create adapted post." }, { status: 500 });
    }

    // ── Remote media upload (only for new files) ────────────────────────────
    // Only newly uploaded files need SFTP upload. Reused canonical media
    // records have no local file in the target directory — skip them.
    const reusedOrders = new Set(
      mediaRecordsData.filter((d) => d.isReused).map((d) => d.order)
    );
    const newMediaRecords = (result.media || []).filter(
      (m) => !reusedOrders.has(m.order)
    );

    let remoteResult = null;
    if (hasNewFiles) {
      try {
        remoteResult = await uploadPublishedPostMedia({
          post: result,
          mediaRecords: newMediaRecords,
          brandId: id,
        });
      } catch (error) {
        remoteResult = {
          success: false,
          detailCode: error.detailCode || "SFTP_UPLOAD_FAILED",
          error: error.message || "Remote media upload failed.",
        };
        console.error("[AdaptPost] remote media upload failed", {
          detailCode: remoteResult.detailCode,
          error: error.message,
        });
      }
    } else {
      remoteResult = { success: true, skipped: true };
    }

    // ── Rebuild payload with remote URLs if SFTP succeeded ──────────────────
    const remoteUploadSuccessful =
      remoteResult?.success &&
      remoteResult.media &&
      remoteResult.media.length === newMediaRecords.length;

    if (remoteUploadSuccessful) {
      try {
        const remoteUrlByOrder = {};
        for (const r of remoteResult.media) {
          remoteUrlByOrder[r.order] = r;
        }

        const updatedThumbnailUrl = remoteResult.thumbnailUrl || result.thumbnailUrl;

        const currentPost = await prisma.publishedPost.findUnique({
          where: { id: result.id },
          include: { media: { orderBy: { order: "asc" } } },
        });

        if (currentPost) {
          const remoteMedia = (currentPost.media || []).map((m) => {
            const remote = remoteUrlByOrder[m.order];
            return remote
              ? { ...m, url: remote.fileUrl, remoteUrl: remote.fileUrl }
              : m;
          });

          // For reused canonical media, keep the canonical URL
          for (const md of remoteMedia) {
            const orig = mediaRecordsData.find((d) => d.order === md.order);
            if (orig?.isReused && isCanonicalMediaUrl(orig.url)) {
              md.url = orig.url;
            }
          }

          const remotePayload = buildN8nPayload(
            { ...currentPost, thumbnailUrl: updatedThumbnailUrl },
            remoteMedia,
            brand.name,
          );

          let payloadObj = remotePayload ? JSON.parse(JSON.stringify(remotePayload)) : {};
          payloadObj._crossPlatformSource = crossPlatformMeta._crossPlatformSource;

          const remotePayloadJson = remotePayload
            ? JSON.stringify(payloadObj, null, 2)
            : null;

          if (remotePayloadJson) {
            await prisma.publishedPost.update({
              where: { id: result.id },
              data: {
                jsonPayload: remotePayloadJson,
                thumbnailUrl: updatedThumbnailUrl,
              },
            });
          }

          const persisted = await prisma.publishedPost.findUnique({
            where: { id: result.id },
            include: { media: { orderBy: { order: "asc" } } },
          });

          if (persisted) {
            const finalMedia = (persisted.media || []).map((m) => {
              const remote = remoteUrlByOrder[m.order];
              return remote
                ? { ...m, url: remote.fileUrl, remoteUrl: remote.fileUrl }
                : m;
            });
            for (const md of finalMedia) {
              const orig = mediaRecordsData.find((d) => d.order === md.order);
              if (orig?.isReused && isCanonicalMediaUrl(orig.url)) {
                md.url = orig.url;
              }
            }
            result = { ...persisted, media: finalMedia };
          }
        }
      } catch (error) {
        console.error("[AdaptPost] failed to update payload with remote URLs", error);
      }
    }

    // ── Send to n8n (only when explicitly requested and remote media is available) ──
    let webhookResult = null;
    if (sendToN8n) {
      if (remoteUploadSuccessful || remoteResult?.skipped) {
        try {
          webhookResult = await sendPublishedPostToN8n({
            post: result,
            media: result.media || [],
            brandName: brand.name,
          });
        } catch (webhookError) {
          webhookResult = { success: false, error: "Failed to send to n8n webhook." };
          console.error("[AdaptPost] n8n webhook send failed", webhookError);
        }
      } else {
        webhookResult = {
          success: false,
          code: "REMOTE_MEDIA_UPLOAD_FAILED",
          error: "The adapted post was saved, but its media could not be uploaded to the public media server.",
        };
      }
    }

    // ── Remove private metadata from response payload for client ────────────
    const cleanPost = result;
    if (cleanPost.jsonPayload) {
      try {
        const parsed = JSON.parse(cleanPost.jsonPayload);
        delete parsed._crossPlatformSource;
        cleanPost.jsonPayload = JSON.stringify(parsed, null, 2);
      } catch {
        // keep as-is
      }
    }

    return NextResponse.json(
      { post: cleanPost, webhookResult, remoteResult },
      { status: 201 },
    );
  } catch (error) {
    console.error("[AdaptPost] adaptation failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Adaptation failed." },
      { status: 500 },
    );
  }
}
