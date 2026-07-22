import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { unlink } from "fs/promises";
import path from "path";
import { normalizeLanguageCode, isSupportedLanguageCode } from "@/lib/content-language";

export async function GET(request, { params }) {
  const { id } = await params;
  const brand = await prisma.brand.findUnique({ where: { id } });
  if (!brand) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(brand);
}

export async function PATCH(request, { params }) {
  const { id } = await params;
  const body = await request.json();
  // Strip unknown / relation fields to avoid Prisma errors
  const {
    name, website, instagramPage, linkedinPage, facebookPage,
    businessLocation, businessType, mainServicesOrProducts,
    targetAudience, brandTone, brandVisualStyle, contentLanguage,
  } = body;
  if ("contentLanguage" in body && !isSupportedLanguageCode(contentLanguage)) {
    return NextResponse.json(
      { success: false, error: "Unsupported content language." },
      { status: 400 }
    );
  }
  const updateData = {
    name, website, instagramPage, linkedinPage, facebookPage,
    businessLocation, businessType, mainServicesOrProducts,
    targetAudience, brandTone, brandVisualStyle,
  };
  if ("contentLanguage" in body) {
    updateData.contentLanguage = normalizeLanguageCode(contentLanguage);
  }
  const brand = await prisma.brand.update({
    where: { id },
    data: updateData,
  });
  return NextResponse.json(brand);
}

export async function DELETE(request, { params }) {
  const { id } = await params;
  // Collect file paths before deletion
  const files = await prisma.uploadedFile.findMany({ where: { brandId: id } });
  await prisma.brand.delete({ where: { id } });
  // Clean up physical files (best-effort)
  for (const file of files) {
    try {
      await unlink(path.join(process.cwd(), "public", file.filePath));
    } catch {}
  }
  return NextResponse.json({ success: true });
}
