/**
 * Centralized brand authorization.
 *
 * This module is the ONE place that decides whether a user may act on a brand.
 * Do not hand-roll membership queries in routes or pages — import from here.
 *
 * Access model
 * ------------
 *   admin        → every brand, plus the administrative sections
 *   normal user  → only brands linked to them by BrandMembership
 *
 * BrandMembership is the canonical link: it is what the admin users screen
 * writes. BrandAssignment is a legacy table that nothing currently writes; it
 * is still honoured here so that any historical row keeps working, and so the
 * two pre-existing helpers in lib/auth.js (one read assignments, the other read
 * memberships) collapse into a single consistent rule.
 *
 * Response convention
 * -------------------
 * Matches the style already used by assertCalendarAccess():
 *   401 — not signed in
 *   404 — the resource does not exist
 *   403 — the resource exists but this user has no access to its brand
 *
 * 403-over-404 is deliberate. Brand ids are cuids, not enumerable, and the app
 * already answers 403 "Brand access required" on the calendar routes. Staying
 * consistent keeps the client error handling uniform.
 */

import { prisma } from "@/lib/prisma";

// getCurrentUser lives in lib/auth, which imports this module for its own
// legacy helpers. Loading it lazily keeps the dependency one-way at module
// scope so neither file depends on the other's evaluation order.
async function currentUser() {
  const { getCurrentUser } = await import("@/lib/auth");
  return getCurrentUser();
}

export function isAdminUser(user) {
  return user?.role === "admin";
}

/**
 * The core predicate. True when the user may act on this brand.
 */
export async function canUserAccessBrand(user, brandId) {
  if (!user || !brandId || typeof brandId !== "string") return false;
  if (isAdminUser(user)) return true;

  const [membership, assignment] = await Promise.all([
    prisma.brandMembership.findUnique({
      where: { userId_brandId: { userId: user.id, brandId } },
      select: { id: true },
    }),
    prisma.brandAssignment.findUnique({
      where: { userId_brandId: { userId: user.id, brandId } },
      select: { id: true },
    }),
  ]);

  return Boolean(membership || assignment);
}

/**
 * Every brand id this user may touch.
 *
 * Returns null for admins, meaning "no restriction". Callers must treat null
 * as unrestricted rather than as an empty list — see brandScopeWhere().
 */
export async function getAccessibleBrandIds(user) {
  if (!user) return [];
  if (isAdminUser(user)) return null;

  const [memberships, assignments] = await Promise.all([
    prisma.brandMembership.findMany({
      where: { userId: user.id },
      select: { brandId: true },
    }),
    prisma.brandAssignment.findMany({
      where: { userId: user.id },
      select: { brandId: true },
    }),
  ]);

  return [
    ...new Set([
      ...memberships.map((m) => m.brandId),
      ...assignments.map((a) => a.brandId),
    ]),
  ];
}

/**
 * A Prisma `where` fragment that scopes a brand-owning model to what the user
 * may see. Spread it into an existing where clause:
 *
 *   where: { ...(await brandScopeWhere(user)), status: "draft" }
 *
 * `field` is the column holding the brand id. It defaults to "brandId", which
 * suits every brand-OWNING model. Querying the Brand table itself must pass
 * "id" instead, because a Brand has no brandId column:
 *
 *   prisma.brand.findMany({ where: await brandScopeWhere(user, "id") })
 *
 * Admins get {} (everything). A user with no brands gets an impossible filter
 * rather than {}, so a missing scope can never silently widen a query.
 */
export async function brandScopeWhere(user, field = "brandId") {
  const ids = await getAccessibleBrandIds(user);
  if (ids === null) return {};
  return { [field]: { in: ids } };
}

// ── Route guards ─────────────────────────────────────────────────────────────

function deny(status, error) {
  return { ok: false, user: null, brandId: null, status, error };
}

/**
 * Guard for a route that receives a brand id directly.
 *
 *   const access = await requireBrandAccess(brandId);
 *   if (!access.ok) return brandAccessError(access);
 */
export async function requireBrandAccess(brandId, options = {}) {
  // An explicitly supplied `user` is trusted as-is, null included: the caller
  // has already resolved the session and null means "not signed in". Only an
  // absent key falls back to reading the session cookie.
  const user = "user" in options ? options.user : await currentUser();
  if (!user) return deny(401, "Authentication required");

  if (!brandId || typeof brandId !== "string") {
    return deny(400, "A brand is required.");
  }

  // Admins skip the existence check only for speed on hot paths; a missing
  // brand still surfaces naturally from the route's own query.
  if (!isAdminUser(user)) {
    const allowed = await canUserAccessBrand(user, brandId);
    if (!allowed) {
      // Distinguish "gone" from "not yours" without leaking which brands exist:
      // both answer 403 unless the brand genuinely does not exist at all.
      const brand = await prisma.brand.findUnique({
        where: { id: brandId },
        select: { id: true },
      });
      if (!brand) return deny(404, "Brand not found");
      return deny(403, "You do not have access to this brand.");
    }
  }

  return { ok: true, user, brandId, status: 200, error: null };
}

/**
 * Map a resource id to its owning brand, then authorize.
 *
 * This is what stops a user from bypassing brand scoping by guessing an id.
 * Every brand-scoped model is reachable here, either by its own brandId or by
 * one hop through its parent.
 */
const RESOURCE_RESOLVERS = {
  brand: async (id) => {
    const row = await prisma.brand.findUnique({ where: { id }, select: { id: true } });
    return row ? row.id : undefined;
  },
  calendar: async (id) => {
    const row = await prisma.contentCalendar.findUnique({
      where: { id },
      select: { brandId: true },
    });
    return row ? row.brandId : undefined;
  },
  calendarPost: async (id) => {
    const row = await prisma.calendarPost.findUnique({
      where: { id },
      select: { calendar: { select: { brandId: true } } },
    });
    return row ? row.calendar?.brandId ?? null : undefined;
  },
  publishedPost: async (id) => {
    const row = await prisma.publishedPost.findUnique({
      where: { id },
      select: { brandId: true },
    });
    return row ? row.brandId : undefined;
  },
  publishedPostComment: async (id) => {
    const row = await prisma.publishedPostComment.findUnique({
      where: { id },
      select: { publishedPost: { select: { brandId: true } } },
    });
    return row ? row.publishedPost?.brandId ?? null : undefined;
  },
  brandIdentity: async (id) => {
    const row = await prisma.brandIdentity.findUnique({
      where: { id },
      select: { brandId: true },
    });
    return row ? row.brandId : undefined;
  },
  generatedPrompt: async (id) => {
    const row = await prisma.generatedPrompt.findUnique({
      where: { id },
      select: { brandId: true, calendar: { select: { brandId: true } } },
    });
    if (!row) return undefined;
    return row.brandId ?? row.calendar?.brandId ?? null;
  },
  generatedMedia: async (id) => {
    const row = await prisma.generatedMedia.findUnique({
      where: { id },
      select: {
        brandId: true,
        calendarPost: { select: { calendar: { select: { brandId: true } } } },
      },
    });
    if (!row) return undefined;
    return row.brandId ?? row.calendarPost?.calendar?.brandId ?? null;
  },
  videoStoryboard: async (id) => {
    const row = await prisma.videoStoryboard.findUnique({
      where: { id },
      select: { brandId: true, calendar: { select: { brandId: true } } },
    });
    if (!row) return undefined;
    return row.brandId ?? row.calendar?.brandId ?? null;
  },
  referenceImageAnalysis: async (id) => {
    const row = await prisma.referenceImageAnalysis.findUnique({
      where: { id },
      select: { brandId: true, calendar: { select: { brandId: true } } },
    });
    if (!row) return undefined;
    return row.brandId ?? row.calendar?.brandId ?? null;
  },
  combinedVisualDirection: async (id) => {
    const row = await prisma.combinedVisualDirection.findUnique({
      where: { id },
      select: { brandId: true, calendar: { select: { brandId: true } } },
    });
    if (!row) return undefined;
    return row.brandId ?? row.calendar?.brandId ?? null;
  },
  uploadedFile: async (id) => {
    const row = await prisma.uploadedFile.findUnique({
      where: { id },
      select: { brandId: true, calendar: { select: { brandId: true } } },
    });
    if (!row) return undefined;
    return row.brandId ?? row.calendar?.brandId ?? null;
  },
  workspaceReview: async (id) => {
    const row = await prisma.workspaceReview.findUnique({
      where: { id },
      select: { brandId: true },
    });
    return row ? row.brandId : undefined;
  },
};

export const BRAND_RESOURCE_KINDS = Object.keys(RESOURCE_RESOLVERS);

/**
 * Resolve a resource to its brand and authorize the current user against it.
 *
 * A resolver returns `undefined` when the row does not exist (→ 404) and
 * `null` when the row exists but is not attached to any brand. Unattached
 * rows are admin-only: there is no membership that could grant access to
 * something that belongs to no brand.
 */
export async function requireResourceBrandAccess(kind, id, options = {}) {
  const resolve = RESOURCE_RESOLVERS[kind];
  if (!resolve) {
    throw new Error(`Unknown brand resource kind: ${kind}`);
  }

  const user = "user" in options ? options.user : await currentUser();
  if (!user) return deny(401, "Authentication required");

  if (!id || typeof id !== "string") return deny(400, "A resource id is required.");

  const brandId = await resolve(id);

  if (brandId === undefined) return deny(404, "Not found");

  if (brandId === null) {
    // Brand-less record. Admins may act on it; nobody else can.
    if (isAdminUser(user)) {
      return { ok: true, user, brandId: null, status: 200, error: null };
    }
    return deny(403, "You do not have access to this resource.");
  }

  return requireBrandAccess(brandId, { user });
}

/**
 * Turn a denied guard result into the JSON body + status a route should return.
 * Kept separate so routes stay free to shape their own payload when needed.
 */
export function brandAccessErrorBody(access) {
  return { error: access.error };
}
