import path from "path";
import Client from "ssh2-sftp-client";

function getEnvConfig() {
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

function makeFileUrl(publicBase, folderName, fileName) {
  return `${publicBase}/${folderName}/${fileName}`;
}

function getPrefix(mediaType) {
  if (mediaType === "IMAGE") return "image";
  if (mediaType === "VIDEO") return "video";
  if (mediaType === "document") return "document";
  return "thumbnail";
}

/**
 * Upload published-post media files to the remote SFTP server.
 *
 * Returns structured result:
 *   { success: true, folder, media: [...], thumbnailUrl }
 *   { success: false, skipped: true }
 *   { success: false, error, code, details }
 */
export async function uploadPublishedPostMedia({ post, mediaRecords, brandId }) {
  const cfg = getEnvConfig();
  if (!cfg.host) {
    return { success: false, skipped: true };
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

  const client = new Client();

  try {
    await client.connect({
      host: cfg.host,
      port: cfg.port,
      username: cfg.user,
      password: cfg.password,
    });

    // Create remote directory (recursive)
    try {
      await client.mkdir(remoteDir, true);
    } catch {
      // directory may already exist — proceed
    }

    const remoteMedia = [];
    for (const rec of mediaRecords) {
      const localFileName = rec.url.split("/").pop();
      const localPath = path.join(localDir, localFileName);
      const ext = path.extname(localFileName) || "";
      const prefix = getPrefix(rec.mediaType);
      const fileName = makeFileName(prefix, folderName, rec.order, ext);
      const remotePath = makeRemotePath(cfg.remoteBase, folderName, fileName);

      await client.put(localPath, remotePath);

      remoteMedia.push({
        order: rec.order,
        mediaType: rec.mediaType,
        fileName,
        folder: folderName,
        remotePath,
        fileUrl: makeFileUrl(cfg.publicBase, folderName, fileName),
      });
    }

    // Upload thumbnail if present (best-effort)
    let remoteThumbnailUrl = null;
    if (post.thumbnailUrl) {
      try {
        const thumbFileName = post.thumbnailUrl.split("/").pop();
        const thumbLocalPath = path.join(localDir, thumbFileName);
        const ext = path.extname(thumbFileName) || ".jpg";
        const fileName = makeFileName("thumbnail", folderName, 0, ext);
        const remotePath = makeRemotePath(cfg.remoteBase, folderName, fileName);

        await client.put(thumbLocalPath, remotePath);
        remoteThumbnailUrl = makeFileUrl(cfg.publicBase, folderName, fileName);
      } catch (err) {
        console.warn("[PublishedPosts] thumbnail remote upload failed, skipping", {
          error: err.message,
          code: err.code,
        });
      }
    }

    await client.end();

    return {
      success: true,
      folder: folderName,
      media: remoteMedia,
      thumbnailUrl: remoteThumbnailUrl,
    };
  } catch (error) {
    await client.end().catch(() => {});
    console.error("[PublishedPosts] remote media upload failed", {
      error: error.message,
      code: error.code,
      hostConfigured: Boolean(cfg.host),
      port: cfg.port,
      remoteBase: cfg.remoteBase,
      mediaCount: mediaRecords.length,
    });
    return {
      success: false,
      error: error.message,
      code: error.code,
      details: error.message,
    };
  }
}
