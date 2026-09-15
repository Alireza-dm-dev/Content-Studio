import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireResourceBrandAccess } from "@/lib/brand-access";
import { NotAuthorized } from "@/components/NotAuthorized";
import { getCurrentUser } from "@/lib/auth";
import CalendarDetailClient from "./CalendarDetailClient";

export const dynamic = "force-dynamic";

export default async function CalendarDetailPage({ params }) {
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
      posts: { orderBy: [{ postNumber: "asc" }, { date: "asc" }] },
    },
  });
  if (!calendar) notFound();

  const user = await getCurrentUser();

  return <CalendarDetailClient calendar={calendar} isAdmin={user?.role === "admin"} />;
}
