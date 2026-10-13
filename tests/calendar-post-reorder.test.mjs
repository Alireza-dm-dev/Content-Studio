// Drag-to-reorder for posts in a saved calendar:
//   PATCH /api/calendars/[id]/posts/reorder  (+ the pure helpers the UI uses)
//
// postNumber is the canonical order and has no unique constraint; the server
// derives numbers from array position, renumbers in one transaction, and never
// touches anything but postNumber.

import { test, mock } from "node:test";
import assert from "node:assert/strict";

import {
  moveItem,
  numberByPosition,
  validateOrderedPostIds,
  applyOrderToPosts,
  createReorderGate,
  reorderPostsOptimistically,
} from "../lib/calendar-post-order.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FORMATS = ["Static", "Carousel", "Reel", "Carousel", "Static"];
const mkPost = (n, calendarId = "cal-1") => ({
  id: `post-${calendarId}-${n}`,
  calendarId,
  postNumber: n,
  date: new Date(`2026-10-${String(n * 3).padStart(2, "0")}`), // deliberately NOT in post order after a move
  platform: n % 2 ? "Instagram" : "LinkedIn",
  format: FORMATS[(n - 1) % 5],
  suggestedHook: `Hook ${n}`,
  suggestedCaption: `Caption ${n} #tag${n}`,
  hashtags: `#tag${n}`,
  contentStructure: `Slide 1: a${n}\nSlide 2: b${n}`,
  visualDirection: `Visual ${n}`,
  status: n === 2 ? "approved" : "draft",
  postData: JSON.stringify({ caption: `Caption ${n} #tag${n}`, hashtags: [`#tag${n}`], textOnVideo: `tov${n}` }),
});

const BRAND_A = "brand-a";
const BRAND_B = "brand-b";
const admin = { id: "admin-1", role: "admin" };
const userA = { id: "user-a", role: "user" };
const userNone = { id: "user-none", role: "user" };

const state = { user: admin, calendars: null, posts: null, media: null, files: null, history: [], failOnUpdate: null, updateCount: 0 };
function freshState() {
  state.calendars = {
    "cal-1": { id: "cal-1", brandId: BRAND_A, status: "draft" },
    "cal-approved": { id: "cal-approved", brandId: BRAND_A, status: "approved" },
    "cal-b": { id: "cal-b", brandId: BRAND_B, status: "draft" },
    "cal-2": { id: "cal-2", brandId: BRAND_A, status: "draft" },
  };
  state.posts = [1, 2, 3, 4, 5].map(n => mkPost(n)).concat([mkPost(1, "cal-2"), mkPost(1, "cal-approved"), mkPost(1, "cal-b")]);
  state.media = [
    { id: "m1", calendarPostId: "post-cal-1-1", filePath: "uploads/images/a.png" },
    { id: "m2", calendarPostId: "post-cal-1-3", filePath: "uploads/images/b.png" },
  ];
  state.files = [{ id: "f1", calendarPostId: "post-cal-1-2", purpose: "calendar_post_regeneration_reference" }];
  state.history = [];
  state.failOnUpdate = null;
  state.updateCount = 0;
}
freshState();
const clone = (x) => JSON.parse(JSON.stringify(x), (k, v) => (typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(v) : v));

const numbersIn = (calendarId) => state.posts.filter(p => p.calendarId === calendarId).map(p => p.postNumber);
const calendarOrder = (calendarId) =>
  state.posts.filter(p => p.calendarId === calendarId).sort((a, b) => a.postNumber - b.postNumber).map(p => p.id);

const txApi = {
  calendarPost: {
    findMany: async ({ where, orderBy }) => {
      let rows = state.posts.filter(p => p.calendarId === where.calendarId).map(p => ({ ...p }));
      if (orderBy) rows = rows.sort((a, b) => a.postNumber - b.postNumber);
      return rows;
    },
    update: async ({ where, data }) => {
      state.updateCount++;
      if (state.failOnUpdate && state.updateCount === state.failOnUpdate) throw new Error("db write failed");
      const row = state.posts.find(p => p.id === where.id);
      state.lastUpdate = data;
      Object.assign(row, data);
      state.history.push(state.posts.filter(p => p.calendarId === row.calendarId).map(p => p.postNumber));
      return { ...row };
    },
  },
};

mock.module("@/lib/prisma", {
  exports: {
    prisma: {
      contentCalendar: { findUnique: async ({ where }) => (state.calendars[where.id] ? { ...state.calendars[where.id] } : null) },
      calendarPost: {
        ...txApi.calendarPost,
        findUnique: async ({ where }) => {
          const row = state.posts.find(p => p.id === where.id);
          return row ? { id: row.id, postData: row.postData, calendar: { ...state.calendars[row.calendarId] } } : null;
        },
      },
      $transaction: async (fn) => {
        const snapshot = clone(state.posts);
        try { return await fn(txApi); }
        catch (e) { state.posts = snapshot; throw e; }
      },
    },
  },
});

// Mirrors lib/auth.assertCalendarAccess + getBrandCalendarAccess: unknown calendar 404,
// no session 401, admin allowed, member of the calendar's brand allowed, anyone else 403.
// (The real functions are covered by tests/brand-access.test.mjs.)
mock.module("@/lib/auth", {
  exports: {
    assertCalendarAccess: async (calendarId) => {
      const cal = state.calendars[calendarId];
      if (!cal) return { allowed: false, error: "Calendar not found", status: 404 };
      if (!state.user) return { allowed: false, error: "Authentication required", status: 401 };
      if (state.user.role === "admin") return { allowed: true, user: state.user, isAdmin: true, membership: null };
      if (state.user.id === userA.id && cal.brandId === BRAND_A) return { allowed: true, user: state.user, isAdmin: false, membership: {} };
      return { allowed: false, error: "You do not have access to this brand.", status: 403 };
    },
    getBrandCalendarAccess: async (brandId) => {
      if (!state.user) return { allowed: false, error: "Authentication required", status: 401 };
      if (state.user.role === "admin") return { allowed: true, isAdmin: true, user: state.user };
      if (state.user.id === userA.id && brandId === BRAND_A) return { allowed: true, isAdmin: false, user: state.user };
      return { allowed: false, error: "You do not have access to this brand.", status: 403 };
    },
  },
});

const route = await import("../app/api/calendars/[id]/posts/reorder/route.js");
const listRoute = await import("../app/api/calendars/[id]/posts/route.js");
const postRoute = await import("../app/api/calendar-posts/[id]/route.js");

const patch = (calendarId, body) => {
  freshHistory();
  return route.PATCH(
    new Request(`https://app.test/api/calendars/${calendarId}/posts/reorder`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: calendarId }) }
  );
};
function freshHistory() { state.history = []; state.updateCount = 0; }
const id = (n) => `post-cal-1-${n}`;
const reset = () => { freshState(); state.user = admin; };

// ── Pure helpers ──────────────────────────────────────────────────────────────

test("moveItem: drag 1 after 3, last to first, first to last, middle to middle", () => {
  assert.deepEqual(moveItem([1, 2, 3, 4], 0, 2), [2, 3, 1, 4]);
  assert.deepEqual(moveItem([1, 2, 3, 4, 5], 4, 0), [5, 1, 2, 3, 4]);
  assert.deepEqual(moveItem([1, 2, 3, 4, 5], 0, 4), [2, 3, 4, 5, 1]);
  assert.deepEqual(moveItem([1, 2, 3, 4, 5], 1, 3), [1, 3, 4, 2, 5]);
  assert.deepEqual(moveItem([1, 2, 3], 1, 1), [1, 2, 3]);
  assert.deepEqual(moveItem([1, 2, 3], 5, 0), [1, 2, 3]);
});

test("numberByPosition numbers 1..N from array position", () => {
  assert.deepEqual(numberByPosition(["b", "a"]), [{ id: "b", postNumber: 1 }, { id: "a", postNumber: 2 }]);
});

test("validateOrderedPostIds: exact set required", () => {
  const ex = ["a", "b", "c"];
  assert.equal(validateOrderedPostIds(ex, ["c", "a", "b"]).ok, true);
  assert.equal(validateOrderedPostIds(ex, "abc").status, 400);
  assert.equal(validateOrderedPostIds(ex, ["a", 2, "c"]).status, 400);
  assert.equal(validateOrderedPostIds(ex, ["a", "a", "b"]).status, 400);
  assert.equal(validateOrderedPostIds(ex, ["a", "b"]).status, 422);          // missing
  assert.equal(validateOrderedPostIds(ex, ["a", "b", "c", "d"]).status, 422); // extra
  assert.equal(validateOrderedPostIds(ex, ["a", "b", "x"]).status, 422);      // foreign
});

// ── Reorder through the route ─────────────────────────────────────────────────

async function reorderTo(ids) {
  reset();
  const res = await patch("cal-1", { orderedPostIds: ids });
  return { res, data: await res.json() };
}

test("scenario A: 1,2,3,4,5 → drag 1 after 3: old2→#1, old3→#2, old1→#3, old4→#4, old5→#5", async () => {
  const { res, data } = await reorderTo([id(2), id(3), id(1), id(4), id(5)]);
  assert.equal(res.status, 200);
  assert.deepEqual(data.order, [
    { id: id(2), postNumber: 1 }, { id: id(3), postNumber: 2 }, { id: id(1), postNumber: 3 },
    { id: id(4), postNumber: 4 }, { id: id(5), postNumber: 5 },
  ]);
  assert.deepEqual(calendarOrder("cal-1"), [id(2), id(3), id(1), id(4), id(5)]);
});

test("scenario B: last post to the beginning", async () => {
  const { res } = await reorderTo([id(5), id(1), id(2), id(3), id(4)]);
  assert.equal(res.status, 200);
  assert.deepEqual(calendarOrder("cal-1"), [id(5), id(1), id(2), id(3), id(4)]);
  assert.equal(state.posts.find(p => p.id === id(5)).postNumber, 1);
  assert.equal(state.posts.find(p => p.id === id(4)).postNumber, 5);
});

test("first to last, and middle to middle", async () => {
  await reorderTo([id(2), id(3), id(4), id(5), id(1)]);
  assert.deepEqual(calendarOrder("cal-1"), [id(2), id(3), id(4), id(5), id(1)]);
  await reorderTo([id(1), id(3), id(4), id(2), id(5)]);
  assert.deepEqual(calendarOrder("cal-1"), [id(1), id(3), id(4), id(2), id(5)]);
});

test("end state is exactly 1..N: no gaps, no duplicates — including when the DB had gaps/nulls", async () => {
  reset();
  state.posts.filter(p => p.calendarId === "cal-1").forEach((p, i) => { p.postNumber = [3, 3, 9, null, 20][i]; });
  const res = await patch("cal-1", { orderedPostIds: [id(5), id(4), id(3), id(2), id(1)] });
  assert.equal(res.status, 200);
  assert.deepEqual(numbersIn("cal-1").sort((a, b) => a - b), [1, 2, 3, 4, 5]);
});

test("no intermediate state ever has two posts with the same number", async () => {
  await reorderTo([id(2), id(3), id(1), id(4), id(5)]);
  for (const snapshot of state.history) {
    const nums = snapshot.filter(n => n != null);
    assert.equal(new Set(nums).size, nums.length, `duplicate in ${JSON.stringify(snapshot)}`);
  }
  assert.ok(state.history.some(s => s.some(n => n < 0)), "two-phase renumber uses parked negative numbers");
});

test("only postNumber changes: ids, content, dates, platform, format, status and postData are identical", async () => {
  reset();
  const before = clone(state.posts);
  await patch("cal-1", { orderedPostIds: [id(5), id(1), id(2), id(3), id(4)] });
  for (const b of before) {
    const a = state.posts.find(p => p.id === b.id);
    const { postNumber: _b, ...bRest } = b;
    const { postNumber: _a, ...aRest } = a;
    assert.deepEqual(aRest, bRest, b.id);
    assert.equal(a.date.getTime(), b.date.getTime()); // dates are NOT rescheduled
  }
  // dates are no longer in post-number order — that is intentional
  const byNumber = state.posts.filter(p => p.calendarId === "cal-1").sort((x, y) => x.postNumber - y.postNumber);
  assert.ok(byNumber[0].date > byNumber[1].date);
});

test("other calendars are untouched", async () => {
  reset();
  const before = clone(state.posts.filter(p => p.calendarId !== "cal-1"));
  await patch("cal-1", { orderedPostIds: [id(5), id(4), id(3), id(2), id(1)] });
  assert.deepEqual(state.posts.filter(p => p.calendarId !== "cal-1"), before);
});

test("generated media and reference files stay linked to the same posts", async () => {
  reset();
  const media = clone(state.media), files = clone(state.files);
  await patch("cal-1", { orderedPostIds: [id(3), id(2), id(1), id(5), id(4)] });
  assert.deepEqual(state.media, media);
  assert.deepEqual(state.files, files);
});

test("client-supplied numbers are ignored: the server derives them from position", async () => {
  reset();
  const res = await patch("cal-1", {
    orderedPostIds: [id(2), id(1), id(3), id(4), id(5)],
    postNumbers: { [id(1)]: 99 }, order: [{ id: id(1), postNumber: 99 }],
  });
  assert.equal(res.status, 200);
  assert.equal(state.posts.find(p => p.id === id(1)).postNumber, 2);
});

// ── Authorization ─────────────────────────────────────────────────────────────

const valid = () => ({ orderedPostIds: [id(2), id(1), id(3), id(4), id(5)] });

test("admin can reorder any accessible calendar", async () => {
  reset(); state.user = admin;
  assert.equal((await patch("cal-1", valid())).status, 200);
  assert.equal((await patch("cal-b", { orderedPostIds: ["post-cal-b-1"] })).status, 200);
});

test("a user assigned to the brand can reorder its draft calendar", async () => {
  reset(); state.user = userA;
  assert.equal((await patch("cal-1", valid())).status, 200);
});

test("assigned user + draft calendar → succeeds", async () => {
  reset(); state.user = userA;
  assert.equal((await patch("cal-1", valid())).status, 200);
});

test("assigned user + approved (non-draft) calendar → succeeds and changes only postNumber", async () => {
  reset(); state.user = userA;
  const before = clone(state.posts);
  const res = await patch("cal-approved", { orderedPostIds: ["post-cal-approved-1"] });
  assert.equal(res.status, 200);
  assert.equal(state.calendars["cal-approved"].status, "approved"); // status untouched
  assert.deepEqual(state.posts.filter(p => p.calendarId !== "cal-approved"), before.filter(p => p.calendarId !== "cal-approved"));
});

test("assigned user can reorder a multi-post approved calendar", async () => {
  reset(); state.user = userA;
  state.posts.push(mkPost(2, "cal-approved"), mkPost(3, "cal-approved"));
  const ids = ["post-cal-approved-3", "post-cal-approved-1", "post-cal-approved-2"];
  const res = await patch("cal-approved", { orderedPostIds: ids });
  assert.equal(res.status, 200);
  assert.deepEqual(calendarOrder("cal-approved"), ids);
});

test("admin + approved calendar → succeeds", async () => {
  reset(); state.user = admin;
  assert.equal((await patch("cal-approved", { orderedPostIds: ["post-cal-approved-1"] })).status, 200);
});

test("unassigned user → 403 on draft and approved calendars", async () => {
  reset(); state.user = userNone;
  assert.equal((await patch("cal-1", valid())).status, 403);
  assert.equal((await patch("cal-approved", { orderedPostIds: ["post-cal-approved-1"] })).status, 403);
});

test("assigned user + post IDs from another brand's calendar → rejected, nothing written", async () => {
  reset(); state.user = userA;
  const before = clone(state.posts);
  const res = await patch("cal-1", { orderedPostIds: [id(1), id(2), id(3), id(4), "post-cal-b-1"] });
  assert.equal(res.status, 422);
  assert.deepEqual(state.posts, before);
});

test("an unassigned user and a cross-brand calendar → 403 with no writes", async () => {
  reset(); state.user = userNone;
  const before = clone(state.posts);
  assert.equal((await patch("cal-1", valid())).status, 403);
  state.user = userA; // assigned to brand A only
  assert.equal((await patch("cal-b", { orderedPostIds: ["post-cal-b-1"] })).status, 403);
  assert.deepEqual(state.posts, before);
});

test("no session → 401; unknown calendar → 404", async () => {
  reset(); state.user = null;
  assert.equal((await patch("cal-1", valid())).status, 401);
  state.user = admin;
  assert.equal((await patch("nope", valid())).status, 404);
});

// ── Validation: never partially reorder ──────────────────────────────────────

test("invalid ID sets are rejected and change nothing", async () => {
  const cases = [
    ["cross-calendar post id", [id(1), id(2), id(3), id(4), "post-cal-2-1"], 422],
    ["missing id", [id(1), id(2), id(3), id(4)], 422],
    ["duplicate id", [id(1), id(2), id(3), id(4), id(4)], 400],
    ["extra id", [id(1), id(2), id(3), id(4), id(5), "post-cal-2-1"], 422],
    ["unknown id", [id(1), id(2), id(3), id(4), "ghost"], 422],
    ["empty list", [], 422],
    ["not an array", "oops", 400],
  ];
  for (const [name, ids, status] of cases) {
    reset();
    const before = clone(state.posts);
    const res = await patch("cal-1", { orderedPostIds: ids });
    assert.equal(res.status, status, name);
    assert.equal((await res.json()).success, false, name);
    assert.deepEqual(state.posts, before, `${name} must not write`);
    assert.equal(state.updateCount, 0, `${name} must not update`);
  }
  reset();
  assert.equal((await patch("cal-1", "{not json")).status, 400);
  assert.equal((await patch("cal-1", {})).status, 400);
});

test("a failure part-way through rolls the whole reorder back", async () => {
  for (const failAt of [2, 5, 7, 10]) {
    reset();
    const before = clone(state.posts);
    state.failOnUpdate = failAt;
    const res = await patch("cal-1", { orderedPostIds: [id(5), id(4), id(3), id(2), id(1)] });
    assert.equal(res.status, 500, `failAt ${failAt}`);
    assert.equal((await res.json()).error, "Could not save the new post order.");
    assert.deepEqual(state.posts, before, `rolled back at update ${failAt}`);
  }
});

// ── Refresh returns the new order ────────────────────────────────────────────

test("after a reorder, the list endpoint (what a refresh loads) returns the new order", async () => {
  reset();
  await patch("cal-1", { orderedPostIds: [id(5), id(1), id(2), id(3), id(4)] });
  const res = await listRoute.GET(new Request("https://app.test/x"), { params: Promise.resolve({ id: "cal-1" }) });
  const posts = await res.json();
  assert.deepEqual(posts.map(p => p.id), [id(5), id(1), id(2), id(3), id(4)]);
  assert.deepEqual(posts.map(p => p.postNumber), [1, 2, 3, 4, 5]);
});

// ── Edit form can no longer overwrite the order ──────────────────────────────

test("PATCH /api/calendar-posts/[id] ignores a stale postNumber", async () => {
  reset();
  state.lastUpdate = null;
  const res = await postRoute.PATCH(
    new Request("https://app.test/x", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postNumber: 1, hookTitle: "Edited" }) }),
    { params: Promise.resolve({ id: id(3) }) }
  );
  assert.equal(res.status, 200);
  assert.ok(!("postNumber" in state.lastUpdate), "edit must not write postNumber");
  assert.equal(state.lastUpdate.suggestedHook, "Edited");
  assert.equal(state.posts.find(p => p.id === id(3)).postNumber, 3);
});

// ── Client logic: optimistic update, revert, serialization ───────────────────

function makeStore(initial) {
  let posts = initial;
  const states = [];
  return {
    get posts() { return posts; },
    states,
    setPosts: (v) => { posts = typeof v === "function" ? v(posts) : v; states.push(posts.map(p => `${p.id}:${p.postNumber}`)); },
  };
}
const localPosts = () => ["a", "b", "c", "d"].map((x, i) => ({ id: x, postNumber: i + 1, caption: `cap-${x}` }));

test("optimistic: UI shows the new order and numbers immediately, then keeps the server's answer", async () => {
  const store = makeStore(localPosts());
  let seenWhileSaving;
  const result = await reorderPostsOptimistically({
    posts: store.posts,
    orderedIds: ["b", "c", "a", "d"],
    setPosts: store.setPosts,
    save: async () => {
      seenWhileSaving = store.posts.map(p => `${p.id}:${p.postNumber}`);
      return [{ id: "b", postNumber: 1 }, { id: "c", postNumber: 2 }, { id: "a", postNumber: 3 }, { id: "d", postNumber: 4 }];
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(seenWhileSaving, ["b:1", "c:2", "a:3", "d:4"]);
  assert.deepEqual(store.posts.map(p => p.id), ["b", "c", "a", "d"]);
  assert.deepEqual(store.posts.map(p => p.caption), ["cap-b", "cap-c", "cap-a", "cap-d"]); // content untouched
});

test("optimistic: a failed save reverts to the previous order and numbers", async () => {
  const store = makeStore(localPosts());
  const result = await reorderPostsOptimistically({
    posts: store.posts,
    orderedIds: ["d", "a", "b", "c"],
    setPosts: store.setPosts,
    save: async () => { throw new Error("Could not save the new post order."); },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(store.posts.map(p => `${p.id}:${p.postNumber}`), ["a:1", "b:2", "c:3", "d:4"]);
  assert.equal(store.states.length, 2); // optimistic, then revert
});

test("the server's authoritative order wins over the optimistic guess", async () => {
  const store = makeStore(localPosts());
  await reorderPostsOptimistically({
    posts: store.posts, orderedIds: ["b", "a", "c", "d"], setPosts: store.setPosts,
    save: async () => [{ id: "a", postNumber: 1 }, { id: "b", postNumber: 2 }, { id: "c", postNumber: 3 }, { id: "d", postNumber: 4 }],
  });
  assert.deepEqual(store.posts.map(p => p.id), ["a", "b", "c", "d"]);
});

test("applyOrderToPosts keeps posts the order doesn't mention", () => {
  const out = applyOrderToPosts([{ id: "x", postNumber: 1 }, { id: "y", postNumber: 2 }], [{ id: "y", postNumber: 1 }]);
  assert.deepEqual(out.map(p => p.id), ["y", "x"]);
});

test("duplicate submissions are serialized: a reorder while one is in flight is skipped, then allowed again", async () => {
  const gate = createReorderGate();
  let release;
  const first = gate.run(() => new Promise(r => { release = r; }));
  assert.equal(gate.busy, true);
  const second = await gate.run(async () => "should not run");
  assert.deepEqual(second, { skipped: true });
  release("done");
  assert.deepEqual(await first, { skipped: false, value: "done" });
  assert.equal(gate.busy, false);
  assert.deepEqual(await gate.run(async () => 1), { skipped: false, value: 1 });
});

test("the gate releases after a failure", async () => {
  const gate = createReorderGate();
  await assert.rejects(gate.run(async () => { throw new Error("x"); }));
  assert.equal(gate.busy, false);
});
