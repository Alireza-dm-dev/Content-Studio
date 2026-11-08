// Brand-timezone publishing: a bare "10:00" always means 10:00 in the BRAND's
// IANA timezone (DST-aware), never the browser's or the server's.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ── Mocks for route tests ────────────────────────────────────────────────────
const db = { brands: {}, posts: {}, access: { ok: true }, webhookCalls: [], brandUpdates: [] };

mock.module("@/lib/prisma", {
  exports: {
    prisma: {
      brand: {
        findUnique: async ({ where }) => db.brands[where.id] || null,
        update: async ({ where, data }) => {
          db.brandUpdates.push(data);
          db.brands[where.id] = { ...db.brands[where.id], ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) };
          return db.brands[where.id];
        },
      },
      publishedPost: {
        findFirst: async ({ where }) => {
          const p = db.posts[where.id];
          return p && p.brandId === where.brandId ? p : null;
        },
        update: async ({ where, data }) => {
          db.posts[where.id] = { ...db.posts[where.id], ...data };
          return db.posts[where.id];
        },
      },
    },
  },
});
mock.module("@/lib/brand-access", {
  exports: { requireBrandAccess: async () => db.access },
});
mock.module("@/lib/published-post-webhook", {
  exports: {
    sendPublishedPostToN8n: async (args) => {
      db.webhookCalls.push(args);
      return { success: true };
    },
  },
});

const tz = await import("@/lib/timezone");
const { buildN8nPayload } = await import("@/lib/published-post-utils");
const { getPublishedPostFooterState } = await import("@/lib/published-post-footer");
const { sortPublishedPosts } = await import("@/lib/published-post-order");
const postRoute = await import("../app/api/brands/[id]/published-posts/[postId]/route.js");
const createRoute = await import("../app/api/brands/[id]/published-posts/route.js");
const brandRoute = await import("../app/api/brands/[id]/route.js");

const iso = (s, z) => tz.parseWallClockInTz(s, z).toISOString();

// ── 1–7: validation + conversion ─────────────────────────────────────────────
test("valid IANA zones accepted; abbreviations, offsets and junk rejected", () => {
  for (const z of ["Europe/London", "America/Vancouver", "Asia/Tehran", "Australia/Sydney", "UTC"]) {
    assert.equal(tz.isValidIanaTimezone(z), true, z);
  }
  for (const z of ["BST", "GMT", "UTC+1", "+01:00", "Mars/Olympus", "Europe/Londn", "", null, undefined, 5]) {
    assert.equal(tz.isValidIanaTimezone(z), false, String(z));
  }
  assert.deepEqual(tz.validateTimezoneInput("Europe/London"), { ok: true, value: "Europe/London" });
  assert.deepEqual(tz.validateTimezoneInput(""), { ok: true, value: null });
  assert.equal(tz.validateTimezoneInput("BST").ok, false);
});

test("Europe/London: winter 10:00 = 10:00Z, summer 10:00 = 09:00Z", () => {
  assert.equal(iso("2026-01-15T10:00", "Europe/London"), "2026-01-15T10:00:00.000Z");
  assert.equal(iso("2026-07-15T10:00", "Europe/London"), "2026-07-15T09:00:00.000Z");
});

test("Vancouver uses its own DST-aware offset", () => {
  assert.equal(iso("2026-07-15T10:00", "America/Vancouver"), "2026-07-15T17:00:00.000Z"); // PDT
  assert.equal(iso("2026-01-15T10:00", "America/Vancouver"), "2026-01-15T18:00:00.000Z"); // PST
});

test("same local time in two brand zones gives different instants", () => {
  assert.notEqual(iso("2026-07-15T10:00", "Europe/London"), iso("2026-07-15T10:00", "America/Vancouver"));
});

test("transition days convert correctly on both sides of the change", () => {
  // UK spring forward 2026-03-29 01:00Z; fall back 2026-10-25 01:00Z
  assert.equal(iso("2026-03-29T00:30", "Europe/London"), "2026-03-29T00:30:00.000Z");
  assert.equal(iso("2026-03-29T02:30", "Europe/London"), "2026-03-29T01:30:00.000Z");
  assert.equal(iso("2026-10-25T02:30", "Europe/London"), "2026-10-25T02:30:00.000Z");
});

test("nonexistent AND ambiguous DST local times are both rejected, with distinct messages", () => {
  const gap = tz.resolveWallClock("2026-03-29T01:30", "Europe/London");
  assert.equal(gap.ok, false);
  assert.equal(gap.reason, "nonexistent");
  assert.match(gap.error, /does not exist because of a daylight-saving/);
  const amb = tz.resolveWallClock("2026-10-25T01:30", "Europe/London");
  assert.equal(amb.ok, false);
  assert.equal(amb.reason, "ambiguous");
  assert.match(amb.error, /occurs twice because of a daylight-saving/);
  // US transitions too (BC has no 2026 fall-back in current tzdata, so New York is used)
  assert.equal(tz.resolveWallClock("2026-03-08T02:30", "America/Vancouver").reason, "nonexistent");
  assert.equal(tz.resolveWallClock("2026-11-01T01:30", "America/New_York").reason, "ambiguous");
  // neighbours of the transitions are fine
  assert.equal(tz.resolveWallClock("2026-10-25T00:30", "Europe/London").ok, true);
  assert.equal(tz.resolveWallClock("2026-10-25T02:30", "Europe/London").ok, true);
  assert.equal(tz.resolveWallClock("2026-07-15T10:00", "Europe/London").ok, true);
  assert.equal(tz.resolveWallClock("2026-02-30T10:00", "Europe/London").ok, false);
  assert.equal(tz.parseWallClockInTz("2026-10-25T01:30", "Europe/London"), null);
  assert.equal(tz.parseScheduledDate("2026-10-25T01:30", "Europe/London").ok, false);
});

test("browser/server timezone cannot override the brand zone (Finland user, UK brand)", () => {
  const original = process.env.TZ;
  try {
    for (const deviceTz of ["Europe/Helsinki", "Pacific/Auckland", "America/Vancouver"]) {
      process.env.TZ = deviceTz;
      assert.equal(iso("2026-07-15T10:00", "Europe/London"), "2026-07-15T09:00:00.000Z", deviceTz);
      assert.equal(tz.formatToDateTimeLocalInTz("2026-07-15T09:00:00Z", "Europe/London"), "2026-07-15T10:00", deviceTz);
    }
  } finally {
    if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
  }
});

// ── 10–12, 15: edit / display ────────────────────────────────────────────────
test("edit form: stored UTC → brand-local; unchanged save keeps the exact instant", () => {
  const stored = new Date("2026-07-15T09:00:00Z");
  const local = tz.formatToDateTimeLocalInTz(stored, "Europe/London");
  assert.equal(local, "2026-07-15T10:00");
  // unchanged → original ISO is sent
  assert.equal(tz.scheduledValueForSubmit(local, local, stored), "2026-07-15T09:00:00.000Z");
  // changed → wall-clock sent, server converts in the brand zone
  assert.equal(tz.scheduledValueForSubmit("2026-07-15T11:00", local, stored), "2026-07-15T11:00");
  assert.equal(iso("2026-07-15T11:00", "Europe/London"), "2026-07-15T10:00:00.000Z");
  assert.equal(tz.scheduledValueForSubmit("", local, stored), "");
});

test("round trip is lossless across every hour of both DST change days", () => {
  for (const day of ["2026-03-29", "2026-10-25", "2026-03-08", "2026-11-01"]) {
    for (const zone of ["Europe/London", "America/Vancouver"]) {
      for (let h = 0; h < 24; h++) {
        const wall = `${day}T${String(h).padStart(2, "0")}:00`;
        const r = tz.resolveWallClock(wall, zone);
        if (!r.ok) continue; // gap hour
        assert.equal(tz.formatToDateTimeLocalInTz(r.date, zone), wall, `${zone} ${wall}`);
      }
    }
  }
});

test("display uses the brand zone, not the viewer's", () => {
  const d = "2026-07-15T09:00:00Z";
  assert.match(tz.formatDisplayInTz(d, "Europe/London"), /10:00 AM/);
  assert.match(tz.formatDisplayInTz(d, "America/Vancouver"), /2:00 AM/);
  assert.equal(getPublishedPostFooterState({ status: "draft", scheduledDate: d }, "Europe/London").label, "15 Jul 2026 · 10:00");
  assert.equal(getPublishedPostFooterState({ status: "draft", scheduledDate: d }, "America/Vancouver").label, "15 Jul 2026 · 02:00");
});

test("late-evening UK posts do not shift day when device zone is far away", () => {
  assert.equal(tz.formatToDateTimeLocalInTz("2026-07-15T22:30:00Z", "Europe/London"), "2026-07-15T23:30");
});

// ── 13–14: n8n payload ───────────────────────────────────────────────────────
test("n8n payload: brand-local Scheduled Date plus unambiguous UTC + zone", () => {
  const post = { id: "p1", platform: "Instagram", postType: "static", status: "draft", scheduledDate: new Date("2026-07-15T09:00:00Z") };
  const p = buildN8nPayload(post, [], "Acme", "Europe/London");
  assert.equal(p["Scheduled Date"], "15/07/2026 10:00:00");
  assert.equal(p.scheduled_date_utc, "2026-07-15T09:00:00.000Z");
  assert.equal(p.brand_timezone, "Europe/London");
  assert.equal(p.brand_local_publish_datetime, "2026-07-15T10:00:00");
  const li = buildN8nPayload({ ...post, platform: "LinkedIn" }, [], "Acme", "Europe/London");
  assert.equal(li.scheduled_date_utc, p.scheduled_date_utc);
  assert.equal(li["Scheduled Date"], p["Scheduled Date"]);
});

test("n8n payload without a scheduled date keeps empty values", () => {
  const p = buildN8nPayload({ id: "p1", platform: "Instagram", postType: "static" }, [], "Acme", "Europe/London");
  assert.equal(p["Scheduled Date"], "");
  assert.equal(p.scheduled_date_utc, "");
});

// ── 17: missing timezone ─────────────────────────────────────────────────────
test("missing brand timezone falls back to the legacy default, labelled as default", () => {
  assert.equal(tz.resolveBrandTimezone({ timezone: null }), "America/Vancouver");
  assert.equal(tz.resolveBrandTimezone({ timezone: "garbage" }), "America/Vancouver");
  assert.equal(tz.hasBrandTimezone({ timezone: null }), false);
  assert.match(tz.brandTimezoneLabel({ timezone: null }), /default/);
  assert.equal(tz.brandTimezoneLabel("Europe/London"), "Europe/London time");
  const p = buildN8nPayload({ id: "p", platform: "Instagram", postType: "static", scheduledDate: new Date("2026-07-15T17:00:00Z") }, [], "A", undefined);
  assert.equal(p.brand_timezone, "America/Vancouver");
  assert.equal(p["Scheduled Date"], "15/07/2026 10:00:00");
});

// ── 16: sorting stays on canonical instants ──────────────────────────────────
test("published-post sorting is unaffected by brand timezone", () => {
  const rows = [
    { id: "a", scheduledDate: new Date("2026-07-15T09:00:00Z"), createdAt: new Date("2026-01-01") },
    { id: "b", scheduledDate: new Date("2026-07-15T10:00:00Z"), createdAt: new Date("2026-01-02") },
    { id: "c", scheduledDate: null, createdAt: new Date("2026-01-03") },
  ];
  assert.deepEqual(sortPublishedPosts(rows).map((r) => r.id), ["b", "a", "c"]);
});

// ── Route tests: 8, 9, 12, 18, 22, 23 ────────────────────────────────────────
function resetDb() {
  db.brands = {
    uk: { id: "uk", name: "UK Co", timezone: "Europe/London" },
    van: { id: "van", name: "Van Co", timezone: "America/Vancouver" },
    none: { id: "none", name: "No TZ", timezone: null },
  };
  const mk = (id, brandId, platform) => ({ id, brandId, platform, postType: "static", status: "draft", caption: "c", jsonPayload: null, media: [], _count: { comments: 0 }, scheduledDate: null, createdAt: new Date(), updatedAt: new Date() });
  db.posts = { ig1: mk("ig1", "uk", "Instagram"), li1: { ...mk("li1", "uk", "LinkedIn"), media: [{ id: "m", url: "/uploads/x.png", mediaType: "IMAGE", order: 1 }] }, v1: mk("v1", "van", "Instagram"), n1: mk("n1", "none", "Instagram") };
  db.access = { ok: true, user: { id: "u", role: "user" } };
  db.webhookCalls = [];
  db.brandUpdates = [];
}

async function patchPost(brandId, postId, body) {
  const res = await postRoute.POST(
    new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    { params: Promise.resolve({ id: brandId, postId }) },
  );
  return { status: res.status, json: await res.json() };
}

test("Instagram + LinkedIn edits convert wall-clock in the Brand zone", async () => {
  resetDb();
  let r = await patchPost("uk", "ig1", { scheduledDate: "2026-07-15T10:00" });
  assert.equal(r.status, 200);
  assert.equal(db.posts.ig1.scheduledDate.toISOString(), "2026-07-15T09:00:00.000Z");
  r = await patchPost("uk", "li1", { scheduledDate: "2026-01-15T10:00" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(db.posts.li1.scheduledDate.toISOString(), "2026-01-15T10:00:00.000Z");
  r = await patchPost("van", "v1", { scheduledDate: "2026-07-15T10:00" });
  assert.equal(db.posts.v1.scheduledDate.toISOString(), "2026-07-15T17:00:00.000Z");
});

test("client-supplied timezone is ignored; brand zone wins", async () => {
  resetDb();
  await patchPost("uk", "ig1", { scheduledDate: "2026-07-15T10:00", timezone: "Asia/Tokyo", timeZone: "Asia/Tokyo" });
  assert.equal(db.posts.ig1.scheduledDate.toISOString(), "2026-07-15T09:00:00.000Z");
});

test("unchanged edit (absolute ISO) causes no drift; no-tz brand uses the default", async () => {
  resetDb();
  await patchPost("uk", "ig1", { scheduledDate: "2026-07-15T09:00:00.000Z" });
  assert.equal(db.posts.ig1.scheduledDate.toISOString(), "2026-07-15T09:00:00.000Z");
  await patchPost("none", "n1", { scheduledDate: "2026-07-15T10:00" });
  assert.equal(db.posts.n1.scheduledDate.toISOString(), "2026-07-15T17:00:00.000Z");
});

test("edit webhook receives the brand timezone; payload carries UTC instant", async () => {
  resetDb();
  await patchPost("uk", "ig1", { scheduledDate: "2026-07-15T10:00" });
  assert.equal(db.webhookCalls.length, 1);
  assert.equal(db.webhookCalls[0].brandTimezone, "Europe/London");
  const payload = JSON.parse(db.posts.ig1.jsonPayload);
  assert.equal(payload.scheduled_date_utc, "2026-07-15T09:00:00.000Z");
  assert.equal(payload["Scheduled Date"], "15/07/2026 10:00:00");
});

test("nonexistent local time is rejected with 400 and nothing is stored", async () => {
  resetDb();
  const r = await patchPost("uk", "ig1", { scheduledDate: "2026-03-29T01:30" });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /does not exist/);
  assert.equal(db.posts.ig1.scheduledDate, null);
  assert.equal(db.webhookCalls.length, 0);
});

test("ambiguous local time: 400, zero DB change, no webhook (Instagram + LinkedIn edit)", async () => {
  resetDb();
  const snapshot = JSON.stringify(db.posts);
  for (const postId of ["ig1", "li1"]) {
    const r = await patchPost("uk", postId, { scheduledDate: "2026-10-25T01:30" });
    assert.equal(r.status, 400, postId);
    assert.match(r.json.error, /occurs twice/);
  }
  assert.equal(JSON.stringify(db.posts), snapshot);
  assert.equal(db.webhookCalls.length, 0);
  // the form stays usable: a valid retry succeeds
  const ok = await patchPost("uk", "ig1", { scheduledDate: "2026-10-25T02:30" });
  assert.equal(ok.status, 200);
});

test("create (Instagram and LinkedIn) rejects a nonexistent brand-local time before any upload", async () => {
  resetDb();
  for (const platform of ["Instagram", "LinkedIn"]) {
    const fd = new FormData();
    fd.append("files", new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" }));
    fd.append("platform", platform);
    fd.append("postType", "static");
    fd.append("scheduledDate", "2026-03-29T01:30");
    const res = await createRoute.POST(new Request("http://x", { method: "POST", body: fd }), { params: Promise.resolve({ id: "uk" }) });
    assert.equal(res.status, 400, platform);
    assert.match((await res.json()).error, /does not exist/);
    fd.set("scheduledDate", "2026-10-25T01:30");
    const res2 = await createRoute.POST(new Request("http://x", { method: "POST", body: fd }), { params: Promise.resolve({ id: "uk" }) });
    assert.equal(res2.status, 400, platform);
    assert.match((await res2.json()).error, /occurs twice/);
  }
  assert.equal(db.webhookCalls.length, 0);
});

test("cross-brand access and auth failures are unchanged", async () => {
  resetDb();
  db.access = { ok: false, status: 403, error: "Forbidden" };
  const r = await patchPost("uk", "ig1", { scheduledDate: "2026-07-15T10:00" });
  assert.equal(r.status, 403);
  assert.equal(db.posts.ig1.scheduledDate, null);
  resetDb();
  const other = await patchPost("van", "ig1", { scheduledDate: "2026-07-15T10:00" }); // post belongs to uk
  assert.equal(other.status, 404);
});

test("Brand PATCH stores a valid timezone, rejects invalid ones, honours access", async () => {
  resetDb();
  const patch = async (body) => {
    const res = await brandRoute.PATCH(
      new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }),
      { params: Promise.resolve({ id: "van" }) },
    );
    return { status: res.status, json: await res.json() };
  };
  let r = await patch({ name: "Van Co", timezone: "Europe/London" });
  assert.equal(r.status, 200);
  assert.equal(db.brands.van.timezone, "Europe/London");
  r = await patch({ name: "Van Co", timezone: "BST" });
  assert.equal(r.status, 400);
  r = await patch({ name: "Van Co", timezone: "Not/AZone" });
  assert.equal(r.status, 400);
  assert.equal(db.brands.van.timezone, "Europe/London");
  const before = db.brandUpdates.length;
  r = await patch({ name: "Van Co" }); // omitted → unchanged
  assert.equal(db.brands.van.timezone, "Europe/London");
  assert.equal(db.brandUpdates[before].timezone, undefined);
  db.access = { ok: false, status: 403, error: "Forbidden" };
  r = await patch({ timezone: "Asia/Tokyo" });
  assert.equal(r.status, 403);
  assert.equal(db.brands.van.timezone, "Europe/London");
});

test("changing a brand timezone does not rewrite stored instants (only display changes)", async () => {
  resetDb();
  await patchPost("uk", "ig1", { scheduledDate: "2026-07-15T10:00" });
  const before = db.posts.ig1.scheduledDate.toISOString();
  db.brands.uk.timezone = "America/Vancouver"; // brand zone changed
  assert.equal(db.posts.ig1.scheduledDate.toISOString(), before);
  assert.equal(tz.formatToDateTimeLocalInTz(db.posts.ig1.scheduledDate, db.brands.uk.timezone), "2026-07-15T02:00");
  // the timezone change path itself never touches posts
  assert.ok(!readFileSync(new URL("../app/api/brands/[id]/route.js", import.meta.url), "utf8").includes("publishedPost"));
});

// ── 24: shared helper / no hard-coded zone ───────────────────────────────────
test("Instagram and LinkedIn share one timezone module; no component hard-codes a zone", () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const files = [
    "components/PublishedPostUploadForm.jsx", "components/LinkedInPostUploadForm.jsx",
    "components/PostDetailModal.jsx", "components/LinkedInPostDetailModal.jsx",
    "components/CrossPlatformPostModal.jsx",
  ];
  for (const f of files) {
    const src = read(f);
    assert.match(src, /from "@\/lib\/timezone"/, f);
    assert.ok(!src.includes("America/Vancouver"), `${f} still hard-codes a zone`);
    assert.ok(!src.includes("parseWallClockInTz"), `${f} converts on the client`);
  }
  for (const f of ["app/api/brands/[id]/published-posts/route.js", "app/api/brands/[id]/published-posts/[postId]/route.js", "app/api/brands/[id]/published-posts/[postId]/adapt/route.js"]) {
    assert.match(read(f), /parseScheduledDate/, f);
  }
});
