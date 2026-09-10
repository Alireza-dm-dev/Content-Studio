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
  serializePublishedPost,
  MAX_FILE_SIZE,
  IMAGE_TYPES,
  VIDEO_TYPES,
  extractHashtags,
} from "@/lib/published-post-utils";
import { sendPublishedPostToN8n } from "@/lib/published-post-webhook";
import { uploadPublishedPostMedia, isCanonicalMediaUrl, isLocalMediaUrl, copyMediaToTarget } from "@/lib/published-post-remote-media";
import { normalizeScheduledDate } from "@/lib/timezone";
import { readBoundedJsonBody } from "@/lib/read-bounded-json";

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

    // ── Parse and validate JSON body ────────────────────────────────────────
    // WARNING: Do NOT use request.formData() here. Next.js in this version
    // intercepts ALL POST requests with Content-Type: multipart/form-data as
    // Server Actions. If no "use server" functions exist, Next.js returns 404
    // "Server action not found" before the route handler ever runs.
    // We use application/json with base64-encoded files instead.

    // Validate Content-Type before reading body
    const ctype = request.headers.get("content-type") || "";
    if (!ctype.startsWith("application/json")) {
      return NextResponse.json(
        { error: "Content-Type must be application/json." },
        { status: 415 },
      );
    }

    // Derived size limits (base64 overhead is ~4/3):
    //   MAX_FILE_SIZE = 100 MB (single-file decoded limit from published-post-utils)
    //   MAX_ENCODED_BODY = 200 MB (allows up to ~150 MB of decoded content)
    //   MAX_COMBINED_DECODED = 150 MB (constrained by encoded body limit: 200 MB * 3/4)
    // A single 100 MB file fits within both per-file and combined limits.
    // Multiple files sum their decoded sizes against the combined limit.
    const MAX_ENCODED_BODY = MAX_FILE_SIZE * 2;                   // 200 MB
    const MAX_COMBINED_DECODED = Math.floor(MAX_ENCODED_BODY * 0.75); // 150 MB

    const parseResult = await readBoundedJsonBody(request, MAX_ENCODED_BODY);

    if (parseResult.error === "PAYLOAD_TOO_LARGE") {
      return NextResponse.json(
        { error: `Request body exceeds ${Math.round(MAX_ENCODED_BODY / 1024 / 1024)} MB limit.` },
        { status: 413 },
      );
    }

    if (parseResult.error) {
      return NextResponse.json({ error: "Invalid request body. Expected JSON." }, { status: 400 });
    }

    const body = parseResult.body;

    const rawTargetPlatform = body.targetPlatform || "";
    const targetPlatform = normalizePublishedPostPlatform(rawTargetPlatform);
    if (!targetPlatform) {
      return NextResponse.json(
        { error: "Unsupported target platform. Must be Instagram or LinkedIn." },
        { status: 400 },
      );
    }

    const rawTargetPostType = body.targetPostType || "";
    const targetPostType = normalizePostType(rawTargetPostType);
    if (!targetPostType) {
      return NextResponse.json(
        { error: "Invalid targetPostType. Must be static, carousel, or reel." },
        { status: 400 },
      );
    }

    // ── Platform ownership assertion ─────────────────────────────────────────
    // Defensive: source platform must normalize to a known value; target must
    // be the explicit opposite. This guarantees the DB create never receives
    // an incorrect platform value.
    const normalizedSourcePlatform = normalizePublishedPostPlatform(sourcePost.platform);
    if (normalizedSourcePlatform !== "Instagram" && normalizedSourcePlatform !== "LinkedIn") {
      return NextResponse.json(
        { error: "Source platform is not a valid adaptation origin." },
        { status: 400 },
      );
    }
    if (targetPlatform !== "Instagram" && targetPlatform !== "LinkedIn") {
      return NextResponse.json(
        { error: "Target platform is not a valid adaptation target." },
        { status: 400 },
      );
    }
    if (normalizedSourcePlatform === targetPlatform) {
      return NextResponse.json(
        { error: "Target platform must be different from source platform." },
        { status: 400 },
      );
    }

    const caption = body.caption || "";
    const rawHashtags = body.hashtags || "";
    const publishTitle = body.publishTitle || "";
    const documentTitle = body.documentTitle || "";
    const mediaStrategy = body.mediaStrategy || "reuse";
    const orderedManifest = Array.isArray(body.orderedMediaManifest) ? body.orderedMediaManifest : [];
    const rawScheduledDate = body.scheduledDate || "";
    const rawStatus = body.status || "draft";
    const sendToN8n = body.sendToN8n === true;
    const rawFiles = Array.isArray(body.files) ? body.files : [];
    const rawThumbnail = body.thumbnail || null;

    if (!Array.isArray(orderedManifest)) {
      return NextResponse.json(
        { error: "Invalid orderedMediaManifest: must be a JSON array." },
        { status: 400 },
      );
    }

    const status = isValidStatus(rawStatus) ? rawStatus : "draft";

    let scheduledDate = null;
    if (rawScheduledDate) {
      const date = normalizeScheduledDate(rawScheduledDate);
      if (!date) {
        return NextResponse.json({ error: "Invalid scheduled date." }, { status: 400 });
      }
      scheduledDate = date;
    }

    // ── Enforce target-specific file counts before decoding ─────────────────
    const newFileCount = Array.isArray(rawFiles) ? rawFiles.length : 0;
    let minFiles = 0;
    let maxFiles = Infinity;

    if (targetPlatform === "Instagram") {
      if (targetPostType === "static") { minFiles = 1; maxFiles = 1; }
      else if (targetPostType === "carousel") { minFiles = 2; maxFiles = 10; }
      else if (targetPostType === "reel") { minFiles = 1; maxFiles = 1; }
    } else if (targetPlatform === "LinkedIn") {
      if (targetPostType === "static") { minFiles = 1; maxFiles = 1; }
      else if (targetPostType === "carousel") {
        const isDocument = orderedManifest.length === 1 && orderedManifest[0]?.mediaType === "document";
        if (isDocument) { minFiles = 1; maxFiles = 1; }
        else { minFiles = 2; maxFiles = 20; }
      }
      else if (targetPostType === "reel") { minFiles = 1; maxFiles = 1; }
    }

    if (newFileCount > 0 && (newFileCount < minFiles || newFileCount > maxFiles)) {
      const msg = maxFiles === 1
        ? `${targetPlatform} ${targetPostType} requires exactly 1 file.`
        : `${targetPlatform} ${targetPostType} requires between ${minFiles} and ${maxFiles} files.`;
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    // ── Validate files (base64, sizes, MIME types) ───────────────────────────
    const ALLOWED_MIME = new Set([
      ...IMAGE_TYPES,
      ...VIDEO_TYPES,
      "application/pdf",
    ]);
    const EXT_MAP = {
      ".jpg": ["image/jpeg"], ".jpeg": ["image/jpeg"],
      ".png": ["image/png"],
      ".webp": ["image/webp"],
      ".gif": ["image/gif"],
      ".avif": ["image/avif"],
      ".mp4": ["video/mp4"],
      ".webm": ["video/webm"],
      ".mov": ["video/quicktime"],
      ".avi": ["video/x-msvideo"],
      ".mpeg": ["video/mpeg"],
      ".pdf": ["application/pdf"],
    };

    /**
     * Strict base64 validation. Buffer.from(value, "base64") silently ignores
     * some malformed input (e.g. newlines, invalid chars in some positions).
     * We pre-validate the string so only properly padded base64 passes.
     */
    function isValidBase64(str) {
      if (typeof str !== "string" || str.length === 0) return false;
      // Valid characters: A-Z, a-z, 0-9, +, /
      // Padding: 0, 1, or 2 = characters at end only
      const bodyLen = str.length;
      const padStart = bodyLen > 0 && str[bodyLen - 1] === "="
        ? (bodyLen > 1 && str[bodyLen - 2] === "=" ? bodyLen - 2 : bodyLen - 1)
        : bodyLen;
      if (padStart < 1) return false; // only padding, no data
      for (let i = 0; i < padStart; i++) {
        const c = str.charCodeAt(i);
        if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 47)) {
          return false;
        }
      }
      // Validate padding chars
      const padCount = bodyLen - padStart;
      if (padCount > 2) return false;
      for (let i = padStart; i < bodyLen; i++) {
        if (str[i] !== "=") return false;
      }
      return bodyLen % 4 === 0;
    }

    let totalDecodedBytes = 0;

    for (const f of rawFiles) {
      if (!f || !f.content || typeof f.content !== "string") {
        return NextResponse.json(
          { error: `File "${f?.name || "unknown"}": missing content field.` },
          { status: 400 },
        );
      }

      if (!isValidBase64(f.content)) {
        return NextResponse.json(
          { error: `File "${f.name || "unknown"}": malformed base64 content (invalid chars, padding, or length).` },
          { status: 400 },
        );
      }

      let decoded;
      try {
        decoded = Buffer.from(f.content, "base64");
      } catch {
        return NextResponse.json(
          { error: `File "${f.name || "unknown"}": base64 decode failed.` },
          { status: 400 },
        );
      }

      if (decoded.length === 0) {
        return NextResponse.json(
          { error: `File "${f.name || "unknown"}": decoded content is empty.` },
          { status: 400 },
        );
      }

      // Per-file decoded size must not exceed MAX_FILE_SIZE
      if (decoded.length > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `File "${f.name || "unknown"}": exceeds ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB limit (${(decoded.length / 1024 / 1024).toFixed(1)} MB).` },
          { status: 413 },
        );
      }

      // Declared size must match decoded size
      if (typeof f.size === "number" && f.size !== decoded.length) {
        return NextResponse.json(
          { error: `File "${f.name || "unknown"}": declared size (${f.size}) does not match decoded size (${decoded.length}).` },
          { status: 400 },
        );
      }

      totalDecodedBytes += decoded.length;

      // Combined decoded size must not exceed derived limit
      if (totalDecodedBytes > MAX_COMBINED_DECODED) {
        return NextResponse.json(
          { error: `Combined file size exceeds ${Math.round(MAX_COMBINED_DECODED / 1024 / 1024)} MB limit.` },
          { status: 413 },
        );
      }

      // Validate MIME type
      const lowerType = (f.type || "").toLowerCase();
      if (!ALLOWED_MIME.has(lowerType)) {
        return NextResponse.json(
          { error: `File "${f.name || "unknown"}": unsupported type "${lowerType}". Allowed: image/jpeg, image/png, image/webp, image/gif, image/avif, video/mp4, video/webm, video/quicktime, video/x-msvideo, video/mpeg, application/pdf.` },
          { status: 400 },
        );
      }

      // Validate extension matches MIME type
      const fext = path.extname(f.name || "").toLowerCase();
      const validExts = Object.keys(EXT_MAP).filter((e) => EXT_MAP[e].includes(lowerType));
      if (validExts.length > 0 && !validExts.includes(fext)) {
        return NextResponse.json(
          { error: `File "${f.name || "unknown"}": extension "${fext}" does not match MIME type "${lowerType}".` },
          { status: 400 },
        );
      }

      // PDF must use .pdf extension
      if (lowerType === "application/pdf" && fext !== ".pdf") {
        return NextResponse.json(
          { error: `File "${f.name || "unknown"}": PDF MIME type requires .pdf extension.` },
          { status: 400 },
        );
      }
    }

    // ── Wrap JSON file descriptors with File-like interface ──────────────────
    function fileFromJson(fd) {
      const buf = Buffer.from(fd.content, "base64");
      return {
        name: fd.name,
        type: fd.type,
        size: fd.size || buf.length,
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      };
    }

    const mediaFiles = rawFiles.filter((f) => f && f.content).map(fileFromJson);

    let thumbnailFile = null;
    if (rawThumbnail && rawThumbnail.content) {
      const thumbMime = rawThumbnail.type || rawThumbnail.mime || "image/jpeg";
      if (!IMAGE_TYPES.has(thumbMime)) {
        return NextResponse.json(
          { error: "Thumbnail must be an image (JPEG, PNG, WebP, GIF, or AVIF)." },
          { status: 400 },
        );
      }
      thumbnailFile = fileFromJson(rawThumbnail);
    }

    // ── Build target media records from manifest ──────────────────────────────
    // Three action types:
    //   reuseCanonical  — reference canonical URL directly, no upload
    //   copySourceLocal — copy source-local file to target dir, then upload
    //   uploadNew       — base64-decoded new file, then upload
    // Backward-compatible aliases: "reuse" → reuseCanonical, "new" → uploadNew
    const builtMedia = [];
    let newFileIndex = 0;

    for (const item of orderedManifest) {
      const action = item.action === "reuse" ? "reuseCanonical"
        : item.action === "new" ? "uploadNew"
        : item.action;

      if (action === "reuseCanonical") {
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
          isSourceCopy: false,
        });
      } else if (action === "copySourceLocal") {
        // Validate that the source URL is a local /uploads/... path
        if (!isLocalMediaUrl(item.sourceUrl)) {
          return NextResponse.json(
            { error: `Cannot copy local media: URL "${item.sourceUrl || "missing"}" is not a local media path.` },
            { status: 400 },
          );
        }
        builtMedia.push({
          sourceUrl: item.sourceUrl,
          sourceMediaId: item.sourceMediaId || null,
          mediaType: item.mediaType,
          order: item.order,
          isReused: false,
          isSourceCopy: true,
        });
      } else if (action === "uploadNew") {
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
          isSourceCopy: false,
        });
      } else {
        return NextResponse.json(
          { error: `Unknown manifest action: "${item.action}". Must be reuseCanonical, copySourceLocal, or uploadNew.` },
          { status: 400 },
        );
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
            isSourceCopy: false,
          });
        } else if (item.isSourceCopy) {
          // Copy source-local file into target directory
          hasNewFiles = true;
          const copyResult = await copyMediaToTarget({
            sourceUrl: item.sourceUrl,
            brandId: id,
            sourcePostId: postId,
            targetPostId: newPostId,
            order: item.order,
            mediaType: item.mediaType,
          }).catch((copyErr) => {
            throw Object.assign(
              new Error(`Failed to copy source media: ${copyErr.message}`),
              { code: copyErr.code || "COPY_FAILED" },
            );
          });

          mediaRecordsData.push({
            url: copyResult.url,
            mediaType: item.mediaType,
            order: item.order,
            fileType: null,
            fileName: copyResult.fileName,
            isReused: false,
            isSourceCopy: true,
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
            isSourceCopy: false,
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
      console.error("[Adapt] file write failed", fileError);
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
        console.error("[Adapt] remote media upload failed", {
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
        console.error("[Adapt] failed to update payload with remote URLs", error);
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
          console.error("[Adapt] n8n webhook send failed", webhookError);
        }
      } else {
        webhookResult = {
          success: false,
          code: "REMOTE_MEDIA_UPLOAD_FAILED",
          error: "The adapted post was saved, but its media could not be uploaded to the public media server.",
          detailCode: remoteResult?.detailCode || "SFTP_UPLOAD_FAILED",
          details: remoteResult?.error || remoteResult?.details || remoteResult?.detailCode || null,
          ...(remoteResult?.fileSize != null ? { fileSize: remoteResult.fileSize } : {}),
          ...(remoteResult?.duration != null ? { duration: remoteResult.duration } : {}),
          ...(remoteResult?.skipped ? { skipped: true } : {}),
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

    // ── JSON serialization safety check ────────────────────────────────────
    const responsePayload = {
      post: serializePublishedPost(cleanPost),
      webhookResult,
      remoteResult,
    };
    try {
      JSON.stringify(responsePayload);
    } catch (serializeError) {
      return NextResponse.json(
        { error: "Video adaptation failed.", code: "RESPONSE_SERIALIZATION_FAILED" },
        { status: 500 },
      );
    }

    return NextResponse.json(responsePayload, { status: 201 });
  } catch (error) {
    console.error("[AdaptPost] adaptation failed", error?.message || error);
    return NextResponse.json(
      { error: "Video adaptation failed.", code: "ADAPTATION_FAILED" },
      { status: 500 },
    );
  }
}
