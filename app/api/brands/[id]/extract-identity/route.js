import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateWithPromptTemplate } from "@/lib/ai";

const TEMPLATE_SLUG = "brand-visual-identity-extractor";

const FALLBACK_TEMPLATE = `I have uploaded screenshots from the Instagram page and/or website of a business, plus some basic brand information and optional manual notes.

Your task is to analyze everything provided and extract the brand identity into TWO clearly separated top-level JSON sections:

1. "brandVisualIdentity" — everything about how the brand LOOKS: colors, typography, logo usage, shapes/graphics, layout and composition, image and video style, visual mood, and visual do/don't rules. This section alone will later be handed to AI image and video generation tools, so it must contain ONLY visual/design observations — never business facts, audience info, offers, or contact details.

2. "brandToneInformationAndData" — everything about the brand's WORDS, BUSINESS, and AUDIENCE: brand name, industry, services or products, target audience, location/market, personality, tone of voice, content style, goals, key messages, offers, contact information, website, social links, and content do/don't rules. This section must contain ONLY business/messaging facts — never visual/design details.

A fact belongs in exactly ONE section. Never duplicate a field across both sections.

Output exactly this JSON shape — fill in every field; use "" for unknown text values and [] for unknown lists; never omit a key:

{
  "brandVisualIdentity": {
    "summary": "",
    "colors": {
      "primaryColors": [],
      "secondaryColors": [],
      "accentColors": [],
      "neutralColors": [],
      "colorUsageRules": ""
    },
    "typography": {
      "fontStyle": "",
      "headingStyle": "",
      "bodyTextStyle": "",
      "typographyUsageRules": ""
    },
    "logoUsage": {
      "logoDescription": "",
      "placementRules": "",
      "sizeRules": "",
      "backgroundRules": "",
      "avoidRules": ""
    },
    "shapesAndGraphicElements": {
      "commonShapes": "",
      "iconStyle": "",
      "illustrationStyle": "",
      "patternStyle": "",
      "graphicMotifs": ""
    },
    "layoutAndComposition": {
      "layoutStyle": "",
      "spacingStyle": "",
      "alignmentRules": "",
      "compositionRules": ""
    },
    "imageAndVideoStyle": {
      "imageStyle": "",
      "photoStyle": "",
      "videoStyle": "",
      "lightingMood": "",
      "environmentStyle": "",
      "preferredSubjects": ""
    },
    "visualMood": "",
    "visualDoRules": [],
    "visualDontRules": [],
    "imagePromptGuidance": "",
    "videoPromptGuidance": ""
  },
  "brandToneInformationAndData": {
    "brandName": "",
    "industry": "",
    "servicesOrProducts": [],
    "targetAudience": "",
    "locationOrMarket": "",
    "brandPersonality": [],
    "toneOfVoice": [],
    "contentStyle": "",
    "businessGoals": [],
    "keyMessages": [],
    "offers": [],
    "contactInformation": "",
    "website": "",
    "socialLinks": [],
    "contentDoRules": [],
    "contentDontRules": [],
    "notes": ""
  }
}

Rules:
- Only use what you can clearly observe in the uploaded images or what is explicitly given in the brand information / manual notes below. Do not invent details.
- Output ONLY valid JSON — no markdown, no code blocks (no \`\`\`), no explanations before or after the JSON.
- Use "" for missing text fields and [] for missing list fields. Never omit a key from the shape above and never add extra top-level keys.
- Keep "brandVisualIdentity" strictly visual — this is the only section AI image/video prompt generation will ever see.
- Keep "brandToneInformationAndData" strictly about business, audience, and messaging.`;

function needsTemplateUpdate(text) {
  if (!text || text.includes("// Placeholder for:")) return true;
  return !text.includes("brandVisualIdentity") || !text.includes("brandToneInformationAndData");
}

export async function POST(request, { params }) {
  const { id } = await params;

  const brand = await prisma.brand.findUnique({ where: { id } });
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  const { selectedFileIds = [], manualNotes = "" } = await request.json();

  // Load selected uploaded files
  const allFiles = await prisma.uploadedFile.findMany({
    where: { brandId: id },
    orderBy: { createdAt: "asc" },
  });

  const selectedFiles = selectedFileIds.length > 0
    ? allFiles.filter((f) => selectedFileIds.includes(f.id))
    : allFiles; // default to all if nothing specified

  const images = selectedFiles
    .filter((f) => f.fileType?.startsWith("image/"))
    .map((f) => ({ filePath: f.filePath, mediaType: f.fileType }));

  const variables = {
    name: brand.name,
    businessType: brand.businessType ?? "",
    mainServicesOrProducts: brand.mainServicesOrProducts ?? "",
    targetAudience: brand.targetAudience ?? "",
    brandTone: brand.brandTone ?? "",
    brandVisualStyle: brand.brandVisualStyle ?? "",
    website: brand.website ?? "",
    instagramPage: brand.instagramPage ?? "",
    manualNotes: manualNotes.trim(),
  };

  try {
    const template = await prisma.promptTemplate.findUnique({ where: { slug: TEMPLATE_SLUG } });
    if (template && needsTemplateUpdate(template.templateText)) {
      await prisma.promptTemplate.update({
        where: { slug: TEMPLATE_SLUG },
        data: { templateText: FALLBACK_TEMPLATE },
      });
    }

    const result = await generateWithPromptTemplate({
      templateSlug: TEMPLATE_SLUG,
      variables,
      images,
    });
    return NextResponse.json({ ...result, imagesUsed: images.length });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
