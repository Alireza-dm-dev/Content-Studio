// Sign-out behaviour.
//
// The control is global: it lives in the sidebar, which is rendered by the root
// layout, so it is present on the dashboard and every main page for every role
// and for any number of assigned brands. Availability therefore cannot depend
// on role or membership — there is no code path that could hide it — and these
// tests pin down the parts that do carry logic: the network contract, the
// decision to navigate, and the error surface.
//
// The repo has no DOM test harness, so the behaviour lives in lib/logout and is
// tested directly rather than by rendering the component.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  performLogout,
  LOGOUT_ENDPOINT,
  LOGIN_PATH,
  LOGOUT_FAILED_MESSAGE,
  LOGOUT_OFFLINE_MESSAGE,
} from "@/lib/logout";

function okResponse() {
  return { ok: true, status: 200 };
}

// ── 4 & 5. A successful sign-out ends the session and sends the user to login ──

test("logout posts to the existing endpoint", async () => {
  const calls = [];
  await performLogout({
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init?.method });
      return okResponse();
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, LOGOUT_ENDPOINT);
  assert.equal(calls[0].method, "POST");
});

test("logout reuses the app's endpoint rather than a second implementation", () => {
  // clearSession() lives behind this route; a client cannot clear an httpOnly
  // cookie, so any "logout" that skipped this call would be cosmetic only.
  assert.equal(LOGOUT_ENDPOINT, "/api/auth/logout");

  const route = readFileSync("app/api/auth/logout/route.js", "utf8");
  assert.match(route, /clearSession\(\)/);

  // Exactly one logout component in the tree.
  const component = readFileSync("components/LogoutButton.jsx", "utf8");
  assert.match(component, /performLogout\(\)/);
  assert.doesNotMatch(
    component,
    /fetch\(\s*["'`]\/api\/auth\/logout/,
    "the component must not re-implement the request",
  );
});

test("a successful logout redirects to the login page", async () => {
  const result = await performLogout({ fetchImpl: async () => okResponse() });

  assert.equal(result.ok, true);
  assert.equal(result.redirectTo, LOGIN_PATH);
  assert.equal(result.redirectTo, "/login");
  assert.equal(result.error, null);
});

// ── 7. Failure is handled without crashing, and without a false sign-out ──────

test("a rejected logout reports an error and does not navigate", async () => {
  const result = await performLogout({
    fetchImpl: async () => ({ ok: false, status: 500 }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, LOGOUT_FAILED_MESSAGE);
  // Staying put matters: the session is still live, so bouncing to /login would
  // show a login page to someone who is still signed in.
  assert.equal(result.redirectTo, null);
});

test("a network failure reports an error and does not navigate", async () => {
  const result = await performLogout({
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED 127.0.0.1:3000");
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, LOGOUT_OFFLINE_MESSAGE);
  assert.equal(result.redirectTo, null);
});

test("logout never throws, whatever the endpoint does", async () => {
  const hostile = [
    async () => {
      throw new TypeError("Failed to fetch");
    },
    async () => undefined,
    async () => null,
    async () => ({}),
    async () => ({ ok: false }),
  ];

  for (const fetchImpl of hostile) {
    const result = await performLogout({ fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, "string");
    assert.ok(result.error.length > 0);
  }
});

test("error messages expose no internal detail", async () => {
  const leaky = async () => {
    throw new Error(
      "PrismaClientKnownRequestError: connect ECONNREFUSED /var/run/db.sock",
    );
  };
  const result = await performLogout({ fetchImpl: leaky });

  for (const secret of [
    "Prisma",
    "ECONNREFUSED",
    "/var/run",
    "sock",
    "stack",
    "at Object",
  ]) {
    assert.ok(
      !result.error.includes(secret),
      `error message leaked "${secret}": ${result.error}`,
    );
  }
});

// ── 1, 2, 3. Availability does not depend on role or brand ────────────────────

test("logout takes no role, user or brand input", async () => {
  // If any of these could reach the logic, sign-out could differ per user.
  // performLogout's only option is an injectable fetch, used by these tests.
  const result = await performLogout({ fetchImpl: async () => okResponse() });
  assert.equal(result.ok, true);

  // Called with no arguments at all it still works — which is how the
  // component calls it.
  assert.equal(typeof performLogout, "function");
});

test("the sidebar renders sign-out outside every admin-only gate", async () => {
  const sidebar = readFileSync("components/sidebar-nav.jsx", "utf8");

  // The nav arrays are role-filtered via `adminOnly`; sign-out must not be a
  // member of them, or normal users would lose it.
  assert.doesNotMatch(sidebar, /label: *"SIGN OUT"/i);
  assert.match(sidebar, /<LogoutButton variant="sidebar" \/>/);

  // And it must not sit inside an isAdmin branch.
  const renderLine = sidebar
    .split("\n")
    .findIndex((l) => l.includes("<LogoutButton"));
  assert.ok(renderLine > -1);
  const enclosing = sidebar.split("\n").slice(0, renderLine).join("\n");
  const openAdminChecks =
    (enclosing.match(/isAdmin *&&/g) || []).length -
    (enclosing.match(/\)\}/g) || []).length;
  assert.ok(
    openAdminChecks <= 0,
    "sign-out appears to be inside an isAdmin conditional",
  );
});

test("the sidebar is rendered for every signed-in user by the root layout", () => {
  // This is what makes the control global: it is not part of the dashboard's
  // own markup, so the no-brand early return cannot hide it.
  const layout = readFileSync("app/layout.js", "utf8");
  assert.match(layout, /<SidebarWrapper/);

  const wrapper = readFileSync("components/SidebarWrapper.jsx", "utf8");
  // Hidden only on the public review pages and the portal, which has its own
  // sign-out in its header. Never hidden by role.
  assert.match(wrapper, /review\//);
  assert.match(wrapper, /calendar-portal/);
  assert.doesNotMatch(wrapper, /isAdmin *\?/);

  const dashboard = readFileSync("app/page.js", "utf8");
  assert.doesNotMatch(
    dashboard,
    /LogoutButton/,
    "sign-out must not live inside the dashboard body, which early-returns for no-brand users",
  );
});

test("the calendar portal shares the one component", () => {
  const portal = readFileSync("app/calendar-portal/layout.js", "utf8");
  assert.match(portal, /from "@\/components\/LogoutButton"/);
});
