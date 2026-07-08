import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { unlink } from "fs/promises";
import path from "path";

export async function DELETE(request, { params }) {
  const { fileId } = await params;

  const file = await prisma.uploadedFile.findUnique({ where: { id: fileId } });
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    await unlink(path.join(process.cwd(), "public", file.filePath));
  } catch {}

  await prisma.uploadedFile.delete({ where: { id: fileId } });
  return NextResponse.json({ success: true });
}
