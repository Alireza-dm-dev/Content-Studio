// Instagram collaboration posts: one PublishedPost shown in several Brand grids.
//
// Exercises the real routes and the real lib/brand-access against an in-memory
// Prisma stand-in. Storage, auth, remote media and both n8n webhooks are mocked:
// nothing touches real uploads or the network.

import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { matchesWhere } from "./helpers/prisma-where.mjs";

// ── In-memory data ───────────────────────────────────────────────────────────
const BRAND_A = "brand-a";
const BRAND_B = "brand-b";
const BRAND_C = "brand-c";
const BRAND_D = "brand-d"; // exists, nobody but admin can access it

const admin = { id: "admin", role: "admin", name: "Admin" };
const userA = { id: "user-a", role: "user", name: "A only" };
const userB = { id: "user-b", role: "user", name: "B only" };
const userAB = { id: "user-ab", role: "user", name: "A and B" };
const userABC = { id: "user-abc", role: "user", name: "A, B and C" };

let db;
let seq;
let currentUser;
let calls;

function resetDb() {
  seq = 0;
  db = {
    brands: [
      { id: BRAND_A, name: "Brand A", timezone: "Europe/London", website: "secret-a.example" },
      { id: BRAND_B, name: "Brand B", timezone: "America/Vancouver", website: "secret-b.example" },
      { id: BRAND_C, name: "Brand C", timezone: null, website: null },
      { id: BRAND_D, name: "Brand D", timezone: null, website: null },
    ],
    memberships: [
      { userId: userA.id, brandId: BRAND_A },
      { userId: userB.id, brandId: BRAND_B },
      { userId: userAB.id, brandId: BRAND_A },
      { userId: userAB.id, brandId: BRAND_B },
      { userId: userABC.id, brandId: BRAND_A },
      { userId: userABC.id, brandId: BRAND_B },
      { userId: userABC.id, brandId: BRAND_C },
    ],
    posts: [],
    media: [],
    collaborators: [],
    comments: [],
  };
  calls = { n8nSend: [], deleteWebhook: [], postDeletes: [], readdir: [], unlink: [], writes: [] };
}
resetDb();

const collabOf = (post) => db.collaborators.filter((c) => c.publishedPostId === post.id);
const brandSummary = (id) => {
  const b = db.brands.find((x) => x.id === id);
  return b ? { id: b.id, name: b.name, timezone: b.timezone ?? null } : null;
};

// Honours `select` the way the routes use it (id/name/timezone only).
function pickSelect(obj, select) {
  if (!obj || !select) return obj;
  const out = {};
  for (const k of Object.keys(select)) if (select[k]) out[k] = obj[k];
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
  if (include.brand) {
    out.brand = pickSelect(db.brands.find((b) => b.id === post.brandId), include.brand.select);
  }
  if (include.collaborators) {
    out.collaborators = collabOf(post)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .map((c) => ({
        brandId: c.brandId,
        brand: pickSelect(
          db.brands.find((b) => b.id === c.brandId),
          include.collaborators.select.brand.select,
        ),
      }));
  }
  return out;
}

// SQLite semantics: NULL is the lowest value, so DESC puts it last.
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

const prisma = {
  brand: {
    findUnique: async ({ where }) => db.brands.find((b) => b.id === where.id) ?? null,
    findMany: async ({ where, select }) =>
      db.brands.filter((b) => matchesWhere(b, where)).map((b) => pickSelect(b, select)),
  },
  brandMembership: {
    findUnique: async ({ where }) => {
      const { userId, brandId } = where.userId_brandId;
      const m = db.memberships.find((x) => x.userId === userId && x.brandId === brandId);
      return m ? { id: `${userId}:${brandId}` } : null;
    },
    findMany: async ({ where }) => db.memberships.filter((m) => m.userId === where.userId),
  },
  brandAssignment: {
    findUnique: async () => null,
    findMany: async () => [],
  },
  publishedPost: {
    findMany: async ({ where, orderBy, include }) =>
      applyOrder(db.posts.filter((p) => matchesWhere(p, where, collabOf)), orderBy).map((p) =>
        withInclude(p, include),
      ),
    findFirst: async ({ where, orderBy, include }) => {
      const rows = applyOrder(db.posts.filter((p) => matchesWhere(p, where, collabOf)), orderBy);
      return withInclude(rows[0], include);
    },
    findUnique: async ({ where, include }) =>
      withInclude(db.posts.find((p) => p.id === where.id), include),
    create: async ({ data }) => {
      const row = {
        thumbnailUrl: null,
        jsonPayload: null,
        notes: null,
        createdAt: new Date(Date.UTC(2026, 0, 1) + ++seq * 1000),
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
      // FK cascades
      db.media = db.media.filter((m) => m.publishedPostId !== where.id);
      db.collaborators = db.collaborators.filter((c) => c.publishedPostId !== where.id);
      db.comments = db.comments.filter((c) => c.publishedPostId !== where.id);
      return { id: where.id };
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
      if (db.collaborators.some((c) => c.publishedPostId === data.publishedPostId && c.brandId === data.brandId)) {
        throw new Error("Unique constraint failed");
      }
      const row = { id: `c${++seq}`, createdAt: new Date(Date.UTC(2027, 0, 1) + seq * 1000), ...data };
      db.collaborators.push(row);
      return row;
    },
    findFirst: async ({ where }) => db.collaborators.find((c) => matchesWhere(c, where)) ?? null,
    findMany: async ({ where }) => db.collaborators.filter((c) => matchesWhere(c, where)).map((c) => ({ ...c })),
    deleteMany: async ({ where }) => {
      const before = db.collaborators.length;
      db.collaborators = db.collaborators.filter((c) => !matchesWhere(c, where));
      return { count: before - db.collaborators.length };
    },
  },
  publishedPostComment: {
    findMany: async ({ where }) => db.comments.filter((c) => c.publishedPostId === where.publishedPostId),
  },
  $transaction: async (fn) => fn(prisma),
};

mock.module("@/lib/prisma", { exports: { prisma } });
mock.module("@/lib/auth", {
  exports: { getCurrentUser: async () => currentUser, SESSION_COOKIE_NAME: "content_studio_session" },
});
mock.module("fs/promises", {
  exports: {
    writeFile: async (p) => { calls.writes.push(String(p)); },
    mkdir: async () => {},
    rm: async () => {},
    readdir: async (p) => { calls.readdir.push(String(p)); return []; },
    unlink: async (p) => { calls.unlink.push(String(p)); },
  },
});
mock.module("@/lib/published-post-remote-media", {
  exports: {
    // Remote upload "fails", so create never auto-sends to n8n: these tests are
    // about collaboration, not the publish transport.
    uploadPublishedPostMedia: async () => ({ success: false, detailCode: "MOCK", error: "mocked" }),
    isCanonicalMediaUrl: () => false,
  },
});
mock.module("@/lib/published-post-webhook", {
  exports: {
    sendPublishedPostToN8n: async (args) => { calls.n8nSend.push(args); return { success: true }; },
  },
});
mock.module("@/lib/published-post-delete-webhook", {
  exports: {
    requiresExternalDeleteWebhook: (p) => ["instagram", "linkedin"].includes(String(p ?? "").toLowerCase()),
    sendPublishedPostDeleteToN8n: async (args) => { calls.deleteWebhook.push(args.post.id); return { success: true }; },
  },
});

// The Instagram caption save gate is covered by tests/instagram-caption*.test.mjs;
// this file is about something else, so the gate is stubbed open here.
mock.module("@/lib/instagram-caption-check", {
  exports: {
    validateInstagramCaptionForBrand: async () => ({ ok: true, failures: [], warnings: [] }),
    captionRulesErrorBody: (v) => v,
  },
});

const listRoute = await import("../app/api/brands/[id]/published-posts/route.js");
const itemRoute = await import("../app/api/brands/[id]/published-posts/[postId]/route.js");
const collabRoute = await import("../app/api/brands/[id]/published-posts/[postId]/collaborators/route.js");
const commentsRoute = await import("../app/api/brands/[id]/published-posts/[postId]/comments/route.js");
const { PUBLISHED_POST_ORDER_BY } = await import("@/lib/published-post-order");
const { parseCollaboratorBrandIds, MAX_COLLABORATOR_BRANDS } = await import(
  "@/lib/published-post-collaborators"
);

// ── Helpers ──────────────────────────────────────────────────────────────────
const ctx = (id, postId) => ({ params: Promise.resolve(postId ? { id, postId } : { id }) });
const png = () => new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });

async function createPost(brandId, { platform = "Instagram", collaborators = [], scheduledDate } = {}) {
  const fd = new FormData();
  fd.append("files", png());
  fd.append("platform", platform);
  fd.append("postType", "static");
  fd.append("caption", "hello");
  if (scheduledDate) fd.append("scheduledDate", scheduledDate);
  for (const c of collaborators) fd.append("collaboratorBrandIds", c);
  const res = await listRoute.POST(new Request("http://x", { method: "POST", body: fd }), ctx(brandId));
  return { status: res.status, body: await res.json() };
}

async function grid(brandId, platform = "Instagram") {
  const url = platform ? `http://x/?platform=${platform}` : "http://x/";
  const res = await listRoute.GET(new Request(url), ctx(brandId));
  return { status: res.status, body: await res.json() };
}

async function getOne(brandId, postId) {
  const res = await itemRoute.GET(new Request("http://x"), ctx(brandId, postId));
  return { status: res.status, body: await res.json() };
}

async function edit(brandId, postId, body) {
  const res = await itemRoute.POST(
    new Request("http://x", { method: "POST", body: JSON.stringify(body) }),
    ctx(brandId, postId),
  );
  return { status: res.status, body: await res.json() };
}

async function del(brandId, postId) {
  const res = await itemRoute.DELETE(new Request("http://x", { method: "DELETE" }), ctx(brandId, postId));
  return { status: res.status, body: await res.json() };
}

async function setCollaborators(brandId, postId, brandIds) {
  const res = await collabRoute.PUT(
    new Request("http://x", { method: "PUT", body: JSON.stringify({ brandIds }) }),
    ctx(brandId, postId),
  );
  return { status: res.status, body: await res.json() };
}

function seedPost(id, brandId, { platform = "Instagram", scheduledDate = null, createdAt = "2026-01-01T00:00:00Z", collaborators = [] } = {}) {
  db.posts.push({
    id,
    brandId,
    platform,
    postType: "static",
    caption: `cap-${id}`,
    status: "draft",
    scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
    notes: null,
    thumbnailUrl: null,
    jsonPayload: JSON.stringify({ "Post ID": id, Platform: platform }),
    postNumber: 1,
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
  });
  db.media.push({ id: `media-${id}`, publishedPostId: id, url: `/uploads/${brandId}/published-posts/${id}/a.jpg`, mediaType: "IMAGE", order: 1 });
  for (const b of collaborators) {
    db.collaborators.push({ id: `c-${id}-${b}`, publishedPostId: id, brandId: b, createdAt: new Date() });
  }
}

const ids = (list) => list.map((p) => p.id);

beforeEach(() => {
  resetDb();
  currentUser = userAB;
});

// ── 1. create ────────────────────────────────────────────────────────────────
test("1. create a normal Instagram post with no collaborator", async () => {
  const { status, body } = await createPost(BRAND_A);
  assert.equal(status, 201, JSON.stringify(body));
  assert.equal(db.posts.length, 1);
  assert.equal(db.collaborators.length, 0);
  assert.equal(body.post.isCollaboration, false);
  assert.deepEqual(body.post.collaboratorBrands, []);
  assert.equal(body.post.brandId, BRAND_A);
});

test("2. create a collaboration post", async () => {
  const { status, body } = await createPost(BRAND_A, { collaborators: [BRAND_B] });
  assert.equal(status, 201, JSON.stringify(body));
  assert.equal(db.posts.length, 1);
  assert.equal(db.posts[0].brandId, BRAND_A, "primary brand unchanged");
  assert.deepEqual(db.collaborators.map((c) => [c.publishedPostId, c.brandId]), [[db.posts[0].id, BRAND_B]]);
  assert.equal(body.post.isCollaboration, true);
  assert.deepEqual(body.post.collaboratorBrands, [{ id: BRAND_B, name: "Brand B" }]);
  assert.equal(body.post.primaryBrand.id, BRAND_A);
});

test("3. collaborator must differ from the primary brand (rejected before any file write)", async () => {
  const { status, body } = await createPost(BRAND_A, { collaborators: [BRAND_A] });
  assert.equal(status, 400);
  assert.match(body.error, /different/);
  assert.equal(db.posts.length, 0);
  assert.equal(calls.writes.length, 0);
});

test("4. collaborator accessible to the user is accepted; blank values mean none", async () => {
  currentUser = userAB;
  let r = await createPost(BRAND_A, { collaborators: [BRAND_B] });
  assert.equal(r.status, 201);
  r = await createPost(BRAND_A, { collaborators: [""] });
  assert.equal(r.status, 201);
  assert.equal(r.body.post.isCollaboration, false);
});

test("5. inaccessible collaborator → 403, nothing created, no brand metadata leaked", async () => {
  currentUser = userA; // A only
  const { status, body } = await createPost(BRAND_A, { collaborators: [BRAND_B] });
  assert.equal(status, 403);
  assert.equal(db.posts.length, 0);
  assert.equal(db.collaborators.length, 0);
  assert.equal(calls.writes.length, 0);
  assert.ok(!JSON.stringify(body).includes("Brand B"));
  assert.ok(!JSON.stringify(body).includes(BRAND_B));

  // A made-up id answers exactly like a real-but-forbidden one (no existence probe).
  const ghost = await createPost(BRAND_A, { collaborators: ["does-not-exist"] });
  assert.equal(ghost.status, 403);
  assert.deepEqual(ghost.body, body);
});

test("admin: nonexistent collaborator brand → 400; too many / non-string ids → 400", async () => {
  currentUser = admin;
  const ghost = await createPost(BRAND_A, { collaborators: ["does-not-exist"] });
  assert.equal(ghost.status, 400);
  assert.equal(db.posts.length, 0);

  assert.equal(MAX_COLLABORATOR_BRANDS, 3);
  const tooMany = parseCollaboratorBrandIds(["a", "b", "c", "d"]);
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.status, 400);
  assert.equal(parseCollaboratorBrandIds([42]).ok, false);
  assert.deepEqual(parseCollaboratorBrandIds([" x ", "x", ""]).ids, ["x"]);
});

// ── 6-11. grids ──────────────────────────────────────────────────────────────
test("6-9. A grid shows the primary post, B grid shows the same post, one DB row, marker in both", async () => {
  const { body } = await createPost(BRAND_A, { collaborators: [BRAND_B] });
  const postId = body.post.id;

  const a = await grid(BRAND_A);
  const b = await grid(BRAND_B);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.deepEqual(ids(a.body), [postId]);
  assert.deepEqual(ids(b.body), [postId]);
  assert.equal(db.posts.length, 1, "exactly one PublishedPost row");

  assert.equal(a.body[0].isCollaboration, true);
  assert.equal(b.body[0].isCollaboration, true);
  assert.equal(a.body[0].viewerRelation, "primary");
  assert.equal(b.body[0].viewerRelation, "collaborator");
  // Same underlying post and media in both grids.
  assert.deepEqual(a.body[0].media, b.body[0].media);
  assert.equal(a.body[0].brandId, BRAND_A);
  assert.equal(b.body[0].brandId, BRAND_A);
});

test("a brand that is both primary and (bogus) collaborator still lists the post once", async () => {
  seedPost("p1", BRAND_A, { collaborators: [BRAND_A] });
  const a = await grid(BRAND_A);
  assert.deepEqual(ids(a.body), ["p1"]);
});

test("10-11. primary + collaborator brand info carry only id/name (+ primary timezone)", async () => {
  seedPost("p1", BRAND_A, { collaborators: [BRAND_B] });
  const [post] = (await grid(BRAND_B)).body;
  assert.deepEqual(post.primaryBrand, { id: BRAND_A, name: "Brand A", timezone: "Europe/London" });
  assert.deepEqual(post.collaboratorBrands, [{ id: BRAND_B, name: "Brand B" }]);
  assert.equal(post.brand, undefined, "raw relation stripped");
  assert.equal(post.collaborators, undefined, "raw relation stripped");
  assert.ok(!JSON.stringify(post).includes("secret-a.example"));
  assert.ok(!JSON.stringify(post).includes("secret-b.example"));
});

// ── 12-15. ownership policy ──────────────────────────────────────────────────
test("12. collaborator-only user can list, open and read comments (read-only)", async () => {
  seedPost("p1", BRAND_A, { collaborators: [BRAND_B] });
  db.comments.push({ id: "k1", publishedPostId: "p1", userId: "x", authorName: "X", body: "hi", createdAt: new Date(), updatedAt: new Date() });
  currentUser = userB;

  const list = await grid(BRAND_B);
  assert.deepEqual(ids(list.body), ["p1"]);
  assert.equal(list.body[0].canManage, false);

  const one = await getOne(BRAND_B, "p1");
  assert.equal(one.status, 200);
  assert.equal(one.body.id, "p1");
  assert.equal(one.body.canManage, false);
  assert.equal(one.body.media[0].localUrl, "/uploads/brand-a/published-posts/p1/a.jpg");

  const res = await commentsRoute.GET(new Request("http://x"), ctx(BRAND_B, "p1"));
  const comments = await res.json();
  assert.equal(res.status, 200);
  assert.equal(comments.commentCount, 1);
  assert.equal(comments.comments[0].canDelete, false);

  // ...but cannot write a comment through the collaborator brand.
  const post = await commentsRoute.POST(
    new Request("http://x", { method: "POST", body: JSON.stringify({ body: "x" }) }),
    ctx(BRAND_B, "p1"),
  );
  assert.equal(post.status, 404);
});

test("13. collaborator-only user cannot edit (via either brand URL)", async () => {
  seedPost("p1", BRAND_A, { collaborators: [BRAND_B] });
  currentUser = userB;
  const viaB = await edit(BRAND_B, "p1", { caption: "hijack" });
  assert.equal(viaB.status, 403);
  const viaA = await edit(BRAND_A, "p1", { caption: "hijack" });
  assert.equal(viaA.status, 403);
  assert.equal(db.posts[0].caption, "cap-p1");
  assert.equal(calls.n8nSend.length, 0);

  const collab = await setCollaborators(BRAND_B, "p1", []);
  assert.equal(collab.status, 403);
  assert.equal(db.collaborators.length, 1);
});

test("14. collaborator-only user cannot delete; no webhook fires", async () => {
  seedPost("p1", BRAND_A, { collaborators: [BRAND_B] });
  currentUser = userB;
  assert.equal((await del(BRAND_B, "p1")).status, 403);
  assert.equal((await del(BRAND_A, "p1")).status, 403);
  assert.equal(db.posts.length, 1);
  assert.equal(calls.deleteWebhook.length, 0);
  assert.equal(calls.postDeletes.length, 0);
});

test("a user with access to BOTH brands still edits through the primary brand only", async () => {
  seedPost("p1", BRAND_A, { collaborators: [BRAND_B] });
  currentUser = userAB;
  const list = await grid(BRAND_B);
  assert.equal(list.body[0].canManage, true, "UI may route manage actions to brand A");
  assert.equal((await edit(BRAND_B, "p1", { caption: "x" })).status, 403);
  assert.equal((await edit(BRAND_A, "p1", { caption: "x" })).status, 200);
});

test("15. primary-brand user can edit; collaboration survives and is returned", async () => {
  seedPost("p1", BRAND_A, { collaborators: [BRAND_B] });
  currentUser = userA; // A only, not B
  const r = await edit(BRAND_A, "p1", { caption: "new caption" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(db.posts[0].caption, "new caption");
  assert.equal(r.body.isCollaboration, true);
  assert.deepEqual(r.body.collaboratorBrands, [{ id: BRAND_B, name: "Brand B" }]);
  assert.equal(db.collaborators.length, 1);
  assert.equal(calls.n8nSend.length, 1, "edit keeps its existing single n8n send");
});

// ── 16-18. managing collaborators ────────────────────────────────────────────
test("16. add a collaborator to an existing post", async () => {
  seedPost("p1", BRAND_A);
  assert.deepEqual(ids((await grid(BRAND_B)).body), []);

  const r = await setCollaborators(BRAND_A, "p1", [BRAND_B]);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.post.isCollaboration, true);
  assert.deepEqual(ids((await grid(BRAND_B)).body), ["p1"]);
  assert.equal(calls.n8nSend.length, 0, "collaborators never go to n8n");
});

test("17. replace a collaborator", async () => {
  seedPost("p1", BRAND_A, { collaborators: [BRAND_B] });
  currentUser = userABC;
  const r = await setCollaborators(BRAND_A, "p1", [BRAND_C]);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.post.collaboratorBrands, [{ id: BRAND_C, name: "Brand C" }]);
  assert.deepEqual(ids((await grid(BRAND_B)).body), []);
  assert.deepEqual(ids((await grid(BRAND_C)).body), ["p1"]);
  assert.equal(db.collaborators.length, 1);
});

test("18. remove a collaborator: post, primary brand and media untouched", async () => {
  seedPost("p1", BRAND_A, { collaborators: [BRAND_B] });
  const mediaBefore = JSON.stringify(db.media);
  const r = await setCollaborators(BRAND_A, "p1", []);
  assert.equal(r.status, 200);
  assert.equal(r.body.post.isCollaboration, false);
  assert.deepEqual(ids((await grid(BRAND_A)).body), ["p1"]);
  assert.deepEqual(ids((await grid(BRAND_B)).body), []);
  assert.equal(db.posts.length, 1);
  assert.equal(db.posts[0].brandId, BRAND_A);
  assert.equal(JSON.stringify(db.media), mediaBefore);
  assert.equal(calls.readdir.length + calls.unlink.length, 0, "no file cleanup");
  assert.equal(calls.postDeletes.length, 0);
});

test("setting the same collaborators twice is idempotent (no duplicate rows)", async () => {
  seedPost("p1", BRAND_A);
  await setCollaborators(BRAND_A, "p1", [BRAND_B]);
  const again = await setCollaborators(BRAND_A, "p1", [BRAND_B, BRAND_B]);
  assert.equal(again.status, 200);
  assert.equal(db.collaborators.length, 1);
});

// ── 19-21. delete ────────────────────────────────────────────────────────────
test("19-21. deleting the primary post: one row, relation gone, one webhook, one cleanup", async () => {
  seedPost("p1", BRAND_A, { collaborators: [BRAND_B] });
  // Both grids show it before the delete.
  assert.deepEqual(ids((await grid(BRAND_A)).body), ["p1"]);
  assert.deepEqual(ids((await grid(BRAND_B)).body), ["p1"]);

  const r = await del(BRAND_A, "p1");
  assert.equal(r.status, 200);
  assert.deepEqual(calls.postDeletes, ["p1"]);
  assert.deepEqual(calls.deleteWebhook, ["p1"], "delete webhook exactly once");
  assert.equal(db.collaborators.length, 0, "collaborator relation removed by cascade");
  const cleanups = calls.readdir.filter((p) => p.includes("p1"));
  assert.equal(cleanups.length, 1, "media cleanup exactly once");
  assert.ok(cleanups[0].includes(BRAND_A), "cleanup targets the primary brand's folder");

  assert.deepEqual(ids((await grid(BRAND_A)).body), []);
  assert.deepEqual(ids((await grid(BRAND_B)).body), []);
});

// ── 22. LinkedIn ─────────────────────────────────────────────────────────────
test("22. LinkedIn is unaffected", async () => {
  // Cannot create a LinkedIn post with collaborators.
  const li = await createPost(BRAND_A, { platform: "LinkedIn", collaborators: [BRAND_B] });
  assert.equal(li.status, 400);
  assert.equal(db.posts.length, 0);

  // A LinkedIn post can be created normally and is not a collaboration.
  const ok = await createPost(BRAND_A, { platform: "LinkedIn" });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.post.isCollaboration, false);

  // An Instagram collaboration never leaks into a LinkedIn grid.
  seedPost("ig", BRAND_A, { collaborators: [BRAND_B] });
  seedPost("li-b", BRAND_B, { platform: "LinkedIn" });
  assert.deepEqual(ids((await grid(BRAND_B, "LinkedIn")).body), ["li-b"]);
  assert.deepEqual(ids((await grid(BRAND_A, "LinkedIn")).body), [ok.body.post.id]);

  // Collaborators cannot be set on a LinkedIn post.
  const put = await setCollaborators(BRAND_A, ok.body.post.id, [BRAND_B]);
  assert.equal(put.status, 400);

  // A stray collaborator row on a LinkedIn post never shows it in another grid.
  db.collaborators.push({ id: "stray", publishedPostId: "li-b", brandId: BRAND_A, createdAt: new Date() });
  assert.ok(!ids((await grid(BRAND_A, "Instagram")).body).includes("li-b"));
  assert.ok(!ids((await grid(BRAND_A, null)).body).includes("li-b"));
});

test("moving an Instagram collaboration post to LinkedIn drops its collaborators", async () => {
  seedPost("p1", BRAND_A, { collaborators: [BRAND_B] });
  const r = await edit(BRAND_A, "p1", { platform: "LinkedIn" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(db.collaborators.length, 0);
  assert.equal(r.body.isCollaboration, false);
  assert.deepEqual(ids((await grid(BRAND_B, null)).body), []);
});

// ── 23. ordering ─────────────────────────────────────────────────────────────
test("23. ordering is scheduledDate DESC, createdAt DESC, id DESC in both grids", async () => {
  assert.deepEqual(PUBLISHED_POST_ORDER_BY, [{ scheduledDate: "desc" }, { createdAt: "desc" }, { id: "desc" }]);
  seedPost("a-new", BRAND_A, { scheduledDate: "2026-10-01T00:00:00Z", collaborators: [BRAND_B] });
  seedPost("a-old", BRAND_A, { scheduledDate: "2026-01-01T00:00:00Z", collaborators: [BRAND_B] });
  seedPost("b-mid", BRAND_B, { scheduledDate: "2026-05-01T00:00:00Z" });
  seedPost("b-undated", BRAND_B, { scheduledDate: null, createdAt: "2026-12-01T00:00:00Z" });
  seedPost("tie-x", BRAND_B, { scheduledDate: "2026-03-01T00:00:00Z", createdAt: "2026-02-01T00:00:00Z" });
  seedPost("tie-y", BRAND_A, { scheduledDate: "2026-03-01T00:00:00Z", createdAt: "2026-02-01T00:00:00Z", collaborators: [BRAND_B] });

  // Link the OLDEST post most recently: relation createdAt must not affect order.
  db.collaborators.find((c) => c.publishedPostId === "a-old").createdAt = new Date("2030-01-01");

  const b = ids((await grid(BRAND_B)).body);
  assert.deepEqual(b, ["a-new", "b-mid", "tie-y", "tie-x", "a-old", "b-undated"]);
  assert.equal(new Set(b).size, b.length, "no duplicates");

  const a = ids((await grid(BRAND_A)).body);
  assert.deepEqual(a, ["a-new", "tie-y", "a-old"]);
  // Shared posts keep the same relative order in both grids.
  assert.deepEqual(b.filter((id) => a.includes(id)), a);
});

// ── 24-25. guessing / arbitrary brands ──────────────────────────────────────
test("24. guessed cross-brand access is blocked", async () => {
  seedPost("p1", BRAND_A); // NOT shared with B
  currentUser = userB;
  assert.equal((await getOne(BRAND_B, "p1")).status, 404, "not visible through an unrelated brand");
  assert.equal((await getOne(BRAND_A, "p1")).status, 403, "no access to the owner");
  assert.deepEqual(ids((await grid(BRAND_B)).body), []);

  // A collaborator link to brand C does not expose the post to brand B users.
  db.collaborators.push({ id: "x", publishedPostId: "p1", brandId: BRAND_C, createdAt: new Date() });
  assert.equal((await getOne(BRAND_C, "p1")).status, 403);
  assert.equal((await getOne(BRAND_B, "p1")).status, 404);

  // A user with access to A and B cannot manage A's post through B's URL.
  currentUser = userAB;
  db.collaborators.push({ id: "y", publishedPostId: "p1", brandId: BRAND_B, createdAt: new Date() });
  assert.equal((await setCollaborators(BRAND_B, "p1", [])).status, 403);
  assert.equal((await del(BRAND_B, "p1")).status, 403);
  assert.equal(db.posts.length, 1);
});

test("25. a user cannot assign an arbitrary inaccessible brand via edit", async () => {
  seedPost("p1", BRAND_A);
  currentUser = userA;
  const r = await setCollaborators(BRAND_A, "p1", [BRAND_D]);
  assert.equal(r.status, 403);
  assert.ok(!JSON.stringify(r.body).includes("Brand D"));
  assert.equal(db.collaborators.length, 0);

  const self = await setCollaborators(BRAND_A, "p1", [BRAND_A]);
  assert.equal(self.status, 400);

  const notArray = await setCollaborators(BRAND_A, "p1", "brand-b");
  assert.equal(notArray.status, 400);
});

test("an editor may keep or remove an existing collaborator they cannot access, but not add one", async () => {
  // Set up by someone with access to A and C.
  seedPost("p1", BRAND_A, { collaborators: [BRAND_C] });
  currentUser = userA; // A only

  // Keeping C (unchanged) is fine.
  assert.equal((await setCollaborators(BRAND_A, "p1", [BRAND_C])).status, 200);
  // Adding B (inaccessible) alongside it is not.
  assert.equal((await setCollaborators(BRAND_A, "p1", [BRAND_C, BRAND_B])).status, 403);
  assert.deepEqual(db.collaborators.map((c) => c.brandId), [BRAND_C]);
  // Removing C is fine.
  assert.equal((await setCollaborators(BRAND_A, "p1", [])).status, 200);
  assert.equal(db.collaborators.length, 0);
});

// ── n8n contract ─────────────────────────────────────────────────────────────
test("n8n payload is unchanged by collaboration (no invented collaborator field)", async () => {
  const plain = await createPost(BRAND_A);
  const collab = await createPost(BRAND_A, { collaborators: [BRAND_B] });
  const p1 = JSON.parse(plain.body.post.jsonPayload);
  const p2 = JSON.parse(collab.body.post.jsonPayload);
  assert.deepEqual(Object.keys(p2).sort(), Object.keys(p1).sort());
  assert.ok(!/collab/i.test(collab.body.post.jsonPayload));
  assert.ok(!collab.body.post.jsonPayload.includes("Brand B"));
});
