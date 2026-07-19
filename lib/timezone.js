// Dependency-free timezone helpers using the built-in Intl API.
// Safe to import from both server and client bundles (no fs/process usage).

export const VANCOUVER_TZ = "America/Vancouver";

function pad2(n) {
  return String(n == null ? 0 : n).padStart(2, "0");
}

function getParts(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return parts;
}

// Interpret a wall-clock string ("YYYY-MM-DDTHH:mm[:ss]") as local time in `timeZone`
// and return the corresponding absolute (UTC-based) Date.
// Based on the zonedTimeToUtc algorithm (no dependencies).
export function parseWallClockInTz(wallClock, timeZone = VANCOUVER_TZ) {
  if (!wallClock) return null;
  const trimmed = String(wallClock).trim();
  let [datePart, timePart = "00:00"] = trimmed.split("T");
  if (!timePart.includes(":")) timePart = "00:00";
  const [h = "00", m = "00", s = "00"] = timePart.split(":");

  const isoGuess = `${datePart}T${pad2(h)}:${pad2(m)}:${pad2(s)}.000Z`;
  const guess = new Date(isoGuess);
  if (isNaN(guess.getTime())) return null;

  const utcDate = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  const tzDate = new Date(guess.toLocaleString("en-US", { timeZone }));
  const offset = utcDate.getTime() - tzDate.getTime();

  const result = new Date(guess.getTime() + offset);
  return isNaN(result.getTime()) ? null : result;
}

// Format a Date (or ISO string) as a "YYYY-MM-DDTHH:mm" wall-clock string in `timeZone`.
// Suitable for <input type="datetime-local"> value.
export function formatToDateTimeLocalInTz(date, timeZone = VANCOUVER_TZ) {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "";
  const p = getParts(d, timeZone);
  const hour = p.hour != null ? p.hour % 24 : 0;
  return `${p.year}-${pad2(p.month || 1)}-${pad2(p.day || 1)}T${pad2(hour)}:${pad2(p.minute || 0)}`;
}

// Format a Date (or ISO string) as "DD/MM/YYYY HH:mm:ss" in `timeZone`.
// Matches the historical n8n Scheduled Date format, now timezone-correct.
export function formatScheduledDateInTz(date, timeZone = VANCOUVER_TZ) {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "";
  const p = getParts(d, timeZone);
  const hour = p.hour != null ? p.hour % 24 : 0;
  return `${pad2(p.day || 1)}/${pad2(p.month || 1)}/${p.year} ${pad2(hour)}:${pad2(p.minute || 0)}:${pad2(p.second || 0)}`;
}

const ABSOLUTE_RE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

// Normalize an incoming scheduled-date value into an absolute UTC Date.
// - Absolute values (ISO with Z or offset) are parsed directly.
// - Bare wall-clock values ("YYYY-MM-DDTHH:mm") are treated as America/Vancouver local time.
// This keeps the API contract intact for existing callers while fixing the timezone.
export function normalizeScheduledDate(raw, timeZone = VANCOUVER_TZ) {
  if (!raw || typeof raw !== "string" || !raw.trim()) return null;
  const s = raw.trim();
  const looksIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s);
  if (looksIso && ABSOLUTE_RE.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  return parseWallClockInTz(s, timeZone);
}
