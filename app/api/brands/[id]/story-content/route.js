import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBrandAccess } from "@/lib/brand-access";
import { storyError, STORY_DAY_INCLUDE } from "@/lib/story-content-route";
import {
  parseStoryDate,
  parseStoryMonth,
  normalizeComments,
  displayName,
  serializeStoryDaySummary,
  serializeStoryDay,
} from "@/lib/story-content";

export const dynamic = "force-dynamic";

// GET ?month=YYYY-MM — lightweight summaries for one month of one brand.
export async function GET(request, { params }) {
  const { id: brandId } = await params;
  const access = await requireBrandAccess(brandId);
  if (!access.ok) return storyError(access.error, access.status);

  const month = parseStoryMonth(new URL(request.url).searchParams.get("month"));
  if (!month) return storyError("month must be YYYY-MM", 400);

  const rows = await prisma.brandStoryContent.findMany({
    where: { brandId, storyDate: { startsWith: month.prefix } },
    select: { id: true, storyDate: true, status: true, _count: { select: { assets: true } } },
    orderBy: { storyDate: "asc" },
  });
  return NextResponse.json({ success: true, days: rows.map(serializeStoryDaySummary) });
}

// POST { storyDate, comments? } — create the Story day for a date.
export async function POST(request, { params }) {
  const { id: brandId } = await params;
  const access = await requireBrandAccess(brandId);
  if (!access.ok) return storyError(access.error, access.status);

  let body;
  try { body = await request.json(); } catch { return storyError("Invalid JSON", 400); }

  const storyDate = parseStoryDate(body?.storyDate);
  if (!storyDate) return storyError("storyDate must be a valid YYYY-MM-DD date", 400);
  const comments = normalizeComments(body?.comments);
  if (!comments.ok) return storyError(comments.error, 400);

  const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { id: true } });
  if (!brand) return storyError("Brand not found", 404);

  try {
    const story = await prisma.brandStoryContent.create({
      data: {
        brandId,
        storyDate,
        comments: comments.text,
        status: "READY",
        createdByUserId: access.user.id,
        createdByName: displayName(access.user),
      },
      include: STORY_DAY_INCLUDE,
    });
    return NextResponse.json({ success: true, story: serializeStoryDay(story, brandId) }, { status: 201 });
  } catch (err) {
    if (err?.code === "P2002") {
      const existing = await prisma.brandStoryContent.findUnique({
        where: { brandId_storyDate: { brandId, storyDate } },
        select: { id: true },
      });
      return NextResponse.json(
        { success: false, error: "Story content already exists for this date.", existingId: existing?.id ?? null },
        { status: 409 },
      );
    }
    console.error("[StoryContent] create failed", { message: err?.message });
    return storyError("Failed to create Story content", 500);
  }
}
