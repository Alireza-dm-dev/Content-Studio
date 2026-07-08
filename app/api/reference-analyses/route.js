import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const analyses = await prisma.referenceImageAnalysis.findMany({
    include: {
      brand: { select: { id: true, name: true } },
      uploadedFile: { select: { id: true, fileName: true, filePath: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(analyses);
}
