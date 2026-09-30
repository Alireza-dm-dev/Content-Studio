// Central configuration for the Brand Workspace chatbot.
// Every model / budget / timeout knob lives here so it can be changed in one place.
// Model ids can be overridden per environment without a code change.

export const BRAND_CHAT_CONFIG = {
  // Primary model: strongest general model exposed by the installed OpenAI SDK (6.41.0 ChatModel type).
  model: process.env.BRAND_CHAT_MODEL || "gpt-5.4",
  // Used once if the primary is unavailable to this API key (404 / model_not_found / access denied).
  fallbackModel: process.env.BRAND_CHAT_FALLBACK_MODEL || "gpt-4.1",
  // gpt-5.x reasoning models: "low" keeps latency reasonable while still reasoning across the request.
  reasoningEffort: "low",
  // Reasoning tokens count against this budget, so it must be generous or answers come back empty/cut.
  maxOutputTokens: 6000,
  fallbackMaxOutputTokens: 4096,
  fallbackTemperature: 0.7,

  // Provider call timeout. Must stay below ROUTE_MAX_DURATION_S and the client timeout.
  providerTimeoutMs: 100_000,
  retryDelaysMs: [1000, 3000],
  // Total wall-clock cap for one chat request on the server (route `maxDuration`).
  routeMaxDurationS: 120,
  // Browser gives up after this long (server budget + margin).
  clientTimeoutMs: 125_000,

  // Request limits
  maxMessageChars: 8000,
  maxBodyBytes: 128 * 1024,
  maxHistoryEntries: 60,

  // Prompt budgets (characters; ~4 chars per token)
  historyCharBudget: 24_000,
  historyMinTurnsKept: 4,
  contextCharBudget: 24_000,
  rateLimit: { windowMs: 15 * 60 * 1000, maxRequests: 60 },
};

export function isReasoningModel(model) {
  return /^(gpt-5|o\d)/.test(model || "");
}
