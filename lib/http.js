// Client-safe helpers for reading API responses safely.
//
// API routes should always return valid JSON, but defensive parsing here means
// a non-JSON or empty body (e.g. a proxy or dev-server error page) surfaces as
// a readable error instead of "Failed to execute 'json' on 'Response'".

/**
 * Read a fetch Response as JSON without crashing on an empty or non-JSON body.
 * Throws a human-readable Error on empty/invalid bodies.
 */
export async function parseApiResponse(response) {
  const text = await response.text();
  if (!text || !text.trim()) {
    throw new Error(`The server returned an empty response (status ${response.status}). Please try again.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The server returned an invalid response. Please try again.");
  }
}

/**
 * Extract a useful human-readable message from a parsed API error payload.
 * Returns null when no message is present.
 */
export function getApiErrorMessage(data) {
  if (typeof data?.error === "string" && data.error.trim()) return data.error.trim();
  if (typeof data?.message === "string" && data.message.trim()) return data.message.trim();
  if (typeof data?.details === "string" && data.details.trim()) return data.details.trim();
  return null;
}
