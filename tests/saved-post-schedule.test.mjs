// Saved-post scheduling is SERVER-authoritative on every card/modal surface.
//
// - Card footers (Instagram grid, LinkedIn row) and their screen-reader labels
//   come from getSavedPostFooterState(post): server `post.schedule` only.
// - Detail modals use useServerSchedule (refetch, never browser conversion).
// - The JSON viewer / Copy / Download share useCanonicalPayload's single `text`.
// - A stale browser timezone database cannot move a saved post's time.
//
// The hooks run under a tiny in-test hook renderer (react is mocked), so no DOM
// is needed. Server values are built with the real server helpers first; the
// stale-browser shim is installed only afterwards, as in a real browser.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.TZ = "Pacific/Kiritimati";

// ── minimal hook renderer ────────────────────────────────────────────────────
let current = null;
mock.module("react", {
  exports: {
    useState: (init) => current.useState(init),
    useEffect: (fn, deps) => current.useEffect(fn, deps),
  },
});
function renderHook(hook, initialProps) {
  const states = [];
  const deps = [];
  const cleanups = [];
  let props = initialProps;
  let si = 0;
  let ei = 0;
  let queued = [];
  const r = {
    result: undefined,
    useState(init) {
      const i = si++;
      if (!(i in states)) states[i] = typeof init === "function" ? init() : init;
      return [states[i], (v) => { states[i] = typeof v === "function" ? v(states[i]) : v; render(); }];
    },
    useEffect(fn, d) {
      const i = ei++;
      const prev = deps[i];
      if (!prev || !d || d.some((x, k) => !Object.is(x, prev[k]))) {
        deps[i] = d;
        queued.push(() => { if (cleanups[i]) cleanups[i](); cleanups[i] = fn(); });
      }
    },
    rerender(p) { props = p; render(); },
  };
  function render() {
    current = r; si = 0; ei = 0; queued = [];
    r.result = hook(props);
    const run = queued;
    run.forEach((f) => f());
  }
  render();
  return r;
}
const flush = () => new Promise((res) => setTimeout(res, 0));

const tz = await import("../lib/timezone.js");
const footer = await import("../lib/published-post-footer.js");
const { useServerSchedule } = await import("../components/useServerSchedule.js");
const { useCanonicalPayload } = await import("../components/useCanonicalPayload.js");
const { Settings } = await import("luxon");

// Server-built values (owning Brand's zone), as serializePublishedPost attaches them.
const VAN_UTC = "2026-11-26T01:00:00.000Z"; // 25 Nov 2026 18:00 Vancouver; UTC date is the 26th
const saved = (scheduledDate, zone) => ({ id: "p1", status: "draft", scheduledDate, schedule: tz.buildSchedulePresentation(scheduledDate, zone) });
const igVancouver = saved(VAN_UTC, "America/Vancouver");
const igDefault = saved(VAN_UTC, null);
const liLondon = saved("2026-11-25T12:00:00.000Z", "Europe/London");

function withStaleBrowser(fn) {
  const Real = Intl.DateTimeFormat;
  function Stale(locales, opts) {
    const o = opts && opts.timeZone === "America/Vancouver" ? { ...opts, timeZone: "Etc/GMT+8" } : opts;
    return new Real(locales, o);
  }
  Stale.prototype = Real.prototype;
  Stale.supportedLocalesOf = Real.supportedLocalesOf.bind(Real);
  Intl.DateTimeFormat = Stale;
  Settings.resetCaches();
  try { return fn(); } finally { Intl.DateTimeFormat = Real; Settings.resetCaches(); }
}

test("1+3. Instagram grid footer uses the server schedule (18:00) even with stale browser tzdata", () => {
  withStaleBrowser(() => {
    // The shim really reproduces the old drift: browser conversion says 17:00.
    assert.equal(footer.getPublishedPostFooterState(igVancouver, "America/Vancouver").label, "25 Nov 2026 · 17:00");
    const fs = footer.getSavedPostFooterState(igVancouver);
    assert.equal(fs.type, "scheduled");
    assert.equal(fs.unavailable, false);
    assert.equal(fs.label, "25 Nov 2026 · 18:00");
    // Missing Brand timezone: server-calculated Vancouver default, same instant.
    assert.equal(footer.getSavedPostFooterState(igDefault).label, "25 Nov 2026 · 18:00");
    assert.equal(footer.getSavedPostFooterState(igDefault).schedule.timezoneLabel, "America/Vancouver (default)");
  });
  const src = readFileSync(new URL("../components/PublishedPostsSection.jsx", import.meta.url), "utf8");
  assert.match(src, /getSavedPostFooterState\(post\)/, "grid card uses the server-only footer state");
  assert.ok(!src.includes("getPublishedPostFooterState"), "no browser-converting footer on the grid");
});

test("2. Instagram detail 'Scheduled' uses the server date (correct across a UTC date boundary)", () => {
  assert.equal(igVancouver.schedule.date, "25 Nov 2026", "Brand-local date, not the UTC 26th");
  const src = readFileSync(new URL("../components/PostDetailModal.jsx", import.meta.url), "utf8");
  assert.match(src, /useServerSchedule\(post, brandId\)/);
  assert.match(src, /sched\.schedule\.date\b/);
  assert.match(src, /label="Scheduled" value=\{scheduledDateStr\}/, "same field, same place");
  for (const banned of ["toLocaleDateString(\"en-US\", {\n        year: \"numeric\", month: \"short\", day: \"numeric\",\n        timeZone", "formatToDateTimeLocalInTz", "formatBrandDateTime"]) {
    assert.ok(!src.includes(banned), `no browser conversion: ${banned.split("(")[0]}`);
  }
});

test("3. no saved-post surface converts scheduled times in the browser", () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const surfaces = {
    "components/PostDetailModal.jsx": ["formatToDateTimeLocalInTz", "formatBrandDateTime", "normalizePayloadForN8n"],
    "components/LinkedInPostDetailModal.jsx": ["formatToDateTimeLocalInTz", "formatBrandDateTime", "normalizePayloadForN8n"],
    "components/LinkedInPublishedPostsSection.jsx": ["getPublishedPostFooterState", "formatBrandDate", "formatBrandTime"],
    "components/PublishedPostsSection.jsx": ["getPublishedPostFooterState"],
    "components/CrossPlatformPostModal.jsx": ["formatToDateTimeLocalInTz", "formatBrandDateTime"],
    "app/review/[token]/ReviewPageClient.jsx": ["formatDisplayInTz", "formatBrandDateTime"],
  };
  for (const [file, banned] of Object.entries(surfaces)) {
    const src = read(file);
    for (const b of banned) assert.ok(!src.includes(b), `${file} still uses ${b}`);
  }
});

test("9. explicitly unscheduled posts stay 'Not scheduled'; published stays 'Posted'", () => {
  const fs = footer.getSavedPostFooterState(saved(null, "Europe/London"));
  assert.deepEqual([fs.type, fs.label, fs.ariaLabel, fs.unavailable], ["unscheduled", "NOT SCHEDULED", "Not scheduled", false]);
  assert.equal(footer.getSavedPostFooterState({ status: "published", scheduledDate: VAN_UTC }).type, "posted");
  assert.equal(tz.buildSchedulePresentation(null, "Europe/London").dateTime, "Not scheduled");
});

test("10. missing / stale schedule metadata → 'unavailable', never 'Not scheduled', never a browser time", () => {
  const noMeta = { id: "p", status: "draft", scheduledDate: VAN_UTC };
  const stale = { ...igVancouver, scheduledDate: "2026-12-01T10:00:00.000Z" }; // schedule describes another instant
  for (const post of [noMeta, stale]) {
    const fs = footer.getSavedPostFooterState(post);
    assert.equal(fs.type, "scheduled");
    assert.equal(fs.unavailable, true);
    assert.equal(fs.label, footer.SCHEDULE_UNAVAILABLE_LABEL);
    assert.ok(!/Not scheduled/i.test(fs.label + fs.ariaLabel));
    assert.ok(!/\d\d:\d\d/.test(fs.label + fs.ariaLabel), "no computed time");
  }
  // Partial update (e.g. a thumbnail response without schedule) keeps the valid one…
  const kept = tz.keepServerSchedule(igVancouver, { id: "p1", status: "draft", scheduledDate: VAN_UTC, thumbnailUrl: "/x.jpg" });
  assert.deepEqual(kept.schedule, igVancouver.schedule);
  // …but a changed instant never inherits the old schedule.
  const moved = tz.keepServerSchedule(igVancouver, { id: "p1", status: "draft", scheduledDate: "2026-12-01T10:00:00.000Z" });
  assert.equal(tz.serverScheduleFor(moved), null);
  // A response that has its own schedule wins.
  assert.deepEqual(tz.keepServerSchedule(igVancouver, liLondon).schedule, liLondon.schedule);
});

test("11. screen-reader labels state the same date/time as the visible label, plus the timezone", () => {
  for (const post of [igVancouver, igDefault, liLondon]) {
    const fs = footer.getSavedPostFooterState(post);
    const [date, time] = fs.label.split(" · ");
    assert.equal(fs.ariaLabel, `Scheduled for ${date}, ${time}, ${post.schedule.timezoneLabel}`);
  }
  assert.equal(footer.getSavedPostFooterState(liLondon).ariaLabel, "Scheduled for 25 Nov 2026, 12:00, Europe/London");
  assert.equal(footer.getSavedPostFooterState(igDefault).ariaLabel, "Scheduled for 25 Nov 2026, 18:00, America/Vancouver (default)");
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  assert.match(read("components/LinkedInPublishedPostsSection.jsx"), /aria-label=\{getSavedPostFooterState\(post\)\.ariaLabel\}/);
  assert.match(read("components/PublishedPostsSection.jsx"), /aria-label=\{footerState\.ariaLabel\}/);
});

test("10b. detail-modal hook: server schedule, refetch when missing, 'unavailable' on failure", async () => {
  const calls = [];
  let reply;
  globalThis.fetch = async (url) => { calls.push(String(url)); return reply(); };

  // Has a server schedule → ready, no request.
  let h = renderHook(({ post }) => useServerSchedule(post, "b1"), { post: igVancouver });
  assert.deepEqual([h.result.state, h.result.schedule.dateTime, calls.length], ["ready", "25 Nov 2026, 18:00", 0]);

  // Explicitly unscheduled → unscheduled, no request.
  h = renderHook(({ post }) => useServerSchedule(post, "b1"), { post: saved(null, "Europe/London") });
  assert.deepEqual([h.result.state, calls.length], ["unscheduled", 0]);

  // Scheduled without metadata → loading, then the refetched server schedule.
  reply = async () => ({ ok: true, json: async () => igVancouver });
  h = renderHook(({ post }) => useServerSchedule(post, "b1"), { post: { id: "p1", scheduledDate: VAN_UTC } });
  assert.equal(h.result.state, "loading");
  await flush(); await flush();
  assert.deepEqual(calls, ["/api/brands/b1/published-posts/p1"]);
  assert.deepEqual([h.result.state, h.result.schedule.datetimeLocal], ["ready", "2026-11-25T18:00"]);

  // Refetch fails, or returns a schedule for another instant → unavailable (NOT unscheduled).
  for (const bad of [async () => ({ ok: false, json: async () => ({}) }), async () => ({ ok: true, json: async () => liLondon })]) {
    reply = bad;
    h = renderHook(({ post }) => useServerSchedule(post, "b1"), { post: { id: "p1", scheduledDate: VAN_UTC } });
    await flush(); await flush();
    assert.deepEqual([h.result.state, h.result.schedule], ["unavailable", null]);
  }

  // The modals never submit a guessed time while unavailable: they keep the saved instant.
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  for (const f of ["components/PostDetailModal.jsx", "components/LinkedInPostDetailModal.jsx"]) {
    const src = read(f);
    assert.match(src, /scheduleUnavailable\s*\n?\s*\? new Date\(post\.scheduledDate\)\.toISOString\(\)/, `${f} keeps the saved instant`);
    assert.match(src, /disabled=\{scheduleUnavailable\}/, `${f} disables the picker`);
  }
});

test("13. JSON viewer, Copy JSON and Download JSON share one server snapshot; errors show nothing", async () => {
  const payload = { "Scheduled Date": "25/11/2026 05:00:00", scheduled_date_utc: "2026-11-25T12:00:00.000Z" };
  let reply = async () => ({ ok: true, json: async () => ({ payload, schedule: liLondon.schedule, rebuilt: false }) });
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return reply(); };

  const h = renderHook((p) => useCanonicalPayload(p), { brandId: "b1", postId: "p1", version: "v1", enabled: true });
  assert.equal(h.result.status, "loading");
  await flush(); await flush();
  assert.equal(h.result.status, "ready");
  assert.equal(h.result.text, JSON.stringify(payload, null, 2));
  // A new version (edit / reopen) never shows the old snapshot as current.
  reply = async () => ({ ok: false, status: 500, json: async () => ({ error: "Down." }) });
  h.rerender({ brandId: "b1", postId: "p1", version: "v2", enabled: true });
  assert.equal(h.result.status, "loading");
  assert.equal(h.result.text, undefined);
  await flush(); await flush();
  assert.deepEqual([h.result.status, h.result.error, h.result.text], ["error", "Down.", undefined]);
  reply = async () => ({ ok: true, json: async () => ({ payload, schedule: null }) });
  h.result.retry();
  await flush(); await flush();
  assert.equal(h.result.status, "ready");
  assert.deepEqual(calls, Array(3).fill("/api/brands/b1/published-posts/p1/payload"));

  // Both modals render, copy and download the same `payloadStr = canonical.text`.
  for (const f of ["components/PostDetailModal.jsx", "components/LinkedInPostDetailModal.jsx"]) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.match(src, /const payloadStr = canonical\.status === "ready" \? canonical\.text : "";/);
    assert.match(src, /navigator\.clipboard\.writeText\(payloadStr\)/);
    assert.match(src, /new Blob\(\[payloadStr\]/);
    assert.match(src, /\{payloadStr\}\s*<\/pre>/);
    assert.match(src, /Canonical webhook payload/);
    assert.match(src, /not a record of an earlier delivery/);
  }
});
