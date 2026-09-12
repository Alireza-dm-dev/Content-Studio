import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function GET(request) {

  // Not brand-scoped; requires a session only. Any brand data used by the
  // calling flow is authorized by that flow's own brand-scoped route.
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
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
