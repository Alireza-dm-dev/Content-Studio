// FINAL-TRANSPORT regression: real routes + real sendPublishedPostToN8n + real
// HTTP to a local listener standing in for n8n. Only prisma, auth, fs and remote
// media are mocked. Assertions are on the JSON bytes the listener receives.
// UI = Brand-local, DB = UTC, n8n "Scheduled Date" = America/Vancouver.

import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const received = [];
const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => { received.push(JSON.parse(raw)); res.writeHead(200); res.end("{}"); });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
process.env.N8N_PUBLISHED_POST_WEBHOOK_URL = `http://127.0.0.1:${server.address().port}/webhook`;
after(() => server.close());

const state = { brand: null, created: [], post: null };

mock.module("fs/promises", { exports: { writeFile: async () => {}, mkdir: async () => {}, rm: async () => {}, readdir: async () => [], unlink: async () => {} } });
mock.module("@/lib/brand-access", { exports: { requireBrandAccess: async () => ({ ok: true, user: { id: "u", role: "user" } }) } });
mock.module("@/lib/published-post-remote-media", {
  exports: {
    uploadPublishedPostMedia: async () => ({ success: true, thumbnailUrl: null, media: [{ order: 1, fileUrl: "https://files.leadsagna.com/a.png" }] }),
    isCanonicalMediaUrl: () => true,
    getEnvConfig: () => ({}),
  },
});
mock.module("@/lib/prisma", {
  exports: {
    prisma: {
      settings: { findUnique: async () => null },
      brand: { findUnique: async () => state.brand },
      publishedPost: {
        findFirst: async () => state.post,
        findUnique: async () => state.post,
        findMany: async () => [],
        deleteMany: async () => ({ count: 0 }),
        update: async ({ data }) => { state.post = { ...state.post, ...data }; return state.post; },
      },
      $transaction: async (fn) => fn({
        publishedPost: {
          create: async ({ data }) => { const r = { ...data, createdAt: new Date(), updatedAt: new Date() }; state.created.push(r); state.post = { ...r, media: [{ id: "m1", order: 1, mediaType: "IMAGE", url: "/uploads/a.png", fileName: "a.png" }] }; return r; },
          update: async ({ data }) => { state.post = { ...state.post, ...data }; return state.post; },
        },
        publishedPostMedia: { create: async ({ data }) => ({ id: "m1", ...data }) },
      }),
    },
  },
});

const create = await import("../app/api/brands/[id]/published-posts/route.js");
const edit = await import("../app/api/brands/[id]/published-posts/[postId]/route.js");
const resend = await import("../app/api/brands/[id]/published-posts/[postId]/send-webhook/route.js");
const params = (extra = {}) => ({ params: Promise.resolve({ id: "b1", postId: "p1", ...extra }) });
const png = () => new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });

async function doCreate({ timezone, platform, scheduledDate }) {
  state.brand = { id: "b1", name: "Acme", timezone };
  state.created = []; received.length = 0;
  const fd = new FormData();
  fd.append("files", png()); fd.append("platform", platform); fd.append("postType", "static");
  fd.append("scheduledDate", scheduledDate);
  const res = await create.POST(new Request("http://x", { method: "POST", body: fd }), params());
  assert.equal(res.status, 201);
  assert.equal(received.length, 1, "exactly one outbound n8n request");
  return received[0];
}

for (const platform of ["Instagram", "LinkedIn"]) {
  test(`${platform} create: London 10:00 summer → listener gets Vancouver 02:00`, async () => {
    const b = await doCreate({ timezone: "Europe/London", platform, scheduledDate: "2026-07-15T10:00" });
    assert.equal(state.created[0].scheduledDate.toISOString(), "2026-07-15T09:00:00.000Z");
    assert.equal(b["Scheduled Date"], "15/07/2026 02:00:00");
    assert.equal(b.scheduled_date_utc, "2026-07-15T09:00:00.000Z");
    assert.equal(b.brand_timezone, "Europe/London");
    assert.equal(b.brand_local_publish_datetime, "2026-07-15T10:00:00");
  });
}

test("UK winter: London 10:00 → Vancouver 02:00 (no hardcoded offset)", async () => {
  const b = await doCreate({ timezone: "Europe/London", platform: "Instagram", scheduledDate: "2026-01-15T10:00" });
  assert.equal(b.scheduled_date_utc, "2026-01-15T10:00:00.000Z");
  assert.equal(b["Scheduled Date"], "15/01/2026 02:00:00");
});

test("Vancouver brand: Scheduled Date equals Brand-local 10:00", async () => {
  const b = await doCreate({ timezone: "America/Vancouver", platform: "LinkedIn", scheduledDate: "2026-07-15T10:00" });
  assert.equal(b["Scheduled Date"], "15/07/2026 10:00:00");
  assert.equal(b.brand_local_publish_datetime, "2026-07-15T10:00:00");
});

test("edit 10:00 → 11:00 London: listener gets 03:00 Vancouver", async () => {
  await doCreate({ timezone: "Europe/London", platform: "Instagram", scheduledDate: "2026-07-15T10:00" });
  state.post = { ...state.post, id: "p1", brandId: "b1", media: [{ id: "m1", order: 1, mediaType: "IMAGE", url: "/uploads/a.png", fileName: "a.png" }], _count: { comments: 0 } };
  received.length = 0;
  const res = await edit.POST(new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scheduledDate: "2026-07-15T11:00" }) }), params());
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  assert.equal(received.length, 1);
  assert.equal(state.post.scheduledDate.toISOString(), "2026-07-15T10:00:00.000Z");
  assert.equal(received[0]["Scheduled Date"], "15/07/2026 03:00:00");
  assert.equal(received[0].scheduled_date_utc, "2026-07-15T10:00:00.000Z");
});

test("resend: stale stored Brand-local 'Scheduled Date' must NOT win", async () => {
  state.brand = { id: "b1", name: "Acme", timezone: "Europe/London" };
  const stale = {
    "Scheduled Date": "15/07/2026 10:00:00", // wrong: Brand-local (V1.3.39)
    scheduled_date_utc: "stale", brand_timezone: "Asia/Tehran", brand_local_publish_datetime: "stale",
    Platform: "Instagram", media_count: 1, files: [], media: [],
  };
  state.post = { id: "p1", brandId: "b1", platform: "Instagram", postType: "static", scheduledDate: new Date("2026-07-15T09:00:00.000Z"), jsonPayload: JSON.stringify(stale), media: [] };
  received.length = 0;
  const res = await resend.POST(new Request("http://x", { method: "POST" }), params());
  assert.equal(res.status, 200);
  assert.equal(received.length, 1);
  assert.equal(received[0]["Scheduled Date"], "15/07/2026 02:00:00");
  assert.equal(received[0].scheduled_date_utc, "2026-07-15T09:00:00.000Z");
  assert.equal(received[0].brand_timezone, "Europe/London");
  assert.equal(received[0].brand_local_publish_datetime, "2026-07-15T10:00:00");
});

test("payload preview/copy: stale stored Brand-local value is normalized exactly like the send", async () => {
  const { normalizePayloadForN8n } = await import("@/lib/timezone");
  const stale = { "Scheduled Date": "15/07/2026 10:00:00", scheduled_date_utc: "old", brand_timezone: "Asia/Tehran", brand_local_publish_datetime: "old", Platform: "Instagram" };
  const preview = normalizePayloadForN8n({ payload: stale, scheduledDate: "2026-07-15T09:00:00.000Z", brandTimezone: "Europe/London" });
  assert.equal(preview["Scheduled Date"], "15/07/2026 02:00:00");
  assert.equal(preview.scheduled_date_utc, "2026-07-15T09:00:00.000Z");
  assert.equal(preview.brand_timezone, "Europe/London");
  assert.equal(preview.brand_local_publish_datetime, "2026-07-15T10:00:00");
  assert.equal(stale["Scheduled Date"], "15/07/2026 10:00:00", "input not mutated");

  // preview == actual outbound semantics: same stored payload through the real send path
  state.brand = { id: "b1", name: "Acme", timezone: "Europe/London" };
  state.post = { id: "p1", brandId: "b1", platform: "Instagram", postType: "static", scheduledDate: new Date("2026-07-15T09:00:00.000Z"), jsonPayload: JSON.stringify({ ...stale, files: [], media: [], media_count: 1 }), media: [] };
  received.length = 0;
  await resend.POST(new Request("http://x", { method: "POST" }), params());
  for (const k of ["Scheduled Date", "scheduled_date_utc", "brand_timezone", "brand_local_publish_datetime"]) {
    assert.equal(received[0][k], preview[k], k);
  }
});
