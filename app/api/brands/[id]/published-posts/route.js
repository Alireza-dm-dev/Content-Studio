import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBrandAccess, getAccessibleBrandIds } from "@/lib/brand-access";
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
  serializePublishedPost,
  serializePublishedPosts,
  MAX_FILE_SIZE,
  POST_TYPE_STATIC,
  POST_TYPE_CAROUSEL,
  POST_TYPE_REEL,
} from "@/lib/published-post-utils";
import { PUBLISHED_POST_ORDER_BY } from "@/lib/published-post-order";
import { sendPublishedPostToN8n } from "@/lib/published-post-webhook";
import { uploadPublishedPostMedia, isCanonicalMediaUrl } from "@/lib/published-post-remote-media";
import { parseScheduledDate, resolveBrandTimezone, hasBrandTimezone } from "@/lib/timezone";
import { validateThumbnailFile, saveThumbnailFile, isNoFile } from "@/lib/published-post-thumbnail";
import {
  COLLABORATION_INCLUDE,
  publishedPostGridWhere,
  parseCollaboratorBrandIds,
  validateCollaboratorBrands,
  decorateCollaboration,
} from "@/lib/published-post-collaborators";
import { validateInstagramCaptionForBrand, captionRulesErrorBody } from "@/lib/instagram-caption-check";
import {
  enforceLinkedInRetention,
  retentionResult,
  LINKEDIN_RETENTION_REMOVED_MESSAGE,
} from "@/lib/linkedin-retention";
import {
  parseCreatePublishingMode,
  uploadTrialBinding,
  PUBLISHING_MODE_PRODUCTION,
  PUBLISHING_MODE_TRIAL,
  PUBLISHING_MODE_SAVE_ONLY,
  PRODUCTION_DELIVERY_SKIPPED_CODE,
  PRODUCTION_DELIVERY_SKIPPED_MESSAGE,
} from "@/lib/publishing-mode";
import { withSubmissionGuard, formDataFingerprint } from "@/lib/submission-guard";
import { markSubmissionSaved } from "@/lib/submission-receipt";
// The trial runner is loaded only for Trial-mode requests (see trialRunner()).
const trialRunner = () => import("@/lib/n8n-trial-runner");
import {
  postTypeSupportsCover,
  COVER_NOT_SUPPORTED_CODE,
  COVER_NOT_SUPPORTED_MESSAGE,
} from "@/lib/published-post-cover";

const MAX_POSTS_PER_BRAND = 21;

export async function GET(request, { params }) {
  const { id } = await params;

  const brandAccess = await requireBrandAccess(id);
  if (!brandAccess.ok) {
    return NextResponse.json(
      { error: brandAccess.error },
      { status: brandAccess.status },
    );
  }

  const brand = await prisma.brand.findUnique({ where: { id } });
  if (!brand) {
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }

  let platform = null;
  try {
    const platformParam = new URL(request.url).searchParams.get("platform");
    if (platformParam) {
      platform = normalizePublishedPostPlatform(platformParam);
    }
  } catch {
    // ignore malformed URL; fall back to returning all posts
  }

  // Own posts + Instagram posts this brand collaborates on, in ONE query over
  // PublishedPost: each row appears once and the shared ordering is untouched.
  const posts = await prisma.publishedPost.findMany({
    where: publishedPostGridWhere(id, platform),
    orderBy: PUBLISHED_POST_ORDER_BY,
    include: {
      media: { orderBy: { order: "asc" } },
      _count: { select: { comments: true } },
      ...COLLABORATION_INCLUDE,
    },
  });

  const accessibleBrandIds = await getAccessibleBrandIds(brandAccess.user);

  // Normalize on read: media rows hold local /uploads paths, the public URLs
  // live in jsonPayload. Without this the grid renders paths that 404.
  const serialized = serializePublishedPosts(posts);
  return NextResponse.json(
    serialized.map((post, i) =>
      decorateCollaboration(post, posts[i], { viewerBrandId: id, accessibleBrandIds }),
    ),
  );
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

// Duplicate-submission protection wraps the create (see lib/submission-guard).
export async function POST(request, ctx) {
  return createPublishedPost(request, ctx);
}

async function createPublishedPost(request, { params }, preParsed = {}) {
  try {
    const { id } = await params;

  const brandAccess = await requireBrandAccess(id);
  if (!brandAccess.ok) {
    return NextResponse.json(
      { error: brandAccess.error },
      { status: brandAccess.status },
    );
  }

    const brand = await prisma.brand.findUnique({ where: { id } });
    if (!brand) {
      return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    }

    let formData;
    try {
      formData = preParsed.formData ?? await request.formData();
    } catch {
      return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    }

    // Same submission id + same request → never a second post or webhook
    // (durable receipt, see lib/submission-guard); same id + different request
    // → refused. No id → unchanged. Runs after Brand authorization above.
    if (!preParsed.guarded) {
      return withSubmissionGuard({
        submissionId: formData.get("submissionId"),
        userId: brandAccess.user?.id,
        brandId: id,
        operation: "create",
        brandTimezone: brand.timezone ?? null,
        fingerprint: () => formDataFingerprint(formData),
      }, ({ receipt }) => createPublishedPost(request, { params }, { formData, guarded: true, receipt }));
    }

// ── Read fields ──────────────────────────────────────────────────────────────
  const rawFiles = formData.getAll("files") || formData.getAll("file") || [];
  const rawPostType = formData.get("postType") || formData.get("post_type") || "";
  const rawCaption = formData.get("caption") || "";
  const rawPlatform = formData.get("platform");

  // Canonical internal platform: "LinkedIn" (never "Linkedin").
  const platform = normalizePublishedPostPlatform(rawPlatform);
  if (!platform) {
    return NextResponse.json(
      { error: "Unsupported platform. Must be Instagram or LinkedIn." },
      { status: 400 }
    );
  }

  // Per-post publishing mode (V1.3.56). Absent → Production (existing
  // behaviour). Any other value than the three modes is rejected.
  const modeParse = parseCreatePublishingMode(formData.get("publishingMode"));
  if (!modeParse.ok) {
    return NextResponse.json({ error: modeParse.error, code: modeParse.code }, { status: 400 });
  }
  const publishingMode = modeParse.mode;

  // multipart/form-data encodes every line break in a text field as CRLF
  // (HTML spec), so a caption typed as "a\n\nb" arrives as "a\r\n\r\nb".
  // Undo that transport artifact for Instagram so the caption is stored and
  // sent to n8n exactly as checked. LinkedIn keeps its existing behaviour.
  const caption = platform === "Instagram" ? String(rawCaption).replace(/\r\n?/g, "\n") : rawCaption;
  
  const rawScheduledDate = formData.get("scheduledDate") || formData.get("scheduled_date") || "";
  const notes = formData.get("notes") || "";
  const rawStatus = formData.get("status") || "draft";
  const thumbnailFile = formData.get("thumbnail");

  // Optional Instagram collaborator brands. Re-authorized here; the client
  // dropdown is never trusted. Validated before any file is written.
  const parsedCollaborators = parseCollaboratorBrandIds(formData.getAll("collaboratorBrandIds"));
  if (!parsedCollaborators.ok) {
    return NextResponse.json({ error: parsedCollaborators.error }, { status: parsedCollaborators.status });
  }
  const collaboratorCheck = await validateCollaboratorBrands({
    user: brandAccess.user,
    primaryBrandId: id,
    platform,
    brandIds: parsedCollaborators.ids,
  });
  if (!collaboratorCheck.ok) {
    return NextResponse.json({ error: collaboratorCheck.error }, { status: collaboratorCheck.status });
  }
  const collaboratorBrands = collaboratorCheck.brands;

  // Instagram caption rules are a save gate (spacing, Brand footer, exactly 5
  // hashtags). The server never rewrites the caption here: the client runs
  // "Check caption" and the user applies the result. The footer is always the
  // uploading (primary) brand's, never a collaborator's.
  if (platform === "Instagram") {
    const captionCheck = await validateInstagramCaptionForBrand(caption, id);
    if (!captionCheck.ok) {
      return NextResponse.json(captionRulesErrorBody(captionCheck), { status: 422 });
    }
  }
  
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
    // Bare wall-clock values are interpreted in the BRAND timezone; the
    // browser/server zone never participates.
    if (!hasBrandTimezone(brand)) {
      console.warn(`[PublishedPost] brand ${id} has no timezone; using default for scheduling`);
    }
    const parsed = parseScheduledDate(rawScheduledDate, resolveBrandTimezone(brand));
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    scheduledDate = parsed.date;
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

  // Instagram thumbnail / cover: optional, strictly validated, rejected (not
  // silently skipped) when invalid. LinkedIn keeps its existing handling below.
  let instagramThumbnail = null;
  // Static / Carousel take no separate cover: refuse it outright (before any
  // file is written) so a client can never attach one by bypassing the UI.
  if (platform === "Instagram" && !isNoFile(thumbnailFile) && !postTypeSupportsCover(postType)) {
    return NextResponse.json(
      { error: COVER_NOT_SUPPORTED_MESSAGE, code: COVER_NOT_SUPPORTED_CODE },
      { status: 400 },
    );
  }
  if (platform === "Instagram" && !isNoFile(thumbnailFile)) {
    const v = await validateThumbnailFile(thumbnailFile);
    if (!v.ok) {
      return NextResponse.json({ error: v.error, code: "INVALID_THUMBNAIL" }, { status: 400 });
    }
    instagramThumbnail = v;
  }

  // ── Trial mode: configuration, confirmation and destination BEFORE saving ──
  // The confirmation token is bound to the current trial configuration and to
  // this exact form submission; a direct API request without a valid one, or
  // with no trial webhook configured, saves nothing.
  let trialConfigVersion = null;
  if (publishingMode === PUBLISHING_MODE_TRIAL) {
    const verified = await (await trialRunner()).verifyTrialSubmission({
      binding: await uploadTrialBinding(id, formData),
      token: formData.get("trialConfirmation"),
    });
    if (!verified.ok) return NextResponse.json(verified.body, { status: verified.status });
    trialConfigVersion = verified.configVersion;
  }

  // ── Compute next postNumber ──────────────────────────────────────────────────
  const lastPost = await prisma.publishedPost.findFirst({
    where: { brandId: id },
    orderBy: { postNumber: "desc" },
    select: { postNumber: true },
  });
  const nextPostNumber = (lastPost?.postNumber ?? 0) + 1;

  // ── Generate post ID before any filesystem work ────────────────────────────
  const postId = randomUUID();
  const uploadDir = path.join(process.cwd(), "public", "uploads", id, "published-posts", postId);

  // ── Prepare media outside transaction ──────────────────────────────────────
  const mediaRecordsData = [];
  let thumbnailUrl = null;

  try {
    await mkdir(uploadDir, { recursive: true });

    for (let i = 0; i < validatedMedia.length; i++) {
      const { file, mediaType } = validatedMedia[i];
      const ext = path.extname(file.name) || "";
      const safeBase = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.[^.]*$/, "") || "media";
      const fileName = `${Date.now()}-${i}-${safeBase}${ext}`;
      const absPath = path.join(uploadDir, fileName);

      const bytes = await file.arrayBuffer();
      await writeFile(absPath, Buffer.from(bytes));

      mediaRecordsData.push({
        url: `/uploads/${id}/published-posts/${postId}/${fileName}`,
        mediaType,
        order: i + 1,
        fileType: file.type,
        fileName: file.name,
      });
    }

    // Save thumbnail if provided
    if (instagramThumbnail) {
      thumbnailUrl = await saveThumbnailFile(id, postId, instagramThumbnail);
    } else if (platform !== "Instagram" && thumbnailFile && typeof thumbnailFile !== "string") {
      const thumbMediaType = getMediaTypeFromMime(thumbnailFile.type);
      if (thumbMediaType === "IMAGE") {
        if (thumbnailFile.size > MAX_FILE_SIZE) {
          console.warn(`[PublishedPost] Thumbnail exceeds limit, skipping.`);
        } else {
          const thumbExt = path.extname(thumbnailFile.name) || ".jpg";
          const thumbName = `thumbnail${thumbExt}`;
          const thumbPath = path.join(uploadDir, thumbName);
          const thumbBytes = await thumbnailFile.arrayBuffer();
          await writeFile(thumbPath, Buffer.from(thumbBytes));
          thumbnailUrl = `/uploads/${id}/published-posts/${postId}/${thumbName}`;
        }
      }
    }
  } catch (fileError) {
    await rm(uploadDir, { recursive: true, force: true }).catch(() => {});
    console.error("[PublishedPosts] file write failed", fileError);
    return NextResponse.json({ error: "File upload failed. Please try again." }, { status: 500 });
  }

  // ── Create post + media in transaction (DB only) ───────────────────────────
  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const post = await tx.publishedPost.create({
        data: {
          id: postId,
          brandId: id,
          postType,
          caption: caption || null,
          platform,
          status,
          scheduledDate,
          notes: notes || null,
          postNumber: nextPostNumber,
          deliveryMode: publishingMode,
        },
      });
      // The submission receipt becomes "saved" in the SAME transaction.
      if (preParsed.receipt) await markSubmissionSaved(tx, preParsed.receipt.id, post.id);

      for (const collaborator of collaboratorBrands) {
        await tx.publishedPostCollaborator.create({
          data: { publishedPostId: post.id, brandId: collaborator.id },
        });
      }

      const mediaRecords = [];
      for (const md of mediaRecordsData) {
        const rec = await tx.publishedPostMedia.create({
          data: {
            publishedPostId: post.id,
            url: md.url,
            mediaType: md.mediaType,
            order: md.order,
            fileType: md.fileType,
            fileName: md.fileName,
          },
        });
        mediaRecords.push(rec);
      }

      const payload = buildN8nPayload(
        { ...post, thumbnailUrl },
        mediaRecords,
        brand.name,
        brand.timezone,
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
  } catch (dbError) {
    await rm(uploadDir, { recursive: true, force: true }).catch(() => {});
    throw dbError;
  }

  // ── LinkedIn retention: all queued + at most 5 historical, no exemption ─────
  // Runs as soon as the row exists and BEFORE remote upload / n8n, so a post
  // that falls outside the window is never published anywhere. Never on GET.
  let linkedInRetention = null;
  if (platform === "LinkedIn") {
    const { deletedIds } = await enforceLinkedInRetention(id, { timeZone: brand.timezone ?? null });
    linkedInRetention = retentionResult(deletedIds, result.id);
    if (linkedInRetention.currentPostRemoved) {
      return NextResponse.json(
        {
          post: null,
          kept: false,
          webhookResult: null,
          remoteResult: null,
          linkedInRetention,
          message: LINKEDIN_RETENTION_REMOVED_MESSAGE,
        },
        { status: 200 },
      );
    }
  }

  // ── Save Only: no public upload, no webhook ────────────────────────────────
  // Media stays local; public upload is deferred until an explicit Send to n8n
  // or "Upload Media & Run Trial" needs it.
  if (publishingMode === PUBLISHING_MODE_SAVE_ONLY) {
    await enforcePublishedPostsLimit(id);
    const savedPost = decorateCollaboration(
      serializePublishedPost(result, { brandTimezone: brand.timezone ?? null }),
      {
        brand: { id: brand.id, name: brand.name, timezone: brand.timezone ?? null },
        collaborators: collaboratorBrands.map((b) => ({ brandId: b.id, brand: b })),
      },
      { viewerBrandId: id, accessibleBrandIds: null },
    );
    return NextResponse.json(
      {
        post: savedPost,
        publishingMode,
        webhookResult: { success: null, skipped: true, code: PRODUCTION_DELIVERY_SKIPPED_CODE, deliveryMode: publishingMode, message: PRODUCTION_DELIVERY_SKIPPED_MESSAGE },
        remoteResult: null,
        linkedInRetention,
      },
      { status: 201 },
    );
  }

  // ── Remote media upload (best-effort) ──────────────────────────────────────
  // Production and Trial both prepare public media (a trial must test the
  // real public files); a later production send reuses these URLs.
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
      detailCode: error.detailCode || "SFTP_UPLOAD_FAILED",
      error: error.message || "Remote media upload failed.",
      code: error.code,
      details: error.message,
    };
    console.error("[PublishedPosts] remote media upload failed", {
      detailCode: remoteResult.detailCode,
      error: error.message,
      code: error.code,
    });
  }

  // Rebuild jsonPayload with remote URLs if remote upload succeeded
  const remoteUploadSuccessful =
    remoteResult?.success &&
    remoteResult.media.length === (result.media || []).length;

  if (remoteUploadSuccessful) {
    try {
      const remoteUrlByOrder = {};
      for (const r of remoteResult.media) {
        remoteUrlByOrder[r.order] = r;
      }

      const updatedThumbnailUrl = remoteResult.thumbnailUrl || result.thumbnailUrl;

      // Reload current post from DB
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

        const remotePayload = buildN8nPayload(
          { ...currentPost, thumbnailUrl: updatedThumbnailUrl },
          remoteMedia,
          brand.name,
          brand.timezone,
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
        }

        // Reload once more to get the final persisted state
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
          result = { ...persisted, media: finalMedia };
        }
      }
    } catch (error) {
      console.error("[PublishedPosts] failed to update payload with remote URLs", error);
    }
  }

  // ── Trial: send ONLY to the trial webhook (never production, no fallback) ──
  let trial = null;
  if (publishingMode === PUBLISHING_MODE_TRIAL) {
    if (remoteUploadSuccessful) {
      trial = await (await trialRunner()).runTrialForSavedPost({ post: result, brand, configVersion: trialConfigVersion });
    } else {
      trial = {
        sent: false,
        code: "REMOTE_MEDIA_UPLOAD_FAILED",
        error: "Post saved, but its media could not be uploaded to the public media server. No trial was sent. Use Upload Media & Run Trial on the saved post to retry.",
        mediaUpload: {
          detailCode: remoteResult?.detailCode || "SFTP_UPLOAD_FAILED",
          details: remoteResult?.error || remoteResult?.details || remoteResult?.detailCode || null,
        },
      };
    }
  }

  // ── Auto-send to n8n (only when canonical remote media is available) ────────
  let webhookResult = null;
  if (publishingMode !== PUBLISHING_MODE_PRODUCTION) {
    webhookResult = { success: null, skipped: true, code: PRODUCTION_DELIVERY_SKIPPED_CODE, deliveryMode: publishingMode, message: PRODUCTION_DELIVERY_SKIPPED_MESSAGE };
  } else if (remoteUploadSuccessful) {
    try {
      webhookResult = await sendPublishedPostToN8n({
        post: result,
        media: result.media || [],
        brandName: brand.name,
        brandTimezone: brand.timezone,
      });
    } catch (webhookError) {
      webhookResult = { success: false, error: "Failed to send to n8n webhook." };
      console.error("[PublishedPosts] n8n webhook send failed", {
        error: webhookError?.message,
      });
    }
  } else {
    webhookResult = {
      success: false,
      code: "REMOTE_MEDIA_UPLOAD_FAILED",
      error: "The post was saved, but its media could not be uploaded to the public media server.",
      detailCode: remoteResult?.detailCode || "SFTP_UPLOAD_FAILED",
      details: remoteResult?.error || remoteResult?.details || remoteResult?.detailCode || null,
      ...(remoteResult?.fileSize != null ? { fileSize: remoteResult.fileSize } : {}),
      ...(remoteResult?.duration != null ? { duration: remoteResult.duration } : {}),
      ...(remoteResult?.skipped ? { skipped: true } : {}),
    };
    if (remoteResult?.success && !remoteUploadSuccessful) {
      webhookResult.details = `Remote media count mismatch: expected ${(result.media || []).length}, got ${remoteResult.media.length}`;
      webhookResult.detailCode = "SFTP_MEDIA_COUNT_MISMATCH";
    }
    console.log("[PublishedPosts] auto n8n send skipped: remote media not available", {
      detailCode: remoteResult?.detailCode,
      skipped: remoteResult?.skipped,
    });
  }

  await enforcePublishedPostsLimit(id);

  const createdPost = decorateCollaboration(
    serializePublishedPost(result, { brandTimezone: brand.timezone ?? null }),
    {
      brand: { id: brand.id, name: brand.name, timezone: brand.timezone ?? null },
      collaborators: collaboratorBrands.map((b) => ({ brandId: b.id, brand: b })),
    },
    { viewerBrandId: id, accessibleBrandIds: null }, // creator just passed requireBrandAccess(id)
  );

  return NextResponse.json(
    {
      post: createdPost,
      webhookResult,
      remoteResult,
      linkedInRetention,
      ...(modeParse.explicit ? { publishingMode } : {}),
      ...(trial ? { trial } : {}),
    },
    { status: 201 },
  );
  } catch (error) {
    console.error("[PublishedPosts] upload failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 500 },
    );
  }
}
