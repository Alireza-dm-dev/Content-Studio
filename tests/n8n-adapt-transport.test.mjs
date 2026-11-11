// Adapt / cross-platform → real sendPublishedPostToN8n → real HTTP listener.
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

const state = { post: null };
const source = { id: "src", brandId: "b1", platform: "Instagram", postType: "static", media: [], status: "draft" };
mock.module("fs/promises", { exports: { writeFile: async () => {}, mkdir: async () => {}, rm: async () => {}, readdir: async () => [], unlink: async () => {} } });
mock.module("@/lib/auth", { exports: { getCurrentUser: async () => ({ id: "u", role: "user" }) } });
mock.module("@/lib/brand-access", { exports: { canUserAccessBrand: async () => true, requireBrandAccess: async () => ({ ok: true }) } });
mock.module("@/lib/published-post-remote-media", {
  exports: {
    uploadPublishedPostMedia: async () => ({ success: true, thumbnailUrl: null, media: [{ order: 1, fileUrl: "https://files.leadsagna.com/a.png" }] }),
    isCanonicalMediaUrl: () => true,
    isLocalMediaUrl: () => false,
    copyMediaToTarget: async () => ({}),
    getEnvConfig: () => ({}),
  },
});
const media = [{ id: "m1", order: 1, mediaType: "IMAGE", url: "/uploads/a.png", fileName: "a.png" }];
mock.module("@/lib/prisma", {
  exports: {
    prisma: {
      settings: { findUnique: async () => null },
      brand: { findUnique: async () => ({ id: "b1", name: "Acme", timezone: "Europe/London" }) },
      publishedPost: {
        findFirst: async (q) => (q?.where?.id === "src" ? source : null),
        findUnique: async () => state.post,
        update: async ({ data }) => { state.post = { ...state.post, ...data }; return state.post; },
      },
      $transaction: async (fn) => fn({
        publishedPost: {
          findFirst: async () => null,
          create: async ({ data }) => { state.post = { ...data, media, createdAt: new Date(), updatedAt: new Date() }; return state.post; },
          update: async ({ data }) => { state.post = { ...state.post, ...data }; return state.post; },
        },
        publishedPostMedia: { create: async ({ data }) => ({ id: "m1", ...data }) },
      }),
    },
  },
});

const adapt = await import("../app/api/brands/[id]/published-posts/[postId]/adapt/route.js");

test("adapt IG→LinkedIn with sendToN8n: London 10:00 → listener gets Vancouver 02:00", async () => {
  const content = Buffer.from([1, 2, 3, 4]).toString("base64");
  const body = {
    targetPlatform: "LinkedIn", targetPostType: "static", caption: "c", status: "scheduled",
    scheduledDate: "2026-07-15T10:00", sendToN8n: true, mediaStrategy: "new",
    orderedMediaManifest: [{ action: "new", order: 1, mediaType: "IMAGE" }],
    files: [{ name: "a.png", type: "image/png", size: 4, content }],
  };
  const res = await adapt.POST(
    new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: "b1", postId: "src" }) },
  );
  const json = await res.clone().json();
  assert.ok(res.status < 300, JSON.stringify(json));
  assert.equal(received.length, 1, JSON.stringify(json));
  assert.equal(received[0]["Scheduled Date"], "15/07/2026 02:00:00");
  assert.equal(received[0].scheduled_date_utc, "2026-07-15T09:00:00.000Z");
  assert.equal(received[0].brand_timezone, "Europe/London");
  assert.equal(received[0].brand_local_publish_datetime, "2026-07-15T10:00:00");
});
