/**
 * Where a user goes after signing in.
 *
 * Every role lands in the main application at "/". Normal users were
 * previously sent to /calendar-portal, which was the last remaining piece of
 * the calendar-only access model: the product is now brand-scoped rather than
 * role-scoped, and the dashboard filters itself to the viewer's brands, so it
 * is the right landing page for everyone.
 *
 * /calendar-portal still exists and is still reachable; it is simply no longer
 * the default destination.
 */

export const DEFAULT_POST_LOGIN_PATH = "/";

/**
 * Validate a "next" destination carried on the login URL.
 *
 * The proxy appends ?next=<path> when it bounces an unauthenticated request to
 * the login page, so honouring it returns the user to where they were headed.
 * Only same-origin, relative paths are accepted — anything that could leave
 * the site is rejected, so the parameter cannot be used as an open redirect.
 *
 * Returns null when the value is unusable.
 */
export function safeNextPath(value) {
  if (typeof value !== "string") return null;

  const path = value.trim();
  if (!path) return null;

  // Must be root-relative.
  if (!path.startsWith("/")) return null;

  // "//host" and "/\host" are protocol-relative and leave the origin.
  if (path.startsWith("//") || path.startsWith("/\\")) return null;

  // A scheme anywhere before the first slash would also escape the origin.
  if (/^\/[^/]*:/.test(path)) return null;

  // Control characters can be used to smuggle a second header or URL.
  if (/[\u0000-\u001F\u007F]/.test(path)) return null;

  // Bouncing back to the login page would loop.
  if (path === "/login" || path.startsWith("/login?") || path.startsWith("/login/")) {
    return null;
  }

  return path;
}

/**
 * The final destination for a freshly signed-in user.
 *
 * `role` is accepted so the contract stays explicit, but it deliberately does
 * not change the answer: admins and normal users land in the same place.
 */
export function resolvePostLoginPath(nextParam, role) {
  void role;
  return safeNextPath(nextParam) || DEFAULT_POST_LOGIN_PATH;
}
