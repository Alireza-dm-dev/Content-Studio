// LinkedIn Published Posts retention.
//
// Rule (LinkedIn only, primary Brand only):
//   KEEP   every queued post (scheduled today-or-later in the Brand timezone,
//          or not scheduled at all)
//   KEEP   the LINKEDIN_HISTORY_KEEP most recent historical posts
//   DELETE every older historical post
//
// "Historical" = scheduledDate strictly before the START OF TODAY in the Brand's
// timezone (DEFAULT_BRAND_TIMEZONE when unset, same contract as scheduling).
// `status` is not used: it is a manual label (draft/published/archived) that no
// workflow updates, so it cannot tell queued from past. Posts with no
// scheduledDate were never scheduled and are never treated as historical.
//
// Must only run after an intentional mutation (create / adapt / relevant edit),
// never from a GET or page render.
//
// Deletion matches the existing Instagram 21-post cleanup and the manual delete
// tail: delete the row (media, comments and collaborator rows cascade), then
// remove the post's local upload folder. NO n8n delete webhook is sent: these
// posts are already live on LinkedIn and retention is local housekeeping only;
// the delete webhook would remove them from LinkedIn itself. Remote (SFTP)
// media is not touched, same as every other delete path in the app.
import { DateTime } from "luxon";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { resolveBrandTimezone } from "@/lib/timezone";
import { comparePublishedPosts } from "@/lib/published-post-order";
import { deletePublishedPostFiles as defaultDeleteFiles } from "@/lib/published-post-utils";

export const LINKEDIN_PLATFORM = "LinkedIn";
export const LINKEDIN_HISTORY_KEEP = 5;
export const LINKEDIN_RETENTION_REMOVED_MESSAGE =
  "This post was older than the five LinkedIn history posts retained for this Brand and was not kept.";

function validTime(value) {
  if (value == null) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Start of the Brand-local calendar day containing `now`, as a JS Date. */
export function brandDayStart(now, timeZone) {
  return DateTime.fromJSDate(new Date(now), { zone: resolveBrandTimezone(timeZone) })
    .startOf("day")
    .toJSDate();
}

/** True when the post's scheduledDate is before today in the Brand timezone. */
export function isHistoricalLinkedInPost(post, { now = new Date(), timeZone } = {}) {
  const t = validTime(post?.scheduledDate);
  if (t === null) return false;
  return t < brandDayStart(now, timeZone).getTime();
}

/**
 * Pure selection. Returns the ids to delete and a breakdown, without touching
 * the DB. The invariant is exact: all queued + at most `keep` historical. The
 * post that triggered cleanup gets NO exemption (routes pass no protectIds);
 * `protectIds` remains only as an explicit opt-in for callers/tests.
 */
export function selectLinkedInRetentionDeletions(
  posts,
  { now = new Date(), timeZone, keep = LINKEDIN_HISTORY_KEEP, protectIds = [] } = {},
) {
  const protectedSet = new Set(protectIds.filter(Boolean));
  const queued = [];
  const historical = [];
  for (const p of posts || []) {
    (isHistoricalLinkedInPost(p, { now, timeZone }) ? historical : queued).push(p);
  }
  // Same ordering as the grid: newest scheduledDate first, then createdAt, id.
  historical.sort(comparePublishedPosts);
  const kept = historical.slice(0, keep);
  const deleteIds = historical
    .slice(keep)
    .map((p) => p.id)
    .filter((id) => !protectedSet.has(id));
  return {
    queuedIds: queued.map((p) => p.id),
    keptHistoricalIds: kept.map((p) => p.id),
    deleteIds,
  };
}

/**
 * Enforce LinkedIn retention for one Brand. Best-effort: never throws, so a
 * cleanup problem cannot fail the mutation that triggered it.
 * Returns { deletedIds: string[] }.
 */
// Response fragment for a route: which rows retention removed and whether the
// post the request created/edited was one of them.
export function retentionResult(deletedIds, currentPostId) {
  return {
    deletedIds,
    currentPostRemoved: Boolean(currentPostId) && deletedIds.includes(currentPostId),
  };
}

export async function enforceLinkedInRetention(
  brandId,
  {
    timeZone,
    now = new Date(),
    protectIds = [],
    prisma = defaultPrisma,
    deleteFiles = defaultDeleteFiles,
  } = {},
) {
  const deletedIds = [];
  if (!brandId) return { deletedIds };
  try {
    let zone = timeZone;
    if (zone === undefined) {
      const brand = await prisma.brand.findUnique({ where: { id: brandId } });
      zone = brand?.timezone ?? null;
    }

    const posts = await prisma.publishedPost.findMany({
      where: { brandId, platform: LINKEDIN_PLATFORM },
      select: { id: true, scheduledDate: true, createdAt: true },
    });

    const { deleteIds } = selectLinkedInRetentionDeletions(posts, {
      now,
      timeZone: zone,
      protectIds,
    });

    for (const id of deleteIds) {
      try {
        // Re-scoped to brand + platform so a row that changed since the read
        // (e.g. moved to Instagram) is never removed by LinkedIn retention.
        const { count } = await prisma.publishedPost.deleteMany({
          where: { id, brandId, platform: LINKEDIN_PLATFORM },
        });
        if (count > 0) {
          deletedIds.push(id);
          await deleteFiles(id, brandId);
        }
      } catch (err) {
        console.error("[LinkedInRetention] cleanup failed for post", id, err?.message);
      }
    }
    if (deletedIds.length > 0) {
      console.log(`[LinkedInRetention] removed ${deletedIds.length} old LinkedIn posts for brand ${brandId}`);
    }
  } catch (err) {
    console.error("[LinkedInRetention] enforce failed", err?.message);
  }
  return { deletedIds };
}
