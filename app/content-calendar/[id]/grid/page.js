import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireResourceBrandAccess } from "@/lib/brand-access";
import { NotAuthorized } from "@/components/NotAuthorized";
import CalendarGridView from "@/components/CalendarGridView";

export const dynamic = "force-dynamic";

export default async function CalendarGridPage({ params }) {
  const { id } = await params;

  const access = await requireResourceBrandAccess("calendar", id);
  if (!access.ok) {
    if (access.status === 404) notFound();
    return <NotAuthorized message="You do not have access to this calendar." />;
  }
  const calendar = await prisma.contentCalendar.findUnique({
    where: { id },
    include: {
      brand: { select: { id: true, name: true } },
      posts: { orderBy: [{ date: "asc" }, { postNumber: "asc" }] },
    },
  });
  if (!calendar) notFound();

  return <CalendarGridView calendar={calendar} posts={calendar.posts} />;
}
