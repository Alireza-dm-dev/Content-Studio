/**
 * Story Contents — manual Instagram Story handoff.
 *
 * A creator uploads ordered Story assets for a calendar date; whoever publishes
 * downloads them and uploads to Instagram by hand, then marks the day UPLOADED.
 * Nothing here publishes: no n8n, no Instagram API, no PublishedPost.
 *
 * Dates are plain "YYYY-MM-DD" calendar dates with no timezone attached.
 */

import path from "node:path";
import { validateForumFile, sanitizeFileName, normalizeText } from "./brand-forum.js";

export { parseStoryDate, parseStoryMonth, buildMonthGrid, shiftMonth } from "./story-content-dates.js";

export const STORY_STATUSES = ["READY", "UPLOADED"];
export const MAX_STORY_ASSETS = 20;
export const MAX_STORY_COMMENTS = 5000;

// Instagram Story formats only. Size ceilings and magic-byte checks come from
// the Forum validator (images 10 MB, videos 100 MB).
const STORY_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov"]);
export const STORY_ACCEPT = [...STORY_EXTENSIONS].join(",");

export function normalizeComments(value) {
  const r = normalizeText(value, MAX_STORY_COMMENTS);
  if (!r.ok) return r;
  return { ok: true, text: r.text || null };
}

/**
 * Validate one Story asset. Extension allow-list first, then the shared Forum
 * checks (extension/MIME agreement, size, zero-byte, file signature).
 */
export async function validateStoryFile(file) {
  const label = sanitizeFileName(file?.name);
  const ext = path.extname(label).toLowerCase();
  if (!STORY_EXTENSIONS.has(ext)) {
    return { ok: false, error: `"${label}" is not a supported Story file. Use JPG, PNG, WebP, MP4 or MOV.` };
  }
  return validateForumFile(file);
}

export function displayName(user) {
  return String(user?.name ?? "").trim() || String(user?.email ?? "").trim() || "User";
}

/** Lightweight shape for the month grid. */
export function serializeStoryDaySummary(row) {
  return {
    id: row.id,
    storyDate: row.storyDate,
    status: row.status,
    assetCount: row._count?.assets ?? row.assets?.length ?? 0,
  };
}

/** Full shape for an opened day. Never includes storedPath or user ids. */
export function serializeStoryDay(row, brandId) {
  const base = `/api/brands/${brandId}/story-content/${row.id}/assets`;
  return {
    id: row.id,
    storyDate: row.storyDate,
    status: row.status,
    comments: row.comments ?? "",
    createdByName: row.createdByName,
    completedByName: row.status === "UPLOADED" ? row.completedByName ?? null : null,
    completedAt: row.status === "UPLOADED" ? row.completedAt ?? null : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    assets: (row.assets ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((a, i) => ({
        id: a.id,
        position: i + 1,
        fileName: a.originalFileName,
        mimeType: a.mimeType,
        mediaType: a.mediaType,
        fileSize: a.fileSize,
        uploadedByName: a.uploadedByName,
        createdAt: a.createdAt,
        url: `${base}/${a.id}`,
        downloadUrl: `${base}/${a.id}?download=1`,
      })),
  };
}
