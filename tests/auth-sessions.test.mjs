// Multi-session authentication: one AuthSession row per browser, scoped by
// token hash or userId. In-memory prisma stand-in that implements only the
// calls lib/auth.js makes, so a global delete/overwrite would show up here.

import { test, mock } from "node:test";
import assert from "node:assert/strict";

const users = new Map();
let sessions = [];
let jar = new Map(); // one cookie jar; tests swap it per "browser"

function addUser(u) {
  users.set(u.id, { isActive: true, role: "user", ...u });
}
addUser({ id: "arian", email: "arian@x.io", name: "Arian" });
addUser({ id: "alireza", email: "alireza@x.io", name: "Alireza" });

const matches = (row, where = {}) =>
  Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object" && "lt" in v) return row[k] < v.lt;
    return row[k] === v;
  });

mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      get: (n) => (jar.has(n) ? { name: n, value: jar.get(n) } : undefined),
      set: (n, v, opts) => {
        if (opts?.maxAge === 0 || v === "") jar.delete(n);
        else jar.set(n, v);
        lastCookieOpts = opts;
      },
    }),
  },
});
let lastCookieOpts = null;

const MEMBERSHIPS = [
  { userId: "arian", brandId: "brand-arian" },
  { userId: "alireza", brandId: "brand-alireza" },
];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      authSession: {
        create: async ({ data }) => {
          const row = { id: `s${sessions.length + 1}`, createdAt: new Date(), lastUsedAt: new Date(), ...data };
          sessions.push(row);
          return row;
        },
        findUnique: async ({ where, include }) => {
          const row = sessions.find((s) => s.tokenHash === where.tokenHash);
          if (!row) return null;
          return include?.user ? { ...row, user: users.get(row.userId) ?? null } : row;
        },
        update: async ({ where, data }) => Object.assign(sessions.find((s) => s.id === where.id), data),
        deleteMany: async ({ where }) => {
          const before = sessions.length;
          sessions = sessions.filter((s) => !matches(s, where));
          return { count: before - sessions.length };
        },
      },
      brandMembership: {
        findUnique: async ({ where }) => {
          const { userId, brandId } = where.userId_brandId;
          return MEMBERSHIPS.find((m) => m.userId === userId && m.brandId === brandId) ?? null;
        },
        findMany: async ({ where }) => MEMBERSHIPS.filter((m) => m.userId === where.userId),
      },
      brandAssignment: { findUnique: async () => null, findMany: async () => [] },
      brand: { findMany: async () => [], findUnique: async ({ where }) => ({ id: where.id }) },
    },
  },
});

const auth = await import("../lib/auth.js");
const { SESSION_COOKIE_NAME } = auth;

// Log `userId` in on a fresh "browser"; returns that browser's cookie jar.
async function loginOn(userId) {
  const browserJar = new Map();
  jar = browserJar;
  await auth.createSession(userId);
  return browserJar;
}
const as = (browserJar) => {
  jar = browserJar;
};
const tokenOf = (b) => b.get(SESSION_COOKIE_NAME);
const whoAmI = async (b) => {
  as(b);
  return (await auth.getCurrentUser())?.id ?? null;
};

test("two different users stay signed in simultaneously", async () => {
  const a = await loginOn("arian");
  const b = await loginOn("alireza");
  assert.equal(await whoAmI(a), "arian");
  assert.equal(await whoAmI(b), "alireza");
  // And again after the other has acted.
  assert.equal(await whoAmI(a), "arian");
  assert.equal(sessions.filter((s) => s.userId === "arian").length >= 1, true);
});

test("each login gets a distinct token; only hashes are stored", async () => {
  const a = await loginOn("arian");
  const b = await loginOn("alireza");
  assert.notEqual(tokenOf(a), tokenOf(b));
  for (const s of sessions) {
    assert.notEqual(s.tokenHash, tokenOf(a));
    assert.notEqual(s.tokenHash, tokenOf(b));
    assert.match(s.tokenHash, /^[0-9a-f]{64}$/);
  }
  assert.equal(lastCookieOpts.httpOnly, true);
  assert.equal(lastCookieOpts.path, "/");
  assert.equal(lastCookieOpts.sameSite, "lax");
  assert.ok(lastCookieOpts.maxAge > 0);
});

test("same user on two browsers: both valid; logout of one leaves the other", async () => {
  const a1 = await loginOn("arian");
  const a2 = await loginOn("arian");
  const b = await loginOn("alireza");
  assert.equal(await whoAmI(a1), "arian");
  assert.equal(await whoAmI(a2), "arian");

  as(a1);
  await auth.clearSession();
  assert.equal(await whoAmI(a1), null);
  assert.equal(await whoAmI(a2), "arian");
  assert.equal(await whoAmI(b), "alireza");
});

test("one user's logout does not affect another user", async () => {
  const a = await loginOn("arian");
  const b = await loginOn("alireza");
  as(a);
  await auth.clearSession();
  assert.equal(await whoAmI(a), null);
  assert.equal(await whoAmI(b), "alireza");
});

test("brand access follows the session's own user", async () => {
  const a = await loginOn("arian");
  const b = await loginOn("alireza");
  as(a);
  assert.equal(await auth.assertBrandAccess("brand-arian"), true);
  assert.equal(await auth.assertBrandAccess("brand-alireza"), false);
  as(b);
  assert.equal(await auth.assertBrandAccess("brand-alireza"), true);
  assert.equal(await auth.assertBrandAccess("brand-arian"), false);
});

test("an expired session fails while another user's stays valid", async () => {
  const a = await loginOn("arian");
  const b = await loginOn("alireza");
  const row = sessions.find((s) => s.tokenHash === auth.hashSessionToken(tokenOf(a)));
  row.expiresAt = new Date(Date.now() - 1000);
  assert.equal(await whoAmI(a), null);
  assert.equal(await whoAmI(b), "alireza");
});

test("login cleans up only expired rows, never live ones", async () => {
  const a = await loginOn("arian");
  sessions.find((s) => s.tokenHash === auth.hashSessionToken(tokenOf(a))).expiresAt = new Date(Date.now() - 1000);
  const b = await loginOn("alireza");
  const c = await loginOn("arian"); // triggers cleanup
  assert.equal(sessions.some((s) => s.expiresAt < new Date()), false);
  assert.equal(await whoAmI(b), "alireza");
  assert.equal(await whoAmI(c), "arian");
});

test("invalid, empty and forged tokens resolve to nobody", async () => {
  await loginOn("arian");
  assert.equal(await auth.getSessionUserByToken("nope"), null);
  assert.equal(await auth.getSessionUserByToken(""), null);
  assert.equal(await auth.getSessionUserByToken(undefined), null);
  assert.equal(await auth.getSessionUserByToken({ not: "a string" }), null);
  // A stored hash is not itself a usable token.
  assert.equal(await auth.getSessionUserByToken(sessions[0].tokenHash), null);
});

test("a token resolves only to the user it was issued to", async () => {
  const a = await loginOn("arian");
  await loginOn("alireza");
  assert.equal((await auth.getSessionUserByToken(tokenOf(a))).id, "arian");
});

test("deactivated user is rejected; others unaffected", async () => {
  const a = await loginOn("arian");
  const b = await loginOn("alireza");
  users.get("arian").isActive = false;
  assert.equal(await whoAmI(a), null);
  assert.equal(await whoAmI(b), "alireza");
  users.get("arian").isActive = true;
});

test("deleted user's sessions stop working (cascade); others unaffected", async () => {
  const a = await loginOn("arian");
  const b = await loginOn("alireza");
  // Simulates onDelete: Cascade plus the user row disappearing.
  sessions = sessions.filter((s) => s.userId !== "arian");
  const saved = users.get("arian");
  users.delete("arian");
  assert.equal(await whoAmI(a), null);
  assert.equal(await whoAmI(b), "alireza");
  users.set("arian", saved);
});

test("revokeUserSessions ends all of one user's sessions and nobody else's", async () => {
  const a1 = await loginOn("arian");
  const a2 = await loginOn("arian");
  const b = await loginOn("alireza");
  await auth.revokeUserSessions("arian");
  assert.equal(await whoAmI(a1), null);
  assert.equal(await whoAmI(a2), null);
  assert.equal(await whoAmI(b), "alireza");
  assert.equal(await auth.revokeUserSessions(undefined), 0);
});
