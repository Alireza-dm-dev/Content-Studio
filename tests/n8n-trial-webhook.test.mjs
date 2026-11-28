// n8n Trial Send: isolation, payload equality, authorization, settings security,
// destination policy, bounded transport.
//
// Real: trial + production send routes, settings routes, lib/brand-access,
// payload builder, legacy LinkedIn adapter, trial transport (real sockets).
// Mocked: prisma (in-memory), session user, remote media upload (counted).
// Two SEPARATE local listeners: production and trial. Every trial test asserts
// the production listener received nothing.
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
  const l = { requests: [], behaviour: null };
  l.server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      l.requests.push({ url: req.url, headers: req.headers, raw });
      const b = l.behaviour;
      if (b) return b(req, res, raw);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ received: true, mode: req.headers["x-content-studio-mode"] || null }));
    });
  });
  return l;
}
const prod = listener();
const trial = listener();
const del = listener();
for (const l of [prod, trial, del]) await new Promise((r) => l.server.listen(0, "127.0.0.1", r));
after(() => { for (const l of [prod, trial, del]) l.server.close(); });
const PROD_URL = `http://127.0.0.1:${prod.server.address().port}/webhook/publish`;
const DELETE_URL = `http://127.0.0.1:${del.server.address().port}/webhook/delete`;
const TRIAL_URL = `http://127.0.0.1:${trial.server.address().port}/webhook-test/Publish-Trial`;
process.env.N8N_PUBLISHED_POST_WEBHOOK_URL = PROD_URL;
process.env.N8N_PUBLISHED_POST_DELETE_WEBHOOK_URL = DELETE_URL;

// ── In-memory data ───────────────────────────────────────────────────────────
const admin = { id: "admin", role: "admin" };
const userA = { id: "ua", role: "user" };
const userB = { id: "ub", role: "user" };
let currentUser;
let db;
let writes;
let uploads;
function reset() {
  db = {
    settings: new Map(),
    brands: [
      { id: "bA", name: "Knight London", timezone: "Europe/London" },
      { id: "bB", name: "Other Brand", timezone: null },
    ],
    memberships: [{ userId: "ua", brandId: "bA" }, { userId: "ub", brandId: "bB" }],
    posts: new Map(),
    collaborators: [],
  };
  writes = [];
  uploads = 0;
  for (const l of [prod, trial, del]) { l.requests.length = 0; l.behaviour = null; }
  currentUser = userA;
}
reset();
const brandOf = (id) => db.brands.find((b) => b.id === id) || null;
const withInc = (p, include) => {
  if (!p) return null;
  const o = { ...p, media: [...(p.media || [])] };
  if (include?.brand) { const b = brandOf(p.brandId); o.brand = b ? { id: b.id, name: b.name, timezone: b.timezone } : null; }
  return o;
};
const prisma = {
  settings: {
    findUnique: async ({ where }) => (db.settings.has(where.key) ? { key: where.key, value: db.settings.get(where.key) } : null),
    findMany: async ({ where } = {}) =>
      [...db.settings.entries()].filter(([k]) => !where?.key?.in || where.key.in.includes(k)).map(([key, value]) => ({ key, value })),
    upsert: async ({ where, update }) => { writes.push(`settings:${where.key}`); db.settings.set(where.key, update.value); return { key: where.key, value: update.value }; },
    deleteMany: async ({ where }) => { writes.push(`settings-del:${where.key}`); return { count: db.settings.delete(where.key) ? 1 : 0 }; },
  },
  brand: { findUnique: async ({ where }) => brandOf(where.id) },
  brandMembership: {
    findUnique: async ({ where }) => db.memberships.find((m) => m.userId === where.userId_brandId.userId && m.brandId === where.userId_brandId.brandId) ? { id: "m" } : null,
    findMany: async ({ where }) => db.memberships.filter((m) => m.userId === where.userId),
  },
  brandAssignment: { findUnique: async () => null, findMany: async () => [] },
  publishedPost: {
    findUnique: async ({ where, include }) => withInc(db.posts.get(where.id), include),
    findFirst: async ({ where, include }) => withInc(db.posts.get(where.id), include),
    findMany: async () => { writes.push("post:findMany"); return []; },
    update: async ({ where, data }) => { writes.push("post:update"); const p = { ...db.posts.get(where.id), ...data }; db.posts.set(where.id, p); return p; },
    create: async () => { writes.push("post:create"); throw new Error("no create in trial tests"); },
    deleteMany: async () => { writes.push("post:deleteMany"); return { count: 0 }; },
  },
  publishedPostCollaborator: {
    findFirst: async ({ where }) => db.collaborators.find((c) => c.publishedPostId === where.publishedPostId && c.brandId === where.brandId) || null,
  },
  $transaction: async (ops) => (Array.isArray(ops) ? Promise.all(ops) : ops(prisma)),
};
mock.module("@/lib/prisma", { exports: { prisma } });
mock.module("@/lib/auth", {
  exports: {
    getCurrentUser: async () => currentUser,
    getAdminAccess: async () =>
      !currentUser ? { user: null, error: "Authentication required", status: 401 }
        : currentUser.role !== "admin" ? { user: null, error: "Admin access required", status: 403 }
          : { user: currentUser, error: null, status: 200 },
    SESSION_COOKIE_NAME: "content_studio_session",
  },
});
mock.module("@/lib/published-post-remote-media", {
  exports: {
    uploadPublishedPostMedia: async () => { uploads += 1; return { success: false, detailCode: "MOCK", error: "mocked" }; },
    isCanonicalMediaUrl: (u) => typeof u === "string" && u.startsWith(PUBLIC),
    getEnvConfig: () => ({}),
  },
});

const utils = await import("../lib/published-post-utils.js");
const trialLib = await import("../lib/n8n-trial-webhook.js");
const trialRoute = await import("../app/api/brands/[id]/published-posts/[postId]/trial-webhook/route.js");
const sendRoute = await import("../app/api/brands/[id]/published-posts/[postId]/send-webhook/route.js");
const settingsN8n = await import("../app/api/settings/n8n/route.js");
const settingsGeneric = await import("../app/api/settings/route.js");

// ── Helpers ──────────────────────────────────────────────────────────────────
const ctx = (id, postId) => ({ params: Promise.resolve({ id, postId }) });
// Like the UI: read the confirmation (preflight) first, then send its fingerprint.
async function runTrial(postId, body = {}, brandId = "bA") {
  if (!("confirmFingerprint" in body)) {
    const pf = await trialRoute.GET(new Request("http://x"), ctx(brandId, postId));
    const pj = await pf.json();
    body = { ...body, confirmFingerprint: pj.fingerprint };
  }
  const res = await trialRoute.POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), ctx(brandId, postId));
  return { status: res.status, body: await res.json(), cache: res.headers.get("cache-control") };
}
async function preflight(postId, brandId = "bA") {
  const res = await trialRoute.GET(new Request("http://x"), ctx(brandId, postId));
  return { status: res.status, body: await res.json() };
}
async function prodSend(postId) {
  const res = await sendRoute.POST(new Request("http://x", { method: "POST" }), ctx("bA", postId));
  return { status: res.status, body: await res.json() };
}
async function putSettings(body) {
  const res = await settingsN8n.PUT(new Request("http://x", { method: "PUT", body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}
async function getSettings() {
  const res = await settingsN8n.GET();
  return { status: res.status, body: await res.json() };
}
function configureTrial(extra = {}) {
  db.settings.set(trialLib.TRIAL_URL_KEY, TRIAL_URL);
  for (const [k, v] of Object.entries(extra)) db.settings.set(k, v);
}

const TIME = ["Scheduled Date", "scheduled_date_utc", "brand_timezone", "brand_local_publish_datetime"];
const tf = (p) => Object.fromEntries(TIME.map((k) => [k, p?.[k]]));

let seq = 0;
function seedPost({ platform = "Instagram", postType = "static", media, scheduledDate = "2026-11-25T12:00:00.000Z", brandId = "bA", publicMedia = true, extraPayload = {} } = {}) {
  const id = `p${++seq}`;
  const n = 20 + seq;
  const base = publicMedia ? `${PUBLIC}POST-00${n}/` : `/uploads/${brandId}/published-posts/${id}/`;
  const rows = (media || [{ mediaType: "IMAGE", name: "a.png" }]).map((m, i) => ({ id: `${id}m${i}`, order: i + 1, mediaType: m.mediaType, url: base + m.name, fileName: m.name }));
  const post = {
    id, brandId, platform, postType, status: "scheduled", caption: "Hello #trial", notes: "", postNumber: n,
    scheduledDate: scheduledDate ? new Date(scheduledDate) : null, thumbnailUrl: null,
    webhookSentAt: "2026-Nov-01 10:00", createdAt: new Date("2026-11-01T00:00:00Z"), updatedAt: new Date("2026-11-01T00:00:00Z"),
    media: rows,
  };
  const payload = { ...utils.buildN8nPayload({ ...post }, [...rows], brandOf(brandId).name, brandOf(brandId).timezone), ...extraPayload };
  post.jsonPayload = JSON.stringify(payload, null, 2);
  db.posts.set(id, post);
  return id;
}
const snapshot = () => JSON.stringify([...db.posts.entries()]);

beforeEach(reset);

// ── Isolation & functional ───────────────────────────────────────────────────
test("required example: London 25 Nov 2026 12:00 → only the trial listener, exact body, schedule fields", async () => {
  configureTrial();
  const id = seedPost({ platform: "LinkedIn" });
  const before = snapshot();
  const r = await runTrial(id);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.cache, /no-store/);
  assert.equal(trial.requests.length, 1);
  assert.equal(prod.requests.length, 0, "production received nothing");
  assert.equal(del.requests.length, 0, "delete webhook received nothing");
  const sent = trial.requests[0];
  assert.equal(sent.url, "/webhook-test/Publish-Trial", "path case preserved");
  assert.equal(sent.headers["x-content-studio-mode"], "trial");
  assert.equal(sent.headers["x-content-studio-trial-id"], r.body.result.trialId);
  assert.equal(sent.headers["content-type"], "application/json");
  assert.equal(sent.raw, r.body.result.requestBody, "inspector shows the exact bytes sent");
  assert.deepEqual(tf(JSON.parse(sent.raw)), {
    "Scheduled Date": "25/11/2026 05:00:00",
    scheduled_date_utc: "2026-11-25T12:00:00.000Z",
    brand_timezone: "Europe/London",
    brand_local_publish_datetime: "2026-11-25T12:00:00",
  });
  const res = r.body.result;
  assert.equal(res.outcome, "http_accepted");
  assert.equal(res.label, "HTTP accepted");
  assert.equal(res.httpStatus, 200);
  assert.ok(!/publish(ed)?\b/i.test(res.label) && !/workflow completed/i.test(res.label));
  assert.match(res.hint, /does not show that the workflow completed/);
  assert.equal(res.postId, `POST-00${20 + seq}`);
  assert.equal(res.n8nScheduledDate, "25/11/2026 05:00:00");
  assert.equal(res.schedule.dateTime, "25 Nov 2026, 12:00");
  assert.ok(Number.isInteger(res.durationMs) && res.startedAt);
  // No mutation of any kind.
  assert.equal(snapshot(), before, "post unchanged (status, scheduledDate, jsonPayload, webhookSentAt, error log)");
  assert.deepEqual(writes, [], "no DB writes, no retention query");
  assert.equal(uploads, 0, "no media upload");
});

test("trial and production bodies are byte-identical for the same saved post; production unchanged", async () => {
  configureTrial();
  const cases = [
    { platform: "Instagram", postType: "static", media: [{ mediaType: "IMAGE", name: "a.png" }] },
    { platform: "Instagram", postType: "carousel", media: [{ mediaType: "IMAGE", name: "1.png" }, { mediaType: "IMAGE", name: "2.png" }, { mediaType: "VIDEO", name: "3.mp4" }] },
    { platform: "Instagram", postType: "reel", media: [{ mediaType: "VIDEO", name: "r.mp4" }] },
    { platform: "LinkedIn", postType: "static", media: [{ mediaType: "IMAGE", name: "li.png" }] },
    { platform: "LinkedIn", postType: "reel", media: [{ mediaType: "VIDEO", name: "li.mp4" }] },
    { platform: "LinkedIn", postType: "carousel", media: [{ mediaType: "document", name: "doc.pdf" }] },
    // Instagram → LinkedIn adapted post: stored payload carries the adapt metadata.
    { platform: "LinkedIn", postType: "static", media: [{ mediaType: "IMAGE", name: "ad.png" }], extraPayload: { _crossPlatformSource: { postId: "src", platform: "Instagram", adaptedAt: "2026-11-23T12:05:00.000Z" } } },
    { platform: "Instagram", postType: "static", scheduledDate: null },
  ];
  for (const c of cases) {
    reset(); configureTrial();
    const id = seedPost(c);
    const label = `${c.platform} ${c.postType}${c.extraPayload ? " adapted" : ""}${c.scheduledDate === null ? " unscheduled" : ""}`;
    const t = await runTrial(id);
    assert.equal(t.status, 200, `${label}: ${JSON.stringify(t.body)}`);
    assert.equal(prod.requests.length, 0, `${label}: production untouched by trial`);
    const p = await prodSend(id);
    assert.equal(p.status, 200, `${label}: production send ${JSON.stringify(p.body)}`);
    assert.equal(prod.requests.length, 1, `${label}: production send still works`);
    assert.equal(trial.requests.length, 1, `${label}: production send never hits trial`);
    assert.equal(trial.requests[0].raw, prod.requests[0].raw, `${label}: identical serialized body`);
    assert.ok(!("x-content-studio-mode" in prod.requests[0].headers), `${label}: production has no trial header`);
    const body = JSON.parse(trial.requests[0].raw);
    assert.deepEqual(tf(body), tf(JSON.parse(prod.requests[0].raw)), label);
    if (c.scheduledDate === null) {
      assert.deepEqual(tf(body), { "Scheduled Date": "", scheduled_date_utc: "", brand_timezone: "Europe/London", brand_local_publish_datetime: "" }, label);
      assert.equal(t.body.result.schedule.scheduled, false);
    }
    if (c.postType === "carousel" && c.platform === "LinkedIn") {
      // Legacy PDF adapter applied exactly as in production.
      assert.equal(body.Platform, "Linkedin");
      assert.deepEqual(body.files, [{ media_type: "IMAGE", image_url: `${PUBLIC}POST-00${20 + seq}/doc.pdf` }]);
      assert.equal(body.media_url, `${PUBLIC}POST-00${20 + seq}/doc.pdf`);
    }
    if (c.platform === "Instagram" && c.postType === "carousel") {
      assert.deepEqual(body.media.map((m) => m.order), [1, 2, 3], "media order");
      assert.equal(body.is_carousel, true);
    }
    if (c.extraPayload) assert.deepEqual(body._crossPlatformSource, c.extraPayload._crossPlatformSource);
    assert.equal(body["Webhook Sent At"], "2026-Nov-01 10:00", `${label}: no trial-time substitution`);
  }
});

test("missing / invalid / production-identical trial destination: nothing sent anywhere", async () => {
  const id = seedPost();
  let r = await runTrial(id);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "TRIAL_NOT_CONFIGURED");
  const pf = await preflight(id);
  assert.deepEqual([pf.status, pf.body.ready, pf.body.configured, pf.body.message], [200, false, false, "Trial webhook is not configured."]);

  db.settings.set(trialLib.TRIAL_URL_KEY, "not a url");
  r = await runTrial(id);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "TRIAL_URL_INVALID");

  for (const same of [PROD_URL, PROD_URL + "/", PROD_URL.replace("http://", "HTTP://"), DELETE_URL]) {
    db.settings.set(trialLib.TRIAL_URL_KEY, same);
    r = await runTrial(id);
    assert.equal(r.status, 409, same);
    assert.equal(r.body.code, "TRIAL_URL_IS_PRODUCTION", same);
  }
  assert.equal(trial.requests.length + prod.requests.length + del.requests.length, 0);
});

test("send-time revalidation: production later set to the trial URL → refused, nothing sent", async () => {
  configureTrial();
  const id = seedPost();
  assert.equal((await runTrial(id)).status, 200);
  db.settings.set("N8N_PUBLISHED_POST_WEBHOOK_URL", TRIAL_URL); // production changed afterwards
  const r = await runTrial(id);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "TRIAL_URL_IS_PRODUCTION");
  assert.equal(trial.requests.length, 1, "only the earlier, valid trial");
  assert.equal(prod.requests.length, 0);
});

test("failed trial (HTTP errors, redirect) never falls back to production", async () => {
  configureTrial();
  const id = seedPost();
  for (const [status, outcome, hint] of [[400, "http_rejected", /invalid/], [401, "http_rejected", /authentication/], [403, "http_rejected", /allowlist/], [404, "http_rejected", /Listen for test event/], [429, "http_rejected", /rate limiting/], [500, "http_rejected", /server error/], [502, "http_rejected", /server error/], [503, "http_rejected", /server error/]]) {
    trial.behaviour = (req, res) => { res.writeHead(status, { "content-type": "text/plain" }); res.end(`status ${status}`); };
    const r = await runTrial(id);
    assert.equal(r.status, 200);
    assert.equal(r.body.result.outcome, outcome, String(status));
    assert.equal(r.body.result.httpStatus, status);
    assert.match(r.body.result.hint, hint, String(status));
  }
  // Redirect to production: reported, never followed.
  trial.behaviour = (req, res) => { res.writeHead(307, { location: PROD_URL }); res.end(); };
  const r = await runTrial(id);
  assert.equal(r.body.result.outcome, "redirect_blocked");
  assert.equal(r.body.result.label, "Redirect blocked");
  assert.equal(prod.requests.length, 0, "redirect not followed to production");
});

test("network failure and empty / non-JSON / hostile responses are reported safely", async () => {
  configureTrial();
  const id = seedPost();
  trial.behaviour = (req, res) => { res.writeHead(200); res.end(); };
  let r = await runTrial(id);
  assert.deepEqual([r.body.result.outcome, r.body.result.responseEmpty, r.body.result.responseIsJson], ["http_accepted", true, false]);
  const hostile = "<script>alert(1)</script><img src=x onerror=alert(2)>";
  trial.behaviour = (req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(hostile); };
  r = await runTrial(id);
  assert.equal(r.body.result.responseText, hostile, "returned verbatim as text for a <pre>");
  assert.equal(r.body.result.responseIsJson, false);
  const ui = readFileSync(new URL("../components/TrialSendSection.jsx", import.meta.url), "utf8");
  assert.ok(!ui.includes("dangerouslySetInnerHTML"), "response is never rendered as HTML");
  assert.match(ui, /data-testid="trial-response"/);

  // Nothing listening on the trial port → network failure, no fallback.
  const dead = http.createServer();
  await new Promise((res) => dead.listen(0, "127.0.0.1", res));
  const deadUrl = `http://127.0.0.1:${dead.server?.address?.()?.port ?? dead.address().port}/webhook-test/x`;
  await new Promise((res) => dead.close(res));
  db.settings.set(trialLib.TRIAL_URL_KEY, deadUrl);
  r = await runTrial(id);
  assert.equal(r.body.result.outcome, "network_failure");
  assert.match(r.body.result.hint, /not known whether n8n received it/);
  assert.equal(prod.requests.length, 0);
});

test("timeout and bounded streaming (transport level)", async () => {
  // Never responds → timeout, and the result says n8n may still have processed it.
  const hang = http.createServer(() => {});
  await new Promise((r) => hang.listen(0, "127.0.0.1", r));
  const url = new URL(`http://127.0.0.1:${hang.address().port}/x`);
  let raw = await trialLib.sendPinnedRequest({ url, address: "127.0.0.1", family: 4, headers: {}, body: "{}", timeoutMs: 150 });
  assert.equal(raw.kind, "timeout");
  const t = trialLib.interpretTrialOutcome(raw);
  assert.equal(t.outcome, "timeout");
  assert.match(t.hint, /may still have received and processed/);
  hang.closeAllConnections?.();
  hang.close();

  // Endless response stream: reading stops at the cap (not buffered then truncated).
  let written = 0;
  const flood = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    const chunk = Buffer.alloc(8192, 97);
    const tick = () => { if (res.destroyed || written > 50 * 1024 * 1024) return; written += chunk.length; if (res.write(chunk)) setImmediate(tick); else res.once("drain", tick); };
    tick();
  });
  await new Promise((r) => flood.listen(0, "127.0.0.1", r));
  raw = await trialLib.sendPinnedRequest({ url: new URL(`http://127.0.0.1:${flood.address().port}/x`), address: "127.0.0.1", family: 4, headers: {}, body: "{}", timeoutMs: 5000 });
  assert.equal(raw.kind, "response");
  assert.equal(raw.truncated, true);
  assert.equal(raw.buffer.length, trialLib.TRIAL_MAX_RESPONSE_BYTES);
  assert.ok(written < 50 * 1024 * 1024, "stream aborted long before the server's 50 MB");
  const out = trialLib.interpretTrialOutcome(raw);
  assert.deepEqual([out.outcome, out.label, out.responseTruncated], ["response_truncated", "HTTP accepted — response truncated", true]);
  flood.closeAllConnections?.();
  flood.close();
});

test("concurrent duplicate trial for the same post is refused (process-local lock)", async () => {
  configureTrial();
  const id = seedPost();
  trial.behaviour = (req, res) => setTimeout(() => { res.writeHead(200); res.end("{}"); }, 250);
  const [a, b] = await Promise.all([runTrial(id), runTrial(id)]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  assert.equal([a, b].find((x) => x.status === 409).body.code, "TRIAL_ALREADY_RUNNING");
  assert.equal(trial.requests.length, 1);
  assert.equal((await runTrial(id)).status, 200, "lock released afterwards");
});

test("payload-only trial: listed media, explicit confirmation, nothing uploaded or rewritten", async () => {
  configureTrial();
  const id = seedPost({ publicMedia: false, media: [{ mediaType: "IMAGE", name: "1.png" }, { mediaType: "IMAGE", name: "2.png" }] });
  const before = snapshot();
  const pf = await preflight(id);
  assert.ok(pf.body.unavailableMedia.length >= 2, JSON.stringify(pf.body.unavailableMedia));
  assert.ok(pf.body.unavailableMedia.includes("files[0].image_url"));
  let r = await runTrial(id);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "PAYLOAD_ONLY_CONFIRMATION_REQUIRED");
  assert.equal(trial.requests.length, 0);
  r = await runTrial(id, { payloadOnly: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.result.payloadOnly, true);
  assert.deepEqual(r.body.result.unavailableMedia, pf.body.unavailableMedia);
  const sent = JSON.parse(trial.requests[0].raw);
  assert.equal(sent.files.length, 2, "media fields kept, not removed");
  assert.ok(sent.files[0].image_url.startsWith("/uploads/"), "URLs not rewritten");
  assert.equal(uploads, 0);
  assert.equal(snapshot(), before);
  assert.equal(prod.requests.length, 0);
});

test("private filesystem paths / credentials in the payload block the trial", async () => {
  configureTrial();
  for (const [field, value] of [["data", "/Users/someone/secret.txt"], ["output", "file:///etc/passwd"], ["Notes", "https://user:pw@files.example.test/x"], ["data", `${process.cwd()}/public/uploads/a.png`]]) {
    reset(); configureTrial();
    const id = seedPost({ extraPayload: { [field]: value } });
    const r = await runTrial(id, { payloadOnly: true });
    assert.equal(r.status, 422, `${field}=${value}`);
    assert.equal(r.body.code, "TRIAL_PAYLOAD_BLOCKED");
    assert.ok(r.body.blockedFields.some((f) => f.field === field), JSON.stringify(r.body.blockedFields));
    assert.ok(!JSON.stringify(r.body).includes(value), "blocked value itself is not echoed");
    assert.equal(trial.requests.length, 0);
  }
});

// ── Header authentication & settings security ────────────────────────────────
test("settings: admin-only, masked, write-only secret, preserved/replaced/cleared, header auth delivered", async () => {
  const SECRET = "s3cr3t-trial-value-0123456789";
  currentUser = null;
  assert.equal((await getSettings()).status, 401);
  assert.equal((await putSettings({ url: TRIAL_URL })).status, 401);
  currentUser = userA;
  assert.equal((await getSettings()).status, 403);
  assert.equal((await putSettings({ url: TRIAL_URL })).status, 403);
  assert.equal(db.settings.size, 0);

  currentUser = admin;
  let r = await putSettings({ url: TRIAL_URL, authMode: "header", headerName: "X-N8N-Trial-Key", secret: SECRET });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.production.publish, "environment");
  assert.equal(r.body.production.delete, "environment");
  assert.equal(r.body.trial.configured, true);
  assert.equal(r.body.trial.maskedUrl, `http://127.0.0.1:${trial.server.address().port}/webhook-test/…`);
  assert.equal(r.body.trial.secretConfigured, true);
  const leaks = (o) => JSON.stringify(o).includes(SECRET) || JSON.stringify(o).includes("Publish-Trial");
  assert.ok(!leaks(r.body), "PUT response hides secret and full URL");
  assert.ok(!leaks((await getSettings()).body));
  const generic = await (await settingsGeneric.GET()).json();
  assert.ok(!leaks(generic) && !Object.keys(generic).some((k) => k.includes("TRIAL")), "generic GET omits trial keys");

  // Saving another setting keeps the secret.
  r = await putSettings({ headerName: "X-N8N-Trial-Key-2" });
  assert.equal(r.status, 200);
  assert.equal(db.settings.get(trialLib.TRIAL_HEADER_VALUE_KEY), SECRET);
  r = await putSettings({ url: TRIAL_URL.replace("Publish-Trial", "Other") });
  assert.equal(db.settings.get(trialLib.TRIAL_HEADER_VALUE_KEY), SECRET);
  r = await putSettings({ url: TRIAL_URL });

  // Header auth is delivered to the trial listener only; never in the result.
  currentUser = userA;
  const id = seedPost();
  trial.behaviour = (req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ echoed: req.headers["x-n8n-trial-key-2"] })); };
  const t = await runTrial(id);
  assert.equal(trial.requests[0].headers["x-n8n-trial-key-2"], SECRET);
  assert.ok(!JSON.stringify(t.body).includes(SECRET), "secret not in result (echo redacted)");
  assert.match(t.body.result.responseText, /\[redacted\]/);
  assert.equal(prod.requests.length, 0);
  const p = await prodSend(id);
  assert.equal(p.status, 200);
  assert.ok(!Object.values(prod.requests[0].headers).includes(SECRET), "secret never sent to production");

  // Replace, then clear.
  currentUser = admin;
  r = await putSettings({ secret: "another-secret-value-987654" });
  assert.equal(db.settings.get(trialLib.TRIAL_HEADER_VALUE_KEY), "another-secret-value-987654");
  r = await putSettings({ clearSecret: true });
  assert.equal(r.status, 400, "header auth without a secret is an invalid effective config");
  assert.equal(db.settings.get(trialLib.TRIAL_HEADER_VALUE_KEY), "another-secret-value-987654", "nothing partially saved");
  r = await putSettings({ clearSecret: true, authMode: "none" });
  assert.equal(r.status, 200);
  assert.equal(db.settings.has(trialLib.TRIAL_HEADER_VALUE_KEY), false);
  assert.equal(r.body.trial.secretConfigured, false);
  r = await putSettings({ url: "" });
  assert.equal(r.body.trial.configured, false);
  assert.equal(db.settings.has(trialLib.TRIAL_URL_KEY), false, "cleared");
});

test("settings validation: header names, injection, URLs; generic writes cannot bypass", async () => {
  currentUser = admin;
  const before = new Map(db.settings);
  for (const name of ["Host", "content-length", "Transfer-Encoding", "Connection", "Cookie", "X-Content-Studio-Mode", "x-content-studio-trial-id", "Proxy-Authorization", "Sec-Fetch-Mode", "Bad Name", "X:Y", "", "Ünïcode"]) {
    const r = await putSettings({ url: TRIAL_URL, authMode: "header", headerName: name, secret: "valid-secret-123" });
    assert.equal(r.status, 400, `header name ${JSON.stringify(name)}`);
  }
  for (const secret of ["a\r\nX-Injected: 1", "line\nbreak", "nul\u0000", " padded "]) {
    const r = await putSettings({ url: TRIAL_URL, authMode: "header", headerName: "X-Key", secret });
    assert.equal(r.status, 400, `secret ${JSON.stringify(secret)}`);
  }
  for (const url of [PROD_URL, DELETE_URL, `${PROD_URL}/`, "https://user:pw@n8n.example.com/webhook-test/x", "https://n8n.example.com/webhook-test/x#frag", "ftp://n8n.example.com/x", "javascript:alert(1)"]) {
    const r = await putSettings({ url });
    assert.equal(r.status, 400, url);
  }
  assert.deepEqual([...db.settings.entries()], [...before.entries()], "nothing saved by any rejected request");

  // Generic settings route cannot write trial keys.
  for (const key of trialLib.TRIAL_SETTING_KEYS) {
    const res = await settingsGeneric.POST(new Request("http://x", { method: "POST", body: JSON.stringify({ key, value: PROD_URL }) }));
    assert.equal(res.status, 400, key);
    assert.equal((await res.json()).code, "USE_N8N_SETTINGS_ENDPOINT");
  }
  assert.equal(db.settings.size, 0);
  // Other keys still work as before.
  const ok = await settingsGeneric.POST(new Request("http://x", { method: "POST", body: JSON.stringify({ key: "SOMETHING_ELSE", value: "1" }) }));
  assert.equal(ok.status, 200);
});

// ── Destination policy (no test exception) ──────────────────────────────────
test("destination policy: approved host, public DNS only, IP forms, schemes, path case", async () => {
  const saved = { policy: process.env.N8N_TRIAL_WEBHOOK_TEST_POLICY, publish: process.env.N8N_PUBLISHED_POST_WEBHOOK_URL, del: process.env.N8N_PUBLISHED_POST_DELETE_WEBHOOK_URL };
  delete process.env.N8N_TRIAL_WEBHOOK_TEST_POLICY;
  process.env.N8N_PUBLISHED_POST_WEBHOOK_URL = "https://n8n.example.com/webhook/Publish";
  process.env.N8N_PUBLISHED_POST_DELETE_WEBHOOK_URL = "https://n8n.example.com/webhook/delete";
  const resolveTo = (...addrs) => async () => addrs.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  const v = (url, resolve = resolveTo("93.184.216.34")) => trialLib.validateTrialDestination(url, { resolve });
  try {
    assert.equal((await v("https://n8n.example.com/webhook-test/Publish")).ok, true, "same workflow's Test URL allowed");
    assert.equal((await v("https://n8n.example.com/webhook/publish")).ok, true, "path case is significant (differs from /Publish)");
    for (const same of ["https://N8N.EXAMPLE.COM/webhook/Publish", "https://n8n.example.com:443/webhook/Publish", "https://n8n.example.com/webhook/Publish/", "https://n8n.example.com/webhook/delete"]) {
      assert.equal((await v(same)).code, "TRIAL_URL_IS_PRODUCTION", same);
    }
    assert.equal((await v("https://evil.example.org/webhook-test/x")).code, "TRIAL_URL_HOST_NOT_ALLOWED");
    for (const ipUrl of ["https://127.0.0.1/x", "https://2130706433/x", "https://0x7f.0.0.1/x", "https://[::1]/x", "https://169.254.169.254/latest", "https://[::ffff:127.0.0.1]/x"]) {
      assert.equal((await v(ipUrl)).ok, false, ipUrl);
    }
    for (const addr of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:10.0.0.1", "::ffff:7f00:1", "::7f00:1", "::", "64:ff9b::a00:1", "224.0.0.1", "2001:db8::1"]) {
      assert.equal((await v("https://n8n.example.com/webhook-test/x", resolveTo(addr))).code, "TRIAL_URL_UNSAFE_ADDRESS", addr);
    }
    assert.equal((await v("https://n8n.example.com/webhook-test/x", resolveTo("93.184.216.34", "10.0.0.1"))).code, "TRIAL_URL_UNSAFE_ADDRESS", "any private answer rejects (rebinding)");
    const pinned = await v("https://n8n.example.com/webhook-test/x", resolveTo("93.184.216.34"));
    assert.equal(pinned.address, "93.184.216.34", "connection pinned to the validated address");
    assert.equal((await v("https://n8n.example.com/x", async () => { throw new Error("ENOTFOUND"); })).code, "TRIAL_URL_DNS_FAILED");
    assert.equal((await v("http://n8n.example.com/webhook-test/x")).code, "TRIAL_URL_INVALID", "https only");
    assert.equal((await v("http://127.0.0.1:9/x")).ok, false, "no loopback without the test policy");
    process.env.N8N_TRIAL_WEBHOOK_ALLOWED_HOSTS = "diag.example.net";
    assert.equal((await v("https://diag.example.net/webhook/diagnostic")).ok, true, "server-side allowlist");
    delete process.env.N8N_TRIAL_WEBHOOK_ALLOWED_HOSTS;
    // The test policy is refused in production.
    process.env.N8N_TRIAL_WEBHOOK_TEST_POLICY = "allow-loopback";
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    assert.equal((await v("http://127.0.0.1:9/x")).ok, false, "loopback exception never in production");
    process.env.NODE_ENV = env;
  } finally {
    process.env.N8N_TRIAL_WEBHOOK_TEST_POLICY = saved.policy;
    process.env.N8N_PUBLISHED_POST_WEBHOOK_URL = saved.publish;
    process.env.N8N_PUBLISHED_POST_DELETE_WEBHOOK_URL = saved.del;
  }
});

// ── Authorization ────────────────────────────────────────────────────────────
test("authorization matrix; client cannot choose destination or payload; no credentials returned", async () => {
  configureTrial({ [trialLib.TRIAL_AUTH_MODE_KEY]: "header", [trialLib.TRIAL_HEADER_NAME_KEY]: "X-Key", [trialLib.TRIAL_HEADER_VALUE_KEY]: "hidden-secret-xyz-123" });
  const id = seedPost();
  const shared = seedPost();
  db.collaborators.push({ publishedPostId: shared, brandId: "bB" });

  currentUser = null;
  assert.equal((await runTrial(id)).status, 401);
  assert.equal((await preflight(id)).status, 401);
  currentUser = admin;
  assert.equal((await runTrial(id)).status, 200, "admin allowed");
  currentUser = userA;
  assert.equal((await runTrial(id)).status, 200, "owning-brand member allowed");
  currentUser = userB;
  assert.equal((await runTrial(id)).status, 403, "unrelated brand user denied");
  assert.equal((await runTrial(id, {}, "bB")).status, 404, "post not in that brand");
  assert.equal((await runTrial(shared, {}, "bB")).status, 403, "collaborator-only denied");
  assert.equal((await preflight(shared, "bB")).status, 403);
  currentUser = userA;
  assert.equal((await runTrial("guessed-id")).status, 404);

  // Overrides in the body are ignored: destination and payload are server-side.
  trial.requests.length = 0;
  const r = await runTrial(id, { url: PROD_URL, destination: PROD_URL, payload: { "Scheduled Date": "01/01/2000 00:00:00" }, headers: { Host: "evil" }, body: "x" });
  assert.equal(r.status, 200);
  assert.equal(trial.requests.length, 1);
  assert.equal(prod.requests.length, 0);
  assert.equal(JSON.parse(trial.requests[0].raw)["Scheduled Date"], "25/11/2026 05:00:00");
  const text = JSON.stringify(r.body) + JSON.stringify((await preflight(id)).body);
  assert.ok(!text.includes("hidden-secret-xyz-123"), "secret never returned");
  assert.ok(!text.includes("Publish-Trial"), "trial URL never returned to users");
  assert.ok(!text.includes(PROD_URL) && !text.includes("X-Key"), "no production URL or auth header name");
  assert.equal(prod.requests.length, 0, "production received zero requests in this test");
});

test("trial never touches create/edit/adapt/status/thumbnail/Today/preview paths", () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  for (const f of [
    "app/api/brands/[id]/published-posts/route.js",
    "app/api/brands/[id]/published-posts/[postId]/route.js",
    "app/api/brands/[id]/published-posts/[postId]/adapt/route.js",
    "app/api/brands/[id]/published-posts/[postId]/thumbnail/route.js",
    "app/api/brands/[id]/published-posts/[postId]/payload/route.js",
    "app/api/brands/[id]/published-posts/[postId]/send-webhook/route.js",
    "lib/today.js",
    "lib/published-post-webhook.js",
  ]) {
    assert.ok(!/trial/i.test(read(f).replace(/buildOutboundPublishBody[^\n]*|The trial send serializes through the same function\.|production send and the trial send/g, "")), `${f} must not reference trial sending`);
  }
  const ui = read("components/TrialSendSection.jsx");
  assert.match(ui, /onClick=\{openConfirm\}/, "trial starts only from an explicit click");
  assert.match(ui, /disabled=\{!ready \|\| running \|\| Boolean\(confirm\)\}/, "button disabled while running (duplicate clicks)");
  assert.ok(!/useEffect\([^)]*method: "POST"/s.test(ui.split("async function run")[0]), "no POST on mount");
});

// ══ Final security audit regressions ═════════════════════════════════════════
import tls from "node:tls";
import https from "node:https";
import dnsMod from "node:dns";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync as readF, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("audit: production-equivalent URL forms cannot bypass the production check", async () => {
  const saved = { policy: process.env.N8N_TRIAL_WEBHOOK_TEST_POLICY, publish: process.env.N8N_PUBLISHED_POST_WEBHOOK_URL, del: process.env.N8N_PUBLISHED_POST_DELETE_WEBHOOK_URL };
  delete process.env.N8N_TRIAL_WEBHOOK_TEST_POLICY;
  process.env.N8N_PUBLISHED_POST_WEBHOOK_URL = "https://n8n.example.com/webhook/publish";
  process.env.N8N_PUBLISHED_POST_DELETE_WEBHOOK_URL = "https://n8n.example.com/webhook/delete";
  const v = (url) => trialLib.validateTrialDestination(url, { resolve: async () => [{ address: "93.184.216.34", family: 4 }] });
  try {
    for (const target of ["publish", "delete"]) {
      for (const form of [
        `https://N8N.Example.COM:443/webhook/${target}/`,
        `https://n8n.example.com/webhook/./x/../${target}`,
        `https://n8n.example.com/webhook/x/%2e%2e/${target}`,
        `https://n8n.example.com/webhook/%${target.charCodeAt(0).toString(16)}${target.slice(1)}`,
        `https://n8n.example.com/webhook/%25${target.charCodeAt(0).toString(16)}${target.slice(1)}`,
        `https://n8n.example.com/webhook%2F${target}`,
        `https://n8n.example.com/webhook/${target}%2F`,
        `https://n8n.example.com//webhook//${target}`,
        `https://n8n.example.com/webhook/${target}?anything=1`,
        `https://n8n.example.com/webhook\\${target}`,
      ]) {
        assert.equal((await v(form)).code, "TRIAL_URL_IS_PRODUCTION", form);
      }
    }
    // Trailing-dot host: equal to production AND not an approved host.
    assert.equal((await v("https://n8n.example.com./webhook/publish")).code, "TRIAL_URL_IS_PRODUCTION");
    assert.equal((await v("https://n8n.example.com./webhook/diag")).code, "TRIAL_URL_HOST_NOT_ALLOWED");
    // Legitimate destinations stay allowed.
    for (const ok of ["https://n8n.example.com/webhook-test/publish", "https://n8n.example.com/webhook/Publish", "https://n8n.example.com/webhook/diagnostic-trial", "https://n8n.example.com/webhook-test/delete"]) {
      assert.equal((await v(ok)).ok, true, ok);
    }
  } finally {
    process.env.N8N_TRIAL_WEBHOOK_TEST_POLICY = saved.policy;
    process.env.N8N_PUBLISHED_POST_WEBHOOK_URL = saved.publish;
    process.env.N8N_PUBLISHED_POST_DELETE_WEBHOOK_URL = saved.del;
  }
});

function makeCert(dir, cn) {
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, `${cn}.key`), "-out", join(dir, `${cn}.crt`), "-days", "1", "-subj", `/CN=${cn}`, "-addext", `subjectAltName=DNS:${cn}`], { stdio: "ignore" });
  return { key: readF(join(dir, `${cn}.key`)), cert: readF(join(dir, `${cn}.crt`), "utf8") };
}

test("audit: TLS verification on, SNI = configured host, cert hostname checked, connection pinned (no DNS)", async (t) => {
  let dir;
  let creds;
  try {
    dir = mkdtempSync(join(tmpdir(), "trial-tls-"));
    creds = makeCert(dir, "n8n.trial.test");
  } catch {
    t.skip("openssl not available");
    return;
  }
  const snis = [];
  const server = https.createServer({
    key: creds.key,
    cert: creds.cert,
    SNICallback: (name, cb) => { snis.push(name); cb(null, tls.createSecureContext({ key: creds.key, cert: creds.cert })); },
  }, (req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ host: req.headers.host })); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const lookups = [];
  const lookupSpy = mock.method(dnsMod, "lookup", (...a) => { lookups.push(a[0]); return a.at(-1)(new Error("unexpected DNS lookup")); });
  const send = (host) => trialLib.sendPinnedRequest({ url: new URL(`https://${host}:${port}/webhook-test/x`), address: "127.0.0.1", family: 4, headers: {}, body: "{}", timeoutMs: 5000 });
  const originalCAs = tls.getCACertificates("default");
  try {
    // 1. Untrusted self-signed certificate → refused (verification is ON).
    let r = await send("n8n.trial.test");
    assert.equal(r.kind, "network");
    assert.match(r.errorCode, /SELF_SIGNED|UNABLE_TO_VERIFY|CERT/);
    assert.ok(snis.includes("n8n.trial.test"), "SNI carried the configured host name");
    // 2. Trusted certificate for the right name → accepted over the pinned address.
    tls.setDefaultCACertificates([...originalCAs, creds.cert]);
    r = await send("n8n.trial.test");
    assert.equal(r.kind, "response", JSON.stringify(r));
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(r.buffer.toString()).host, `n8n.trial.test:${port}`, "Host header is the configured host");
    // 3. Trusted certificate, but for a different name → hostname check fails.
    r = await send("other.trial.test");
    assert.equal(r.kind, "network");
    assert.equal(r.errorCode, "ERR_TLS_CERT_ALTNAME_INVALID");
    assert.deepEqual(lookups, [], "no DNS lookup: '.test' names only work because the address is pinned");
  } finally {
    tls.setDefaultCACertificates(originalCAs);
    lookupSpy.mock.restore();
    server.closeAllConnections?.();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("audit: IPv6 pinned connection works separately from IPv4", async (t) => {
  const server = http.createServer((req, res) => { res.writeHead(200); res.end(req.headers.host); });
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "::1", resolve); });
  } catch {
    t.skip("IPv6 loopback not available");
    return;
  }
  const port = server.address().port;
  const r = await trialLib.sendPinnedRequest({ url: new URL(`http://n8n.v6.test:${port}/x`), address: "::1", family: 6, headers: {}, body: "{}", timeoutMs: 3000 });
  server.close();
  assert.equal(r.kind, "response");
  assert.equal(r.buffer.toString(), `n8n.v6.test:${port}`);
  assert.equal(trialLib.isForbiddenAddress("2606:4700::6810:84e5"), false, "public IPv6 allowed by the address policy");
  assert.equal(trialLib.isForbiddenAddress("::1"), true);
});

test("audit: secret never in any response (incl. encoded echoes, error bodies, content-type) or any log line", async () => {
  const SECRET = `Tr!al<Secret>&"q'z 12345`;
  const lines = [];
  const spies = ["log", "error", "warn", "info"].map((m) => mock.method(console, m, (...a) => lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "))));
  try {
    currentUser = admin;
    const put = await putSettings({ url: TRIAL_URL, authMode: "header", headerName: "X-Trial-Key", secret: SECRET });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    const bad = await putSettings({ secret: `${SECRET}\r\nX: y` });
    assert.equal(bad.status, 400);
    currentUser = userA;
    const id = seedPost();
    const encoded = [
      JSON.stringify({ echo: SECRET }),
      encodeURIComponent(SECRET),
      Buffer.from(SECRET).toString("base64"),
      Buffer.from(SECRET).toString("base64url"),
      SECRET.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"),
    ].join(" | ");
    const responses = [];
    for (const [status, ctype, body] of [[200, "text/plain", encoded], [401, "application/json", JSON.stringify({ message: `bad key ${SECRET}` })], [200, `text/plain; echo=${encodeURIComponent(SECRET)}`, "ok"]]) {
      trial.behaviour = (req, res) => { res.writeHead(status, { "content-type": ctype }); res.end(body); };
      const r = await runTrial(id);
      assert.equal(r.status, 200);
      responses.push(r.body);
    }
    assert.equal(trial.requests.at(-1).headers["x-trial-key"], SECRET, "delivered to the trial webhook");
    // Validation + transport errors.
    db.settings.set("N8N_PUBLISHED_POST_WEBHOOK_URL", TRIAL_URL); // make the trial URL "production"
    responses.push((await runTrial(id)).body);
    db.settings.delete("N8N_PUBLISHED_POST_WEBHOOK_URL");
    responses.push((await preflight(id)).body);
    responses.push(await (await settingsGeneric.GET()).json().catch(() => ({})));
    currentUser = admin;
    responses.push((await getSettings()).body);
    responses.push(await (await settingsGeneric.GET()).json());
    const all = JSON.stringify(responses) + lines.join("\n");
    for (const variant of trialLib.secretVariants(SECRET)) assert.ok(!all.includes(variant), `leaked variant ${variant}`);
    assert.ok(responses[0].result.responseText.includes("[redacted]"));
    assert.ok(!responses[0].result.requestBody.includes(SECRET), "never in the request body / inspector");
    // Never sent to production or delete webhooks.
    currentUser = userA;
    await prodSend(id);
    assert.ok(prod.requests.every((r) => !JSON.stringify(r.headers).includes(SECRET) && !r.raw.includes(SECRET)));
    assert.equal(del.requests.length, 0);
  } finally {
    spies.forEach((s) => s.mock.restore());
  }
});

test("audit: settings consistency — host change needs secret re-entry; URL replace keeps auth; atomic", async () => {
  currentUser = admin;
  const SECRET = "first-secret-value-123";
  assert.equal((await putSettings({ url: TRIAL_URL, authMode: "header", headerName: "X-K", secret: SECRET })).status, 200);
  // Same host, different path: auth kept as-is.
  let r = await putSettings({ url: TRIAL_URL.replace("Publish-Trial", "Diag") });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.trial.authMode, r.body.trial.headerName, r.body.trial.secretConfigured], ["header", "X-K", true]);
  // Different host (port) with the stored secret: refused, nothing changed.
  const otherHost = TRIAL_URL.replace(/127\.0\.0\.1:\d+/, `127.0.0.1:${del.server.address().port}`);
  const before = [...db.settings.entries()];
  r = await putSettings({ url: otherHost });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "TRIAL_SECRET_REENTRY_REQUIRED");
  assert.deepEqual([...db.settings.entries()], before, "atomic: nothing saved");
  // Re-entering the secret in the same request is accepted — even the same value.
  r = await putSettings({ url: otherHost, secret: SECRET });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await putSettings({ url: TRIAL_URL, secret: "second-secret-value-456" });
  assert.equal(r.status, 200);
  r = await putSettings({ url: otherHost, secret: "second-secret-value-456" });
  assert.equal(r.status, 200);
  // Clearing the URL disables trials; setting a URL again with a leftover secret requires re-entry.
  r = await putSettings({ url: "" });
  assert.equal(r.body.trial.configured, false);
  currentUser = userA;
  const id = seedPost();
  assert.equal((await runTrial(id)).body.code, "TRIAL_NOT_CONFIGURED");
  currentUser = admin;
  assert.equal((await putSettings({ url: TRIAL_URL })).body.code, "TRIAL_SECRET_REENTRY_REQUIRED");
  // Removing the secret is explicit and switches auth off (header auth can't be left unusable).
  assert.equal((await putSettings({ clearSecret: true })).status, 400);
  r = await putSettings({ clearSecret: true, authMode: "none" });
  assert.equal(r.status, 200);
  r = await putSettings({ url: TRIAL_URL });
  assert.equal(r.status, 200);
  assert.equal(r.body.trial.authMode, "none");
  // Production settings and resolution are untouched by all of the above.
  assert.equal(db.settings.has("N8N_PUBLISHED_POST_WEBHOOK_URL"), false);
  assert.equal(r.body.production.publish, "environment");
});

test("audit: confirmations are bound to the post and configuration they showed", async () => {
  configureTrial();
  const id = seedPost();
  const fp = (await preflight(id)).body.fingerprint;
  assert.match(fp, /^[0-9a-f]{32}$/);
  // Missing confirmation → nothing sent.
  let r = await runTrial(id, { confirmFingerprint: null });
  assert.equal(r.body.code, "TRIAL_CONFIRMATION_STALE");
  // Schedule changed after the confirmation opened → refused.
  const post = db.posts.get(id);
  db.posts.set(id, { ...post, scheduledDate: new Date("2026-11-26T12:00:00.000Z") });
  r = await runTrial(id, { confirmFingerprint: fp });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "TRIAL_CONFIRMATION_STALE");
  // Trial destination changed after the confirmation opened → refused.
  const fp2 = (await preflight(id)).body.fingerprint;
  db.settings.set(trialLib.TRIAL_URL_KEY, TRIAL_URL.replace("Publish-Trial", "Elsewhere"));
  assert.equal((await runTrial(id, { confirmFingerprint: fp2 })).body.code, "TRIAL_CONFIRMATION_STALE");
  assert.equal(trial.requests.length + prod.requests.length, 0);
  assert.equal((await runTrial(id)).status, 200, "fresh confirmation works");
});

test("audit: known server credentials in canonical or adapted payload block the trial", async () => {
  configureTrial();
  db.settings.set("OPENAI_API_KEY", "sk-test-openai-credential-000111");
  process.env.PUBLISHED_MEDIA_FTP_PASSWORD = "ftp-password-credential-999";
  try {
    for (const [field, value] of [["Notes", "see sk-test-openai-credential-000111"], ["data", "ftp-password-credential-999"], ["output", PROD_URL]]) {
      reset(); configureTrial();
      db.settings.set("OPENAI_API_KEY", "sk-test-openai-credential-000111");
      const id = seedPost({ extraPayload: { [field]: value } });
      const r = await runTrial(id, { payloadOnly: true });
      assert.equal(r.status, 422, `${field}`);
      assert.ok(r.body.blockedFields.some((f) => f.field === field && f.reason === "server credential"), JSON.stringify(r.body.blockedFields));
      assert.ok(!JSON.stringify(r.body).includes(value));
    }
    // A LinkedIn PDF: the scan covers the adapted body (image_url/media_url) as well.
    reset(); configureTrial();
    const id = seedPost({ platform: "LinkedIn", postType: "carousel", media: [{ mediaType: "document", name: "doc.pdf" }], publicMedia: false });
    const pf = await preflight(id);
    assert.ok(pf.body.unavailableMedia.includes("media_url") && pf.body.unavailableMedia.includes("files[0].image_url"), JSON.stringify(pf.body.unavailableMedia));
  } finally {
    delete process.env.PUBLISHED_MEDIA_FTP_PASSWORD;
  }
  assert.equal(trial.requests.length + prod.requests.length, 0);
});
