// Stale generated output after a slide-structure change.
//
// Dependency map (CalendarPost → things generated for it), from prisma/schema.prisma
// and the routes that create them:
//
//   GeneratedPrompt (type "image", calendarPostId)      STALE  – finalPrompt + rawInput embed the old
//        rawInput: carouselMode/carouselSlideNumber,           slide list, per-slide numbers and image text
//        calendarPost snapshot, outputImageTextRequirements
//   GeneratedMedia  (mediaType "image", calendarPostId) STALE  – rendered from an old-structure prompt;
//        shown as "Post #N" on /generated-media               would still read as belonging to Post #N
//   CombinedVisualDirection (calendarPostId)            STALE  – carouselSlideNumber + textRequirements
//                                                              (old slide image text)
//   GeneratedPrompt (type "video") / GeneratedMedia     OK     – video fields are not slide-based
//        (mediaType "video") / VideoStoryboard
//   ReferenceImageAnalysis (calendarPostId)             OK     – analysis of an uploaded reference image
//   UploadedFile (post reference files)                 OK     – reference inputs, not outputs
//   Brand-level media/prompts with no calendarPostId    OK     – unrelated
//
// Policy: mirror lib/calendar-deletion.js, which already treats generated media
// as preserved, file-backed assets that are DETACHED from a post (calendarPostId
// → null) rather than deleted. Nothing is deleted and no file is touched; the
// stale rows simply stop claiming to belong to this post's new slide layout.
// Media keeps its brand (backfilled from the calendar when missing) so it stays
// visible to the same users on /generated-media.

/**
 * Detaches slide-specific generated outputs from a post. Run inside the same
 * transaction as the post update. Returns counts for the UI.
 */
export async function detachSlideSpecificOutputs(tx, { postId, brandId, previousSlideCount, newSlideCount }) {
  const result = { media: 0, prompts: 0, visualDirections: 0 };
  if (!postId) return result;

  const media = await tx.generatedMedia.findMany({
    where: { calendarPostId: postId, mediaType: "image" },
    select: { id: true, brandId: true },
  });
  for (const m of media) {
    await tx.generatedMedia.update({
      where: { id: m.id },
      data: { calendarPostId: null, ...(m.brandId ? {} : brandId ? { brandId } : {}) },
    });
  }
  result.media = media.length;

  const prompts = await tx.generatedPrompt.findMany({
    where: { calendarPostId: postId, type: "image" },
    select: { id: true, rawInput: true },
  });
  for (const p of prompts) {
    let raw = null;
    try { raw = p.rawInput ? JSON.parse(p.rawInput) : null; } catch { raw = null; }
    const provenance = raw && typeof raw === "object" && !Array.isArray(raw)
      ? {
          rawInput: JSON.stringify({
            ...raw,
            detachedFromPost: { postId, reason: "slide_structure_changed", previousSlideCount, newSlideCount, at: new Date().toISOString() },
          }),
        }
      : {};
    await tx.generatedPrompt.update({ where: { id: p.id }, data: { calendarPostId: null, ...provenance } });
  }
  result.prompts = prompts.length;

  const cvd = await tx.combinedVisualDirection.updateMany({
    where: { calendarPostId: postId },
    data: { calendarPostId: null },
  });
  result.visualDirections = cvd?.count ?? 0;

  return result;
}

/** UI message — only when something was actually detached. */
export function describeStaleOutputs(counts) {
  const { media = 0, prompts = 0 } = counts || {};
  if (!media && !prompts) return null;
  const parts = [];
  if (media) parts.push(`${media} generated image${media > 1 ? "s" : ""}`);
  if (prompts) parts.push(`${prompts} image prompt${prompts > 1 ? "s" : ""}`);
  return `${parts.join(" and ")} made for the old slide layout ${media + prompts > 1 ? "were" : "was"} kept but detached from this post, because ${media + prompts > 1 ? "they" : "it"} may no longer match the new slides.`;
}
