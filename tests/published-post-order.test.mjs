// Published Posts (Instagram + LinkedIn) are ordered by publish date
// (scheduledDate) DESC, undated last, then createdAt DESC, then id DESC.
// The route test uses a findMany mock that honors orderBy with SQLite NULL
// semantics (NULL is lowest), so it verifies the query, not just a comparator.

import { test, mock } from "node:test";
import assert from "node:assert/strict";

let rows = [];

function cmp(a, b, dir) {
  if (a == null && b == null) return 0;
  if (a == null) return -1; // SQLite: NULL sorts lowest
  if (b == null) return 1;
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  const r = x < y ? -1 : x > y ? 1 : 0;
  return dir === "desc" ? -r : r;
}
function applyOrder(list, orderBy) {
  const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).map((o) => Object.entries(o)[0]);
  return [...list].sort((a, b) => {
    for (const [k, dir] of keys) {
      // NULL lowest for asc; for desc it is reversed by the negation above
      const c = a[k] == null || b[k] == null
        ? (dir === "desc" ? -cmp(a[k], b[k], "asc") : cmp(a[k], b[k], "asc"))
        : cmp(a[k], b[k], dir);
      if (c) return c;
    }
    return 0;
  });
}

mock.module("@/lib/prisma", {
  exports: {
    prisma: {
      brand: { findUnique: async ({ where }) => ({ id: where.id }) },
      publishedPost: {
        findMany: async ({ where, orderBy }) =>
          applyOrder(
            rows.filter(
              (r) => r.brandId === where.brandId && (!where.platform || r.platform === where.platform),
            ),
            orderBy,
          ),
      },
    },
  },
});
mock.module("@/lib/brand-access", {
  exports: { requireBrandAccess: async () => ({ ok: true }) },
});

const { GET } = await import("../app/api/brands/[id]/published-posts/route.js");
const { comparePublishedPosts, sortPublishedPosts, PUBLISHED_POST_ORDER_BY } = await import(
  "@/lib/published-post-order"
);

const d = (s) => new Date(`${s}T10:00:00.000Z`);
function post(id, platform, scheduled, created, extra = {}) {
  return {
    id, brandId: "b1", platform, postType: "static", caption: `cap-${id}`, status: "published",
    scheduledDate: scheduled ? d(scheduled) : null, createdAt: d(created),
    updatedAt: d(created), notes: null, thumbnailUrl: null, postNumber: null, jsonPayload: null,
    media: [{ id: `m-${id}`, url: `/uploads/${id}.jpg`, mediaType: "IMAGE", order: 1 }],
    _count: { comments: 0 }, ...extra,
  };
}

async function list(platform) {
  const res = await GET(
    new Request(`http://x/api/brands/b1/published-posts?platform=${platform}`),
    { params: Promise.resolve({ id: "b1" }) },
  );
  return res.json();
}

function seed() {
  rows = [
    // createdAt deliberately disagrees with publish date
    post("ig-oct25", "Instagram", "2026-10-25", "2026-11-01"),
    post("ig-oct31", "Instagram", "2026-10-31", "2026-01-01"),
    post("ig-oct18", "Instagram", "2026-10-18", "2026-12-01"),
    post("ig-oct29", "Instagram", "2026-10-29", "2026-02-01"),
    post("ig-none-old", "Instagram", null, "2026-01-05"),
    post("ig-none-new", "Instagram", null, "2026-06-05"),
    post("li-b", "LinkedIn", "2026-10-20", "2026-12-31"),
    post("li-c", "LinkedIn", "2026-10-30", "2026-01-01"),
    post("li-a", "LinkedIn", "2026-10-01", "2026-06-01"),
    post("li-tie-2", "LinkedIn", "2026-10-20", "2026-03-01"),
    post("li-none", "LinkedIn", null, "2026-12-30"),
  ];
}

test("Instagram: newest publish date first, oldest last, undated at the end", async () => {
  seed();
  const ids = (await list("Instagram")).map((p) => p.id);
  assert.deepEqual(ids, ["ig-oct31", "ig-oct29", "ig-oct25", "ig-oct18", "ig-none-new", "ig-none-old"]);
});

test("LinkedIn: newest first, oldest last, ties by createdAt DESC, undated last", async () => {
  seed();
  const ids = (await list("LinkedIn")).map((p) => p.id);
  assert.deepEqual(ids, ["li-c", "li-b", "li-tie-2", "li-a", "li-none"]);
});

test("createdAt does not override a newer publish date", async () => {
  seed();
  const ids = (await list("Instagram")).map((p) => p.id);
  assert.ok(ids.indexOf("ig-oct31") < ids.indexOf("ig-oct18")); // oct18 was created last
});

test("platform filtering stays correct and fields are unchanged", async () => {
  seed();
  const ig = await list("Instagram");
  assert.ok(ig.every((p) => p.platform === "Instagram"));
  const first = ig[0];
  assert.equal(first.caption, "cap-ig-oct31");
  assert.equal(first.media.length, 1);
});

test("pagination over the ordered list has no duplicates or reordering", async () => {
  seed();
  const all = (await list("Instagram")).map((p) => p.id);
  const pages = [all.slice(0, 2), all.slice(2, 4), all.slice(4)];
  assert.deepEqual(pages.flat(), all);
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual(all, (await list("Instagram")).map((p) => p.id)); // stable on refetch
});

test("same publish date and createdAt falls back to id DESC (deterministic)", () => {
  const a = post("a", "Instagram", "2026-10-01", "2026-01-01");
  const b = post("b", "Instagram", "2026-10-01", "2026-01-01");
  assert.deepEqual(sortPublishedPosts([a, b]).map((p) => p.id), ["b", "a"]);
  assert.deepEqual(sortPublishedPosts([b, a]).map((p) => p.id), ["b", "a"]);
});

test("client comparator matches the server rule (incl. null/invalid dates last)", () => {
  const list = [
    post("n", "LinkedIn", null, "2026-05-01"),
    post("old", "LinkedIn", "2026-01-01", "2026-12-01"),
    post("new", "LinkedIn", "2026-09-01", "2026-01-01"),
    post("bad", "LinkedIn", null, "2026-04-01", { scheduledDate: "garbage" }),
  ];
  assert.deepEqual(list.sort(comparePublishedPosts).map((p) => p.id), ["new", "old", "n", "bad"]);
  assert.deepEqual(PUBLISHED_POST_ORDER_BY[0], { scheduledDate: "desc" });
});
