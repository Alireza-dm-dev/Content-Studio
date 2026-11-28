// Instagram → LinkedIn adapt: the scheduled publishing instant must survive the
// whole path (UI value → route → DB → stored jsonPayload → JSON viewer → the
// actual HTTP bytes n8n receives) and must never be replaced by the SOURCE
// post's schedule or by the ADAPTATION time ("now").
//
// Real: adapt + send-webhook routes, timezone helpers, payload builder,
// sendPublishedPostToN8n, retention, a local HTTP listener. Mocked: prisma
// (in-memory), auth, fs, remote media. Clock and server TZ are fixed and differ
// from every Brand zone so leaks of "now" or server-local time are visible.
import { test, mock, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.TZ = "Asia/Tokyo"; // server zone ≠ any Brand zone below
const ADAPT_NOW = "2026-11-23T12:05:00.000Z";   // adaptation execution time
const SOURCE_UTC = "2026-11-24T18:00:00.000Z";  // source Instagram schedule
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
const byId = (id) => db.posts.get(id) || null;

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
  findFirst: async (q) => (q?.where?.id ? byId(q.where.id) : null),
  findUnique: async (q) => byId(q?.where?.id),
  findMany: async (q) => [...db.posts.values()].filter((p) => p.brandId === q?.where?.brandId && (!q?.where?.platform || p.platform === q.where.platform)),
  deleteMany: async (q) => ({ count: db.posts.delete(q?.where?.id) ? 1 : 0 }),
  update: async ({ where, data }) => { const p = { ...byId(where.id), ...data, updatedAt: new Date() }; db.posts.set(where.id, p); return p; },
};
mock.module("@/lib/prisma", {
  exports: {
    prisma: {
      settings: { findUnique: async () => null },
      brand: { findUnique: async () => db.brand },
      publishedPost: postApi,
      $transaction: async (fn) => fn({
        publishedPost: {
          findFirst: async () => null,
          create: async ({ data }) => { const p = { ...data, media: [], createdAt: new Date(), updatedAt: new Date() }; db.posts.set(p.id, p); return { ...p }; },
          update: postApi.update,
        },
        publishedPostMedia: { create: async ({ data }) => { const m = { id: "m" + data.order, ...data }; byId(data.publishedPostId).media.push(m); return m; } },
      }),
    },
  },
});

const tz = await import("../lib/timezone.js");
const adapt = await import("../app/api/brands/[id]/published-posts/[postId]/adapt/route.js");
const resend = await import("../app/api/brands/[id]/published-posts/[postId]/send-webhook/route.js");

function seed(zone, extra = []) {
  db.brand = { id: "b1", name: "Knight", timezone: zone };
  db.posts.clear();
  db.posts.set("src", { id: "src", brandId: "b1", platform: "Instagram", postType: "static", status: "scheduled", scheduledDate: new Date(SOURCE_UTC), postNumber: 23, createdAt: new Date("2026-11-01T00:00:00Z"), media: [{ id: "s1", order: 1, mediaType: "IMAGE", url: PUBLIC + "src.png", fileName: "src.png" }] });
  for (const p of extra) db.posts.set(p.id, { brandId: "b1", platform: "LinkedIn", postType: "static", media: [], createdAt: new Date("2026-11-01T00:00:00Z"), ...p });
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
  const res = await adapt.POST(
    new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: "b1", postId: "src" }) },
  );
  const json = await res.json();
  const row = json.post?.id ? byId(json.post.id) : null;
  return { res, json, row };
}

const TIME_FIELDS = ["Scheduled Date", "scheduled_date_utc", "brand_timezone", "brand_local_publish_datetime"];
const timeFields = (p) => Object.fromEntries(TIME_FIELDS.map((k) => [k, p?.[k]]));

mock.timers.enable({ apis: ["Date"], now: new Date(ADAPT_NOW) });
beforeEach(() => mock.timers.setTime(new Date(ADAPT_NOW).getTime()));
after(() => mock.timers.reset());

test("IG→LinkedIn: selected London time survives every layer; never source or adaptation time", async () => {
  seed("Europe/London");
  // Exactly what CrossPlatformPostModal sends after the user edits the prefilled source date.
  const initial = tz.formatToDateTimeLocalInTz(SOURCE_UTC, "Europe/London");
  assert.equal(initial, "2026-11-24T18:00", "modal prefills the SOURCE schedule, not now");
  const uiValue = tz.scheduledValueForSubmit("2026-11-25T12:00", initial, SOURCE_UTC);
  assert.equal(uiValue, "2026-11-25T12:00");

  const { res, json, row } = await doAdapt(uiValue);
  assert.equal(res.status, 201, JSON.stringify(json));
  const expected = {
    "Scheduled Date": "25/11/2026 05:00:00", // America/Vancouver, UTC-7 year-round from 2026-11-01 (tzdata 2026b+)
    scheduled_date_utc: "2026-11-25T12:00:00.000Z",
    brand_timezone: "Europe/London",
    brand_local_publish_datetime: "2026-11-25T12:00:00",
  };
  assert.equal(row.scheduledDate.toISOString(), expected.scheduled_date_utc, "DB instant");
  const stored = JSON.parse(row.jsonPayload);
  assert.deepEqual(timeFields(stored), expected, "stored jsonPayload");
  const viewer = tz.normalizePayloadForN8n({ payload: stored, scheduledDate: row.scheduledDate, brandTimezone: "Europe/London" });
  assert.deepEqual(timeFields(viewer), expected, "JSON viewer");
  assert.equal(received.length, 1);
  assert.deepEqual(timeFields(received[0]), expected, "actual outbound HTTP body");

  // Adaptation time appears only in the execution metadata field, never in scheduling fields.
  assert.equal(received[0]["Webhook Sent At"], "2026-Nov-23 21:05"); // ADAPT_NOW in server TZ (Tokyo)
  for (const k of TIME_FIELDS) {
    assert.ok(!String(received[0][k]).includes("2026-11-23"), `${k} leaked adaptation date`);
    assert.ok(!String(received[0][k]).startsWith("23/11"), `${k} leaked adaptation date`);
  }
  assert.notEqual(received[0].scheduled_date_utc, SOURCE_UTC, "target ≠ source schedule");
  assert.equal(byId("src").scheduledDate.toISOString(), SOURCE_UTC, "source post untouched");
});

test("unchanged modal default sends the source instant exactly (explicit prefill, not now)", async () => {
  seed("Europe/London");
  const initial = tz.formatToDateTimeLocalInTz(SOURCE_UTC, "Europe/London");
  const { res, row } = await doAdapt(tz.scheduledValueForSubmit(initial, initial, SOURCE_UTC));
  assert.equal(res.status, 201);
  assert.equal(row.scheduledDate.toISOString(), SOURCE_UTC);
  assert.equal(received[0].scheduled_date_utc, SOURCE_UTC);
});

test("missing date is stored and sent as empty — never silently becomes now", async () => {
  seed("Europe/London");
  const { res, row } = await doAdapt(undefined);
  assert.equal(res.status, 201);
  assert.equal(row.scheduledDate, null);
  assert.deepEqual(timeFields(received[0]), { "Scheduled Date": "", scheduled_date_utc: "", brand_timezone: "Europe/London", brand_local_publish_datetime: "" });
});

test("malformed / nonexistent / ambiguous dates → 400, nothing created or sent", async () => {
  for (const bad of ["25/11/2026 12:00", "2026-13-40T99:99", "2027-03-28T01:30", "2026-10-25T01:30"]) {
    seed("Europe/London");
    const { res, json } = await doAdapt(bad);
    assert.equal(res.status, 400, bad);
    assert.ok(json.error, bad);
    assert.equal(received.length, 0, bad);
    assert.equal([...db.posts.values()].filter((p) => p.platform === "LinkedIn").length, 0, bad);
  }
});

test("manual resend a day later preserves the schedule; Webhook Sent At stays separate", async () => {
  seed("Europe/London");
  const { row } = await doAdapt("2026-11-25T12:00");
  received.length = 0;
  mock.timers.setTime(new Date("2026-11-24T09:30:00Z").getTime());
  const r = await resend.POST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id: "b1", postId: row.id }) });
  assert.equal(r.status, 200);
  assert.equal(received.length, 1);
  assert.equal(received[0]["Scheduled Date"], "25/11/2026 05:00:00");
  assert.equal(received[0].scheduled_date_utc, "2026-11-25T12:00:00.000Z");
  assert.equal(received[0].brand_local_publish_datetime, "2026-11-25T12:00:00");
});

test("retention: retained adapted post is sent with its schedule; removed one is never sent", async () => {
  const history = [10, 11, 12, 13, 14].map((d) => ({ id: `h${d}`, scheduledDate: new Date(`2026-11-${d}T10:00:00Z`) }));

  seed("Europe/London", history);
  const kept = await doAdapt("2026-11-25T12:00");
  assert.equal(kept.res.status, 201);
  assert.equal(received.length, 1);
  assert.equal(received[0].scheduled_date_utc, "2026-11-25T12:00:00.000Z");
  assert.equal(kept.row.scheduledDate.toISOString(), "2026-11-25T12:00:00.000Z", "retention did not alter schedule");

  seed("Europe/London", history);
  const removed = await doAdapt("2026-11-01T10:00"); // 6th-newest historical → removed
  assert.equal(removed.res.status, 200);
  assert.equal(removed.json.kept, false);
  assert.equal(received.length, 0, "removed post must not reach n8n");
  for (const h of history) assert.ok(byId(h.id), `${h.id} kept`);
});

test("timezone matrix: Brand zones, winter/summer, midnight crossing, server TZ differs", async () => {
  const cases = [
    ["Europe/London", "2026-07-15T10:00", "2026-07-15T09:00:00.000Z", "15/07/2026 02:00:00"],
    ["America/Vancouver", "2026-11-25T12:00", "2026-11-25T19:00:00.000Z", "25/11/2026 12:00:00"],
    ["America/Vancouver", "2026-07-15T12:00", "2026-07-15T19:00:00.000Z", "15/07/2026 12:00:00"],
    ["Europe/Helsinki", "2026-11-25T00:30", "2026-11-24T22:30:00.000Z", "24/11/2026 15:30:00"],
    ["Asia/Tehran", "2026-11-25T12:00", "2026-11-25T08:30:00.000Z", "25/11/2026 01:30:00"],
    ["America/Toronto", "2026-11-25T12:00", "2026-11-25T17:00:00.000Z", "25/11/2026 10:00:00"],
    ["America/Toronto", "2026-07-15T23:30", "2026-07-16T03:30:00.000Z", "15/07/2026 20:30:00"],
  ];
  for (const [zone, local, utc, vancouver] of cases) {
    seed(zone);
    const { res, row } = await doAdapt(local);
    assert.equal(res.status, 201, `${zone} ${local}`);
    assert.equal(row.scheduledDate.toISOString(), utc, `${zone} ${local} DB`);
    assert.deepEqual(timeFields(received[0]), {
      "Scheduled Date": vancouver, scheduled_date_utc: utc, brand_timezone: zone, brand_local_publish_datetime: `${local}:00`,
    }, `${zone} ${local} outbound`);
  }
});

test("n8n payload shape unchanged for adapted LinkedIn post", async () => {
  seed("Europe/London");
  await doAdapt("2026-11-25T12:00");
  assert.deepEqual(Object.keys(received[0]).sort(), [
    "Account / Profile", "Caption", "Error Log", "Hashtags", "Notes", "Platform", "Post ID", "Post Type",
    "Scheduled Date", "Status", "Webhook Sent At", "brand", "brand_local_publish_datetime", "brand_timezone",
    "data", "files", "from_smartcc", "is_carousel", "media", "media_count", "output", "row_number",
    "_crossPlatformSource", "scheduled_date_utc", "thumbnail_url", "video_url",
  ].sort());
  // The adaptation instant is legitimately present here — and only here.
  assert.deepEqual(received[0]._crossPlatformSource, { postId: "src", platform: "Instagram", adaptedAt: ADAPT_NOW });
  assert.notEqual(received[0].scheduled_date_utc, received[0]._crossPlatformSource.adaptedAt);
});
