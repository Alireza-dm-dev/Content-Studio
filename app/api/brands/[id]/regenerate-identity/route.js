import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateWithPromptTemplate } from "@/lib/ai";
import { normalizeBrandIdentityOutput } from "@/lib/brand-identity-utils";

const TEMPLATE_SLUG = "brand-identity-regeneration";

export async function POST(request, { params }) {
  try {
    const { id } = await params;

    const { feedback = "", referenceImageIds = [] } = await request.json().catch(() => ({}));
    const hasFeedback = feedback.trim().length > 0;
    const hasImages = Array.isArray(referenceImageIds) && referenceImageIds.length > 0;

    if (!hasFeedback && !hasImages) {
      return NextResponse.json(
        { error: "Provide feedback text, reference images, or both." },
        { status: 400 },
      );
    }

    const brand = await prisma.brand.findUnique({ where: { id } });
    if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

    const currentIdentity = await prisma.brandIdentity.findFirst({
      where: { brandId: id },
      orderBy: { createdAt: "desc" },
    });
    if (!currentIdentity) {
      return NextResponse.json({ error: "No existing brand identity to regenerate" }, { status: 404 });
    }

    // Load reference images from DB
    let images = [];
    if (hasImages) {
      const imageFiles = await prisma.uploadedFile.findMany({
        where: { id: { in: referenceImageIds }, brandId: id },
      });
      images = imageFiles
        .filter((f) => f.fileType?.startsWith("image/"))
        .map((f) => ({ filePath: f.filePath, mediaType: f.fileType }));
    }

    const { brandVisualIdentity, brandToneInformationAndData } = normalizeBrandIdentityOutput(currentIdentity);
    const currentIdentityJson = JSON.stringify(
      { brandVisualIdentity, brandToneInformationAndData },
      null,
      2
    );

    const userInputParts = [
      "CURRENT BRAND IDENTITY JSON:",
      currentIdentityJson,
    ];

    if (hasFeedback) {
      userInputParts.push(
        "",
        "USER FEEDBACK TO APPLY:",
        feedback.trim(),
      );
    }

    if (images.length > 0) {
      userInputParts.push(
        "",
        `REFERENCE IMAGES: ${images.length} image${images.length > 1 ? "s" : ""} attached.`,
        "Extract relevant colors, typography cues, layout styles, mood, and visual patterns from these images and apply them to the brand identity.",
      );
    }

    userInputParts.push(
      "",
      "INSTRUCTIONS:",
      "- Revise the current identity JSON according to the feedback above.",
      "- Make the requested changes visible in the returned JSON — do not leave affected fields unchanged.",
      "- Preserve all fields not affected by the feedback or reference images.",
      "- Return the full updated JSON object with both \"brandVisualIdentity\" and \"brandToneInformationAndData\" sections.",
    );

    const userInput = userInputParts.join("\n");

    const variables = {
      name: brand.name,
      businessType: brand.businessType ?? "",
      mainServicesOrProducts: brand.mainServicesOrProducts ?? "",
      targetAudience: brand.targetAudience ?? "",
      brandTone: brand.brandTone ?? "",
      brandVisualStyle: brand.brandVisualStyle ?? "",
      website: brand.website ?? "",
      instagramPage: brand.instagramPage ?? "",
      manualNotes: "",
    };

    try {
      const result = await generateWithPromptTemplate({
        templateSlug: TEMPLATE_SLUG,
        variables,
        userInput,
        images,
      });
      return NextResponse.json({ ...result, imagesUsed: images.length });
    } catch (aiErr) {
      return NextResponse.json({ error: aiErr.message }, { status: 500 });
    }
  } catch (err) {
    console.error("[RegenerateIdentity] Unhandled error:", err);
    return NextResponse.json({ error: "Failed to regenerate brand identity. Please try again." }, { status: 500 });
  }
}
