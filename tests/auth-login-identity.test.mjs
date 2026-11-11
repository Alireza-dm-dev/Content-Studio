// Login identity: an email resolves to exactly one User row, never a fallback,
// and two different accounts get independent sessions.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";

const hash = bcrypt.hashSync("pw-correct-1", 4);
const USERS = [
  { id: "id-arian", email: "arian@x.io", name: "Arian", role: "user", isActive: true, passwordHash: hash },
  { id: "id-ali", email: "alireza@x.io", name: "Alireza", role: "admin", isActive: true, passwordHash: hash },
  { id: "id-off", email: "off@x.io", name: "Off", role: "user", isActive: false, passwordHash: hash },
];
let sessions = [];
let jar = new Map();

mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      get: (n) => (jar.has(n) ? { name: n, value: jar.get(n) } : undefined),
      set: (n, v, o) => (o?.maxAge === 0 ? jar.delete(n) : jar.set(n, v)),
    }),
  },
});
mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      user: {
        // Exact-match unique lookup only: no first-row / default fallback.
        findUnique: async ({ where }) => USERS.find((u) => u.email === where.email) ?? null,
      },
      authSession: {
        create: async ({ data }) => (sessions.push({ id: `s${sessions.length}`, lastUsedAt: new Date(), ...data }), data),
        findUnique: async ({ where }) => {
          const s = sessions.find((r) => r.tokenHash === where.tokenHash);
          return s ? { ...s, user: USERS.find((u) => u.id === s.userId) } : null;
        },
        update: async () => ({}),
        deleteMany: async ({ where }) => {
          sessions = sessions.filter((s) => !(where.tokenHash ? s.tokenHash === where.tokenHash : s.expiresAt < where.expiresAt.lt));
          return { count: 0 };
        },
      },
    },
  },
});

const { POST: login } = await import("../app/api/auth/login/route.js");
const { getCurrentUser } = await import("../lib/auth.js");

async function doLogin(email, password = "pw-correct-1") {
  const browser = new Map();
  jar = browser;
  const res = await login({ json: async () => ({ email, password }) });
  return { res, browser, body: await res.json() };
}
const meOn = async (b) => ((jar = b), (await getCurrentUser())?.id ?? null);

test("distinct emails resolve to distinct user ids", async () => {
  const a = await doLogin("arian@x.io");
  const b = await doLogin("alireza@x.io");
  assert.equal(a.body.id, "id-arian");
  assert.equal(b.body.id, "id-ali");
  assert.notEqual(a.body.id, b.body.id);
});

test("sessions of two different accounts are independent", async () => {
  const a = await doLogin("arian@x.io");
  const b = await doLogin("alireza@x.io");
  assert.equal(await meOn(a.browser), "id-arian");
  assert.equal(await meOn(b.browser), "id-ali");
  assert.equal(await meOn(a.browser), "id-arian");
  assert.equal(sessions.filter((s) => s.userId === "id-arian").length > 0, true);
  assert.equal(sessions.filter((s) => s.userId === "id-ali").length > 0, true);
});

test("email is trimmed and lower-cased to the same single row", async () => {
  const r = await doLogin("  ARIAN@X.IO ");
  assert.equal(r.body.id, "id-arian");
});

test("unknown email never falls back to another user", async () => {
  const r = await doLogin("nobody@x.io");
  assert.equal(r.res.status, 401);
  assert.equal(r.browser.size, 0);
});

test("right email with wrong password does not authenticate as anyone", async () => {
  const r = await doLogin("arian@x.io", "wrong");
  assert.equal(r.res.status, 401);
  assert.equal(r.browser.size, 0);
});

test("one account's password never opens another account", async () => {
  // Same password on both rows here; the email alone must select the row.
  const r = await doLogin("alireza@x.io");
  assert.equal(r.body.id, "id-ali");
  assert.notEqual(r.body.id, "id-arian");
});

test("disabled account cannot log in and creates no session", async () => {
  const before = sessions.length;
  const r = await doLogin("off@x.io");
  assert.equal(r.res.status, 401);
  assert.equal(sessions.length, before);
});
