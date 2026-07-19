import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertCalendarAccess } from "@/lib/auth";

export async function GET(request, { params }) {
  const { id } = await params;
  const access = await assertCalendarAccess(id);
  if (!access.allowed) return NextResponse.json({ error: access.error }, { status: access.status });

  const posts = await prisma.calendarPost.findMany({
    where: { calendarId: id },
    orderBy: [{ postNumber: "asc" }, { date: "asc" }],
  });
  return NextResponse.json(posts);
}
