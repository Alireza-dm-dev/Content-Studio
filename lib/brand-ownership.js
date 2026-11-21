// Brand ownership checks shared by every route that loads brand-scoped records
// by an id the caller supplied (request body or a stored link).
//
// Rule: a route authorizes the caller against ONE authoritative brand (the
// calendar's, the storyboard's, or a brand it checked directly). Every other
// record it loads — the post, a reference-image analysis, a combined visual
// direction, a calendar link — must provably belong to that same brand, or it
// is treated exactly like a record that does not exist. Treating "foreign" and
// "missing" identically means the response never reveals that another brand's
// record exists.

/** A record's owning brand: its own brandId, else its calendar's. null = unattached. */
export function ownerBrandId(row) {
  if (!row) return null;
  return row.brandId ?? row.calendar?.brandId ?? null;
}

/**
 * Calendar-post routes authorize against the calendar's brand but receive a
 * brandId in the body that drives the brand, identity and Brand Knowledge they
 * load. Ties the three together.
 * @returns {null | { status: number, error: string }} null when consistent.
 */
export function calendarPostBrandMismatch({ calendar, post, brandId }) {
  if (!calendar || !post || post.calendarId !== calendar.id) {
    return { status: 404, error: "Calendar post not found." };
  }
  if (calendar.brandId && calendar.brandId !== brandId) {
    return { status: 403, error: "Brand does not match this calendar." };
  }
  return null;
}

const WITH_CALENDAR_BRAND = { calendar: { select: { brandId: true } } };

/** The analysis, only if it belongs to brandId; otherwise null (same as missing). */
export async function findBrandOwnedReferenceAnalysis(prisma, id, brandId) {
  if (!id || !brandId) return null;
  const row = await prisma.referenceImageAnalysis.findUnique({ where: { id }, include: WITH_CALENDAR_BRAND });
  return row && ownerBrandId(row) === brandId ? row : null;
}

/** The combined visual direction, only if it belongs to brandId; otherwise null. */
export async function findBrandOwnedCombinedVisualDirection(prisma, id, brandId) {
  if (!id || !brandId) return null;
  const row = await prisma.combinedVisualDirection.findUnique({ where: { id }, include: WITH_CALENDAR_BRAND });
  return row && ownerBrandId(row) === brandId ? row : null;
}

/** The calendar post, only if its calendar belongs to brandId; otherwise null (same as missing). */
export async function findBrandOwnedCalendarPost(prisma, id, brandId) {
  if (!id || !brandId) return null;
  const post = await prisma.calendarPost.findUnique({ where: { id } });
  if (!post?.calendarId) return null;
  const calendar = await prisma.contentCalendar.findUnique({ where: { id: post.calendarId }, select: { brandId: true } });
  return calendar?.brandId === brandId ? post : null;
}

/**
 * Optional calendar / post links supplied in a request body must belong to the
 * brand the request was authorized for (and the post to that calendar).
 * @returns {Promise<null | { status: number, error: string }>}
 */
export async function brandCalendarLinkMismatch(prisma, { brandId, calendarId, calendarPostId }) {
  if (calendarId) {
    const calendar = await prisma.contentCalendar.findUnique({ where: { id: calendarId }, select: { id: true, brandId: true } });
    if (!calendar || calendar.brandId !== brandId) return { status: 404, error: "Calendar not found." };
  }
  if (calendarPostId) {
    const post = await prisma.calendarPost.findUnique({ where: { id: calendarPostId }, select: { calendarId: true } });
    if (!post) return { status: 404, error: "Calendar post not found." };
    if (calendarId && post.calendarId !== calendarId) return { status: 404, error: "Calendar post not found." };
    if (!calendarId) {
      const calendar = await prisma.contentCalendar.findUnique({ where: { id: post.calendarId }, select: { brandId: true } });
      if (!calendar || calendar.brandId !== brandId) return { status: 404, error: "Calendar post not found." };
    }
  }
  return null;
}
