// Published-post deletion → n8n external delete webhook.
//
// Covers the route (authorization, platform gating, delete ordering, failure
// policy) and the helper's platform normalization / payload shape. Every test
// points the webhook at a fake URL and mocks fetch, so no request ever leaves
// the machine and no real social post is touched.

import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "generated") continue;
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

// Every test runs against a fake, unroutable webhook URL. The real production
// URL is configuration-only and never appears in source or in these tests.
const TEST_WEBHOOK_URL = "https://n8n.example.invalid/webhook/test-delete-hook";
process.env.N8N_PUBLISHED_POST_DELETE_WEBHOOK_URL = TEST_WEBHOOK_URL;

const BRAND_A = "brand-a";
const BRAND_B = "brand-b";

const admin = { id: "admin-1", role: "admin", isActive: true };
const userA = { id: "user-a", role: "user", isActive: true };
const userNone = { id: "user-none", role: "user", isActive: true };

const BRANDS = [
  { id: BRAND_A, name: "Brand A" },
  { id: BRAND_B, name: "Brand B" },
];
const MEMBERSHIPS = [{ id: "m1", userId: userA.id, brandId: BRAND_A }];

let currentUser = null;
let settingsRow = null;
let posts = [];
let deletedIds = [];
let fetchCalls = [];
let fetchImpl = null;

function makePost(overrides = {}) {
  return {
    id: "post-1",
    brandId: BRAND_A,
    platform: "Instagram",
    postType: "static",
    caption: "Hello",
    status: "published",
    scheduledDate: new Date("2026-03-01T10:00:00.000Z"),
    createdAt: new Date("2026-02-01T10:00:00.000Z"),
    notes: null,
    thumbnailUrl: null,
    postNumber: 42,
    jsonPayload: JSON.stringify({
      "Post ID": "POST-0042",
      Platform: "Instagram",
      media: [{ order: 1, url: "https://files.example.com/a.jpg", media_type: "IMAGE" }],
    }),
    media: [
      {
        id: "media-1",
        publishedPostId: "post-1",
        url: "/uploads/brand-a/published-posts/post-1/a.jpg",
        mediaType: "IMAGE",
        order: 1,
      },
    ],
    ...overrides,
  };
}

mock.module("@/lib/prisma", {
  exports: {
    prisma: {
      settings: { findUnique: async () => settingsRow },
      brand: {
        findUnique: async ({ where }) => BRANDS.find((b) => b.id === where.id) ?? null,
      },
      brandMembership: {
        findUnique: async ({ where }) => {
          const { userId, brandId } = where.userId_brandId;
          return (
            MEMBERSHIPS.find((m) => m.userId === userId && m.brandId === brandId) ?? null
          );
        },
      },
      brandAssignment: { findUnique: async () => null },
      publishedPost: {
        findFirst: async ({ where }) =>
          posts.find((p) => p.id === where.id && p.brandId === where.brandId) ?? null,
        delete: async ({ where }) => {
          deletedIds.push(where.id);
          posts = posts.filter((p) => p.id !== where.id);
          return { id: where.id };
        },
      },
    },
  },
});

mock.module("@/lib/auth", {
  exports: {
    getCurrentUser: async () => currentUser,
    SESSION_COOKIE_NAME: "content_studio_session",
  },
});

const { DELETE } = await import(
  "../app/api/brands/[id]/published-posts/[postId]/route.js"
);
const {
  normalizeDeleteWebhookPlatform,
  requiresExternalDeleteWebhook,
  buildDeleteEventId,
  buildPublishedPostDeletePayload,
} = await import("@/lib/published-post-delete-webhook");

globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url, init, body: JSON.parse(init.body) });
  return fetchImpl(url, init);
};

function ok(body = "") {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => body,
  };
}

function notOk(status, body = "") {
  return {
    ok: false,
    status,
    statusText: "Error",
    text: async () => body,
  };
}

function callDelete(brandId, postId) {
  return DELETE(new Request("http://localhost/x", { method: "DELETE" }), {
    params: Promise.resolve({ id: brandId, postId }),
  });
}

beforeEach(() => {
  currentUser = admin;
  settingsRow = null;
  process.env.N8N_PUBLISHED_POST_DELETE_WEBHOOK_URL = TEST_WEBHOOK_URL;
  posts = [makePost()];
  deletedIds = [];
  fetchCalls = [];
  fetchImpl = async () => ok('{"success":true}');
});

// ── 1 / 8 ───────────────────────────────────────────────────────────────────
test("Instagram delete calls the webhook exactly once, then deletes locally", async () => {
  const res = await callDelete(BRAND_A, "post-1");

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { success: true });
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, TEST_WEBHOOK_URL);
  assert.equal(fetchCalls[0].init.method, "POST");
  assert.deepEqual(deletedIds, ["post-1"]);
});

// ── 2 ───────────────────────────────────────────────────────────────────────
test("LinkedIn delete calls the webhook exactly once", async () => {
  posts = [makePost({ platform: "LinkedIn" })];

  const res = await callDelete(BRAND_A, "post-1");

  assert.equal(res.status, 200);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.platform, "LinkedIn");
  assert.deepEqual(deletedIds, ["post-1"]);
});

// ── 3 ───────────────────────────────────────────────────────────────────────
test("platform comparison tolerates the casings actually stored", () => {
  for (const value of ["Instagram", "instagram", "INSTAGRAM", " Instagram "]) {
    assert.equal(normalizeDeleteWebhookPlatform(value), "Instagram", value);
  }
  for (const value of ["LinkedIn", "linkedin", "Linkedin", "LINKEDIN", "linked-in"]) {
    assert.equal(normalizeDeleteWebhookPlatform(value), "LinkedIn", value);
  }
  for (const value of ["Facebook", "x", "twitter", "YouTube", "", null, undefined, 7]) {
    assert.equal(normalizeDeleteWebhookPlatform(value), null, String(value));
    assert.equal(requiresExternalDeleteWebhook(value), false, String(value));
  }
});

test("a lowercase stored platform still triggers the webhook", async () => {
  posts = [makePost({ platform: "linkedin" })];

  const res = await callDelete(BRAND_A, "post-1");

  assert.equal(res.status, 200);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.platform, "LinkedIn");
});

// ── 4 ───────────────────────────────────────────────────────────────────────
test("unsupported and missing platforms delete as before, with no webhook", async () => {
  for (const platform of ["Facebook", "X", "YouTube", "", null]) {
    posts = [makePost({ platform })];
    deletedIds = [];
    fetchCalls = [];

    const res = await callDelete(BRAND_A, "post-1");

    assert.equal(res.status, 200, String(platform));
    assert.equal(fetchCalls.length, 0, String(platform));
    assert.deepEqual(deletedIds, ["post-1"], String(platform));
  }
});

// ── 5 ───────────────────────────────────────────────────────────────────────
test("a user without brand access gets 403 and fires no webhook", async () => {
  currentUser = userNone;

  const res = await callDelete(BRAND_A, "post-1");

  assert.equal(res.status, 403);
  assert.equal(fetchCalls.length, 0);
  assert.deepEqual(deletedIds, []);
  assert.equal(posts.length, 1);
});

test("a cross-brand guessed post id gets 403 and fires no webhook", async () => {
  currentUser = userA; // member of BRAND_A only

  const res = await callDelete(BRAND_B, "post-1");

  assert.equal(res.status, 403);
  assert.equal(fetchCalls.length, 0);
  assert.deepEqual(deletedIds, []);
});

test("an anonymous request gets 401 and fires no webhook", async () => {
  currentUser = null;

  const res = await callDelete(BRAND_A, "post-1");

  assert.equal(res.status, 401);
  assert.equal(fetchCalls.length, 0);
});

// ── 6 ───────────────────────────────────────────────────────────────────────
test("a nonexistent post id gets 404 and fires no webhook", async () => {
  const res = await callDelete(BRAND_A, "post-does-not-exist");

  assert.equal(res.status, 404);
  assert.equal(fetchCalls.length, 0);
  assert.deepEqual(deletedIds, []);
});

// ── 7 ───────────────────────────────────────────────────────────────────────
test("the webhook payload identifies the post, brand, platform and actor", async () => {
  currentUser = userA;

  await callDelete(BRAND_A, "post-1");

  const body = fetchCalls[0].body;
  assert.equal(body.event, "published_post.delete");
  assert.equal(body.action, "delete");
  assert.equal(body.eventId, "published-post-delete:post-1");
  assert.equal(body.postId, "post-1");
  assert.equal(body.postRef, "POST-0042");
  assert.equal(body.row_number, 42);
  assert.equal(body.platform, "Instagram");
  assert.equal(body.Platform, "Instagram");
  assert.equal(body.brandId, BRAND_A);
  assert.equal(body.brandName, "Brand A");
  assert.equal(body.brand, "Brand A");
  assert.equal(body.postType, "static");
  assert.equal(body.status, "published");
  assert.equal(body.scheduledDate, "2026-03-01T10:00:00.000Z");
  assert.deepEqual(body.deletedBy, { userId: "user-a", role: "user" });

  // The exact publish payload n8n last saw, so it can match the external post.
  assert.equal(body.post["Post ID"], "POST-0042");
  assert.deepEqual(body.post.media, [
    { order: 1, url: "https://files.example.com/a.jpg", media_type: "IMAGE" },
  ]);

  // Idempotency key for retries after a lost response.
  assert.equal(fetchCalls[0].init.headers["Idempotency-Key"], "published-post-delete:post-1");
  assert.equal(buildDeleteEventId("post-1"), "published-post-delete:post-1");

  // No credentials or session material in the payload.
  const serialized = JSON.stringify(body);
  for (const leak of ["sessionToken", "passwordHash", "OPENAI_API_KEY", "Authorization"]) {
    assert.ok(!serialized.includes(leak), `payload leaked ${leak}`);
  }
});

test("the payload omits an external post id rather than inventing one", () => {
  const payload = buildPublishedPostDeletePayload({
    post: makePost(),
    media: [],
    brand: { id: BRAND_A, name: "Brand A" },
    user: admin,
  });
  assert.ok(!("externalPostId" in payload));
  assert.ok(!("externalPostUrl" in payload));
});

// ── 9 / 11 ──────────────────────────────────────────────────────────────────
test("a non-2xx webhook response keeps the local post", async () => {
  fetchImpl = async () => notOk(500, "workflow error");

  const res = await callDelete(BRAND_A, "post-1");

  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.code, "DELETE_WEBHOOK_FAILED");
  assert.match(body.error, /did not confirm success/);
  assert.match(body.error, /Instagram/);
  assert.deepEqual(deletedIds, []);
  assert.equal(posts.length, 1);
});

test("a 2xx response that reports failure keeps the local post", async () => {
  fetchImpl = async () => ok('{"success":false,"error":"instagram api rejected"}');

  const res = await callDelete(BRAND_A, "post-1");

  assert.equal(res.status, 502);
  assert.equal((await res.json()).code, "DELETE_WEBHOOK_REPORTED_FAILURE");
  assert.deepEqual(deletedIds, []);
});

test("a network error keeps the local post", async () => {
  fetchImpl = async () => {
    throw new TypeError("fetch failed");
  };

  const res = await callDelete(BRAND_A, "post-1");

  assert.equal(res.status, 502);
  assert.equal((await res.json()).code, "DELETE_WEBHOOK_NETWORK_ERROR");
  assert.deepEqual(deletedIds, []);
  assert.equal(posts.length, 1);
});

// ── 10 ──────────────────────────────────────────────────────────────────────
test("a webhook timeout keeps the local post", async () => {
  fetchImpl = async () => {
    const err = new Error("The operation was aborted.");
    err.name = "AbortError";
    throw err;
  };

  const res = await callDelete(BRAND_A, "post-1");

  assert.equal(res.status, 504);
  const body = await res.json();
  assert.equal(body.code, "DELETE_WEBHOOK_TIMEOUT");
  assert.match(body.error, /did not respond in time/);
  assert.deepEqual(deletedIds, []);
  assert.equal(posts.length, 1);
});

test("an empty 2xx body counts as success", async () => {
  fetchImpl = async () => ok("");

  const res = await callDelete(BRAND_A, "post-1");

  assert.equal(res.status, 200);
  assert.deepEqual(deletedIds, ["post-1"]);
});

// ── 12 ──────────────────────────────────────────────────────────────────────
test("the delete buttons cannot start a second request while one is in flight", () => {
  for (const file of [
    "components/PostDetailModal.jsx",
    "components/LinkedInPostDetailModal.jsx",
  ]) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const handler = src.slice(src.indexOf("async function handleDelete()"));
    assert.match(
      handler.slice(0, 200),
      /if \(deleting\) return;/,
      `${file} is missing the in-flight guard`,
    );
    assert.ok(src.includes("disabled={deleting}"), `${file} delete button is not disabled`);
    assert.ok(
      src.includes('"Deleting\\u2026"') || src.includes("Deleting\u2026"),
      `${file} has no pending label`,
    );
  }
});

// ── 13 ──────────────────────────────────────────────────────────────────────
test("dependent records are still removed by cascade, not by hand", async () => {
  await callDelete(BRAND_A, "post-1");

  // A single publishedPost.delete — media and comments cascade in the schema.
  assert.deepEqual(deletedIds, ["post-1"]);
});

// ── 14 / 15 ─────────────────────────────────────────────────────────────────
test("an admin may delete a post in a brand they are not a member of", async () => {
  currentUser = admin;
  posts = [makePost({ brandId: BRAND_B })];

  const res = await callDelete(BRAND_B, "post-1");

  assert.equal(res.status, 200);
  assert.equal(fetchCalls.length, 1);
  assert.deepEqual(fetchCalls[0].body.deletedBy, { userId: "admin-1", role: "admin" });
  assert.deepEqual(deletedIds, ["post-1"]);
});

test("an assigned user may delete a post in their own brand", async () => {
  currentUser = userA;

  const res = await callDelete(BRAND_A, "post-1");

  assert.equal(res.status, 200);
  assert.equal(fetchCalls.length, 1);
  assert.deepEqual(deletedIds, ["post-1"]);
});

// ── 16 ──────────────────────────────────────────────────────────────────────
test("no webhook URL or config name reaches client code", () => {
  for (const file of [
    "components/PostDetailModal.jsx",
    "components/LinkedInPostDetailModal.jsx",
    "components/PublishedPostsSection.jsx",
    "components/LinkedInPublishedPostsSection.jsx",
  ]) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.ok(!src.includes("n8n.leadsagna.com"), `${file} contains a webhook URL`);
    assert.ok(
      !src.includes("DELETE_WEBHOOK_URL"),
      `${file} references the webhook config name`,
    );
    assert.ok(
      !src.includes("published-post-delete-webhook"),
      `${file} imports the server-only webhook helper`,
    );
  }
});

// ── configuration policy ────────────────────────────────────────────────────
test("the production webhook URL literal exists nowhere in application source", () => {
  const roots = ["lib", "app", "components", "scripts"];
  const hits = [];
  for (const root of roots) {
    const dir = fileURLToPath(new URL(`../${root}`, import.meta.url));
    for (const file of walk(dir)) {
      if (!/\.(js|jsx|mjs|ts|tsx)$/.test(file)) continue;
      const src = readFileSync(file, "utf8");
      if (src.includes("2e02f746-d6e0-434a-8e8c-00cd61102a65")) hits.push(file);
    }
  }
  assert.deepEqual(hits, [], `production webhook URL hardcoded in: ${hits.join(", ")}`);
});

test(".env.example documents the key without the production value", () => {
  const src = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(src, /^N8N_PUBLISHED_POST_DELETE_WEBHOOK_URL=\s*$/m);
  assert.ok(!src.includes("n8n.leadsagna.com"), ".env.example holds a real URL");
});

test("the environment value is used when configured", async () => {
  process.env.N8N_PUBLISHED_POST_DELETE_WEBHOOK_URL =
    "https://env.example.invalid/hook";

  const res = await callDelete(BRAND_A, "post-1");

  assert.equal(res.status, 200);
  assert.equal(fetchCalls[0].url, "https://env.example.invalid/hook");
});

test("a Settings-table value wins over the environment", async () => {
  settingsRow = { key: "N8N_PUBLISHED_POST_DELETE_WEBHOOK_URL", value: "https://settings.example.invalid/hook" };

  const res = await callDelete(BRAND_A, "post-1");

  assert.equal(res.status, 200);
  assert.equal(fetchCalls[0].url, "https://settings.example.invalid/hook");
});

test("an invalid Settings value falls through to the environment", async () => {
  settingsRow = { key: "N8N_PUBLISHED_POST_DELETE_WEBHOOK_URL", value: "not a url" };

  const res = await callDelete(BRAND_A, "post-1");

  assert.equal(res.status, 200);
  assert.equal(fetchCalls[0].url, TEST_WEBHOOK_URL);
});

test("missing configuration fails safely and keeps the local post", async () => {
  for (const platform of ["Instagram", "LinkedIn"]) {
    delete process.env.N8N_PUBLISHED_POST_DELETE_WEBHOOK_URL;
    settingsRow = null;
    posts = [makePost({ platform })];
    deletedIds = [];
    fetchCalls = [];

    const res = await callDelete(BRAND_A, "post-1");

    assert.equal(res.status, 500, platform);
    const body = await res.json();
    assert.equal(body.code, "DELETE_WEBHOOK_NOT_CONFIGURED", platform);
    assert.equal(body.error, "Published-post delete webhook is not configured.");
    assert.equal(fetchCalls.length, 0, platform);
    assert.deepEqual(deletedIds, [], platform);
    assert.equal(posts.length, 1, platform);
  }
});

test("unsupported platforms still delete normally with no webhook configured", async () => {
  delete process.env.N8N_PUBLISHED_POST_DELETE_WEBHOOK_URL;
  settingsRow = null;

  for (const platform of ["Facebook", "X", "YouTube", "", null]) {
    posts = [makePost({ platform })];
    deletedIds = [];
    fetchCalls = [];

    const res = await callDelete(BRAND_A, "post-1");

    assert.equal(res.status, 200, String(platform));
    assert.equal(fetchCalls.length, 0, String(platform));
    assert.deepEqual(deletedIds, ["post-1"], String(platform));
  }
});
