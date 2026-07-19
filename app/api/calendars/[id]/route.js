import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertCalendarAccess } from "@/lib/auth";

export async function GET(request, { params }) {
  const { id } = await params;
  const access = await assertCalendarAccess(id);
  if (!access.allowed) return NextResponse.json({ error: access.error }, { status: access.status });

  const calendar = await prisma.contentCalendar.findUnique({
    where: { id },
    include: {
      brand: true,
      posts: { orderBy: [{ postNumber: "asc" }, { date: "asc" }] },
      _count: { select: { posts: true } },
    },
  });
  if (!calendar) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(calendar);
}

export async function PATCH(request, { params }) {
  const { id } = await params;
  const access = await assertCalendarAccess(id);
  if (!access.allowed) return NextResponse.json({ error: access.error }, { status: access.status });

  const body = await request.json();

  // ── Status normalization ─────────────────────────────────────────────
  const VALID_STATUSES = ["draft", "ready_for_review", "approved", "active", "completed"];
  const rawStatus = body.status;
  const normalizedStatus = typeof rawStatus === "string" ? rawStatus.trim().toLowerCase() : undefined;

  if (rawStatus !== undefined && !VALID_STATUSES.includes(normalizedStatus)) {
    return NextResponse.json({ error: "Invalid calendar status" }, { status: 400 });
  }

  // Load the current stored status — never trust the request for this
  const currentCalendar = await prisma.contentCalendar.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!currentCalendar) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // ── Editor transition rules ──────────────────────────────────────────
  if (!access.isAdmin) {
    const contentKeys = ["title", "platform", "timePeriod", "mainMonthlySubject", "mainGoal", "mainOfferOrMessage", "sourceMaterial"];
    const hasContentChanges = contentKeys.some((key) => body[key] !== undefined);

    if (currentCalendar.status === "draft") {
      if (normalizedStatus && normalizedStatus !== "draft" && normalizedStatus !== "ready_for_review") {
        return NextResponse.json(
          { error: "Calendar Editors cannot set this calendar status" },
          { status: 403 }
        );
      }
    } else if (currentCalendar.status === "ready_for_review") {
      if (hasContentChanges) {
        return NextResponse.json(
          { error: "This calendar is read-only for Calendar Editors" },
          { status: 403 }
        );
      }
      if (!normalizedStatus || normalizedStatus !== "draft") {
        return NextResponse.json(
          { error: "This calendar is read-only for Calendar Editors" },
          { status: 403 }
        );
      }
    } else {
      return NextResponse.json(
        { error: "This calendar is read-only for Calendar Editors" },
        { status: 403 }
      );
    }
  }

  // ── Build update data ────────────────────────────────────────────────
  const updateData = {};
  if (body.title?.trim()) updateData.title = body.title.trim();
  if (body.platform?.trim()) updateData.platform = body.platform.trim();
  if (body.timePeriod?.trim()) updateData.timePeriod = body.timePeriod.trim();
  if (body.mainMonthlySubject?.trim()) updateData.mainMonthlySubject = body.mainMonthlySubject.trim();
  if (body.mainGoal?.trim()) updateData.mainGoal = body.mainGoal.trim();
  if (body.mainOfferOrMessage?.trim()) updateData.mainOfferOrMessage = body.mainOfferOrMessage.trim();
  if (body.sourceMaterial?.trim()) updateData.sourceMaterial = body.sourceMaterial.trim();
  if (normalizedStatus) updateData.status = normalizedStatus;

  const calendar = await prisma.contentCalendar.update({
    where: { id },
    data: updateData,
  });
  return NextResponse.json(calendar);
}

export async function DELETE(request, { params }) {
  const { id } = await params;
  const access = await assertCalendarAccess(id);
  if (!access.allowed) return NextResponse.json({ error: access.error }, { status: access.status });

  if (!access.isAdmin) {
    const calendar = await prisma.contentCalendar.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!calendar) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (calendar.status !== "draft") {
      return NextResponse.json(
        { error: "Only draft calendars can be deleted by Calendar Editors" },
        { status: 403 }
      );
    }
  }

  await prisma.contentCalendar.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
