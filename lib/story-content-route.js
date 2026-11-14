import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireResourceBrandAccess } from "@/lib/brand-access";

export function storyError(message, status) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export const STORY_DAY_INCLUDE = { assets: { orderBy: { sortOrder: "asc" } } };

/**
 * Authorize against the Story day's own brand, then require it to match the
 * brand in the URL, so a guessed id under another brand's path is a plain 404.
 */
export async function authorizeStoryDay(routeBrandId, storyId) {
  const access = await requireResourceBrandAccess("storyContent", storyId);
  if (!access.ok) return { response: storyError(access.error, access.status) };
  const story = await prisma.brandStoryContent.findUnique({
    where: { id: storyId },
    include: STORY_DAY_INCLUDE,
  });
  if (!story || story.brandId !== routeBrandId) return { response: storyError("Not found", 404) };
  return { story, user: access.user };
}
