import { prisma } from "@/lib/prisma";
import { serializePublishedPosts } from "@/lib/published-post-utils";

const brandSelect = {
  id: true,
  name: true,
  businessType: true,
  businessLocation: true,
};

const calendarSelect = {
  id: true,
  title: true,
  platform: true,
  timePeriod: true,
  status: true,
  _count: { select: { posts: true } },
};

const mediaSelect = {
  id: true,
  url: true,
  mediaType: true,
  order: true,
  fileName: true,
};

const postSelect = {
  id: true,
  postType: true,
  caption: true,
  platform: true,
  status: true,
  scheduledDate: true,
  thumbnailUrl: true,
  postNumber: true,
  createdAt: true,
  // Needed only to resolve the public media URLs; stripped before returning.
  jsonPayload: true,
  _count: { select: { comments: true } },
};

export async function loadWorkspaceReviewPublicData(review) {
  const brand = await prisma.brand.findUnique({
    where: { id: review.brandId },
    select: brandSelect,
  });

  if (!brand) {
    return { brand: null, calendars: [], instagramPosts: [], linkedinPosts: [] };
  }

  const [rawCalendars, instagramPosts, linkedinPosts] = await Promise.all([
    review.includeCalendars
      ? prisma.contentCalendar.findMany({
          where: { brandId: review.brandId },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: calendarSelect,
        })
      : Promise.resolve([]),
    review.includeInstagram
      ? prisma.publishedPost.findMany({
          where: { brandId: review.brandId, platform: "Instagram" },
          orderBy: { createdAt: "desc" },
          select: {
            ...postSelect,
            media: { select: mediaSelect, orderBy: { order: "asc" } },
          },
        })
      : Promise.resolve([]),
    review.includeLinkedIn
      ? prisma.publishedPost.findMany({
          where: { brandId: review.brandId, platform: "LinkedIn" },
          orderBy: { createdAt: "desc" },
          select: {
            ...postSelect,
            media: { select: mediaSelect, orderBy: { order: "asc" } },
          },
        })
      : Promise.resolve([]),
  ]);

  const calendars = rawCalendars.map((c) => ({
    id: c.id,
    title: c.title,
    platform: c.platform,
    timePeriod: c.timePeriod,
    status: c.status,
    postCount: c._count?.posts ?? 0,
  }));

  // Same normalizer as the workspace APIs so the public review page renders
  // the public media URLs, not the local /uploads paths. The raw n8n payload
  // is internal, so it is dropped from the public response.
  const mapPosts = (posts) =>
    serializePublishedPosts(posts, { includePayload: false });

  return {
    brand,
    calendars,
    instagramPosts: mapPosts(instagramPosts),
    linkedinPosts: mapPosts(linkedinPosts),
  };
}
