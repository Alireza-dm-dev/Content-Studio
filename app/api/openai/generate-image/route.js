import { NextResponse } from "next/server";
import OpenAI from "openai";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";

// gpt-image-1 is the current ChatGPT image model. It always returns b64_json
// (GPT image models do not support the url response_format).
const MODEL = "gpt-image-1";

// Standard sizes supported by GPT image models (from SDK types).
const VALID_SIZES = ["1024x1024", "1536x1024", "1024x1536"];

// Quality levels supported by GPT image models.
const VALID_QUALITIES = ["low", "medium", "high", "auto"];

// Friendly names for known platform presets, used to build the prompt
// instruction below. gpt-image-1 cannot output these exact Instagram pixel
// sizes, so presets only steer composition via a text instruction — the
// actual OpenAI `size` is still one of VALID_SIZES.
const PLATFORM_PRESET_LABELS = {
  square: "a Square post",
  "ig-post-4-5": "an Instagram Post (4:5)",
  "ig-post-3-4": "an Instagram Post (3:4)",
  "ig-reel": "an Instagram Reel",
  "ig-story": "an Instagram Story",
};

// Builds a short composition instruction appended to the prompt when the
// client selects a platform preset. Unrecognized preset keys still work
// (falls back to the raw key) so this never blocks generation.
function buildPresetInstruction({ platformPreset, targetWidth, targetHeight, aspectRatioLabel }) {
  if (!platformPreset) return null;
  const label = PLATFORM_PRESET_LABELS[platformPreset] ?? platformPreset;
  const dims = targetWidth && targetHeight ? `, target ${targetWidth}×${targetHeight}` : "";
  const ratio = aspectRatioLabel ? `, ${aspectRatioLabel} format` : "";
  return `Compose this image for ${label}${dims}${ratio}. Keep important subjects and text within safe margins.`;
}

// ── POST /api/openai/generate-image ──────────────────────────────────────────

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
    prompt,
    size = "1024x1024",
    quality = "auto",
    brandId,
    calendarPostId,
    generatedPromptId,
    platformPreset,
    targetWidth,
    targetHeight,
    aspectRatioLabel,
  } = body ?? {};

  // 1. Validate prompt
  if (typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json(
      { success: false, error: "prompt is required and must be a non-empty string." },
      { status: 400 }
    );
  }

  // 2. Validate size
  if (!VALID_SIZES.includes(size)) {
    return NextResponse.json(
      {
        success: false,
        error: `Invalid size "${size}". Supported sizes for ${MODEL}: ${VALID_SIZES.join(", ")}.`,
      },
      { status: 400 }
    );
  }

  // 3. Validate quality
  if (!VALID_QUALITIES.includes(quality)) {
    return NextResponse.json(
      {
        success: false,
        error: `Invalid quality "${quality}". Supported qualities for ${MODEL}: ${VALID_QUALITIES.join(", ")}.`,
      },
      { status: 400 }
    );
  }

  // 4. Resolve API key — Settings table first, env as fallback (mirrors lib/ai.js)
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

  const trimmedPrompt = prompt.trim();
  const presetInstruction = buildPresetInstruction({
    platformPreset,
    targetWidth,
    targetHeight,
    aspectRatioLabel,
  });
  const finalPrompt = presetInstruction
    ? `${trimmedPrompt}\n\n${presetInstruction}`
    : trimmedPrompt;
  const openai = new OpenAI({ apiKey });

  // 5. Call OpenAI image generation
  let imageData;
  try {
    const response = await openai.images.generate({
      model: MODEL,
      prompt: finalPrompt,
      n: 1,
      size,
      quality,
    });
    imageData = response.data?.[0];
    if (!imageData) throw new Error("OpenAI returned no image data.");
  } catch (err) {
    console.error("[openai/generate-image] OpenAI API error:", err);
    // Surface the HTTP status from the SDK error when available so the client
    // can distinguish a content-policy refusal (400) from a server fault (500).
    const httpStatus =
      typeof err?.status === "number" && err.status >= 400 ? err.status : 500;
    return NextResponse.json(
      { success: false, error: err?.message ?? "OpenAI image generation failed." },
      { status: httpStatus }
    );
  }

  // 6. Decode image bytes — gpt-image-1 always returns b64_json.
  //    The url fallback is kept for forward compatibility if the model/params change.
  let imageBuffer;
  if (imageData.b64_json) {
    imageBuffer = Buffer.from(imageData.b64_json, "base64");
  } else if (imageData.url) {
    try {
      const fetchRes = await fetch(imageData.url);
      if (!fetchRes.ok) throw new Error(`HTTP ${fetchRes.status}`);
      imageBuffer = Buffer.from(await fetchRes.arrayBuffer());
    } catch (err) {
      console.error("[openai/generate-image] Failed to download image URL:", err);
      return NextResponse.json(
        { success: false, error: `Failed to download generated image: ${err.message}` },
        { status: 500 }
      );
    }
  } else {
    return NextResponse.json(
      { success: false, error: "OpenAI returned neither b64_json nor url in the response." },
      { status: 500 }
    );
  }

  // 7. Save to public/uploads/images/
  const filename = `openai-${randomUUID()}.png`;
  const uploadsDir = path.join(process.cwd(), "public", "uploads", "images");
  // Root-relative path stored in DB and used directly as <img src>.
  const filePath = `/uploads/images/${filename}`;

  try {
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(path.join(uploadsDir, filename), imageBuffer);
  } catch (err) {
    console.error("[openai/generate-image] File write error:", err);
    return NextResponse.json(
      { success: false, error: `Failed to save generated image: ${err.message}` },
      { status: 500 }
    );
  }

  // 8. Create GeneratedMedia record.
  let generatedMedia;
  try {
    generatedMedia = await prisma.generatedMedia.create({
      data: {
        mediaType: "image",
        status: "completed",
        provider: "openai",
        filePath,
        remoteUrl: null,
        sourcePrompt: finalPrompt,
        tokenCost: null,
        errorMessage: null,
        ...(brandId ? { brandId } : {}),
        ...(calendarPostId ? { calendarPostId } : {}),
        ...(generatedPromptId ? { generatedPromptId } : {}),
      },
    });
  } catch (err) {
    console.error("[openai/generate-image] DB error:", err);
    return NextResponse.json(
      { success: false, error: `Failed to save media record: ${err.message}` },
      { status: 500 }
    );
  }

  // 9. Return
  return NextResponse.json({ success: true, generatedMedia, filePath });
}
