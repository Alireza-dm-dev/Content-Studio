// Valid-time CREATE path for Instagram and LinkedIn: brand-local wall clock is
// converted to the stored UTC instant. Storage (fs/promises), remote media
// upload and the webhook are mocked, so nothing is written to real uploads.

import { test, mock } from "node:test";
import assert from "node:assert/strict";

const state = { brand: null, created: [], writes: [], webhookCalls: [], remoteCalls: 0 };

mock.module("fs/promises", {
  exports: {
    writeFile: async (p) => { state.writes.push(p); },
    mkdir: async () => {},
    rm: async () => {},
    readdir: async () => [],
    unlink: async () => {},
  },
});
mock.module("@/lib/brand-access", { exports: { requireBrandAccess: async () => ({ ok: true, user: { id: "u", role: "user" } }) } });
mock.module("@/lib/published-post-remote-media", {
  exports: {
    uploadPublishedPostMedia: async () => { state.remoteCalls++; return { success: false, detailCode: "MOCK", error: "mocked" }; },
    isCanonicalMediaUrl: () => false,
  },
});
mock.module("@/lib/published-post-webhook", {
  exports: { sendPublishedPostToN8n: async (a) => { state.webhookCalls.push(a); return { success: true }; } },
});
mock.module("@/lib/prisma", {
  exports: {
    prisma: {
      brand: { findUnique: async () => state.brand },
      publishedPost: {
        findFirst: async () => null,
        findMany: async () => [],
        deleteMany: async () => ({ count: 0 }),
      },
      $transaction: async (fn) => fn({
        publishedPost: {
          create: async ({ data }) => { const r = { ...data, createdAt: new Date(), updatedAt: new Date() }; state.created.push(r); return r; },
          update: async ({ data }) => ({ ...state.created.at(-1), ...data }),
        },
        publishedPostMedia: { create: async ({ data }) => ({ id: "m1", ...data }) },
      }),
    },
  },
});

const { POST } = await import("../app/api/brands/[id]/published-posts/route.js");

async function create({ timezone, platform, postType, file, scheduledDate }) {
  state.brand = { id: "b1", name: "Acme", timezone };
  state.created = []; state.writes = []; state.webhookCalls = [];
  const fd = new FormData();
  fd.append("files", file);
  fd.append("platform", platform);
  fd.append("postType", postType);
  if (scheduledDate) fd.append("scheduledDate", scheduledDate);
  const res = await POST(new Request("http://x", { method: "POST", body: fd }), { params: Promise.resolve({ id: "b1" }) });
  return { res, body: await res.json() };
}
const png = () => new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });

test("Instagram create: Europe/London 15 Jul 10:00 → stored 09:00Z", async () => {
  const { res, body } = await create({ timezone: "Europe/London", platform: "Instagram", postType: "static", file: png(), scheduledDate: "2026-07-15T10:00" });
  assert.equal(res.status, 201, JSON.stringify(body));
  assert.equal(state.created[0].scheduledDate.toISOString(), "2026-07-15T09:00:00.000Z");
  assert.equal(state.created[0].platform, "Instagram");
  const payload = JSON.parse(JSON.stringify(body.post.jsonPayload ? JSON.parse(body.post.jsonPayload) : {}));
  assert.equal(payload.brand_timezone, "Europe/London");
  assert.equal(payload.scheduled_date_utc, "2026-07-15T09:00:00.000Z");
  assert.equal(payload["Scheduled Date"], "15/07/2026 10:00:00");
  assert.equal(payload.brand_local_publish_datetime, "2026-07-15T10:00:00");
});

test("LinkedIn create: Europe/London 15 Jul 10:00 → stored 09:00Z", async () => {
  const { res, body } = await create({ timezone: "Europe/London", platform: "LinkedIn", postType: "static", file: png(), scheduledDate: "2026-07-15T10:00" });
  assert.equal(res.status, 201, JSON.stringify(body));
  assert.equal(state.created[0].scheduledDate.toISOString(), "2026-07-15T09:00:00.000Z");
  assert.equal(state.created[0].platform, "LinkedIn");
});

test("create: winter London 10:00Z, Vancouver summer 17:00Z, missing tz → Vancouver default", async () => {
  await create({ timezone: "Europe/London", platform: "Instagram", postType: "static", file: png(), scheduledDate: "2026-01-15T10:00" });
  assert.equal(state.created[0].scheduledDate.toISOString(), "2026-01-15T10:00:00.000Z");
  await create({ timezone: "America/Vancouver", platform: "LinkedIn", postType: "static", file: png(), scheduledDate: "2026-07-15T10:00" });
  assert.equal(state.created[0].scheduledDate.toISOString(), "2026-07-15T17:00:00.000Z");
  await create({ timezone: null, platform: "Instagram", postType: "static", file: png(), scheduledDate: "2026-07-15T10:00" });
  assert.equal(state.created[0].scheduledDate.toISOString(), "2026-07-15T17:00:00.000Z");
});

test("create: ambiguous/nonexistent time writes nothing and sends nothing", async () => {
  for (const [when, msg] of [["2026-10-25T01:30", /occurs twice/], ["2026-03-29T01:30", /does not exist/]]) {
    const { res, body } = await create({ timezone: "Europe/London", platform: "Instagram", postType: "static", file: png(), scheduledDate: when });
    assert.equal(res.status, 400);
    assert.match(body.error, msg);
    assert.equal(state.created.length, 0);
    assert.equal(state.writes.length, 0);
    assert.equal(state.webhookCalls.length, 0);
  }
});
