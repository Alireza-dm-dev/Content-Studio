// Where a user lands after signing in.
//
// Normal users used to be pushed to /calendar-portal while admins went to "/".
// That was the last remaining piece of the calendar-only access model: the
// product is brand-scoped now, and the dashboard filters itself to the
// viewer's brands, so every role lands in the same place.
//
// The "next" parameter comes from the proxy, which appends it when bouncing an
// unauthenticated request to the login page. It is attacker-influenceable, so
// the open-redirect guard is tested here too.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolvePostLoginPath,
  safeNextPath,
  DEFAULT_POST_LOGIN_PATH,
} from "@/lib/post-login-redirect";

// ── 1 & 2. Landing destination by role ────────────────────────────────────────

test("a normal user lands in the main app, not the calendar portal", () => {
  const dest = resolvePostLoginPath(null, "user");
  assert.equal(dest, "/");
  assert.notEqual(dest, "/calendar-portal");
});

test("an admin lands in the main app, unchanged", () => {
  assert.equal(resolvePostLoginPath(null, "admin"), "/");
});

test("role never changes the destination", () => {
  // The two roles differ in what the landing page shows them, not in where
  // they land. Anything else would reintroduce role-based routing.
  for (const nextParam of [null, undefined, "", "/brands", "/content-calendar"]) {
    assert.equal(
      resolvePostLoginPath(nextParam, "user"),
      resolvePostLoginPath(nextParam, "admin"),
      `destination diverged by role for next=${JSON.stringify(nextParam)}`,
    );
  }
});

test("no role at all still lands somewhere sensible", () => {
  assert.equal(resolvePostLoginPath(null, undefined), DEFAULT_POST_LOGIN_PATH);
});

// ── Returning the user to where they were headed ──────────────────────────────

test("a safe next path is honoured", () => {
  for (const path of [
    "/brands",
    "/brand-workspace?brandId=abc123",
    "/content-calendar/cal-1",
    "/create-image/from-brand",
    "/generated-media",
  ]) {
    assert.equal(resolvePostLoginPath(path, "user"), path);
  }
});

test("a missing or empty next falls back to the main app", () => {
  for (const bad of [null, undefined, "", "   "]) {
    assert.equal(resolvePostLoginPath(bad, "user"), "/");
  }
});

// ── Open-redirect guard ───────────────────────────────────────────────────────

test("next cannot send the user to another origin", () => {
  for (const hostile of [
    "//evil.example.com",
    "//evil.example.com/path",
    "https://evil.example.com",
    "http://evil.example.com",
    "/\\evil.example.com",
    "/javascript:alert(1)",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "evil.example.com",
  ]) {
    assert.equal(
      safeNextPath(hostile),
      null,
      `${hostile} must be rejected as a destination`,
    );
    assert.equal(
      resolvePostLoginPath(hostile, "user"),
      "/",
      `${hostile} must fall back to the main app`,
    );
  }
});

test("next cannot carry control characters", () => {
  for (const hostile of ["/brands\nSet-Cookie: x=1", "/brands\r\nLocation: /evil", "/bra\tnds"]) {
    assert.equal(safeNextPath(hostile), null);
  }
});

test("next cannot loop back to the login page", () => {
  for (const looping of ["/login", "/login?next=/brands", "/login/"]) {
    assert.equal(safeNextPath(looping), null);
    assert.equal(resolvePostLoginPath(looping, "user"), "/");
  }
});

test("a non-string next is rejected", () => {
  for (const bad of [42, {}, [], true, null, undefined]) {
    assert.equal(safeNextPath(bad), null);
  }
});

test("a path that merely contains a colon later on is still allowed", () => {
  // Only a scheme before the first slash escapes the origin; a colon deeper in
  // the path is ordinary data and must not be rejected.
  assert.equal(safeNextPath("/brands/abc/notes:draft"), "/brands/abc/notes:draft");
});
