// LinkedIn Published Posts retention: keep every queued post + the 5 most
// recent historical posts, per primary Brand, LinkedIn only.
//
// Pure selection is tested directly; the trigger points are exercised through
// the real routes against an in-memory Prisma stand-in. Storage, auth, remote
// media and both n8n webhooks are mocked: nothing touches disk or the network.

import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { matchesWhere } from "./helpers/prisma-where.mjs";

const BRAND_A = "brand-a"; // Europe/London
const BRAND_B = "brand-b"; // other brand, must never be touched
const admin = { id: "admin", role: "admin", name: "Admin" };
const outsider = { id: "outsider", role: "user", name: "No access" };

let db;
let seq;
let currentUser;
let calls;

function resetDb() {
  seq = 0;
  db = {
    brands: [
      { id: BRAND_A, name: "Brand A", timezone: "Europe/London" },
      { id: BRAND_B, name: "Brand B", timezone: "America/Vancouver" },
    ],
    memberships: [],
    posts: [],
    media: [],
    collaborators: [],
    comments: [],
  };
  calls = { n8nSend: [], deleteWebhook: [], postDeletes: [], readdir: [], unlink: [] };
  currentUser = admin;
}
resetDb();

const collabOf = (post) => db.collaborators.filter((c) => c.publishedPostId === post.id);

function pick(row, select) {
  if (!select) return { ...row };
  const out = {};
  for (const k of Object.keys(select)) if (select[k]) out[k] = row[k];
  return out;
}

function withInclude(post, include) {
  if (!post) return null;
  const out = { ...post };
  if (!include) return out;
  if (include.media) {
    out.media = db.media.filter((m) => m.publishedPostId === post.id).sort((a, b) => a.order - b.order);
  }
  if (include._count) {
    out._count = { comments: db.comments.filter((c) => c.publishedPostId === post.id).length };
  }
  if (include.brand) out.brand = db.brands.find((b) => b.id === post.brandId);
  if (include.collaborators) out.collaborators = [];
  return out;
}

function applyOrder(list, orderBy) {
  if (!orderBy) return list;
  const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).map((o) => Object.entries(o)[0]);
  const val = (v) => (v == null ? null : v instanceof Date ? v.getTime() : v);
  return [...list].sort((a, b) => {
    for (const [k, dir] of keys) {
      const x = val(a[k]);
      const y = val(b[k]);
      if (x === y) continue;
      let c;
      if (x === null) c = -1;
      else if (y === null) c = 1;
      else c = x < y ? -1 : 1;
      return dir === "desc" ? -c : c;
    }
    return 0;
  });
}

function cascade(id) {
  db.media = db.media.filter((m) => m.publishedPostId !== id);
  db.collaborators = db.collaborators.filter((c) => c.publishedPostId !== id);
  db.comments = db.comments.filter((c) => c.publishedPostId !== id);
}

const prisma = {
  brand: {
    findUnique: async ({ where }) => db.brands.find((b) => b.id === where.id) ?? null,
    findMany: async ({ where }) => db.brands.filter((b) => matchesWhere(b, where)),
  },
  brandMembership: {
    findUnique: async ({ where }) => {
      const { userId, brandId } = where.userId_brandId;
      return db.memberships.some((m) => m.userId === userId && m.brandId === brandId) ? { id: "m" } : null;
    },
    findMany: async ({ where }) => db.memberships.filter((m) => m.userId === where.userId),
  },
  brandAssignment: { findUnique: async () => null, findMany: async () => [] },
  publishedPost: {
    findMany: async ({ where, orderBy, include, select }) =>
      applyOrder(db.posts.filter((p) => matchesWhere(p, where, collabOf)), orderBy).map((p) =>
        select ? pick(p, select) : withInclude(p, include),
      ),
    findFirst: async ({ where, orderBy, include, select }) => {
      const rows = applyOrder(db.posts.filter((p) => matchesWhere(p, where, collabOf)), orderBy);
      if (!rows[0]) return null;
      return select ? pick(rows[0], select) : withInclude(rows[0], include);
    },
    findUnique: async ({ where, include }) => withInclude(db.posts.find((p) => p.id === where.id), include),
    create: async ({ data }) => {
      const row = {
        thumbnailUrl: null,
        jsonPayload: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      db.posts.push(row);
      return { ...row };
    },
    update: async ({ where, data, include }) => {
      const p = db.posts.find((x) => x.id === where.id);
      Object.assign(p, data);
      return withInclude(p, include);
    },
    delete: async ({ where }) => {
      calls.postDeletes.push(where.id);
      db.posts = db.posts.filter((p) => p.id !== where.id);
      cascade(where.id);
      return { id: where.id };
    },
    deleteMany: async ({ where }) => {
      const gone = db.posts.filter((p) => matchesWhere(p, where));
      for (const p of gone) {
        calls.postDeletes.push(p.id);
        cascade(p.id);
      }
      db.posts = db.posts.filter((p) => !gone.includes(p));
      return { count: gone.length };
    },
  },
  publishedPostMedia: {
    create: async ({ data }) => {
      const row = { id: `m${++seq}`, ...data };
      db.media.push(row);
      return row;
    },
  },
  publishedPostCollaborator: {
    create: async ({ data }) => {
      db.collaborators.push({ id: `c${++seq}`, createdAt: new Date(), ...data });
    },
    findFirst: async ({ where }) => db.collaborators.find((c) => matchesWhere(c, where)) ?? null,
    findMany: async ({ where }) => db.collaborators.filter((c) => matchesWhere(c, where)),
    deleteMany: async ({ where }) => {
      const before = db.collaborators.length;
      db.collaborators = db.collaborators.filter((c) => !matchesWhere(c, where));
      return { count: before - db.collaborators.length };
    },
  },
  $transaction: async (fn) => fn(prisma),
};

mock.module("@/lib/prisma", { exports: { prisma } });
mock.module("@/lib/auth", {
  exports: { getCurrentUser: async () => currentUser, SESSION_COOKIE_NAME: "content_studio_session" },
});
mock.module("fs/promises", {
  exports: {
    writeFile: async () => {},
    mkdir: async () => {},
    rm: async () => {},
    readdir: async (p) => {
      calls.readdir.push(String(p));
      return [{ name: "media.png" }];
    },
    unlink: async (p) => { calls.unlink.push(String(p)); },
  },
});
mock.module("@/lib/published-post-remote-media", {
  exports: {
    uploadPublishedPostMedia: async () => {
      calls.remoteUploads = (calls.remoteUploads || 0) + 1;
      return { success: false, detailCode: "MOCK", error: "mocked" };
    },
    isCanonicalMediaUrl: () => false,
  },
});
mock.module("@/lib/published-post-webhook", {
  exports: { sendPublishedPostToN8n: async (args) => { calls.n8nSend.push(args); return { success: true }; } },
});
mock.module("@/lib/published-post-delete-webhook", {
  exports: {
    requiresExternalDeleteWebhook: () => true,
    sendPublishedPostDeleteToN8n: async (args) => { calls.deleteWebhook.push(args.post.id); return { success: true }; },
  },
});
mock.module("@/lib/instagram-caption-check", {
  exports: {
    validateInstagramCaptionForBrand: async () => ({ ok: true, failures: [], warnings: [] }),
    captionRulesErrorBody: (v) => v,
  },
});

const listRoute = await import("../app/api/brands/[id]/published-posts/route.js");
const itemRoute = await import("../app/api/brands/[id]/published-posts/[postId]/route.js");
const {
  selectLinkedInRetentionDeletions,
  enforceLinkedInRetention,
  isHistoricalLinkedInPost,
  brandDayStart,
  LINKEDIN_HISTORY_KEEP,
} = await import("@/lib/linkedin-retention");

// ── Helpers ──────────────────────────────────────────────────────────────────
const DAY = 24 * 60 * 60 * 1000;
const ctx = (id, postId) => ({ params: Promise.resolve(postId ? { id, postId } : { id }) });
const png = () => new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });

let rowSeq = 0;
function seed(brandId, platform, daysFromNow, extra = {}) {
  const id = extra.id || `${platform.toLowerCase()}-${brandId}-${++rowSeq}`;
  db.posts.push({
    id,
    brandId,
    platform,
    postType: "static",
    caption: `post ${id}`,
    status: "draft",
    scheduledDate: daysFromNow == null ? null : new Date(Date.now() + daysFromNow * DAY),
    createdAt: new Date(Date.UTC(2026, 0, 1) + rowSeq * 1000),
    postNumber: rowSeq,
    thumbnailUrl: null,
    jsonPayload: null,
    notes: null,
    ...extra,
  });
  db.media.push({ id: `m-${id}`, publishedPostId: id, url: `/uploads/${brandId}/published-posts/${id}/a.png`, mediaType: "IMAGE", order: 1 });
  db.comments.push({ id: `cm-${id}`, publishedPostId: id, body: "hi" });
  return id;
}

// q queued (future, +1..+q days), h historical (-2..-(h+1) days, newest first).
function seedBrand(brandId, q, h, platform = "LinkedIn") {
  const queued = [];
  const historical = [];
  for (let i = 1; i <= q; i++) queued.push(seed(brandId, platform, i + 1));
  for (let i = 1; i <= h; i++) historical.push(seed(brandId, platform, -(i + 1)));
  return { queued, historical };
}

const idsOf = (brandId, platform) =>
  db.posts.filter((p) => p.brandId === brandId && p.platform === platform).map((p) => p.id).sort();

async function createLinkedIn(brandId, { scheduledDate } = {}) {
  const fd = new FormData();
  fd.append("files", png());
  fd.append("platform", "LinkedIn");
  fd.append("postType", "static");
  fd.append("caption", "new post");
  if (scheduledDate) fd.append("scheduledDate", scheduledDate);
  const res = await listRoute.POST(new Request("http://x", { method: "POST", body: fd }), ctx(brandId));
  return { status: res.status, body: await res.json() };
}

async function edit(brandId, postId, body) {
  const res = await itemRoute.POST(
    new Request("http://x", { method: "POST", body: JSON.stringify(body) }),
    ctx(brandId, postId),
  );
  return { status: res.status, body: await res.json() };
}

beforeEach(() => resetDb());

// ── 1–4: pure selection matrix ───────────────────────────────────────────────
function matrix(q, h) {
  resetDb();
  const { queued, historical } = seedBrand(BRAND_A, q, h);
  const posts = db.posts.filter((p) => p.brandId === BRAND_A);
  const r = selectLinkedInRetentionDeletions(posts, { timeZone: "Europe/London" });
  return { queued, historical, r };
}

test("1. 0 queued + 10 historical → newest 5 remain", () => {
  const { historical, r } = matrix(0, 10);
  assert.equal(LINKEDIN_HISTORY_KEEP, 5);
  assert.deepEqual(r.keptHistoricalIds, historical.slice(0, 5));
  assert.deepEqual(r.deleteIds, historical.slice(5));
});

test("2. 7 queued + 10 historical → 12 remain", () => {
  const { queued, historical, r } = matrix(7, 10);
  assert.equal(r.queuedIds.length, 7);
  assert.deepEqual(r.queuedIds.sort(), [...queued].sort());
  assert.deepEqual(r.keptHistoricalIds, historical.slice(0, 5));
  assert.equal(r.deleteIds.length, 5);
  assert.equal(17 - r.deleteIds.length, 12);
});

test("3. 10 queued + 0 historical → all 10 remain", () => {
  const { r } = matrix(10, 0);
  assert.equal(r.queuedIds.length, 10);
  assert.deepEqual(r.deleteIds, []);
});

test("4. 2 queued + 3 historical → all remain", () => {
  const { r } = matrix(2, 3);
  assert.deepEqual(r.deleteIds, []);
});

test("unscheduled posts are queued, never historical", () => {
  resetDb();
  seedBrand(BRAND_A, 0, 6);
  const unscheduled = seed(BRAND_A, "LinkedIn", null);
  const r = selectLinkedInRetentionDeletions(db.posts, { timeZone: "Europe/London" });
  assert.ok(r.queuedIds.includes(unscheduled));
  assert.ok(!r.deleteIds.includes(unscheduled));
  assert.equal(r.deleteIds.length, 1);
});

test("protected ids are never selected", () => {
  resetDb();
  const { historical } = seedBrand(BRAND_A, 0, 7);
  const r = selectLinkedInRetentionDeletions(db.posts, { timeZone: "Europe/London", protectIds: [historical[6]] });
  assert.deepEqual(r.deleteIds, [historical[5]]);
});

// ── 10: ordering ─────────────────────────────────────────────────────────────
test("10. the kept five are the most recent by scheduledDate, regardless of insert/createdAt order", () => {
  resetDb();
  // Insert out of order; createdAt intentionally opposite to scheduledDate.
  const order = [-9, -2, -7, -3, -11, -5, -4, -10, -6, -8];
  const ids = order.map((d) => seed(BRAND_A, "LinkedIn", d));
  const r = selectLinkedInRetentionDeletions(db.posts, { timeZone: "Europe/London" });
  const byDay = Object.fromEntries(order.map((d, i) => [d, ids[i]]));
  assert.deepEqual(r.keptHistoricalIds, [-2, -3, -4, -5, -6].map((d) => byDay[d]));
  // Ties on scheduledDate fall back to createdAt DESC (same as the grid).
  resetDb();
  const when = new Date(Date.now() - 3 * DAY);
  const older = seed(BRAND_A, "LinkedIn", -3, { scheduledDate: when, createdAt: new Date(1000) });
  const newer = seed(BRAND_A, "LinkedIn", -3, { scheduledDate: when, createdAt: new Date(2000) });
  for (let i = 0; i < 4; i++) seed(BRAND_A, "LinkedIn", -1.5);
  const r2 = selectLinkedInRetentionDeletions(db.posts, { timeZone: "Europe/London" });
  assert.deepEqual(r2.deleteIds, [older]);
  assert.ok(r2.keptHistoricalIds.includes(newer));
});

// ── 11: Brand timezone ───────────────────────────────────────────────────────
test("11. 'today' is the Brand-local day, not the server's", () => {
  const now = new Date("2026-11-23T06:00:00Z");
  // London: Nov 23 06:00 → day starts 2026-11-23T00:00Z.
  assert.equal(brandDayStart(now, "Europe/London").toISOString(), "2026-11-23T00:00:00.000Z");
  // Los Angeles (PST, UTC-8): Nov 22 22:00 → day starts 2026-11-22T08:00Z.
  // (Not Vancouver: newer tzdata puts BC on permanent UTC-7 from Nov 2026.)
  assert.equal(brandDayStart(now, "America/Los_Angeles").toISOString(), "2026-11-22T08:00:00.000Z");
  // Tokyo (UTC+9): Nov 23 15:00 → day starts 2026-11-22T15:00Z.
  assert.equal(brandDayStart(now, "Asia/Tokyo").toISOString(), "2026-11-22T15:00:00.000Z");

  const post = { scheduledDate: new Date("2026-11-22T12:00:00Z") };
  assert.equal(isHistoricalLinkedInPost(post, { now, timeZone: "Europe/London" }), true);
  assert.equal(isHistoricalLinkedInPost(post, { now, timeZone: "America/Los_Angeles" }), false);
  // Earlier today (already past as an instant) still counts as queued.
  const earlierToday = { scheduledDate: new Date("2026-11-23T01:00:00Z") };
  assert.equal(isHistoricalLinkedInPost(earlierToday, { now, timeZone: "Europe/London" }), false);
  // Missing/invalid zone → default Brand timezone (America/Vancouver).
  assert.equal(isHistoricalLinkedInPost(post, { now, timeZone: null }), false);
  assert.equal(isHistoricalLinkedInPost(post, { now, timeZone: "BST" }), false);
});

test("11b. enforce reads the Brand's timezone when none is passed", async () => {
  const now = new Date("2026-11-23T06:00:00Z");
  const mid = [];
  for (let i = 0; i < 5; i++) mid.push(seed(BRAND_A, "LinkedIn", null, { scheduledDate: new Date(`2026-11-1${i}T12:00:00Z`) }));
  const edge = seed(BRAND_A, "LinkedIn", null, { scheduledDate: new Date("2026-11-22T12:00:00Z") });
  const oldest = seed(BRAND_A, "LinkedIn", null, { scheduledDate: new Date("2026-11-01T12:00:00Z") });
  // London brand: edge is yesterday → 7 historical → Nov 10 and Nov 1 removed.
  let r = await enforceLinkedInRetention(BRAND_A, { now });
  assert.deepEqual(r.deletedIds.sort(), [oldest, mid[0]].sort());
  assert.ok(db.posts.some((p) => p.id === edge));

  // Same rows under a Vancouver brand: edge is still "today" → queued.
  resetDb();
  db.brands[0].timezone = "America/Vancouver";
  for (let i = 0; i < 5; i++) seed(BRAND_A, "LinkedIn", null, { scheduledDate: new Date(`2026-11-1${i}T12:00:00Z`) });
  seed(BRAND_A, "LinkedIn", null, { scheduledDate: new Date("2026-11-22T12:00:00Z") });
  const oldest2 = seed(BRAND_A, "LinkedIn", null, { scheduledDate: new Date("2026-11-01T12:00:00Z") });
  r = await enforceLinkedInRetention(BRAND_A, { now });
  assert.deepEqual(r.deletedIds, [oldest2]);
});

// ── 5, 6, 12, 13: enforce scope + cleanup ────────────────────────────────────
test("5/6/12/13. enforce removes only this Brand's old LinkedIn rows, with children and files, no webhook", async () => {
  const a = seedBrand(BRAND_A, 7, 10);
  const igA = seedBrand(BRAND_A, 0, 30, "Instagram");
  const b = seedBrand(BRAND_B, 0, 10);
  const before = { ig: idsOf(BRAND_A, "Instagram"), b: idsOf(BRAND_B, "LinkedIn") };

  const { deletedIds } = await enforceLinkedInRetention(BRAND_A, { timeZone: "Europe/London" });

  assert.deepEqual(deletedIds.sort(), a.historical.slice(5).sort());
  assert.deepEqual(idsOf(BRAND_A, "LinkedIn"), [...a.queued, ...a.historical.slice(0, 5)].sort());
  // 5. Instagram untouched (even with 30 historical rows).
  assert.deepEqual(idsOf(BRAND_A, "Instagram"), before.ig);
  assert.equal(igA.historical.length, 30);
  // 6. Other brand untouched.
  assert.deepEqual(idsOf(BRAND_B, "LinkedIn"), before.b);
  assert.equal(b.historical.length, 10);
  // 13. Children cascade with the row; kept rows keep theirs.
  for (const id of deletedIds) {
    assert.ok(!db.media.some((m) => m.publishedPostId === id));
    assert.ok(!db.comments.some((c) => c.publishedPostId === id));
  }
  for (const id of a.historical.slice(0, 5)) {
    assert.ok(db.comments.some((c) => c.publishedPostId === id));
  }
  // 12. Files: only the deleted posts' own upload folders are read/unlinked.
  assert.equal(calls.readdir.length, 5);
  for (const p of calls.readdir) {
    assert.match(p, new RegExp(`/public/uploads/${BRAND_A}/published-posts/`));
    assert.ok(deletedIds.some((id) => p.endsWith(`/${id}`)), p);
  }
  for (const p of calls.unlink) {
    assert.ok(deletedIds.some((id) => p.includes(`/published-posts/${id}`)), p);
  }
  // No external delete webhook for retention.
  assert.deepEqual(calls.deleteWebhook, []);
});

test("12b. a row that changed platform since the read is not deleted; failures never throw", async () => {
  seedBrand(BRAND_A, 0, 6);
  const victim = db.posts.at(-1).id;
  const realFindMany = prisma.publishedPost.findMany;
  prisma.publishedPost.findMany = async (args) => {
    const rows = await realFindMany(args);
    db.posts.find((p) => p.id === victim).platform = "Instagram"; // concurrent edit
    return rows;
  };
  try {
    const r = await enforceLinkedInRetention(BRAND_A, { timeZone: "Europe/London" });
    assert.deepEqual(r.deletedIds, []);
    assert.ok(db.posts.some((p) => p.id === victim));
    assert.equal(calls.readdir.length, 0);
  } finally {
    prisma.publishedPost.findMany = realFindMany;
  }
  prisma.publishedPost.findMany = async () => { throw new Error("db down"); };
  try {
    assert.deepEqual(await enforceLinkedInRetention(BRAND_A, { timeZone: "Europe/London" }), { deletedIds: [] });
  } finally {
    prisma.publishedPost.findMany = realFindMany;
  }
});

// ── 7: GET is read-only ──────────────────────────────────────────────────────
test("7. GET list never deletes, however many historical rows exist", async () => {
  seedBrand(BRAND_A, 7, 20);
  seedBrand(BRAND_A, 0, 30, "Instagram");
  const before = db.posts.length;
  for (const url of ["http://x/?platform=LinkedIn", "http://x/?platform=Instagram", "http://x/"]) {
    const res = await listRoute.GET(new Request(url), ctx(BRAND_A));
    assert.equal(res.status, 200);
  }
  const one = await itemRoute.GET(new Request("http://x"), ctx(BRAND_A, db.posts.at(-1).id));
  assert.equal(one.status, 200);
  assert.equal(db.posts.length, before);
  assert.deepEqual(calls.postDeletes, []);
  assert.deepEqual(calls.readdir, []);
});

// ── 8: create triggers retention ─────────────────────────────────────────────
test("8. creating a LinkedIn post applies retention and reports the removed ids", async () => {
  const a = seedBrand(BRAND_A, 7, 10);
  const { status, body } = await createLinkedIn(BRAND_A, { scheduledDate: "2099-01-01T10:00" });
  assert.equal(status, 201);
  assert.deepEqual(body.linkedInRetention.deletedIds.sort(), a.historical.slice(5).sort());
  // 7 seeded queued + the new one + 5 historical.
  assert.equal(idsOf(BRAND_A, "LinkedIn").length, 13);
  assert.ok(db.posts.some((p) => p.id === body.post.id));
  assert.deepEqual(calls.deleteWebhook, []);
});

const historicalIds = (brandId) => {
  const dayStart = Date.now() - 2 * DAY; // every seeded historical row is ≤ -2 days
  return db.posts
    .filter((p) => p.brandId === brandId && p.platform === "LinkedIn" && p.scheduledDate && p.scheduledDate.getTime() < dayStart + DAY)
    .map((p) => p.id)
    .sort();
};

test("A. 5 historical + create an OLDER one → still exactly the original 5; the new row is removed, never sent", async () => {
  const a = seedBrand(BRAND_A, 2, 5);
  const { status, body } = await createLinkedIn(BRAND_A, { scheduledDate: "2001-01-01T10:00" });
  assert.equal(status, 200);
  assert.equal(body.post, null);
  assert.equal(body.kept, false);
  assert.equal(body.linkedInRetention.currentPostRemoved, true);
  assert.equal(body.linkedInRetention.deletedIds.length, 1);
  assert.match(body.message, /older than the five LinkedIn history posts retained for this Brand and was not kept/);
  const newId = body.linkedInRetention.deletedIds[0];
  assert.ok(!db.posts.some((p) => p.id === newId), "new row removed");
  assert.ok(!db.media.some((m) => m.publishedPostId === newId), "its media rows cascade");
  assert.ok(calls.readdir.some((d) => d.endsWith(`/${newId}`)), "its local files are cleaned");
  assert.deepEqual(historicalIds(BRAND_A), [...a.historical].sort(), "original newest 5 unchanged");
  assert.equal(idsOf(BRAND_A, "LinkedIn").length, 7, "queued untouched");
  assert.deepEqual(calls.n8nSend, [], "a removed post is never sent to n8n");
  assert.equal(calls.remoteUploads || 0, 0, "nor uploaded to the media server");
  assert.deepEqual(calls.deleteWebhook, []);
});

test("B. 5 historical + create the NEWEST historical → it stays; the oldest previous one goes", async () => {
  const a = seedBrand(BRAND_A, 0, 5); // historical at -2..-6 days
  const when = new Date(Date.now() - 1.5 * DAY).toISOString(); // newer than all five, still before today
  const { status, body } = await createLinkedIn(BRAND_A, { scheduledDate: when });
  assert.equal(status, 201);
  assert.equal(body.linkedInRetention.currentPostRemoved, false);
  assert.deepEqual(body.linkedInRetention.deletedIds, [a.historical[4]]);
  assert.ok(db.posts.some((p) => p.id === body.post.id));
  assert.equal(idsOf(BRAND_A, "LinkedIn").length, 5);
});

test("8c. creating an Instagram post never runs LinkedIn retention", async () => {
  seedBrand(BRAND_A, 0, 10);
  const fd = new FormData();
  fd.append("files", png());
  fd.append("platform", "Instagram");
  fd.append("postType", "static");
  fd.append("caption", "ig");
  const res = await listRoute.POST(new Request("http://x", { method: "POST", body: fd }), ctx(BRAND_A));
  const body = await res.json();
  assert.equal(res.status, 201);
  assert.equal(body.linkedInRetention, null);
  assert.equal(idsOf(BRAND_A, "LinkedIn").length, 10);
});

// ── 9: relevant edit triggers retention ──────────────────────────────────────
test("9. moving a queued LinkedIn post into the past applies retention", async () => {
  const a = seedBrand(BRAND_A, 1, 5);
  const moved = a.queued[0];
  const { status, body } = await edit(BRAND_A, moved, { scheduledDate: new Date(Date.now() - 1.5 * DAY).toISOString() });
  assert.equal(status, 200);
  // 6 historical now; the oldest seeded one goes, the edited post stays.
  assert.deepEqual(body.linkedInRetention.deletedIds, [a.historical[4]]);
  assert.ok(db.posts.some((p) => p.id === moved));
});

test("C. editing a post into historical position #6 removes the edited post itself, before n8n", async () => {
  const a = seedBrand(BRAND_A, 1, 5);
  const moved = a.queued[0];
  const { status, body } = await edit(BRAND_A, moved, { scheduledDate: "2001-01-01T10:00" });
  assert.equal(status, 200);
  assert.equal(body.kept, false);
  assert.equal(body.id, moved);
  assert.equal(body.linkedInRetention.currentPostRemoved, true);
  assert.deepEqual(body.linkedInRetention.deletedIds, [moved]);
  assert.ok(!db.posts.some((p) => p.id === moved));
  assert.deepEqual(historicalIds(BRAND_A), [...a.historical].sort(), "the newest 5 stay");
  assert.deepEqual(calls.n8nSend, [], "the edit is not sent for a removed post");
});

test("C2. Instagram → LinkedIn edit far in the past is removed too; collaborator rows go with it", async () => {
  seedBrand(BRAND_A, 0, 5);
  const ig = seed(BRAND_A, "Instagram", -400);
  db.collaborators.push({ id: "c-x", publishedPostId: ig, brandId: BRAND_B });
  const { body } = await edit(BRAND_A, ig, { platform: "LinkedIn" });
  assert.equal(body.linkedInRetention.currentPostRemoved, true);
  assert.ok(!db.posts.some((p) => p.id === ig));
  assert.ok(!db.collaborators.some((c) => c.publishedPostId === ig));
});

test("D. queued posts are never removed, however many and whatever triggers retention", async () => {
  const a = seedBrand(BRAND_A, 12, 8);
  await createLinkedIn(BRAND_A, { scheduledDate: "2001-01-01T10:00" });
  await edit(BRAND_A, a.historical[0], { scheduledDate: "2002-01-01T10:00" });
  for (const id of a.queued) assert.ok(db.posts.some((p) => p.id === id), id);
  assert.equal(historicalIds(BRAND_A).length, 5);
  // Pure check with an explicit "now": no queued id is ever selected.
  const r = selectLinkedInRetentionDeletions(db.posts.filter((p) => p.brandId === BRAND_A && p.platform === "LinkedIn"), { timeZone: "Europe/London" });
  assert.ok(!r.deleteIds.some((id) => a.queued.includes(id)));
});

test("E. GET stays read-only even when the Brand is already over the limit", async () => {
  seedBrand(BRAND_A, 3, 12);
  const before = db.posts.length;
  for (let i = 0; i < 3; i++) {
    assert.equal((await listRoute.GET(new Request("http://x/?platform=LinkedIn"), ctx(BRAND_A))).status, 200);
  }
  assert.equal(db.posts.length, before);
  assert.deepEqual(calls.postDeletes, []);
});

test("9b. caption/notes/status-only edits do not run retention", async () => {
  const a = seedBrand(BRAND_A, 0, 9); // over the limit already (e.g. aged since last create)
  const { status, body } = await edit(BRAND_A, a.historical[0], { caption: "new", notes: "n", status: "published" });
  assert.equal(status, 200);
  assert.equal(body.linkedInRetention, null);
  assert.equal(idsOf(BRAND_A, "LinkedIn").length, 9);
});

// ── 18: access control unchanged ─────────────────────────────────────────────
test("18. a user without access can neither list nor trigger retention", async () => {
  seedBrand(BRAND_A, 0, 10);
  currentUser = outsider;
  const list = await listRoute.GET(new Request("http://x/?platform=LinkedIn"), ctx(BRAND_A));
  assert.ok([401, 403, 404].includes(list.status), String(list.status));
  const created = await createLinkedIn(BRAND_A, { scheduledDate: "2099-01-01T10:00" });
  assert.ok([401, 403, 404].includes(created.status), String(created.status));
  const edited = await edit(BRAND_A, db.posts[0].id, { scheduledDate: "2001-01-01T10:00" });
  assert.ok([401, 403, 404].includes(edited.status), String(edited.status));
  assert.equal(idsOf(BRAND_A, "LinkedIn").length, 10);
  assert.deepEqual(calls.postDeletes, []);
});
