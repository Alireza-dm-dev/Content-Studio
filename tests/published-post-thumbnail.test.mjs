// Instagram Published Post thumbnail / cover image.
// Real create + thumbnail route handlers, real validation and disk storage;
// only prisma and the session are faked. SFTP env is cleared so the best-effort
// remote upload is skipped and nothing leaves the machine.

import { test, mock, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

for (const k of ["PUBLISHED_MEDIA_FTP_HOST", "PUBLISHED_MEDIA_FTP_USER", "PUBLISHED_MEDIA_FTP_PASSWORD", "N8N_PUBLISHED_POST_WEBHOOK_URL"]) {
  delete process.env[k];
}

const A = "thumbtestbranda";
const B = "thumbtestbrandb";
const admin = { id: "admin-1", role: "admin", isActive: true, name: "Admin" };
const userA = { id: "user-a", role: "user", isActive: true, name: "Arian" };
const userNone = { id: "user-none", role: "user", isActive: true, name: "Nobody" };
const BRANDS = [{ id: A, name: "Brand A", timezone: "America/Vancouver" }, { id: B, name: "Brand B", timezone: "America/Vancouver" }];
const MEMBERSHIPS = [{ userId: userA.id, brandId: A }];

const state = { user: admin, posts: [], media: [], seq: 0 };
const UPLOADS = path.join(process.cwd(), "public", "uploads");

function withRelations(post, include) {
  if (!post) return null;
  const out = { ...post };
  if (include?.media) out.media = state.media.filter((m) => m.publishedPostId === post.id).sort((a, b) => a.order - b.order);
  if (include?._count) out._count = { comments: 0 };
  return out;
}

const prismaFake = {
  settings: { findUnique: async () => null },
  brand: { findUnique: async ({ where }) => BRANDS.find((b) => b.id === where.id) ?? null },
  brandMembership: {
    findUnique: async ({ where }) => {
      const { userId, brandId } = where.userId_brandId;
      return MEMBERSHIPS.find((m) => m.userId === userId && m.brandId === brandId) ?? null;
    },
  },
  brandAssignment: { findUnique: async () => null },
  publishedPost: {
    findFirst: async ({ where, include }) => {
      if (where.id) return withRelations(state.posts.find((p) => p.id === where.id && p.brandId === where.brandId), include);
      const rows = state.posts.filter((p) => p.brandId === where.brandId).sort((a, b) => (b.postNumber ?? 0) - (a.postNumber ?? 0));
      return rows[0] ? { postNumber: rows[0].postNumber } : null;
    },
    findUnique: async ({ where, include }) => withRelations(state.posts.find((p) => p.id === where.id), include),
    findMany: async ({ where }) => state.posts.filter((p) => p.brandId === where.brandId && (!where.platform || p.platform === where.platform)).map((p) => withRelations(p, { media: true })),
    create: async ({ data }) => {
      const now = new Date();
      const row = { thumbnailUrl: null, jsonPayload: null, createdAt: now, updatedAt: now, ...data };
      state.posts.push(row);
      return { ...row };
    },
    update: async ({ where, data, include }) => {
      const row = state.posts.find((p) => p.id === where.id);
      Object.assign(row, data, { updatedAt: new Date() });
      return withRelations(row, include);
    },
    delete: async ({ where }) => { state.posts = state.posts.filter((p) => p.id !== where.id); },
  },
  publishedPostMedia: {
    create: async ({ data }) => {
      const row = { id: `media${++state.seq}`, createdAt: new Date(), ...data };
      state.media.push(row);
      return row;
    },
  },
  $transaction: async (fn) => fn(prismaFake),
};

mock.module("@/lib/prisma", { exports: { prisma: prismaFake } });
mock.module("@/lib/auth", { exports: { getCurrentUser: async () => state.user, SESSION_COOKIE_NAME: "content_studio_session" } });

// The Instagram caption save gate is covered by tests/instagram-caption*.test.mjs;
// this file is about something else, so the gate is stubbed open here.
mock.module("@/lib/instagram-caption-check", {
  exports: {
    validateInstagramCaptionForBrand: async () => ({ ok: true, failures: [], warnings: [] }),
    captionRulesErrorBody: (v) => v,
  },
});

const listRoute = await import("../app/api/brands/[id]/published-posts/route.js");
const thumbRoute = await import("../app/api/brands/[id]/published-posts/[postId]/thumbnail/route.js");
const utils = await import("../lib/published-post-utils.js");

beforeEach(async () => {
  state.user = admin; state.posts = []; state.media = []; state.seq = 0;
  for (const b of [A, B]) await rm(path.join(UPLOADS, b), { recursive: true, force: true });
});
after(async () => {
  for (const b of [A, B]) await rm(path.join(UPLOADS, b), { recursive: true, force: true });
});
// Silence the expected "SFTP not configured" logs.
mock.method(console, "error", () => {});
mock.method(console, "warn", () => {});
mock.method(console, "log", () => {});

// ── Fixtures ──────────────────────────────────────────────────────────────────
const pad = (head, n = 64) => Buffer.concat([Buffer.from(head), Buffer.alloc(n)]);
const F = {
  mp4: (name = "video.mp4") => new File([pad([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70])], name, { type: "video/mp4" }),
  jpg: (name = "cover.jpg") => new File([pad([0xff, 0xd8, 0xff, 0xe0])], name, { type: "image/jpeg" }),
  png: (name = "cover-2.png") => new File([pad([0x89, 0x50, 0x4e, 0x47])], name, { type: "image/png" }),
  webp: (name = "cover.webp") => new File([pad([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")])], name, { type: "image/webp" }),
  gif: (name = "cover.gif") => new File([pad([...Buffer.from("GIF89a")])], name, { type: "image/gif" }),
};

const P = (o) => ({ params: Promise.resolve(o) });
async function call(handler, req, params) {
  const res = await handler(req, P(params));
  return { status: res.status, body: await res.json() };
}
function createPost(brandId, { files = [F.mp4()], thumbnail, postType = "reel", platform = "Instagram" } = {}) {
  const fd = new FormData();
  for (const f of files) fd.append("files", f);
  if (thumbnail) fd.append("thumbnail", thumbnail);
  fd.append("postType", postType);
  fd.append("platform", platform);
  fd.append("caption", "Hello");
  return call(listRoute.POST, new Request("http://x", { method: "POST", body: fd }), { id: brandId });
}
function putThumb(brandId, postId, file) {
  const fd = new FormData();
  if (file) fd.append("thumbnail", file);
  return call(thumbRoute.PUT, new Request("http://x", { method: "PUT", body: fd }), { id: brandId, postId });
}
const deleteThumb = (brandId, postId) => call(thumbRoute.DELETE, new Request("http://x", { method: "DELETE" }), { id: brandId, postId });
const postDir = (brandId, postId) => path.join(UPLOADS, brandId, "published-posts", postId);
const files = (brandId, postId) => readdirSync(postDir(brandId, postId)).sort();
const localFile = (url) => path.join(process.cwd(), "public", url);
const stored = (postId) => state.posts.find((p) => p.id === postId);

// ── Create flow ───────────────────────────────────────────────────────────────

test("video post without thumbnail keeps old behaviour", async () => {
  const r = await createPost(A);
  assert.equal(r.status, 201);
  assert.equal(r.body.post.thumbnailUrl, null);
  assert.equal(r.body.post.posterUrl, null);
  assert.equal(JSON.parse(stored(r.body.post.id).jsonPayload).thumbnail_url, "");
  assert.equal(files(A, r.body.post.id).length, 1);
});

test("video post with JPG cover: video stays main media, cover stored separately", async () => {
  const r = await createPost(A, { thumbnail: F.jpg() });
  assert.equal(r.status, 201);
  const post = r.body.post;
  assert.equal(post.media.length, 1);
  assert.equal(post.media[0].mediaType, "VIDEO");
  assert.match(post.thumbnailUrl, new RegExp(`^/uploads/${A}/published-posts/${post.id}/thumbnail-[0-9a-f-]{36}\\.jpg$`));
  assert.equal(post.posterUrl, post.thumbnailUrl, "card poster uses the cover");
  assert.ok(existsSync(localFile(post.thumbnailUrl)));
  assert.equal(JSON.parse(stored(post.id).jsonPayload).thumbnail_url, post.thumbnailUrl);
});

test("PNG and WebP covers are accepted; image posts may also have a cover", async () => {
  const png = await createPost(A, { thumbnail: F.png() });
  assert.equal(png.status, 201);
  assert.match(png.body.post.thumbnailUrl, /\.png$/);
  const webp = await createPost(A, { files: [F.jpg("photo.jpg")], postType: "static", thumbnail: F.webp() });
  assert.equal(webp.status, 201);
  assert.match(webp.body.post.thumbnailUrl, /\.webp$/);
  assert.equal(webp.body.post.media[0].mediaType, "IMAGE");
});

test("invalid, mislabelled, oversized and zero-byte covers are rejected before anything is written", async () => {
  const cases = [
    new File([pad([0x25, 0x50, 0x44, 0x46])], "cover.pdf", { type: "application/pdf" }),
    F.gif(),
    new File([pad([0x89, 0x50, 0x4e, 0x47])], "cover.jpg", { type: "image/jpeg" }), // PNG bytes, JPG label
    new File([pad([0xff, 0xd8, 0xff, 0xe0])], "cover.html", { type: "image/jpeg" }),
    new File([Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(10 * 1024 * 1024)])], "big.jpg", { type: "image/jpeg" }),
    new File([], "empty.jpg", { type: "image/jpeg" }),
  ];
  for (const thumbnail of cases) {
    const r = await createPost(A, { thumbnail });
    assert.equal(r.status, 400, thumbnail.name);
    assert.equal(r.body.code, "INVALID_THUMBNAIL");
  }
  assert.equal(state.posts.length, 0);
  assert.equal(existsSync(path.join(UPLOADS, A)), false);
});

test("malicious cover filename never reaches the stored path", async () => {
  const r = await createPost(A, { thumbnail: F.jpg("../../../evil<script>.jpg") });
  assert.equal(r.status, 201);
  assert.match(r.body.post.thumbnailUrl, new RegExp(`^/uploads/${A}/published-posts/${r.body.post.id}/thumbnail-[0-9a-f-]{36}\\.jpg$`));
});

// ── Edit flow ─────────────────────────────────────────────────────────────────

test("add a cover to an existing post, replace it, then remove it; the video is never touched", async () => {
  const created = await createPost(A);
  const id = created.body.post.id;
  const videoUrl = created.body.post.media[0].url;
  const videoBytes = readFileSync(localFile(videoUrl));

  const add = await putThumb(A, id, F.jpg());
  assert.equal(add.status, 200);
  const first = add.body.post.thumbnailUrl;
  assert.match(first, /thumbnail-.*\.jpg$/);
  assert.ok(existsSync(localFile(first)));

  const replace = await putThumb(A, id, F.png());
  assert.equal(replace.status, 200);
  const second = replace.body.post.thumbnailUrl;
  assert.notEqual(second, first);
  assert.ok(existsSync(localFile(second)));
  assert.equal(existsSync(localFile(first)), false, "old cover deleted");
  assert.equal(JSON.parse(stored(id).jsonPayload).thumbnail_url, second);

  const removed = await deleteThumb(A, id);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.post.thumbnailUrl, null);
  assert.equal(existsSync(localFile(second)), false);
  assert.equal(JSON.parse(stored(id).jsonPayload).thumbnail_url, "");

  assert.deepEqual(removed.body.post.media.map((m) => m.url), [videoUrl]);
  assert.deepEqual(readFileSync(localFile(videoUrl)), videoBytes);
  assert.equal(files(A, id).length, 1);
});

test("replacing removes a legacy 'thumbnail.jpg' from the original create path too", async () => {
  const created = await createPost(A, { thumbnail: F.jpg() });
  const id = created.body.post.id;
  // Simulate a post created before this release.
  const { writeFileSync, renameSync } = await import("node:fs");
  renameSync(localFile(created.body.post.thumbnailUrl), path.join(postDir(A, id), "thumbnail.jpg"));
  stored(id).thumbnailUrl = `/uploads/${A}/published-posts/${id}/thumbnail.jpg`;
  writeFileSync(path.join(postDir(A, id), "notes.txt"), "unrelated");

  const r = await putThumb(A, id, F.png());
  assert.equal(r.status, 200);
  const names = files(A, id);
  assert.ok(!names.includes("thumbnail.jpg"));
  assert.ok(names.includes("notes.txt"), "unrelated files untouched");
  assert.equal(names.filter((n) => n.startsWith("thumbnail-")).length, 1);
});

test("thumbnail route rejects invalid uploads and missing files", async () => {
  const id = (await createPost(A)).body.post.id;
  for (const f of [null, F.gif(), new File([], "e.jpg", { type: "image/jpeg" })]) {
    const r = await putThumb(A, id, f);
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "INVALID_THUMBNAIL");
  }
  assert.equal(stored(id).thumbnailUrl, null);
});

// ── Authorization ─────────────────────────────────────────────────────────────

test("cross-brand, guessed ids and non-members are blocked", async () => {
  const id = (await createPost(A)).body.post.id;
  const viaB = await putThumb(B, id, F.jpg());
  assert.equal(viaB.status, 404, "post id under another brand's URL");
  assert.equal((await putThumb(A, "does-not-exist", F.jpg())).status, 404);

  state.user = userA;
  assert.equal((await putThumb(A, id, F.jpg())).status, 200, "assigned user may edit");
  assert.equal((await putThumb(B, id, F.jpg())).status, 403, "member of A cannot use brand B");

  state.user = userNone;
  assert.equal((await putThumb(A, id, F.jpg())).status, 403);
  assert.equal((await deleteThumb(A, id)).status, 403);
  state.user = null;
  assert.equal((await deleteThumb(A, id)).status, 401);
  assert.ok(stored(id).thumbnailUrl, "unauthorized delete changed nothing");
});

// ── Delete + LinkedIn + n8n ───────────────────────────────────────────────────

test("deleting the post's files removes its cover too and nothing of other posts", async () => {
  const a = (await createPost(A, { thumbnail: F.jpg() })).body.post;
  const b = (await createPost(A, { thumbnail: F.png() })).body.post;
  await utils.deletePublishedPostFiles(a.id, A);
  // Existing cleanup unlinks every file (cover included); it leaves the empty directory.
  assert.equal(existsSync(localFile(a.thumbnailUrl)), false);
  assert.deepEqual(existsSync(postDir(A, a.id)) ? files(A, a.id) : [], []);
  assert.ok(existsSync(localFile(b.thumbnailUrl)));
});

test("LinkedIn is unaffected: create keeps its legacy thumbnail handling and the route refuses LinkedIn posts", async () => {
  const r = await createPost(A, { platform: "LinkedIn", thumbnail: F.gif() });
  assert.equal(r.status, 201);
  assert.match(r.body.post.thumbnailUrl, /\/thumbnail\.gif$/);
  const put = await putThumb(A, r.body.post.id, F.jpg());
  assert.equal(put.status, 400);
  assert.equal(put.body.code, "UNSUPPORTED_PLATFORM");
});

test("n8n payload shape is unchanged; only the existing thumbnail_url value carries the cover", () => {
  const post = { id: "p1", postNumber: 7, platform: "Instagram", postType: "reel", caption: "c", status: "draft", scheduledDate: null };
  const media = [{ order: 1, url: "https://files.example.com/POST-0007/v.mp4", mediaType: "VIDEO" }];
  const without = utils.buildN8nPayload({ ...post, thumbnailUrl: null }, media, "Brand", "America/Vancouver");
  const withCover = utils.buildN8nPayload({ ...post, thumbnailUrl: "https://files.example.com/POST-0007/t.jpg" }, media, "Brand", "America/Vancouver");
  assert.deepEqual(Object.keys(withCover), Object.keys(without));
  assert.equal(without.thumbnail_url, "");
  assert.equal(withCover.thumbnail_url, "https://files.example.com/POST-0007/t.jpg");
  const strip = ({ thumbnail_url, "Webhook Sent At": _w, ...rest }) => rest;
  assert.deepEqual(strip(withCover), strip(without));
});
