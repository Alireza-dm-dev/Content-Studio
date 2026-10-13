/**
 * Brand Forum — shared server helpers (validation, storage, serialization).
 *
 * Routes stay thin; everything testable without a request lives here.
 * Files are stored under public/uploads/<brandId>/forum/<postId>/ so the
 * membership check in proxy.js (which gates /uploads/<brandId>/...) covers
 * forum media automatically.
 */

import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";

export const FORUM_PAGE_SIZE = 20;
export const MAX_POST_BODY = 5000;
export const MAX_REPLY_BODY = 2000;
export const MAX_ATTACHMENTS_PER_POST = 6;
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
export const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100 MB, same ceiling as published posts

// extension → { mime types the browser may report, media type }
const ALLOWED = {
  ".jpg": { mimes: ["image/jpeg"], type: "IMAGE" },
  ".jpeg": { mimes: ["image/jpeg"], type: "IMAGE" },
  ".png": { mimes: ["image/png"], type: "IMAGE" },
  ".webp": { mimes: ["image/webp"], type: "IMAGE" },
  ".gif": { mimes: ["image/gif"], type: "IMAGE" },
  ".mp4": { mimes: ["video/mp4"], type: "VIDEO" },
  ".webm": { mimes: ["video/webm"], type: "VIDEO" },
  ".mov": { mimes: ["video/quicktime"], type: "VIDEO" },
};

export const FORUM_ACCEPT = Object.keys(ALLOWED).join(",");

export function forumUploadDir(brandId, postId) {
  return path.join(process.cwd(), "public", "uploads", brandId, "forum", postId);
}

export function forumUploadUrl(brandId, postId, storedName) {
  return `/uploads/${brandId}/forum/${postId}/${storedName}`;
}

/** Display-only name. Never used to build a path. */
export function sanitizeFileName(name) {
  const base = String(name ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return cleaned || "file";
}

function hasSignature(bytes, ext) {
  const b = bytes;
  const ascii = (start, len) => Buffer.from(b.subarray(start, start + len)).toString("latin1");
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case ".png":
      return b[0] === 0x89 && ascii(1, 3) === "PNG";
    case ".gif":
      return ascii(0, 4) === "GIF8";
    case ".webp":
      return ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP";
    case ".mp4":
    case ".mov":
      return ascii(4, 4) === "ftyp";
    case ".webm":
      return b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
    default:
      return false;
  }
}

/**
 * Validate one uploaded File. Extension and reported MIME must agree, the size
 * must fit the per-type ceiling, and the leading bytes must match the format.
 * Returns { ok:true, ext, type, bytes } or { ok:false, error }.
 */
export async function validateForumFile(file) {
  const label = sanitizeFileName(file?.name);
  const ext = path.extname(label).toLowerCase();
  const rule = ALLOWED[ext];
  if (!rule) {
    return { ok: false, error: `"${label}" is not a supported file type. Use JPG, PNG, WebP, GIF, MP4, WebM or MOV.` };
  }
  if (!rule.mimes.includes(String(file.type ?? "").toLowerCase())) {
    return { ok: false, error: `"${label}" does not look like a valid ${ext.slice(1).toUpperCase()} file.` };
  }
  const limit = rule.type === "IMAGE" ? MAX_IMAGE_SIZE : MAX_VIDEO_SIZE;
  if (file.size > limit) {
    return { ok: false, error: `"${label}" is too large. Maximum is ${limit / (1024 * 1024)} MB for ${rule.type.toLowerCase()}s.` };
  }
  if (file.size === 0) return { ok: false, error: `"${label}" is empty.` };
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!hasSignature(bytes, ext)) {
    return { ok: false, error: `"${label}" does not look like a valid ${ext.slice(1).toUpperCase()} file.` };
  }
  return { ok: true, ext, type: rule.type, bytes, mimeType: rule.mimes[0], fileName: label };
}

/** Write validated files to disk. Stored names are random; user names never touch the path. */
export async function saveForumFiles(brandId, postId, validated) {
  const dir = forumUploadDir(brandId, postId);
  await mkdir(dir, { recursive: true });
  const saved = [];
  for (const v of validated) {
    const storedName = `${randomUUID()}${v.ext}`;
    await writeFile(path.join(dir, storedName), v.bytes);
    saved.push({
      type: v.type,
      fileName: v.fileName,
      filePath: forumUploadUrl(brandId, postId, storedName),
      mimeType: v.mimeType,
      fileSize: v.bytes.length,
    });
  }
  return saved;
}

/**
 * Remove ONLY this post's forum directory. Failure is logged and swallowed so
 * it can never undo the database operation that already succeeded.
 */
export async function deleteForumPostFiles(brandId, postId) {
  try {
    await rm(forumUploadDir(brandId, postId), { recursive: true, force: true });
  } catch (err) {
    console.error("[BrandForum] file cleanup failed", { postId, message: err?.message });
  }
}

/** Trim + length-check user text. React escapes on render; nothing is stored as HTML. */
export function normalizeText(value, max) {
  if (value == null) return { ok: true, text: "" };
  if (typeof value !== "string") return { ok: false, error: "Text must be a string." };
  const text = value.replace(/\r\n/g, "\n").trim();
  if (text.length > max) return { ok: false, error: `Text is too long (max ${max} characters).` };
  return { ok: true, text };
}

/** Author snapshot: name → email → "User". Only these fields are ever copied. */
export function authorSnapshot(user) {
  const name = String(user?.name ?? "").trim() || String(user?.email ?? "").trim() || "User";
  return { authorName: name, authorRole: user?.role === "admin" ? "admin" : "user" };
}

function serializeAuthor(row) {
  return {
    id: row.authorId ?? null,
    name: row.authorName || "User",
    role: row.authorRole === "admin" ? "admin" : "user",
  };
}

export function canDeleteForumItem(viewer, row) {
  if (!viewer) return false;
  if (viewer.role === "admin") return true;
  return Boolean(row.authorId) && row.authorId === viewer.id;
}

/** Whitelist serializer — the only shape that reaches the client. */
export function serializeForumPost(post, viewer) {
  return {
    id: post.id,
    body: post.body,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    author: serializeAuthor(post),
    canDelete: canDeleteForumItem(viewer, post),
    attachments: (post.attachments ?? []).map((a) => ({
      id: a.id,
      type: a.type,
      url: a.filePath,
      fileName: a.fileName,
    })),
    replies: (post.replies ?? []).map((r) => ({
      id: r.id,
      body: r.body,
      createdAt: r.createdAt,
      author: serializeAuthor(r),
      canDelete: canDeleteForumItem(viewer, r),
    })),
  };
}
