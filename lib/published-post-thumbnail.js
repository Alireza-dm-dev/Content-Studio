/**
 * Instagram Published Post thumbnail / cover image.
 *
 * Storage reuses the existing Published Post convention: the file sits next to
 * the post's media in public/uploads/<brandId>/published-posts/<postId>/ and its
 * local path lives in PublishedPost.thumbnailUrl. The outbound n8n contract
 * (jsonPayload.thumbnail_url) and the SFTP upload of the thumbnail already exist;
 * this module only adds strict validation and safe replace/remove on disk.
 */

import path from "node:path";
import crypto from "node:crypto";
import { mkdir, writeFile, readdir, unlink } from "node:fs/promises";
import { validateForumFile, sanitizeFileName, MAX_IMAGE_SIZE } from "./brand-forum.js";

const THUMBNAIL_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
export const THUMBNAIL_MAX_BYTES = MAX_IMAGE_SIZE; // 10 MB, the app's standard image ceiling
export const THUMBNAIL_ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

// Ids are cuids/uuids from our own DB; anything else could escape the uploads root.
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;

// Only files this feature (or the original create path) wrote. Media files are
// named "<timestamp>-<i>-<name>" so they can never match.
const THUMBNAIL_FILE = /^thumbnail(-[0-9a-f-]{36})?\.(jpe?g|png|webp|gif|avif)$/i;

/** A browser sends an empty, unnamed File when no file was picked. */
export function isNoFile(file) {
  return !file || typeof file === "string" || (file.size === 0 && !file.name);
}

/**
 * JPG/JPEG, PNG or WebP up to 10 MB. Extension/MIME agreement, zero-byte and
 * magic-byte checks come from the shared Forum validator.
 * Returns { ok:true, ext, bytes, mimeType, fileName } or { ok:false, error }.
 */
export async function validateThumbnailFile(file) {
  if (isNoFile(file)) return { ok: false, error: "A thumbnail image file is required." };
  const label = sanitizeFileName(file.name);
  const ext = path.extname(label).toLowerCase();
  if (!THUMBNAIL_EXTENSIONS.has(ext)) {
    return { ok: false, error: `"${label}" is not a supported thumbnail. Use JPG, PNG or WebP.` };
  }
  return validateForumFile(file);
}

export function publishedPostUploadDir(brandId, postId) {
  if (!SAFE_SEGMENT.test(brandId) || !SAFE_SEGMENT.test(postId)) throw new Error("Invalid storage id");
  return path.join(process.cwd(), "public", "uploads", brandId, "published-posts", postId);
}

/** Write a validated thumbnail under a random name; returns its /uploads URL. */
export async function saveThumbnailFile(brandId, postId, validated) {
  const dir = publishedPostUploadDir(brandId, postId);
  const name = `thumbnail-${crypto.randomUUID()}${validated.ext}`;
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), validated.bytes);
  return `/uploads/${brandId}/published-posts/${postId}/${name}`;
}

/**
 * Remove this post's local thumbnail file(s): all of them except `keepUrl`,
 * or only `onlyUrl` (rollback of a just-written file).
 * Never touches media files or anything outside the post's own directory.
 */
export async function removeThumbnailFiles(brandId, postId, { keepUrl, onlyUrl } = {}) {
  const dir = publishedPostUploadDir(brandId, postId);
  const keep = typeof keepUrl === "string" ? keepUrl.split("/").pop() : null;
  const only = typeof onlyUrl === "string" ? onlyUrl.split("/").pop() : null;
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return 0; }
  let removed = 0;
  for (const e of entries) {
    if (!e.isFile() || e.name === keep || !THUMBNAIL_FILE.test(e.name)) continue;
    if (only && e.name !== only) continue;
    try { await unlink(path.join(dir, e.name)); removed++; } catch {}
  }
  return removed;
}
