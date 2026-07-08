import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const brands = await prisma.brand.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(brands);
}

export async function POST(request) {
  const body = await request.json();
  const {
    name, website, instagramPage, linkedinPage, facebookPage,
    businessLocation, businessType, mainServicesOrProducts,
    targetAudience, brandTone, brandVisualStyle,
  } = body;
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  const brand = await prisma.brand.create({
    data: {
      name: name.trim(), website, instagramPage, linkedinPage, facebookPage,
      businessLocation, businessType, mainServicesOrProducts,
      targetAudience, brandTone, brandVisualStyle,
    },
  });
  return NextResponse.json(brand, { status: 201 });
}
