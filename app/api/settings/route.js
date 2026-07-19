import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminAccess } from "@/lib/auth";

export async function GET() {
  const access = await getAdminAccess();
  if (!access.user) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const settings = await prisma.settings.findMany();
  const result = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  return NextResponse.json(result);
}

export async function POST(request) {
  const access = await getAdminAccess();
  if (!access.user) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { key, value } = await request.json();
  if (!key) return NextResponse.json({ error: "Key is required" }, { status: 400 });
  const setting = await prisma.settings.upsert({
    where: { key },
    update: { value, updatedAt: new Date() },
    create: { key, value, updatedAt: new Date() },
  });
  return NextResponse.json(setting);
}
