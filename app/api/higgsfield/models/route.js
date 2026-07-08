import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const mediaType = searchParams.get("mediaType");

  const models = await prisma.higgsfieldModel.findMany({
    where: {
      ...(mediaType ? { mediaType } : {}),
    },
    select: {
      id: true,
      modelKey: true,
      label: true,
      mediaType: true,
      tokenCost: true,
      description: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ mediaType: "asc" }, { label: "asc" }],
  });

  return NextResponse.json({ success: true, models });
}
