// Authorization tests for the per-brand access model.
//
// The product used to be admin-only: proxy.js let non-admins reach
// /calendar-portal and little else, so most routes never carried a check of
// their own. Now a normal user gets the whole product, but only for brands
// they belong to through BrandMembership. These tests pin that boundary down.
//
// Fixtures (created once, shared by every test):
//   admin    — role "admin", no memberships
//   userA    — member of Brand A only
//   userB    — member of Brand B only
//   userAB   — member of both
//   userNone — authenticated, member of nothing
//
// Everything runs against an in-memory stand-in for Prisma so the suite stays
// deterministic and never touches dev.db.

import { test, mock } from "node:test";
import assert from "node:assert/strict";

// ── Fixture data ─────────────────────────────────────────────────────────────

const BRAND_A = "brand-a";
const BRAND_B = "brand-b";

const admin = { id: "admin-1", role: "admin", name: "Admin", email: "admin@example.test" };
const userA = { id: "user-a", role: "user", name: "A", email: "a@example.test" };
const userB = { id: "user-b", role: "user", name: "B", email: "b@example.test" };
const userAB = { id: "user-ab", role: "user", name: "AB", email: "ab@example.test" };
const userNone = { id: "user-none", role: "user", name: "None", email: "none@example.test" };

const MEMBERSHIPS = [
  { id: "m1", userId: userA.id, brandId: BRAND_A, role: "calendar_editor" },
  { id: "m2", userId: userB.id, brandId: BRAND_B, role: "calendar_editor" },
  { id: "m3", userId: userAB.id, brandId: BRAND_A, role: "calendar_editor" },
  { id: "m4", userId: userAB.id, brandId: BRAND_B, role: "calendar_editor" },
];

// BrandAssignment is the legacy table. It stays empty, which is exactly the
// production state, and is why the old assertBrandAccess() denied everyone.
const ASSIGNMENTS = [];

const BRANDS = [
  { id: BRAND_A, name: "Brand A" },
  { id: BRAND_B, name: "Brand B" },
];

const CALENDARS = [
  { id: "cal-a", brandId: BRAND_A, title: "A calendar" },
  { id: "cal-b", brandId: BRAND_B, title: "B calendar" },
  { id: "cal-orphan", brandId: null, title: "No brand" },
];

const CALENDAR_POSTS = [
  { id: "post-a", calendarId: "cal-a" },
  { id: "post-b", calendarId: "cal-b" },
];

const PUBLISHED_POSTS = [
  { id: "pp-a", brandId: BRAND_A },
  { id: "pp-b", brandId: BRAND_B },
];

const STORYBOARDS = [
  { id: "sb-a", brandId: BRAND_A, calendarId: null },
  { id: "sb-b", brandId: null, calendarId: "cal-b" },
];

const GENERATED_MEDIA = [
  { id: "gm-a", brandId: BRAND_A, calendarPostId: null },
  { id: "gm-b-viacal", brandId: null, calendarPostId: "post-b" },
];

const UPLOADED_FILES = [
  { id: "file-a", brandId: BRAND_A, calendarId: null },
  { id: "file-b", brandId: BRAND_B, calendarId: null },
];

function findUnique(rows, where) {
  if (where.id !== undefined) return rows.find((r) => r.id === where.id) ?? null;
  if (where.userId_brandId) {
    const { userId, brandId } = where.userId_brandId;
    return rows.find((r) => r.userId === userId && r.brandId === brandId) ?? null;
  }
  return null;
}

mock.module("@/lib/prisma", {
  exports: {
    prisma: {
      brand: {
        findUnique: async ({ where }) => findUnique(BRANDS, where),
        findMany: async () => BRANDS,
      },
      brandMembership: {
        findUnique: async ({ where }) => findUnique(MEMBERSHIPS, where),
        findMany: async ({ where }) =>
          MEMBERSHIPS.filter((m) => m.userId === where.userId),
      },
      brandAssignment: {
        findUnique: async ({ where }) => findUnique(ASSIGNMENTS, where),
        findMany: async ({ where }) =>
          ASSIGNMENTS.filter((a) => a.userId === where.userId),
      },
      contentCalendar: {
        findUnique: async ({ where }) => findUnique(CALENDARS, where),
      },
      calendarPost: {
        findUnique: async ({ where }) => {
          const post = findUnique(CALENDAR_POSTS, where);
          if (!post) return null;
          const cal = CALENDARS.find((c) => c.id === post.calendarId);
          return { calendar: cal ? { brandId: cal.brandId } : null };
        },
      },
      publishedPost: {
        findUnique: async ({ where }) => findUnique(PUBLISHED_POSTS, where),
      },
      publishedPostComment: { findUnique: async () => null },
      brandIdentity: { findUnique: async () => null },
      generatedPrompt: { findUnique: async () => null },
      generatedMedia: {
        findUnique: async ({ where }) => {
          const row = findUnique(GENERATED_MEDIA, where);
          if (!row) return null;
          const post = CALENDAR_POSTS.find((p) => p.id === row.calendarPostId);
          const cal = post && CALENDARS.find((c) => c.id === post.calendarId);
          return {
            brandId: row.brandId,
            calendarPost: cal ? { calendar: { brandId: cal.brandId } } : null,
          };
        },
      },
      videoStoryboard: {
        findUnique: async ({ where }) => {
          const row = findUnique(STORYBOARDS, where);
          if (!row) return null;
          const cal = CALENDARS.find((c) => c.id === row.calendarId);
          return { brandId: row.brandId, calendar: cal ? { brandId: cal.brandId } : null };
        },
      },
      referenceImageAnalysis: { findUnique: async () => null },
      combinedVisualDirection: { findUnique: async () => null },
      uploadedFile: {
        findUnique: async ({ where }) => {
          const row = findUnique(UPLOADED_FILES, where);
          if (!row) return null;
          const cal = CALENDARS.find((c) => c.id === row.calendarId);
          return { brandId: row.brandId, calendar: cal ? { brandId: cal.brandId } : null };
        },
      },
      workspaceReview: { findUnique: async () => null },
    },
  },
});

const {
  canUserAccessBrand,
  getAccessibleBrandIds,
  brandScopeWhere,
  requireBrandAccess,
  requireResourceBrandAccess,
  isAdminUser,
} = await import("@/lib/brand-access");

// ── 1 & 2. A user sees their own brand and not the other ─────────────────────

test("User A can access Brand A", async () => {
  assert.equal(await canUserAccessBrand(userA, BRAND_A), true);
});

test("User A cannot access Brand B", async () => {
  assert.equal(await canUserAccessBrand(userA, BRAND_B), false);
});

test("User B is the mirror image of User A", async () => {
  assert.equal(await canUserAccessBrand(userB, BRAND_B), true);
  assert.equal(await canUserAccessBrand(userB, BRAND_A), false);
});

test("membership is honoured even though the legacy assignment table is empty", async () => {
  // The previous helper read BrandAssignment only, so this returned false for
  // every normal user and the brand chat and post-adapt routes always denied.
  assert.equal(ASSIGNMENTS.length, 0);
  assert.equal(await canUserAccessBrand(userA, BRAND_A), true);
});

// ── 13. Multi-brand membership ────────────────────────────────────────────────

test("User AB can access both assigned brands", async () => {
  assert.equal(await canUserAccessBrand(userAB, BRAND_A), true);
  assert.equal(await canUserAccessBrand(userAB, BRAND_B), true);

  const ids = await getAccessibleBrandIds(userAB);
  assert.deepEqual([...ids].sort(), [BRAND_A, BRAND_B]);
});

// ── 14. A user with no brands ─────────────────────────────────────────────────

test("User None can access no brand at all", async () => {
  assert.equal(await canUserAccessBrand(userNone, BRAND_A), false);
  assert.equal(await canUserAccessBrand(userNone, BRAND_B), false);
  assert.deepEqual(await getAccessibleBrandIds(userNone), []);
});

test("a user with no brands gets an impossible filter, never an empty one", async () => {
  // An empty {} here would silently widen every scoped query to all brands.
  const where = await brandScopeWhere(userNone);
  assert.deepEqual(where, { brandId: { in: [] } });
});

test("an unauthenticated caller can access nothing", async () => {
  assert.equal(await canUserAccessBrand(null, BRAND_A), false);
  assert.deepEqual(await getAccessibleBrandIds(null), []);
  const access = await requireBrandAccess(BRAND_A, { user: null });
  assert.equal(access.ok, false);
  assert.equal(access.status, 401);
});

// ── 15. Admin behaviour is preserved ──────────────────────────────────────────

test("admin retains access to every brand", async () => {
  assert.equal(isAdminUser(admin), true);
  assert.equal(await canUserAccessBrand(admin, BRAND_A), true);
  assert.equal(await canUserAccessBrand(admin, BRAND_B), true);
});

test("admin scope is unrestricted rather than a brand list", async () => {
  assert.equal(await getAccessibleBrandIds(admin), null);
  assert.deepEqual(await brandScopeWhere(admin), {});
});

// ── Guard results: status codes ───────────────────────────────────────────────

test("requireBrandAccess allows a member and reports the brand", async () => {
  const access = await requireBrandAccess(BRAND_A, { user: userA });
  assert.equal(access.ok, true);
  assert.equal(access.brandId, BRAND_A);
  assert.equal(access.user.id, userA.id);
});

test("requireBrandAccess answers 403 for a real brand the user does not belong to", async () => {
  const access = await requireBrandAccess(BRAND_B, { user: userA });
  assert.equal(access.ok, false);
  assert.equal(access.status, 403);
});

test("requireBrandAccess answers 404 for a brand that does not exist", async () => {
  const access = await requireBrandAccess("brand-does-not-exist", { user: userA });
  assert.equal(access.ok, false);
  assert.equal(access.status, 404);
});

test("requireBrandAccess rejects a missing or non-string brand id", async () => {
  for (const bad of [null, undefined, "", 42, {}]) {
    const access = await requireBrandAccess(bad, { user: userA });
    assert.equal(access.ok, false, `expected denial for ${JSON.stringify(bad)}`);
  }
});

// ── 6. Indirect ids cannot be used to hop brands ──────────────────────────────

test("User A reaches their own calendar but not Brand B's, by direct id", async () => {
  const own = await requireResourceBrandAccess("calendar", "cal-a", { user: userA });
  assert.equal(own.ok, true);
  assert.equal(own.brandId, BRAND_A);

  const other = await requireResourceBrandAccess("calendar", "cal-b", { user: userA });
  assert.equal(other.ok, false);
  assert.equal(other.status, 403);
});

test("a calendar post resolves through its calendar to the owning brand", async () => {
  const own = await requireResourceBrandAccess("calendarPost", "post-a", { user: userA });
  assert.equal(own.ok, true);

  const other = await requireResourceBrandAccess("calendarPost", "post-b", { user: userA });
  assert.equal(other.ok, false);
  assert.equal(other.status, 403);
});

test("a published post is authorized by its own brand", async () => {
  assert.equal((await requireResourceBrandAccess("publishedPost", "pp-a", { user: userA })).ok, true);
  const denied = await requireResourceBrandAccess("publishedPost", "pp-b", { user: userA });
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 403);
});

test("a storyboard attached only to a calendar still resolves to that brand", async () => {
  // sb-b has no brandId of its own and must be reached through cal-b.
  const denied = await requireResourceBrandAccess("videoStoryboard", "sb-b", { user: userA });
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 403);

  const allowed = await requireResourceBrandAccess("videoStoryboard", "sb-b", { user: userB });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.brandId, BRAND_B);
});

test("generated media reached only through its calendar post is still scoped", async () => {
  const denied = await requireResourceBrandAccess("generatedMedia", "gm-b-viacal", { user: userA });
  assert.equal(denied.ok, false);

  const allowed = await requireResourceBrandAccess("generatedMedia", "gm-b-viacal", { user: userB });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.brandId, BRAND_B);
});

test("an uploaded file is authorized by its owning brand", async () => {
  assert.equal((await requireResourceBrandAccess("uploadedFile", "file-a", { user: userA })).ok, true);
  assert.equal((await requireResourceBrandAccess("uploadedFile", "file-b", { user: userA })).ok, false);
});

test("an unknown resource id answers 404, not 403", async () => {
  const access = await requireResourceBrandAccess("calendar", "no-such-calendar", { user: userA });
  assert.equal(access.ok, false);
  assert.equal(access.status, 404);
});

test("a record attached to no brand is admin-only", async () => {
  // Nothing can grant a normal user membership of "no brand".
  const denied = await requireResourceBrandAccess("calendar", "cal-orphan", { user: userA });
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 403);

  const allowed = await requireResourceBrandAccess("calendar", "cal-orphan", { user: admin });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.brandId, null);
});

test("User AB reaches resources in both brands", async () => {
  assert.equal((await requireResourceBrandAccess("calendar", "cal-a", { user: userAB })).ok, true);
  assert.equal((await requireResourceBrandAccess("calendar", "cal-b", { user: userAB })).ok, true);
  assert.equal((await requireResourceBrandAccess("publishedPost", "pp-b", { user: userAB })).ok, true);
});

test("User None is denied every indirect resource too", async () => {
  for (const [kind, id] of [
    ["calendar", "cal-a"],
    ["calendarPost", "post-a"],
    ["publishedPost", "pp-a"],
    ["uploadedFile", "file-a"],
  ]) {
    const access = await requireResourceBrandAccess(kind, id, { user: userNone });
    assert.equal(access.ok, false, `${kind} ${id} should be denied`);
    assert.equal(access.status, 403);
  }
});

test("admin reaches every indirect resource", async () => {
  for (const [kind, id] of [
    ["calendar", "cal-b"],
    ["calendarPost", "post-b"],
    ["publishedPost", "pp-b"],
    ["videoStoryboard", "sb-b"],
  ]) {
    assert.equal(
      (await requireResourceBrandAccess(kind, id, { user: admin })).ok,
      true,
      `${kind} ${id} should be allowed for admin`,
    );
  }
});

test("an unknown resource kind is a programming error, not a silent allow", async () => {
  await assert.rejects(
    () => requireResourceBrandAccess("notARealModel", "x", { user: admin }),
    /Unknown brand resource kind/,
  );
});

// ── 8. Selector / list scoping ────────────────────────────────────────────────

test("brandScopeWhere limits a list query to the user's brands", async () => {
  assert.deepEqual(await brandScopeWhere(userA), { brandId: { in: [BRAND_A] } });

  const ab = await brandScopeWhere(userAB);
  assert.deepEqual([...ab.brandId.in].sort(), [BRAND_A, BRAND_B]);
});

test("brandScopeWhere can scope a differently named column", async () => {
  assert.deepEqual(await brandScopeWhere(userA, "id"), { id: { in: [BRAND_A] } });
});
