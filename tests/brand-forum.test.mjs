// Brand Forum: routes, authorization, media storage. Uses an in-memory fake
// Prisma and a temp working directory — no real DB or uploads are touched.

import { test, mock, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORIGINAL_CWD = process.cwd();
const TMP = mkdtempSync(join(tmpdir(), "forum-test-"));
process.chdir(TMP);
after(() => process.chdir(ORIGINAL_CWD));

const BRAND_A = "brand-a";
const BRAND_B = "brand-b";
const admin = { id: "admin-1", name: "Alireza", email: "a@x.io", role: "admin", isActive: true, passwordHash: "SECRET", sessionToken: "TOKEN" };
const userA = { id: "user-a", name: "Sahab", email: "s@x.io", role: "user", isActive: true, passwordHash: "SECRET", sessionToken: "TOKEN" };
const userB = { id: "user-b", name: "Arbab", email: "ar@x.io", role: "user", isActive: true };
const userC = { id: "user-c", name: "Carol", email: "c@x.io", role: "user", isActive: true };

const MEMBERSHIPS = [
  { userId: userA.id, brandId: BRAND_A },
  { userId: userB.id, brandId: BRAND_A },
  { userId: userC.id, brandId: BRAND_B },
];

let currentUser = null;
let posts = [];
let replies = [];
let attachments = [];
let seq = 0;
let clock = 0;

const tick = () => new Date(Date.UTC(2026, 8, 30, 12, 0, clock++));

const withRels = (p, sel) => ({
  ...p,
  attachments: attachments.filter((a) => a.postId === p.id),
  replies: replies.filter((r) => r.postId === p.id).sort((a, b) => a.createdAt - b.createdAt),
  ...(sel ? {} : {}),
});

mock.module("@/lib/prisma", {
  exports: {
    prisma: {
      brand: { findUnique: async ({ where }) => ({ id: where.id }) },
      brandMembership: {
        findUnique: async ({ where }) => {
          const { userId, brandId } = where.userId_brandId;
          return MEMBERSHIPS.find((m) => m.userId === userId && m.brandId === brandId) ?? null;
        },
      },
      brandAssignment: { findUnique: async () => null },
      brandForumPost: {
        findMany: async ({ where, take, cursor, skip }) => {
          let rows = posts.filter((p) => p.brandId === where.brandId)
            .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
          if (cursor) rows = rows.slice(rows.findIndex((r) => r.id === cursor.id) + (skip ?? 0));
          return rows.slice(0, take).map((p) => withRels(p));
        },
        count: async ({ where }) => posts.filter((p) => p.brandId === where.brandId).length,
        create: async ({ data }) => {
          const { attachments: att, ...rest } = data;
          const row = { ...rest, createdAt: tick(), updatedAt: tick() };
          posts.push(row);
          for (const a of att?.create ?? []) attachments.push({ id: `att-${++seq}`, postId: row.id, createdAt: tick(), ...a });
          return withRels(row);
        },
        findUnique: async ({ where }) => posts.find((p) => p.id === where.id) ?? null,
        delete: async ({ where }) => {
          posts = posts.filter((p) => p.id !== where.id);
          replies = replies.filter((r) => r.postId !== where.id);
          attachments = attachments.filter((a) => a.postId !== where.id);
        },
      },
      brandForumReply: {
        create: async ({ data }) => {
          const row = { id: `reply-${++seq}`, createdAt: tick(), updatedAt: tick(), ...data };
          replies.push(row);
          return row;
        },
        findUnique: async ({ where }) => {
          const r = replies.find((x) => x.id === where.id);
          if (!r) return null;
          return { ...r, post: { brandId: posts.find((p) => p.id === r.postId)?.brandId } };
        },
        delete: async ({ where }) => { replies = replies.filter((r) => r.id !== where.id); },
      },
    },
  },
});
mock.module("@/lib/auth", { exports: { getCurrentUser: async () => currentUser } });

const listRoute = await import("../app/api/brands/[id]/forum/route.js");
const postRoute = await import("../app/api/brands/[id]/forum/[postId]/route.js");
const repliesRoute = await import("../app/api/brands/[id]/forum/[postId]/replies/route.js");
const replyRoute = await import("../app/api/brands/[id]/forum/[postId]/replies/[replyId]/route.js");
const forumLib = await import("../lib/brand-forum.js");

beforeEach(() => { posts = []; replies = []; attachments = []; seq = 0; clock = 0; currentUser = null; });

// ── helpers ──────────────────────────────────────────────────────────────────
const PNG = Buffer.concat([Buffer.from([0x89]), Buffer.from("PNG\r\n\x1a\n"), Buffer.alloc(32)]);
const MP4 = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypmp42"), Buffer.alloc(32)]);
const file = (bytes, name, type) => new File([bytes], name, { type });

async function createPost(brandId, { body, files = [], extra = {} } = {}) {
  const fd = new FormData();
  if (body !== undefined) fd.append("body", body);
  for (const f of files) fd.append("files", f);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  const res = await listRoute.POST(new Request("http://t/x", { method: "POST", body: fd }), { params: Promise.resolve({ id: brandId }) });
  return { res, json: await res.json() };
}
const listPosts = async (brandId, q = "") => {
  const res = await listRoute.GET(new Request(`http://t/x${q}`), { params: Promise.resolve({ id: brandId }) });
  return { res, json: await res.json() };
};
const reply = async (brandId, postId, payload) => {
  const res = await repliesRoute.POST(new Request("http://t/x", { method: "POST", body: JSON.stringify(payload) }), { params: Promise.resolve({ id: brandId, postId }) });
  return { res, json: await res.json() };
};
const delPost = (brandId, postId) => postRoute.DELETE(new Request("http://t/x", { method: "DELETE" }), { params: Promise.resolve({ id: brandId, postId }) });
const delReply = (brandId, postId, replyId) => replyRoute.DELETE(new Request("http://t/x", { method: "DELETE" }), { params: Promise.resolve({ id: brandId, postId, replyId }) });

// ── POSTS ────────────────────────────────────────────────────────────────────
test("1/6 assigned user creates a text post and it shows the author", async () => {
  currentUser = userA;
  const { res, json } = await createPost(BRAND_A, { body: "We should adjust October's campaign." });
  assert.equal(res.status, 201);
  assert.deepEqual(json.post.author, { id: "user-a", name: "Sahab", role: "user" });
  assert.ok(json.post.createdAt);
});

test("2/29 image post is stored under the brand/forum scope", async () => {
  currentUser = userA;
  const { res, json } = await createPost(BRAND_A, { files: [file(PNG, "shot.png", "image/png")] });
  assert.equal(res.status, 201);
  const att = json.post.attachments[0];
  assert.equal(att.type, "IMAGE");
  assert.match(att.url, new RegExp(`^/uploads/${BRAND_A}/forum/[^/]+/[0-9a-f-]+\\.png$`));
  assert.ok(existsSync(join(TMP, "public", att.url)));
});

test("3/30 video post is stored under the brand/forum scope", async () => {
  currentUser = userA;
  const { res, json } = await createPost(BRAND_A, { files: [file(MP4, "clip.mp4", "video/mp4")] });
  assert.equal(res.status, 201);
  assert.equal(json.post.attachments[0].type, "VIDEO");
  assert.ok(existsSync(join(TMP, "public", json.post.attachments[0].url)));
});

test("4 empty post rejected", async () => {
  currentUser = userA;
  assert.equal((await createPost(BRAND_A, { body: "   " })).res.status, 400);
  assert.equal((await createPost(BRAND_A, {})).res.status, 400);
});

test("5/27 author comes from the session; client-supplied authorId is ignored", async () => {
  currentUser = userA;
  const { json } = await createPost(BRAND_A, { body: "hi", extra: { authorId: admin.id, authorName: "Hacker", authorRole: "admin" } });
  assert.equal(json.post.author.id, userA.id);
  assert.equal(json.post.author.name, "Sahab");
  assert.equal(json.post.author.role, "user");
  assert.equal(posts[0].authorId, userA.id);
});

test("7 admin can create in any brand", async () => {
  currentUser = admin;
  const { res, json } = await createPost(BRAND_B, { body: "admin note" });
  assert.equal(res.status, 201);
  assert.equal(json.post.author.role, "admin");
});

test("author name falls back to email, then 'User'", () => {
  assert.equal(forumLib.authorSnapshot({ name: " ", email: "e@x.io", role: "user" }).authorName, "e@x.io");
  assert.equal(forumLib.authorSnapshot({ role: "user" }).authorName, "User");
});

// ── READ ─────────────────────────────────────────────────────────────────────
test("8/9 user reads only their brand; cross-brand read is 403 and leaks nothing", async () => {
  currentUser = admin;
  await createPost(BRAND_A, { body: "A secret" });
  await createPost(BRAND_B, { body: "B secret" });
  currentUser = userC;
  const own = await listPosts(BRAND_B);
  assert.deepEqual(own.json.posts.map((p) => p.body), ["B secret"]);
  const cross = await listPosts(BRAND_A);
  assert.equal(cross.res.status, 403);
  assert.ok(!JSON.stringify(cross.json).includes("A secret"));
});

test("unauthenticated request is 401", async () => {
  assert.equal((await listPosts(BRAND_A)).res.status, 401);
});

test("10/11 posts newest first, replies oldest first", async () => {
  currentUser = userA;
  const p1 = (await createPost(BRAND_A, { body: "first" })).json.post;
  await createPost(BRAND_A, { body: "second" });
  await reply(BRAND_A, p1.id, { body: "r1" });
  await reply(BRAND_A, p1.id, { body: "r2" });
  const { json } = await listPosts(BRAND_A);
  assert.deepEqual(json.posts.map((p) => p.body), ["second", "first"]);
  assert.deepEqual(json.posts[1].replies.map((r) => r.body), ["r1", "r2"]);
});

test("pagination: 20 per page with a cursor for the rest", async () => {
  currentUser = userA;
  for (let i = 0; i < 22; i++) await createPost(BRAND_A, { body: `p${i}` });
  const first = (await listPosts(BRAND_A)).json;
  assert.equal(first.posts.length, 20);
  assert.equal(first.total, 22);
  const second = (await listPosts(BRAND_A, `?cursor=${first.nextCursor}`)).json;
  assert.equal(second.posts.length, 2);
  assert.equal(second.nextCursor, null);
});

test("28 response contains no sensitive user fields", async () => {
  currentUser = admin;
  const p = (await createPost(BRAND_A, { body: "x" })).json.post;
  await reply(BRAND_A, p.id, { body: "y" });
  const raw = JSON.stringify((await listPosts(BRAND_A)).json);
  for (const bad of ["passwordHash", "sessionToken", "SECRET", "TOKEN", "a@x.io", "email"]) {
    assert.ok(!raw.includes(bad), `leaked ${bad}`);
  }
});

// ── REPLIES ──────────────────────────────────────────────────────────────────
test("12/13/14/27 assigned user replies; author is the session user", async () => {
  currentUser = userA;
  const p = (await createPost(BRAND_A, { body: "post" })).json.post;
  currentUser = userB;
  const { res, json } = await reply(BRAND_A, p.id, { body: "agreed", authorId: admin.id });
  assert.equal(res.status, 201);
  assert.equal(json.reply.author.id, userB.id);
  assert.equal(json.reply.author.name, "Arbab");
  const listed = (await listPosts(BRAND_A)).json.posts[0].replies[0];
  assert.equal(listed.author.name, "Arbab");
});

test("empty reply rejected", async () => {
  currentUser = userA;
  const p = (await createPost(BRAND_A, { body: "post" })).json.post;
  assert.equal((await reply(BRAND_A, p.id, { body: " " })).res.status, 400);
});

test("15/23 unassigned user cannot reply", async () => {
  currentUser = userA;
  const p = (await createPost(BRAND_A, { body: "post" })).json.post;
  currentUser = userC;
  assert.equal((await reply(BRAND_A, p.id, { body: "nope" })).res.status, 403);
  assert.equal(replies.length, 0);
});

// ── DELETE ───────────────────────────────────────────────────────────────────
test("16/17/18 post deletion: author yes, other user no, admin yes", async () => {
  currentUser = userA;
  const mine = (await createPost(BRAND_A, { body: "mine" })).json.post;
  const other = (await createPost(BRAND_A, { body: "other" })).json.post;
  assert.equal((await delPost(BRAND_A, mine.id)).status, 200);
  currentUser = userB;
  assert.equal((await delPost(BRAND_A, other.id)).status, 403);
  assert.equal(posts.length, 1);
  currentUser = admin;
  assert.equal((await delPost(BRAND_A, other.id)).status, 200);
  assert.equal(posts.length, 0);
});

test("19/20/21 reply deletion: author yes, other user no, admin yes", async () => {
  currentUser = userA;
  const p = (await createPost(BRAND_A, { body: "post" })).json.post;
  const r1 = (await reply(BRAND_A, p.id, { body: "r1" })).json.reply;
  const r2 = (await reply(BRAND_A, p.id, { body: "r2" })).json.reply;
  assert.equal((await delReply(BRAND_A, p.id, r1.id)).status, 200);
  currentUser = userB;
  assert.equal((await delReply(BRAND_A, p.id, r2.id)).status, 403);
  currentUser = admin;
  assert.equal((await delReply(BRAND_A, p.id, r2.id)).status, 200);
  assert.equal(replies.length, 0);
});

test("canDelete flags reflect the viewer", async () => {
  currentUser = userA;
  await createPost(BRAND_A, { body: "mine" });
  assert.equal((await listPosts(BRAND_A)).json.posts[0].canDelete, true);
  currentUser = userB;
  assert.equal((await listPosts(BRAND_A)).json.posts[0].canDelete, false);
  currentUser = admin;
  assert.equal((await listPosts(BRAND_A)).json.posts[0].canDelete, true);
});

// ── SECURITY ─────────────────────────────────────────────────────────────────
test("22 guessed cross-brand post id → 403 (delete, reply, and via a mismatched brand path)", async () => {
  currentUser = admin;
  const p = (await createPost(BRAND_A, { body: "A only" })).json.post;
  currentUser = userC; // member of B only
  assert.equal((await delPost(BRAND_B, p.id)).status, 403); // own brand in path, foreign post id
  assert.equal((await delPost(BRAND_A, p.id)).status, 403);
  assert.equal((await reply(BRAND_B, p.id, { body: "x" })).res.status, 403);
  assert.equal(posts.length, 1);
});

test("23 guessed cross-brand reply id → 403", async () => {
  currentUser = userA;
  const p = (await createPost(BRAND_A, { body: "post" })).json.post;
  const r = (await reply(BRAND_A, p.id, { body: "r" })).json.reply;
  currentUser = userC;
  assert.equal((await delReply(BRAND_B, p.id, r.id)).status, 403);
  assert.equal((await delReply(BRAND_A, p.id, r.id)).status, 403);
  assert.equal(replies.length, 1);
});

test("24 unsupported file types are rejected (incl. extension/MIME mismatch and spoofed bytes)", async () => {
  currentUser = userA;
  const bad = [
    file(Buffer.from("<script>"), "x.svg", "image/svg+xml"),
    file(Buffer.from("MZ"), "x.exe", "application/octet-stream"),
    file(PNG, "x.png", "text/html"),
    file(Buffer.from("<html>"), "x.png", "image/png"), // right label, wrong bytes
  ];
  for (const f of bad) assert.equal((await createPost(BRAND_A, { files: [f] })).res.status, 400, f.name);
  assert.equal(posts.length, 0);
});

test("25 oversized files are rejected", async () => {
  currentUser = userA;
  const big = file(Buffer.concat([PNG, Buffer.alloc(forumLib.MAX_IMAGE_SIZE)]), "big.png", "image/png");
  const { res, json } = await createPost(BRAND_A, { files: [big] });
  assert.equal(res.status, 400);
  assert.match(json.error, /too large/i);
});

test("26 path-traversal filenames are sanitized and never reach the path", async () => {
  assert.equal(forumLib.sanitizeFileName("../../etc/passwd.png"), "passwd.png");
  assert.equal(forumLib.sanitizeFileName("..\\..\\win.png"), "win.png");
  currentUser = userA;
  const { res, json } = await createPost(BRAND_A, { files: [file(PNG, "../../../evil.png", "image/png")] });
  assert.equal(res.status, 201);
  const att = json.post.attachments[0];
  assert.equal(att.fileName, "evil.png");
  assert.ok(!att.url.includes(".."));
  assert.ok(existsSync(join(TMP, "public", att.url)));
});

// ── MEDIA ────────────────────────────────────────────────────────────────────
test("31 deleting a post removes only its own forum folder", async () => {
  currentUser = userA;
  const p1 = (await createPost(BRAND_A, { files: [file(PNG, "a.png", "image/png")] })).json.post;
  const p2 = (await createPost(BRAND_A, { files: [file(PNG, "b.png", "image/png")] })).json.post;
  const unrelated = join(TMP, "public", "uploads", BRAND_A, "published-posts", "pp1", "keep.jpg");
  mkdirSync(join(unrelated, ".."), { recursive: true });
  writeFileSync(unrelated, "x");

  assert.equal((await delPost(BRAND_A, p1.id)).status, 200);
  assert.ok(!existsSync(join(TMP, "public", p1.attachments[0].url)));
  assert.ok(existsSync(join(TMP, "public", p2.attachments[0].url)));
  assert.equal(readFileSync(unrelated, "utf8"), "x");
});

// ── UX (source-level: the repo has no React test harness) ────────────────────
test("32/33 duplicate post and reply submits are guarded", () => {
  const section = readFileSync(join(ORIGINAL_CWD, "components/BrandForumSection.jsx"), "utf8");
  const card = readFileSync(join(ORIGINAL_CWD, "components/brand-forum/ForumPostCard.jsx"), "utf8");
  for (const [src, flag] of [[section, "postInFlight"], [card, "inFlight"]]) {
    assert.match(src, new RegExp(`if \\(${flag}\\.current`));
    assert.match(src, new RegExp(`${flag}\\.current = true`));
  }
  assert.match(section, /Posting…/);
  assert.match(card, /Replying…/);
  assert.match(card, /Deleting…/);
});
