// Durable duplicate-submission protection (V1.3.56) against a REAL SQLite
// database: real Prisma client, real unique constraint on the receipt table,
// real create / adapt / trial routes, real LinkedIn retention, real production
// and trial transports to local listeners. Mocked: session/brand access, the
// SFTP upload itself, the Instagram caption rule gate.
// The working directory is a temp folder, so no file reaches public/uploads.
import { test, mock, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "cs-durable-"));
const DB = path.join(TMP, "test.db");
// Build the schema from the real migration files (same SQL as production).
const Database = createRequire(ROOT + "package.json")("better-sqlite3");
{
  const raw = new Database(DB);
  const dir = path.join(ROOT, "prisma/migrations");
  for (const m of fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory()).sort()) {
    raw.exec(fs.readFileSync(path.join(dir, m, "migration.sql"), "utf8"));
  }
  raw.close();
}
process.env.DATABASE_URL = `file:${DB}`;
process.env.TZ = "Asia/Tokyo";
process.env.N8N_TRIAL_WEBHOOK_TEST_POLICY = "allow-loopback";
process.chdir(TMP);
after(() => { process.chdir(ROOT); fs.rmSync(TMP, { recursive: true, force: true }); });

// ── Listeners ────────────────────────────────────────────────────────────────
function listener() {
  const l = { requests: [], behaviour: null, sockets: new Set() };
  l.server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      l.requests.push({ raw, headers: req.headers });
      if (l.behaviour) return l.behaviour(req, res);
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  l.server.on("connection", (s) => { l.sockets.add(s); s.on("close", () => l.sockets.delete(s)); });
  return l;
}
const prod = listener();
const trial = listener();
for (const l of [prod, trial]) await new Promise((r) => l.server.listen(0, "127.0.0.1", r));
after(() => { for (const l of [prod, trial]) { for (const s of l.sockets) s.destroy(); l.server.close(); } });
process.env.N8N_PUBLISHED_POST_WEBHOOK_URL = `http://127.0.0.1:${prod.server.address().port}/webhook/publish`;
const TRIAL_URL = `http://127.0.0.1:${trial.server.address().port}/webhook-test/durable`;

// ── Mocks (no prisma mock: the real client is used) ─────────────────────────
const PUBLIC = "https://files.example.test/";
const userA = { id: "ua", role: "user", brands: ["bA"] };
const userA2 = { id: "ua2", role: "user", brands: ["bA"] };
const userB = { id: "ub", role: "user", brands: ["bB"] };
let currentUser = userA;
let uploads = 0;
let uploadMode = "ok";
let uploadGate = null; // a Promise that blocks the upload (simulated crash window)
mock.module("@/lib/auth", { exports: { getCurrentUser: async () => currentUser, getAdminAccess: async () => ({ user: null, status: 403, error: "no" }), SESSION_COOKIE_NAME: "content_studio_session" } });
mock.module("@/lib/brand-access", {
  exports: {
    requireBrandAccess: async (id) => (currentUser.brands.includes(id) ? { ok: true, user: currentUser } : { ok: false, status: 403, error: "Brand access denied" }),
    getAccessibleBrandIds: async () => currentUser.brands,
    canUserAccessBrand: async (u, id) => Boolean(u?.brands?.includes(id)),
    isAdminUser: () => false,
    requireResourceBrandAccess: async () => ({ ok: true }),
  },
});
mock.module("@/lib/published-post-remote-media", {
  exports: {
    uploadPublishedPostMedia: async ({ post, mediaRecords }) => {
      uploads += 1;
      if (uploadGate) await uploadGate;
      if (uploadMode === "fail") return { success: false, detailCode: "SFTP_CONNECTION_FAILED", error: "down" };
      return { success: true, thumbnailUrl: null, media: mediaRecords.map((r) => ({ order: r.order, fileUrl: `${PUBLIC}${post.id}/${r.order}.bin` })) };
    },
    isCanonicalMediaUrl: (u) => typeof u === "string" && u.startsWith(PUBLIC),
    isLocalMediaUrl: (u) => typeof u === "string" && u.startsWith("/uploads/"),
    copyMediaToTarget: async () => ({ url: "/uploads/x/copy.png", fileName: "copy.png" }),
    getEnvConfig: () => ({}),
  },
});
mock.module("@/lib/instagram-caption-check", {
  exports: {
    validateInstagramCaptionForBrand: async () => ({ ok: true, failures: [], warnings: [] }),
    captionRulesErrorBody: (v) => ({ error: "Caption rules", failures: v.failures }),
  },
});

const { prisma } = await import("../lib/prisma.js");
const pm = await import("../lib/publishing-mode.js");
const guard = await import("../lib/submission-guard.js");
const receipts = await import("../lib/submission-receipt.js");
const createRoute = await import("../app/api/brands/[id]/published-posts/route.js");
const adaptRoute = await import("../app/api/brands/[id]/published-posts/[postId]/adapt/route.js");
const trialRoute = await import("../app/api/brands/[id]/published-posts/[postId]/trial-webhook/route.js");
const confirmRoute = await import("../app/api/brands/[id]/trial-confirmation/route.js");
const retention = await import("../lib/linkedin-retention.js");
after(() => prisma.$disconnect());

// ── Helpers ──────────────────────────────────────────────────────────────────
const ctx = (id, postId) => ({ params: Promise.resolve({ id, postId }) });
const jsonReq = (body) => new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const png = (fill = 1, n = 256) => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(n).fill(fill)])], "a.png", { type: "image/png" });
const CAPTION = "Hello\n\nKnight London\n\n#a #b #c #d #e";
function form({ submissionId, mode = "production", platform = "Instagram", caption = CAPTION, file = png(), scheduledDate } = {}) {
  const fd = new FormData();
  fd.append("files", file); fd.append("postType", "static"); fd.append("platform", platform);
  fd.append("caption", caption); fd.append("notes", "");
  if (scheduledDate) fd.append("scheduledDate", scheduledDate);
  fd.append("publishingMode", mode);
  if (submissionId) fd.append("submissionId", submissionId);
  return fd;
}
async function create(fd, brandId = "bA") {
  const res = await createRoute.POST(new Request("http://x", { method: "POST", body: fd }), ctx(brandId));
  return { status: res.status, body: await res.json() };
}
const postCount = () => prisma.publishedPost.count();
const receiptOf = async (submissionId, { userId = "ua", operation = "create", sourcePostId = "" } = {}) =>
  prisma.publishedPostSubmission.findUnique({ where: { scopeKey: receipts.submissionScopeKey({ userId, brandId: "bA", operation, sourcePostId, submissionId }) } });
const resetInFlight = () => globalThis.__contentStudioSubmissionsInFlight?.clear();
const waitFor = async (fn, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 20)); } return false; };

beforeEach(async () => {
  await prisma.publishedPostSubmission.deleteMany({});
  await prisma.publishedPost.deleteMany({});
  await prisma.settings.deleteMany({});
  await prisma.brand.deleteMany({});
  await prisma.brand.create({ data: { id: "bA", name: "Knight London", timezone: "Europe/London" } });
  await prisma.brand.create({ data: { id: "bB", name: "Other", timezone: null } });
  await prisma.settings.create({ data: { key: "N8N_PUBLISHED_POST_TRIAL_WEBHOOK_URL", value: TRIAL_URL } });
  for (const l of [prod, trial]) { l.requests.length = 0; l.behaviour = null; }
  uploads = 0; uploadMode = "ok"; uploadGate = null; currentUser = userA;
  resetInFlight();
});

// ═════════════════════════════════════════════════════════════════════════════
test("D1/D16. durable duplicate create: one post, one webhook; production behaviour unchanged", async () => {
  const a = await create(form({ submissionId: "dur-create-0001" }));
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const b = await create(form({ submissionId: "dur-create-0001" }));
  assert.equal(b.status, 200);
  assert.equal(b.body.duplicateSubmission, true);
  assert.equal(b.body.submission.state, "completed");
  assert.equal(b.body.post.id, a.body.post.id);
  assert.equal(await postCount(), 1);
  assert.equal(prod.requests.length, 1);
  assert.equal(uploads, 1);
  const r = await receiptOf("dur-create-0001");
  assert.equal(r.state, "completed");
  assert.equal(r.postId, a.body.post.id);
  assert.ok(!/Hello|Knight|files\.example/.test(r.outcome), "receipt holds no caption or payload");
  const saved = await prisma.publishedPost.findUnique({ where: { id: a.body.post.id } });
  assert.equal(saved.deliveryMode, "production");
  assert.ok(saved.productionDeliveryAttemptedAt instanceof Date);
  assert.ok(JSON.parse(prod.requests[0].raw).files[0].image_url.startsWith(PUBLIC));
});

test("D2. durable duplicate adaptation (scoped to the source post)", async () => {
  const src = await create(form({ mode: "save_only" }));
  const bytes = Buffer.from(await png(4).arrayBuffer());
  const content = bytes.toString("base64");
  const body = {
    targetPlatform: "LinkedIn", targetPostType: "static", caption: "Adapted", status: "draft", scheduledDate: "2026-12-20T10:00",
    mediaStrategy: "new", publishTitle: "T", orderedMediaManifest: [{ action: "uploadNew", mediaType: "IMAGE", order: 1 }],
    files: [{ name: "n.png", type: "image/png", size: bytes.length, content }], publishingMode: "save_only", submissionId: "dur-adapt-00001",
  };
  const run = async () => { const res = await adaptRoute.POST(jsonReq(body), ctx("bA", src.body.post.id)); return { status: res.status, body: await res.json() }; };
  const a = await run();
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const b = await run();
  assert.equal(b.body.duplicateSubmission, true);
  assert.equal(b.body.post.id, a.body.post.id);
  assert.equal(await postCount(), 2);
  assert.equal(prod.requests.length + trial.requests.length, 0);
  assert.equal((await receiptOf("dur-adapt-00001", { operation: "adapt", sourcePostId: src.body.post.id })).state, "completed");
});

test("D3. concurrent duplicates: exactly one post and one webhook", async () => {
  const rs = await Promise.all([1, 2, 3].map(() => create(form({ submissionId: "dur-concurrent-1" }))));
  assert.equal(await postCount(), 1);
  assert.equal(prod.requests.length, 1);
  assert.equal(new Set(rs.map((r) => r.body.post.id)).size, 1);
  assert.equal(rs.filter((r) => r.status === 201).length, 1);
});

test("D4/D5. same id with different content (incl. same filename and size) → 409", async () => {
  await create(form({ submissionId: "dur-reuse-00001", file: png(1) }));
  const sameNameSize = await create(form({ submissionId: "dur-reuse-00001", file: png(2) }));
  assert.equal(sameNameSize.status, 409);
  assert.equal(sameNameSize.body.code, "SUBMISSION_ID_REUSED");
  const otherCaption = await create(form({ submissionId: "dur-reuse-00001", caption: `${CAPTION} x` }));
  assert.equal(otherCaption.status, 409);
  assert.equal(await postCount(), 1);
  assert.equal(prod.requests.length, 1);
});

test("D6. after a process restart (memory cleared, new DB connection) the duplicate is still recognised", async () => {
  const a = await create(form({ submissionId: "dur-restart-001" }));
  resetInFlight();
  // A fresh client on the same database file, like a restarted server.
  const fresh = await import("../lib/generated/prisma/client.ts");
  const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");
  const client2 = new fresh.PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${DB}` }) });
  const r = await receipts.reserveSubmission({ scopeKey: receipts.submissionScopeKey({ userId: "ua", brandId: "bA", operation: "create", submissionId: "dur-restart-001" }), requestDigest: "x" }, client2);
  assert.equal(r.status, "existing");
  assert.equal(r.receipt.postId, a.body.post.id);
  await client2.$disconnect();
  const b = await create(form({ submissionId: "dur-restart-001" }));
  assert.equal(b.body.duplicateSubmission, true);
  assert.equal(await postCount(), 1);
  assert.equal(prod.requests.length, 1);
});

test("D7. a second process: its reservation blocks this one (in progress), and it sees this one's receipt", async () => {
  const fd = form({ submissionId: "dur-otherproc-1" });
  const digest = await guard.formDataFingerprint(fd);
  const scopeKey = receipts.submissionScopeKey({ userId: "ua", brandId: "bA", operation: "create", submissionId: "dur-otherproc-1" });
  const child = path.join(TMP, "child.mjs");
  fs.writeFileSync(child, `const r = await import(${JSON.stringify(ROOT + "lib/submission-receipt.js")});
const out = await r.reserveSubmission({ scopeKey: process.argv[2], requestDigest: process.argv[3] });
console.log(JSON.stringify({ status: out.status, state: out.receipt.state, postId: out.receipt.postId }));
const { prisma } = await import(${JSON.stringify(ROOT + "lib/prisma.js")}); await prisma.$disconnect();`);
  const runChild = (key, dg) => JSON.parse(execFileSync(process.execPath, ["--import", path.join(ROOT, "tests/setup.mjs"), child, key, dg], { env: { ...process.env, DATABASE_URL: `file:${DB}` }, encoding: "utf8" }).trim().split("\n").pop());
  // The other process reserves first (still processing) → this process must not run it.
  assert.equal(runChild(scopeKey, digest).status, "reserved");
  const blocked = await create(form({ submissionId: "dur-otherproc-1" }));
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, "SUBMISSION_IN_PROGRESS");
  assert.equal(await postCount(), 0);
  assert.equal(prod.requests.length, 0);
  // And the reverse: a completed submission here is "existing" for the other process.
  await create(form({ submissionId: "dur-otherproc-2" }));
  const k2 = receipts.submissionScopeKey({ userId: "ua", brandId: "bA", operation: "create", submissionId: "dur-otherproc-2" });
  const seen = runChild(k2, "irrelevant");
  assert.equal(seen.status, "existing");
  assert.equal(seen.state, "completed");
});

test("D8. after retention removed the post, a duplicate never recreates it", async () => {
  const a = await create(form({ submissionId: "dur-retained-01", platform: "LinkedIn", caption: "Li", scheduledDate: "2025-01-01T10:00" }));
  assert.equal(a.status, 201, JSON.stringify(a.body));
  for (let i = 0; i < 6; i += 1) await create(form({ platform: "LinkedIn", caption: `h${i}`, scheduledDate: `2025-0${2 + i}-01T10:00` }));
  await retention.enforceLinkedInRetention("bA", { timeZone: "Europe/London" });
  assert.equal(await prisma.publishedPost.findUnique({ where: { id: a.body.post.id } }), null, "retention removed the original");
  const before = await postCount();
  const prodBefore = prod.requests.length;
  const dup = await create(form({ submissionId: "dur-retained-01", platform: "LinkedIn", caption: "Li", scheduledDate: "2025-01-01T10:00" }));
  assert.equal(dup.status, 200);
  assert.equal(dup.body.post, null);
  assert.equal(dup.body.kept, false);
  assert.equal(dup.body.submission.state, "post_not_retained");
  assert.equal(await postCount(), before);
  assert.equal(prod.requests.length, prodBefore);
});

test("D9. authorization is re-checked first; another user's id is a separate submission", async () => {
  const a = await create(form({ submissionId: "dur-authz-00001" }));
  currentUser = userB;
  const denied = await create(form({ submissionId: "dur-authz-00001" }));
  assert.equal(denied.status, 403);
  assert.equal(denied.body.post, undefined);
  currentUser = userA2; // same Brand, different user: never sees A's result
  const other = await create(form({ submissionId: "dur-authz-00001" }));
  assert.equal(other.status, 201);
  assert.notEqual(other.body.post.id, a.body.post.id);
  assert.equal(other.body.duplicateSubmission, undefined);
  // If the original post is no longer owned by this Brand, the replay never reveals it.
  currentUser = userA;
  await prisma.publishedPost.update({ where: { id: a.body.post.id }, data: { brandId: "bB" } });
  const hidden = await create(form({ submissionId: "dur-authz-00001" }));
  assert.equal(hidden.body.duplicateSubmission, true);
  assert.equal(hidden.body.post, null);
  assert.ok(!JSON.stringify(hidden.body).includes(a.body.post.id));
});

test("D10. crash after the post was saved (during media upload): duplicate reports the saved post, nothing re-run", async () => {
  let release;
  uploadGate = new Promise((r) => { release = r; });
  const first = create(form({ submissionId: "dur-crash-media1" }));
  assert.ok(await waitFor(async () => (await receiptOf("dur-crash-media1"))?.state === "saved"), "post + receipt committed together");
  resetInFlight(); // the original process "died"
  uploadGate = null;
  const dup = await create(form({ submissionId: "dur-crash-media1" }));
  assert.equal(dup.status, 200);
  assert.equal(dup.body.submission.state, "saved_incomplete");
  assert.match(dup.body.submission.message, /Nothing was resent/);
  assert.ok(dup.body.post?.id);
  assert.equal(await postCount(), 1);
  assert.equal(prod.requests.length, 0);
  assert.equal(uploads, 1, "no second upload");
  release(); await first; // let the stuck original finish for cleanup
});

test("D11/D12/D13. crash after the production attempt was recorded: uncertain status, never resent", async () => {
  prod.behaviour = () => {}; // n8n never answers (request delivered, no response)
  const first = create(form({ submissionId: "dur-uncertain-1" }));
  assert.ok(await waitFor(async () => prod.requests.length === 1));
  const r = await receiptOf("dur-uncertain-1");
  const saved = await prisma.publishedPost.findUnique({ where: { id: r.postId } });
  assert.ok(saved.productionDeliveryAttemptedAt, "attempt recorded before the request");
  resetInFlight(); // the original process "died" waiting for n8n
  const dup = await create(form({ submissionId: "dur-uncertain-1" }));
  assert.equal(dup.body.submission.state, "delivery_uncertain");
  assert.match(dup.body.submission.message, /n8n may have received it/);
  assert.equal(prod.requests.length, 1, "duplicate never resends");
  // The original then fails without a response (network error): recorded, still not resent.
  for (const s of prod.sockets) s.destroy();
  const done = await first;
  assert.equal(done.body.webhookResult.success, false);
  const again = await create(form({ submissionId: "dur-uncertain-1" }));
  assert.equal(again.body.submission.state, "completed");
  assert.equal(again.body.submission.outcome.webhook.success, false);
  assert.equal(prod.requests.length, 1);
  assert.equal(await postCount(), 1);
});

test("D-stale. a reservation abandoned before any post was saved is taken over once (crash stage A)", async () => {
  const fd = form({ submissionId: "dur-stale-00001" });
  const digest = await guard.formDataFingerprint(fd);
  const scopeKey = receipts.submissionScopeKey({ userId: "ua", brandId: "bA", operation: "create", submissionId: "dur-stale-00001" });
  await prisma.$executeRawUnsafe(`INSERT INTO "PublishedPostSubmission" (id, scopeKey, requestDigest, state, createdAt, updatedAt) VALUES ('stale1', ?, ?, 'processing', ?, ?)`,
    scopeKey, digest, new Date(Date.now() - 20 * 60e3).toISOString(), new Date(Date.now() - 20 * 60e3).toISOString());
  const r = await create(form({ submissionId: "dur-stale-00001" }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(await postCount(), 1);
  assert.equal((await receiptOf("dur-stale-00001")).state, "completed");
});

test("D-expiry. receipts older than 30 days are pruned (bounded growth)", async () => {
  await prisma.$executeRawUnsafe(`INSERT INTO "PublishedPostSubmission" (id, scopeKey, requestDigest, state, createdAt, updatedAt) VALUES ('old1', 'oldkey', 'd', 'completed', ?, ?)`,
    new Date(Date.now() - 31 * 86400e3).toISOString(), new Date().toISOString());
  await create(form({ submissionId: "dur-prune-00001", mode: "save_only" }));
  assert.equal(await prisma.publishedPostSubmission.count({ where: { id: "old1" } }), 0);
  assert.equal(await prisma.publishedPostSubmission.count(), 1);
});

test("D14. existing clients without submission ids are unchanged", async () => {
  await create(form({}));
  await create(form({}));
  assert.equal(await postCount(), 2);
  assert.equal(prod.requests.length, 2);
  assert.equal(await prisma.publishedPostSubmission.count(), 0);
});

test("D15. a failed trial is retried on the saved post (no duplicate post)", async () => {
  uploadMode = "fail";
  const fd = form({ mode: "trial", submissionId: "dur-trial-00001" });
  fd.delete("publishingMode"); fd.delete("submissionId");
  const { token } = await (await confirmRoute.POST(jsonReq({ binding: await pm.uploadTrialBinding("bA", fd) }), ctx("bA"))).json();
  const submit = () => { const x = form({ mode: "trial", submissionId: "dur-trial-00001" }); x.append("trialConfirmation", token); return create(x); };
  const a = await submit();
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.trial.code, "REMOTE_MEDIA_UPLOAD_FAILED");
  const dup = await submit();
  assert.equal(dup.body.duplicateSubmission, true);
  uploadMode = "ok";
  const pf = await (await trialRoute.GET(new Request("http://x"), ctx("bA", a.body.post.id))).json();
  const res = await trialRoute.POST(jsonReq({ uploadMedia: true, confirmFingerprint: pf.fingerprint }), ctx("bA", a.body.post.id));
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  assert.equal(await postCount(), 1);
  assert.equal(trial.requests.length, 1);
  assert.equal(prod.requests.length, 0);
});
