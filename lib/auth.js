import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import {
  canUserAccessBrand,
  getAccessibleBrandIds,
  requireBrandAccess,
} from "@/lib/brand-access";

export const SESSION_COOKIE_NAME = "content_studio_session";
const SESSION_DURATION_DAYS = 14;
const SESSION_DURATION_MS = SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000;
const SESSION_MAX_AGE = SESSION_DURATION_DAYS * 24 * 60 * 60;

function safeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
  };
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

export function hashSessionToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Sessions are one row per browser/device (AuthSession). The cookie holds a
// random token; only its SHA-256 is stored. Every query below is scoped to a
// single token hash or a single userId — nothing deletes or rewrites rows
// belonging to anyone else.

const LAST_USED_REFRESH_MS = 60 * 60 * 1000;

export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await prisma.authSession.create({
    data: { userId, tokenHash: hashSessionToken(token), expiresAt },
  });

  // Housekeeping: only rows already past expiry, never live sessions.
  try {
    await prisma.authSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  } catch {
    // Cleanup is best-effort; login must not fail because of it.
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

// Ends only the session carried by the current request's cookie.
export async function clearSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    await prisma.authSession.deleteMany({
      where: { tokenHash: hashSessionToken(token) },
    });
  }
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

// Explicit security action: ends every session of ONE user.
export async function revokeUserSessions(userId) {
  if (!userId) return 0;
  const { count } = await prisma.authSession.deleteMany({ where: { userId } });
  return count;
}

export async function getSessionUserByToken(token) {
  if (!token || typeof token !== "string") return null;
  try {
    const session = await prisma.authSession.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: true },
    });
    if (!session) return null;
    if (new Date() > session.expiresAt) return null;
    const user = session.user;
    if (!user || !user.isActive) return null;

    if (Date.now() - new Date(session.lastUsedAt).getTime() > LAST_USED_REFRESH_MS) {
      prisma.authSession
        .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
        .catch(() => {});
    }
    return safeUser(user);
  } catch {
    return null;
  }
}

export async function getCurrentUser() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    return getSessionUserByToken(token);
  } catch {
    return null;
  }
}

export async function getAdminAccess() {
  const user = await getCurrentUser();
  if (!user) {
    return { user: null, error: "Authentication required", status: 401 };
  }
  if (user.role !== "admin") {
    return { user: null, error: "Admin access required", status: 403 };
  }
  return { user, error: null, status: 200 };
}

export async function requireAuth() {
  return getCurrentUser();
}

export async function requireAdmin() {
  const user = await getCurrentUser();
  if (user?.role === "admin") return user;
  return null;
}

// The helpers below keep their original call signatures so the existing
// calendar routes need no edit, but they now all resolve access through
// lib/brand-access — one rule, one place. Previously assertBrandAccess read
// only the legacy BrandAssignment table while getBrandCalendarAccess read only
// BrandMembership, so the same user could be allowed by one and denied by the
// other.

export async function assertBrandAccess(brandId) {
  const user = await getCurrentUser();
  if (!user) return false;
  return canUserAccessBrand(user, brandId);
}

export async function getUserBrandIds(user) {
  if (!user) return [];
  const ids = await getAccessibleBrandIds(user);
  // getAccessibleBrandIds returns null for admins ("no restriction"); this
  // helper's contract is an explicit array, so expand it.
  if (ids === null) {
    const brands = await prisma.brand.findMany({ select: { id: true } });
    return brands.map((b) => b.id);
  }
  return ids;
}

export async function getBrandCalendarAccess(brandId) {
  const access = await requireBrandAccess(brandId);
  if (!access.ok) {
    return { allowed: false, error: access.error, status: access.status };
  }

  const isAdmin = access.user.role === "admin";
  // Preserved for callers that read the membership row (e.g. its role field).
  const membership = isAdmin
    ? null
    : await prisma.brandMembership.findUnique({
        where: { userId_brandId: { userId: access.user.id, brandId } },
      });

  return { allowed: true, user: access.user, isAdmin, membership };
}

export async function assertCalendarAccess(calendarId) {
  const calendar = await prisma.contentCalendar.findUnique({
    where: { id: calendarId },
    select: { brandId: true },
  });
  if (!calendar) return { allowed: false, error: "Calendar not found", status: 404 };
  if (!calendar.brandId) {
    // A calendar with no brand cannot be reached through membership.
    const user = await getCurrentUser();
    if (!user) return { allowed: false, error: "Authentication required", status: 401 };
    if (user.role !== "admin") {
      return { allowed: false, error: "Brand access required", status: 403 };
    }
    return { allowed: true, user, isAdmin: true, membership: null };
  }
  return getBrandCalendarAccess(calendar.brandId);
}
