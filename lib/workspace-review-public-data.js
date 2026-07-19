import { prisma } from "@/lib/prisma";

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

  const mapPosts = (posts) =>
    posts.map(({ _count, ...rest }) => ({
      ...rest,
      commentCount: _count?.comments ?? 0,
    }));

  return {
    brand,
    calendars,
    instagramPosts: mapPosts(instagramPosts),
    linkedinPosts: mapPosts(linkedinPosts),
  };
}
