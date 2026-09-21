/**
 * Pure helpers behind the brand-grouped content calendar list.
 *
 * The page hands these an already brand-scoped list (see lib/brand-access) —
 * nothing here filters for access, so a calendar that reaches this module is
 * one the viewer is allowed to see.
 */

export const UNASSIGNED_BRAND_KEY = "__no_brand__";
export const UNASSIGNED_BRAND_NAME = "No brand";

function brandKey(calendar) {
  return calendar.brandId || UNASSIGNED_BRAND_KEY;
}

function brandName(calendar) {
  return calendar.brandName || UNASSIGNED_BRAND_NAME;
}

/**
 * Group calendars into brand sections.
 *
 * Brands are sorted alphabetically by name (case-insensitive, locale aware);
 * brand-less calendars — only ever visible to an admin — sort last under a
 * single "No brand" section. Calendars keep the order they arrive in, which
 * the page supplies as newest first.
 *
 * A brand with no visible calendars produces no section at all: sections only
 * exist because a calendar put them there.
 */
export function groupCalendarsByBrand(calendars = []) {
  const sections = new Map();

  for (const calendar of calendars) {
    const key = brandKey(calendar);
    if (!sections.has(key)) {
      sections.set(key, {
        brandId: calendar.brandId ?? null,
        brandName: brandName(calendar),
        calendars: [],
      });
    }
    sections.get(key).calendars.push(calendar);
  }

  return [...sections.values()]
    .map((section) => ({ ...section, count: section.calendars.length }))
    .sort((a, b) => {
      const aUnassigned = a.brandId === null;
      const bUnassigned = b.brandId === null;
      if (aUnassigned !== bUnassigned) return aUnassigned ? 1 : -1;
      const byName = a.brandName.localeCompare(b.brandName, undefined, { sensitivity: "base" });
      return byName !== 0 ? byName : String(a.brandId).localeCompare(String(b.brandId));
    });
}

/** Drop one calendar from a list, returning a new list. */
export function removeCalendar(calendars = [], id) {
  return calendars.filter((calendar) => calendar.id !== id);
}
