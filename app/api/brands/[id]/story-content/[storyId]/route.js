import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeStoryDay, storyError, STORY_DAY_INCLUDE } from "@/lib/story-content-route";
import { removeStoryDayDir } from "@/lib/story-content-storage";
import {
  parseStoryDate,
  normalizeComments,
  displayName,
  serializeStoryDay,
  STORY_STATUSES,
} from "@/lib/story-content";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { id, storyId } = await params;
  const auth = await authorizeStoryDay(id, storyId);
  if (auth.response) return auth.response;
  return NextResponse.json({ success: true, story: serializeStoryDay(auth.story, id) });
}

// PATCH { comments?, storyDate?, status? }
// status UPLOADED records who confirmed the manual upload and when; READY reopens.
export async function PATCH(request, { params }) {
  const { id, storyId } = await params;
  const auth = await authorizeStoryDay(id, storyId);
  if (auth.response) return auth.response;

  let body;
  try { body = await request.json(); } catch { return storyError("Invalid JSON", 400); }

  const data = {};
  if (body?.comments !== undefined) {
    const c = normalizeComments(body.comments);
    if (!c.ok) return storyError(c.error, 400);
    data.comments = c.text;
  }
  if (body?.storyDate !== undefined) {
    const d = parseStoryDate(body.storyDate);
    if (!d) return storyError("storyDate must be a valid YYYY-MM-DD date", 400);
    data.storyDate = d;
  }
  if (body?.status !== undefined) {
    if (!STORY_STATUSES.includes(body.status)) return storyError("status must be READY or UPLOADED", 400);
    if (body.status !== auth.story.status) {
      if (body.status === "UPLOADED") {
        data.status = "UPLOADED";
        data.completedByUserId = auth.user.id;
        data.completedByName = displayName(auth.user);
        data.completedAt = new Date();
      } else {
        data.status = "READY";
        data.completedByUserId = null;
        data.completedByName = null;
        data.completedAt = null;
      }
    }
  }
  if (!Object.keys(data).length) {
    return NextResponse.json({ success: true, story: serializeStoryDay(auth.story, id) });
  }

  try {
    const story = await prisma.brandStoryContent.update({
      where: { id: storyId },
      data,
      include: STORY_DAY_INCLUDE,
    });
    return NextResponse.json({ success: true, story: serializeStoryDay(story, id) });
  } catch (err) {
    if (err?.code === "P2002") return storyError("Another Story content already exists on that date.", 409);
    console.error("[StoryContent] update failed", { message: err?.message });
    return storyError("Failed to update Story content", 500);
  }
}

export async function DELETE(request, { params }) {
  const { id, storyId } = await params;
  const auth = await authorizeStoryDay(id, storyId);
  if (auth.response) return auth.response;

  // DB first (cascades asset rows), then this day's directory only.
  await prisma.brandStoryContent.delete({ where: { id: storyId } });
  await removeStoryDayDir(id, storyId);
  return NextResponse.json({ success: true });
}
