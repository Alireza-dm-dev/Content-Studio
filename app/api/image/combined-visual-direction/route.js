import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateWithPromptTemplate } from "@/lib/ai";
import { normalizeBrandIdentityOutput, createCompactBrandVisualIdentitySummaryForImagePrompt } from "@/lib/brand-identity-utils";

function parseAiJson(raw) {
  if (!raw?.trim()) throw new Error("AI returned empty output.");
  let text = raw.trim();
  try { return JSON.parse(text); } catch {}
  text = text.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/im, "").trim();
  try { return JSON.parse(text); } catch {}
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s !== -1 && e > s) { try { return JSON.parse(text.slice(s, e + 1)); } catch {} }
  throw new Error("Could not parse AI response as JSON. Check server logs.");
}

// ── GET: reference-flow history (latest 10 per brand) ───────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const history = searchParams.get("history");

  if (history !== "reference-flow") {
    return NextResponse.json({ success: false, error: "Unsupported or missing history query." }, { status: 400 });
  }

  const brandId = searchParams.get("brandId");
  if (!brandId) {
    return NextResponse.json({ success: false, error: "brandId is required." }, { status: 400 });
  }

  let limit = parseInt(searchParams.get("limit"), 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 10;
  limit = Math.min(limit, 10);

  try {
    const rows = await prisma.combinedVisualDirection.findMany({
      where: {
        brandId,
        sourceFlow: "create_image_brand_reference_mode",
        finalNanobananaPrompt: { not: null },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        referenceImageAnalysis: {
          include: {
            uploadedFile: { select: { filePath: true, fileName: true } },
          },
        },
      },
    });

    const items = rows.map((row) => ({
      id: row.id,
      brandId: row.brandId,
      createdAt: row.createdAt,
      finalNanobananaPrompt: row.finalNanobananaPrompt,
      referenceImageAnalysisId: row.referenceImageAnalysisId,
      referenceImageUrl: row.referenceImageAnalysis?.uploadedFile?.filePath ?? null,
      referenceImageFileName: row.referenceImageAnalysis?.uploadedFile?.fileName ?? null,
      referenceAnalysisJsonOutput: row.referenceImageAnalysis?.jsonOutput ?? null,
    }));

    return NextResponse.json({ success: true, items });
  } catch (err) {
    console.error("[CombinedVisualDir] GET history error:", err);
    return NextResponse.json({
      success: false,
      error: "Failed to load reference-flow history.",
      details: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}

export async function POST(request) {
  console.log("[CombinedVisualDir] POST /api/image/combined-visual-direction");

  try {
    let body;
    try { body = await request.json(); }
    catch (e) {
      return NextResponse.json({ success: false, error: "Invalid request body.", details: e.message }, { status: 400 });
    }

    const {
      brandId,
      referenceImageAnalysisId,
      calendarId,
      calendarPostId,
      carouselSlideNumber,
      sourceFlow = "create_image_brand_reference_mode",
      outputImageTextRequirements = "",
      referenceImageAttractionNotes = "",
      rawIdeaOrPostInformation = "",
    } = body;

    if (!brandId) {
      return NextResponse.json({ success: false, error: "brandId is required." }, { status: 400 });
    }
    if (!referenceImageAnalysisId) {
      return NextResponse.json({ success: false, error: "Please upload and analyze a reference image first." }, { status: 400 });
    }

    // ── Load data ─────────────────────────────────────────────────────────────
    const [brand, brandIdentity, referenceAnalysis] = await Promise.all([
      prisma.brand.findUnique({ where: { id: brandId } }),
      prisma.brandIdentity.findFirst({ where: { brandId }, orderBy: { createdAt: "desc" } }),
      prisma.referenceImageAnalysis.findUnique({ where: { id: referenceImageAnalysisId } }),
    ]);

    if (!brand) {
      return NextResponse.json({ success: false, error: "Brand not found." }, { status: 404 });
    }
    if (!brandIdentity) {
      return NextResponse.json({
        success: false,
        error: "Please create or approve brand identity before using this flow.",
      }, { status: 400 });
    }
    if (!referenceAnalysis) {
      return NextResponse.json({ success: false, error: "Reference image analysis not found." }, { status: 404 });
    }

    // ── Resolve JSON sources ──────────────────────────────────────────────────
    // Image generation must only ever see the brand's VISUAL identity — never
    // the full identity record or its tone/business data.
    const { brandVisualIdentity } = normalizeBrandIdentityOutput(brandIdentity);
    const brandIdentityText = createCompactBrandVisualIdentitySummaryForImagePrompt(brandVisualIdentity);
    const referenceImageText = (() => {
      if (referenceAnalysis.editedJson) {
        try { return JSON.stringify(JSON.parse(referenceAnalysis.editedJson), null, 2); } catch {}
      }
      return referenceAnalysis.jsonOutput ?? "";
    })();

    // ── Build userInput block ─────────────────────────────────────────────────
    const userInput = [
      "=== BRAND VISUAL IDENTITY ===",
      brandIdentityText,
      "",
      "=== REFERENCE IMAGE ANALYSIS ===",
      referenceImageText,
      "",
      outputImageTextRequirements
        ? `=== OUTPUT IMAGE TEXT REQUIREMENTS ===\n${outputImageTextRequirements}`
        : null,
      referenceImageAttractionNotes
        ? `=== WHAT TO TAKE FROM THE REFERENCE IMAGE ===\n${referenceImageAttractionNotes}`
        : null,
      rawIdeaOrPostInformation
        ? `=== RAW IDEA OR POST INFORMATION ===\n${rawIdeaOrPostInformation}`
        : null,
      "",
      "=== REQUIRED OUTPUT FORMAT ===",
      "Return only valid JSON. No markdown. No code blocks. No explanations.",
      "Include all fields: summary, creativeDirection, brandAlignment, referenceImageInfluence, finalImageConcept, textDirection, composition, colorsAndLighting, productionReadyVisualPrompt, negativePrompt, notesForNanobananaPrompt.",
    ].filter(v => v !== null).join("\n");

    console.log("[CombinedVisualDir] userInput length:", userInput.length);

    // ── Call AI ───────────────────────────────────────────────────────────────
    let combinedJson;
    try {
      const result = await generateWithPromptTemplate({
        templateSlug: "image-reference-and-brand-identity-combiner",
        variables: {},
        userInput,
        responseFormat: "json_object",
        maxTokens: 3000,
      });

      console.log("[CombinedVisualDir] Raw AI output length:", result.raw?.length ?? 0);

      if (result.content && typeof result.content === "object") {
        combinedJson = result.content;
      } else {
        combinedJson = parseAiJson(result.raw);
      }
    } catch (aiErr) {
      console.error("[CombinedVisualDir] AI error:", aiErr.message);
      return NextResponse.json({
        success: false,
        error: "AI combination failed. Please try again.",
        details: aiErr.message,
      }, { status: 500 });
    }

    // ── Save to DB ────────────────────────────────────────────────────────────
    const saved = await prisma.combinedVisualDirection.create({
      data: {
        brandId,
        referenceImageAnalysisId,
        brandIdentityId: brandIdentity.id,
        calendarId:          calendarId          || null,
        calendarPostId:      calendarPostId      || null,
        carouselSlideNumber: carouselSlideNumber ?? null,
        sourceFlow,
        textRequirements:         outputImageTextRequirements    || null,
        attractionNotes:          referenceImageAttractionNotes  || null,
        rawIdeaOrPostInformation: rawIdeaOrPostInformation       || null,
        jsonOutput: JSON.stringify(combinedJson),
        status: "draft",
      },
    });

    console.log("[CombinedVisualDir] Saved id:", saved.id);

    return NextResponse.json({
      success: true,
      combinedVisualDirection: {
        id:                           saved.id,
        brandId:                      saved.brandId,
        referenceImageAnalysisId:     saved.referenceImageAnalysisId,
        calendarId:                   saved.calendarId,
        calendarPostId:               saved.calendarPostId,
        carouselSlideNumber:          saved.carouselSlideNumber,
        sourceFlow:                   saved.sourceFlow,
        outputImageTextRequirements:  saved.textRequirements,
        referenceImageAttractionNotes: saved.attractionNotes,
        rawIdeaOrPostInformation:     saved.rawIdeaOrPostInformation,
        combinedJson,
        editedJson:                   null,
        status:                       saved.status,
        finalNanobananaPrompt:        null,
        createdAt:                    saved.createdAt,
        updatedAt:                    saved.updatedAt,
      },
    });

  } catch (err) {
    console.error("[CombinedVisualDir] Unhandled error:", err);
    return NextResponse.json({
      success: false,
      error: "Failed to combine visual direction. Please try again.",
      details: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
