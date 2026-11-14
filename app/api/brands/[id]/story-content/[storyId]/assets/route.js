import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeStoryDay, storyError, STORY_DAY_INCLUDE } from "@/lib/story-content-route";
import { saveStoryFile, removeStoryFile } from "@/lib/story-content-storage";
import { validateStoryFile, displayName, serializeStoryDay, MAX_STORY_ASSETS } from "@/lib/story-content";

export const dynamic = "force-dynamic";

// POST multipart "file" (one or more). Files are appended in the order sent.
// The client sends one file per request so large videos stay within body limits.
export async function POST(request, { params }) {
  const { id, storyId } = await params;
  const auth = await authorizeStoryDay(id, storyId);
  if (auth.response) return auth.response;

  let form;
  try { form = await request.formData(); } catch { return storyError("Invalid multipart request", 400); }
  const files = form.getAll("file").filter((f) => f && typeof f !== "string");
  if (!files.length) return storyError("At least one file is required", 400);

  if (auth.story.assets.length + files.length > MAX_STORY_ASSETS) {
    return storyError(`A Story day can hold at most ${MAX_STORY_ASSETS} assets.`, 409);
  }

  // Validate everything before writing anything.
  const validated = [];
  for (const file of files) {
    const v = await validateStoryFile(file);
    if (!v.ok) return storyError(v.error, 400);
    validated.push(v);
  }

  let nextOrder = auth.story.assets.reduce((m, a) => Math.max(m, a.sortOrder), 0);
  const uploaderName = displayName(auth.user);
  const written = [];
  try {
    for (const v of validated) {
      const storedPath = await saveStoryFile(id, storyId, v.ext, v.bytes);
      written.push(storedPath);
      await prisma.brandStoryAsset.create({
        data: {
          storyContentId: storyId,
          originalFileName: v.fileName,
          storedPath,
          mimeType: v.mimeType,
          mediaType: v.type,
          fileSize: v.bytes.length,
          sortOrder: ++nextOrder,
          uploadedByUserId: auth.user.id,
          uploadedByName: uploaderName,
        },
      });
    }
  } catch (err) {
    console.error("[StoryContent] asset save failed", { message: err?.message });
    // Roll back this request's rows and files only.
    await prisma.brandStoryAsset.deleteMany({ where: { storyContentId: storyId, storedPath: { in: written } } }).catch(() => {});
    for (const p of written) await removeStoryFile(p);
    return storyError("Failed to save Story asset", 500);
  }

  // Touch updatedAt so "Last updated" reflects asset changes.
  const story = await prisma.brandStoryContent.update({
    where: { id: storyId },
    data: { updatedAt: new Date() },
    include: STORY_DAY_INCLUDE,
  });
  return NextResponse.json({ success: true, story: serializeStoryDay(story, id) }, { status: 201 });
}

// PATCH { assetIds: [...] } — full new order; must list exactly this day's assets.
export async function PATCH(request, { params }) {
  const { id, storyId } = await params;
  const auth = await authorizeStoryDay(id, storyId);
  if (auth.response) return auth.response;

  let body;
  try { body = await request.json(); } catch { return storyError("Invalid JSON", 400); }
  const ids = body?.assetIds;
  const current = auth.story.assets.map((a) => a.id);
  if (
    !Array.isArray(ids) ||
    ids.length !== current.length ||
    new Set(ids).size !== ids.length ||
    !ids.every((x) => current.includes(x))
  ) {
    return storyError("assetIds must list every asset of this Story day exactly once", 400);
  }

  await prisma.$transaction(
    ids.map((assetId, i) =>
      prisma.brandStoryAsset.update({ where: { id: assetId }, data: { sortOrder: i + 1 } }),
    ),
  );
  const story = await prisma.brandStoryContent.update({
    where: { id: storyId },
    data: { updatedAt: new Date() },
    include: STORY_DAY_INCLUDE,
  });
  return NextResponse.json({ success: true, story: serializeStoryDay(story, id) });
}
