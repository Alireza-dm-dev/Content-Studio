import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { getAdminAccess } from "@/lib/auth";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(request) {
  const access = await getAdminAccess();
  if (!access.user) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("image");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: "No image file provided. Upload a JPG, PNG, or WEBP image." },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { success: false, error: `Unsupported file type "${file.type}". Allowed: JPG, PNG, WEBP.` },
        { status: 400 }
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { success: false, error: "File exceeds the 10 MB size limit." },
        { status: 400 }
      );
    }

    const ext = path.extname(file.name) || ".png";
    const baseName = (file.name || "image").replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]/g, "_");
    const safeName = `${randomUUID()}-${baseName}${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const uploadsDir = path.join(process.cwd(), "public", "uploads", "temp-images");
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(path.join(uploadsDir, safeName), buffer);

    return NextResponse.json({
      success: true,
      filePath: `/uploads/temp-images/${safeName}`,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
    });
  } catch (err) {
    console.error("[upload/temp-image] Error:", err);
    return NextResponse.json(
      { success: false, error: "Image upload failed. Please try again." },
      { status: 500 }
    );
  }
}
