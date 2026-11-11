// Brand-timezone helpers shared by Instagram and LinkedIn publishing.
// Safe to import from both server and client bundles (no fs/process usage).
//
// Rules:
// - A Brand's IANA timezone (Brand.timezone) is the single authority for what a
//   publish/schedule wall-clock time means. Never the browser or server zone.
// - Instants are stored/transmitted as UTC. Zone conversion is delegated to
//   Luxon (tz database via Intl); no manual offset arithmetic lives here.
import { DateTime, IANAZone } from "luxon";

// Backward-compatible fallback for Brands whose timezone has not been set.
// Every publishing surface used this zone before Brand.timezone existed.
export const DEFAULT_BRAND_TIMEZONE = "America/Vancouver";
export const VANCOUVER_TZ = DEFAULT_BRAND_TIMEZONE;

export const MISSING_TIMEZONE_MESSAGE =
  "This brand has no timezone set. Set the brand's timezone in Brand settings; until then times use " +
  DEFAULT_BRAND_TIMEZONE + ".";

const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const ABSOLUTE_RE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

// Valid IANA zone IDs only ("Europe/London", "UTC"). Abbreviations and fixed
// offsets ("BST", "GMT", "UTC+1", "+01:00") are rejected because they cannot
// follow DST.
export function isValidIanaTimezone(tz) {
  if (typeof tz !== "string") return false;
  const s = tz.trim();
  if (!s) return false;
  if (s !== "UTC" && !s.includes("/")) return false;
  return IANAZone.isValidZone(s);
}

// Returns a usable zone for a brand-like object ({ timezone } or a string).
// Missing/invalid values fall back to DEFAULT_BRAND_TIMEZONE.
export function resolveBrandTimezone(brandOrTz) {
  const tz = typeof brandOrTz === "string" ? brandOrTz : brandOrTz?.timezone;
  if (isValidIanaTimezone(tz)) return tz.trim();
  return DEFAULT_BRAND_TIMEZONE;
}

export function hasBrandTimezone(brandOrTz) {
  const tz = typeof brandOrTz === "string" ? brandOrTz : brandOrTz?.timezone;
  return isValidIanaTimezone(tz);
}

// Validate user-provided timezone input for storage. Returns
// { ok: true, value: string|null } (null clears it) or { ok: false, error }.
export function validateTimezoneInput(raw) {
  if (raw === null || raw === undefined || (typeof raw === "string" && !raw.trim())) {
    return { ok: true, value: null };
  }
  if (!isValidIanaTimezone(raw)) {
    return { ok: false, error: "Invalid timezone. Use an IANA timezone such as Europe/London." };
  }
  return { ok: true, value: String(raw).trim() };
}

// Strict wall-clock → instant conversion.
// Accepts "YYYY-MM-DD[THH:mm[:ss]]" interpreted in `timeZone`.
// Policy: never guess across a daylight-saving change.
// - Nonexistent local time (spring-forward gap) → { ok:false, reason:"nonexistent" }.
// - Ambiguous local time (fall-back repeat)     → { ok:false, reason:"ambiguous" }.
export function resolveWallClock(wallClock, timeZone) {
  if (!isValidIanaTimezone(timeZone)) {
    return { ok: false, reason: "invalid-timezone", error: "Invalid timezone." };
  }
  const m = WALL_RE.exec(String(wallClock ?? "").trim());
  if (!m) return { ok: false, reason: "invalid-format", error: "Invalid date/time." };
  const [, y, mo, d, h = "00", mi = "00", s = "00"] = m;
  const obj = {
    year: +y, month: +mo, day: +d, hour: +h, minute: +mi, second: +s,
  };
  const dt = DateTime.fromObject(obj, { zone: timeZone });
  if (!dt.isValid) return { ok: false, reason: "invalid-date", error: "Invalid date/time." };

  const same = (x) =>
    x.year === obj.year && x.month === obj.month && x.day === obj.day &&
    x.hour === obj.hour && x.minute === obj.minute && x.second === obj.second;

  if (!same(dt)) {
    return {
      ok: false,
      reason: "nonexistent",
      error: "This local time does not exist because of a daylight-saving time change. Please choose a different time.",
    };
  }
  if (same(dt.minus({ hours: 1 })) || same(dt.plus({ hours: 1 }))) {
    return {
      ok: false,
      reason: "ambiguous",
      error: "This time occurs twice because of a daylight-saving time change. Please choose a different time.",
    };
  }
  return { ok: true, date: dt.toJSDate(), ambiguous: false };
}

// Back-compat wrapper: returns a Date or null.
export function parseWallClockInTz(wallClock, timeZone = DEFAULT_BRAND_TIMEZONE) {
  if (!wallClock) return null;
  const r = resolveWallClock(wallClock, timeZone);
  return r.ok ? r.date : null;
}

function toValidDate(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  return isNaN(d.getTime()) ? null : d;
}

function inZone(date, timeZone) {
  const d = toValidDate(date);
  if (!d) return null;
  return DateTime.fromJSDate(d, { zone: resolveBrandTimezone(timeZone) });
}

// "YYYY-MM-DDTHH:mm" wall clock in `timeZone` (datetime-local input value).
export function formatToDateTimeLocalInTz(date, timeZone = DEFAULT_BRAND_TIMEZONE) {
  const dt = inZone(date, timeZone);
  return dt ? dt.toFormat("yyyy-LL-dd'T'HH:mm") : "";
}

// "DD/MM/YYYY HH:mm:ss" in `timeZone` (n8n "Scheduled Date" format).
export function formatScheduledDateInTz(date, timeZone = DEFAULT_BRAND_TIMEZONE) {
  const dt = inZone(date, timeZone);
  return dt ? dt.toFormat("dd/LL/yyyy HH:mm:ss") : "";
}

// Legacy n8n "Scheduled Date": ALWAYS America/Vancouver wall-clock, regardless of
// the Brand timezone, for backward compatibility with the existing n8n workflow.
// The source is the canonical UTC instant; offsets come from IANA rules (DST-aware),
// never a fixed 7/8h subtraction. Do not confuse with the Brand-local UI value
// (`brand_local_publish_datetime`) or the canonical `scheduled_date_utc`.
export function formatLegacyN8nScheduledDate(date) {
  return formatScheduledDateInTz(date, VANCOUVER_TZ);
}

// Human display in the brand zone, e.g. "Jul 15, 2026, 10:00 AM".
export function formatDisplayInTz(date, timeZone = DEFAULT_BRAND_TIMEZONE, opts) {
  const d = toValidDate(date);
  if (!d) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: resolveBrandTimezone(timeZone),
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
    ...opts,
  }).format(d);
}

// Unambiguous brand-local ISO without offset, e.g. "2026-07-15T10:00:00".
export function formatBrandLocalIso(date, timeZone = DEFAULT_BRAND_TIMEZONE) {
  const dt = inZone(date, timeZone);
  return dt ? dt.toFormat("yyyy-LL-dd'T'HH:mm:ss") : "";
}

// Normalize an incoming scheduled-date value into { ok, date } | { ok:false, error }.
// - Absolute values (ISO with Z or offset) are parsed directly (e.g. an unchanged edit).
// - Bare wall-clock values are interpreted in the BRAND timezone.
export function parseScheduledDate(raw, timeZone) {
  if (!raw || typeof raw !== "string" || !raw.trim()) return { ok: true, date: null };
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && ABSOLUTE_RE.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime())
      ? { ok: false, error: "Invalid scheduled date." }
      : { ok: true, date: d };
  }
  const r = resolveWallClock(s, resolveBrandTimezone(timeZone));
  return r.ok ? { ok: true, date: r.date, } : { ok: false, error: r.error };
}

// Back-compat wrapper returning Date|null.
export function normalizeScheduledDate(raw, timeZone = DEFAULT_BRAND_TIMEZONE) {
  const r = parseScheduledDate(raw, timeZone);
  return r.ok ? r.date : null;
}

// Label for publish/schedule controls, e.g. "Europe/London time" or, when the
// brand has no timezone yet, "America/Vancouver time (default — set the brand's timezone)".
export function brandTimezoneLabel(brandOrTz) {
  const zone = resolveBrandTimezone(brandOrTz);
  return hasBrandTimezone(brandOrTz)
    ? `${zone} time`
    : `${zone} time (default — set the brand's timezone in Brand settings)`;
}

// Value a form should send for a datetime-local control.
// - Unchanged since load → the original ISO instant (no drift, even for seconds
//   or a repeated fall-back hour that "YYYY-MM-DDTHH:mm" cannot express).
// - Changed → the bare wall-clock string; the server converts it in the BRAND zone.
// - Cleared → "".
export function scheduledValueForSubmit(value, initialValue, initialInstant) {
  if (!value) return "";
  if (initialInstant && value === initialValue) {
    const d = new Date(initialInstant);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return value;
}

/**
 * FINAL-BOUNDARY normalization for every outbound n8n publish payload.
 *
 * The server owns the n8n time fields. Whatever the payload carries (stored
 * jsonPayload from any earlier version, a rebuilt payload, anything a client
 * ever influenced) is overwritten from the canonical DB instant:
 *   "Scheduled Date"                = America/Vancouver wall-clock (n8n zone)
 *   scheduled_date_utc              = UTC ISO instant
 *   brand_timezone                  = effective Brand IANA zone
 *   brand_local_publish_datetime    = Brand wall-clock ISO (no offset)
 * Returns a shallow copy; the input is not mutated.
 */
export function normalizePayloadForN8n({ payload, scheduledDate, brandTimezone }) {
  if (!payload || typeof payload !== "object") return payload;
  const tz = resolveBrandTimezone(brandTimezone);
  const instant = scheduledDate ? new Date(scheduledDate) : null;
  const valid = instant && !isNaN(instant.getTime());
  return {
    ...payload,
    "Scheduled Date": valid ? formatLegacyN8nScheduledDate(instant) : "",
    scheduled_date_utc: valid ? instant.toISOString() : "",
    brand_timezone: tz,
    brand_local_publish_datetime: valid ? formatBrandLocalIso(instant, tz) : "",
  };
}
