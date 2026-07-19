import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminAccess } from "@/lib/auth";

const WRITABLE_FIELDS = new Set([
  "type",
  "mode",
  "targetTool",
  "rawInput",
  "referenceData",
  "finalPrompt",
  "brandId",
  "calendarId",
  "calendarPostId",
]);

export async function GET(request) {
  const access = await getAdminAccess();
  if (!access.user) {
    return NextResponse.json(
      { success: false, error: access.error },
      { status: access.status }
    );
  }

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
  const access = await getAdminAccess();
  if (!access.user) {
    return NextResponse.json(
      { success: false, error: access.error },
      { status: access.status }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { success: false, error: "Request body must be a JSON object" },
      { status: 400 }
    );
  }

  const data = {};
  for (const key of WRITABLE_FIELDS) {
    if (key in body) {
      data[key] = body[key];
    }
  }

  data.brandId = data.brandId || null;
  data.calendarId = data.calendarId || null;
  data.calendarPostId = data.calendarPostId || null;

  const prompt = await prisma.generatedPrompt.create({ data });
  return NextResponse.json(prompt, { status: 201 });
}
