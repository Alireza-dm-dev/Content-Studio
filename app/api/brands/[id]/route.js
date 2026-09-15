import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBrandAccess } from "@/lib/brand-access";
import { unlink } from "fs/promises";
import path from "path";
import { normalizeLanguageCode, isSupportedLanguageCode } from "@/lib/content-language";

export async function GET(request, { params }) {
  const { id } = await params;

  const brandAccess = await requireBrandAccess(id);
  if (!brandAccess.ok) {
    return NextResponse.json(
      { error: brandAccess.error },
      { status: brandAccess.status },
    );
  }
  const brand = await prisma.brand.findUnique({ where: { id } });
  if (!brand) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(brand);
}

export async function PATCH(request, { params }) {
  const { id } = await params;

  const brandAccess = await requireBrandAccess(id);
  if (!brandAccess.ok) {
    return NextResponse.json(
      { error: brandAccess.error },
      { status: brandAccess.status },
    );
  }
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

  const brandAccess = await requireBrandAccess(id);
  if (!brandAccess.ok) {
    return NextResponse.json(
      { error: brandAccess.error },
      { status: brandAccess.status },
    );
  }

  // Membership lets a user work inside a brand; removing the brand itself is
  // destructive and cross-cutting, so it stays with admins.
  if (brandAccess.user.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
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
