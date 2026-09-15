import path from "path";
import Client from "ssh2-sftp-client";

const SFTP_CONNECT_TIMEOUT = 15000;
const UPLOAD_TIMEOUT_MIN_MS = 120000;
// The browser aborts the whole request at 660s (CLIENT_FETCH_TIMEOUT in the
// upload forms), and that budget also covers the inbound browser -> app upload.
// Cap a single attempt at 240s so an attempt plus one retry still fits.
const UPLOAD_TIMEOUT_MAX_MS = 240000;
const UPLOAD_ASSUMED_BYTES_PER_SEC = 128 * 1024;
// Abort as soon as the transfer stops making progress rather than waiting out
// the full deadline, so a dead link fails fast and leaves budget for the retry.
const UPLOAD_STALL_TIMEOUT_MS = 45000;
const UPLOAD_PROGRESS_POLL_MS = 5000;
// fastPut writes chunks in parallel instead of serially, which is what makes
// large videos finish inside the deadline on a high-latency link. 32 KB is the
// largest packet size SFTP servers reliably accept.
const UPLOAD_FASTPUT_CHUNK_SIZE = 32 * 1024;
const UPLOAD_FASTPUT_CONCURRENCY = 64;

// fastPut depends on server capabilities the SFTP protocol does not advertise.
// The first failure that is not our own abort flips this off for the life of
// the process so every later file goes straight to the stream path.
let fastPutSupported = true;

function calcUploadTimeout(fileSizeBytes) {
  return Math.max(
    UPLOAD_TIMEOUT_MIN_MS,
    Math.min(
      UPLOAD_TIMEOUT_MAX_MS,
      30000 + Math.ceil(fileSizeBytes / UPLOAD_ASSUMED_BYTES_PER_SEC) * 1000,
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

/**
 * Size of a file on the remote host, or -1 when it cannot be stat'd.
 * Used to prove an upload actually transferred every byte.
 */
async function getRemoteSize(client, remotePath) {
  try {
    const s = await client.stat(remotePath);
    return typeof s?.size === "number" ? s.size : -1;
  } catch {
    return -1;
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
    m.includes("stalled") ||
    m.includes("size mismatch") ||
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
  if (m.includes("size mismatch")) return "SFTP_SIZE_MISMATCH";
  if (m.includes("timed out") || m.includes("timeout") || m.includes("stalled")) return "SFTP_UPLOAD_TIMEOUT";
  if (m.includes("permission denied")) return "SFTP_REMOTE_PERMISSION_DENIED";
  if (m.includes("authentication") || m.includes("auth")) return "SFTP_AUTH_FAILED";
  if (m.includes("enoent") || m.includes("not found") || m.includes("no such file")) return "SFTP_LOCAL_FILE_MISSING";
  return "SFTP_UPLOAD_FAILED";
}

/**
 * Enforces the per-attempt deadline and the stall timeout for one transfer.
 * `readProgress` is polled instead of using a progress event so the stream
 * path can read `source.bytesRead` — attaching a "data" listener would switch
 * the stream to flowing mode before put() pipes it and drop the leading chunks.
 */
function makeTransferGuard({ timeoutMs, fileSize, readProgress, onAbort }) {
  let abortReason = null;
  let lastBytes = 0;
  let lastProgressAt = Date.now();

  const abort = (reason) => {
    if (abortReason) return;
    abortReason = reason;
    onAbort(reason);
  };

  const deadline = setTimeout(
    () => abort(`SFTP upload timed out after ${timeoutMs}ms`),
    timeoutMs,
  );
  const stallCheck = setInterval(() => {
    const sent = readProgress();
    if (sent > lastBytes) {
      lastBytes = sent;
      lastProgressAt = Date.now();
      return;
    }
    if (Date.now() - lastProgressAt >= UPLOAD_STALL_TIMEOUT_MS) {
      abort(`SFTP upload stalled for ${UPLOAD_STALL_TIMEOUT_MS}ms at ${sent}/${fileSize} bytes`);
    }
  }, UPLOAD_PROGRESS_POLL_MS);

  return {
    get abortReason() {
      return abortReason;
    },
    get bytesSent() {
      return Math.max(lastBytes, readProgress());
    },
    stop() {
      clearTimeout(deadline);
      clearInterval(stallCheck);
    },
  };
}

/**
 * Serial upload through put(). The source stream doubles as the cancellation
 * handle: destroying it rejects put() and tears down only this transfer,
 * leaving the connection usable. Slower than fastPut, used as the fallback.
 */
async function transferViaStream(client, localPath, remotePath, timeoutMs, fileSize) {
  const { createReadStream } = await import("fs");
  const source = createReadStream(localPath);
  const guard = makeTransferGuard({
    timeoutMs,
    fileSize,
    readProgress: () => source.bytesRead,
    onAbort: (reason) => source.destroy(new Error(reason)),
  });

  try {
    await client.put(source, remotePath);
    return guard.bytesSent;
  } catch (err) {
    throw guard.abortReason ? new Error(guard.abortReason) : err;
  } finally {
    guard.stop();
    if (!source.destroyed) source.destroy();
  }
}

/**
 * Parallel chunked upload through ssh2's fastPut — several times faster than a
 * serial stream on a high-latency link, which is what keeps large videos inside
 * the deadline.
 *
 * fastPut exposes no abort handle, so the only way to stop it is closing the
 * connection, which can leave a partial file behind. That is safe here because
 * the caller verifies the remote size afterwards and the retry path reconnects
 * and deletes the partial before trying again.
 */
async function transferViaFastPut(client, localPath, remotePath, timeoutMs, fileSize) {
  let transferred = 0;
  const guard = makeTransferGuard({
    timeoutMs,
    fileSize,
    readProgress: () => transferred,
    onAbort: () => {
      client.end().catch(() => {});
    },
  });

  try {
    await client.fastPut(localPath, remotePath, {
      chunkSize: UPLOAD_FASTPUT_CHUNK_SIZE,
      concurrency: UPLOAD_FASTPUT_CONCURRENCY,
      step: (totalTransferred) => {
        transferred = totalTransferred;
      },
    });
    return guard.bytesSent;
  } catch (err) {
    if (guard.abortReason) {
      // We closed the connection ourselves, so this client is unusable and the
      // stream fallback cannot run on it. Flagged so the caller reconnects
      // instead of misreading this as a fastPut capability problem.
      throw Object.assign(new Error(guard.abortReason), { aborted: true });
    }
    throw err;
  } finally {
    guard.stop();
  }
}

async function attemptUpload(client, localPath, remotePath, timeoutMs, rec, fileSize, isRetry) {
  const start = Date.now();
  let method = fastPutSupported ? "fastPut" : "put";
  let bytesSent = 0;

  try {
    if (fastPutSupported) {
      try {
        bytesSent = await transferViaFastPut(client, localPath, remotePath, timeoutMs, fileSize);
      } catch (fastErr) {
        if (fastErr.aborted) throw fastErr;
        fastPutSupported = false;
        method = "put";
        console.warn("[PublishedPosts] fastPut unavailable, falling back to stream upload", {
          error: fastErr.message,
        });
        await client.delete(remotePath).catch(() => {});
        bytesSent = await transferViaStream(client, localPath, remotePath, timeoutMs, fileSize);
      }
    } else {
      bytesSent = await transferViaStream(client, localPath, remotePath, timeoutMs, fileSize);
    }

    // Both transfer methods can report success on a partial write: put()
    // resolves when the remote write stream emits "close", which also fires on
    // a mid-transfer disconnect. Without this check a truncated file is stored
    // as a successful upload and its URL is written to the database.
    const remoteSize = await getRemoteSize(client, remotePath);
    if (remoteSize !== fileSize) {
      throw new Error(
        `SFTP upload size mismatch: expected ${fileSize} bytes, remote has ${remoteSize}`,
      );
    }

    const duration = Date.now() - start;
    console.log("[PublishedPosts] SFTP upload completed", {
      mediaOrder: rec.order,
      remotePath,
      fileSize,
      method,
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
      remotePath,
      fileSize,
      bytesSent,
      method,
      timeoutMs,
      duration,
      retry: isRetry,
      detailCode,
      error: message,
    });
    return { ok: false, detailCode, duration, error: err };
  }
}

/**
 * Removes a partial remote file, reconnecting if the caller's client is dead.
 * Aborting a fastPut transfer closes the connection, so the obvious
 * `client.delete()` would silently fail and leave the partial file behind
 * under a URL that was already generated.
 */
async function deleteRemoteQuietly(cfg, client, remotePath) {
  try {
    await client.delete(remotePath);
    return;
  } catch {
    // Fall through and retry on a fresh connection.
  }

  const cleanup = new Client();
  try {
    await cleanup.connect({
      host: cfg.host,
      port: cfg.port,
      username: cfg.user,
      password: cfg.password,
      readyTimeout: SFTP_CONNECT_TIMEOUT,
    });
    await cleanup.delete(remotePath);
  } catch (err) {
    console.warn("[PublishedPosts] could not remove partial remote file", {
      remotePath,
      error: (err && err.message) || "",
    });
  } finally {
    await cleanup.end().catch(() => {});
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
      currentClient, localPath, remotePath, timeoutMs, rec, fileSize, isRetry,
    );

    if (result.ok) {
      return { ok: true, client: currentClient, usedRetry };
    }

    const shouldRetry = !isRetry && isTransientError(result.error && result.error.message);

    if (!shouldRetry) {
      // Never leave a partial file behind for a URL that was already handed out.
      await deleteRemoteQuietly(cfg, currentClient, remotePath);
      const err = result.error || new Error(result.detailCode);
      throw Object.assign(err, {
        detailCode: result.detailCode,
        fileSize,
        timeoutMs,
        duration: result.duration,
        retryCount: usedRetry ? 1 : 0,
        // Surfaced so the caller can close the connection this retry opened —
        // it is not the client the caller is still holding.
        client: currentClient,
      });
    }
  }

  const err = new Error("SFTP upload failed after retry");
  throw Object.assign(err, {
    detailCode: "SFTP_UPLOAD_TIMEOUT",
    fileSize,
    timeoutMs,
    retryCount: 1,
    client: currentClient,
  });
}

export async function uploadPublishedPostMedia({ post, mediaRecords, brandId }) {
  const cfg = getEnvConfig();
  if (!cfg.host || !cfg.user || !cfg.password) {
    const missingEnv = [
      !cfg.host && "PUBLISHED_MEDIA_FTP_HOST",
      !cfg.user && "PUBLISHED_MEDIA_FTP_USER",
      !cfg.password && "PUBLISHED_MEDIA_FTP_PASSWORD",
    ].filter(Boolean);
    console.error("[PublishedPosts] SFTP not configured, skipping remote media upload", {
      postId: post?.id,
      brandId,
      missingEnv,
    });
    return {
      success: false,
      skipped: true,
      detailCode: "SFTP_NOT_CONFIGURED",
      error: "Missing SFTP env vars: " + missingEnv.join(", "),
    };
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
  // Hoisted so the catch block can close whichever connection is actually open —
  // a retry inside uploadSingleFileWithRetry replaces this with a new client.
  let currentClient = client;

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

        // Same truncation risk as the media files: verify before publishing a URL.
        const thumbSize = await getFileSize(thumbLocalPath);
        const remoteThumbSize = await getRemoteSize(currentClient, remotePath);
        if (remoteThumbSize !== thumbSize) {
          await currentClient.delete(remotePath).catch(() => {});
          throw new Error(
            `SFTP upload size mismatch: expected ${thumbSize} bytes, remote has ${remoteThumbSize}`,
          );
        }

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
    // A failed retry carries its own connection, which is neither `client` nor
    // the `currentClient` this scope knows about. Close every one we can see.
    if (error?.client && error.client !== currentClient) {
      await error.client.end().catch(() => {});
    }
    if (currentClient !== client) {
      await currentClient.end().catch(() => {});
    }
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
