import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeStoryDay, storyError, STORY_DAY_INCLUDE } from "@/lib/story-content-route";
import { streamStoryFile, removeStoryFile } from "@/lib/story-content-storage";
import { serializeStoryDay } from "@/lib/story-content";

export const dynamic = "force-dynamic";

function findAsset(story, assetId) {
  return story.assets.find((a) => a.id === assetId) ?? null;
}

// GET — inline preview, or ?download=1 for an attachment. Brand-authorized;
// the asset must belong to this Story day, which must belong to this brand.
export async function GET(request, { params }) {
  const { id, storyId, assetId } = await params;
  const auth = await authorizeStoryDay(id, storyId);
  if (auth.response) return auth.response;
  const asset = findAsset(auth.story, assetId);
  if (!asset) return storyError("Not found", 404);

  const download = new URL(request.url).searchParams.get("download") === "1";
  const res = await streamStoryFile({
    storedPath: asset.storedPath,
    mimeType: asset.mimeType,
    fileName: asset.originalFileName,
    download,
    rangeHeader: request.headers.get("range"),
  });
  return res ?? storyError("File is missing", 404);
}

export async function DELETE(request, { params }) {
  const { id, storyId, assetId } = await params;
  const auth = await authorizeStoryDay(id, storyId);
  if (auth.response) return auth.response;
  const asset = findAsset(auth.story, assetId);
  if (!asset) return storyError("Not found", 404);

  await prisma.brandStoryAsset.delete({ where: { id: assetId } });
  await removeStoryFile(asset.storedPath);
  const story = await prisma.brandStoryContent.update({
    where: { id: storyId },
    data: { updatedAt: new Date() },
    include: STORY_DAY_INCLUDE,
  });
  return NextResponse.json({ success: true, story: serializeStoryDay(story, id) });
}
