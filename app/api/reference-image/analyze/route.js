import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { requireBrandAccess, requireResourceBrandAccess } from "@/lib/brand-access";
import { generateWithPromptTemplate } from "@/lib/ai";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// ── JSON parsing helper ────────────────────────────────────────────────────────

function parseAiJson(raw) {
  if (!raw?.trim()) throw new Error("AI returned empty output.");
  let text = raw.trim();

  try { return JSON.parse(text); } catch {}

  text = text.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/im, "").trim();
  try { return JSON.parse(text); } catch {}

  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s !== -1 && e > s) { try { return JSON.parse(text.slice(s, e + 1)); } catch {} }

  throw new Error("Could not parse AI response as JSON.");
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(request) {
  console.log("[RefImageAnalyze] POST /api/reference-image/analyze");

  try {
    let formData;
    try {
      formData = await request.formData();
    } catch (e) {
      return NextResponse.json({ success: false, error: "Invalid form data.", details: e.message }, { status: 400 });
    }

    const imageFile = formData.get("image");
    const sourceFlow = formData.get("sourceFlow") || "create_image_reference_mode";
    const brandId    = formData.get("brandId")    || null;
    const calendarId = formData.get("calendarId") || null;
    const calendarPostId = formData.get("calendarPostId") || null;

    // Both identifiers are client-supplied; neither may point outside the
    // user's brands. Requests with no brand attach to nothing brand-owned.
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 },
      );
    }
    if (brandId) {
      const access = await requireBrandAccess(brandId, { user });
      if (!access.ok) {
        return NextResponse.json(
          { success: false, error: access.error },
          { status: access.status },
        );
      }
    }
    if (calendarId) {
      const access = await requireResourceBrandAccess("calendar", calendarId, { user });
      if (!access.ok) {
        return NextResponse.json(
          { success: false, error: access.error },
          { status: access.status },
        );
      }
    }
    const focusInstruction = formData.get("focusInstruction") || "";

    // ── Validate ──────────────────────────────────────────────────────────────
    if (!imageFile || typeof imageFile === "string") {
      return NextResponse.json({ success: false, error: "Image file is required." }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(imageFile.type)) {
      return NextResponse.json({
        success: false,
        error: "Please upload a JPG, PNG, or WEBP image under 10MB.",
      }, { status: 400 });
    }

    const bytes  = await imageFile.arrayBuffer();
    const buffer = Buffer.from(bytes);

    if (buffer.length > MAX_BYTES) {
      return NextResponse.json({
        success: false,
        error: "Please upload a JPG, PNG, or WEBP image under 10MB.",
      }, { status: 413 });
    }

    console.log(`[RefImageAnalyze] File: ${imageFile.name} | type: ${imageFile.type} | size: ${buffer.length}B | flow: ${sourceFlow}`);

    // ── Save file ─────────────────────────────────────────────────────────────
    const ext = imageFile.type === "image/jpeg" ? "jpg" :
                imageFile.type === "image/png"  ? "png" : "webp";
    const fileName = `ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const uploadDir = path.join(process.cwd(), "public", "uploads", "reference-images");

    await mkdir(uploadDir, { recursive: true });
    await writeFile(path.join(uploadDir, fileName), buffer);

    const imageUrl = `/uploads/reference-images/${fileName}`;

    // ── Create UploadedFile record ────────────────────────────────────────────
    const uploadedFile = await prisma.uploadedFile.create({
      data: {
        brandId: brandId || null,
        fileName: imageFile.name || fileName,
        filePath: imageUrl,
        fileType: imageFile.type,
        purpose: "reference-image",
      },
    });

    // ── Call AI ───────────────────────────────────────────────────────────────
    console.log(`[RefImageAnalyze] Calling reference-image-information-extractor...`);

    let analysisJson;
    try {
      const compositionExtractionGuidance = [
        "COMPOSITION AND SPATIAL EXTRACTION (always include):",
        "In addition to visual style, you MUST extract detailed spatial and compositional information from this image:",
        "- List every distinct object/element visible and describe its position (e.g. top-left, center, bottom-right, spanning full width).",
        "- Describe relative sizes of objects compared to each other and to the full frame.",
        "- Note orientation, rotation, tilt, or viewing angle of each key object.",
        "- Describe foreground vs. background layering and any overlap or stacking.",
        "- Identify the focal object and how visual hierarchy is established.",
        "- Describe negative/empty space and where it sits in the frame.",
        "- Name the composition type (centered, rule-of-thirds, diagonal, symmetrical, asymmetrical, etc.).",
        "- Describe spacing and alignment patterns between elements.",
        "Store this under a top-level key called \"compositionMap\" in your JSON output.",
      ].join("\n");

      const userInput = focusInstruction.trim()
        ? [
            "USER FOCUS INSTRUCTION:",
            "The user wants you to prioritize the following aspects when extracting reusable reference guidance from this image:",
            focusInstruction.trim(),
            "",
            "Give extra detail and emphasis to these areas in your extraction output. Other aspects should still be extracted normally.",
            "",
            compositionExtractionGuidance,
          ].join("\n")
        : compositionExtractionGuidance;

      const result = await generateWithPromptTemplate({
        templateSlug: "reference-image-information-extractor",
        variables: {},
        images: [{ filePath: imageUrl, mediaType: imageFile.type }],
        responseFormat: "json_object",
        maxTokens: 2048,
        ...(userInput ? { userInput } : {}),
      });

      console.log(`[RefImageAnalyze] AI raw output length: ${result.raw?.length ?? 0} chars`);

      if (result.content && typeof result.content === "object") {
        analysisJson = result.content;
      } else {
        analysisJson = parseAiJson(result.raw);
      }
    } catch (aiErr) {
      console.error("[RefImageAnalyze] AI error:", aiErr.message);
      return NextResponse.json({
        success: false,
        error: "Image analysis failed. Please try again.",
        details: aiErr.message,
      }, { status: 500 });
    }

    // ── Save to DB ────────────────────────────────────────────────────────────
    const analysis = await prisma.referenceImageAnalysis.create({
      data: {
        brandId:       brandId  || null,
        calendarId:    calendarId || null,
        calendarPostId: calendarPostId || null,
        uploadedFileId: uploadedFile.id,
        sourceFlow,
        jsonOutput: JSON.stringify(analysisJson),
        status: "draft",
      },
    });

    console.log(`[RefImageAnalyze] Saved analysis id=${analysis.id}`);

    return NextResponse.json({
      success: true,
      referenceImageAnalysis: {
        id:            analysis.id,
        brandId:       analysis.brandId,
        calendarId:    analysis.calendarId,
        calendarPostId: analysis.calendarPostId,
        sourceFlow:    analysis.sourceFlow,
        imageUrl,
        imageFileName: imageFile.name || fileName,
        imageMimeType: imageFile.type,
        imageSizeBytes: buffer.length,
        analysisJson,
        editedJson:    null,
        status:        analysis.status,
        createdAt:     analysis.createdAt,
        updatedAt:     analysis.updatedAt,
      },
    });

  } catch (err) {
    console.error("[RefImageAnalyze] Unhandled error:", err);
    return NextResponse.json({
      success: false,
      error: "Reference image analysis failed. Please try again.",
      details: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
