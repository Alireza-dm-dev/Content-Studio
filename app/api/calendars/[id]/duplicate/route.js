import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request, { params }) {
  const { id } = await params;

  const original = await prisma.contentCalendar.findUnique({
    where: { id },
    include: { posts: true },
  });
  if (!original) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const duplicate = await prisma.contentCalendar.create({
    data: {
      brandId: original.brandId,
      title: `${original.title} (Copy)`,
      platform: original.platform,
      timePeriod: original.timePeriod,
      mainMonthlySubject: original.mainMonthlySubject,
      mainGoal: original.mainGoal,
      mainOfferOrMessage: original.mainOfferOrMessage,
      sourceMaterial: original.sourceMaterial,
      status: "draft",
      posts: {
        create: original.posts.map((p) => ({
          postNumber: p.postNumber,
          date: p.date,
          platform: p.platform,
          format: p.format,
          suggestedHook: p.suggestedHook,
          mainAngleAndCoreMessage: p.mainAngleAndCoreMessage,
          suggestedCaption: p.suggestedCaption,
          contentStructure: p.contentStructure,
          visualDirection: p.visualDirection,
          outputImageTextRequirements: p.outputImageTextRequirements,
          inspirationSource: p.inspirationSource,
          referenceLink: p.referenceLink,
          adaptationNote: p.adaptationNote,
          contentOrigin: p.contentOrigin,
          // postData carries fields that only live in the JSON blob (hashtags,
          // imageText, structure, video fields, outputImageTextRequirementsStructured...).
          // Without copying it, duplicated calendars silently lose that data.
          postData: p.postData,
          status: "draft",
        })),
      },
    },
    include: { _count: { select: { posts: true } } },
  });

  return NextResponse.json(duplicate, { status: 201 });
}
