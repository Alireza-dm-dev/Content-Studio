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

export async function createSession(userId) {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await prisma.user.update({
    where: { id: userId },
    data: { sessionToken: token, sessionExpiresAt: expiresAt },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function clearSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    await prisma.user.updateMany({
      where: { sessionToken: token },
      data: { sessionToken: null, sessionExpiresAt: null },
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

export async function getSessionUserByToken(token) {
  if (!token) return null;
  try {
    const user = await prisma.user.findUnique({
      where: { sessionToken: token },
    });
    if (!user) return null;
    if (!user.isActive) return null;
    if (user.sessionExpiresAt && new Date() > user.sessionExpiresAt) return null;
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
