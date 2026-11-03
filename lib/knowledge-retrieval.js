// Shared, dependency-free text retrieval primitives (tokenizing, chunking, scoring).
// Used by the Brand Assistant context builder and by Brand Knowledge retrieval so the
// two never drift into separate engines. Unicode-aware: works for Latin, Persian/Farsi
// and other scripts. Zero-width non-joiner (U+200C) splits words exactly like a space,
// so "می‌خواهم" and "می خواهم" produce identical tokens.

export const CHUNK_CHARS = 1200;
export const CHUNK_OVERLAP = 150;

export const STOP_WORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with",
  "without","is","are","was","were","be","been","being","have","has","had",
  "do","does","did","will","would","could","should","may","might","shall",
  "can","need","about","after","before","by","from","into","over","this",
  "that","these","those","it","its","what","which","who","whom","how","why",
  "when","where","we","our","us","you","your","me","my","i","make","write",
  "give","please","more","some","any","one","like","want",
]);

// Arabic-script variants that Persian text mixes freely, plus tatweel and diacritics.
function normalizeScript(text) {
  return String(text)
    .replace(/[يى]/g, "ی") // ي ى → ی
    .replace(/ك/g, "ک") // ك → ک
    .replace(/[ـً-ٰٟ]/g, "") // tatweel + harakat
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0)) // Persian digits → ASCII
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)); // Arabic-Indic digits → ASCII
}

export function stem(w) {
  return w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
}

export function tokenize(text) {
  if (!text) return [];
  return (normalizeScript(String(text).toLowerCase()).match(/[\p{L}\p{N}]+/gu) || []).map(stem);
}

export function extractKeywords(text) {
  return [...new Set(tokenize(text).filter((w) => w.length >= 2 && !STOP_WORDS.has(w)))];
}

export function scoreRelevance(text, keywords) {
  if (!keywords.length || !text) return 0;
  const tokens = new Set(tokenize(text));
  let score = 0;
  for (const kw of keywords) if (tokens.has(kw)) score++;
  return score;
}

export function chunkText(text, size = CHUNK_CHARS, overlap = CHUNK_OVERLAP) {
  const clean = String(text).replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  const chunks = [];
  for (let i = 0; i < clean.length; i += size - overlap) {
    chunks.push(clean.slice(i, i + size));
    if (i + size >= clean.length) break;
  }
  return chunks;
}
