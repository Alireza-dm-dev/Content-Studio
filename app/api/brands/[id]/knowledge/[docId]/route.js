import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireResourceBrandAccess } from "@/lib/brand-access";
import { BRAND_KNOWLEDGE_LIMITS as LIMITS } from "@/lib/brand-knowledge";
import { removeKnowledgeFile } from "@/lib/brand-knowledge-storage";

export const dynamic = "force-dynamic";

// Authorize against the document's own brand, then require it to match the path brand
// so a guessed id under another brand's URL is a plain 404.
async function authorize(routeBrandId, docId) {
  const access = await requireResourceBrandAccess("brandKnowledgeDocument", docId);
  if (!access.ok) return { response: NextResponse.json({ error: access.error }, { status: access.status }) };
  const doc = await prisma.brandKnowledgeDocument.findUnique({ where: { id: docId }, select: { id: true, brandId: true, storedPath: true } });
  if (!doc || doc.brandId !== routeBrandId) return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  return { doc };
}

export async function PATCH(request, { params }) {
  const { id, docId } = await params;
  const auth = await authorize(id, docId);
  if (auth.response) return auth.response;

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const data = {};
  if (typeof body?.displayName === "string") {
    const name = body.displayName.trim().slice(0, LIMITS.maxDisplayNameChars);
    if (!name) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    data.displayName = name;
  }
  if (typeof body?.description === "string") {
    data.description = body.description.trim().slice(0, LIMITS.maxDescriptionChars) || null;
  }
  if (!Object.keys(data).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const doc = await prisma.brandKnowledgeDocument.update({
    where: { id: docId },
    data,
    select: { id: true, displayName: true, description: true },
  });
  return NextResponse.json({ success: true, document: doc });
}

export async function DELETE(request, { params }) {
  const { id, docId } = await params;
  const auth = await authorize(id, docId);
  if (auth.response) return auth.response;

  // DB first: once the row is gone the document can no longer be retrieved.
  // The file unlink is best-effort (same policy as UploadedFile deletion).
  await prisma.brandKnowledgeDocument.delete({ where: { id: docId } });
  await removeKnowledgeFile(auth.doc.storedPath);
  return NextResponse.json({ success: true });
}
