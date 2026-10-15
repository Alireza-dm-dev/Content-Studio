// Client-side interpretation of a calendar-generation response.
//
// Response contract of POST /api/content-calendar/generate:
//   - Success:  { success: true, posts: [...], tables }
//   - Failure:  { success: false, code, error, ...details }
// A quick answer carries its real HTTP status. A long generation is streamed
// (keep-alive whitespace, then the JSON), so its HTTP status is always 200 and
// a failure adds `status` (the semantic HTTP status) to the body. Success is
// therefore decided by the body alone — never by `response.ok`.

export const CALENDAR_TIMEOUT_MESSAGE =
  "Calendar generation took too long to complete. Please try again, or generate fewer posts.";
export const CALENDAR_INVALID_OUTPUT_MESSAGE =
  "The AI response could not be validated. Nothing was saved. Please try again.";
export const CALENDAR_NETWORK_MESSAGE =
  "Could not reach the server. Please check your connection and try again.";
const CALENDAR_GENERIC_MESSAGE = "Calendar generation failed. Please try again.";

/**
 * @param {unknown} data parsed JSON body
 * @returns {{ ok: true, posts: object[] } | { ok: false, code: string|null, message: string }}
 */
export function readCalendarGenerationResult(data) {
  if (data && data.success === true && Array.isArray(data.posts)) {
    return { ok: true, posts: data.posts };
  }
  const code = typeof data?.code === "string" ? data.code : null;
  let message;
  if (code === "CALENDAR_GENERATION_TIMEOUT") message = CALENDAR_TIMEOUT_MESSAGE;
  else if (code === "CALENDAR_OUTPUT_INVALID") message = CALENDAR_INVALID_OUTPUT_MESSAGE;
  else message = (typeof data?.error === "string" && data.error.trim()) || CALENDAR_GENERIC_MESSAGE;
  return { ok: false, code, message };
}

// Only reached when no application JSON was received at all.
export function getCalendarGenerationFailureMessage(err) {
  // AbortSignal.timeout() rejects with TimeoutError; a manual abort with AbortError.
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return CALENDAR_TIMEOUT_MESSAGE;
  // fetch rejects with TypeError when the connection fails or is dropped.
  if (err instanceof TypeError) return CALENDAR_NETWORK_MESSAGE;
  return err?.message || CALENDAR_GENERIC_MESSAGE;
}
