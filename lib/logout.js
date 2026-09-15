/**
 * Sign-out behaviour, kept out of the component so it can be tested without a
 * DOM. The component owns the pending flag and the markup; this owns the
 * network contract and the decision of whether to navigate.
 *
 * The session lives in an httpOnly cookie and is cleared server-side by
 * POST /api/auth/logout, which calls clearSession() in lib/auth. Nothing here
 * touches the cookie: a client cannot clear an httpOnly cookie, and pretending
 * to would leave the user signed in while the UI claimed otherwise.
 */

export const LOGOUT_ENDPOINT = "/api/auth/logout";
export const LOGIN_PATH = "/login";

// Deliberately generic. The endpoint logs the real cause server-side; the user
// gets something actionable without leaking internals.
export const LOGOUT_FAILED_MESSAGE = "Could not sign out. Please try again.";
export const LOGOUT_OFFLINE_MESSAGE =
  "Could not sign out. Please check your connection.";

/**
 * Attempt to end the session.
 *
 * Returns { ok, redirectTo, error }:
 *   ok true   — the server cleared the session; caller should navigate to
 *               redirectTo and refresh so no stale authenticated UI survives
 *   ok false  — the session is still live; caller should stay put and show
 *               `error`. Navigating to /login on a failure would be worse than
 *               staying: the user would see a login page while still signed in.
 *
 * `fetchImpl` is injectable purely so the contract can be tested.
 */
export async function performLogout({ fetchImpl = fetch } = {}) {
  let res;

  try {
    res = await fetchImpl(LOGOUT_ENDPOINT, { method: "POST" });
  } catch {
    return { ok: false, redirectTo: null, error: LOGOUT_OFFLINE_MESSAGE };
  }

  if (!res?.ok) {
    return { ok: false, redirectTo: null, error: LOGOUT_FAILED_MESSAGE };
  }

  return { ok: true, redirectTo: LOGIN_PATH, error: null };
}
