// Client-safe calendar-date helpers for Story Contents. Plain "YYYY-MM-DD"
// strings, no timezone: a Story day is a calendar date, not an instant.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

/** "YYYY-MM-DD" that names a real calendar day, else null. */
export function parseStoryDate(value) {
  if (typeof value !== "string") return null;
  const m = DATE_RE.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12) return null;
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d < 1 || d > daysInMonth) return null;
  return value;
}

/** "YYYY-MM" → { year, month (1-12), prefix "YYYY-MM-" }, else null. */
export function parseStoryMonth(value) {
  if (typeof value !== "string") return null;
  const m = MONTH_RE.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return null;
  return { year, month, prefix: `${value}-` };
}

/** Monday-first month grid: array of "YYYY-MM-DD" or null padding cells. */
export function buildMonthGrid(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0 = Sun
  const offset = first === 0 ? 6 : first - 1;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  const cells = Array(offset).fill(null);
  for (let d = 1; d <= days; d++) cells.push(`${year}-${mm}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function shiftMonth(year, month, delta) {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}
