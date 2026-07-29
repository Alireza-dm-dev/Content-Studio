// Pure error-mapping functions for Brand Chat API.
// Separated from the route so they can be tested without Next.js dependencies.

const ERROR_MAP = {
  AUTH_REQUIRED:           { status: 401, body: { success: false, code: "AUTH_REQUIRED", error: "Sign in again to use Brand Assistant." } },
  BRAND_ACCESS_DENIED:     { status: 403, body: { success: false, code: "BRAND_ACCESS_DENIED", error: "You do not have access to this Brand." } },
  BRAND_NOT_FOUND:         { status: 404, body: { success: false, code: "BRAND_NOT_FOUND", error: "Brand not found." } },
  INVALID_BRAND_ID:        { status: 400, body: { success: false, code: "INVALID_BRAND_ID", error: "Invalid Brand ID." } },
  INVALID_MESSAGE:         { status: 400, body: { success: false, code: "INVALID_MESSAGE", error: "Message must be between 1 and 2,000 characters." } },
  MESSAGE_TOO_LONG:        { status: 400, body: { success: false, code: "MESSAGE_TOO_LONG", error: "Message must be between 1 and 2,000 characters." } },
  INVALID_HISTORY:         { status: 400, body: { success: false, code: "INVALID_HISTORY", error: "Conversation history is invalid." } },
  INVALID_JSON:            { status: 400, body: { success: false, code: "INVALID_JSON", error: "Request body must be valid JSON." } },
  PAYLOAD_TOO_LARGE:       { status: 413, body: { success: false, code: "PAYLOAD_TOO_LARGE", error: "Request body is too large." } },
  UNSUPPORTED_MEDIA_TYPE:  { status: 415, body: { success: false, code: "UNSUPPORTED_MEDIA_TYPE", error: "Content-Type must be application/json." } },
  RATE_LIMITED:            { status: 429, body: { success: false, code: "RATE_LIMITED", error: "Too many requests. Please wait before sending another message." } },
  OPENAI_NOT_CONFIGURED:   { status: 503, body: { success: false, code: "OPENAI_NOT_CONFIGURED", error: "OpenAI is not configured. Ask an administrator to add the API key in Settings." } },
  CONTEXT_UNAVAILABLE:     { status: 503, body: { success: false, code: "CONTEXT_UNAVAILABLE", error: "Brand context is not available. Please try again." } },
  AI_TIMEOUT:              { status: 504, body: { success: false, code: "AI_TIMEOUT", error: "Brand Assistant timed out. Try again." } },
  AI_PROVIDER_ERROR:       { status: 502, body: { success: false, code: "AI_PROVIDER_ERROR", error: "Brand Assistant is temporarily unavailable." } },
  INTERNAL_ERROR:          { status: 500, body: { success: false, code: "INTERNAL_ERROR", error: "The Brand assistant request failed." } },
};

const ALIASES = {
  AUTHENTICATION_REQUIRED: "AUTH_REQUIRED",
  ACCESS_DENIED:           "BRAND_ACCESS_DENIED",
  INVALID_QUESTION:        "INVALID_MESSAGE",
  INVALID_REQUEST:         "INVALID_JSON",
};

function resolveCode(code) {
  if (!code) return "INTERNAL_ERROR";
  const alias = ALIASES[code];
  if (alias) return alias;
  if (ERROR_MAP[code]) return code;
  return "INTERNAL_ERROR";
}

export function mapChatError(errorOrCode, extraFields) {
  const code = typeof errorOrCode === "string" ? errorOrCode : errorOrCode?.code || "INTERNAL_ERROR";
  const resolved = resolveCode(code);
  const entry = ERROR_MAP[resolved] || ERROR_MAP.INTERNAL_ERROR;
  const body = { ...entry.body, ...extraFields };
  return { status: entry.status, body };
}

export function mapBrandChatContextError(err) {
  return mapChatError(err?.code || "INTERNAL_ERROR");
}

export function mapAiError(err) {
  return mapChatError(err?.code || "INTERNAL_ERROR");
}
