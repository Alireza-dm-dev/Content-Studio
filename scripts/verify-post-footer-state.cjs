/**
 * verify-post-footer-state.cjs
 *
 * Dependency-free verification of getPublishedPostFooterState().
 * Tests the pure logic — no database or React rendering required.
 */

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) {
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

function assertEqual(actual, expected, label) {
  if (actual === expected) {
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ── Load the module ───────────────────────────────────────────────────────
const path = require("path");
const fs = require("fs");

const src = fs.readFileSync(
  path.join(__dirname, "..", "lib", "published-post-footer.js"),
  "utf8"
);

// Evaluate the module in a sandbox to extract the exports (Node 18+ compatible)
// We must shim the export. Use require + vm trick:
const vm = require("vm");

const exportsSandbox = {};
const sandbox = {
  module: { exports: exportsSandbox },
  exports: exportsSandbox,
  console,
  Intl,
  Date,
  Math,
  isNaN,
  String,
  Number,
};
const code = src.replace(/^export /gm, "// export ").replace(/^import /gm, "// import ");
// Remove all imports — the module has no import statements since we used no external deps
// But we wrote `import` above as a replace — actually our lib has NO imports (self-contained)
// Let's just execute the file directly:
const cleanSrc = src
  .replace(/^export /gm, "")           // strip export keywords
  .replace(/^import .*$/gm, "");      // strip any import lines

vm.runInNewContext(cleanSrc, sandbox, { filename: "published-post-footer.js" });
const { getPublishedPostFooterState, formatFooterScheduledDate, formatFooterScheduledLabel } = sandbox;

// ── 1. Published state priority ───────────────────────────────────────────
(function () {
  assertEqual(getPublishedPostFooterState({ status: "published", scheduledDate: new Date().toISOString() }).type, "posted", "1a. published with scheduled → posted");
  assertEqual(getPublishedPostFooterState({ status: "PUBLISHED" }).type, "posted", "1b. uppercase PUBLISHED");
  assertEqual(getPublishedPostFooterState({ status: "Published" }).type, "posted", "1c. capitalised Published");
  assertEqual(getPublishedPostFooterState({ status: "published", scheduledDate: null }).type, "posted", "1d. published null scheduled → posted");
  assertEqual(getPublishedPostFooterState({ status: "published" }).label, "POSTED", "1e. posted label");
  assertEqual(getPublishedPostFooterState({ status: "published" }).ariaLabel, "Published", "1f. posted aria-label");
})();

// ── 2. Scheduled formatting ───────────────────────────────────────────────
(function () {
  // Fixed date: 28 Jul 2026 16:30 in America/Vancouver (PDT = UTC-7)
  // 2026-07-28T23:30:00Z = 2026-07-28T16:30:00-07:00
  const d = new Date("2026-07-28T23:30:00Z");
  const state = getPublishedPostFooterState({ status: "draft", scheduledDate: d.toISOString() });
  assertEqual(state.type, "scheduled", "2a. draft with scheduled → scheduled");
  assertEqual(state.label, "28 Jul 2026 · 16:30", "2b. formatted date label");
  assert(state.ariaLabel.includes("Scheduled for"), "2c. aria-label starts with 'Scheduled for'");
  assert(state.ariaLabel.includes("2026"), "2d. aria-label contains year");
})();

(function () {
  // Another date: 14 Aug 2026 09:00 (PDT)
  // 2026-08-14T16:00:00Z = 2026-08-14T09:00:00-07:00
  const d = new Date("2026-08-14T16:00:00Z");
  const state = getPublishedPostFooterState({ status: "draft", scheduledDate: d.toISOString() });
  assertEqual(state.type, "scheduled", "2e. second date");
  assertEqual(state.label, "14 Aug 2026 · 09:00", "2f. formatted second date");
})();

// ── 3. Unscheduled fallback ───────────────────────────────────────────────
(function () {
  assertEqual(getPublishedPostFooterState({ status: "draft", scheduledDate: null }).type, "unscheduled", "3a. draft null scheduled → unscheduled");
  assertEqual(getPublishedPostFooterState({ status: "draft" }).type, "unscheduled", "3b. no scheduledDate field → unscheduled");
  assertEqual(getPublishedPostFooterState({ status: "draft", scheduledDate: undefined }).type, "unscheduled", "3c. undefined scheduled → unscheduled");
  assertEqual(getPublishedPostFooterState({ status: "draft", scheduledDate: null }).label, "NOT SCHEDULED", "3d. unscheduled label");
  assertEqual(getPublishedPostFooterState({ status: "draft", scheduledDate: null }).ariaLabel, "Not scheduled", "3e. unscheduled aria-label");
})();

// ── 4. Invalid date handling ──────────────────────────────────────────────
(function () {
  assertEqual(getPublishedPostFooterState({ status: "draft", scheduledDate: "invalid-date-string" }).type, "unscheduled", "4a. invalid scheduled date → unscheduled");
  assertEqual(getPublishedPostFooterState({ status: "draft", scheduledDate: "not-a-date" }).label, "NOT SCHEDULED", "4b. invalid date label");
})();

// ── 5. Past date (status not published) ───────────────────────────────────
(function () {
  const past = new Date("2020-01-15T20:00:00Z");
  const state = getPublishedPostFooterState({ status: "draft", scheduledDate: past.toISOString() });
  assertEqual(state.type, "scheduled", "5a. past scheduled date with draft → scheduled, not posted");
  assert(state.label.includes("Jan"), "5b. scheduled label shown for past date");
})();

// ── 6. Unknown status safety ──────────────────────────────────────────────
(function () {
  assertEqual(getPublishedPostFooterState({ status: "archived", scheduledDate: null }).type, "unscheduled", "6a. archived no date → unscheduled");
  assertEqual(getPublishedPostFooterState({ status: "unknown" }).type, "unscheduled", "6b. unknown status → unscheduled, not posted");
  assertEqual(getPublishedPostFooterState({ status: "" }).type, "unscheduled", "6c. empty status → unscheduled");
  assertEqual(getPublishedPostFooterState({ status: "draft" }).type, "unscheduled", "6d. draft no date → unscheduled");
  assertEqual(getPublishedPostFooterState({}).type, "unscheduled", "6e. empty object → unscheduled");
  assertEqual(getPublishedPostFooterState(null).type, "unscheduled", "6f. null post → unscheduled");
})();

// ── 7. formatFooterScheduledDate ──────────────────────────────────────────
(function () {
  const d = new Date("2026-07-28T23:30:00Z");
  assertEqual(formatFooterScheduledDate(d), "28 Jul 2026 · 16:30", "7a. formatFooterScheduledDate");
  assertEqual(formatFooterScheduledDate(null), "", "7b. null returns empty");
  assertEqual(formatFooterScheduledDate("not-a-date"), "", "7c. invalid date returns empty");
})();

// ── 8. Instagram/LinkedIn consistency ─────────────────────────────────────
(function () {
  const instagram = { status: "published", platform: "Instagram", scheduledDate: new Date().toISOString() };
  const linkedin = { status: "published", platform: "LinkedIn", scheduledDate: new Date().toISOString() };
  assertEqual(getPublishedPostFooterState(instagram).type, "posted", "8a. Instagram published → posted");
  assertEqual(getPublishedPostFooterState(linkedin).type, "posted", "8b. LinkedIn published → posted");
})();

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
