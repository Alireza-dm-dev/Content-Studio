import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getSessionUserByToken } from "@/lib/auth";

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

export async function proxy(request) {
  const { pathname, search } = request.nextUrl;

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

  // Authenticated admin — allow
  if (user?.role === "admin") {
    return NextResponse.next();
  }

  const isApi = pathname.startsWith("/api/");

  if (!user) {
    // Unauthenticated
    if (isApi) {
      const response = NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
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

    // Page request — redirect to login
    const loginUrl = new URL("/login", request.url);
    const returnPath = pathname + search;
    if (returnPath !== "/login") {
      loginUrl.searchParams.set("next", returnPath);
    }
    const response = NextResponse.redirect(loginUrl);
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

  // Authenticated non-admin
  if (pathname.startsWith("/calendar-portal")) {
    return NextResponse.next();
  }

  const CALENDAR_EDITOR_API = new Set([
    "/api/content-calendar/generate",
    "/api/content-calendar/regenerate-post",
    "/api/content-calendar/suggest-posts",
    "/api/content-calendar/linkedin/suggest-posts",
  ]);

  if (
    pathname.startsWith("/api/calendars") ||
    pathname.startsWith("/api/calendar-posts") ||
    pathname.startsWith("/api/brands/mine") ||
    /^\/api\/brands\/[^/]+\/attachments\/?$/.test(pathname) ||
    CALENDAR_EDITOR_API.has(pathname)
  ) {
    return NextResponse.next();
  }

  if (isApi) {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 }
    );
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("reason", "non-admin");
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_next/webpack-hmr).*)",
  ],
};
