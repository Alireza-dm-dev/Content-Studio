import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  let brands;
  if (user.role === "admin") {
    brands = await prisma.brand.findMany({
      orderBy: { name: "asc" },
    });
  } else {
    brands = await prisma.brand.findMany({
      where: {
        brandMemberships: { some: { userId: user.id } },
      },
      orderBy: { name: "asc" },
    });
  }

  return NextResponse.json(brands);
}
