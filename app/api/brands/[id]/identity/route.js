import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request, { params }) {
  const { id } = await params;
  const identities = await prisma.brandIdentity.findMany({
    where: { brandId: id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(identities);
}

export async function POST(request, { params }) {
  const { id } = await params;
  const { jsonOutput, editableSummary } = await request.json();

  if (!jsonOutput) {
    return NextResponse.json({ error: "jsonOutput is required" }, { status: 400 });
  }

  const brand = await prisma.brand.findUnique({ where: { id } });
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  const identity = await prisma.brandIdentity.create({
    data: {
      brandId: id,
      jsonOutput: typeof jsonOutput === "string" ? jsonOutput : JSON.stringify(jsonOutput, null, 2),
      editableSummary: editableSummary ?? null,
    },
  });

  return NextResponse.json(identity, { status: 201 });
}

export async function DELETE(request, { params }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const identityId = searchParams.get("identityId");
  if (!identityId) return NextResponse.json({ error: "identityId required" }, { status: 400 });
  await prisma.brandIdentity.delete({ where: { id: identityId } });
  return NextResponse.json({ success: true });
}
