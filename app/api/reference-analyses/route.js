import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { brandScopeWhere } from "@/lib/brand-access";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const analyses = await prisma.referenceImageAnalysis.findMany({
    where: await brandScopeWhere(user),
    include: {
      brand: { select: { id: true, name: true } },
      uploadedFile: { select: { id: true, fileName: true, filePath: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(analyses);
}
