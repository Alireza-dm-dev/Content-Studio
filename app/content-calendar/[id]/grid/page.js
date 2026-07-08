import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import CalendarGridView from "@/components/CalendarGridView";

export const dynamic = "force-dynamic";

export default async function CalendarGridPage({ params }) {
  const { id } = await params;
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
