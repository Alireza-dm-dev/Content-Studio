import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { brandScopeWhere, requireBrandAccess } from "@/lib/brand-access";

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
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const brandId = searchParams.get("brandId");
  const type = searchParams.get("type");

  // An explicit brand filter must be one the user may see; an absent filter
  // falls back to every brand they can access, never to every brand.
  if (brandId) {
    const access = await requireBrandAccess(brandId, { user });
    if (!access.ok) {
      return NextResponse.json(
        { success: false, error: access.error },
        { status: access.status }
      );
    }
  }

  const prompts = await prisma.generatedPrompt.findMany({
    where: {
      ...(brandId ? { brandId } : await brandScopeWhere(user)),
      ...(type ? { type } : {}),
    },
    include: { brand: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(prompts);
}

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
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

  // A client may not file a prompt under a brand it has no membership for.
  if (data.brandId) {
    const access = await requireBrandAccess(data.brandId, { user });
    if (!access.ok) {
      return NextResponse.json(
        { success: false, error: access.error },
        { status: access.status }
      );
    }
  }

  const prompt = await prisma.generatedPrompt.create({ data });
  return NextResponse.json(prompt, { status: 201 });
}
