import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeLanguageCode, isSupportedLanguageCode, DEFAULT_CONTENT_LANGUAGE } from "@/lib/content-language";

export async function GET() {
  const brands = await prisma.brand.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(brands);
}

export async function POST(request) {
  const body = await request.json();
  const {
    name, website, instagramPage, linkedinPage, facebookPage,
    businessLocation, businessType, mainServicesOrProducts,
    targetAudience, brandTone, brandVisualStyle, contentLanguage,
  } = body;
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (contentLanguage !== undefined && !isSupportedLanguageCode(contentLanguage)) {
    return NextResponse.json(
      { success: false, error: "Unsupported content language." },
      { status: 400 }
    );
  }
  const normalizedLanguage = contentLanguage !== undefined
    ? normalizeLanguageCode(contentLanguage)
    : DEFAULT_CONTENT_LANGUAGE;
  const brand = await prisma.brand.create({
    data: {
      name: name.trim(), website, instagramPage, linkedinPage, facebookPage,
      businessLocation, businessType, mainServicesOrProducts,
      targetAudience, brandTone, brandVisualStyle,
      contentLanguage: normalizedLanguage,
    },
  });
  return NextResponse.json(brand, { status: 201 });
}
