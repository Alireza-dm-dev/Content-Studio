import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser, getBrandCalendarAccess } from '@/lib/auth';
import { validateCalendarAttachmentFile, extractCalendarAttachmentText, MAX_ATTACHMENT_FILES } from '@/lib/calendar-attachment-utils';
import { interpretCalendarAttachment } from '@/lib/calendar-attachment-interpreter';
import { writeFile, mkdir, unlink } from 'fs/promises';
import crypto from 'crypto';
import path from 'path';

const STORAGE_ROOT = path.join(process.cwd(), '.data', 'calendar-attachments');

function purposeFor(calendarId, calendarPostId) {
  if (calendarPostId) return 'calendar_post_regeneration_reference';
  if (calendarId) return 'calendar_reference';
  return 'calendar_reference_creation';
}

function expiryFor(calendarId, calendarPostId) {
  if (calendarPostId) return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  if (calendarId) return null;
  return new Date(Date.now() + 24 * 60 * 60 * 1000);
}

function safeError(msg, status) {
  return NextResponse.json({ success: false, error: msg }, { status });
}

export async function POST(request, { params }) {
  const { id: routeBrandId } = await params;

  // ── 1. Authenticate ────────────────────────────────────────────────────────
  const user = await getCurrentUser();
  if (!user) return safeError('Authentication required', 401);

  // ── 2. Brand access ───────────────────────────────────────────────────────
  const access = await getBrandCalendarAccess(routeBrandId);
  if (!access.allowed) return safeError(access.error || 'Brand access required', access.status || 403);

  // ── 3. Parse multipart form data (after auth) ─────────────────────────────
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return safeError('Invalid multipart request', 400);
  }

  const fileEntry = formData.get('file');
  const rawCalendarId = formData.get('calendarId');
  const rawCalendarPostId = formData.get('calendarPostId');

  if (!fileEntry || typeof fileEntry === 'string') {
    return safeError('File is required', 400);
  }

  // Ensure at most one file
  const allFiles = formData.getAll('file') || [];
  if (allFiles.length > 1 || (allFiles.length === 1 && allFiles[0] !== fileEntry)) {
    return safeError('Only one file may be uploaded per request', 400);
  }

  const file = fileEntry;

  // Validate optional IDs
  let calendarId = null;
  let calendarPostId = null;

  if (rawCalendarId !== null && rawCalendarId !== undefined) {
    if (typeof rawCalendarId !== 'string' || !rawCalendarId.trim()) {
      return safeError('Invalid calendar ID', 400);
    }
    calendarId = rawCalendarId.trim();
  }

  if (rawCalendarPostId !== null && rawCalendarPostId !== undefined) {
    if (typeof rawCalendarPostId !== 'string' || !rawCalendarPostId.trim()) {
      return safeError('Invalid calendar post ID', 400);
    }
    calendarPostId = rawCalendarPostId.trim();
  }

  // ── 4. Stored hierarchy validation ────────────────────────────────────────
  function isEditor() {
    return !access.isAdmin;
  }

  // Case C: calendarPostId supplied
  if (calendarPostId) {
    const post = await prisma.calendarPost.findUnique({
      where: { id: calendarPostId },
      select: {
        calendarId: true,
        calendar: { select: { brandId: true, status: true } },
      },
    });

    if (!post || post.calendar.brandId !== routeBrandId) {
      return safeError('Calendar post not found', 404);
    }

    if (calendarId && calendarId !== post.calendarId) {
      return safeError('Calendar post not found', 404);
    }

    calendarId = post.calendarId;

    if (isEditor() && post.calendar.status !== 'draft') {
      return safeError('Attachments can only be added to draft calendars', 403);
    }
  }
  // Case B: calendarId supplied without calendarPostId
  else if (calendarId) {
    const calendar = await prisma.contentCalendar.findUnique({
      where: { id: calendarId },
      select: { brandId: true, status: true },
    });

    if (!calendar || calendar.brandId !== routeBrandId) {
      return safeError('Calendar not found', 404);
    }

    if (isEditor() && calendar.status !== 'draft') {
      return safeError('Attachments can only be added to draft calendars', 403);
    }
  }
  // Case A: no calendar, no post — temporary attachment, no calendar query needed

  // ── 5. Read file buffer (after all auth checks) ───────────────────────────
  let buffer;
  try {
    const bytes = await file.arrayBuffer();
    buffer = Buffer.from(bytes);
  } catch {
    return safeError('Invalid multipart request', 400);
  }

  const rawFileName = typeof file.name === 'string' ? file.name : '';
  const rawMimeType = typeof file.type === 'string' ? file.type : '';

  // ── 6. Validate file metadata ─────────────────────────────────────────────
  const validation = validateCalendarAttachmentFile({
    fileName: rawFileName,
    mimeType: rawMimeType,
    sizeBytes: buffer.length,
  });

  if (!validation.ok) {
    return safeError(validation.error, 400);
  }

  // ── 7. Extract text ───────────────────────────────────────────────────────
  const extraction = await extractCalendarAttachmentText({
    buffer,
    fileName: rawFileName,
    mimeType: rawMimeType,
    sizeBytes: buffer.length,
  });

  if (!extraction.ok) {
    return safeError(extraction.error, 400);
  }

  // ── 8. AI interpretation ──────────────────────────────────────────────────
  const interpretation = await interpretCalendarAttachment({
    fileName: extraction.fileName,
    mimeType: extraction.mimeType,
    extractedText: extraction.extractedText,
    extractionStatus: extraction.extractionStatus,
    wasTruncated: extraction.wasTruncated,
  });

  if (!interpretation.ok) {
    return safeError('The uploaded document could not be interpreted', 502);
  }

  // ── 9. Write private file ─────────────────────────────────────────────────
  const ext = validation.extension;
  const storageName = crypto.randomUUID() + ext;
  const relativeKey = `calendar-attachments/${routeBrandId}/${storageName}`;
  const absDir = path.join(STORAGE_ROOT, routeBrandId);
  const absPath = path.join(absDir, storageName);

  try {
    await mkdir(absDir, { recursive: true });
    await writeFile(absPath, buffer);
  } catch {
    return safeError('Failed to save attachment', 500);
  }

  // ── 10. Create UploadedFile record ────────────────────────────────────────
  const recordData = {
    brandId: routeBrandId,
    calendarId,
    calendarPostId,
    fileName: validation.fileName,
    filePath: relativeKey,
    fileType: validation.mimeType,
    purpose: purposeFor(calendarId, calendarPostId),
    sizeBytes: validation.sizeBytes,
    extractedText: extraction.extractedText,
    extractionStatus: extraction.extractionStatus,
    extractionError: null,
    wasTruncated: extraction.wasTruncated,
    interpretationJson: interpretation.interpretationJson,
    interpretationStatus: 'complete',
    interpretationError: null,
    interpretationModel: interpretation.interpretationModel || null,
    interpretedAt: interpretation.interpretedAt || null,
    createdById: user.id,
    expiresAt: expiryFor(calendarId, calendarPostId),
  };

  let record;
  try {
    record = await prisma.uploadedFile.create({ data: recordData });
  } catch (err) {
    await unlink(absPath).catch(() => {});
    return safeError('Failed to save attachment', 500);
  }

  // ── 11. Return safe response ──────────────────────────────────────────────
  const ij = interpretation.interpretationJson;

  return NextResponse.json(
    {
      success: true,
      attachment: {
        id: record.id,
        name: record.fileName,
        mimeType: record.fileType,
        sizeBytes: record.sizeBytes,
        extractionStatus: record.extractionStatus,
        interpretationStatus: record.interpretationStatus,
        wasTruncated: record.wasTruncated,
        documentType: ij.documentType || null,
        summary: ij.summary || null,
        expiresAt: record.expiresAt,
      },
    },
    { status: 201 },
  );
}

export async function GET(request, { params }) {
  const { id: routeBrandId } = await params;

  // ── 1. Authenticate ────────────────────────────────────────────────────────
  const user = await getCurrentUser();
  if (!user) return safeError('Authentication required', 401);

  // ── 2. Brand access ───────────────────────────────────────────────────────
  const access = await getBrandCalendarAccess(routeBrandId);
  if (!access.allowed) return safeError(access.error || 'Brand access required', access.status || 403);

  // ── 3. Parse query parameters ─────────────────────────────────────────────
  const { searchParams } = new URL(request.url);
  const calendarId = searchParams.get('calendarId');
  const calendarPostId = searchParams.get('calendarPostId');

  if (!calendarId || !calendarPostId) {
    return NextResponse.json(
      { success: false, error: 'calendarId and calendarPostId are required' },
      { status: 400 }
    );
  }

  // ── 4. Validate CalendarPost hierarchy ────────────────────────────────────
  const post = await prisma.calendarPost.findUnique({
    where: { id: calendarPostId },
    select: {
      calendarId: true,
      calendar: { select: { brandId: true } },
    },
  });

  if (!post || post.calendar.brandId !== routeBrandId || post.calendarId !== calendarId) {
    return NextResponse.json(
      { success: false, error: 'Calendar post not found' },
      { status: 404 }
    );
  }

  // ── 5. Query usable post-specific attachments ─────────────────────────────
  const records = await prisma.uploadedFile.findMany({
    where: {
      brandId: routeBrandId,
      calendarId,
      calendarPostId,
      purpose: 'calendar_post_regeneration_reference',
      interpretationStatus: 'complete',
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    orderBy: [
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
    take: MAX_ATTACHMENT_FILES,
    select: {
      id: true,
      fileName: true,
      fileType: true,
      sizeBytes: true,
      extractionStatus: true,
      interpretationStatus: true,
      wasTruncated: true,
      interpretationJson: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  // ── 6. Shape safe response ────────────────────────────────────────────────
  const attachments = records.map(r => {
    const ij = r.interpretationJson || {};
    return {
      id: r.id,
      name: r.fileName,
      mimeType: r.fileType,
      sizeBytes: r.sizeBytes,
      extractionStatus: r.extractionStatus,
      interpretationStatus: r.interpretationStatus,
      wasTruncated: r.wasTruncated,
      documentType: (ij.documentType && typeof ij.documentType === 'string') ? ij.documentType : null,
      summary: (ij.summary && typeof ij.summary === 'string') ? ij.summary : null,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
    };
  });

  return NextResponse.json({ success: true, attachments });
}
