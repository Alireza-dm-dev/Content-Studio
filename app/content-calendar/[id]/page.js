import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import CalendarDetailClient from "./CalendarDetailClient";

export const dynamic = "force-dynamic";

export default async function CalendarDetailPage({ params }) {
  const { id } = await params;
  const calendar = await prisma.contentCalendar.findUnique({
    where: { id },
    include: {
      brand: { select: { id: true, name: true } },
      posts: { orderBy: [{ postNumber: "asc" }, { date: "asc" }] },
    },
  });
  if (!calendar) notFound();

  return <CalendarDetailClient calendar={calendar} />;
}
