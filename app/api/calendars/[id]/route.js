import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request, { params }) {
  const { id } = await params;
  const calendar = await prisma.contentCalendar.findUnique({
    where: { id },
    include: {
      brand: true,
      posts: { orderBy: [{ postNumber: "asc" }, { date: "asc" }] },
      _count: { select: { posts: true } },
    },
  });
  if (!calendar) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(calendar);
}

export async function PATCH(request, { params }) {
  const { id } = await params;
  const body = await request.json();
  const {
    title, platform, timePeriod, mainMonthlySubject,
    mainGoal, mainOfferOrMessage, sourceMaterial, status,
  } = body;
  const calendar = await prisma.contentCalendar.update({
    where: { id },
    data: { title, platform, timePeriod, mainMonthlySubject, mainGoal, mainOfferOrMessage, sourceMaterial, status },
  });
  return NextResponse.json(calendar);
}

export async function DELETE(request, { params }) {
  const { id } = await params;
  await prisma.contentCalendar.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
