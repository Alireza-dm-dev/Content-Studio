import { NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import { writeFile, mkdir, readFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";

// gpt-image-1 is the current ChatGPT image model. It always returns b64_json.
const MODEL = "gpt-image-1";

// Standard sizes supported by GPT image models (from SDK types).
const VALID_SIZES = ["1024x1024", "1536x1024", "1024x1536"];

// Quality levels supported by GPT image models.
const VALID_QUALITIES = ["low", "medium", "high", "auto"];

// Friendly names for known platform presets, used to build the instruction
// below. gpt-image-1 cannot output these exact Instagram pixel
// sizes, so presets only steer composition via a text instruction — the
// actual OpenAI `size` is still one of VALID_SIZES.
const PLATFORM_PRESET_LABELS = {
  square: "a Square post",
  "ig-post-4-5": "an Instagram Post (4:5)",
  "ig-post-3-4": "an Instagram Post (3:4)",
  "ig-reel": "an Instagram Reel",
  "ig-story": "an Instagram Story",
};

// Builds a short composition instruction appended to the edit instruction
// when the client selects a platform preset. Unrecognized preset keys still
// work (falls back to the raw key) so this never blocks the edit.
function buildPresetInstruction({ platformPreset, targetWidth, targetHeight, aspectRatioLabel }) {
  if (!platformPreset) return null;
  const label = PLATFORM_PRESET_LABELS[platformPreset] ?? platformPreset;
  const dims = targetWidth && targetHeight ? `, target ${targetWidth}×${targetHeight}` : "";
  const ratio = aspectRatioLabel ? `, ${aspectRatioLabel} format` : "";
  return `Compose this image for ${label}${dims}${ratio}. Keep important subjects and text within safe margins.`;
}

// ── POST /api/openai/edit-image ───────────────────────────────────────────────

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const {
    generatedMediaId,
    instruction,
    size = "1024x1024",
    quality = "auto",
    platformPreset,
    targetWidth,
    targetHeight,
    aspectRatioLabel,
  } = body ?? {};

  // 1. Validate generatedMediaId
  if (typeof generatedMediaId !== "string" || !generatedMediaId.trim()) {
    return NextResponse.json(
      { success: false, error: "generatedMediaId is required and must be a non-empty string." },
      { status: 400 }
    );
  }

  // 2. Validate instruction
  if (typeof instruction !== "string" || !instruction.trim()) {
    return NextResponse.json(
      { success: false, error: "instruction is required and must be a non-empty string." },
      { status: 400 }
    );
  }

  // 3. Validate size
  if (!VALID_SIZES.includes(size)) {
    return NextResponse.json(
      {
        success: false,
        error: `Invalid size "${size}". Supported sizes for ${MODEL}: ${VALID_SIZES.join(", ")}.`,
      },
      { status: 400 }
    );
  }

  // 4. Validate quality
  if (!VALID_QUALITIES.includes(quality)) {
    return NextResponse.json(
      {
        success: false,
        error: `Invalid quality "${quality}". Supported qualities for ${MODEL}: ${VALID_QUALITIES.join(", ")}.`,
      },
      { status: 400 }
    );
  }

  // 5. Resolve API key — Settings table first, env as fallback (mirrors generate-image route)
  let apiKey = process.env.OPENAI_API_KEY;
  try {
    const setting = await prisma.settings.findUnique({ where: { key: "OPENAI_API_KEY" } });
    if (setting?.value && !setting.value.startsWith("your_")) {
      apiKey = setting.value;
    }
  } catch {
    // Settings lookup failed; proceed with env key
  }
  if (!apiKey || apiKey.startsWith("your_")) {
    return NextResponse.json(
      {
        success: false,
        error:
          "OPENAI_API_KEY is not configured. Add it in Settings or .env and restart the server.",
      },
      { status: 500 }
    );
  }

  // 6. Look up source GeneratedMedia
  let sourceMedia;
  try {
    sourceMedia = await prisma.generatedMedia.findUnique({ where: { id: generatedMediaId } });
  } catch (err) {
    console.error("[openai/edit-image] DB lookup error:", err);
    return NextResponse.json(
      { success: false, error: `Failed to look up source media: ${err.message}` },
      { status: 500 }
    );
  }

  // 7. Validate source media
  if (!sourceMedia) {
    return NextResponse.json(
      { success: false, error: `No GeneratedMedia found with id "${generatedMediaId}".` },
      { status: 404 }
    );
  }
  if (sourceMedia.mediaType !== "image") {
    return NextResponse.json(
      { success: false, error: "Source media is not an image." },
      { status: 400 }
    );
  }
  if (!sourceMedia.filePath || !sourceMedia.filePath.startsWith("/uploads/")) {
    return NextResponse.json(
      { success: false, error: "Source media has no local file to edit." },
      { status: 400 }
    );
  }

  // 8. Convert root-relative filePath to an absolute path under public/.
  const absoluteSourcePath = path.join(process.cwd(), "public", sourceMedia.filePath);
  const sourceFilename = path.basename(sourceMedia.filePath);

  // 9. Read image bytes from disk.
  let sourceBuffer;
  try {
    sourceBuffer = await readFile(absoluteSourcePath);
  } catch (err) {
    console.error("[openai/edit-image] File read error:", err);
    const status = err?.code === "ENOENT" ? 404 : 500;
    return NextResponse.json(
      { success: false, error: `Failed to read source image file: ${err.message}` },
      { status }
    );
  }

  const trimmedInstruction = instruction.trim();
  const presetInstruction = buildPresetInstruction({
    platformPreset,
    targetWidth,
    targetHeight,
    aspectRatioLabel,
  });
  const finalInstruction = presetInstruction
    ? `${trimmedInstruction}\n\n${presetInstruction}`
    : trimmedInstruction;
  const openai = new OpenAI({ apiKey });

  // 10-11. Wrap the buffer and call OpenAI image edit.
  let imageData;
  try {
    const image = await toFile(sourceBuffer, sourceFilename, { type: "image/png" });
    const response = await openai.images.edit({
      model: MODEL,
      image,
      prompt: finalInstruction,
      size,
      quality,
    });
    imageData = response.data?.[0];
    if (!imageData) throw new Error("OpenAI returned no image data.");
  } catch (err) {
    console.error("[openai/edit-image] OpenAI API error:", err);
    // Surface the HTTP status from the SDK error when available so the client
    // can distinguish a content-policy refusal (400) from a server fault (500).
    const httpStatus =
      typeof err?.status === "number" && err.status >= 400 ? err.status : 500;
    return NextResponse.json(
      { success: false, error: err?.message ?? "OpenAI image edit failed." },
      { status: httpStatus }
    );
  }

  // 12. Decode image bytes — gpt-image-1 always returns b64_json.
  if (!imageData.b64_json) {
    return NextResponse.json(
      { success: false, error: "OpenAI returned no b64_json in the edit response." },
      { status: 500 }
    );
  }
  const imageBuffer = Buffer.from(imageData.b64_json, "base64");

  // 13. Save the edited image to public/uploads/images/ without touching the original.
  const filename = `openai-edit-${randomUUID()}.png`;
  const uploadsDir = path.join(process.cwd(), "public", "uploads", "images");
  const filePath = `/uploads/images/${filename}`;

  try {
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(path.join(uploadsDir, filename), imageBuffer);
  } catch (err) {
    console.error("[openai/edit-image] File write error:", err);
    return NextResponse.json(
      { success: false, error: `Failed to save edited image: ${err.message}` },
      { status: 500 }
    );
  }

  // 14. Create a new GeneratedMedia record for the edited result.
  let generatedMedia;
  try {
    generatedMedia = await prisma.generatedMedia.create({
      data: {
        mediaType: "image",
        status: "completed",
        provider: "openai",
        filePath,
        remoteUrl: null,
        sourcePrompt: `Edit instruction: ${finalInstruction}`,
        tokenCost: null,
        errorMessage: null,
        ...(sourceMedia.brandId ? { brandId: sourceMedia.brandId } : {}),
        ...(sourceMedia.calendarPostId ? { calendarPostId: sourceMedia.calendarPostId } : {}),
        ...(sourceMedia.generatedPromptId ? { generatedPromptId: sourceMedia.generatedPromptId } : {}),
      },
    });
  } catch (err) {
    console.error("[openai/edit-image] DB error:", err);
    return NextResponse.json(
      { success: false, error: `Failed to save media record: ${err.message}` },
      { status: 500 }
    );
  }

  // 15. Return
  return NextResponse.json({ success: true, generatedMedia, filePath });
}
