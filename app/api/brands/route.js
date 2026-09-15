import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeLanguageCode, isSupportedLanguageCode, DEFAULT_CONTENT_LANGUAGE } from "@/lib/content-language";
import { getCurrentUser } from "@/lib/auth";
import { brandScopeWhere } from "@/lib/brand-access";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // Scoped on the server: this endpoint backs every brand dropdown in the app,
  // so an unscoped list would disclose brands a user has no membership for.
  const brands = await prisma.brand.findMany({
    where: await brandScopeWhere(user, "id"),
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(brands);
}

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

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
