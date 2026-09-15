import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireResourceBrandAccess } from "@/lib/brand-access";
import { unlink } from "fs/promises";
import path from "path";

export async function DELETE(request, { params }) {
  const { fileId } = await params;

  // The route sits under /brands/[id] but keys off the file id, so authorize
  // against the file's own owning brand rather than the path segment.
  const access = await requireResourceBrandAccess("uploadedFile", fileId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const file = await prisma.uploadedFile.findUnique({ where: { id: fileId } });
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    await unlink(path.join(process.cwd(), "public", file.filePath));
  } catch {}

  await prisma.uploadedFile.delete({ where: { id: fileId } });
  return NextResponse.json({ success: true });
}
