import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertCalendarAccess } from "@/lib/auth";
import { validateOrderedPostIds, renumberPosts } from "@/lib/calendar-post-order";

// PATCH /api/calendars/[id]/posts/reorder
// Body: { orderedPostIds: string[] } — every post of the calendar, in the new order.
// The server derives postNumber from the array position (1..N); numbers sent by
// the client are never read. Only postNumber is written.
export async function PATCH(request, { params }) {
  const { id: calendarId } = await params;

  const access = await assertCalendarAccess(calendarId);
  if (!access.allowed) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status });
  }

  // Brand access (admin, or a member of the owning brand) is the only gate:
  // calendar status does not restrict reordering.
  const calendarExists = await prisma.contentCalendar.findUnique({
    where: { id: calendarId },
    select: { id: true },
  });
  if (!calendarExists) {
    return NextResponse.json({ success: false, error: "Calendar not found" }, { status: 404 });
  }

  let body;
  try { body = await request.json(); }
  catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  try {
    // Load + validate + renumber inside ONE transaction, so a post added or
    // deleted concurrently makes the request fail instead of half-applying.
    const result = await prisma.$transaction(async (tx) => {
      const rows = await tx.calendarPost.findMany({
        where: { calendarId },
        select: { id: true },
      });
      const check = validateOrderedPostIds(rows.map(r => r.id), body?.orderedPostIds);
      if (!check.ok) return { invalid: check };
      return { order: await renumberPosts(tx, calendarId, body.orderedPostIds) };
    });

    if (result.invalid) {
      return NextResponse.json(
        { success: false, error: result.invalid.error },
        { status: result.invalid.status }
      );
    }
    return NextResponse.json({ success: true, order: result.order });
  } catch (err) {
    console.error("[CalendarPosts reorder] Error:", err);
    return NextResponse.json(
      { success: false, error: "Could not save the new post order." },
      { status: 500 }
    );
  }
}
