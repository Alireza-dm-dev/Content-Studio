// TODAY dashboard: lib/today (getTodayData), GET /api/today and the pure filter.
// Real lib/brand-access + lib/timezone + serializers against an in-memory Prisma
// stand-in. Every write method on the stand-in records a call, so tests can
// prove the dashboard never mutates anything.

import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const A = "brand-london";
const B = "brand-vancouver";
const C = "brand-no-tz";
const X = "brand-secret"; // nobody below except admin can reach it

const admin = { id: "admin", role: "admin", name: "Admin" };
const userA = { id: "user-a", role: "user", name: "A only" };
const userB = { id: "user-b", role: "user", name: "B only" };
const userAB = { id: "user-ab", role: "user", name: "A and B" };
const userNone = { id: "user-none", role: "user", name: "Nobody" };

let db;
let currentUser;
let writes;

function reset() {
  db = {
    brands: [
      { id: A, name: "BE Academy", timezone: "Europe/London" },
      { id: B, name: "Coast Studio", timezone: "America/Vancouver" },
      { id: C, name: "No Zone Co", timezone: null },
      { id: X, name: "Top Secret Brand", timezone: "Europe/London" },
    ],
    memberships: [
      { userId: userA.id, brandId: A },
      { userId: userB.id, brandId: B },
      { userId: userAB.id, brandId: A },
    ],
    assignments: [{ userId: userAB.id, brandId: B }], // legacy table also grants access
    posts: [],
    media: [],
    collaborators: [],
    stories: [],
    assets: [],
  };
  writes = [];
  currentUser = admin;
}
reset();

// ── Minimal where evaluator for the shapes lib/today uses ────────────────────
function cmp(value, cond) {
  if (cond && typeof cond === "object" && !(cond instanceof Date)) {
    if ("in" in cond && !cond.in.includes(value)) return false;
    const t = value instanceof Date ? value.getTime() : value;
    if ("gte" in cond && !(t != null && t >= cond.gte.getTime())) return false;
    if ("lt" in cond && !(t != null && t < cond.lt.getTime())) return false;
    return true;
  }
  return value === cond;
}
function matches(row, where, collabOf = () => []) {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where)) {
    if (k === "OR") { if (!cond.some((w) => matches(row, w, collabOf))) return false; continue; }
    if (k === "collaborators") { if (!collabOf(row).some((c) => matches(c, cond.some))) return false; continue; }
    if (!cmp(row[k], cond)) return false;
  }
  return true;
}

const brandOf = (id) => db.brands.find((b) => b.id === id);
const collabOf = (p) => db.collaborators.filter((c) => c.publishedPostId === p.id);
const noWrite = (name) => async () => { writes.push(name); throw new Error(`unexpected write: ${name}`); };

const prisma = {
  brand: {
    findMany: async ({ where, select, orderBy }) => {
      let rows = db.brands.filter((b) => matches(b, where));
      if (orderBy?.name) rows = rows.sort((a, b) => a.name.localeCompare(b.name));
      return rows.map((b) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, b[k]])) : { ...b }));
    },
    findUnique: async ({ where }) => brandOf(where.id) ?? null,
    update: noWrite("brand.update"),
  },
  brandMembership: {
    findUnique: async ({ where }) => {
      const { userId, brandId } = where.userId_brandId;
      return db.memberships.some((m) => m.userId === userId && m.brandId === brandId) ? { id: "m" } : null;
    },
    findMany: async ({ where }) => db.memberships.filter((m) => m.userId === where.userId),
  },
  brandAssignment: {
    findUnique: async ({ where }) => {
      const { userId, brandId } = where.userId_brandId;
      return db.assignments.some((m) => m.userId === userId && m.brandId === brandId) ? { id: "a" } : null;
    },
    findMany: async ({ where }) => db.assignments.filter((m) => m.userId === where.userId),
  },
  publishedPost: {
    findMany: async ({ where, include }) =>
      db.posts.filter((p) => matches(p, where, collabOf)).map((p) => {
        const out = { ...p };
        if (include?.media) out.media = db.media.filter((m) => m.publishedPostId === p.id);
        if (include?._count) out._count = { comments: 0 };
        if (include?.brand) { const b = brandOf(p.brandId); out.brand = { id: b.id, name: b.name, timezone: b.timezone }; }
        if (include?.collaborators) out.collaborators = collabOf(p).map((c) => ({ brandId: c.brandId, brand: { id: c.brandId, name: brandOf(c.brandId).name } }));
        return out;
      }),
    update: noWrite("publishedPost.update"),
    delete: noWrite("publishedPost.delete"),
    deleteMany: noWrite("publishedPost.deleteMany"),
    updateMany: noWrite("publishedPost.updateMany"),
  },
  brandStoryContent: {
    findMany: async ({ where }) =>
      db.stories.filter((s) => matches(s, where)).map((s) => ({ ...s, assets: db.assets.filter((a) => a.storyContentId === s.id) })),
    update: noWrite("brandStoryContent.update"),
    delete: noWrite("brandStoryContent.delete"),
  },
  brandStoryAsset: {},
};

mock.module("@/lib/prisma", { exports: { prisma } });
mock.module("@/lib/auth", { exports: { getCurrentUser: async () => currentUser, SESSION_COOKIE_NAME: "content_studio_session" } });
mock.module("@/lib/published-post-webhook", { exports: { sendPublishedPostToN8n: noWrite("n8n.send") } });

const { getTodayData, brandTodayWindow, isPostOverdue } = await import("@/lib/today");
const { filterTodayBrands } = await import("@/lib/today-filter");
const route = await import("../app/api/today/route.js");

// ── Fixtures ─────────────────────────────────────────────────────────────────
const NOW = new Date("2026-11-23T06:00:00Z");
const H = 3600e3;
const win = (brandId, now = NOW) => brandTodayWindow(brandOf(brandId), now);
const at = (brandId, hoursIntoToday, now = NOW) => new Date(win(brandId, now).startUtc.getTime() + hoursIntoToday * H);

let seq = 0;
function post(brandId, platform, scheduledDate, extra = {}) {
  const id = extra.id || `p${++seq}`;
  db.posts.push({
    id, brandId, platform, postType: "static", status: "draft", caption: `caption ${id} of ${brandId}`,
    scheduledDate, createdAt: new Date("2026-01-01T00:00:00Z"), postNumber: seq, thumbnailUrl: null, jsonPayload: null, notes: null,
    ...extra,
  });
  db.media.push({ id: `m-${id}`, publishedPostId: id, url: `/uploads/${brandId}/published-posts/${id}/a.png`, mediaType: "IMAGE", order: 1, fileName: "a.png" });
  return id;
}
function story(brandId, storyDate, extra = {}) {
  const id = extra.id || `s${++seq}`;
  db.stories.push({
    id, brandId, storyDate, status: "READY", comments: `story ${id} of ${brandId}`, createdByName: "Creator",
    completedByName: null, completedAt: null, createdAt: new Date(), updatedAt: new Date(), ...extra,
  });
  db.assets.push({ id: `as-${id}`, storyContentId: id, originalFileName: "s.png", storedPath: "secret/path/on/disk.png", mimeType: "image/png", mediaType: "IMAGE", fileSize: 10, sortOrder: 0, uploadedByName: "Creator", createdAt: new Date() });
  return id;
}
const section = (data, brandId) => data.brands.find((b) => b.id === brandId);
const ids = (list) => list.map((x) => x.id).sort();

beforeEach(() => { reset(); seq = 0; });

// ── Windows / timezone ───────────────────────────────────────────────────────
test("8/9. Brand-local today: London and Vancouver differ at the same UTC instant", () => {
  const l = win(A);
  const v = win(B);
  assert.equal(l.date, "2026-11-23");
  assert.equal(v.date, "2026-11-22", "still yesterday in Vancouver at 06:00Z");
  assert.equal(l.startUtc.toISOString(), "2026-11-23T00:00:00.000Z");
  assert.equal(l.endUtc.getTime() - l.startUtc.getTime(), 24 * H);
  assert.ok(v.startUtc < NOW && NOW < v.endUtc);
  assert.match(l.label, /^Monday, 23 November 2026$/);
});

test("10. DST boundary: London spring-forward day is 23h; edges are exact", async () => {
  const now = new Date("2026-03-29T12:00:00Z");
  const w = win(A, now);
  assert.equal(w.date, "2026-03-29");
  assert.equal(w.endUtc.getTime() - w.startUtc.getTime(), 23 * H);
  const last = post(A, "Instagram", new Date(w.endUtc.getTime() - 60e3)); // 23:59 local
  const next = post(A, "Instagram", w.endUtc);                            // 00:00 tomorrow
  const first = post(A, "Instagram", w.startUtc);                         // 00:00 today
  const before = post(A, "Instagram", new Date(w.startUtc.getTime() - 60e3));
  const data = await getTodayData(admin, { now });
  assert.deepEqual(ids(section(data, A).instagram), [first, last].sort());
  assert.ok(![next, before].some((id) => JSON.stringify(data).includes(`"${id}"`)));
});

test("23. no timezone → existing default (America/Vancouver), flagged as fallback", async () => {
  const w = win(C);
  assert.equal(w.timeZone, "America/Vancouver");
  assert.equal(w.isFallback, true);
  assert.equal(win(A).isFallback, false);
  const today = post(C, "Instagram", at(C, 12));
  const data = await getTodayData(admin, { now: NOW });
  const s = section(data, C);
  assert.equal(s.timeZone, "America/Vancouver");
  assert.equal(s.timeZoneIsFallback, true);
  assert.deepEqual(ids(s.instagram), [today]);
});

// ── Inclusion / exclusion ────────────────────────────────────────────────────
test("4-7. today's Instagram + LinkedIn included; yesterday/tomorrow excluded; per Brand zone", async () => {
  const igA = post(A, "Instagram", at(A, 10));
  const liA = post(A, "LinkedIn", at(A, 15), { postType: "carousel" });
  const yA = post(A, "Instagram", at(A, -1));
  const tA = post(A, "LinkedIn", at(A, 24.5));
  const igB = post(B, "Instagram", at(B, 20));
  const yB = post(B, "Instagram", at(B, -3));
  // An instant that is "today" in London but already "tomorrow" in Vancouver.
  const londonOnly = post(B, "Instagram", at(A, 23));
  const noDate = post(A, "Instagram", null);

  const data = await getTodayData(admin, { now: NOW });
  assert.deepEqual(ids(section(data, A).instagram), [igA]);
  assert.deepEqual(ids(section(data, A).linkedin), [liA]);
  assert.deepEqual(ids(section(data, B).instagram), [igB]);
  const json = JSON.stringify(data);
  for (const gone of [yA, tA, yB, londonOnly, noDate]) assert.ok(!json.includes(`"id":"${gone}"`), gone);
});

test("11-14. Stories: Brand-local date string; Ready vs Uploaded; neighbours excluded", async () => {
  const sA = story(A, "2026-11-23");
  const sAy = story(A, "2026-11-22"); // London yesterday…
  const sB = story(B, "2026-11-22", { status: "UPLOADED", completedByName: "Uploader", completedAt: new Date() }); // …but Vancouver today
  const sBt = story(B, "2026-11-23"); // Vancouver tomorrow
  const data = await getTodayData(admin, { now: NOW });
  assert.deepEqual(ids(section(data, A).stories), [sA]);
  assert.deepEqual(ids(section(data, B).stories), [sB]);
  assert.equal(section(data, A).stories[0].status, "READY");
  assert.equal(section(data, B).stories[0].status, "UPLOADED");
  assert.equal(section(data, B).stories[0].completedByName, "Uploader");
  assert.equal(data.counts.storiesReady, 1);
  assert.equal(data.counts.storiesUploaded, 1);
  const json = JSON.stringify(data);
  assert.ok(!json.includes(`"id":"${sAy}"`) && !json.includes(`"id":"${sBt}"`));
});

// ── Collaboration ────────────────────────────────────────────────────────────
test("15/16. collaboration post appears once, under the PRIMARY Brand, and counts once", async () => {
  const p = post(A, "Instagram", at(A, 11));
  db.collaborators.push({ id: "c1", publishedPostId: p, brandId: B });
  for (const user of [admin, userAB]) {
    const data = await getTodayData(user, { now: NOW });
    assert.deepEqual(ids(section(data, A).instagram), [p], user.id);
    assert.deepEqual(section(data, B).instagram, [], "no duplicate task under the collaborator");
    assert.equal(data.counts.instagram, 1);
    assert.equal(data.counts.posts, 1);
    const shown = section(data, A).instagram[0];
    assert.equal(shown.isCollaboration, true);
    assert.equal(shown.viewerRelation, "primary");
    assert.deepEqual(shown.collaboratorBrands.map((b) => b.name), ["Coast Studio"]);
    assert.equal(shown.canManage, true);
  }
});

test("15b. a collaborator-only viewer sees it once under their Brand, read-only", async () => {
  const p = post(A, "Instagram", at(A, 11));
  db.collaborators.push({ id: "c1", publishedPostId: p, brandId: B });
  const data = await getTodayData(userB, { now: NOW });
  assert.deepEqual(data.brands.map((b) => b.id), [B]);
  const shown = section(data, B).instagram;
  assert.deepEqual(ids(shown), [p]);
  assert.equal(shown[0].viewerRelation, "collaborator");
  assert.equal(shown[0].canManage, false);
  // "Today" for the post is the primary Brand's today (London), shown in London time.
  assert.equal(shown[0].today.timeZone, "Europe/London");
  assert.equal(data.counts.instagram, 1);
});

test("15c. LinkedIn posts never surface through a collaborator row", async () => {
  const p = post(A, "LinkedIn", at(A, 11));
  db.collaborators.push({ id: "c1", publishedPostId: p, brandId: B }); // invalid data
  const data = await getTodayData(userB, { now: NOW });
  assert.ok(!JSON.stringify(data).includes(`"id":"${p}"`));
});

// ── Access ───────────────────────────────────────────────────────────────────
function seedEverything() {
  return {
    a: post(A, "Instagram", at(A, 9)),
    b: post(B, "LinkedIn", at(B, 9)),
    c: post(C, "Instagram", at(C, 9)),
    x: post(X, "Instagram", at(X, 9), { caption: "TOP SECRET CAPTION" }),
    xs: story(X, win(X).date, { comments: "SECRET STORY NOTE" }),
    as: story(A, win(A).date),
  };
}

test("1. admin sees every Brand", async () => {
  const s = seedEverything();
  const data = await getTodayData(admin, { now: NOW });
  assert.deepEqual(data.brands.map((b) => b.id).sort(), [A, B, C, X].sort());
  assert.equal(data.counts.posts, 4);
  assert.equal(data.counts.stories, 2);
  assert.ok(JSON.stringify(data).includes(s.x));
});

test("2/3/25. assigned users see only their Brands; nothing else leaks (names, ids, captions, stories, media)", async () => {
  const s = seedEverything();
  const a = await getTodayData(userA, { now: NOW });
  assert.deepEqual(a.brands.map((b) => b.id), [A]);
  const json = JSON.stringify(a);
  for (const leak of ["Top Secret Brand", "TOP SECRET CAPTION", "SECRET STORY NOTE", "Coast Studio", "No Zone Co", s.x, s.xs, s.b, s.c, `/uploads/${X}/`, `/uploads/${B}/`]) {
    assert.ok(!json.includes(leak), `leaked ${leak}`);
  }
  assert.equal(a.counts.posts, 1);
  assert.equal(a.counts.stories, 1);

  const ab = await getTodayData(userAB, { now: NOW }); // membership + legacy assignment
  assert.deepEqual(ab.brands.map((b) => b.id).sort(), [A, B].sort());

  const none = await getTodayData(userNone, { now: NOW });
  assert.deepEqual(none.brands, []);
  assert.equal(none.counts.total, 0);
  assert.deepEqual(await getTodayData(null, { now: NOW }).then((d) => d.brands), []);
});

test("17. media + story asset URLs stay within the post's Brand; no storage paths", async () => {
  seedEverything();
  const data = await getTodayData(admin, { now: NOW });
  for (const b of data.brands) {
    for (const p of [...b.instagram, ...b.linkedin]) {
      for (const m of p.media) assert.match(m.url, new RegExp(`^/uploads/${p.brandId}/`));
    }
    for (const st of b.stories) {
      for (const a of st.assets) assert.match(a.url, new RegExp(`^/api/brands/${b.id}/story-content/${st.id}/assets/`));
    }
  }
  assert.ok(!JSON.stringify(data).includes("secret/path/on/disk"), "storedPath never returned");
});

// ── Counts / overdue / order ─────────────────────────────────────────────────
test("18/24. counts are unique tasks; overdue is Brand-local and respects 'published'", async () => {
  const late = post(A, "Instagram", at(A, 5));                        // 05:00 London, now 06:00 → overdue
  post(A, "Instagram", at(A, 4), { status: "published" });            // done → not overdue
  post(A, "LinkedIn", at(A, 3), { status: "archived" });              // archived → not overdue
  post(A, "LinkedIn", at(A, 18));                                     // later today
  const vLate = post(B, "Instagram", at(B, 21));                      // 21:xx Vancouver (before 22:xx now) → overdue
  post(B, "Instagram", new Date(NOW.getTime() + 30 * 60e3));          // 30 min ahead → not yet
  story(B, win(B).date);

  const data = await getTodayData(admin, { now: NOW });
  const overdueIds = data.brands.flatMap((b) => [...b.instagram, ...b.linkedin]).filter((p) => p.today.overdue).map((p) => p.id).sort();
  assert.deepEqual(overdueIds, [late, vLate].sort());
  assert.deepEqual(
    { ig: data.counts.instagram, li: data.counts.linkedin, posts: data.counts.posts, st: data.counts.stories, total: data.counts.total, od: data.counts.overdue, active: data.counts.brandsWithActivity },
    { ig: 4, li: 2, posts: 6, st: 1, total: 7, od: 2, active: 2 },
  );
  assert.equal(section(data, A).counts.overdue, 1);
  assert.equal(isPostOverdue({ scheduledDate: null, status: "draft" }, NOW), false);
});

test("posts are listed in schedule order with a Brand-local time label", async () => {
  const late = post(A, "Instagram", at(A, 17.5));
  const early = post(A, "Instagram", at(A, 9.25));
  const data = await getTodayData(admin, { now: NOW });
  const list = section(data, A).instagram;
  assert.deepEqual(list.map((p) => p.id), [early, late]);
  assert.equal(list[0].today.localTime, "9:15 AM");
  assert.equal(list[1].today.localTime, "5:30 PM");
  assert.equal(list[0].today.timeZone, "Europe/London");
});

test("22. empty day: zero counts, every accessible Brand still listed", async () => {
  const data = await getTodayData(admin, { now: NOW });
  assert.equal(data.counts.total, 0);
  assert.equal(data.counts.brandsWithActivity, 0);
  assert.equal(data.brands.length, 4);
  assert.deepEqual(filterTodayBrands(data.brands), []);
  assert.equal(filterTodayBrands(data.brands, { showEmpty: true }).length, 4);
});

// ── Filters ──────────────────────────────────────────────────────────────────
test("19-21. filters: Instagram / LinkedIn / Stories / Brand", async () => {
  post(A, "Instagram", at(A, 9));
  post(B, "LinkedIn", at(B, 9));
  story(B, win(B).date);
  const data = await getTodayData(admin, { now: NOW });
  const flat = (bs, k) => bs.flatMap((b) => b[k]).length;

  const ig = filterTodayBrands(data.brands, { filter: "instagram" });
  assert.deepEqual(ig.map((b) => b.id), [A]);
  assert.equal(flat(ig, "linkedin") + flat(ig, "stories"), 0);

  const li = filterTodayBrands(data.brands, { filter: "linkedin" });
  assert.deepEqual(li.map((b) => b.id), [B]);
  assert.equal(flat(li, "instagram") + flat(li, "stories"), 0);

  const st = filterTodayBrands(data.brands, { filter: "stories" });
  assert.deepEqual(st.map((b) => b.id), [B]);
  assert.equal(flat(st, "stories"), 1);

  assert.deepEqual(filterTodayBrands(data.brands, { brandId: B }).map((b) => b.id), [B]);
  assert.deepEqual(filterTodayBrands(data.brands, { brandId: B, filter: "instagram" }), []);
});

// ── API route ────────────────────────────────────────────────────────────────
test("API: 401 when signed out; user-scoped payload; GET never writes", async () => {
  currentUser = null;
  const anon = await route.GET(new Request("http://x/api/today"));
  assert.equal(anon.status, 401);

  // Relative to the real clock: the route uses "now".
  const now = new Date();
  post(A, "Instagram", new Date(Math.max(win(A, now).startUtc.getTime(), now.getTime() - 60e3)), { caption: "visible to A" });
  post(X, "Instagram", now, { caption: "TOP SECRET CAPTION" });
  story(X, win(X, now).date, { comments: "SECRET STORY NOTE" });

  currentUser = userA;
  const res = await route.GET(new Request("http://x/api/today"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = await res.json();
  assert.deepEqual(body.brands.map((b) => b.id), [A]);
  const json = JSON.stringify(body);
  assert.ok(json.includes("visible to A"));
  for (const leak of ["TOP SECRET", "SECRET STORY", "Top Secret Brand"]) assert.ok(!json.includes(leak), leak);
  assert.deepEqual(writes, [], "the dashboard never writes");
});

test("API: a failing query returns a safe 500 without internals", async () => {
  const real = prisma.publishedPost.findMany;
  prisma.publishedPost.findMany = async () => { throw new Error("SQLITE_BUSY at /secret/db/path"); };
  try {
    currentUser = admin;
    const res = await route.GET(new Request("http://x/api/today"));
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.doesNotMatch(JSON.stringify(body), /SQLITE|secret/);
  } finally {
    prisma.publishedPost.findMany = real;
  }
});

test("navigation + proxy: TODAY is the first nav item and reachable by normal users", async () => {
  const { readFileSync } = await import("node:fs");
  const nav = readFileSync("components/sidebar-nav.jsx", "utf8");
  assert.match(nav, /\{ n: "01", label: "TODAY", sub: "publish queue", href: "\/today" \}/);
  assert.match(nav, /\{ n: "02", label: "BRANDS"/);
  const proxy = readFileSync("proxy.js", "utf8");
  assert.match(proxy, /USER_PAGE_PREFIXES = \[\s*"\/today",/);
  assert.match(proxy, /"\/api\/today",/);
});
