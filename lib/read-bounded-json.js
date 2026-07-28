/**
 * Reads a Request body as bounded JSON, enforcing a size limit while streaming.
 *
 * - Content-Length above maxBytes: rejected immediately without reading.
 * - Chunked body crossing maxBytes: reader cancelled, 413 returned.
 * - Malformed or empty body: 400 returned.
 * - Valid bounded JSON: { body: <parsed object> } returned.
 */

export const PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE";
export const INVALID_JSON = "INVALID_JSON";
export const EMPTY_BODY = "EMPTY_BODY";

export async function readBoundedJsonBody(request, maxBytes) {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const parsed = Number.parseInt(contentLength, 10);
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed > maxBytes) {
      return { error: PAYLOAD_TOO_LARGE };
    }
  }

  if (!request.body) {
    return { error: EMPTY_BODY };
  }

  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        reader.cancel().catch(() => {});
        return { error: PAYLOAD_TOO_LARGE };
      }
      chunks.push(value);
    }
  } catch {
    return { error: INVALID_JSON };
  } finally {
    try { reader.releaseLock(); } catch {}
  }

  if (totalBytes === 0) {
    return { error: EMPTY_BODY };
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(merged);
  } catch {
    return { error: INVALID_JSON };
  }

  try {
    return { body: JSON.parse(text) };
  } catch {
    return { error: INVALID_JSON };
  }
}
