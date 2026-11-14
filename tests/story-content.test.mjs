// Story Contents: calendar month API, Story day CRUD, ordered assets, private
// file storage, authorization and cross-brand isolation. Real route handlers,
// validation, storage and brand-access; only prisma and the session are faked.

import { test, mock, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

const A = "story-test-brand-a";
const B = "story-test-brand-b";
const admin = { id: "admin-1", role: "admin", isActive: true, name: "Alireza" };
const userA = { id: "user-a", role: "user", isActive: true, name: "Arian" };
const userA2 = { id: "user-a2", role: "user", isActive: true, name: "Sahab" };
const userNone = { id: "user-none", role: "user", isActive: true, name: "Nobody" };

const BRANDS = [{ id: A }, { id: B }];
const MEMBERSHIPS = [
  { userId: userA.id, brandId: A },
  { userId: userA2.id, brandId: A },
];
const state = { user: admin, days: [], assets: [], seq: 0 };

const STORAGE = path.join(process.cwd(), ".data", "story-content");

function withAssets(day, include) {
  if (!day) return null;
  const out = { ...day };
  if (include?.assets) {
    out.assets = state.assets.filter((a) => a.storyContentId === day.id).sort((x, y) => x.sortOrder - y.sortOrder).map((a) => ({ ...a }));
  }
  return out;
}

function dayMatches(row, where = {}) {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object" && "startsWith" in v) return String(row[k]).startsWith(v.startsWith);
    return row[k] === v;
  });
}

const prismaFake = {
  brand: { findUnique: async ({ where }) => BRANDS.find((b) => b.id === where.id) ?? null },
  brandMembership: {
    findUnique: async ({ where }) => {
      const { userId, brandId } = where.userId_brandId;
      return MEMBERSHIPS.find((m) => m.userId === userId && m.brandId === brandId) ?? null;
    },
  },
  brandAssignment: { findUnique: async () => null },
  brandStoryContent: {
    findUnique: async ({ where, include, select }) => {
      const row = where.id
        ? state.days.find((d) => d.id === where.id)
        : state.days.find((d) => d.brandId === where.brandId_storyDate.brandId && d.storyDate === where.brandId_storyDate.storyDate);
      if (!row) return null;
      if (select) return Object.fromEntries(Object.keys(select).map((k) => [k, row[k]]));
      return withAssets(row, include);
    },
    findMany: async ({ where, select }) => {
      state.lastFindManyWhere = where;
      state.lastFindManySelect = select;
      return state.days.filter((d) => dayMatches(d, where)).sort((x, y) => x.storyDate.localeCompare(y.storyDate)).map((d) => ({
        id: d.id, storyDate: d.storyDate, status: d.status,
        _count: { assets: state.assets.filter((a) => a.storyContentId === d.id).length },
      }));
    },
    create: async ({ data, include }) => {
      if (state.days.some((d) => d.brandId === data.brandId && d.storyDate === data.storyDate)) {
        throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
      }
      const now = new Date();
      const row = { id: `story${++state.seq}`, completedByUserId: null, completedByName: null, completedAt: null, createdAt: now, updatedAt: now, ...data };
      state.days.push(row);
      return withAssets(row, include);
    },
    update: async ({ where, data, include }) => {
      const row = state.days.find((d) => d.id === where.id);
      if (data.storyDate && state.days.some((d) => d.id !== row.id && d.brandId === row.brandId && d.storyDate === data.storyDate)) {
        throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
      }
      Object.assign(row, data, { updatedAt: new Date() });
      return withAssets(row, include);
    },
    delete: async ({ where }) => {
      state.days = state.days.filter((d) => d.id !== where.id);
      state.assets = state.assets.filter((a) => a.storyContentId !== where.id); // onDelete: Cascade
    },
  },
  brandStoryAsset: {
    create: async ({ data }) => {
      const row = { id: `asset${++state.seq}`, createdAt: new Date(), ...data };
      state.assets.push(row);
      return row;
    },
    update: async ({ where, data }) => Object.assign(state.assets.find((a) => a.id === where.id), data),
    delete: async ({ where }) => { state.assets = state.assets.filter((a) => a.id !== where.id); },
    deleteMany: async () => ({ count: 0 }),
  },
  $transaction: async (ops) => Promise.all(ops),
};

mock.module("@/lib/prisma", { exports: { prisma: prismaFake } });
mock.module("@/lib/auth", { exports: { getCurrentUser: async () => state.user } });

const list = await import("../app/api/brands/[id]/story-content/route.js");
const item = await import("../app/api/brands/[id]/story-content/[storyId]/route.js");
const assetsRoute = await import("../app/api/brands/[id]/story-content/[storyId]/assets/route.js");
const assetRoute = await import("../app/api/brands/[id]/story-content/[storyId]/assets/[assetId]/route.js");
const dates = await import("../lib/story-content-dates.js");

beforeEach(() => { state.user = admin; state.days = []; state.assets = []; state.seq = 0; });
after(async () => {
  for (const b of [A, B]) await rm(path.join(STORAGE, b), { recursive: true, force: true });
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const pad = (head, n = 64) => Buffer.concat([Buffer.from(head), Buffer.alloc(n)]);
const FILES = {
  jpg: () => new File([pad([0xff, 0xd8, 0xff, 0xe0])], "story-1.jpg", { type: "image/jpeg" }),
  png: () => new File([pad([0x89, 0x50, 0x4e, 0x47])], "story-3.png", { type: "image/png" }),
  mp4: () => new File([pad([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70])], "story-2.mp4", { type: "video/mp4" }),
  mov: () => new File([pad([0, 0, 0, 0x14, 0x66, 0x74, 0x79, 0x70])], "clip.mov", { type: "video/quicktime" }),
};

const P = (o) => ({ params: Promise.resolve(o) });
const json = (method, body) => new Request("http://x", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function call(handler, req, params) {
  const res = await handler(req, P(params));
  const type = res.headers.get("content-type") || "";
  return { status: res.status, res, body: type.includes("json") ? await res.json() : null };
}
const getMonth = (brandId, month) => call(list.GET, new Request(`http://x/?month=${month}`), { id: brandId });
const createDay = (brandId, storyDate, comments) => call(list.POST, json("POST", { storyDate, comments }), { id: brandId });
const getDay = (brandId, storyId) => call(item.GET, new Request("http://x"), { id: brandId, storyId });
const patchDay = (brandId, storyId, body) => call(item.PATCH, json("PATCH", body), { id: brandId, storyId });
const deleteDay = (brandId, storyId) => call(item.DELETE, new Request("http://x", { method: "DELETE" }), { id: brandId, storyId });
async function upload(brandId, storyId, ...files) {
  const form = new FormData();
  for (const f of files) form.append("file", f);
  return call(assetsRoute.POST, new Request("http://x", { method: "POST", body: form }), { id: brandId, storyId });
}
const reorder = (brandId, storyId, assetIds) => call(assetsRoute.PATCH, json("PATCH", { assetIds }), { id: brandId, storyId });
const getAsset = (brandId, storyId, assetId, q = "", headers = {}) =>
  call(assetRoute.GET, new Request(`http://x/${q}`, { headers }), { id: brandId, storyId, assetId });
const deleteAsset = (brandId, storyId, assetId) => call(assetRoute.DELETE, new Request("http://x", { method: "DELETE" }), { id: brandId, storyId, assetId });
const absOf = (asset) => path.join(process.cwd(), ".data", asset.storedPath);

async function dayWithAssets(brandId = A, date = "2026-11-10") {
  const c = await createDay(brandId, date, "Publish in this order. Add link sticker on Story 3.");
  const id = c.body.story.id;
  await upload(brandId, id, FILES.jpg());
  await upload(brandId, id, FILES.mp4());
  const r = await upload(brandId, id, FILES.png());
  return { id, story: r.body.story };
}

// ── Calendar month API ────────────────────────────────────────────────────────

test("empty month returns no days", async () => {
  const r = await getMonth(A, "2026-11");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.days, []);
});

test("month with a Story day returns a lightweight summary", async () => {
  await dayWithAssets();
  const r = await getMonth(A, "2026-11");
  assert.deepEqual(r.body.days, [{ id: "story1", storyDate: "2026-11-10", status: "READY", assetCount: 3 }]);
  // Lightweight: no assets, comments, names or paths in the month payload.
  assert.doesNotMatch(JSON.stringify(r.body), /storedPath|comments|story-1\.jpg|Arian|Alireza/);
  assert.equal(state.lastFindManySelect.assets, undefined);
});

test("month query is scoped to the requested brand and month", async () => {
  await createDay(A, "2026-11-10");
  await createDay(A, "2026-12-01");
  await createDay(B, "2026-11-10");
  const r = await getMonth(A, "2026-11");
  assert.deepEqual(r.body.days.map((d) => d.storyDate), ["2026-11-10"]);
  assert.equal(state.lastFindManyWhere.brandId, A);
  assert.deepEqual(state.lastFindManyWhere.storyDate, { startsWith: "2026-11-" });
});

test("invalid month is rejected", async () => {
  for (const m of ["2026-13", "26-11", "", "2026-11-01"]) assert.equal((await getMonth(A, m)).status, 400);
});

// ── Create ────────────────────────────────────────────────────────────────────

test("admin creates a Story day as READY with creator attribution", async () => {
  const r = await createDay(A, "2026-11-10", "Upload at 10am");
  assert.equal(r.status, 201);
  assert.equal(r.body.story.status, "READY");
  assert.equal(r.body.story.createdByName, "Alireza");
  assert.equal(r.body.story.comments, "Upload at 10am");
  assert.equal(state.days[0].createdByUserId, admin.id);
  assert.equal("createdByUserId" in r.body.story, false);
});

test("assigned user can create; creator is that user", async () => {
  state.user = userA;
  const r = await createDay(A, "2026-11-11");
  assert.equal(r.status, 201);
  assert.equal(r.body.story.createdByName, "Arian");
});

test("unassigned user gets 403 and anonymous gets 401", async () => {
  state.user = userNone;
  assert.equal((await createDay(A, "2026-11-10")).status, 403);
  assert.equal((await getMonth(A, "2026-11")).status, 403);
  state.user = null;
  assert.equal((await createDay(A, "2026-11-10")).status, 401);
  assert.equal((await getMonth(A, "2026-11")).status, 401);
  assert.equal(state.days.length, 0);
});

test("duplicate brand/date returns 409 with the existing id; other brands may share the date", async () => {
  const first = await createDay(A, "2026-11-10");
  const dup = await createDay(A, "2026-11-10");
  assert.equal(dup.status, 409);
  assert.equal(dup.body.existingId, first.body.story.id);
  assert.equal((await createDay(B, "2026-11-10")).status, 201);
});

test("invalid dates are rejected", async () => {
  for (const d of ["2026-02-30", "2026-11-1", "10/11/2026", null, "2026-13-01"]) {
    assert.equal((await createDay(A, d)).status, 400, String(d));
  }
});

// ── Assets ────────────────────────────────────────────────────────────────────

test("image, video and multiple assets upload in order", async () => {
  const { story } = await dayWithAssets();
  assert.deepEqual(story.assets.map((a) => [a.position, a.fileName, a.mediaType]), [
    [1, "story-1.jpg", "IMAGE"], [2, "story-2.mp4", "VIDEO"], [3, "story-3.png", "IMAGE"],
  ]);
  for (const a of state.assets) {
    assert.ok(existsSync(absOf(a)), "file written");
    assert.ok(a.storedPath.startsWith(`story-content/${A}/`), "brand-scoped private path");
  }
  assert.doesNotMatch(JSON.stringify(story), /storedPath|story-content\/story-test/);
});

test("MOV and WebP-style formats are accepted; several files in one request keep their order", async () => {
  const { body } = await createDay(A, "2026-11-12");
  const r = await upload(A, body.story.id, FILES.mov(), FILES.png(), FILES.jpg());
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.story.assets.map((a) => a.fileName), ["clip.mov", "story-3.png", "story-1.jpg"]);
});

test("reorder changes the sequence and is preserved", async () => {
  const { id, story } = await dayWithAssets();
  const [a1, a2, a3] = story.assets.map((a) => a.id);
  const r = await reorder(A, id, [a3, a1, a2]);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.story.assets.map((a) => a.fileName), ["story-3.png", "story-1.jpg", "story-2.mp4"]);
  assert.deepEqual((await getDay(A, id)).body.story.assets.map((a) => a.position), [1, 2, 3]);
});

test("reorder must list exactly this day's assets", async () => {
  const { id, story } = await dayWithAssets();
  const ids = story.assets.map((a) => a.id);
  assert.equal((await reorder(A, id, ids.slice(0, 2))).status, 400);
  assert.equal((await reorder(A, id, [ids[0], ids[0], ids[1]])).status, 400);
  assert.equal((await reorder(A, id, [ids[0], ids[1], "foreign"])).status, 400);
});

test("removing one asset deletes only its file", async () => {
  const { id, story } = await dayWithAssets();
  const [victim, ...rest] = state.assets.map((a) => ({ ...a }));
  const r = await deleteAsset(A, id, story.assets[0].id);
  assert.equal(r.status, 200);
  assert.equal(r.body.story.assets.length, 2);
  assert.equal(existsSync(absOf(victim)), false);
  for (const a of rest) assert.ok(existsSync(absOf(a)));
});

test("malicious filename is sanitized and never reaches the path", async () => {
  const { body } = await createDay(A, "2026-11-13");
  const evil = new File([pad([0x89, 0x50, 0x4e, 0x47])], "../../../etc/passwd.png", { type: "image/png" });
  const r = await upload(A, body.story.id, evil);
  assert.equal(r.status, 201);
  const a = state.assets[0];
  assert.equal(a.originalFileName, "passwd.png");
  assert.match(a.storedPath, new RegExp(`^story-content/${A}/${body.story.id}/[0-9a-f-]{36}\\.png$`));
});

test("unsupported, mislabelled, oversized and empty files are rejected", async () => {
  const { body } = await createDay(A, "2026-11-14");
  const id = body.story.id;
  const cases = [
    new File(["%PDF-1.4"], "brief.pdf", { type: "application/pdf" }),
    new File(["MZ"], "run.exe", { type: "application/octet-stream" }),
    new File([pad([0x47, 0x49, 0x46, 0x38])], "anim.gif", { type: "image/gif" }),
    new File(["not a png at all"], "fake.png", { type: "image/png" }),
    new File([pad([0xff, 0xd8, 0xff])], "wrongmime.jpg", { type: "image/png" }),
    new File([], "empty.png", { type: "image/png" }),
    new File([Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(10 * 1024 * 1024 + 1)])], "huge.png", { type: "image/png" }),
  ];
  for (const f of cases) assert.equal((await upload(A, id, f)).status, 400, f.name);
  assert.equal(state.assets.length, 0);
});

test("a Story day holds at most 20 assets", async () => {
  const { body } = await createDay(A, "2026-11-15");
  const files = Array.from({ length: 20 }, () => FILES.png());
  assert.equal((await upload(A, body.story.id, ...files)).status, 201);
  assert.equal((await upload(A, body.story.id, FILES.png())).status, 409);
});

// ── Access / isolation ────────────────────────────────────────────────────────

test("a Story id under another brand's URL is 404, and a non-member is 403", async () => {
  const { id } = await dayWithAssets(A);
  state.user = userA; // member of A only
  assert.equal((await getDay(B, id)).status, 404);
  assert.equal((await patchDay(B, id, { comments: "x" })).status, 404);
  assert.equal((await deleteDay(B, id)).status, 404);
  state.user = userNone;
  assert.equal((await getDay(A, id)).status, 403);
});

test("an asset cannot be read through another Story day or another brand", async () => {
  const one = await dayWithAssets(A, "2026-11-10");
  const two = await createDay(A, "2026-11-20");
  const other = await createDay(B, "2026-11-10");
  const assetId = one.story.assets[0].id;
  assert.equal((await getAsset(A, two.body.story.id, assetId)).status, 404);
  assert.equal((await getAsset(B, other.body.story.id, assetId)).status, 404);
  assert.equal((await deleteAsset(A, two.body.story.id, assetId)).status, 404);
  assert.equal(state.assets.length, 3);
});

test("authenticated download streams the file as an attachment with its name", async () => {
  const { id, story } = await dayWithAssets();
  state.user = userA2; // another authorized member
  const r = await getAsset(A, id, story.assets[0].id, "?download=1");
  assert.equal(r.status, 200);
  assert.equal(r.res.headers.get("content-type"), "image/jpeg");
  assert.match(r.res.headers.get("content-disposition"), /^attachment; filename="story-1\.jpg"/);
  assert.equal(r.res.headers.get("x-content-type-options"), "nosniff");
  const bytes = Buffer.from(await r.res.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff]);

  const inline = await getAsset(A, id, story.assets[0].id);
  assert.match(inline.res.headers.get("content-disposition"), /^inline;/);
});

test("video preview supports byte ranges", async () => {
  const { id, story } = await dayWithAssets();
  const r = await getAsset(A, id, story.assets[1].id, "", { range: "bytes=0-7" });
  assert.equal(r.status, 206);
  assert.match(r.res.headers.get("content-range"), /^bytes 0-7\/\d+$/);
  assert.equal(Buffer.from(await r.res.arrayBuffer()).length, 8);
});

test("anonymous and unassigned downloads are refused", async () => {
  const { id, story } = await dayWithAssets();
  state.user = null;
  assert.equal((await getAsset(A, id, story.assets[0].id)).status, 401);
  state.user = userNone;
  assert.equal((await getAsset(A, id, story.assets[0].id)).status, 403);
});

// ── Comments / status / attribution ───────────────────────────────────────────

test("comments are stored as-is and editable", async () => {
  const { body } = await createDay(A, "2026-11-10", "  Use link sticker on 3  ");
  assert.equal(body.story.comments, "Use link sticker on 3");
  const r = await patchDay(A, body.story.id, { comments: "Tag @beacademy.uk" });
  assert.equal(r.body.story.comments, "Tag @beacademy.uk");
  assert.equal((await patchDay(A, body.story.id, { comments: "x".repeat(5001) })).status, 400);
});

test("Mark as Uploaded records the completing user and time; Reopen clears them", async () => {
  const { id } = await dayWithAssets(); // created by admin
  state.user = userA;
  const before = Date.now();
  const r = await patchDay(A, id, { status: "UPLOADED" });
  assert.equal(r.status, 200);
  assert.equal(r.body.story.status, "UPLOADED");
  assert.equal(r.body.story.completedByName, "Arian");
  assert.equal(r.body.story.createdByName, "Alireza");
  assert.ok(new Date(r.body.story.completedAt).getTime() >= before);
  assert.equal(state.days[0].completedByUserId, userA.id);
  assert.equal((await getMonth(A, "2026-11")).body.days[0].status, "UPLOADED");

  const reopened = await patchDay(A, id, { status: "READY" });
  assert.equal(reopened.body.story.status, "READY");
  assert.equal(reopened.body.story.completedByName, null);
  assert.equal(state.days[0].completedAt, null);
  assert.equal((await patchDay(A, id, { status: "PUBLISHED" })).status, 400);
});

test("a Story day can move to a free date but not onto an occupied one", async () => {
  const { id } = await dayWithAssets(A, "2026-11-10");
  await createDay(A, "2026-11-12");
  assert.equal((await patchDay(A, id, { storyDate: "2026-11-12" })).status, 409);
  const r = await patchDay(A, id, { storyDate: "2026-11-11" });
  assert.equal(r.body.story.storyDate, "2026-11-11");
  assert.equal(r.body.story.assets.length, 3);
});

// ── Delete ────────────────────────────────────────────────────────────────────

test("deleting a Story day removes its rows and files only", async () => {
  const mine = await dayWithAssets(A, "2026-11-10");
  const sibling = await dayWithAssets(A, "2026-11-11");
  const otherBrand = await dayWithAssets(B, "2026-11-10");
  const keep = state.assets.filter((a) => a.storyContentId !== mine.id).map((a) => ({ ...a }));
  const gone = state.assets.filter((a) => a.storyContentId === mine.id).map((a) => ({ ...a }));

  assert.equal((await deleteDay(A, mine.id)).status, 200);
  assert.equal(state.days.some((d) => d.id === mine.id), false);
  for (const a of gone) assert.equal(existsSync(absOf(a)), false);
  for (const a of keep) assert.ok(existsSync(absOf(a)), "unrelated asset kept");
  assert.ok(state.days.some((d) => d.id === sibling.id));
  assert.ok(state.days.some((d) => d.id === otherBrand.id));
});

// ── Full details are separate from the month grid ─────────────────────────────

test("opening a day returns full details without internal fields", async () => {
  const { id } = await dayWithAssets();
  const r = await getDay(A, id);
  assert.equal(r.status, 200);
  assert.equal(r.body.story.assets.length, 3);
  assert.equal(r.body.story.comments, "Publish in this order. Add link sticker on Story 3.");
  assert.match(r.body.story.assets[0].downloadUrl, new RegExp(`^/api/brands/${A}/story-content/${id}/assets/[^/]+\\?download=1$`));
  assert.doesNotMatch(JSON.stringify(r.body), /storedPath|UserId|story-content\/story-test/);
});

// ── No publish automation ─────────────────────────────────────────────────────

test("Story Contents code never references publishing integrations", async () => {
  const { readFile } = await import("node:fs/promises");
  const files = [
    "lib/story-content.js", "lib/story-content-dates.js", "lib/story-content-storage.js", "lib/story-content-route.js",
    "app/api/brands/[id]/story-content/route.js", "app/api/brands/[id]/story-content/[storyId]/route.js",
    "app/api/brands/[id]/story-content/[storyId]/assets/route.js", "app/api/brands/[id]/story-content/[storyId]/assets/[assetId]/route.js",
  ];
  for (const f of files) {
    // Code only: comments legitimately say what this feature does NOT do.
    const src = (await readFile(path.join(process.cwd(), f), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(src, /n8n|webhook|publishedPost|graph\.facebook|instagram-api|fetch\(/i, f);
  }
});

// ── Pure date helpers ─────────────────────────────────────────────────────────

test("month grid is Monday-first and padded to whole weeks", () => {
  const cells = dates.buildMonthGrid(2026, 11); // 1 Nov 2026 is a Sunday
  assert.equal(cells.length % 7, 0);
  assert.deepEqual(cells.slice(0, 7), [null, null, null, null, null, null, "2026-11-01"]);
  assert.equal(cells.filter(Boolean).length, 30);
  assert.deepEqual(dates.shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(dates.shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.equal(dates.parseStoryDate("2028-02-29"), "2028-02-29");
  assert.equal(dates.parseStoryDate("2027-02-29"), null);
});
