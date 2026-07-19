import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminAccess } from "@/lib/auth";

export async function GET(request, { params }) {
  const access = await getAdminAccess();
  if (!access.user) return NextResponse.json({ error: access.error }, { status: access.status });

  const { id } = await params;
  const memberships = await prisma.brandMembership.findMany({
    where: { userId: id },
    include: { brand: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(memberships);
}

export async function POST(request, { params }) {
  const access = await getAdminAccess();
  if (!access.user) return NextResponse.json({ error: access.error }, { status: access.status });

  const { id } = await params;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { brandId } = body;
  if (!brandId?.trim()) {
    return NextResponse.json({ error: "brandId is required." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });

  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand) return NextResponse.json({ error: "Brand not found." }, { status: 404 });

  const existing = await prisma.brandMembership.findUnique({
    where: { userId_brandId: { userId: id, brandId } },
  });
  if (existing) {
    return NextResponse.json({ error: "Membership already exists." }, { status: 409 });
  }

  const membership = await prisma.brandMembership.create({
    data: { userId: id, brandId },
    include: { brand: { select: { id: true, name: true } } },
  });

  return NextResponse.json(membership, { status: 201 });
}

export async function DELETE(request, { params }) {
  const access = await getAdminAccess();
  if (!access.user) return NextResponse.json({ error: access.error }, { status: access.status });

  const { id } = await params;

  const { searchParams } = new URL(request.url);
  const brandId = searchParams.get("brandId");

  if (!brandId?.trim()) {
    return NextResponse.json({ error: "brandId query parameter is required." }, { status: 400 });
  }

  const existing = await prisma.brandMembership.findUnique({
    where: { userId_brandId: { userId: id, brandId } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Membership not found." }, { status: 404 });
  }

  await prisma.brandMembership.delete({ where: { userId_brandId: { userId: id, brandId } } });

  return NextResponse.json({ success: true });
}
