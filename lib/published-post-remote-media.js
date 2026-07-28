import path from "path";
import Client from "ssh2-sftp-client";

const SFTP_CONNECT_TIMEOUT = 15000;
const UPLOAD_TIMEOUT_MIN_MS = 180000;
const UPLOAD_TIMEOUT_MAX_MS = 600000;

function timeoutPromise(ms, label) {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
  );
}

function calcUploadTimeout(fileSizeBytes) {
  return Math.max(
    UPLOAD_TIMEOUT_MIN_MS,
    Math.min(
      UPLOAD_TIMEOUT_MAX_MS,
      30000 + Math.ceil(fileSizeBytes / (128 * 1024)) * 1000,
    ),
  );
}

async function getFileSize(localPath) {
  try {
    const { stat } = await import("fs/promises");
    return (await stat(localPath)).size;
  } catch {
    return 0;
  }
}

export function getEnvConfig() {
  const host = process.env.PUBLISHED_MEDIA_FTP_HOST;
  const port = parseInt(process.env.PUBLISHED_MEDIA_FTP_PORT || "22", 10);
  const user = process.env.PUBLISHED_MEDIA_FTP_USER;
  const password = process.env.PUBLISHED_MEDIA_FTP_PASSWORD;
  const remoteBase = process.env.PUBLISHED_MEDIA_REMOTE_BASE || "/upload";
  const publicBase =
    process.env.PUBLISHED_MEDIA_PUBLIC_BASE_URL || "https://files.leadsagna.com";
  return { host, port, user, password, remoteBase, publicBase };
}

function makeFolderName(postNumber) {
  return `POST-${String(postNumber).padStart(4, "0")}`;
}

function makeFileName(prefix, folderName, order, ext) {
  return `${prefix}_${folderName}_${order}_${Date.now()}_${Math.floor(Math.random() * 10000)}${ext}`;
}

function makeRemotePath(remoteBase, folderName, fileName) {
  return `${remoteBase}/${folderName}/${fileName}`;
}

export function buildRemoteFileUrl(publicBase, folderName, fileName) {
  return `${publicBase}/${folderName}/${fileName}`;
}

const makeFileUrl = buildRemoteFileUrl;

export function isCanonicalMediaUrl(url) {
  if (typeof url !== "string" || !url.trim()) return false;

  const cfg = getEnvConfig();
  let mediaUrl;
  let publicBaseUrl;
  try {
    mediaUrl = new URL(url.trim());
    publicBaseUrl = new URL(cfg.publicBase);
  } catch {
    return false;
  }

  if (mediaUrl.protocol !== "https:") return false;

  if (mediaUrl.origin !== publicBaseUrl.origin) return false;

  if (mediaUrl.username || mediaUrl.password) return false;

  const host = mediaUrl.hostname.toLowerCase();
  const loopbacks = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
  if (loopbacks.has(host) || host.startsWith("localhost.")) return false;

  if (mediaUrl.pathname.includes("/uploads/")) return false;

  if (!/^\/POST-\d{4,}\//.test(mediaUrl.pathname)) return false;

  const basePath = publicBaseUrl.pathname.replace(/\/+$/, "");
  if (basePath && basePath !== "/") {
    if (!mediaUrl.pathname.startsWith(basePath)) return false;
  }

  return true;
}

function getPrefix(mediaType) {
  if (mediaType === "IMAGE") return "image";
  if (mediaType === "VIDEO") return "video";
  if (mediaType === "document") return "document";
  return "thumbnail";
}

function isTransientError(message) {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("timed out") ||
    m.includes("timeout") ||
    m.includes("connection") ||
    m.includes("reset") ||
    m.includes("econnreset") ||
    m.includes("econnrefused") ||
    m.includes("socket") ||
    m.includes("etimedout")
  );
}

function classifyError(message) {
  if (!message) return "SFTP_UPLOAD_FAILED";
  const m = message.toLowerCase();
  if (m.includes("timed out") || m.includes("timeout")) return "SFTP_UPLOAD_TIMEOUT";
  if (m.includes("permission denied")) return "SFTP_REMOTE_PERMISSION_DENIED";
  if (m.includes("authentication") || m.includes("auth")) return "SFTP_AUTH_FAILED";
  if (m.includes("enoent") || m.includes("not found") || m.includes("no such file")) return "SFTP_LOCAL_FILE_MISSING";
  return "SFTP_UPLOAD_FAILED";
}

async function attemptUpload(client, localPath, remotePath, timeoutMs, rec, folderName, isRetry) {
  const start = Date.now();
  try {
    await Promise.race([
      client.put(localPath, remotePath),
      timeoutPromise(timeoutMs, "SFTP upload"),
    ]);
    const duration = Date.now() - start;
    console.log("[PublishedPosts] SFTP upload completed", {
      mediaOrder: rec.order,
      remotePath,
      timeoutMs,
      duration,
      retry: isRetry,
    });
    return { ok: true, duration };
  } catch (err) {
    const duration = Date.now() - start;
    const message = (err && err.message) || "";
    const detailCode = classifyError(message);
    console.error("[PublishedPosts] SFTP upload attempt failed", {
      mediaOrder: rec.order,
      remotePath: remotePath,
      fileSize: null,
      timeoutMs,
      duration,
      retry: isRetry,
      detailCode,
      error: message,
    });
    return { ok: false, detailCode, duration, error: err };
  }
}

async function uploadSingleFileWithRetry(cfg, client, rec, localPath, remotePath, fileName, remoteDir, folderName) {
  const fileSize = await getFileSize(localPath);
  const timeoutMs = calcUploadTimeout(fileSize);
  let currentClient = client;
  let usedRetry = false;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const isRetry = attempt > 1;

    if (isRetry) {
      usedRetry = true;
      await currentClient.end().catch(() => {});
      currentClient = new Client();
      await currentClient.connect({
        host: cfg.host,
        port: cfg.port,
        username: cfg.user,
        password: cfg.password,
        readyTimeout: SFTP_CONNECT_TIMEOUT,
      });
      await currentClient.mkdir(remoteDir, true).catch(() => {});
      await currentClient.delete(remotePath).catch(() => {});
    }

    const result = await attemptUpload(
      currentClient, localPath, remotePath, timeoutMs, rec, folderName, isRetry,
    );

    if (result.ok) {
      return { ok: true, client: currentClient, usedRetry };
    }

    const shouldRetry = !isRetry && isTransientError(result.error && result.error.message);

    if (!shouldRetry) {
      await currentClient.delete(remotePath).catch(() => {});
      const err = result.error || new Error(result.detailCode);
      throw Object.assign(err, {
        detailCode: result.detailCode,
        fileSize,
        timeoutMs,
        duration: result.duration,
        retryCount: usedRetry ? 1 : 0,
      });
    }
  }

  const err = new Error("SFTP upload failed after retry");
  throw Object.assign(err, {
    detailCode: "SFTP_UPLOAD_TIMEOUT",
    fileSize,
    timeoutMs,
    retryCount: 1,
  });
}

export async function uploadPublishedPostMedia({ post, mediaRecords, brandId }) {
  const cfg = getEnvConfig();
  if (!cfg.host) {
    return { success: false, skipped: true, detailCode: "SFTP_NOT_CONFIGURED" };
  }

  const folderName = makeFolderName(post.postNumber);
  const remoteDir = `${cfg.remoteBase}/${folderName}`;
  const localDir = path.join(
    process.cwd(),
    "public",
    "uploads",
    brandId,
    "published-posts",
    post.id,
  );

  for (const rec of mediaRecords) {
    const localFileName = rec.url.split("/").pop();
    const localPath = path.join(localDir, localFileName);
    const exists = await statSafe(localPath);
    if (!exists) {
      return {
        success: false,
        detailCode: "SFTP_LOCAL_FILE_MISSING",
        error: `Local file not found for media order ${rec.order}`,
        localPath: localPath,
      };
    }
  }
  if (post.thumbnailUrl) {
    const thumbFile = post.thumbnailUrl.split("/").pop();
    const thumbPath = path.join(localDir, thumbFile);
    const exists = await statSafe(thumbPath);
    if (!exists) {
      console.warn("[PublishedPosts] local thumbnail file missing, skipping thumb", {
        path: thumbPath,
      });
    }
  }

  const client = new Client();

  try {
    try {
      await client.connect({
        host: cfg.host,
        port: cfg.port,
        username: cfg.user,
        password: cfg.password,
        readyTimeout: SFTP_CONNECT_TIMEOUT,
      });
    } catch (connError) {
      const msg = (connError && connError.message) || "";
      const detailCode =
        msg.includes("Authentication") || msg.includes("authentication")
          ? "SFTP_AUTH_FAILED"
          : msg.includes("Permission denied")
          ? "SFTP_AUTH_FAILED"
          : msg.includes("getConnection") || msg.includes("connect")
          ? "SFTP_CONNECTION_FAILED"
          : "SFTP_CONNECTION_FAILED";
      throw Object.assign(connError, { detailCode });
    }

    try {
      await client.mkdir(remoteDir, true);
    } catch (mkdirError) {
      const mkdirMsg = (mkdirError && mkdirError.message) || "";
      if (mkdirMsg.includes("Permission denied")) {
        throw Object.assign(mkdirError, { detailCode: "SFTP_REMOTE_PERMISSION_DENIED" });
      }
      console.warn("[PublishedPosts] remote mkdir warning", {
        dir: remoteDir,
        error: mkdirMsg,
      });
    }

    const remoteMedia = [];
    let currentClient = client;

    for (const rec of mediaRecords) {
      const localFileName = rec.url.split("/").pop();
      const localPath = path.join(localDir, localFileName);
      const ext = path.extname(localFileName) || "";
      const prefix = getPrefix(rec.mediaType);
      const fileName = makeFileName(prefix, folderName, rec.order, ext);
      const remotePath = makeRemotePath(cfg.remoteBase, folderName, fileName);

      const result = await uploadSingleFileWithRetry(
        cfg, currentClient, rec, localPath, remotePath, fileName, remoteDir, folderName,
      );
      currentClient = result.client;

      remoteMedia.push({
        order: rec.order,
        mediaType: rec.mediaType,
        fileName,
        folder: folderName,
        remotePath,
        fileUrl: makeFileUrl(cfg.publicBase, folderName, fileName),
      });
    }

    let remoteThumbnailUrl = null;
    if (post.thumbnailUrl) {
      const thumbFile = post.thumbnailUrl.split("/").pop();
      const thumbLocalPath = path.join(localDir, thumbFile);
      const ext = path.extname(thumbFile) || ".jpg";
      try {
        const fileName = makeFileName("thumbnail", folderName, 0, ext);
        const remotePath = makeRemotePath(cfg.remoteBase, folderName, fileName);
        await currentClient.put(thumbLocalPath, remotePath);
        remoteThumbnailUrl = makeFileUrl(cfg.publicBase, folderName, fileName);
      } catch (thumbErr) {
        console.warn("[PublishedPosts] thumbnail remote upload failed, skipping", {
          error: thumbErr.message,
          code: thumbErr.code,
          detailCode: "SFTP_THUMBNAIL_UPLOAD_FAILED",
        });
      }
    }

    await currentClient.end();

    return {
      success: true,
      folder: folderName,
      media: remoteMedia,
      thumbnailUrl: remoteThumbnailUrl,
    };
  } catch (error) {
    await client.end().catch(() => {});
    const detailCode = error.detailCode || "SFTP_UPLOAD_FAILED";
    console.error("[PublishedPosts] remote media upload failed", {
      detailCode,
      error: error.message,
      code: error.code,
      host: cfg.host,
      port: cfg.port,
      remoteBase: cfg.remoteBase,
      mediaCount: mediaRecords.length,
      fileSize: error.fileSize,
      timeoutMs: error.timeoutMs,
      duration: error.duration,
      retryCount: error.retryCount,
    });
    return {
      success: false,
      detailCode,
      error: error.message,
      code: error.code,
      details: error.details || error.message,
      fileSize: error.fileSize,
      timeoutMs: error.timeoutMs,
      duration: error.duration,
      retryCount: error.retryCount,
    };
  }
}

async function statSafe(filePath) {
  try {
    const { stat } = await import("fs/promises");
    const s = await stat(filePath);
    return s.isFile() && s.size > 0;
  } catch {
    return false;
  }
}

/**
 * Checks whether a URL is a local /uploads/... path (not canonical).
 */
export function isLocalMediaUrl(url) {
  return typeof url === "string" && /^\/uploads\/[^/]+\/published-posts\/[^/]+\//.test(url);
}

/**
 * Validates that a local source media URL is scoped to the expected
 * brand and source post, and prevents path traversal.
 *
 * Expected pattern:
 *   /uploads/{brandId}/published-posts/{sourcePostId}/{fileName}
 *
 * Returns { valid: true, fileName: "..." } or { valid: false, error: "..." }.
 */
export function validateLocalSourcePath(url, brandId, sourcePostId) {
  if (typeof url !== "string" || !url.startsWith("/uploads/")) {
    return { valid: false, error: "URL must start with /uploads/." };
  }

  // Reject path traversal
  if (url.includes("..") || url.includes("%2e") || url.includes("%2E")) {
    return { valid: false, error: "Path traversal detected." };
  }

  // Reject absolute filesystem paths disguised as local
  if (url.startsWith("//") || /^[a-zA-Z]:\\/.test(url)) {
    return { valid: false, error: "Absolute filesystem path rejected." };
  }

  // Expected: /uploads/{brandId}/published-posts/{sourcePostId}/filename
  const parts = url.split("/");
  // parts: ["", "uploads", brandId, "published-posts", sourcePostId, "filename"]
  if (parts.length < 6) {
    return { valid: false, error: "URL path is too short." };
  }

  if (parts[1] !== "uploads") {
    return { valid: false, error: "URL must be under /uploads/." };
  }

  if (parts[2] !== brandId) {
    return { valid: false, error: "Brand ID mismatch in local URL." };
  }

  if (parts[3] !== "published-posts") {
    return { valid: false, error: "URL must be under published-posts." };
  }

  if (parts[4] !== sourcePostId) {
    return { valid: false, error: "Source post ID mismatch in local URL." };
  }

  const fileName = parts.slice(5).join("/");
  if (!fileName) {
    return { valid: false, error: "Missing file name in local URL." };
  }

  return { valid: true, fileName };
}

/**
 * Copies a source post's local media file into the target post's local
 * media directory. Returns the target-relative URL path.
 *
 * @param {object} options
 * @param {string} options.sourceUrl      - Local URL like /uploads/{brandId}/.../{file}
 * @param {string} options.brandId
 * @param {string} options.sourcePostId
 * @param {string} options.targetPostId
 * @param {number} options.order          - Media order (for unique filename)
 * @param {string} [options.mediaType]    - IMAGE or VIDEO (for prefix)
 * @returns {Promise<{ url: string, fileName: string, localPath: string }>}
 */
export async function copyMediaToTarget({ sourceUrl, brandId, sourcePostId, targetPostId, order, mediaType }) {
  const { copyFile, mkdir } = await import("fs/promises");
  const pathMod = await import("path");

  const validation = validateLocalSourcePath(sourceUrl, brandId, sourcePostId);
  if (!validation.valid) {
    throw Object.assign(new Error(validation.error), { code: "INVALID_LOCAL_PATH" });
  }

  const sourceFileName = validation.fileName;
  const cwd = process.cwd();
  const sourceDir = pathMod.default.join(cwd, "public", "uploads", brandId, "published-posts", sourcePostId);
  const sourcePath = pathMod.default.join(sourceDir, sourceFileName);

  // Verify source file exists and is a regular file
  const exists = await statSafe(sourcePath);
  if (!exists) {
    throw Object.assign(
      new Error(`Source media file not found: ${sourcePath}`),
      { code: "SOURCE_FILE_MISSING" },
    );
  }

  // Build target path
  const prefix = mediaType === "IMAGE" ? "image" : mediaType === "VIDEO" ? "video" : "media";
  const ext = pathMod.default.extname(sourceFileName) || "";
  const targetFileName = `${prefix}_copy_${order}_${Date.now()}_${Math.floor(Math.random() * 10000)}${ext}`;
  const targetDir = pathMod.default.join(cwd, "public", "uploads", brandId, "published-posts", targetPostId);
  const targetPath = pathMod.default.join(targetDir, targetFileName);

  // Ensure target directory exists
  await mkdir(targetDir, { recursive: true });

  // Copy file
  await copyFile(sourcePath, targetPath);

  const targetUrl = `/uploads/${brandId}/published-posts/${targetPostId}/${targetFileName}`;

  return { url: targetUrl, fileName: targetFileName, localPath: targetPath };
}
