// Timeout budget for calendar generation, shared by the generate route and the
// Calendar Setup form so the layers always nest:
//
//   provider call  <  route generation deadline  <  browser timeout
//
// Generation runs one provider call per batch of CALENDAR_BATCH_SIZE posts, in
// sequence. Measured with gpt-4o on a 12-post Instagram calendar (3 batches):
// English ~59s total, Persian ~75s total (Persian output uses ~25% more
// completion tokens), with single calls between ~15s and ~40s. The budget below
// leaves room for a retry per batch on top of that, without letting a stuck
// provider hold the request open indefinitely.

export const CALENDAR_BATCH_SIZE = 4;
export const CALENDAR_MAX_POSTS = 60;

// One provider call never waits longer than this.
export const CALENDAR_PROVIDER_TIMEOUT_MS = 90_000;
// Don't start a provider attempt that has less than this left to run in.
export const CALENDAR_MIN_ATTEMPT_MS = 20_000;
// Safety margin the route keeps to serialise its JSON answer.
export const CALENDAR_ROUTE_MARGIN_MS = 5_000;
// How much longer the browser waits than the route's own deadline.
export const CALENDAR_CLIENT_MARGIN_MS = 30_000;

const BASE_BUDGET_MS = 90_000;
const PER_BATCH_BUDGET_MS = 60_000;
const MAX_BUDGET_MS = 600_000;

function clampCount(postCount) {
  const n = parseInt(String(postCount ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) return 12;
  return Math.min(n, CALENDAR_MAX_POSTS);
}

/** Server-side wall-clock budget for generating `postCount` posts. */
export function getCalendarGenerationBudgetMs(postCount) {
  const batches = Math.ceil(clampCount(postCount) / CALENDAR_BATCH_SIZE);
  return Math.min(MAX_BUDGET_MS, BASE_BUDGET_MS + batches * PER_BATCH_BUDGET_MS);
}

/** How long the browser waits for the generate request before giving up. */
export function getCalendarClientTimeoutMs(postCount) {
  return getCalendarGenerationBudgetMs(postCount) + CALENDAR_CLIENT_MARGIN_MS;
}

/**
 * Provider timeout for the next attempt, given the route deadline, or null when
 * too little time is left to start another attempt.
 */
export function getProviderTimeoutForAttempt(deadline, now = Date.now()) {
  const remaining = deadline - now - CALENDAR_ROUTE_MARGIN_MS;
  if (remaining < CALENDAR_MIN_ATTEMPT_MS) return null;
  return Math.min(CALENDAR_PROVIDER_TIMEOUT_MS, remaining);
}
