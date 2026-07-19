import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { assertCalendarAccess } from "@/lib/auth";
import CalendarDetailClient from "@/app/content-calendar/[id]/CalendarDetailClient";
import { PortalCalendarDetailWrapper } from "./PortalCalendarDetailWrapper";

export const dynamic = "force-dynamic";

export default async function PortalCalendarDetailPage({ params }) {
  const { brandId, calendarId } = await params;

  const access = await assertCalendarAccess(calendarId);
  if (!access.allowed) return <div>Access denied</div>;

  const calendar = await prisma.contentCalendar.findUnique({
    where: { id: calendarId },
    include: {
      brand: { select: { id: true, name: true } },
      posts: { orderBy: [{ postNumber: "asc" }, { date: "asc" }] },
    },
  });
  if (!calendar) notFound();

  return (
    <PortalCalendarDetailWrapper calendar={calendar}>
      <CalendarDetailClient calendar={calendar} />
    </PortalCalendarDetailWrapper>
  );
}
