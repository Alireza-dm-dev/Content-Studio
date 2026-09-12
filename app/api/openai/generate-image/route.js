import { NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import { writeFile, mkdir, readFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

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

// Safely normalizes a final-step reference image location into an absolute
// path under public/uploads/temp-images. Throws on anything unsafe.
//
// Accepts:
//   /uploads/temp-images/filename.png
//   http://localhost:3001/uploads/temp-images/filename.png
//   https://origin/uploads/temp-images/filename.png
// Rejects:
//   empty / non-string values
//   file:// and any non-http(s) scheme
//   external URLs whose pathname is not /uploads/temp-images/...
//   ../ traversal and any path resolving outside the temp-images dir
function normalizeReferenceImageUrl(raw, cwd) {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("empty referenceImageUrl");
  }

  const trimmed = raw.trim();
  let pathname;

  if (/^https?:\/\//i.test(trimmed)) {
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error("invalid reference URL");
    }
    pathname = parsed.pathname;
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    // file:// or any other scheme — disallowed (no remote fetching either)
    throw new Error("unsupported scheme");
  } else {
    // Treat as a path; drop any query/hash.
    pathname = trimmed.split("#")[0].split("?")[0];
  }

  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // Keep raw if it cannot be decoded.
  }

  if (!pathname.startsWith("/uploads/temp-images/")) {
    throw new Error("reference path not under /uploads/temp-images/");
  }

  // Strip leading slash so it joins under public/ instead of filesystem root.
  const rel = pathname.replace(/^\/+/, "");
  const abs = path.resolve(cwd, "public", rel);

  const allowedBase = path.resolve(cwd, "public", "uploads", "temp-images");
  if (abs !== allowedBase && !abs.startsWith(allowedBase + path.sep)) {
    throw new Error("path traversal detected");
  }

  return { absPath: abs, publicPath: pathname };
}

// ── POST /api/openai/generate-image ──────────────────────────────────────────

export async function POST(request) {

  // Not brand-scoped; requires a session only. Any brand data used by the
  // calling flow is authorized by that flow's own brand-scoped route.
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
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
    referenceImageUrl,
    referenceImageDescription,
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

  // 5. Optional final-step reference image mode.
  //    When a reference image is supplied we use the OpenAI image-edit API
  //    (images.edit) so the uploaded asset is sent as an actual image input
  //    rather than just being described in text. Without a reference image we
  //    keep the existing text-to-image generate behavior unchanged.
  const hasReferenceImage =
    typeof referenceImageUrl === "string" && referenceImageUrl.trim().length > 0;

  console.log("[OpenAIImage] reference image mode", {
    hasReferenceImage: Boolean(hasReferenceImage),
    referenceImageUrl,
    hasDescription: Boolean(referenceImageDescription),
  });

  let referenceBuffer = null;
  let referenceMime = "image/png";
  let referenceFilename = "reference.png";
  let finalPromptOverride = finalPrompt;

  if (hasReferenceImage) {
    console.log("[OpenAIImage] received referenceImageUrl", referenceImageUrl);

    // 5a. Normalize + safely resolve the uploaded file path.
    let normalized;
    try {
      normalized = normalizeReferenceImageUrl(referenceImageUrl, process.cwd());
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid reference image path. Please upload the image again.",
        },
        { status: 400 }
      );
    }
    const referenceAbs = normalized.absPath;

    const ext = path.extname(referenceAbs).toLowerCase();
    referenceMime =
      ext === ".png"
        ? "image/png"
        : ext === ".webp"
        ? "image/webp"
        : "image/jpeg";
    referenceFilename = `reference${ext || ".png"}`;

    // 5b. Confirm the file exists and is readable.
    try {
      referenceBuffer = await readFile(referenceAbs);
    } catch (err) {
      console.error("[openai/generate-image] reference file read error:", err);
      const status = err?.code === "ENOENT" ? 400 : 500;
      return NextResponse.json(
        {
          success: false,
          error:
            status === 400
              ? "Uploaded reference image could not be found. Please upload it again."
              : `Reference image file is unreadable: ${err.message}`,
        },
        { status }
      );
    }

    // 5c. Build an enhanced prompt that treats the upload as a source asset
    //     and explicitly preserves its identity.
    const instruction = (referenceImageDescription || "").trim();
    const preservation = instruction
      ? `Use the uploaded reference image as a source asset according to this instruction:\n${instruction}\n\nIf the instruction asks to place a logo/product/image into the final image, preserve the uploaded image as closely as possible. Do not redesign it. Do not change its colors, shape, text, proportions, or core visual identity. Place it naturally in the requested position.`
      : `Use the uploaded reference image as a visual source asset. Incorporate it into the composition as faithfully as possible, preserving its colors, shape, text, proportions, and core visual identity.`;
    finalPromptOverride = `${preservation}\n\nOriginal image prompt:\n${finalPrompt}`;
  }
  const effectivePrompt = hasReferenceImage ? finalPromptOverride : finalPrompt;

  // 6. Call OpenAI image generation (or edit when a reference image is supplied).
  let imageData;
  try {
    if (hasReferenceImage) {
      const imageFile = await toFile(referenceBuffer, referenceFilename, {
        type: referenceMime,
      });
      const response = await openai.images.edit({
        model: MODEL,
        image: imageFile,
        prompt: effectivePrompt,
        n: 1,
        size,
        quality,
      });
      imageData = response.data?.[0];
    } else {
      const response = await openai.images.generate({
        model: MODEL,
        prompt: effectivePrompt,
        n: 1,
        size,
        quality,
      });
      imageData = response.data?.[0];
    }
    if (!imageData) throw new Error("OpenAI returned no image data.");
  } catch (err) {
    console.error("[openai/generate-image] OpenAI API error:", err);
    // Reference-image failures must surface clearly — never silently fall
    // back to text-only generation.
    const errMessage = hasReferenceImage
      ? `Reference image generation failed: ${err?.message ?? "Unknown error."}`
      : err?.message ?? "OpenAI image generation failed.";
    const httpStatus =
      typeof err?.status === "number" && err.status >= 400 ? err.status : 500;
    return NextResponse.json(
      { success: false, error: errMessage },
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
