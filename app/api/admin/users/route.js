import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminAccess, hashPassword } from "@/lib/auth";

export async function GET() {
  const access = await getAdminAccess();
  if (!access.user) return NextResponse.json({ error: access.error }, { status: access.status });

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      brandMemberships: { select: { brand: { select: { id: true, name: true } }, role: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(users);
}

export async function POST(request) {
  const access = await getAdminAccess();
  if (!access.user) return NextResponse.json({ error: access.error }, { status: access.status });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { email, name, password, role } = body;

  if (!email?.trim() || !name?.trim() || !password?.trim()) {
    return NextResponse.json({ error: "Email, name, and password are required." }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (existing) {
    return NextResponse.json({ error: "A user with this email already exists." }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.create({
    data: {
      email: email.trim().toLowerCase(),
      name: name.trim(),
      passwordHash,
      role: role === "admin" ? "admin" : "user",
    },
    select: {
      id: true, email: true, name: true, role: true, isActive: true, createdAt: true,
    },
  });

  return NextResponse.json(user, { status: 201 });
}
