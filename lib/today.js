// TODAY dashboard: everything due to be published today, per Brand, across the
// Brands the current user may access.
//
// Read-only by construction: two findMany calls (posts, stories) plus the Brand
// list. Nothing here writes, reschedules, deletes or sends to n8n.
//
// "Today" is Brand-local. Each Brand's IANA zone (fallback DEFAULT_BRAND_TIMEZONE,
// the same contract as scheduling) defines its own [startUtc, nextStartUtc)
// window via Luxon, so DST days are 23/25 hours long automatically.
//
// Collaboration: one PublishedPost is one publishing task. It is placed under
// its PRIMARY Brand when the viewer can access it; only a viewer who reaches it
// solely through a collaborator Brand sees it there (read-only), exactly as the
// existing Instagram grid exposes it. Never twice.
import { DateTime } from "luxon";
import { prisma } from "@/lib/prisma";
import { getAccessibleBrandIds } from "@/lib/brand-access";
import { resolveBrandTimezone, hasBrandTimezone } from "@/lib/timezone";
import { serializePublishedPost } from "@/lib/published-post-utils";
import { COLLABORATION_INCLUDE, decorateCollaboration } from "@/lib/published-post-collaborators";
import { serializeStoryDay } from "@/lib/story-content";
import { isStorySchemaMissing } from "@/lib/story-content-route";

export const TODAY_PLATFORMS = ["Instagram", "LinkedIn"];

// Statuses after which a post no longer needs publishing. `status` is the only
// persisted signal (manually set; successful n8n sends are not recorded).
const DONE_STATUSES = new Set(["published", "archived"]);

/** Brand-local today: { timeZone, isFallback, date, label, startUtc, endUtc }. */
export function brandTodayWindow(brandOrTz, now = new Date()) {
  const timeZone = resolveBrandTimezone(brandOrTz);
  const local = DateTime.fromJSDate(new Date(now), { zone: timeZone });
  const start = local.startOf("day");
  const next = start.plus({ days: 1 }).startOf("day");
  return {
    timeZone,
    isFallback: !hasBrandTimezone(brandOrTz),
    date: start.toFormat("yyyy-LL-dd"),
    label: start.setLocale("en-GB").toFormat("cccc, d LLLL yyyy"),
    startUtc: start.toJSDate(),
    endUtc: next.toJSDate(),
  };
}

function inWindow(value, win) {
  if (!value) return false;
  const t = new Date(value).getTime();
  return t >= win.startUtc.getTime() && t < win.endUtc.getTime();
}

/** Overdue = Brand-local scheduled time has passed and the post is not marked done. */
export function isPostOverdue(post, now = new Date()) {
  if (!post?.scheduledDate) return false;
  if (DONE_STATUSES.has(String(post.status || "").toLowerCase())) return false;
  return new Date(post.scheduledDate).getTime() <= new Date(now).getTime();
}

function localTimeLabel(value, timeZone) {
  return DateTime.fromJSDate(new Date(value), { zone: timeZone }).setLocale("en-US").toFormat("h:mm a");
}

function byScheduleAsc(a, b) {
  const d = new Date(a.scheduledDate) - new Date(b.scheduledDate);
  if (d) return d;
  const c = new Date(a.createdAt) - new Date(b.createdAt);
  if (c) return c;
  return String(a.id).localeCompare(String(b.id));
}

const emptyCounts = () => ({
  instagram: 0, linkedin: 0, stories: 0, posts: 0, total: 0,
  overdue: 0, storiesReady: 0, storiesUploaded: 0,
});

/**
 * Everything due today for `user`. Pure read.
 * Returns { now, brands: [...], counts } — `brands` lists every accessible
 * Brand (empty ones included so the UI can optionally show them).
 */
export async function getTodayData(user, { now = new Date() } = {}) {
  if (!user) return { now: new Date(now).toISOString(), brands: [], counts: { ...emptyCounts(), brandsWithActivity: 0 } };

  const accessibleIds = await getAccessibleBrandIds(user); // null = admin (all)
  const brandWhere = accessibleIds === null ? {} : { id: { in: accessibleIds } };
  const brandRows = await prisma.brand.findMany({
    where: brandWhere,
    select: { id: true, name: true, timezone: true },
    orderBy: { name: "asc" },
  });
  const accessible = new Map(brandRows.map((b) => [b.id, b]));
  const windows = new Map(brandRows.map((b) => [b.id, brandTodayWindow(b, now)]));

  // ── Posts: ONE query over a coarse ±27h band (covers every UTC offset), then
  // the exact per-primary-Brand window is applied below. ─────────────────────
  const nowMs = new Date(now).getTime();
  const band = { gte: new Date(nowMs - 27 * 3600e3), lt: new Date(nowMs + 27 * 3600e3) };
  const scope = accessibleIds === null
    ? {}
    : {
        OR: [
          { brandId: { in: accessibleIds } },
          { platform: "Instagram", collaborators: { some: { brandId: { in: accessibleIds } } } },
        ],
      };
  const postRows = brandRows.length === 0 ? [] : await prisma.publishedPost.findMany({
    where: { platform: { in: TODAY_PLATFORMS }, scheduledDate: band, ...scope },
    include: {
      media: { orderBy: { order: "asc" } },
      _count: { select: { comments: true } },
      ...COLLABORATION_INCLUDE,
    },
  });

  // ── Stories: ONE query for the (at most a few) distinct local dates. ───────
  const dates = [...new Set([...windows.values()].map((w) => w.date))];
  let storyRows = [];
  if (brandRows.length > 0) {
    try {
      storyRows = await prisma.brandStoryContent.findMany({
        where: {
          storyDate: { in: dates },
          ...(accessibleIds === null ? {} : { brandId: { in: accessibleIds } }),
        },
        include: { assets: { orderBy: { sortOrder: "asc" } } },
      });
    } catch (err) {
      // Same tolerance as the Story routes for a DB that predates the feature.
      if (!isStorySchemaMissing(err)) throw err;
    }
  }

  const sections = new Map(
    brandRows.map((b) => {
      const w = windows.get(b.id);
      return [b.id, {
        id: b.id,
        name: b.name,
        timeZone: w.timeZone,
        timeZoneIsFallback: w.isFallback,
        date: w.date,
        dateLabel: w.label,
        instagram: [],
        linkedin: [],
        stories: [],
        counts: emptyCounts(),
      }];
    }),
  );

  for (const raw of postRows) {
    // "Today" is the PRIMARY Brand's today: that is the zone the post is scheduled in.
    const primaryTz = raw.brand ? raw.brand.timezone : accessible.get(raw.brandId)?.timezone;
    const win = brandTodayWindow(primaryTz ?? null, now);
    if (!inWindow(raw.scheduledDate, win)) continue;

    // Placement: primary Brand if the viewer can access it, else the first
    // accessible collaborator Brand (by name). Exactly one section per post.
    let placeId = accessible.has(raw.brandId) ? raw.brandId : null;
    if (!placeId && raw.platform === "Instagram") {
      const collab = (raw.collaborators || [])
        .map((c) => c.brandId)
        .filter((id) => accessible.has(id))
        .sort((a, b) => accessible.get(a).name.localeCompare(accessible.get(b).name));
      placeId = collab[0] ?? null;
    }
    if (!placeId) continue; // defensive: never surface an unreachable post

    const post = decorateCollaboration(serializePublishedPost(raw), raw, {
      viewerBrandId: placeId,
      accessibleBrandIds: accessibleIds,
    });
    post.today = {
      timeZone: win.timeZone,
      localTime: localTimeLabel(raw.scheduledDate, win.timeZone),
      overdue: isPostOverdue(raw, now),
    };

    const section = sections.get(placeId);
    const list = raw.platform === "LinkedIn" ? section.linkedin : section.instagram;
    list.push(post);
  }

  for (const row of storyRows) {
    const section = sections.get(row.brandId);
    if (!section || row.storyDate !== section.date) continue; // other Brand's "today"
    section.stories.push(serializeStoryDay(row, row.brandId));
  }

  const totals = emptyCounts();
  for (const s of sections.values()) {
    s.instagram.sort(byScheduleAsc);
    s.linkedin.sort(byScheduleAsc);
    const c = s.counts;
    c.instagram = s.instagram.length;
    c.linkedin = s.linkedin.length;
    c.stories = s.stories.length;
    c.posts = c.instagram + c.linkedin;
    c.total = c.posts + c.stories;
    c.overdue = [...s.instagram, ...s.linkedin].filter((p) => p.today.overdue).length;
    c.storiesReady = s.stories.filter((x) => x.status !== "UPLOADED").length;
    c.storiesUploaded = s.stories.filter((x) => x.status === "UPLOADED").length;
    for (const k of Object.keys(totals)) totals[k] += c[k];
  }

  const brands = [...sections.values()];
  return {
    now: new Date(now).toISOString(),
    brands,
    counts: { ...totals, brandsWithActivity: brands.filter((b) => b.counts.total > 0).length },
  };
}
