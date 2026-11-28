// Server-authoritative webhook JSON preview.
//
// The JSON viewer, Copy JSON and Download JSON render the response of
// GET /published-posts/[postId]/payload (client transform: JSON.stringify(payload, null, 2),
// see components/useCanonicalPayload.js). These tests prove its four schedule fields
// equal the bytes the real send path POSTs, across adapt → edit → resend, Brand
// zones, unscheduled posts, and a browser with a stale timezone database.
//
// Real: adapt, edit, send-webhook and payload routes, payload builder, final
// normalizer, sendPublishedPostToN8n, retention, a local HTTP listener.
// Mocked: prisma (in-memory), auth/brand access, fs, remote media.
// Authorization of the payload route: tests/published-post-collaborators.test.mjs.
import { test, mock, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.TZ = "Asia/Tokyo"; // server zone ≠ every Brand zone
const NOW = "2026-11-23T12:05:00.000Z"; // adaptation / execution time
const SOURCE_UTC = "2026-11-24T18:00:00.000Z";
const PUBLIC = "https://files.leadsagna.com/";

const received = [];
const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => { received.push(JSON.parse(raw)); res.writeHead(200); res.end("{}"); });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
process.env.N8N_PUBLISHED_POST_WEBHOOK_URL = `http://127.0.0.1:${server.address().port}/webhook`;
after(() => server.close());

const db = { brand: null, posts: new Map() };
const writes = [];
const byId = (id) => db.posts.get(id) || null;
const withBrand = (p, include) => (p && include?.brand ? { ...p, brand: { id: db.brand.id, name: db.brand.name, timezone: db.brand.timezone } } : p);

mock.module("fs/promises", { exports: { writeFile: async () => {}, mkdir: async () => {}, rm: async () => {}, readdir: async () => [], unlink: async () => {}, readFile: async () => Buffer.from([1]) } });
mock.module("@/lib/auth", { exports: { getCurrentUser: async () => ({ id: "u", role: "user" }) } });
mock.module("@/lib/brand-access", { exports: { canUserAccessBrand: async () => true, requireBrandAccess: async () => ({ ok: true, user: { id: "u", role: "user" } }), getAccessibleBrandIds: async () => null, isAdminUser: () => false } });
mock.module("@/lib/published-post-remote-media", {
  exports: {
    uploadPublishedPostMedia: async () => ({ success: true, thumbnailUrl: null, media: [{ order: 1, fileUrl: PUBLIC + "a.png" }] }),
    isCanonicalMediaUrl: (u) => typeof u === "string" && u.startsWith(PUBLIC),
    isLocalMediaUrl: (u) => typeof u === "string" && u.startsWith("/uploads/"),
    copyMediaToTarget: async () => ({ success: true }),
    getEnvConfig: () => ({}),
  },
});
const postApi = {
  findFirst: async (q) => withBrand(q?.where?.id ? byId(q.where.id) : null, q?.include),
  findUnique: async (q) => withBrand(byId(q?.where?.id), q?.include),
  findMany: async (q) => [...db.posts.values()].filter((p) => p.brandId === q?.where?.brandId && (!q?.where?.platform || p.platform === q.where.platform)),
  deleteMany: async (q) => { writes.push("deleteMany"); return { count: db.posts.delete(q?.where?.id) ? 1 : 0 }; },
  update: async ({ where, data }) => { writes.push("update"); const p = { ...byId(where.id), ...data, updatedAt: new Date() }; db.posts.set(where.id, p); return p; },
};
mock.module("@/lib/prisma", {
  exports: {
    prisma: {
      settings: { findUnique: async () => null },
      brand: { findUnique: async () => db.brand },
      publishedPost: postApi,
      publishedPostCollaborator: { findFirst: async () => null, deleteMany: async () => ({ count: 0 }) },
      $transaction: async (fn) => fn({
        publishedPost: {
          findFirst: async () => null,
          create: async ({ data }) => { writes.push("create"); const p = { ...data, media: [], createdAt: new Date(), updatedAt: new Date() }; db.posts.set(p.id, p); return { ...p }; },
          update: postApi.update,
        },
        publishedPostMedia: { create: async ({ data }) => { const m = { id: "m" + data.order, ...data }; byId(data.publishedPostId).media.push(m); return m; } },
      }),
    },
  },
});

const tz = await import("../lib/timezone.js");
const { Settings } = await import("luxon");
const adapt = await import("../app/api/brands/[id]/published-posts/[postId]/adapt/route.js");
const item = await import("../app/api/brands/[id]/published-posts/[postId]/route.js");
const resend = await import("../app/api/brands/[id]/published-posts/[postId]/send-webhook/route.js");
const payloadRoute = await import("../app/api/brands/[id]/published-posts/[postId]/payload/route.js");

const ctx = (postId) => ({ params: Promise.resolve({ id: "b1", postId }) });
const TIME_FIELDS = ["Scheduled Date", "scheduled_date_utc", "brand_timezone", "brand_local_publish_datetime"];
const timeFields = (p) => Object.fromEntries(TIME_FIELDS.map((k) => [k, p?.[k]]));

function seed(zone) {
  db.brand = { id: "b1", name: "Knight", timezone: zone };
  db.posts.clear();
  db.posts.set("src", { id: "src", brandId: "b1", platform: "Instagram", postType: "static", status: "scheduled", scheduledDate: new Date(SOURCE_UTC), postNumber: 23, createdAt: new Date("2026-11-01T00:00:00Z"), updatedAt: new Date("2026-11-01T00:00:00Z"), media: [{ id: "s1", order: 1, mediaType: "IMAGE", url: PUBLIC + "src.png", fileName: "src.png" }] });
  received.length = 0;
}

async function doAdapt(scheduledDate) {
  const content = Buffer.from([1, 2, 3, 4]).toString("base64");
  const body = {
    targetPlatform: "LinkedIn", targetPostType: "static", caption: "c", status: "scheduled", sendToN8n: true,
    mediaStrategy: "new", publishTitle: "t",
    orderedMediaManifest: [{ action: "new", order: 1, mediaType: "IMAGE" }],
    files: [{ name: "a.png", type: "image/png", size: 4, content }],
  };
  if (scheduledDate !== undefined) body.scheduledDate = scheduledDate;
  const res = await adapt.POST(new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ctx("src"));
  const json = await res.json();
  assert.equal(res.status, 201, JSON.stringify(json));
  return json;
}

// Exactly what the JSON viewer / Copy JSON / Download JSON receive.
async function preview(postId) {
  const res = await payloadRoute.GET(new Request("http://x"), ctx(postId));
  const body = await res.json();
  return { status: res.status, cache: res.headers.get("cache-control"), body, text: body.payload ? JSON.stringify(body.payload, null, 2) : null };
}

mock.timers.enable({ apis: ["Date"], now: new Date(NOW) });
beforeEach(() => { mock.timers.setTime(new Date(NOW).getTime()); writes.length = 0; });
after(() => mock.timers.reset());

test("required example (London 25 Nov 2026 12:00): viewer = copy = download = HTTP = DB", async () => {
  seed("Europe/London");
  const { post } = await doAdapt("2026-11-25T12:00");
  assert.equal(byId(post.id).scheduledDate.toISOString(), "2026-11-25T12:00:00.000Z", "DB UTC");

  const p = await preview(post.id);
  assert.equal(p.status, 200);
  assert.match(p.cache, /private/);
  assert.match(p.cache, /no-store/);
  const copied = p.text;     // handleCopyJson writes canonical.text
  const downloaded = p.text; // handleDownloadJson blobs canonical.text
  for (const [label, s] of [["viewer", p.text], ["copy", copied], ["download", downloaded]]) {
    assert.equal(JSON.parse(s)["Scheduled Date"], "25/11/2026 05:00:00", label);
  }
  assert.equal(received.length, 1);
  assert.deepEqual(timeFields(p.body.payload), timeFields(received[0]), "preview = actual HTTP");
  assert.deepEqual(timeFields(received[0]), {
    "Scheduled Date": "25/11/2026 05:00:00",
    scheduled_date_utc: "2026-11-25T12:00:00.000Z",
    brand_timezone: "Europe/London",
    brand_local_publish_datetime: "2026-11-25T12:00:00",
  });
  // Non-adapter fields agree too: the preview is the canonical pre-adapter payload.
  const { files: _f1, media: _m1, ...restPreview } = p.body.payload;
  const { files: _f2, media: _m2, Platform: _p, media_url: _u, media_count: _c, is_carousel: _i, video_url: _v, ...restSent } = received[0];
  for (const k of Object.keys(restSent)) {
    if (k in restPreview && !["Platform"].includes(k)) assert.deepEqual(restPreview[k], restSent[k], k);
  }
  // Server-built summary for the viewer
  assert.equal(p.body.schedule.dateTime, "25 Nov 2026, 12:00");
  assert.equal(p.body.schedule.timezoneLabel, "Europe/London");
});

test("stale browser tzdata (Vancouver as UTC-8): viewer still shows the server value", async () => {
  seed("Europe/London");
  const { post } = await doAdapt("2026-11-25T12:00");
  const p = await preview(post.id); // server responds with its own (current) tzdata
  const serialized = (await (await item.GET(new Request("http://x"), ctx(post.id))).json());
  const vancouver = tz.formatLegacyN8nScheduledDate("2026-11-25T12:00:00.000Z"); // server truth, not hard-coded

  // Simulate an outdated browser ICU: America/Vancouver resolves to fixed UTC-8.
  const RealDTF = Intl.DateTimeFormat;
  function StaleDTF(locales, opts) {
    const o = opts && opts.timeZone === "America/Vancouver" ? { ...opts, timeZone: "Etc/GMT+8" } : opts;
    return new RealDTF(locales, o);
  }
  StaleDTF.prototype = RealDTF.prototype;
  StaleDTF.supportedLocalesOf = RealDTF.supportedLocalesOf.bind(RealDTF);
  Intl.DateTimeFormat = StaleDTF;
  Settings.resetCaches();
  try {
    // The shim is effective: the OLD browser-side normalization would drift by an hour.
    const legacyBrowser = tz.normalizePayloadForN8n({ payload: {}, scheduledDate: "2026-11-25T12:00:00.000Z", brandTimezone: "Europe/London" });
    assert.notEqual(legacyBrowser["Scheduled Date"], vancouver, "shim must reproduce the drift");
    assert.equal(legacyBrowser["Scheduled Date"], "25/11/2026 04:00:00");

    // NEW path: the client only re-serializes the server JSON — no zone math.
    const viewerText = JSON.stringify(JSON.parse(JSON.stringify(p.body)).payload, null, 2);
    assert.equal(JSON.parse(viewerText)["Scheduled Date"], vancouver);
    assert.equal(JSON.parse(viewerText)["Scheduled Date"], "25/11/2026 05:00:00");
    assert.equal(viewerText, p.text, "copy/download text unchanged");
    // Saved-post display + edit prefill come from the server-built schedule.
    const ss = tz.serverScheduleFor(serialized);
    assert.equal(ss.dateTime, "25 Nov 2026, 12:00");
    assert.equal(ss.datetimeLocal, "2026-11-25T12:00");
  } finally {
    Intl.DateTimeFormat = RealDTF;
    Settings.resetCaches();
  }
  assert.equal(tz.formatLegacyN8nScheduledDate("2026-11-25T12:00:00.000Z"), vancouver, "restored");
});

test("Brand zone matrix: preview schedule fields = outgoing HTTP = DB (server tzdata)", async () => {
  const cases = [
    ["Europe/London", "2026-11-25T12:00", "2026-11-25T12:00:00.000Z", "25 Nov 2026", "12:00"],
    ["America/Vancouver", "2026-11-25T12:00", "2026-11-25T19:00:00.000Z", "25 Nov 2026", "12:00"],
    ["Europe/Helsinki", "2026-11-25T00:30", "2026-11-24T22:30:00.000Z", "25 Nov 2026", "00:30"],
    ["America/Toronto", "2026-11-25T23:30", "2026-11-26T04:30:00.000Z", "25 Nov 2026", "23:30"],
    ["Asia/Tehran", "2026-07-15T00:15", "2026-07-14T20:45:00.000Z", "15 Jul 2026", "00:15"],
  ];
  for (const [zone, local, utc, date, time] of cases) {
    seed(zone);
    const { post } = await doAdapt(local);
    const p = await preview(post.id);
    const label = `${zone} ${local}`;
    assert.equal(byId(post.id).scheduledDate.toISOString(), utc, `${label} DB`);
    assert.deepEqual(timeFields(p.body.payload), timeFields(received[0]), `${label} preview = HTTP`);
    assert.equal(p.body.payload["Scheduled Date"], tz.formatLegacyN8nScheduledDate(utc), `${label} legacy field from server tzdata`);
    assert.equal(p.body.payload.brand_local_publish_datetime, `${local}:00`, label);
    assert.equal(p.body.schedule.dateTime, `${date}, ${time}`, label);
    assert.equal(p.body.schedule.datetimeLocal, local, `${label} prefill`);
    assert.equal(p.body.schedule.timezoneLabel, zone, label);
  }
});

test("adapt → edit → reopen → resend: preview tracks the saved post and equals each HTTP body", async () => {
  seed("Europe/London");
  const { post } = await doAdapt("2026-11-25T12:00");
  // Target has its own payload; the source keeps its own schedule.
  const src = await preview("src");
  assert.equal(src.body.payload.scheduled_date_utc, SOURCE_UTC, "source Instagram schedule preserved");
  assert.equal((await preview(post.id)).body.payload.scheduled_date_utc, "2026-11-25T12:00:00.000Z", "target ≠ source");
  assert.notEqual((await preview(post.id)).body.payload.scheduled_date_utc, NOW, "never the adaptation time");

  // Edit to 15:30 exactly as LinkedInPostDetailModal submits it.
  const initial = tz.serverScheduleFor(post).datetimeLocal;
  assert.equal(initial, "2026-11-25T12:00");
  const value = tz.scheduledValueForSubmit("2026-11-25T15:30", initial, post.scheduledDate);
  received.length = 0;
  const er = await item.POST(new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ caption: "c", scheduledDate: value, notes: "", status: "scheduled" }) }), ctx(post.id));
  const edited = await er.json();
  assert.equal(er.status, 200, JSON.stringify(edited));
  assert.equal(byId(post.id).scheduledDate.toISOString(), "2026-11-25T15:30:00.000Z");
  const afterEdit = await preview(post.id);
  assert.equal(afterEdit.body.payload["Scheduled Date"], "25/11/2026 08:30:00");
  assert.deepEqual(timeFields(afterEdit.body.payload), timeFields(received.at(-1)), "edit auto-send = preview");
  // Reopen: server-built prefill is the new value; an unchanged resave keeps the instant.
  const reopened = tz.serverScheduleFor(edited.post ?? edited);
  assert.equal(reopened.datetimeLocal, "2026-11-25T15:30");
  assert.equal(tz.scheduledValueForSubmit(reopened.datetimeLocal, reopened.datetimeLocal, "2026-11-25T15:30:00.000Z"), "2026-11-25T15:30:00.000Z");

  // Manual resend a day later: same schedule fields as the preview.
  mock.timers.setTime(new Date("2026-11-24T09:30:00Z").getTime());
  received.length = 0;
  assert.equal((await resend.POST(new Request("http://x", { method: "POST" }), ctx(post.id))).status, 200);
  assert.equal(received.length, 1);
  assert.deepEqual(timeFields((await preview(post.id)).body.payload), timeFields(received[0]), "manual send = preview");
});

test("unscheduled post keeps existing semantics in preview and HTTP", async () => {
  seed("Europe/London");
  const { post } = await doAdapt(undefined);
  const p = await preview(post.id);
  const empty = { "Scheduled Date": "", scheduled_date_utc: "", brand_timezone: "Europe/London", brand_local_publish_datetime: "" };
  assert.deepEqual(timeFields(p.body.payload), empty);
  assert.deepEqual(timeFields(received[0]), empty);
  assert.equal(p.body.schedule.dateTime, "Not scheduled");
  assert.equal(p.body.schedule.datetimeLocal, "");
});

test("preview is read-only: no DB writes, no webhook, stable across calls", async () => {
  seed("America/Vancouver");
  const { post } = await doAdapt("2026-11-25T12:00");
  received.length = 0;
  writes.length = 0;
  const snapshot = JSON.stringify([...db.posts.entries()]);
  const a = await preview(post.id);
  mock.timers.setTime(new Date("2026-12-01T00:00:00Z").getTime());
  const b = await preview(post.id);
  assert.equal(a.text, b.text, "same saved state → identical preview (no 'now' leaks into it)");
  assert.equal(received.length, 0, "no webhook");
  assert.deepEqual(writes, [], "no DB write");
  assert.equal(JSON.stringify([...db.posts.entries()]), snapshot);
  assert.equal((await preview("does-not-exist")).status, 404);
});

test("status-only edit keeps the scheduled instant and the server schedule", async () => {
  seed("America/Vancouver");
  const { post } = await doAdapt("2026-11-25T18:00");
  const before = tz.serverScheduleFor(post);
  assert.equal(before.dateTime, "25 Nov 2026, 18:00");
  // Exactly what the modal submits when only the status changes (picker untouched).
  const value = tz.scheduledValueForSubmit(before.datetimeLocal, before.datetimeLocal, post.scheduledDate);
  const res = await item.POST(new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ caption: "c", scheduledDate: value, notes: "", status: "draft" }) }), ctx(post.id));
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  const after = body.post ?? body;
  assert.equal(after.status, "draft");
  assert.equal(byId(post.id).scheduledDate.toISOString(), "2026-11-26T01:00:00.000Z", "instant unchanged");
  assert.deepEqual(tz.serverScheduleFor(after), before, "same server schedule after a status change");
  assert.equal(received.at(-1).scheduled_date_utc, "2026-11-26T01:00:00.000Z");
});

test("LinkedIn legacy adapter: exact transformation; all four schedule fields identical", async () => {
  seed("Europe/London");
  const utils = await import("../lib/published-post-utils.js");
  const pdf = PUBLIC + "POST-0040/doc.pdf";
  const media = [{ id: "d1", order: 1, mediaType: "document", url: pdf, fileName: "doc.pdf" }];
  const row = { id: "doc", brandId: "b1", platform: "LinkedIn", postType: "carousel", status: "scheduled", caption: "c #x", postNumber: 40, scheduledDate: new Date("2026-11-25T12:00:00.000Z"), createdAt: new Date("2026-11-01T00:00:00Z"), updatedAt: new Date("2026-11-01T00:00:00Z"), media };
  row.jsonPayload = JSON.stringify(utils.buildN8nPayload({ ...row }, [...media], "Knight", "Europe/London"));
  db.posts.set("doc", row);

  const canonical = (await preview("doc")).body.payload;
  const r = await resend.POST(new Request("http://x", { method: "POST" }), ctx("doc"));
  assert.equal(r.status, 200);
  const sent = received.at(-1);

  assert.deepEqual(timeFields(sent), timeFields(canonical), "schedule fields unchanged by the adapter");
  assert.deepEqual(timeFields(sent), {
    "Scheduled Date": "25/11/2026 05:00:00",
    scheduled_date_utc: "2026-11-25T12:00:00.000Z",
    brand_timezone: "Europe/London",
    brand_local_publish_datetime: "2026-11-25T12:00:00",
  });

  const changed = Object.keys({ ...canonical, ...sent }).filter((k) => JSON.stringify(canonical[k]) !== JSON.stringify(sent[k])).sort();
  const removed = Object.keys(canonical).filter((k) => !(k in sent));
  const added = Object.keys(sent).filter((k) => !(k in canonical));
  assert.deepEqual(removed, [], "no field removed");
  assert.deepEqual(added, ["media_url"], "only media_url is added");
  assert.ok(changed.every((k) => ["Platform", "files", "media", "media_url", "media_count", "is_carousel", "video_url"].includes(k)), changed.join());
  assert.equal(canonical.Platform, "LinkedIn");
  assert.equal(sent.Platform, "Linkedin");
  assert.deepEqual(canonical.files, [{ media_type: "document", document_url: pdf }]);
  assert.deepEqual(sent.files, [{ media_type: "IMAGE", image_url: pdf }]);
  assert.deepEqual(sent.media, [{ order: 1, url: pdf, media_type: "IMAGE" }]);
  assert.equal(sent.media_url, pdf);
  assert.equal(sent.media_count, 1);
  assert.equal(sent.is_carousel, true);
  assert.equal(sent.video_url, "");
  // No fallback date is introduced anywhere in the transmitted body.
  assert.ok(!JSON.stringify(sent).includes("2026-11-23"), "no 'now' date leaks into the body");
});
