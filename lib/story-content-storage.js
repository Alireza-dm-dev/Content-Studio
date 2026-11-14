import { mkdir, writeFile, unlink, rm, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import crypto from "node:crypto";

// Private storage: never under public/, only reachable through the
// brand-authorized asset route.
export const STORY_STORAGE_ROOT = path.join(process.cwd(), ".data", "story-content");

// Ids are cuids from our own DB; reject anything that could escape the root.
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;

/** storedPath is relative to .data/, e.g. "story-content/<brandId>/<storyId>/<uuid>.png". */
export async function saveStoryFile(brandId, storyId, extension, buffer) {
  if (!SAFE_SEGMENT.test(brandId) || !SAFE_SEGMENT.test(storyId)) throw new Error("Invalid storage id");
  const name = crypto.randomUUID() + extension;
  const dir = path.join(STORY_STORAGE_ROOT, brandId, storyId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), buffer);
  return `story-content/${brandId}/${storyId}/${name}`;
}

export function resolveStoryPath(storedPath) {
  if (typeof storedPath !== "string") return null;
  const abs = path.resolve(process.cwd(), ".data", storedPath);
  return abs.startsWith(STORY_STORAGE_ROOT + path.sep) ? abs : null;
}

// Best-effort: the DB row is the source of truth, so a failed unlink only
// leaves an orphan file that nothing can reach.
export async function removeStoryFile(storedPath) {
  const abs = resolveStoryPath(storedPath);
  if (!abs) return false;
  try { await unlink(abs); return true; } catch { return false; }
}

export async function removeStoryDayDir(brandId, storyId) {
  if (!SAFE_SEGMENT.test(brandId) || !SAFE_SEGMENT.test(storyId)) return;
  try { await rm(path.join(STORY_STORAGE_ROOT, brandId, storyId), { recursive: true, force: true }); } catch {}
}

export async function removeBrandStoryDir(brandId) {
  if (!SAFE_SEGMENT.test(brandId)) return;
  try { await rm(path.join(STORY_STORAGE_ROOT, brandId), { recursive: true, force: true }); } catch {}
}

function contentDisposition(kind, fileName) {
  const ascii = String(fileName).replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * Stream a stored asset. Supports single byte ranges so video previews can seek
 * (Safari requires it). Returns a Response, or null when the file is missing.
 */
export async function streamStoryFile({ storedPath, mimeType, fileName, download, rangeHeader }) {
  const abs = resolveStoryPath(storedPath);
  if (!abs) return null;
  let info;
  try { info = await stat(abs); } catch { return null; }
  const size = info.size;

  const headers = {
    "Content-Type": mimeType,
    "Content-Disposition": contentDisposition(download ? "attachment" : "inline", fileName),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
    "Accept-Ranges": "bytes",
  };

  const m = typeof rangeHeader === "string" ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null;
  if (m && (m[1] !== "" || m[2] !== "")) {
    let start;
    let end;
    if (m[1] === "") {
      const suffix = Number(m[2]);
      start = Math.max(0, size - suffix);
      end = size - 1;
    } else {
      start = Number(m[1]);
      end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
    }
    if (!(start <= end) || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const body = Readable.toWeb(createReadStream(abs, { start, end }));
    return new Response(body, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }

  const body = Readable.toWeb(createReadStream(abs));
  return new Response(body, { status: 200, headers: { ...headers, "Content-Length": String(size) } });
}
