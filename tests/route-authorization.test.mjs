// Route-level authorization tests.
//
// tests/brand-access.test.mjs proves the rules; this file proves they are
// actually wired into the request path — the proxy gate that decides which
// surfaces a non-admin may reach, and a couple of representative routes that
// scope or reject on their own.

import { test, mock } from "node:test";
import assert from "node:assert/strict";

const BRAND_A = "brand-a";
const BRAND_B = "brand-b";

const admin = { id: "admin-1", role: "admin", isActive: true };
const userA = { id: "user-a", role: "user", isActive: true };
const userNone = { id: "user-none", role: "user", isActive: true };

const SESSIONS = {
  "token-admin": admin,
  "token-a": userA,
  "token-none": userNone,
};

const MEMBERSHIPS = [{ id: "m1", userId: userA.id, brandId: BRAND_A }];
const BRANDS = [
  { id: BRAND_A, name: "Brand A", createdAt: new Date("2026-01-01") },
  { id: BRAND_B, name: "Brand B", createdAt: new Date("2026-01-02") },
];
const PROMPTS = [
  { id: "p-a", brandId: BRAND_A, type: "image", finalPrompt: "A" },
  { id: "p-b", brandId: BRAND_B, type: "image", finalPrompt: "B" },
];

let currentUser = null;

function matchWhere(row, where) {
  if (!where) return true;
  if (where.brandId?.in) return where.brandId.in.includes(row.brandId);
  if (where.brandId !== undefined && typeof where.brandId === "string") {
    return row.brandId === where.brandId;
  }
  if (where.id?.in) return where.id.in.includes(row.id);
  return true;
}

mock.module("@/lib/prisma", {
  exports: {
    prisma: {
      brand: {
        findUnique: async ({ where }) => BRANDS.find((b) => b.id === where.id) ?? null,
        findMany: async ({ where } = {}) => BRANDS.filter((b) => matchWhere(b, where)),
        create: async ({ data }) => ({ id: "new-brand", ...data }),
      },
      brandMembership: {
        findUnique: async ({ where }) => {
          const { userId, brandId } = where.userId_brandId;
          return MEMBERSHIPS.find((m) => m.userId === userId && m.brandId === brandId) ?? null;
        },
        findMany: async ({ where }) => MEMBERSHIPS.filter((m) => m.userId === where.userId),
      },
      brandAssignment: {
        findUnique: async () => null,
        findMany: async () => [],
      },
      generatedPrompt: {
        findMany: async ({ where } = {}) => {
          const rows = PROMPTS.filter((p) => matchWhere(p, where));
          return rows.map((p) => ({ ...p, brand: { name: p.brandId } }));
        },
        create: async ({ data }) => ({ id: "new-prompt", ...data }),
      },
    },
  },
});

mock.module("@/lib/auth", {
  exports: {
    SESSION_COOKIE_NAME: "content_studio_session",
    getSessionUserByToken: async (token) => SESSIONS[token] ?? null,
    getCurrentUser: async () => currentUser,
  },
});

const { proxy } = await import("../proxy.js");
const brandsRoute = await import("../app/api/brands/route.js");
const promptsRoute = await import("../app/api/prompts/route.js");

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(pathname, { token, method = "GET", search = "" } = {}) {
  const url = `https://app.test${pathname}${search}`;
  return {
    method,
    url,
    nextUrl: { pathname, search },
    cookies: { get: (name) => (token ? { name, value: token } : undefined) },
  };
}

async function runProxy(pathname, opts) {
  const res = await proxy(makeRequest(pathname, opts));
  return {
    status: res.status,
    location: res.headers?.get?.("location") ?? null,
    // A pass-through carries the internal "next" marker rather than a redirect.
    passedThrough: !res.headers?.get?.("location") && res.status === 200,
  };
}

// ── The proxy gate: which surfaces a normal user may reach ────────────────────

test("a signed-in normal user reaches the main product pages", async () => {
  for (const path of [
    "/",
    "/brands",
    "/content-calendar",
    "/create-image",
    "/create-video",
    "/generated-media",
    "/generated-prompts",
    "/content-report",
    "/brand-workspace",
  ]) {
    const res = await runProxy(path, { token: "token-a" });
    assert.equal(res.location, null, `${path} should not redirect a normal user`);
  }
});

test("a normal user is kept out of the administrative pages", async () => {
  for (const path of ["/settings", "/settings/users", "/prompt-library", "/brands/new"]) {
    const res = await runProxy(path, { token: "token-a" });
    assert.match(res.location ?? "", /\/brands/, `${path} should redirect a normal user`);
  }
});

test("a normal user gets 403 from the administrative APIs", async () => {
  for (const path of [
    "/api/admin/users",
    "/api/settings",
    "/api/prompt-templates",
    "/api/generate/test",
  ]) {
    const res = await runProxy(path, { token: "token-a" });
    assert.equal(res.status, 403, `${path} should be 403 for a normal user`);
  }
});

test("creating or deleting a brand is refused for a normal user", async () => {
  const create = await runProxy("/api/brands", { token: "token-a", method: "POST" });
  assert.equal(create.status, 403);

  const remove = await runProxy(`/api/brands/${BRAND_A}`, {
    token: "token-a",
    method: "DELETE",
  });
  assert.equal(remove.status, 403);
});

test("review share-links stay admin-only for every method", async () => {
  for (const method of ["GET", "POST", "DELETE"]) {
    const res = await runProxy(`/api/brands/${BRAND_A}/reviews`, {
      token: "token-a",
      method,
    });
    assert.equal(res.status, 403, `${method} reviews should be 403`);
  }
});

test("an admin reaches every one of those surfaces", async () => {
  for (const path of ["/settings", "/api/admin/users", "/prompt-library", "/api/brands"]) {
    const res = await runProxy(path, { token: "token-admin" });
    assert.equal(res.location, null, `${path} should pass through for an admin`);
    assert.notEqual(res.status, 403);
  }
});

test("an unauthenticated API call is 401 and a page redirects to login", async () => {
  const api = await runProxy("/api/brands", {});
  assert.equal(api.status, 401);

  const page = await runProxy("/brands", {});
  assert.match(page.location ?? "", /\/login/);
});

test("a path outside the product surface is denied by default", async () => {
  // Deny-by-default: anything not explicitly opened stays closed to non-admins.
  const res = await runProxy("/api/some/future/route", { token: "token-a" });
  assert.equal(res.status, 403);
});

// ── The proxy gate: brand ids carried in the URL ──────────────────────────────

test("a normal user reaches their own brand's URLs", async () => {
  for (const path of [`/api/brands/${BRAND_A}/published-posts`, `/brands/${BRAND_A}`]) {
    const res = await runProxy(path, { token: "token-a" });
    assert.equal(res.location, null, `${path} should pass through`);
    assert.notEqual(res.status, 403);
  }
});

test("a normal user is blocked from another brand's URLs", async () => {
  const api = await runProxy(`/api/brands/${BRAND_B}/published-posts`, { token: "token-a" });
  assert.equal(api.status, 403);

  const page = await runProxy(`/brands/${BRAND_B}`, { token: "token-a" });
  assert.match(page.location ?? "", /error=forbidden/);
});

test("indirect published-post and webhook URLs are blocked for another brand", async () => {
  for (const path of [
    `/api/brands/${BRAND_B}/published-posts/some-post`,
    `/api/brands/${BRAND_B}/published-posts/some-post/send-webhook`,
    `/api/brands/${BRAND_B}/published-posts/some-post/adapt`,
    `/api/brands/${BRAND_B}/chat`,
    `/api/brands/${BRAND_B}/identity`,
    `/api/brands/${BRAND_B}/files`,
  ]) {
    const res = await runProxy(path, { token: "token-a", method: "POST" });
    assert.equal(res.status, 403, `${path} should be 403`);
  }
});

test("a user with no brands is blocked from every brand URL", async () => {
  for (const brand of [BRAND_A, BRAND_B]) {
    const res = await runProxy(`/api/brands/${brand}/published-posts`, { token: "token-none" });
    assert.equal(res.status, 403);
  }
});

test("/api/brands/mine is not mistaken for a brand id", async () => {
  const res = await runProxy("/api/brands/mine", { token: "token-none" });
  assert.notEqual(res.status, 403);
  assert.equal(res.location, null);
});

test("the public review surface stays reachable without a session", async () => {
  for (const path of ["/review/some-token", "/api/review/some-token", "/login"]) {
    const res = await runProxy(path, {});
    assert.equal(res.location, null, `${path} should pass through unauthenticated`);
    assert.notEqual(res.status, 401);
  }
});

// ── Static media and assets ───────────────────────────────────────────────────
//
// The deny-by-default rule originally swept these up, so every <img>/<video>
// on an already-authorized page 307'd to /brands and rendered "No preview".
// Static assets are not product routes and must be classified separately.

test("a normal user can load their own brand's local media", async () => {
  const res = await runProxy(
    `/uploads/${BRAND_A}/published-posts/post-1/image.png`,
    { token: "token-a" },
  );
  assert.equal(res.location, null, "own-brand media must not redirect");
  assert.notEqual(res.status, 403);
});

test("a normal user cannot load another brand's local media", async () => {
  const res = await runProxy(
    `/uploads/${BRAND_B}/published-posts/post-1/image.png`,
    { token: "token-a" },
  );
  assert.equal(res.status, 403);
  // A denial, not a redirect: an <img> must not receive an HTML page.
  assert.equal(res.location, null);
});

test("a user with no brands cannot load any brand's local media", async () => {
  for (const brand of [BRAND_A, BRAND_B]) {
    const res = await runProxy(`/uploads/${brand}/published-posts/p/i.png`, {
      token: "token-none",
    });
    assert.equal(res.status, 403);
  }
});

test("shared upload directories are not treated as brand ids", async () => {
  // Generation output and staging live beside the brand folders and belong to
  // no brand, so membership cannot be the gate for them.
  for (const dir of ["images", "reference-images", "temp-images"]) {
    const res = await runProxy(`/uploads/${dir}/openai-abc.png`, {
      token: "token-none",
    });
    assert.equal(res.location, null, `/uploads/${dir} must not redirect`);
    assert.notEqual(res.status, 403);
  }
});

test("app chrome assets load for every signed-in user", async () => {
  for (const path of ["/brand-icons/instagram.png", "/brand-icons/linkedin.png"]) {
    for (const token of ["token-a", "token-none", "token-admin"]) {
      const res = await runProxy(path, { token });
      assert.equal(res.location, null, `${path} must not redirect for ${token}`);
      assert.notEqual(res.status, 403);
    }
  }
});

test("an admin can load any brand's local media", async () => {
  for (const brand of [BRAND_A, BRAND_B]) {
    const res = await runProxy(`/uploads/${brand}/published-posts/p/i.png`, {
      token: "token-admin",
    });
    assert.equal(res.location, null);
    assert.notEqual(res.status, 403);
  }
});

test("media still requires a session", async () => {
  const res = await runProxy(`/uploads/${BRAND_A}/published-posts/p/i.png`, {});
  assert.match(res.location ?? "", /\/login/);
});

test("opening media up did not open the API surface", async () => {
  // Guard against a fix that allowed too much: the admin APIs and another
  // brand's data must still be refused.
  for (const path of ["/api/admin/users", "/api/settings", "/api/prompt-templates"]) {
    assert.equal((await runProxy(path, { token: "token-a" })).status, 403, path);
  }
  assert.equal(
    (await runProxy(`/api/brands/${BRAND_B}/published-posts`, { token: "token-a" })).status,
    403,
  );
});

// ── After sign-out, the old session is worthless ──────────────────────────────
//
// clearSession() nulls the user's sessionToken, so getSessionUserByToken stops
// resolving the cookie the browser still holds. These assert the proxy treats
// that exactly like no session at all.

test("a cleared session can no longer reach protected pages", async () => {
  for (const path of ["/", "/brands", "/brand-workspace", "/content-calendar"]) {
    const res = await runProxy(path, { token: "token-revoked" });
    assert.match(
      res.location ?? "",
      /\/login/,
      `${path} should bounce a cleared session to login`,
    );
  }
});

test("a cleared session is rejected by protected APIs", async () => {
  for (const path of [
    "/api/brands",
    `/api/brands/${BRAND_A}/published-posts`,
    "/api/prompts",
    "/api/admin/users",
  ]) {
    const res = await runProxy(path, { token: "token-revoked" });
    assert.equal(res.status, 401, `${path} should be 401 for a cleared session`);
  }
});

test("a cleared session cannot reach brand media either", async () => {
  const res = await runProxy(
    `/uploads/${BRAND_A}/published-posts/p/image.png`,
    { token: "token-revoked" },
  );
  assert.match(res.location ?? "", /\/login/);
});

test("the login page stays reachable after signing out", async () => {
  // The redirect target must not itself require a session, or sign-out loops.
  const res = await runProxy("/login", { token: "token-revoked" });
  assert.equal(res.location, null);
  assert.notEqual(res.status, 401);
});

test("the logout endpoint is reachable for every role", async () => {
  // Sign-out must never be gated by role or membership.
  for (const token of ["token-admin", "token-a", "token-none", "token-revoked"]) {
    const res = await runProxy("/api/auth/logout", { token, method: "POST" });
    assert.equal(res.location, null, `logout must not redirect for ${token}`);
    assert.notEqual(res.status, 403, `logout must not be 403 for ${token}`);
    assert.notEqual(res.status, 401, `logout must not be 401 for ${token}`);
  }
});

// ── Route handlers scope their own responses ──────────────────────────────────

test("GET /api/brands returns only the caller's brands", async () => {
  currentUser = userA;
  const res = await brandsRoute.GET();
  const body = await res.json();
  assert.deepEqual(body.map((b) => b.id), [BRAND_A]);
});

test("GET /api/brands returns everything for an admin", async () => {
  currentUser = admin;
  const res = await brandsRoute.GET();
  const body = await res.json();
  assert.deepEqual(body.map((b) => b.id).sort(), [BRAND_A, BRAND_B]);
});

test("GET /api/brands returns nothing for a user with no brands", async () => {
  currentUser = userNone;
  const res = await brandsRoute.GET();
  const body = await res.json();
  assert.deepEqual(body, []);
});

test("GET /api/brands is 401 without a session", async () => {
  currentUser = null;
  const res = await brandsRoute.GET();
  assert.equal(res.status, 401);
});

test("POST /api/brands is refused at the route for a normal user", async () => {
  // Defence in depth: the proxy already blocks this, and so does the route.
  currentUser = userA;
  const res = await brandsRoute.POST({ json: async () => ({ name: "New" }) });
  assert.equal(res.status, 403);
});

test("GET /api/prompts falls back to the caller's brands, not to all brands", async () => {
  currentUser = userA;
  const res = await promptsRoute.GET({ url: "https://app.test/api/prompts" });
  const body = await res.json();
  assert.deepEqual(body.map((p) => p.id), ["p-a"]);
});

test("GET /api/prompts refuses an explicit filter on someone else's brand", async () => {
  currentUser = userA;
  const res = await promptsRoute.GET({
    url: `https://app.test/api/prompts?brandId=${BRAND_B}`,
  });
  assert.equal(res.status, 403);
});

test("GET /api/prompts allows an explicit filter on the caller's own brand", async () => {
  currentUser = userA;
  const res = await promptsRoute.GET({
    url: `https://app.test/api/prompts?brandId=${BRAND_A}`,
  });
  const body = await res.json();
  assert.deepEqual(body.map((p) => p.id), ["p-a"]);
});

test("POST /api/prompts cannot file a prompt under an unassigned brand", async () => {
  currentUser = userA;
  const res = await promptsRoute.POST({
    json: async () => ({ finalPrompt: "x", brandId: BRAND_B }),
  });
  assert.equal(res.status, 403);
});

test("POST /api/prompts accepts the caller's own brand", async () => {
  currentUser = userA;
  const res = await promptsRoute.POST({
    json: async () => ({ finalPrompt: "x", brandId: BRAND_A }),
  });
  assert.equal(res.status, 201);
});
