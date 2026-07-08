import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const brandId = searchParams.get("brandId");
  const type = searchParams.get("type");
  const prompts = await prisma.generatedPrompt.findMany({
    where: {
      ...(brandId ? { brandId } : {}),
      ...(type ? { type } : {}),
    },
    include: { brand: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(prompts);
}

export async function POST(request) {
  const body = await request.json();
  const { type, mode, targetTool, rawInput, referenceData, finalPrompt, brandId, calendarId, calendarPostId } = body;
  const prompt = await prisma.generatedPrompt.create({
    data: {
      type,
      mode,
      targetTool,
      rawInput,
      referenceData,
      finalPrompt,
      brandId: brandId || null,
      calendarId: calendarId || null,
      calendarPostId: calendarPostId || null,
    },
  });
  return NextResponse.json(prompt, { status: 201 });
}
