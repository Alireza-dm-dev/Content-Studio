import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminAccess, hashPassword } from "@/lib/auth";

const VALID_ROLES = ["admin", "user"];

function getOwnerEmail() {
  const raw = process.env.OWNER_ADMIN_EMAIL;
  if (!raw) return null;
  return raw.trim().toLowerCase();
}

export async function PATCH(request, { params }) {
  const access = await getAdminAccess();
  if (!access.user) return NextResponse.json({ error: access.error }, { status: access.status });

  const { id } = await params;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { email, name, role, isActive, password } = body;

  const existing = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true, isActive: true, name: true },
  });
  if (!existing) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // ── Self-protection ─────────────────────────────────────────────────
  if (access.user.id === id) {
    const triesDeactivate = typeof isActive === "boolean" && isActive === false;
    const triesDemote = role !== undefined && role !== "admin";
    if (triesDeactivate || triesDemote) {
      return NextResponse.json(
        { error: "You cannot remove your own admin access" },
        { status: 400 }
      );
    }
  }

  // ── Owner protection ────────────────────────────────────────────────
  const ownerEmail = getOwnerEmail();
  const targetEmail = (existing.email || "").trim().toLowerCase();
  const isOwner = ownerEmail !== null && targetEmail === ownerEmail;

  if (isOwner) {
    const newEmail = email?.trim()?.toLowerCase();
    const triesChangeEmail = newEmail && newEmail !== ownerEmail;
    const triesDeactivate = typeof isActive === "boolean" && isActive === false;
    const triesDemote = role !== undefined && role !== "admin";
    if (triesChangeEmail || triesDeactivate || triesDemote) {
      return NextResponse.json(
        { error: "The owner admin account cannot be removed" },
        { status: 400 }
      );
    }
  }

  // ── Build update data ───────────────────────────────────────────────
  const updateData = {};
  if (email?.trim()) updateData.email = email.trim().toLowerCase();
  if (name?.trim()) updateData.name = name.trim();
  if (role && VALID_ROLES.includes(role)) updateData.role = role;
  if (typeof isActive === "boolean") updateData.isActive = isActive;
  if (password?.trim()) {
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }
    updateData.passwordHash = await hashPassword(password);
  }

  if (updateData.email) {
    const duplicate = await prisma.user.findUnique({ where: { email: updateData.email } });
    if (duplicate && duplicate.id !== id) {
      return NextResponse.json({ error: "A user with this email already exists." }, { status: 409 });
    }
  }

  // ── Transaction-safe last-admin check + mutation ────────────────────
  try {
    const user = await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id },
        select: { id: true, email: true, role: true, isActive: true },
      });
      if (!current) throw new Error("User not found");

      const finalRole = (role !== undefined && VALID_ROLES.includes(role)) ? role : current.role;
      const finalIsActive = typeof isActive === "boolean" ? isActive : current.isActive;

      const wasActiveAdmin = current.role === "admin" && current.isActive === true;
      const willBeActiveAdmin = finalRole === "admin" && finalIsActive === true;
      if (wasActiveAdmin && !willBeActiveAdmin) {
        const count = await tx.user.count({ where: { role: "admin", isActive: true } });
        if (count <= 1) {
          throw new Error("At least one active admin account is required");
        }
      }

      return tx.user.update({
        where: { id },
        data: updateData,
        select: { id: true, email: true, name: true, role: true, isActive: true, updatedAt: true },
      });
    });

    return NextResponse.json(user);
  } catch (err) {
    if (err.message === "At least one active admin account is required") {
      return NextResponse.json({ error: "At least one active admin account is required" }, { status: 409 });
    }
    if (err.message === "User not found") {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const access = await getAdminAccess();
  if (!access.user) return NextResponse.json({ error: access.error }, { status: access.status });

  const { id } = await params;

  const existing = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true, isActive: true },
  });
  if (!existing) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // ── Self-protection ─────────────────────────────────────────────────
  if (access.user.id === id) {
    return NextResponse.json(
      { error: "You cannot remove your own admin access" },
      { status: 400 }
    );
  }

  // ── Owner protection ────────────────────────────────────────────────
  const ownerEmail = getOwnerEmail();
  const targetEmail = (existing.email || "").trim().toLowerCase();
  const isOwner = ownerEmail !== null && targetEmail === ownerEmail;

  if (isOwner) {
    return NextResponse.json(
      { error: "The owner admin account cannot be removed" },
      { status: 400 }
    );
  }

  // ── Transaction-safe last-admin check + mutation ────────────────────
  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id },
        select: { id: true, email: true, role: true, isActive: true },
      });
      if (!current) throw new Error("User not found");

      if (current.role === "admin" && current.isActive === true) {
        const count = await tx.user.count({ where: { role: "admin", isActive: true } });
        if (count <= 1) {
          throw new Error("At least one active admin account is required");
        }
      }

      await tx.user.delete({ where: { id } });
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err.message === "At least one active admin account is required") {
      return NextResponse.json({ error: "At least one active admin account is required" }, { status: 409 });
    }
    if (err.message === "User not found") {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}
