import { mkdir, writeFile, unlink, rm } from "fs/promises";
import path from "path";
import crypto from "crypto";

// Private storage: never under public/, never served by URL.
export const KNOWLEDGE_STORAGE_ROOT = path.join(process.cwd(), ".data", "brand-knowledge");

// storedPath is relative to .data/ e.g. "brand-knowledge/<brandId>/<uuid>.pdf".
export async function saveKnowledgeFile(brandId, extension, buffer) {
  const name = crypto.randomUUID() + extension;
  const dir = path.join(KNOWLEDGE_STORAGE_ROOT, brandId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), buffer);
  return `brand-knowledge/${brandId}/${name}`;
}

function resolveStored(storedPath) {
  const abs = path.resolve(process.cwd(), ".data", storedPath);
  return abs.startsWith(KNOWLEDGE_STORAGE_ROOT + path.sep) ? abs : null;
}

// Best-effort: the DB row is the source of truth for retrieval, so a failed unlink
// only leaves an orphan file and never keeps the document available to the AI.
export async function removeKnowledgeFile(storedPath) {
  const abs = resolveStored(storedPath);
  if (!abs) return false;
  try { await unlink(abs); return true; } catch { return false; }
}

export async function removeBrandKnowledgeDir(brandId) {
  try { await rm(path.join(KNOWLEDGE_STORAGE_ROOT, brandId), { recursive: true, force: true }); } catch {}
}
