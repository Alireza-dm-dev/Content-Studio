// Client-safe helper for determining the footer state of a published post card.
// Intended for both Instagram (grid card) and LinkedIn (row card).
// No fs/path dependencies — safe to import from client components.

export const FOOTER_TZ = "America/Vancouver";

const MONTHS_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

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
    hour12: false,
  });
  const parts = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return parts;
}

/**
 * @param {Date} date
 * @returns {string} e.g. "28 Jul 2026 · 16:30"
 */
export function formatFooterScheduledDate(date) {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "";
  const p = getParts(d, FOOTER_TZ);
  return `${pad2(p.day || 1)} ${MONTHS_ABBR[(p.month || 1) - 1]} ${p.year} · ${pad2(p.hour || 0)}:${pad2(p.minute || 0)}`;
}

/**
 * @param {Date} date
 * @returns {string} e.g. "Scheduled for 28 July 2026 at 16:30"
 */
export function formatFooterScheduledLabel(date) {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "";
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: FOOTER_TZ,
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  return "Scheduled for " + dtf.format(d);
}

/**
 * Determines the footer display state for a published post.
 *
 * @param {Object} post - PublishedPost object with status, scheduledDate.
 * @returns {{ type: "posted"|"scheduled"|"unscheduled", label: string, dateTime: Date|null, ariaLabel: string }}
 *
 * Priority:
 * 1. status === "published" → posted
 * 2. valid scheduledDate → scheduled
 * 3. otherwise → unscheduled
 */
export function getPublishedPostFooterState(post) {
  if (!post) {
    return { type: "unscheduled", label: "NOT SCHEDULED", dateTime: null, ariaLabel: "Not scheduled" };
  }

  const status = (post.status || "").toLowerCase().trim();

  // Published takes priority over scheduled date
  if (status === "published") {
    return { type: "posted", label: "POSTED", dateTime: null, ariaLabel: "Published" };
  }

  // Scheduled — verify the date is valid
  if (post.scheduledDate) {
    const d = new Date(post.scheduledDate);
    if (!isNaN(d.getTime())) {
      return {
        type: "scheduled",
        label: formatFooterScheduledDate(d),
        dateTime: d,
        ariaLabel: formatFooterScheduledLabel(d),
      };
    }
  }

  // No scheduled date (or invalid date) and not published
  return { type: "unscheduled", label: "NOT SCHEDULED", dateTime: null, ariaLabel: "Not scheduled" };
}
