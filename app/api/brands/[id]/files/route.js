import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { PURPOSE_SLUGS } from "@/lib/uploads";

export async function GET(request, { params }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const purpose = searchParams.get("purpose");

  const files = await prisma.uploadedFile.findMany({
    where: { brandId: id, ...(purpose ? { purpose } : {}) },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(files);
}

export async function POST(request, { params }) {
  const { id } = await params;

  const brand = await prisma.brand.findUnique({ where: { id } });
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  const formData = await request.formData();
  const file = formData.get("file");
  const rawPurpose = formData.get("purpose");
  const purpose = PURPOSE_SLUGS.includes(rawPurpose) ? rawPurpose : "reference-image";

  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File exceeds 10 MB limit" }, { status: 413 });
  }

  const uploadDir = path.join(process.cwd(), "public", "uploads", id, purpose);
  await mkdir(uploadDir, { recursive: true });

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileName = `${Date.now()}-${safeName}`;
  const absPath = path.join(uploadDir, fileName);

  const bytes = await file.arrayBuffer();
  await writeFile(absPath, Buffer.from(bytes));

  const filePath = `/uploads/${id}/${purpose}/${fileName}`;
  const uploaded = await prisma.uploadedFile.create({
    data: {
      brandId: id,
      fileName: file.name,
      filePath,
      fileType: file.type,
      purpose,
    },
  });

  return NextResponse.json(uploaded, { status: 201 });
}
