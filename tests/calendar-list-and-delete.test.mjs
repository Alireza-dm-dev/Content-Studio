// Content calendar list grouping + calendar deletion.
//
// Covers the three things the brand-grouped calendar page depends on:
//   1. the pure grouping helpers behind the sections,
//   2. the brand scoping of the list query (nothing inaccessible is returned),
//   3. the DELETE route — its authorization and exactly what it removes.

import { test, mock } from "node:test";
import assert from "node:assert/strict";

const BRAND_A = "brand-a";
const BRAND_B = "brand-b";

const admin = { id: "admin-1", role: "admin", isActive: true };
const userA = { id: "user-a", role: "user", isActive: true };
const userAB = { id: "user-ab", role: "user", isActive: true };
const userNone = { id: "user-none", role: "user", isActive: true };

let currentUser = null;
let db;

function freshDb() {
  return {
    brand: [
      { id: BRAND_A, name: "Alpha Brand" },
      { id: BRAND_B, name: "Beta Brand" },
    ],
    brandMembership: [
      { id: "m1", userId: userA.id, brandId: BRAND_A },
      { id: "m2", userId: userAB.id, brandId: BRAND_A },
      { id: "m3", userId: userAB.id, brandId: BRAND_B },
    ],
    brandAssignment: [],
    contentCalendar: [
      { id: "cal-a1", brandId: BRAND_A, title: "A1", status: "approved", platform: "Instagram", timePeriod: "Oct", createdAt: new Date("2026-03-02") },
      { id: "cal-a2", brandId: BRAND_A, title: "A2", status: "draft", platform: null, timePeriod: null, createdAt: new Date("2026-03-01") },
      { id: "cal-b1", brandId: BRAND_B, title: "B1", status: "draft", platform: null, timePeriod: null, createdAt: new Date("2026-03-03") },
    ],
    calendarPost: [
      { id: "post-a1-1", calendarId: "cal-a1" },
      { id: "post-a1-2", calendarId: "cal-a1" },
      { id: "post-b1-1", calendarId: "cal-b1" },
    ],
    generatedPrompt: [
      { id: "gp-1", calendarId: "cal-a1", calendarPostId: null, brandId: BRAND_A },
      { id: "gp-2", calendarId: null, calendarPostId: "post-a1-2", brandId: BRAND_A },
      { id: "gp-brand", calendarId: null, calendarPostId: null, brandId: BRAND_A },
      { id: "gp-other", calendarId: "cal-b1", calendarPostId: null, brandId: BRAND_B },
    ],
    videoStoryboard: [{ id: "vs-1", calendarId: "cal-a1", calendarPostId: null }],
    referenceImageAnalysis: [{ id: "ria-1", calendarId: null, calendarPostId: "post-a1-1" }],
    combinedVisualDirection: [{ id: "cvd-1", calendarId: "cal-a1", calendarPostId: null }],
    uploadedFile: [
      { id: "file-1", calendarId: "cal-a1", calendarPostId: null, brandId: BRAND_A, filePath: "uploads/images/a.png" },
    ],
    generatedMedia: [
      { id: "media-1", calendarPostId: "post-a1-1", brandId: BRAND_A, filePath: "uploads/images/gen.png" },
    ],
    publishedPost: [{ id: "pub-1", brandId: BRAND_A }],
  };
}

function matches(row, where) {
  if (!where) return true;
  if (Array.isArray(where.OR)) return where.OR.some((clause) => matches(row, clause));
  return Object.entries(where).every(([key, cond]) => {
    if (key === "OR") return true;
    const value = row[key];
    if (cond && typeof cond === "object" && Array.isArray(cond.in)) return cond.in.includes(value);
    return value === cond;
  });
}

function table(name) {
  return {
    findUnique: async ({ where }) => db[name].find((r) => r.id === where.id) ?? null,
    findMany: async ({ where } = {}) => db[name].filter((r) => matches(r, where)),
    deleteMany: async ({ where }) => {
      const keep = db[name].filter((r) => !matches(r, where));
      const count = db[name].length - keep.length;
      db[name] = keep;
      return { count };
    },
    updateMany: async ({ where, data }) => {
      let count = 0;
      for (const row of db[name]) {
        if (matches(row, where)) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return { count };
    },
    delete: async ({ where }) => {
      const row = db[name].find((r) => r.id === where.id);
      if (!row) throw new Error("Record to delete does not exist.");
      db[name] = db[name].filter((r) => r.id !== where.id);
      // Mirrors the ON DELETE CASCADE from ContentCalendar to CalendarPost.
      if (name === "contentCalendar") {
        db.calendarPost = db.calendarPost.filter((p) => p.calendarId !== where.id);
      }
      return row;
    },
  };
}

const membershipTable = {
  findUnique: async ({ where }) => {
    const { userId, brandId } = where.userId_brandId;
    return db.brandMembership.find((m) => m.userId === userId && m.brandId === brandId) ?? null;
  },
  findMany: async ({ where }) => db.brandMembership.filter((m) => m.userId === where.userId),
};

mock.module("@/lib/prisma", {
  exports: {
    prisma: {
      $transaction: async (fn) => fn(prismaMock),
      get brand() { return table("brand"); },
      brandMembership: membershipTable,
      brandAssignment: { findUnique: async () => null, findMany: async () => [] },
      get contentCalendar() { return table("contentCalendar"); },
      get calendarPost() { return table("calendarPost"); },
      get generatedPrompt() { return table("generatedPrompt"); },
      get videoStoryboard() { return table("videoStoryboard"); },
      get referenceImageAnalysis() { return table("referenceImageAnalysis"); },
      get combinedVisualDirection() { return table("combinedVisualDirection"); },
      get uploadedFile() { return table("uploadedFile"); },
      get generatedMedia() { return table("generatedMedia"); },
      get publishedPost() { return table("publishedPost"); },
    },
  },
});

const { prisma: prismaMock } = await import("@/lib/prisma");

mock.module("@/lib/auth", {
  exports: {
    getCurrentUser: async () => currentUser,
    assertCalendarAccess: async () => ({ allowed: true, isAdmin: currentUser?.role === "admin" }),
  },
});

const { groupCalendarsByBrand, removeCalendar } = await import("@/lib/calendar-grouping");
const { createCalendarDeleter } = await import("@/lib/calendar-delete");
const { brandScopeWhere } = await import("@/lib/brand-access");
const calendarRoute = await import("../app/api/calendars/[id]/route.js");

db = freshDb();

// ── Grouping ─────────────────────────────────────────────────────────────────

const CARDS = [
  { id: "1", title: "One", brandId: "b-cucctv", brandName: "CUCCTV" },
  { id: "2", title: "Two", brandId: "b-be", brandName: "BE Academy" },
  { id: "3", title: "Three", brandId: "b-cucctv", brandName: "CUCCTV" },
  { id: "4", title: "Four", brandId: "b-abc", brandName: "All Brains Clinic" },
];

test("calendars are grouped by brand, alphabetically, with per-brand counts", () => {
  const sections = groupCalendarsByBrand(CARDS);
  assert.deepEqual(
    sections.map((s) => [s.brandName, s.count]),
    [["All Brains Clinic", 1], ["BE Academy", 1], ["CUCCTV", 2]]
  );
  // The total across sections is the total number of calendars.
  assert.equal(sections.reduce((n, s) => n + s.count, 0), CARDS.length);
});

test("calendars keep their incoming order inside a brand section", () => {
  const sections = groupCalendarsByBrand(CARDS);
  const cucctv = sections.find((s) => s.brandName === "CUCCTV");
  assert.deepEqual(cucctv.calendars.map((c) => c.id), ["1", "3"]);
});

test("a brand with no visible calendars produces no section", () => {
  const sections = groupCalendarsByBrand(CARDS.filter((c) => c.brandId !== "b-be"));
  assert.equal(sections.length, 2);
  assert.ok(!sections.some((s) => s.brandName === "BE Academy"));
});

test("a single accessible brand still renders as a brand section", () => {
  const sections = groupCalendarsByBrand([CARDS[3]]);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].brandName, "All Brains Clinic");
});

test("brand-less calendars fall into a single trailing section", () => {
  const sections = groupCalendarsByBrand([...CARDS, { id: "5", title: "Five", brandId: null }]);
  assert.equal(sections.at(-1).brandName, "No brand");
  assert.equal(sections.at(-1).brandId, null);
});

test("no calendars at all means no sections", () => {
  assert.deepEqual(groupCalendarsByBrand([]), []);
});

// ── List scoping ─────────────────────────────────────────────────────────────

async function listFor(user) {
  currentUser = user;
  const where = await brandScopeWhere(user);
  return prismaMock.contentCalendar.findMany({ where });
}

test("an admin sees the calendars of every brand", async () => {
  const rows = await listFor(admin);
  assert.deepEqual(rows.map((r) => r.id).sort(), ["cal-a1", "cal-a2", "cal-b1"]);
});

test("an assigned user only receives their own brands' calendars", async () => {
  const rows = await listFor(userA);
  assert.deepEqual(rows.map((r) => r.id).sort(), ["cal-a1", "cal-a2"]);
  assert.ok(!rows.some((r) => r.brandId === BRAND_B), "brand B must not leak");
  // Not even the brand name of an inaccessible brand reaches the client.
  assert.ok(!groupCalendarsByBrand(rows.map((r) => ({ ...r, brandName: "Alpha Brand" })))
    .some((s) => s.brandName === "Beta Brand"));

  const both = await listFor(userAB);
  assert.deepEqual(both.map((r) => r.id).sort(), ["cal-a1", "cal-a2", "cal-b1"]);
});

test("a user with no brands receives no calendars", async () => {
  const rows = await listFor(userNone);
  assert.deepEqual(rows, []);
});

// ── DELETE authorization ─────────────────────────────────────────────────────

function deleteRequest(id) {
  return calendarRoute.DELETE(new Request(`https://app.test/api/calendars/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });
}

test("a user cannot delete a calendar belonging to a brand they are not assigned to", async () => {
  db = freshDb();
  currentUser = userA;
  const res = await deleteRequest("cal-b1");
  assert.equal(res.status, 403);
  assert.ok(db.contentCalendar.some((c) => c.id === "cal-b1"), "the calendar must survive");
});

test("a user with no brands is refused", async () => {
  db = freshDb();
  currentUser = userNone;
  assert.equal((await deleteRequest("cal-a1")).status, 403);
  assert.equal(db.contentCalendar.length, 3);
});

test("an unknown calendar is 404", async () => {
  db = freshDb();
  currentUser = admin;
  assert.equal((await deleteRequest("cal-missing")).status, 404);
});

test("an unauthenticated delete is 401", async () => {
  db = freshDb();
  currentUser = null;
  assert.equal((await deleteRequest("cal-a1")).status, 401);
});

test("an assigned user can delete a calendar of their own brand", async () => {
  db = freshDb();
  currentUser = userA;
  const res = await deleteRequest("cal-a2");
  assert.equal(res.status, 200);
  assert.deepEqual(db.contentCalendar.map((c) => c.id).sort(), ["cal-a1", "cal-b1"]);
});

// ── DELETE data policy ───────────────────────────────────────────────────────

test("an admin delete removes the calendar, its posts and its calendar-only records", async () => {
  db = freshDb();
  currentUser = admin;
  const res = await deleteRequest("cal-a1");
  assert.equal(res.status, 200);

  assert.ok(!db.contentCalendar.some((c) => c.id === "cal-a1"));
  assert.deepEqual(db.calendarPost.map((p) => p.id), ["post-b1-1"]);
  // Prompts/storyboards/analyses attached to the calendar or its posts are gone.
  assert.deepEqual(db.generatedPrompt.map((p) => p.id).sort(), ["gp-brand", "gp-other"]);
  assert.deepEqual(db.videoStoryboard, []);
  assert.deepEqual(db.referenceImageAnalysis, []);
  assert.deepEqual(db.combinedVisualDirection, []);
});

test("file-backed records are preserved and detached, not deleted", async () => {
  db = freshDb();
  currentUser = admin;
  await deleteRequest("cal-a1");

  const file = db.uploadedFile.find((f) => f.id === "file-1");
  assert.ok(file, "the uploaded reference file row must survive");
  assert.equal(file.calendarId, null);
  assert.equal(file.brandId, BRAND_A, "it stays a brand asset");
  assert.equal(file.filePath, "uploads/images/a.png");

  const media = db.generatedMedia.find((m) => m.id === "media-1");
  assert.ok(media, "generated media must survive");
  assert.equal(media.calendarPostId, null);
  assert.equal(media.filePath, "uploads/images/gen.png");
});

test("other brands and calendars are untouched by a delete", async () => {
  db = freshDb();
  currentUser = admin;
  await deleteRequest("cal-a1");

  assert.deepEqual(db.contentCalendar.map((c) => c.id).sort(), ["cal-a2", "cal-b1"]);
  assert.deepEqual(db.brand.map((b) => b.id).sort(), [BRAND_A, BRAND_B]);
  assert.deepEqual(db.publishedPost.map((p) => p.id), ["pub-1"]);
  assert.ok(db.generatedPrompt.some((p) => p.id === "gp-other"));
});

// ── Delete UX ────────────────────────────────────────────────────────────────

test("a successful delete removes the card and updates the counts", async () => {
  const before = groupCalendarsByBrand(CARDS);
  assert.equal(before.find((s) => s.brandName === "CUCCTV").count, 2);

  const next = removeCalendar(CARDS, "1");
  const after = groupCalendarsByBrand(next);
  assert.equal(next.length, 3);
  assert.equal(after.find((s) => s.brandName === "CUCCTV").count, 1);
});

test("deleting the last calendar of a brand drops that brand's section", () => {
  const after = groupCalendarsByBrand(removeCalendar(CARDS, "4"));
  assert.ok(!after.some((s) => s.brandName === "All Brains Clinic"));
  assert.equal(after.length, 2);
});

test("a failed delete reports the API error and leaves the list intact", async () => {
  const deleteCalendar = createCalendarDeleter({
    fetchImpl: async () => new Response(JSON.stringify({ error: "You do not have access to this brand." }), { status: 403 }),
  });
  const result = await deleteCalendar("1");
  assert.equal(result.ok, false);
  assert.equal(result.error, "You do not have access to this brand.");
  assert.equal(groupCalendarsByBrand(CARDS).reduce((n, s) => n + s.count, 0), 4);
});

test("a second delete for the same id while one is in flight makes no request", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const deleteCalendar = createCalendarDeleter({
    fetchImpl: async () => {
      calls += 1;
      await gate;
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    },
  });

  const first = deleteCalendar("1");
  const second = await deleteCalendar("1");
  assert.equal(second.skipped, true);
  assert.equal(calls, 1);

  release();
  assert.equal((await first).ok, true);
  // Once settled the guard releases the id again.
  assert.equal(deleteCalendar.isPending("1"), false);
});
