import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildExportRows, generateXlsx, safeFileName, VALID_AUDIENCES } from "@/lib/calendar-export";

// POST /api/content-calendar/[calendarId]/export/google-drive
// Body: { format: "xlsx", audience: "creator" | "client" }
export async function POST(request, { params }) {
  const { calendarId } = await params;
  const body = await request.json().catch(() => ({}));
  const audienceRaw = body?.audience ?? "creator";
  const audience = VALID_AUDIENCES.includes(audienceRaw) ? audienceRaw : "creator";

  // ── Check Google Drive credentials are configured ──────────────────────────
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json({
      success: false,
      error: "Google Drive export is not configured yet. Please connect Google Drive in Settings.",
      details: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file, then implement the OAuth flow.",
    }, { status: 501 });
  }

  // ── Credentials exist — check for a stored access token ───────────────────
  let accessToken = null;
  try {
    const setting = await prisma.settings.findUnique({ where: { key: "GOOGLE_ACCESS_TOKEN" } });
    accessToken = setting?.value ?? null;
  } catch {
    // Settings table read failed — treat as not configured
  }

  if (!accessToken) {
    return NextResponse.json({
      success: false,
      error: "Google Drive is not connected. Please authorize the app in Settings to enable Google Drive uploads.",
      details: "No GOOGLE_ACCESS_TOKEN found in Settings. Complete the OAuth flow first.",
    }, { status: 401 });
  }

  // ── Load calendar and generate Excel file ─────────────────────────────────
  try {
    const calendar = await prisma.contentCalendar.findUnique({
      where: { id: calendarId },
      include: { posts: { orderBy: { postNumber: "asc" } } },
    });

    if (!calendar) {
      return NextResponse.json(
        { success: false, error: "Content calendar not found." },
        { status: 404 }
      );
    }

    const rows     = buildExportRows(calendar.posts, audience);
    const safeName = safeFileName(calendar.title, calendar.id);
    const fileName = `content-calendar-${safeName}.xlsx`;
    const buffer   = await generateXlsx(rows, calendar, audience);

    // ── Upload to Google Drive via REST API ─────────────────────────────────
    const metadata = JSON.stringify({
      name: fileName,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    // Multipart upload — metadata + file body
    const boundary = "cc_export_boundary";
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metaPart = `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${metadata}`;
    const filePart = `${delimiter}Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`;
    const metaBytes  = new TextEncoder().encode(metaPart);
    const fileHeader = new TextEncoder().encode(filePart);
    const closeBytes = new TextEncoder().encode(closeDelimiter);

    const body = new Uint8Array(
      metaBytes.length + fileHeader.length + buffer.length + closeBytes.length
    );
    let offset = 0;
    body.set(metaBytes,  offset); offset += metaBytes.length;
    body.set(fileHeader, offset); offset += fileHeader.length;
    body.set(buffer,     offset); offset += buffer.length;
    body.set(closeBytes, offset);

    const uploadRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
          "Content-Length": String(body.length),
        },
        body,
      }
    );

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error("[GoogleDriveExport] Upload error:", errText);

      // Token likely expired
      if (uploadRes.status === 401) {
        return NextResponse.json({
          success: false,
          error: "Google Drive session expired. Please reconnect Google Drive in Settings.",
          details: errText,
        }, { status: 401 });
      }

      return NextResponse.json({
        success: false,
        error: "Google Drive upload failed. Please try again.",
        details: errText,
      }, { status: 500 });
    }

    const driveFile = await uploadRes.json();
    console.log("[GoogleDriveExport] Uploaded:", driveFile.id, fileName);

    return NextResponse.json({
      success: true,
      fileName,
      driveFileId:  driveFile.id,
      driveFileUrl: driveFile.webViewLink ?? null,
    });

  } catch (err) {
    console.error("[GoogleDriveExport] Unhandled error:", err);
    return NextResponse.json({
      success: false,
      error: "Google Drive upload failed. Please try again.",
      details: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
