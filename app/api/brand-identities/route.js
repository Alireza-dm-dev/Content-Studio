import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const identities = await prisma.brandIdentity.findMany({
    include: { brand: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(identities);
}
