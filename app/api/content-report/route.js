import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  const [
    promptCount,
    mediaCount,
    templateCount,
    brandCount,
    calendarCount,
    recentMedia,
  ] = await Promise.all([
    prisma.generatedPrompt.count(),
    prisma.generatedMedia.count(),
    prisma.promptTemplate.count(),
    prisma.brand.count(),
    prisma.contentCalendar.count(),
    prisma.generatedMedia.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      select: { mediaType: true, status: true, createdAt: true },
    }),
  ]);

  const imageCount = await prisma.generatedMedia.count({
    where: { mediaType: "image" },
  });
  const videoCount = await prisma.generatedMedia.count({
    where: { mediaType: "video" },
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
