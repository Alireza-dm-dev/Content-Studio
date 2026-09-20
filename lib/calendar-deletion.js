/**
 * Deleting a content calendar and everything that exists only because of it.
 *
 * Deletion policy (verified against prisma/schema.prisma and the live SQLite
 * foreign keys, which are enforced — PRAGMA foreign_keys = 1):
 *
 *   DELETED — records whose only reason to exist is this calendar or one of
 *   its posts, and which hold no file on disk:
 *     CalendarPost              (FK ON DELETE CASCADE from ContentCalendar)
 *     GeneratedPrompt           calendarId = C or calendarPostId ∈ posts
 *     VideoStoryboard           calendarId = C or calendarPostId ∈ posts
 *     CombinedVisualDirection   calendarId = C or calendarPostId ∈ posts
 *     ReferenceImageAnalysis    calendarId = C or calendarPostId ∈ posts
 *
 *   PRESERVED — rows backed by a file on disk, or owned by the brand rather
 *   than the calendar. Their calendarId / calendarPostId is cleared (the FKs
 *   are ON DELETE SET NULL) so nothing is left pointing at a dead row, and
 *   their brandId keeps them inside brand scope:
 *     UploadedFile      reference attachments under public/uploads
 *     GeneratedMedia    generated image/video records + their token ledger
 *
 *   UNTOUCHED — no relation to a calendar at all:
 *     PublishedPost, PublishedPostMedia, PublishedPostComment, Brand,
 *     BrandIdentity, PromptTemplate, WorkspaceReview.
 *
 * Files on disk are never removed here. UploadedFile and GeneratedMedia rows
 * survive with their filePath intact, so no upload or generated asset is
 * silently destroyed by deleting a calendar.
 *
 * The explicit deletes run inside one transaction rather than relying on the
 * database: two of the child tables (ReferenceImageAnalysis,
 * CombinedVisualDirection) carry a calendarPostId column with no foreign key
 * behind it, so cascade alone would leave them pointing at deleted posts.
 */

import { prisma } from "@/lib/prisma";

export async function deleteCalendarCascade(calendarId, client = prisma) {
  const runner = typeof client.$transaction === "function"
    ? (fn) => client.$transaction(fn)
    : (fn) => fn(client);

  return runner(async (tx) => {
    const posts = await tx.calendarPost.findMany({
      where: { calendarId },
      select: { id: true },
    });
    const postIds = posts.map((p) => p.id);

    // Matches a child row attached to the calendar itself or to one of its posts.
    const ownedByCalendar = {
      OR: [{ calendarId }, ...(postIds.length ? [{ calendarPostId: { in: postIds } }] : [])],
    };

    // CombinedVisualDirection first: it references ReferenceImageAnalysis.
    await tx.combinedVisualDirection.deleteMany({ where: ownedByCalendar });
    await tx.referenceImageAnalysis.deleteMany({ where: ownedByCalendar });
    await tx.generatedPrompt.deleteMany({ where: ownedByCalendar });
    await tx.videoStoryboard.deleteMany({ where: ownedByCalendar });

    // Detach the preserved, file-backed rows explicitly. The FKs would do this
    // anyway; doing it here keeps the policy readable and independent of the
    // database's cascade configuration.
    await tx.uploadedFile.updateMany({
      where: ownedByCalendar,
      data: { calendarId: null, calendarPostId: null },
    });
    if (postIds.length) {
      await tx.generatedMedia.updateMany({
        where: { calendarPostId: { in: postIds } },
        data: { calendarPostId: null },
      });
    }

    // CalendarPost rows go with the calendar via ON DELETE CASCADE.
    await tx.contentCalendar.delete({ where: { id: calendarId } });

    return { calendarId, deletedPostCount: postIds.length };
  });
}
