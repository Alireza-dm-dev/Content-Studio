import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword, createSession } from "@/lib/auth";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 }
    );
  }

  const { email, password } = body;

  if (!email?.trim() || !password?.trim()) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 }
    );
  }

  let user;
  try {
    user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
  } catch (err) {
    console.error("[Login] DB error:", err);
    return NextResponse.json(
      { error: "Login failed." },
      { status: 500 }
    );
  }

  if (!user) {
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 }
    );
  }

  if (!user.isActive) {
    return NextResponse.json(
      { error: "Account is disabled." },
      { status: 401 }
    );
  }

  let valid;
  try {
    valid = await verifyPassword(password, user.passwordHash);
  } catch (err) {
    console.error("[Login] Password verification error:", err);
    return NextResponse.json(
      { error: "Login failed." },
      { status: 500 }
    );
  }

  if (!valid) {
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 }
    );
  }

  try {
    await createSession(user.id);
  } catch (err) {
    console.error("[Login] Session error:", err);
    return NextResponse.json(
      { error: "Login failed." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
  });
}
