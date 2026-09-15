import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {

  // Prompt templates are global configuration, not brand content.
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (currentUser.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const balance = await prisma.operatorTokenBalance.findUnique({
    where: { provider: "higgsfield" },
    select: { provider: true, balance: true },
  });

  const recentLedger = await prisma.tokenLedgerEntry.findMany({
    where: { provider: "higgsfield" },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      delta: true,
      reason: true,
      balanceAfter: true,
      createdAt: true,
      generatedMediaId: true,
      higgsfieldModel: {
        select: { label: true, modelKey: true },
      },
    },
  });

  return NextResponse.json({
    success: true,
    balance: balance ?? { provider: "higgsfield", balance: 0 },
    recentLedger,
  });
}

export async function POST(request) {

  // Prompt templates are global configuration, not brand content.
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (currentUser.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { delta, reason } = body ?? {};

  if (typeof delta !== "number" || !Number.isInteger(delta) || delta === 0) {
    return NextResponse.json(
      { success: false, error: "delta must be a non-zero integer" },
      { status: 400 }
    );
  }

  const ledgerReason = typeof reason === "string" && reason.trim() ? reason.trim() : "manual_adjustment";

  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.operatorTokenBalance.findUnique({
        where: { provider: "higgsfield" },
      });
      const currentBalance = current?.balance ?? 0;
      const newBalance = currentBalance + delta;

      if (newBalance < 0) {
        throw new Error("INSUFFICIENT_BALANCE");
      }

      await tx.operatorTokenBalance.upsert({
        where: { provider: "higgsfield" },
        update: { balance: newBalance },
        create: { provider: "higgsfield", balance: newBalance },
      });

      const ledgerEntry = await tx.tokenLedgerEntry.create({
        data: {
          provider: "higgsfield",
          delta,
          reason: ledgerReason,
          balanceAfter: newBalance,
        },
        select: { id: true, delta: true, reason: true, balanceAfter: true, createdAt: true },
      });

      return { newBalance, ledgerEntry };
    });

    return NextResponse.json({
      success: true,
      balance: { provider: "higgsfield", balance: result.newBalance },
      ledgerEntry: result.ledgerEntry,
    });
  } catch (err) {
    if (err.message === "INSUFFICIENT_BALANCE") {
      return NextResponse.json(
        { success: false, error: "Adjustment would make balance negative" },
        { status: 400 }
      );
    }
    throw err;
  }
}
