import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAccessibleBrandIds } from "@/lib/brand-access";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // null means "no restriction" (admin). Everyone else is counted only across
  // the brands they belong to, so the totals never disclose the size of the
  // wider workspace.
  const brandIds = await getAccessibleBrandIds(user);
  const scope = brandIds === null ? {} : { brandId: { in: brandIds } };

  // Media reaches a brand either directly or through its calendar post.
  const mediaScope =
    brandIds === null
      ? {}
      : {
          OR: [
            { brandId: { in: brandIds } },
            { calendarPost: { calendar: { brandId: { in: brandIds } } } },
          ],
        };

  const brandWhere = brandIds === null ? {} : { id: { in: brandIds } };

  const [
    promptCount,
    mediaCount,
    templateCount,
    brandCount,
    calendarCount,
    recentMedia,
  ] = await Promise.all([
    prisma.generatedPrompt.count({ where: scope }),
    prisma.generatedMedia.count({ where: mediaScope }),
    // Prompt templates are global, not brand-owned.
    prisma.promptTemplate.count(),
    prisma.brand.count({ where: brandWhere }),
    prisma.contentCalendar.count({ where: scope }),
    prisma.generatedMedia.findMany({
      where: mediaScope,
      take: 5,
      orderBy: { createdAt: "desc" },
      select: { mediaType: true, status: true, createdAt: true },
    }),
  ]);

  const imageCount = await prisma.generatedMedia.count({
    where: { ...mediaScope, mediaType: "image" },
  });
  const videoCount = await prisma.generatedMedia.count({
    where: { ...mediaScope, mediaType: "video" },
  });

  const channels = [];
  if (imageCount > 0) channels.push("image");
  if (videoCount > 0) channels.push("video");
  if (promptCount > 0) channels.push("caption");

  return NextResponse.json({
    stats: {
      prompts: promptCount,
      media: mediaCount,
      templates: templateCount,
      brands: brandCount,
      calendars: calendarCount,
    },
    channels: channels.length > 0 ? channels : ["image", "video", "caption"],
    generatedAt: new Date().toISOString().split("T")[0],
  });
}
