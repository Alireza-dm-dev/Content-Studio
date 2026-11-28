// Per-post Publishing Mode (V1.3.56): Production / Trial / Save Only.
//
// Real: create, edit, adapt, manual send, trial send, trial confirmation,
// thumbnail and delete routes; payload builder + legacy LinkedIn adapter;
// production transport (fetch) and trial transport (pinned http, real sockets);
// shared trial runner; media preparation.
// Mocked: prisma (in-memory), session/brand access, fs writes, the SFTP upload
// itself (counted), caption rules, LinkedIn retention selection.
// Three SEPARATE local listeners: production, trial and delete. Every test
// asserts exact listener counts.
import { test, mock, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";

process.env.TZ = "Asia/Tokyo";
process.env.N8N_TRIAL_WEBHOOK_TEST_POLICY = "allow-loopback"; // test-only loopback exception
delete process.env.N8N_TRIAL_WEBHOOK_ALLOWED_HOSTS;
const PUBLIC = "https://files.example.test/";

// ── Listeners ────────────────────────────────────────────────────────────────
function listener() {
  const l = { requests: [], behaviour: null, sockets: new Set() };
  l.server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      l.requests.push({ url: req.url, headers: req.headers, raw, body: safeJson(raw) });
      if (l.behaviour) return l.behaviour(req, res, raw);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ received: true }));
    });
  });
  l.server.on("connection", (s) => { l.sockets.add(s); s.on("close", () => l.sockets.delete(s)); });
  return l;
}
function safeJson(raw) { try { return JSON.parse(raw); } catch { return null; } }
const prod = listener();
const trial = listener();
const del = listener();
for (const l of [prod, trial, del]) await new Promise((r) => l.server.listen(0, "127.0.0.1", r));
after(() => { for (const l of [prod, trial, del]) { for (const s of l.sockets) s.destroy(); l.server.close(); } });
const PROD_URL = `http://127.0.0.1:${prod.server.address().port}/webhook/publish`;
const DELETE_URL = `http://127.0.0.1:${del.server.address().port}/webhook/delete`;
const TRIAL_URL = `http://127.0.0.1:${trial.server.address().port}/webhook-test/Publish-Trial`;
process.env.N8N_PUBLISHED_POST_WEBHOOK_URL = PROD_URL;
process.env.N8N_PUBLISHED_POST_DELETE_WEBHOOK_URL = DELETE_URL;

// ── In-memory data ───────────────────────────────────────────────────────────
const userA = { id: "ua", role: "user", brands: ["bA"] };
const userB = { id: "ub", role: "user", brands: ["bB"] };
let currentUser;
let db;
let uploads; // [{ postId, orders, thumbnail }]
let dirReads = []; // directories whose files deletePublishedPostFiles cleans up
let uploadMode; // "ok" | "fail"
let retentionRemovesNew;
let captionFails;
let trialTimeoutMs;
let seq = 0;
const BRANDS = [
  { id: "bA", name: "Knight London", timezone: "Europe/London" },
  { id: "bB", name: "Other Brand", timezone: null },
];
function reset() {
  db = { settings: new Map([["N8N_PUBLISHED_POST_TRIAL_WEBHOOK_URL", TRIAL_URL]]), posts: new Map(), media: [], collaborators: [], receipts: new Map() };
  uploads = [];
  dirReads = [];
  uploadMode = "ok";
  retentionRemovesNew = false;
  captionFails = false;
  trialTimeoutMs = null;
  for (const l of [prod, trial, del]) { l.requests.length = 0; l.behaviour = null; }
  currentUser = userA;
}
reset();
beforeEach(reset);

const brandOf = (id) => BRANDS.find((b) => b.id === id) || null;
const full = (p) => {
  if (!p) return null;
  return {
    ...p,
    media: db.media.filter((m) => m.publishedPostId === p.id).sort((a, b) => a.order - b.order).map((m) => ({ ...m })),
    brand: brandOf(p.brandId),
    collaborators: db.collaborators.filter((c) => c.publishedPostId === p.id).map((c) => ({ ...c, brand: brandOf(c.brandId) })),
    _count: { comments: 0 },
  };
};
const matches = (p, where = {}) => ["id", "brandId", "platform"].every((k) => where[k] === undefined || typeof where[k] === "object" || p[k] === where[k]);
const prisma = {
  settings: {
    findUnique: async ({ where }) => (db.settings.has(where.key) ? { key: where.key, value: db.settings.get(where.key) } : null),
    findMany: async ({ where } = {}) => [...db.settings.entries()].filter(([k]) => !where?.key?.in || where.key.in.includes(k)).map(([key, value]) => ({ key, value })),
    upsert: async ({ where, update }) => { db.settings.set(where.key, update.value); return { key: where.key, value: update.value }; },
    deleteMany: async ({ where }) => ({ count: db.settings.delete(where.key) ? 1 : 0 }),
  },
  brand: { findUnique: async ({ where }) => brandOf(where.id), findMany: async () => BRANDS },
  publishedPost: {
    findFirst: async ({ where, orderBy } = {}) => {
      let rows = [...db.posts.values()].filter((p) => matches(p, where));
      if (orderBy?.postNumber === "desc") rows = rows.sort((a, b) => (b.postNumber ?? 0) - (a.postNumber ?? 0));
      return full(rows[0]);
    },
    findUnique: async ({ where }) => full(db.posts.get(where.id)),
    findMany: async ({ where } = {}) => [...db.posts.values()].filter((p) => matches(p, where)).map(full),
    create: async ({ data }) => {
      const row = { thumbnailUrl: null, jsonPayload: null, notes: null, ...data, deliveryMode: data.deliveryMode ?? null, createdAt: new Date(Date.now() + (seq += 1)), updatedAt: new Date() };
      db.posts.set(row.id, row);
      return { ...row };
    },
    update: async ({ where, data }) => {
      const row = { ...db.posts.get(where.id), ...data, updatedAt: new Date() };
      db.posts.set(where.id, row);
      return full(row);
    },
    delete: async ({ where }) => { const p = db.posts.get(where.id); db.posts.delete(where.id); return p; },
    deleteMany: async ({ where }) => { const ids = where?.id?.in || (where?.id ? [where.id] : []); ids.forEach((i) => db.posts.delete(i)); return { count: ids.length }; },
  },
  publishedPostMedia: {
    create: async ({ data }) => { const m = { id: `m${(seq += 1)}`, ...data }; db.media.push(m); return { ...m }; },
  },
  publishedPostCollaborator: {
    create: async ({ data }) => { db.collaborators.push({ ...data }); return data; },
    findFirst: async ({ where }) => db.collaborators.find((c) => c.publishedPostId === where.publishedPostId && c.brandId === where.brandId) || null,
    findMany: async () => [],
    deleteMany: async () => ({ count: 0 }),
  },
  brandStoryContent: { findMany: async () => [] },
  // In-memory stand-in with the same uniqueness rule as the real table
  // (tests/submission-durable.test.mjs uses a REAL SQLite database).
  publishedPostSubmission: {
    create: async ({ data }) => {
      if ([...db.receipts.values()].some((r) => r.scopeKey === data.scopeKey)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      const r = { id: `rc${(seq += 1)}`, postId: null, outcome: null, ...data, createdAt: new Date(), updatedAt: new Date() };
      db.receipts.set(r.id, r);
      return { ...r };
    },
    findUnique: async ({ where }) => { const r = where.id ? db.receipts.get(where.id) : [...db.receipts.values()].find((x) => x.scopeKey === where.scopeKey); return r ? { ...r } : null; },
    update: async ({ where, data }) => { const r = { ...db.receipts.get(where.id), ...data, updatedAt: new Date() }; db.receipts.set(where.id, r); return r; },
    updateMany: async ({ where, data }) => { const r = db.receipts.get(where.id); if (!r || r.state !== where.state || r.postId !== where.postId || !(r.updatedAt < where.updatedAt.lt)) return { count: 0 }; db.receipts.set(r.id, { ...r, ...data }); return { count: 1 }; },
    deleteMany: async ({ where }) => {
      let n = 0;
      for (const r of [...db.receipts.values()]) {
        const hit = where.createdAt ? r.createdAt < where.createdAt.lt : r.id === where.id && r.state === where.state && r.postId === where.postId;
        if (hit) { db.receipts.delete(r.id); n += 1; }
      }
      return { count: n };
    },
  },
  $transaction: async (ops) => (Array.isArray(ops) ? Promise.all(ops) : ops(prisma)),
};
mock.module("@/lib/prisma", { exports: { prisma } });
mock.module("@/lib/auth", {
  exports: {
    getCurrentUser: async () => currentUser,
    getAdminAccess: async () => ({ user: null, error: "Admin access required", status: 403 }),
    SESSION_COOKIE_NAME: "content_studio_session",
  },
});
mock.module("@/lib/brand-access", {
  exports: {
    requireBrandAccess: async (id) => (!currentUser ? { ok: false, status: 401, error: "Authentication required" }
      : currentUser.brands.includes(id) ? { ok: true, user: currentUser } : { ok: false, status: 403, error: "Brand access denied" }),
    getAccessibleBrandIds: async () => currentUser?.brands ?? [],
    canUserAccessBrand: async (u, id) => Boolean(u?.brands?.includes(id)),
    isAdminUser: () => false,
    requireResourceBrandAccess: async () => ({ ok: true }),
  },
});
const noFs = { writeFile: async () => {}, mkdir: async () => {}, rm: async () => {}, readdir: async (d) => { dirReads.push(String(d)); return []; }, unlink: async () => {}, stat: async () => ({ size: 1 }), copyFile: async () => {}, readFile: async () => Buffer.from(""), access: async () => {} };
mock.module("fs/promises", { exports: noFs });
mock.module("@/lib/published-post-remote-media", {
  exports: {
    uploadPublishedPostMedia: async ({ post, mediaRecords }) => {
      uploads.push({ postId: post.id, orders: mediaRecords.map((r) => r.order), thumbnail: Boolean(post.thumbnailUrl) });
      if (uploadMode === "fail") return { success: false, detailCode: "SFTP_CONNECTION_FAILED", error: "mock media server down" };
      if (uploadMode === "partial") return { success: true, thumbnailUrl: null, media: mediaRecords.slice(0, -1).map((r) => ({ order: r.order, fileUrl: `${PUBLIC}${post.id}/${r.order}-partial` })) };
      return {
        success: true,
        thumbnailUrl: post.thumbnailUrl ? `${PUBLIC}${post.id}/cover.jpg` : null,
        media: mediaRecords.map((r) => ({ order: r.order, fileUrl: `${PUBLIC}${post.id}/${r.order}-${r.fileName || "file"}` })),
      };
    },
    isCanonicalMediaUrl: (u) => typeof u === "string" && u.startsWith(PUBLIC),
    isLocalMediaUrl: (u) => typeof u === "string" && u.startsWith("/uploads/"),
    copyMediaToTarget: async ({ targetPostId, order }) => ({ url: `/uploads/bA/published-posts/${targetPostId}/copy-${order}.png`, fileName: `copy-${order}.png` }),
    getEnvConfig: () => ({}),
  },
});
mock.module("@/lib/instagram-caption-check", {
  exports: {
    validateInstagramCaptionForBrand: async () => (captionFails ? { ok: false, failures: [{ message: "Caption must contain exactly 5 hashtags." }], warnings: [] } : { ok: true, failures: [], warnings: [] }),
    captionRulesErrorBody: (v) => ({ error: "Caption does not follow the rules.", failures: v.failures }),
  },
});
mock.module("@/lib/linkedin-retention", {
  exports: {
    enforceLinkedInRetention: async (brandId) => {
      if (!retentionRemovesNew) return { deletedIds: [] };
      const newest = [...db.posts.values()].filter((p) => p.brandId === brandId && p.platform === "LinkedIn").sort((a, b) => b.createdAt - a.createdAt)[0];
      if (!newest) return { deletedIds: [] };
      db.posts.delete(newest.id);
      return { deletedIds: [newest.id] };
    },
    retentionResult: (deletedIds, currentId) => ({ deletedIds, currentPostRemoved: deletedIds.includes(currentId) }),
    LINKEDIN_RETENTION_REMOVED_MESSAGE: "This post was not kept by LinkedIn retention.",
  },
});
// Real trial transport; only the timeout can be shortened for the timeout test.
const realTrial = await import("../lib/n8n-trial-webhook.js?real-transport");
mock.module("@/lib/n8n-trial-webhook", {
  exports: { ...realTrial, sendPinnedRequest: (o) => realTrial.sendPinnedRequest(trialTimeoutMs ? { ...o, timeoutMs: trialTimeoutMs } : o) },
});

const pm = await import("../lib/publishing-mode.js");
const runner = await import("../lib/n8n-trial-runner.js");
const createRoute = await import("../app/api/brands/[id]/published-posts/route.js");
const editRoute = await import("../app/api/brands/[id]/published-posts/[postId]/route.js");
const adaptRoute = await import("../app/api/brands/[id]/published-posts/[postId]/adapt/route.js");
const sendRoute = await import("../app/api/brands/[id]/published-posts/[postId]/send-webhook/route.js");
const trialRoute = await import("../app/api/brands/[id]/published-posts/[postId]/trial-webhook/route.js");
const thumbRoute = await import("../app/api/brands/[id]/published-posts/[postId]/thumbnail/route.js");
const confirmRoute = await import("../app/api/brands/[id]/trial-confirmation/route.js");

// ── Helpers ──────────────────────────────────────────────────────────────────
const ctx = (id, postId) => ({ params: Promise.resolve({ id, postId }) });
const jsonReq = (body) => new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const pad = (sig, n = 64) => new Uint8Array([...sig, ...new Array(n).fill(0)]);
const F = {
  mp4: (name = "reel.mp4") => new File([pad([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70])], name, { type: "video/mp4" }),
  jpg: (name = "cover.jpg") => new File([pad([0xff, 0xd8, 0xff, 0xe0])], name, { type: "image/jpeg" }),
  png: (name = "a.png") => new File([pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], name, { type: "image/png" }),
  pdf: (name = "deck.pdf") => new File([pad([...Buffer.from("%PDF-1.4")])], name, { type: "application/pdf" }),
};
const IG_CAPTION = "Hello\n\n#a #b #c #d #e";

async function confirmToken(brandId, bindingOrPromise) {
  const binding = await bindingOrPromise;
  const res = await confirmRoute.POST(jsonReq({ binding }), ctx(brandId));
  const b = await res.json();
  return { status: res.status, body: b, token: b.token };
}

/** Upload like the form: build FormData, (Trial) get a token for it, submit. */
async function upload({ brandId = "bA", platform = "Instagram", postType = "reel", files, thumbnail, caption = IG_CAPTION, scheduledDate, mode, token, status, extraFields } = {}) {
  const fd = new FormData();
  for (const f of files || [F.mp4()]) fd.append("files", f);
  if (thumbnail) fd.append("thumbnail", thumbnail);
  fd.append("postType", postType);
  fd.append("platform", platform);
  fd.append("caption", caption);
  if (scheduledDate) fd.append("scheduledDate", scheduledDate);
  fd.append("notes", "n");
  if (status) fd.append("status", status);
  for (const [k, v] of Object.entries(extraFields || {})) fd.append(k, v);
  if (mode === "trial" && token === undefined) token = (await confirmToken(brandId, pm.uploadTrialBinding(brandId, fd))).token;
  if (mode) fd.append("publishingMode", mode);
  if (token) fd.append("trialConfirmation", token);
  const res = await createRoute.POST(new Request("http://x", { method: "POST", body: fd }), ctx(brandId));
  return { res, status: res.status, body: await res.json() };
}

async function adapt(sourceId, body, { brandId = "bA", token } = {}) {
  const b = { ...body };
  if (b.publishingMode === "trial" && token === undefined) token = (await confirmToken(brandId, pm.adaptTrialBinding(brandId, sourceId, b))).token;
  if (token) b.trialConfirmation = token;
  const res = await adaptRoute.POST(jsonReq(b), ctx(brandId, sourceId));
  return { status: res.status, body: await res.json() };
}
async function edit(postId, body, brandId = "bA") {
  const res = await editRoute.POST(jsonReq(body), ctx(brandId, postId));
  return { status: res.status, body: await res.json() };
}
async function send(postId, body = {}, brandId = "bA") {
  const res = await sendRoute.POST(jsonReq(body), ctx(brandId, postId));
  return { status: res.status, body: await res.json() };
}
async function trialSend(postId, body = {}, brandId = "bA") {
  if (!("confirmFingerprint" in body)) {
    const pf = await (await trialRoute.GET(new Request("http://x"), ctx(brandId, postId))).json();
    body = { ...body, confirmFingerprint: pf.fingerprint };
  }
  const res = await trialRoute.POST(jsonReq(body), ctx(brandId, postId));
  return { status: res.status, body: await res.json() };
}
const post = (id) => db.posts.get(id);
const counts = () => ({ prod: prod.requests.length, trial: trial.requests.length, del: del.requests.length, uploads: uploads.length, posts: db.posts.size });
function assertCounts(expected, msg) {
  const c = counts();
  for (const [k, v] of Object.entries(expected)) assert.equal(c[k], v, `${msg || ""} ${k}: expected ${v}, got ${c[k]} (${JSON.stringify(c)})`);
}
/** Seed a saved post directly (legacy rows have deliveryMode null). */
function seedPost({ id, brandId = "bA", platform = "Instagram", postType = "reel", deliveryMode = null, publicMedia = true, scheduledDate = null, mediaUrls } = {}) {
  const urls = mediaUrls || [publicMedia ? `${PUBLIC}${id}/1.mp4` : `/uploads/${brandId}/published-posts/${id}/1.mp4`];
  const media = urls.map((u, i) => ({ id: `${id}-m${i}`, publishedPostId: id, order: i + 1, mediaType: postType === "reel" ? "VIDEO" : platform === "LinkedIn" && postType === "carousel" ? "document" : "IMAGE", url: publicMedia ? `/uploads/${brandId}/published-posts/${id}/${i + 1}` : u, fileName: `${i + 1}`, fileType: null }));
  // Upload-form rows keep LOCAL urls; the public URLs live in the stored payload.
  const payloadMedia = urls.map((u, i) => ({ ...media[i], url: u }));
  db.media.push(...media);
  const row = { id, brandId, platform, postType, caption: IG_CAPTION, status: "draft", scheduledDate, notes: null, thumbnailUrl: null, postNumber: 7, deliveryMode, createdAt: new Date(), updatedAt: new Date() };
  db.posts.set(id, row);
  row.jsonPayload = null;
  return payloadMedia;
}
async function seedWithPayload(opts) {
  const payloadMedia = seedPost(opts);
  const utils = await import("../lib/published-post-utils.js");
  const p = db.posts.get(opts.id);
  p.jsonPayload = JSON.stringify(utils.buildN8nPayload({ ...p }, payloadMedia, brandOf(p.brandId).name, brandOf(p.brandId).timezone));
  return p;
}
const noDeliveryModeAnywhere = () => {
  for (const l of [prod, trial]) for (const r of l.requests) assert.ok(!/deliveryMode|publishingMode|trialConfirmation|productionDeliveryAttemptedAt|submissionId/.test(r.raw), "delivery fields never sent to n8n");
  for (const p of db.posts.values()) assert.ok(!/deliveryMode|productionDeliveryAttemptedAt/.test(p.jsonPayload || ""), "delivery fields never stored in the n8n payload");
};

// ═════════════════════════════════════════════════════════════════════════════
// 1–3, 8, 9, 11, 12: Instagram Reel in all three modes
// ═════════════════════════════════════════════════════════════════════════════
test("1. Instagram Reel PRODUCTION upload: media uploaded once, production receives it, trial nothing", async () => {
  const r = await upload({ mode: "production", thumbnail: F.jpg() });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assertCounts({ prod: 1, trial: 0, uploads: 1, posts: 1 });
  const b = prod.requests[0].body;
  assert.ok(b.video_url.startsWith(PUBLIC) && b.thumbnail_url.startsWith(PUBLIC), "public video + cover");
  assert.equal(post(r.body.post.id).deliveryMode, "production");
  assert.equal(r.body.webhookResult.success, true);
  noDeliveryModeAnywhere();
});

test("1b. no publishingMode (existing clients) = Production, exactly as before", async () => {
  const r = await upload({ thumbnail: F.jpg() });
  assert.equal(r.status, 201);
  assertCounts({ prod: 1, trial: 0, uploads: 1 });
  assert.equal(r.body.publishingMode, undefined, "response shape unchanged for legacy clients");
  assert.equal(post(r.body.post.id).deliveryMode, "production");
});

test("2/8/9/11. Instagram Reel TRIAL upload: public media + cover reach the trial webhook only", async () => {
  const r = await upload({ mode: "trial", thumbnail: F.jpg(), scheduledDate: "2026-07-15T10:00" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assertCounts({ prod: 0, trial: 1, uploads: 1, posts: 1 });
  const sent = trial.requests[0];
  assert.equal(sent.headers["x-content-studio-mode"], "trial");
  assert.ok(sent.body.video_url.startsWith(PUBLIC), "trial gets the PUBLIC video URL");
  assert.ok(sent.body.thumbnail_url.startsWith(PUBLIC), "Reel cover supported");
  assert.equal(r.body.trial.sent, true);
  const res = r.body.trial.result;
  assert.equal(res.httpStatus, 200);
  assert.equal(res.outcome, "http_accepted");
  assert.equal(res.requestBody, sent.raw, "result shows the exact outgoing JSON");
  assert.ok(res.trialId && res.durationMs >= 0);
  const saved = post(r.body.post.id);
  assert.equal(saved.deliveryMode, "trial");
  assert.equal(saved.status, "draft", "HTTP acceptance never marks the post Published");
  assert.equal(saved.scheduledDate.toISOString(), "2026-07-15T09:00:00.000Z");
  assert.equal(r.body.webhookResult.code, "PRODUCTION_DELIVERY_SKIPPED");
  assert.ok(JSON.parse(saved.jsonPayload).video_url.startsWith(PUBLIC), "public URLs persisted for a later production send");
  noDeliveryModeAnywhere();
});

test("3/12. Instagram Reel SAVE ONLY: saved with local media + cover, no upload, no webhook", async () => {
  const r = await upload({ mode: "save_only", thumbnail: F.jpg(), scheduledDate: "2026-07-15T10:00" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assertCounts({ prod: 0, trial: 0, uploads: 0, posts: 1 });
  const saved = post(r.body.post.id);
  assert.equal(saved.deliveryMode, "save_only");
  assert.equal(saved.caption, IG_CAPTION);
  assert.equal(saved.notes, "n");
  assert.ok(saved.thumbnailUrl.startsWith("/uploads/"), "cover kept locally");
  assert.ok(JSON.parse(saved.jsonPayload).video_url.startsWith("/uploads/"), "media stays local");
  assert.equal(r.body.webhookResult.code, "PRODUCTION_DELIVERY_SKIPPED");
});

test("4. Instagram Static and Carousel in Trial and Production", async () => {
  for (const [postType, files] of [["static", [F.png()]], ["carousel", [F.png("1.png"), F.png("2.png"), F.png("3.png")]]]) {
    reset();
    const t = await upload({ mode: "trial", postType, files });
    assert.equal(t.status, 201, JSON.stringify(t.body));
    assertCounts({ prod: 0, trial: 1, uploads: 1 }, postType);
    assert.equal(trial.requests[0].body.media_count, files.length);
    assert.ok(trial.requests[0].body.files.every((f) => f.image_url.startsWith(PUBLIC)));
    const p = await upload({ mode: "production", postType, files });
    assert.equal(p.status, 201);
    assertCounts({ prod: 1, trial: 1, uploads: 2 }, postType);
  }
});

test("5/6. LinkedIn image, video and PDF in Trial: legacy PDF adapter applied to the trial body", async () => {
  for (const [postType, file] of [["static", F.png()], ["reel", F.mp4()], ["carousel", F.pdf()]]) {
    reset();
    const r = await upload({ platform: "LinkedIn", postType, files: [file], caption: "Li", mode: "trial" });
    assert.equal(r.status, 201, `${postType}: ${JSON.stringify(r.body)}`);
    assertCounts({ prod: 0, trial: 1, uploads: 1 }, postType);
    const b = trial.requests[0].body;
    if (postType === "carousel") {
      assert.equal(b.Platform, "Linkedin", "legacy adapter");
      assert.equal(b.files[0].media_type, "IMAGE");
      assert.ok(b.media_url.startsWith(PUBLIC));
      assert.ok(!JSON.stringify(b).includes("document_url"));
    }
    assert.equal(post(r.body.post.id).deliveryMode, "trial");
  }
});

test("10. caption rules stay a save gate in every mode (nothing saved, uploaded or sent)", async () => {
  captionFails = true;
  for (const mode of ["production", "trial", "save_only"]) {
    const r = await upload({ mode });
    assert.equal(r.status, 422, mode);
  }
  assertCounts({ prod: 0, trial: 0, uploads: 0, posts: 0 });
});

// ═════════════════════════════════════════════════════════════════════════════
// Configuration, confirmation and destination
// ═════════════════════════════════════════════════════════════════════════════
test("13. missing trial configuration: Trial disabled, direct API Trial refused, nothing saved", async () => {
  db.settings.delete("N8N_PUBLISHED_POST_TRIAL_WEBHOOK_URL");
  const st = await (await confirmRoute.GET(new Request("http://x"), ctx("bA"))).json();
  assert.equal(st.ready, false);
  assert.equal(st.code, "TRIAL_NOT_CONFIGURED");
  assert.equal(st.message, "Trial webhook is not configured.");
  const r = await upload({ mode: "trial", token: "forged-token" });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "TRIAL_NOT_CONFIGURED");
  assertCounts({ prod: 0, trial: 0, uploads: 0, posts: 0 });
});

test("14. invalid trial destination: confirmation refused; a direct request saves nothing", async () => {
  db.settings.set("N8N_PUBLISHED_POST_TRIAL_WEBHOOK_URL", PROD_URL); // same as production
  const fd = new FormData(); fd.append("files", F.mp4());
  const c = await confirmToken("bA", pm.uploadTrialBinding("bA", fd));
  assert.equal(c.status, 409);
  assert.equal(c.token, undefined);
  const r = await upload({ mode: "trial", token: "x".repeat(48) });
  assert.equal(r.status, 409);
  assertCounts({ prod: 0, trial: 0, uploads: 0, posts: 0 });
});

test("form changes invalidate the confirmation (server-side binding)", async () => {
  const fd = new FormData();
  fd.append("files", F.mp4()); fd.append("postType", "reel"); fd.append("platform", "Instagram");
  fd.append("caption", IG_CAPTION); fd.append("scheduledDate", "2026-07-15T10:00"); fd.append("notes", "n");
  const { token } = await confirmToken("bA", pm.uploadTrialBinding("bA", fd));
  assert.ok(token);
  // Same token, but the schedule changed after confirming:
  const r = await upload({ mode: "trial", token, scheduledDate: "2026-07-16T10:00" });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "TRIAL_CONFIRMATION_STALE");
  // Unchanged form with that token is accepted:
  const ok = await upload({ mode: "trial", token, scheduledDate: "2026-07-15T10:00" });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assertCounts({ prod: 0, trial: 1, posts: 1 });
});

test("secret replacement invalidates both confirmations; tokens reveal nothing", async () => {
  db.settings.set("N8N_PUBLISHED_POST_TRIAL_WEBHOOK_AUTH_MODE", "header");
  db.settings.set("N8N_PUBLISHED_POST_TRIAL_WEBHOOK_HEADER_NAME", "X-Trial-Key");
  db.settings.set("N8N_PUBLISHED_POST_TRIAL_WEBHOOK_HEADER_VALUE", "first-secret-value-123");
  const fd = new FormData();
  fd.append("files", F.mp4()); fd.append("postType", "reel"); fd.append("platform", "Instagram"); fd.append("caption", IG_CAPTION); fd.append("notes", "n");
  const c = await confirmToken("bA", pm.uploadTrialBinding("bA", fd));
  assert.ok(!JSON.stringify(c.body).includes("first-secret") && !JSON.stringify(c.body).includes("Publish-Trial") && !JSON.stringify(c.body).includes("X-Trial-Key"));
  await seedWithPayload({ id: "sp1", deliveryMode: "trial" });
  const pf1 = await (await trialRoute.GET(new Request("http://x"), ctx("bA", "sp1"))).json();

  db.settings.set("N8N_PUBLISHED_POST_TRIAL_WEBHOOK_HEADER_VALUE", "second-secret-value-456");
  const r = await upload({ mode: "trial", token: c.token });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "TRIAL_CONFIRMATION_STALE");
  const pf2 = await (await trialRoute.GET(new Request("http://x"), ctx("bA", "sp1"))).json();
  assert.notEqual(pf1.fingerprint, pf2.fingerprint, "saved-post fingerprint changes with the secret");
  const stale = await trialSend("sp1", { confirmFingerprint: pf1.fingerprint });
  assert.equal(stale.status, 409);
  assertCounts({ prod: 0, trial: 0, posts: 1 });
});

test("config changed after the post was saved: 'Post saved. Trial not sent because the trial configuration changed.'", async () => {
  const p = await seedWithPayload({ id: "cc1", deliveryMode: "trial" });
  const { configVersion } = await runner.readTrialReadiness();
  db.settings.set("N8N_PUBLISHED_POST_TRIAL_WEBHOOK_URL", `${TRIAL_URL}-other`);
  const t = await runner.runTrialForSavedPost({ post: full(p), brand: brandOf("bA"), configVersion });
  assert.equal(t.sent, false);
  assert.equal(t.error, "Post saved. Trial not sent because the trial configuration changed.");
  assertCounts({ prod: 0, trial: 0 });
});

test("20. trial credentials stay protected (header sent to trial only, never returned)", async () => {
  db.settings.set("N8N_PUBLISHED_POST_TRIAL_WEBHOOK_AUTH_MODE", "header");
  db.settings.set("N8N_PUBLISHED_POST_TRIAL_WEBHOOK_HEADER_NAME", "X-Trial-Key");
  db.settings.set("N8N_PUBLISHED_POST_TRIAL_WEBHOOK_HEADER_VALUE", "super-secret-trial-key-987");
  trial.behaviour = (req, res) => { res.writeHead(200); res.end(`echo ${req.headers["x-trial-key"]}`); };
  const r = await upload({ mode: "trial" });
  assert.equal(r.status, 201);
  assert.equal(trial.requests[0].headers["x-trial-key"], "super-secret-trial-key-987");
  const text = JSON.stringify(r.body);
  assert.ok(!text.includes("super-secret-trial-key-987"), "secret never in the upload response");
  assert.ok(text.includes("[redacted]"), "echoed secret redacted");
  assert.ok(!text.includes("Publish-Trial"), "trial URL never returned");
  assertCounts({ prod: 0, trial: 1 });
});

test("21/22. unauthorized Brand rejected; collaborator-only access rejected", async () => {
  currentUser = userB;
  const r = await upload({ mode: "save_only" });
  assert.equal(r.status, 403);
  const c = await confirmRoute.GET(new Request("http://x"), ctx("bA"));
  assert.equal(c.status, 403);
  currentUser = userA;
  await seedWithPayload({ id: "col1", brandId: "bB", deliveryMode: "trial" });
  db.collaborators.push({ publishedPostId: "col1", brandId: "bA" });
  const t = await trialSend("col1", { confirmFingerprint: "x", uploadMedia: true });
  assert.equal(t.status, 403);
  const s = await send("col1", { confirmPromotion: true });
  assert.equal(s.status, 404);
  assertCounts({ prod: 0, trial: 0, uploads: 0 });
});

test("23/24. Brand timezone and unscheduled posts in the trial body", async () => {
  const s = await upload({ mode: "trial", scheduledDate: "2026-07-15T10:00" });
  assert.equal(s.status, 201);
  const b = trial.requests[0].body;
  assert.equal(b["Scheduled Date"], "15/07/2026 02:00:00", "America/Vancouver wall clock");
  assert.equal(b.scheduled_date_utc, "2026-07-15T09:00:00.000Z");
  assert.equal(b.brand_timezone, "Europe/London");
  assert.equal(b.brand_local_publish_datetime, "2026-07-15T10:00:00");
  assert.equal(s.body.trial.result.n8nScheduledDate, "15/07/2026 02:00:00");
  const u = await upload({ mode: "trial" });
  assert.equal(u.status, 201);
  const ub = trial.requests[1].body;
  assert.ok(!ub["Scheduled Date"], "unscheduled: empty Scheduled Date");
  assert.ok(!ub.scheduled_date_utc);
  assert.equal(u.body.trial.result.schedule.scheduled, false);
  assertCounts({ prod: 0, trial: 2 });
});

test("25. LinkedIn retention removing the new post: no upload, no trial, no production", async () => {
  retentionRemovesNew = true;
  for (const mode of ["trial", "production", "save_only"]) {
    const r = await upload({ platform: "LinkedIn", postType: "static", files: [F.png()], caption: "Li", mode });
    assert.equal(r.status, 200, mode);
    assert.equal(r.body.kept, false);
    assert.equal(r.body.linkedInRetention.currentPostRemoved, true);
    assert.equal(r.body.trial, undefined);
  }
  assertCounts({ prod: 0, trial: 0, uploads: 0, posts: 0 });
});

// ═════════════════════════════════════════════════════════════════════════════
// Failures, retry, duplicates
// ═════════════════════════════════════════════════════════════════════════════
test("15. trial HTTP failure: post saved, rejection reported, production untouched", async () => {
  trial.behaviour = (req, res) => { res.writeHead(500); res.end("boom"); };
  const r = await upload({ mode: "trial" });
  assert.equal(r.status, 201);
  assert.equal(r.body.trial.sent, true);
  assert.equal(r.body.trial.result.outcome, "http_rejected");
  assert.equal(r.body.trial.result.httpStatus, 500);
  assert.equal(post(r.body.post.id).deliveryMode, "trial");
  assertCounts({ prod: 0, trial: 1, posts: 1 });
});

test("16. trial timeout: reported as uncertain, never retried, never production", async () => {
  trialTimeoutMs = 150;
  trial.behaviour = () => {}; // never responds
  const r = await upload({ mode: "trial" });
  assert.equal(r.status, 201);
  assert.equal(r.body.trial.result.outcome, "timeout");
  assert.match(r.body.trial.result.hint, /may still have/i);
  assertCounts({ prod: 0, trial: 1, posts: 1 });
});

test("17/18/26/27. media upload failure → explicit recovery → later production send (no duplicates)", async () => {
  uploadMode = "fail";
  const r = await upload({ mode: "trial", thumbnail: F.jpg() });
  assert.equal(r.status, 201, "the post is saved");
  assert.equal(r.body.trial.sent, false);
  assert.equal(r.body.trial.code, "REMOTE_MEDIA_UPLOAD_FAILED");
  assertCounts({ prod: 0, trial: 0, uploads: 1, posts: 1 }, "no trial with non-public media");
  const id = r.body.post.id;

  // Saved-post preflight offers the recovery; the V1.3.55 payload-only option remains.
  const pf = await (await trialRoute.GET(new Request("http://x"), ctx("bA", id))).json();
  assert.equal(pf.canUploadMedia, true);
  assert.ok(pf.unavailableMedia.length > 0);

  uploadMode = "fail";
  const f = await trialSend(id, { uploadMedia: true });
  assert.equal(f.status, 503);
  assert.equal(f.body.code, "TRIAL_MEDIA_UPLOAD_FAILED");
  assertCounts({ prod: 0, trial: 0, uploads: 2, posts: 1 });

  uploadMode = "ok";
  const ok = await trialSend(id, { uploadMedia: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.mediaUploaded, true);
  assert.ok(trial.requests[0].body.video_url.startsWith(PUBLIC));
  assert.ok(trial.requests[0].body.thumbnail_url.startsWith(PUBLIC));
  assertCounts({ prod: 0, trial: 1, uploads: 3, posts: 1 }, "retry used the saved post");
  assert.equal(post(id).deliveryMode, "trial", "recovery never promotes");
  assert.equal(post(id).status, "draft");

  // Recovery is not offered once media is public; a plain trial needs no upload.
  const again = await trialSend(id, { uploadMedia: true });
  assert.equal(again.body.code, "TRIAL_MEDIA_UPLOAD_NOT_AVAILABLE");

  // Explicit production send: confirmation required, then sent WITHOUT re-uploading.
  const unconfirmed = await send(id);
  assert.equal(unconfirmed.status, 409);
  assert.equal(unconfirmed.body.code, "PROMOTION_CONFIRMATION_REQUIRED");
  assertCounts({ prod: 0, uploads: 3 });
  const promoted = await send(id, { confirmPromotion: true });
  assert.equal(promoted.status, 200, JSON.stringify(promoted.body));
  assert.equal(promoted.body.promotion.promoted, true);
  assertCounts({ prod: 1, trial: 1, uploads: 3, posts: 1 }, "no duplicate media upload");
  assert.equal(post(id).deliveryMode, "production");
  assert.equal(post(id).status, "draft", "production send does not mark Published");
  assert.equal(prod.requests[0].body.video_url, trial.requests[0].body.video_url, "same public media");
  noDeliveryModeAnywhere();
});

test("19. duplicate protection: concurrent recovery runs upload and send once", async () => {
  await seedWithPayload({ id: "dup1", deliveryMode: "save_only", publicMedia: false });
  const pf = await (await trialRoute.GET(new Request("http://x"), ctx("bA", "dup1"))).json();
  const [a, b] = await Promise.all([
    trialSend("dup1", { uploadMedia: true, confirmFingerprint: pf.fingerprint }),
    trialSend("dup1", { uploadMedia: true, confirmFingerprint: pf.fingerprint }),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  assert.ok([a, b].some((x) => x.body.code === "TRIAL_ALREADY_RUNNING"));
  assertCounts({ prod: 0, trial: 1, uploads: 1, posts: 1 });
});

// ═════════════════════════════════════════════════════════════════════════════
// Edit safety and promotion
// ═════════════════════════════════════════════════════════════════════════════
test("28/29. Trial and Save Only edits never reach production (caption, schedule, status, notes, no-op, deliveryMode)", async () => {
  for (const mode of ["trial", "save_only"]) {
    reset();
    await seedWithPayload({ id: "e1", deliveryMode: mode, scheduledDate: new Date("2026-07-15T09:00:00Z") });
    for (const body of [
      { caption: `${IG_CAPTION} edited` },
      { scheduledDate: "2026-07-20T11:00" },
      { status: "published" },
      { notes: "new notes" },
      {},
      { deliveryMode: "production" },
    ]) {
      const r = await edit("e1", body);
      assert.equal(r.status, 200, `${mode} ${JSON.stringify(body)}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.webhookResult.code, "PRODUCTION_DELIVERY_SKIPPED");
      assert.equal(r.body.webhookResult.message, "Production delivery skipped because this post is in Trial or Save Only mode.");
    }
    assert.equal(post("e1").deliveryMode, mode, "the edit endpoint cannot change deliveryMode");
    assert.equal(post("e1").scheduledDate.toISOString(), "2026-07-20T10:00:00.000Z", "schedule edit saved (London BST)");
    assertCounts({ prod: 0, trial: 0, uploads: 0 }, mode);
  }
});

test("28b. cover change on a Save Only post with local media defers the public upload", async () => {
  await seedWithPayload({ id: "th1", deliveryMode: "save_only", publicMedia: false });
  const fd = new FormData(); fd.append("thumbnail", F.jpg());
  const res = await thumbRoute.PUT(new Request("http://x", { method: "PUT", body: fd }), ctx("bA", "th1"));
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  assertCounts({ prod: 0, trial: 0, uploads: 0 });
  assert.ok(post("th1").thumbnailUrl.startsWith("/uploads/"));
});

test("28c. cover change on a Trial post whose media is already public still publishes the cover (no later re-upload)", async () => {
  await seedWithPayload({ id: "th2", deliveryMode: "trial", publicMedia: true });
  const fd = new FormData(); fd.append("thumbnail", F.jpg());
  const res = await thumbRoute.PUT(new Request("http://x", { method: "PUT", body: fd }), ctx("bA", "th2"));
  assert.equal(res.status, 200);
  assertCounts({ prod: 0, trial: 0, uploads: 1 });
  assert.deepEqual(uploads[0].orders, [], "cover only, no media re-upload");
  assert.ok(JSON.parse(post("th2").jsonPayload).thumbnail_url.startsWith(PUBLIC));
});

test("30. legacy (null) and production posts: edits still auto-send to production as before", async () => {
  for (const mode of [null, "production"]) {
    reset();
    await seedWithPayload({ id: "lg1", deliveryMode: mode });
    const r = await edit("lg1", { caption: `${IG_CAPTION} x` });
    assert.equal(r.status, 200);
    assert.equal(r.body.webhookResult.success, true);
    assertCounts({ prod: 1, trial: 0 }, String(mode));
    // Manual send needs no confirmation and promotes nothing.
    const s = await send("lg1");
    assert.equal(s.status, 200);
    assert.equal(s.body.promotion, undefined);
    assert.equal(post("lg1").deliveryMode, mode);
    assertCounts({ prod: 2, trial: 0 });
  }
});

test("failed promotion (HTTP 500) leaves the mode unchanged; no retry", async () => {
  await seedWithPayload({ id: "pf1", deliveryMode: "trial" });
  prod.behaviour = (req, res) => { res.writeHead(500); res.end("no"); };
  const r = await send("pf1", { confirmPromotion: true });
  assert.equal(r.body.success, false);
  assert.equal(r.body.promotion.promoted, false);
  assert.equal(r.body.promotion.deliveryUncertain, false);
  assert.equal(post("pf1").deliveryMode, "trial");
  assertCounts({ prod: 1, trial: 0 });
});

test("timed-out / network-failed promotion reports uncertainty and does not promote", async () => {
  await seedWithPayload({ id: "pt1", deliveryMode: "save_only" });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); };
  try {
    const r = await send("pt1", { confirmPromotion: true });
    assert.equal(r.body.webhookResult.code, "N8N_WEBHOOK_TIMEOUT");
    assert.equal(r.body.promotion.deliveryUncertain, true);
    assert.match(r.body.promotion.error, /may still have received/);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(post("pt1").deliveryMode, "save_only");
  process.env.N8N_PUBLISHED_POST_WEBHOOK_URL = "http://127.0.0.1:1/closed";
  try {
    const r2 = await send("pt1", { confirmPromotion: true });
    assert.equal(r2.body.promotion.deliveryUncertain, true, "network failure is uncertain too");
  } finally {
    process.env.N8N_PUBLISHED_POST_WEBHOOK_URL = PROD_URL;
  }
  assert.equal(post("pt1").deliveryMode, "save_only");
});

test("n8n accepted but promotion not persisted: partial failure reported, not resent", async () => {
  await seedWithPayload({ id: "pp1", deliveryMode: "trial" });
  const realUpdate = prisma.publishedPost.update;
  prisma.publishedPost.update = async (q) => { if (q.data?.deliveryMode) throw new Error("db locked"); return realUpdate(q); };
  try {
    const r = await send("pp1", { confirmPromotion: true });
    assert.equal(r.body.success, true);
    assert.equal(r.body.promotion.partialFailure, true);
    assert.match(r.body.promotion.error, /accepted/);
  } finally {
    prisma.publishedPost.update = realUpdate;
  }
  assertCounts({ prod: 1 });
  assert.equal(post("pp1").deliveryMode, "trial");
});

test("Trial Send never promotes; Trial Send on a production post keeps 'production'", async () => {
  await seedWithPayload({ id: "ts1", deliveryMode: "trial" });
  await seedWithPayload({ id: "ts2", deliveryMode: "production" });
  for (const id of ["ts1", "ts2"]) {
    const r = await trialSend(id);
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  assert.equal(post("ts1").deliveryMode, "trial");
  assert.equal(post("ts2").deliveryMode, "production");
  assertCounts({ prod: 0, trial: 2, uploads: 0 });
  // Media recovery is not offered for production posts.
  const pf = await (await trialRoute.GET(new Request("http://x"), ctx("bA", "ts2"))).json();
  assert.equal(pf.canUploadMedia, false);
});

// ═════════════════════════════════════════════════════════════════════════════
// Adaptation
// ═════════════════════════════════════════════════════════════════════════════
const b64 = (f) => f.arrayBuffer().then((a) => Buffer.from(a).toString("base64"));
async function seedIgSource() {
  return seedWithPayload({ id: "srcIG", platform: "Instagram", postType: "static", mediaUrls: [`${PUBLIC}srcIG/1.png`], deliveryMode: null });
}
async function seedLiSource() {
  return seedWithPayload({ id: "srcLI", platform: "LinkedIn", postType: "static", mediaUrls: [`${PUBLIC}srcLI/1.png`], deliveryMode: null });
}
const reuseBody = (mode, extra = {}) => ({
  targetPlatform: "LinkedIn", targetPostType: "static", caption: "Adapted", status: "draft",
  scheduledDate: "2026-07-15T10:00", mediaStrategy: "reuse", publishTitle: "T",
  orderedMediaManifest: [{ action: "reuseCanonical", sourceUrl: `${PUBLIC}srcIG/1.png`, mediaType: "IMAGE", order: 1 }],
  ...(mode ? { publishingMode: mode } : {}),
  ...extra,
});
async function newFileBody(mode, extra = {}) {
  const f = F.png("new.png");
  return {
    targetPlatform: "Instagram", targetPostType: "static", caption: IG_CAPTION, status: "draft",
    scheduledDate: "2026-07-15T10:00", mediaStrategy: "new",
    orderedMediaManifest: [{ action: "uploadNew", mediaType: "IMAGE", order: 1 }],
    files: [{ name: f.name, type: f.type, size: f.size, content: await b64(f) }],
    ...(mode ? { publishingMode: mode } : {}),
    ...extra,
  };
}

test("7. Instagram → LinkedIn adaptation in Trial: trial only, schedule + timezone preserved", async () => {
  await seedIgSource();
  const r = await adapt("srcIG", reuseBody("trial"));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assertCounts({ prod: 0, trial: 1, uploads: 0, posts: 2 }, "reused public media needs no upload");
  const b = trial.requests[0].body;
  assert.equal(b["Scheduled Date"], "15/07/2026 02:00:00");
  assert.equal(b.scheduled_date_utc, "2026-07-15T09:00:00.000Z");
  assert.equal(b.brand_timezone, "Europe/London");
  assert.equal(r.body.post.deliveryMode, "trial");
  assert.equal(post("srcIG").deliveryMode, null, "source post untouched");
  noDeliveryModeAnywhere();
});

test("7. LinkedIn → Instagram adaptation in Trial with a new file: uploaded then trial only", async () => {
  await seedLiSource();
  const r = await adapt("srcLI", await newFileBody("trial"));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assertCounts({ prod: 0, trial: 1, uploads: 1, posts: 2 });
  assert.ok(trial.requests[0].body.files[0].image_url.startsWith(PUBLIC));
  assert.equal(r.body.trial.sent, true);
});

test("Save Only adaptation defers new uploads, keeps reused public media; production send later uploads only what is missing", async () => {
  await seedIgSource();
  const reused = await adapt("srcIG", reuseBody("save_only"));
  assert.equal(reused.status, 201, JSON.stringify(reused.body));
  assertCounts({ prod: 0, trial: 0, uploads: 0 });
  await seedLiSource();
  const fresh = await adapt("srcLI", await newFileBody("save_only"));
  assert.equal(fresh.status, 201, JSON.stringify(fresh.body));
  assertCounts({ prod: 0, trial: 0, uploads: 0 }, "new file upload deferred");
  assert.equal(fresh.body.remoteResult.deferred, true);
  const id = fresh.body.post.id;
  assert.equal(post(id).deliveryMode, "save_only");

  // Mixed post: one reused canonical row + one new local row.
  db.media.push({ id: "mx", publishedPostId: id, order: 2, mediaType: "IMAGE", url: `${PUBLIC}srcLI/1.png`, fileName: "1.png" });
  const s = await send(id, { confirmPromotion: true });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.deepEqual(uploads[0].orders, [1], "only the non-public row is uploaded");
  assertCounts({ prod: 1, uploads: 1 });
  assert.equal(post(id).deliveryMode, "production");
});

test("legacy adapt flags: sendToN8n=true → production; conflicting flags rejected; invalid modes rejected", async () => {
  await seedIgSource();
  const legacy = await adapt("srcIG", reuseBody(null, { sendToN8n: true }));
  assert.equal(legacy.status, 201, JSON.stringify(legacy.body));
  assertCounts({ prod: 1, trial: 0 });
  assert.equal(legacy.body.post.deliveryMode, "production");
  const legacyDraft = await adapt("srcIG", reuseBody(null));
  assert.equal(legacyDraft.body.post.deliveryMode, "save_only", "legacy 'save without sending' is Save Only");
  assertCounts({ prod: 1, trial: 0 });
  for (const [mode, flag] of [["trial", true], ["save_only", true], ["production", false]]) {
    const r = await adapt("srcIG", reuseBody(mode, { sendToN8n: flag }), { token: "x" });
    assert.equal(r.status, 400, `${mode}+${flag}`);
    assert.equal(r.body.code, "PUBLISHING_MODE_CONFLICT");
  }
  const bad = await adapt("srcIG", reuseBody("prod"));
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "INVALID_PUBLISHING_MODE");
  const badCreate = await upload({ mode: "Production" });
  assert.equal(badCreate.status, 400);
  assertCounts({ prod: 1, trial: 0, posts: 3 });
});

// ═════════════════════════════════════════════════════════════════════════════
// Deletion, indicators, unit rules
// ═════════════════════════════════════════════════════════════════════════════
test("publishing-mode rules: parsing, edit gate, labels (legacy shows none)", () => {
  assert.deepEqual(pm.parseCreatePublishingMode(undefined), { ok: true, mode: "production", explicit: false });
  assert.equal(pm.parseCreatePublishingMode("trial").mode, "trial");
  assert.equal(pm.parseCreatePublishingMode("TRIAL").ok, false);
  assert.equal(pm.allowsAutomaticProductionDelivery(null), true);
  assert.equal(pm.allowsAutomaticProductionDelivery("production"), true);
  assert.equal(pm.allowsAutomaticProductionDelivery("trial"), false);
  assert.equal(pm.allowsAutomaticProductionDelivery("save_only"), false);
  assert.equal(pm.allowsAutomaticProductionDelivery("garbage"), false, "unknown stored values fail safe");
  assert.equal(pm.deliveryModeLabel(null), null);
  assert.equal(pm.deliveryModeLabel("trial"), "Trial");
  assert.equal(pm.deliveryModeLabel("save_only"), "Save Only");
  assert.equal(pm.deliveryModeLabel("production"), "Production");
});

test("delivery-mode indicators are rendered on cards, modals and Today; selector in every form", () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  for (const f of ["components/PublishedPostsSection.jsx", "components/LinkedInPublishedPostsSection.jsx", "components/PostDetailModal.jsx", "components/LinkedInPostDetailModal.jsx", "components/today/TodayCards.jsx"]) {
    assert.match(read(f), /<DeliveryModeBadge mode=\{post\.deliveryMode\}/, f);
  }
  for (const f of ["components/PublishedPostUploadForm.jsx", "components/LinkedInPostUploadForm.jsx", "components/CrossPlatformPostModal.jsx"]) {
    const src = read(f);
    assert.match(src, /<PublishingModeSelector pm=\{pm\}/, f);
    assert.match(src, /production: "[^"]+", trial: "[^"]+", save_only: "Save Post"/, f);
    // Scheduled Date → Publishing Mode → (Notes)
    assert.ok(src.indexOf("Scheduled Date") < src.indexOf("<PublishingModeSelector"), `${f}: selector below the schedule`);
  }
  for (const f of ["components/PublishedPostUploadForm.jsx", "components/LinkedInPostUploadForm.jsx"]) {
    const src = read(f);
    assert.ok(src.indexOf("<PublishingModeSelector") < src.indexOf("Notes (optional)"), `${f}: selector above Notes`);
  }
  assert.ok(!/sendToN8n:\s*true/.test(read("components/CrossPlatformPostModal.jsx")), "adaptation no longer sends the legacy flag");
});

// ═════════════════════════════════════════════════════════════════════════════
// V1.3.56 safety follow-up: attempt tracking, delete safety, Today, duplicates,
// content binding, media preparation
// ═════════════════════════════════════════════════════════════════════════════
const delRoute = editRoute; // DELETE lives in the [postId] route
const doDelete = async (id) => {
  const res = await delRoute.DELETE(new Request("http://x", { method: "DELETE" }), ctx("bA", id));
  return { status: res.status, body: await res.json() };
};

test("S1/S2/S3/S4/S11. delete: never-sent Trial / Save Only skip the delete webhook; legacy, production and attempted posts keep it", async () => {
  for (const platform of ["Instagram", "LinkedIn"]) {
    for (const [mode, attempted, expectDel] of [["trial", false, 0], ["save_only", false, 0], [null, false, 1], ["production", false, 1], ["trial", true, 1], ["save_only", true, 1]]) {
      reset();
      await seedWithPayload({ id: "d1", platform, postType: "static", deliveryMode: mode });
      if (attempted) post("d1").productionDeliveryAttemptedAt = new Date();
      const r = await doDelete("d1");
      const label = `${platform} ${mode} attempted=${attempted}`;
      assert.equal(r.status, 200, label);
      assertCounts({ del: expectDel, prod: 0, trial: 0, posts: 0 }, label);
      assert.ok(dirReads.some((d) => d.endsWith("/bA/published-posts/d1")), `${label}: local files cleaned up`);
      assert.equal(r.body.externalDelete === "skipped_never_sent_to_production", expectDel === 0, label);
    }
  }
});

test("S5/S6/S7. promotion attempts are recorded before sending and kept on failure, timeout and success", async () => {
  await seedWithPayload({ id: "a1", deliveryMode: "trial" });
  prod.behaviour = (req, res) => { res.writeHead(500); res.end("no"); };
  await send("a1", { confirmPromotion: true });
  const first = post("a1").productionDeliveryAttemptedAt;
  assert.ok(first instanceof Date, "failed promotion keeps the attempt");
  assert.equal(post("a1").deliveryMode, "trial");

  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); };
  try {
    const r = await send("a1", { confirmPromotion: true });
    assert.equal(r.body.webhookResult.code, "N8N_WEBHOOK_TIMEOUT");
  } finally { globalThis.fetch = realFetch; }
  assert.ok(post("a1").productionDeliveryAttemptedAt >= first, "timeout keeps (refreshes) the attempt");

  prod.behaviour = null;
  const ok = await send("a1", { confirmPromotion: true });
  assert.equal(ok.body.promotion.promoted, true);
  assert.ok(post("a1").productionDeliveryAttemptedAt instanceof Date, "success keeps the attempt");
  assert.equal(post("a1").deliveryMode, "production");
  noDeliveryModeAnywhere();
});

test("S8. if the attempt cannot be recorded, nothing is sent (manual send, edit and create)", async () => {
  const realUpdate = prisma.publishedPost.update;
  prisma.publishedPost.update = async (q) => { if (q.data && "productionDeliveryAttemptedAt" in q.data) throw new Error("db locked"); return realUpdate(q); };
  try {
    await seedWithPayload({ id: "pf2", deliveryMode: "trial" });
    const s1 = await send("pf2", { confirmPromotion: true });
    assert.equal(s1.body.webhookResult.code, "PRODUCTION_ATTEMPT_NOT_RECORDED");
    assert.equal(s1.body.promotion.promoted, false);
    await seedWithPayload({ id: "lg2", deliveryMode: null });
    const e = await edit("lg2", { notes: "x" });
    assert.equal(e.body.webhookResult.code, "PRODUCTION_ATTEMPT_NOT_RECORDED");
    const c = await upload({ mode: "production" });
    assert.equal(c.status, 201);
    assert.equal(c.body.webhookResult.code, "PRODUCTION_ATTEMPT_NOT_RECORDED");
  } finally { prisma.publishedPost.update = realUpdate; }
  assertCounts({ prod: 0 });
  assert.equal(post("pf2").deliveryMode, "trial");
});

test("S9/S10. Trial and Save Only operations never record a production attempt", async () => {
  const t = await upload({ mode: "trial" });
  const so = await upload({ mode: "save_only" });
  await edit(t.body.post.id, { caption: `${IG_CAPTION} e` });
  await edit(so.body.post.id, { status: "published" });
  await trialSend(t.body.post.id);
  await trialSend(so.body.post.id, { uploadMedia: true });
  const fd = new FormData(); fd.append("thumbnail", F.jpg());
  await thumbRoute.PUT(new Request("http://x", { method: "PUT", body: fd }), ctx("bA", so.body.post.id));
  await (await import("../app/api/brands/[id]/published-posts/[postId]/payload/route.js")).GET(new Request("http://x"), ctx("bA", so.body.post.id));
  for (const id of [t.body.post.id, so.body.post.id]) assert.equal(post(id).productionDeliveryAttemptedAt ?? null, null, id);
  assertCounts({ prod: 0, trial: 3 });
  // A production create records it.
  const p = await upload({ mode: "production" });
  assert.ok(post(p.body.post.id).productionDeliveryAttemptedAt instanceof Date);
});

test("S12. LinkedIn retention and Instagram cleanup never call a delete webhook", async () => {
  const realRetention = await import("../lib/linkedin-retention.js?real-retention");
  for (let i = 0; i < 9; i += 1) {
    await seedWithPayload({ id: `h${i}`, platform: "LinkedIn", postType: "static", deliveryMode: i % 2 ? "trial" : null, scheduledDate: new Date(Date.UTC(2026, 0, 1 + i)) });
    post(`h${i}`).productionDeliveryAttemptedAt = i % 3 ? new Date() : null;
  }
  const { deletedIds } = await realRetention.enforceLinkedInRetention("bA", { timeZone: "Europe/London" });
  assert.ok(deletedIds.length >= 4, `retention removed ${deletedIds.length}`);
  for (let i = 0; i < 21; i += 1) await seedWithPayload({ id: `ig${i}`, deliveryMode: "production" });
  const r = await upload({ mode: "save_only" });
  assert.equal(r.status, 201);
  assert.equal([...db.posts.values()].filter((p) => p.platform === "Instagram").length, 21, "Instagram 21-post cleanup ran");
  assertCounts({ del: 0, prod: 0, trial: 0 });
});

test("S13/S14/S15. Today: Trial / Save Only never count as production overdue; production overdue unchanged", async () => {
  const { getTodayData, isPostOverdue, scheduleNotice } = await import("../lib/today.js");
  const now = new Date("2026-11-28T15:00:00Z");
  const past = new Date("2026-11-28T10:00:00Z");
  const future = new Date("2026-11-28T20:00:00Z");
  const cases = [
    ["legacy", null, null, past, true, null],
    ["prod", "production", new Date(), past, true, null],
    ["trial", "trial", null, past, false, "not_sent"],
    ["save", "save_only", null, past, false, "not_sent"],
    ["tried", "trial", new Date(), past, false, "attempt_unconfirmed"],
    ["future", "trial", null, future, false, null],
  ];
  for (const [id, mode, attempt, when, overdue, notice] of cases) {
    await seedWithPayload({ id, deliveryMode: mode, scheduledDate: when });
    post(id).productionDeliveryAttemptedAt = attempt;
    assert.equal(isPostOverdue(post(id), now), overdue, id);
    assert.equal(scheduleNotice(post(id), now), notice, id);
  }
  const data = await getTodayData(userA, { now });
  const section = data.brands.find((b) => b.id === "bA");
  assert.equal(section.instagram.length, 6, "all stay visible on Today");
  assert.equal(section.counts.overdue, 2, "only legacy + production are production-overdue");
  assert.equal(section.instagram.find((p) => p.id === "trial").today.scheduleNotice, "not_sent");
  assert.equal(section.instagram.find((p) => p.id === "tried").today.scheduleNotice, "attempt_unconfirmed");
  const ui = readFileSync(new URL("../components/today/TodayCards.jsx", import.meta.url), "utf8");
  assert.ok(ui.includes("Scheduled time passed — not sent to production"));
});

test("S16. duplicate create submission: one post, one webhook, same result returned", async () => {
  const a = await upload({ mode: "production", extraFields: { submissionId: "sub-create-0001" } });
  const b = await upload({ mode: "production", extraFields: { submissionId: "sub-create-0001" } });
  assert.equal(a.status, 201);
  assert.equal(b.status, 200);
  assert.equal(b.body.duplicateSubmission, true);
  assert.equal(b.body.submission.state, "completed");
  assert.equal(b.body.post.id, a.body.post.id);
  assertCounts({ posts: 1, prod: 1, uploads: 1 });
  // Without an id (existing clients): unchanged, every request creates a post.
  await upload({ mode: "save_only" }); await upload({ mode: "save_only" });
  assertCounts({ posts: 3 });
});

test("S17. duplicate adaptation submission: one adapted post, one trial", async () => {
  await seedIgSource();
  const body = reuseBody("trial", { submissionId: "sub-adapt-0001" });
  const { token } = await confirmToken("bA", pm.adaptTrialBinding("bA", "srcIG", body));
  const a = await adapt("srcIG", body, { token });
  const b = await adapt("srcIG", body, { token });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(b.body.duplicateSubmission, true);
  assert.equal(b.body.post.id, a.body.post.id);
  assertCounts({ posts: 2, trial: 1, prod: 0 });
});

test("S18. concurrent duplicate submissions: answered once", async () => {
  // One token for the shared request.
  const f = F.mp4();
  const build = () => {
    const x = new FormData();
    x.append("files", f); x.append("postType", "reel"); x.append("platform", "Instagram"); x.append("caption", IG_CAPTION); x.append("notes", "n");
    return x;
  };
  const { token } = await confirmToken("bA", pm.uploadTrialBinding("bA", build()));
  const send1 = async () => {
    const x = build(); x.append("publishingMode", "trial"); x.append("trialConfirmation", token); x.append("submissionId", "sub-concurrent-01");
    const res = await createRoute.POST(new Request("http://x", { method: "POST", body: x }), ctx("bA"));
    return { status: res.status, body: await res.json() };
  };
  const [a, b] = await Promise.all([send1(), send1()]);
  assert.deepEqual([a.status, b.status].sort(), [200, 201]);
  assert.equal(a.body.post.id, b.body.post.id);
  assert.equal([a, b].filter((x) => x.body.duplicateSubmission).length, 1);
  assertCounts({ posts: 1, trial: 1, prod: 0, uploads: 1 });
});

test("S19. same id with a changed request is refused; a refused request can be corrected with the same id", async () => {
  const a = await upload({ mode: "save_only", extraFields: { submissionId: "sub-change-0001" } });
  assert.equal(a.status, 201);
  const b = await upload({ mode: "save_only", caption: `${IG_CAPTION} changed`, extraFields: { submissionId: "sub-change-0001" } });
  assert.equal(b.status, 409);
  assert.equal(b.body.code, "SUBMISSION_ID_REUSED");
  assertCounts({ posts: 1 });
  captionFails = true;
  const bad = await upload({ mode: "save_only", extraFields: { submissionId: "sub-fixable-001" } });
  assert.equal(bad.status, 422);
  captionFails = false;
  const fixed = await upload({ mode: "save_only", caption: `${IG_CAPTION} fixed`, extraFields: { submissionId: "sub-fixable-001" } });
  assert.equal(fixed.status, 201, "nothing was saved the first time, so the id is reusable");
  assertCounts({ posts: 2 });
  const invalid = await upload({ mode: "save_only", extraFields: { submissionId: "x" } });
  assert.equal(invalid.status, 400);
});

test("S20. retry after a failed trial operates on the saved post, and resubmitting the create returns it", async () => {
  uploadMode = "fail";
  const a = await upload({ mode: "trial", extraFields: { submissionId: "sub-retry-00001" } });
  assert.equal(a.body.trial.code, "REMOTE_MEDIA_UPLOAD_FAILED");
  uploadMode = "ok";
  // Re-submitting the same create (e.g. after a lost response) is answered from the saved post.
  const again = await upload({ mode: "trial", token: undefined, extraFields: { submissionId: "sub-retry-00001" } });
  assert.equal(again.body.duplicateSubmission, true);
  assert.equal(again.body.post.id, a.body.post.id);
  const retry = await trialSend(a.body.post.id, { uploadMedia: true });
  assert.equal(retry.status, 200);
  assertCounts({ posts: 1, trial: 1, prod: 0 });
});

test("S21. media preparation: reuse public rows, upload missing ones, recover partial uploads, keep order and shared media", async () => {
  await seedLiSource();
  const fresh = await adapt("srcLI", await newFileBody("save_only"));
  const id = fresh.body.post.id;
  // Mixed: order 1 local (new file), order 2 shared public media from the source.
  db.media.push({ id: "mx2", publishedPostId: id, order: 2, mediaType: "IMAGE", url: `${PUBLIC}srcLI/1.png`, fileName: "1.png" });
  db.media.push({ id: "mx3", publishedPostId: id, order: 3, mediaType: "IMAGE", url: `/uploads/bA/published-posts/${id}/3.png`, fileName: "3.png" });
  uploadMode = "partial";
  const p1 = await send(id, { confirmPromotion: true });
  assert.equal(p1.status, 503, "a partial upload is not persisted and nothing is sent");
  assert.equal(p1.body.webhookResult.detailCode, "SFTP_MEDIA_COUNT_MISMATCH");
  assertCounts({ prod: 0 });
  assert.equal(post(id).productionDeliveryAttemptedAt ?? null, null, "no attempt before media is ready");
  uploadMode = "ok";
  const p2 = await send(id, { confirmPromotion: true });
  assert.equal(p2.status, 200, JSON.stringify(p2.body));
  assert.deepEqual(uploads.map((u) => u.orders), [[1, 3], [1, 3]], "only non-public rows, retried in full");
  const body = prod.requests[0].body;
  assert.deepEqual(body.files.map((f) => f.image_url), [`${PUBLIC}${id}/1-new.png`, `${PUBLIC}srcLI/1.png`, `${PUBLIC}${id}/3-3.png`], "ordered by media order; shared URL reused");
  // Deleting the adapted post never touches the source or its shared media.
  await doDelete(id);
  assert.ok(post("srcLI"), "source post kept");
  assert.ok(dirReads.every((d) => d.endsWith(`/published-posts/${id}`)), "only the deleted post's own folder is cleaned");
  assert.ok(JSON.parse(post("srcLI").jsonPayload).files[0].image_url === `${PUBLIC}srcLI/1.png`);
  // Trial media recovery never sends production.
  await seedWithPayload({ id: "rec1", deliveryMode: "save_only", publicMedia: false });
  await trialSend("rec1", { uploadMedia: true });
  assertCounts({ prod: 1, trial: 1 });
});

test("S6b. a different file with the same name and size cannot reuse a Trial confirmation", async () => {
  const fileA = new File([pad([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70], 64)], "same.mp4", { type: "video/mp4" });
  const bytesB = pad([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70], 64); bytesB[40] = 9;
  const fileB = new File([bytesB], "same.mp4", { type: "video/mp4" });
  assert.equal(fileA.size, fileB.size);
  const fd = new FormData();
  fd.append("files", fileA); fd.append("postType", "reel"); fd.append("platform", "Instagram"); fd.append("caption", IG_CAPTION); fd.append("notes", "n");
  const { token } = await confirmToken("bA", pm.uploadTrialBinding("bA", fd));
  const swapped = await upload({ mode: "trial", token, files: [fileB] });
  assert.equal(swapped.status, 409);
  assert.equal(swapped.body.code, "TRIAL_CONFIRMATION_STALE");
  const same = await upload({ mode: "trial", token, files: [fileA] });
  assert.equal(same.status, 201);
  assertCounts({ posts: 1, trial: 1, prod: 0 });
});
