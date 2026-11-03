import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBrandAccess } from "@/lib/brand-access";
import { extractCalendarAttachmentText, validateCalendarAttachmentFile } from "@/lib/calendar-attachment-utils";
import { BRAND_KNOWLEDGE_LIMITS as LIMITS } from "@/lib/brand-knowledge";
import { saveKnowledgeFile, removeKnowledgeFile } from "@/lib/brand-knowledge-storage";

export const dynamic = "force-dynamic";

const PUBLIC_SELECT = {
  id: true,
  displayName: true,
  description: true,
  originalFileName: true,
  mimeType: true,
  fileSize: true,
  status: true,
  extractionError: true,
  wasTruncated: true,
  createdAt: true,
  uploadedBy: { select: { name: true } },
};

function err(message, status, code) {
  return NextResponse.json({ success: false, error: message, code }, { status });
}

function serializeKnowledgeDocument(doc) {
  const { uploadedBy, ...rest } = doc;
  return { ...rest, uploadedByName: uploadedBy?.name ?? null };
}

export async function GET(request, { params }) {
  const { id } = await params;
  const access = await requireBrandAccess(id);
  if (!access.ok) return err(access.error, access.status);

  // extractedText and storedPath are intentionally never returned.
  const docs = await prisma.brandKnowledgeDocument.findMany({
    where: { brandId: id },
    select: PUBLIC_SELECT,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ success: true, documents: docs.map(serializeKnowledgeDocument), limits: { maxFileBytes: LIMITS.maxFileBytes, maxDocuments: LIMITS.maxDocumentsPerBrand } });
}

export async function POST(request, { params }) {
  const { id: brandId } = await params;
  const access = await requireBrandAccess(brandId);
  if (!access.ok) return err(access.error, access.status);

  const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { id: true } });
  if (!brand) return err("Brand not found", 404);

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > LIMITS.maxFileBytes + 1024 * 1024) {
    return err(`File exceeds the ${LIMITS.maxFileBytes / (1024 * 1024)} MB limit`, 413, "FILE_TOO_LARGE");
  }

  let formData;
  try { formData = await request.formData(); } catch { return err("Invalid multipart request", 400); }

  const file = formData.get("file");
  if (!file || typeof file === "string") return err("File is required", 400);
  if ((formData.getAll("file") || []).length > 1) return err("Only one file may be uploaded per request", 400);

  const descriptionRaw = formData.get("description");
  const description = typeof descriptionRaw === "string" && descriptionRaw.trim()
    ? descriptionRaw.trim().slice(0, LIMITS.maxDescriptionChars) : null;
  const displayNameRaw = formData.get("displayName");

  if (file.size > LIMITS.maxFileBytes) return err(`File exceeds the ${LIMITS.maxFileBytes / (1024 * 1024)} MB limit`, 400, "FILE_TOO_LARGE");

  const existing = await prisma.brandKnowledgeDocument.count({ where: { brandId } });
  if (existing >= LIMITS.maxDocumentsPerBrand) {
    return err(`This brand already has ${LIMITS.maxDocumentsPerBrand} documents. Delete one to add another.`, 409, "DOCUMENT_LIMIT");
  }

  let buffer;
  try { buffer = Buffer.from(await file.arrayBuffer()); } catch { return err("Invalid multipart request", 400); }

  const fileName = typeof file.name === "string" ? file.name : "";
  const mimeType = typeof file.type === "string" ? file.type : "";
  const validation = validateCalendarAttachmentFile({ fileName, mimeType, sizeBytes: buffer.length, maxSizeBytes: LIMITS.maxFileBytes });
  if (!validation.ok) return err(validation.error, 400, validation.code);

  let storedPath;
  try { storedPath = await saveKnowledgeFile(brandId, validation.extension, buffer); }
  catch { return err("Failed to save document", 500); }

  const displayName = (typeof displayNameRaw === "string" && displayNameRaw.trim()
    ? displayNameRaw.trim() : validation.fileName).slice(0, LIMITS.maxDisplayNameChars);

  let doc;
  try {
    doc = await prisma.brandKnowledgeDocument.create({
      data: {
        brandId,
        uploadedByUserId: access.user.id,
        displayName,
        description,
        originalFileName: validation.fileName,
        storedPath,
        mimeType: validation.mimeType,
        fileSize: buffer.length,
        status: "PROCESSING",
      },
      select: { id: true },
    });
  } catch {
    await removeKnowledgeFile(storedPath);
    return err("Failed to save document", 500);
  }

  // Synchronous extraction (V1). A failure is recorded as FAILED, never as an empty READY document.
  let update;
  try {
    const extraction = await extractCalendarAttachmentText({
      buffer, fileName, mimeType, sizeBytes: buffer.length,
      maxSizeBytes: LIMITS.maxFileBytes, maxChars: LIMITS.maxStoredChars,
    });
    update = extraction.ok && extraction.extractedText?.trim()
      ? { status: "READY", extractedText: extraction.extractedText, extractionError: null, wasTruncated: !!extraction.wasTruncated }
      : { status: "FAILED", extractedText: null, extractionError: extraction.error || "No readable text could be extracted from this file." };
  } catch {
    update = { status: "FAILED", extractedText: null, extractionError: "Could not extract text from this file." };
  }

  const saved = await prisma.brandKnowledgeDocument.update({ where: { id: doc.id }, data: update, select: PUBLIC_SELECT });
  return NextResponse.json({ success: true, document: serializeKnowledgeDocument(saved) }, { status: 201 });
}
