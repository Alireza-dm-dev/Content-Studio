// SHA-256 hex digest via Web Crypto. Isomorphic (browser + Node), so the
// browser and the server compute identical digests for the same file bytes.
// Browsers expose crypto.subtle only in secure contexts (HTTPS or localhost).

export function contentDigestAvailable() {
  return Boolean(globalThis.crypto?.subtle?.digest);
}

/** data: ArrayBuffer | TypedArray | string (UTF-8). */
export async function sha256Hex(data) {
  if (!contentDigestAvailable()) throw new Error("CONTENT_DIGEST_UNAVAILABLE");
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const buf = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
