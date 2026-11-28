// Standard Brand-local schedule PRESENTATION used by the LinkedIn grid, detail
// modal, JSON-viewer summary, upload form, adapt modal and review page.
// Display only: the DB instant and n8n payload are covered by the transport tests.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TZ = "Pacific/Kiritimati"; // UTC+14: server/browser zone ≠ every Brand zone

const tz = await import("../lib/timezone.js");
const { getPublishedPostFooterState } = await import("../lib/published-post-footer.js");

// [zone, brand-local wall clock, UTC instant, date, time]
const MATRIX = [
  ["Europe/London", "2026-11-25T15:30", "2026-11-25T15:30:00.000Z", "25 Nov 2026", "15:30"],   // winter (GMT)
  ["Europe/London", "2026-07-15T15:30", "2026-07-15T14:30:00.000Z", "15 Jul 2026", "15:30"],   // summer (BST)
  ["America/Vancouver", "2026-11-25T15:30", "2026-11-25T22:30:00.000Z", "25 Nov 2026", "15:30"], // UTC-7 year-round from 2026-11-01
  ["America/Vancouver", "2026-02-10T09:00", "2026-02-10T17:00:00.000Z", "10 Feb 2026", "09:00"], // last PST winter
  ["Europe/Helsinki", "2026-11-25T00:30", "2026-11-24T22:30:00.000Z", "25 Nov 2026", "00:30"],   // UTC date is the previous day
  ["Europe/Helsinki", "2026-07-15T15:30", "2026-07-15T12:30:00.000Z", "15 Jul 2026", "15:30"],
  ["America/Toronto", "2026-11-25T23:30", "2026-11-26T04:30:00.000Z", "25 Nov 2026", "23:30"],   // UTC date is the next day
  ["America/Toronto", "2026-07-15T15:30", "2026-07-15T19:30:00.000Z", "15 Jul 2026", "15:30"],
  ["Asia/Tehran", "2026-11-25T15:30", "2026-11-25T12:00:00.000Z", "25 Nov 2026", "15:30"],
  ["Asia/Tehran", "2026-07-15T00:15", "2026-07-14T20:45:00.000Z", "15 Jul 2026", "00:15"],
];

test("matrix: every surface format shows the Brand-local date/time, never server/UTC", () => {
  for (const [zone, local, utc, date, time] of MATRIX) {
    const label = `${zone} ${local}`;
    // Save path (unchanged): wall clock → canonical UTC.
    const parsed = tz.parseScheduledDate(local, zone);
    assert.ok(parsed.ok, label);
    assert.equal(parsed.date.toISOString(), utc, label);

    assert.equal(tz.formatBrandDate(utc, zone), date, label);
    assert.equal(tz.formatBrandTime(utc, zone), time, label);
    assert.equal(tz.formatBrandDateTime(utc, zone), `${date}, ${time}`, label);
    assert.equal(tz.formatBrandScheduleCompact(utc, zone), `${date} · ${time} · ${zone}`, label);
    assert.equal(tz.brandTimezoneShortLabel(zone), zone, label);

    // Edit → save → reopen shows exactly the selected local value (no drift).
    assert.equal(tz.formatToDateTimeLocalInTz(parsed.date, zone), local, `${label} reopen`);
    // Unchanged re-save sends the original instant, so repeated edits never shift it.
    assert.equal(tz.scheduledValueForSubmit(local, local, utc), utc, `${label} resave`);
    // Adapt-modal target echo of the picker value.
    // Adapt-modal target echo of the picker value (no client conversion) equals the saved instant's display.
    assert.equal(tz.formatWallClockForDisplay(local), `${date}, ${time}`, `${label} echo`);
    assert.equal(tz.formatWallClockForDisplay(local), tz.formatBrandDateTime(parsed.date, zone), `${label} echo = saved`);
  }
});

test("missing Brand timezone: Vancouver fallback, clearly marked as default", () => {
  for (const missing of [null, undefined, "", "   ", "BST", "UTC+1"]) {
    assert.equal(tz.brandTimezoneShortLabel(missing), "America/Vancouver (default)", String(missing));
    assert.equal(
      tz.formatBrandScheduleCompact("2026-11-25T22:30:00.000Z", missing),
      "25 Nov 2026 · 15:30 · America/Vancouver (default)",
    );
  }
  assert.equal(tz.brandTimezoneShortLabel({ timezone: "Europe/London" }), "Europe/London");
  assert.equal(tz.brandTimezoneShortLabel({ timezone: null }), "America/Vancouver (default)");
});

test("unscheduled / invalid dates read 'Not scheduled', never now", () => {
  for (const v of [null, undefined, "", "not-a-date"]) {
    assert.equal(tz.formatBrandDateTime(v, "Europe/London"), "Not scheduled", String(v));
    assert.equal(tz.formatBrandScheduleCompact(v, "Europe/London"), "Not scheduled", String(v));
    assert.equal(tz.formatBrandDate(v, "Europe/London"), "");
    assert.equal(tz.formatBrandTime(v, "Europe/London"), "");
  }
  assert.equal(tz.NOT_SCHEDULED_LABEL, "Not scheduled");
  for (const v of ["", null, "2026-13-01T10:00", "25/11/2026 12:00"]) assert.equal(tz.formatWallClockForDisplay(v), "Not scheduled", String(v));
});

test("grid card: footer instant + Brand zone render the compact form", () => {
  for (const [zone, , utc, date, time] of MATRIX) {
    const fs = getPublishedPostFooterState({ status: "draft", scheduledDate: utc }, zone);
    assert.equal(fs.type, "scheduled");
    assert.equal(`${tz.formatBrandDate(fs.dateTime, zone)} · ${tz.formatBrandTime(fs.dateTime, zone)}`, `${date} · ${time}`);
  }
  assert.equal(getPublishedPostFooterState({ status: "draft", scheduledDate: null }, "Europe/London").type, "unscheduled");
});

test("same post, same local time on every surface (Today = grid = detail = JSON summary)", async () => {
  const { DateTime } = await import("luxon");
  // lib/today.js localTimeLabel contract: Luxon "HH:mm" in the Brand zone.
  for (const [zone, , utc, , time] of MATRIX) {
    const today = DateTime.fromJSDate(new Date(utc), { zone }).setLocale("en-US").toFormat("HH:mm");
    assert.equal(today, time, zone);
    assert.ok(tz.formatBrandDateTime(utc, zone).endsWith(`, ${time}`), zone);
    assert.ok(tz.formatBrandScheduleCompact(utc, zone).includes(` · ${time} · `), zone);
  }
});

test("presentation never alters the n8n integration fields", () => {
  const payload = { "Post ID": "POST-0001", Platform: "LinkedIn" };
  const out = tz.normalizePayloadForN8n({ payload, scheduledDate: "2026-11-25T15:30:00.000Z", brandTimezone: "Europe/London" });
  assert.equal(out["Scheduled Date"], "25/11/2026 08:30:00"); // legacy Vancouver wall clock, unchanged
  assert.equal(out.scheduled_date_utc, "2026-11-25T15:30:00.000Z");
  assert.equal(out.brand_timezone, "Europe/London");
  assert.equal(out.brand_local_publish_datetime, "2026-11-25T15:30:00");
});
