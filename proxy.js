import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getSessionUserByToken } from "@/lib/auth";
import { requireBrandAccess } from "@/lib/brand-access";

const PUBLIC_PATHS = new Set([
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
]);

const PUBLIC_ROOT_ASSETS = new Set([
  "/favicon.ico",
  "/file.svg",
  "/globe.svg",
  "/next.svg",
  "/vercel.svg",
  "/window.svg",
]);

/**
 * Paths only an admin may reach, whatever the method.
 *
 * These are the genuinely administrative surfaces: user management, brand
 * assignment, global settings, prompt-template management and the public
 * review share-links that expose brand content to anyone holding a token.
 * Opening the product to normal users must never open these.
 */
const ADMIN_ONLY_PREFIXES = [
  "/settings",
  "/api/settings",
  "/api/admin",
  "/prompt-library",
  "/api/prompt-templates",
  "/api/generate/test",
  "/brands/new",
];

/**
 * Admin-only combinations of method + path, for endpoints where normal users
 * may read but not perform the administrative action.
 */
const ADMIN_ONLY_MATCHERS = [
  // Brand lifecycle: creating and deleting brands stays with admins. A brand a
  // normal user created would carry no membership, so they would lose it at once.
  { method: "POST", test: (p) => p === "/api/brands" },
  { method: "DELETE", test: (p) => /^\/api\/brands\/[^/]+$/.test(p) },
  // Public review share-links.
  { method: null, test: (p) => /^\/api\/brands\/[^/]+\/reviews(\/|$)/.test(p) },
];

/**
 * Product surface a signed-in non-admin may reach.
 *
 * Deny-by-default: anything absent from this list is refused for non-admins.
 * Reaching a path here is NOT authorization to touch a particular brand — every
 * route below still enforces brand membership server-side via lib/brand-access.
 * This list controls which features exist for a normal user, not which data
 * they can see.
 */
const USER_PAGE_PREFIXES = [
  "/calendar-portal",
  "/brand-workspace",
  "/brands",
  "/content-calendar",
  "/create-image",
  "/create-video",
  "/generated-media",
  "/generated-prompts",
  "/content-report",
];

const USER_API_PREFIXES = [
  // Brand records, identity, files, chat, published posts, workspace.
  "/api/brands",
  // Calendars and their posts.
  "/api/calendars",
  "/api/calendar-posts",
  "/api/content-calendar",
  // Image creation flows.
  "/api/image",
  "/api/reference-image",
  "/api/reference-analyses",
  "/api/brand-identities",
  // Video creation flows.
  "/api/video",
  "/api/video-storyboards",
  // Generated output.
  "/api/prompts",
  "/api/generated-media",
  "/api/content-report",
  // Generation backends used by the create flows. These take a prompt, not a
  // brand; the brand-scoped work happens in the routes above.
  "/api/openai",
  "/api/higgsfield",
  "/api/upload/temp-image",
];

/**
 * Static assets served out of public/.
 *
 * These are not product routes and must never be swept up by the deny-by-default
 * rule: an authorized page requests them as <img>/<video> sources, and a redirect
 * to /brands turns into a broken preview rather than a visible denial.
 *
 * Two kinds live under /uploads:
 *   /uploads/<brandId>/...   brand-owned media, membership enforced below
 *   /uploads/images|reference-images|temp-images/...
 *                            generation output and staging, not brand-owned
 */
const UPLOADS_SHARED_DIRS = new Set(["images", "reference-images", "temp-images"]);

const STATIC_ASSET_PREFIXES = ["/brand-icons", "/_next", "/uploads"];

function isStaticAssetPath(pathname) {
  return matchesPrefix(pathname, STATIC_ASSET_PREFIXES);
}

/**
 * The brand that owns a local media path, or null when the path is not
 * brand-owned. Uploads are laid out as
 * /uploads/<brandId>/published-posts/<postId>/<file>.
 */
function brandIdFromUploadPath(pathname) {
  const match = pathname.match(/^\/uploads\/([^/]+)\//);
  if (!match) return null;
  const segment = match[1];
  if (UPLOADS_SHARED_DIRS.has(segment)) return null;
  return segment;
}

function matchesPrefix(pathname, prefixes) {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isAdminOnly(pathname, method) {
  if (matchesPrefix(pathname, ADMIN_ONLY_PREFIXES)) return true;
  return ADMIN_ONLY_MATCHERS.some(
    (m) => (m.method === null || m.method === method) && m.test(pathname),
  );
}

/**
 * Brand ids that appear directly in the URL.
 *
 * `/api/brands/<brandId>/...` and `/brands/<brandId>` put the brand in the path,
 * so membership can be enforced here once for that whole family instead of
 * being re-implemented in every route beneath it. Routes that take a brand in
 * the body or query, or only an indirect resource id, cannot be covered from
 * here and carry their own guard from lib/brand-access.
 *
 * Returns null when the path carries no brand id.
 */
const NON_BRAND_SEGMENTS = new Set(["mine", "new"]);

function brandIdFromPath(pathname) {
  const apiMatch = pathname.match(/^\/api\/brands\/([^/]+)(?:\/|$)/);
  if (apiMatch && !NON_BRAND_SEGMENTS.has(apiMatch[1])) return apiMatch[1];

  const pageMatch = pathname.match(/^\/brands\/([^/]+)(?:\/|$)/);
  if (pageMatch && !NON_BRAND_SEGMENTS.has(pageMatch[1])) return pageMatch[1];

  return null;
}

function clearedCookie(response, token) {
  if (token) {
    response.cookies.set(SESSION_COOKIE_NAME, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
  }
  return response;
}

export async function proxy(request) {
  const { pathname, search } = request.nextUrl;
  const method = request.method;

  // Allowlist — pass through without auth
  if (
    PUBLIC_PATHS.has(pathname) ||
    PUBLIC_ROOT_ASSETS.has(pathname) ||
    pathname.startsWith("/review") ||
    pathname.startsWith("/api/review")
  ) {
    return NextResponse.next();
  }

  // Resolve session
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const user = await getSessionUserByToken(token);

  const isApi = pathname.startsWith("/api/");

  if (!user) {
    // Unauthenticated
    if (isApi) {
      return clearedCookie(
        NextResponse.json({ error: "Authentication required" }, { status: 401 }),
        token,
      );
    }

    // Page request — redirect to login
    const loginUrl = new URL("/login", request.url);
    const returnPath = pathname + search;
    if (returnPath !== "/login") {
      loginUrl.searchParams.set("next", returnPath);
    }
    return clearedCookie(NextResponse.redirect(loginUrl), token);
  }

  // Authenticated admin — full access
  if (user.role === "admin") {
    return NextResponse.next();
  }

  // ── Authenticated non-admin ────────────────────────────────────────────────

  // Administrative surfaces stay closed.
  if (isAdminOnly(pathname, method)) {
    if (isApi) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/brands", request.url));
  }

  // Static assets. Checked before the deny-by-default rule, because an already
  // authorized page loads these as image/video sources: refusing them produces
  // a broken preview instead of a denial the user can act on.
  if (isStaticAssetPath(pathname)) {
    const uploadBrandId = brandIdFromUploadPath(pathname);
    if (uploadBrandId) {
      // Brand-owned local media still requires membership, so another brand's
      // uploads stay unreachable through the app.
      const access = await requireBrandAccess(uploadBrandId, { user });
      if (!access.ok) {
        return new NextResponse(null, { status: 403 });
      }
    }
    return NextResponse.next();
  }

  // Dashboard root is part of the normal product.
  if (pathname === "/") {
    return NextResponse.next();
  }

  const allowed = isApi
    ? matchesPrefix(pathname, USER_API_PREFIXES)
    : matchesPrefix(pathname, USER_PAGE_PREFIXES);

  if (allowed) {
    // Enforce membership for brand ids carried in the URL. Routes still run
    // their own checks; this closes the whole /api/brands/<id>/** family at once.
    const pathBrandId = brandIdFromPath(pathname);
    if (pathBrandId) {
      const access = await requireBrandAccess(pathBrandId, { user });
      if (!access.ok) {
        if (isApi) {
          return NextResponse.json({ error: access.error }, { status: access.status });
        }
        return NextResponse.redirect(new URL("/brands?error=forbidden", request.url));
      }
    }
    return NextResponse.next();
  }

  // Deny by default.
  if (isApi) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  return NextResponse.redirect(new URL("/brands", request.url));
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_next/webpack-hmr).*)",
  ],
};
