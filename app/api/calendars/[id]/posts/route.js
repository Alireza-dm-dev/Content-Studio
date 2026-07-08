import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request, { params }) {
  const { id } = await params;
  const posts = await prisma.calendarPost.findMany({
    where: { calendarId: id },
    orderBy: [{ postNumber: "asc" }, { date: "asc" }],
  });
  return NextResponse.json(posts);
}
