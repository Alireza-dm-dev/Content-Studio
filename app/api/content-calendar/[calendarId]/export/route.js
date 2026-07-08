import { prisma } from "@/lib/prisma";
import { buildExportRows, generateCsv, generateXlsx, generatePdf, safeFileName } from "@/lib/calendar-export";
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// GET /api/content-calendar/[calendarId]/export?format=csv
// GET /api/content-calendar/[calendarId]/export?format=xlsx
// GET /api/content-calendar/[calendarId]/export?format=pdf
export async function GET(request, { params }) {
  const { calendarId } = await params;
  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") ?? "csv";

  if (!["csv", "xlsx", "pdf"].includes(format)) {
    return NextResponse.json(
      { error: "Invalid format. Use csv, xlsx, or pdf." },
      { status: 400 }
    );
  }

  try {
    const includeClause = {
      posts: { orderBy: { postNumber: "asc" } },
    };
    if (format === "pdf") {
      includeClause.brand = {
        include: {
          uploadedFiles: {
            where: { purpose: "brand-logo" },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      };
    }

    const calendar = await prisma.contentCalendar.findUnique({
      where: { id: calendarId },
      include: includeClause,
    });

    if (!calendar) {
      return NextResponse.json(
        { error: "Content calendar not found." },
        { status: 404 }
      );
    }

    const rows     = buildExportRows(calendar.posts);
    const safeName = safeFileName(calendar.title, calendar.id);

    if (format === "csv") {
      const csv = generateCsv(rows);
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="content-calendar-${safeName}.csv"`,
        },
      });
    }

    if (format === "xlsx") {
      const buffer = await generateXlsx(rows, calendar);
      return new Response(buffer, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="content-calendar-${safeName}.xlsx"`,
        },
      });
    }

    // pdf
    let logoBuffer   = null;
    let logoMimeType = null;

    // Primary: brand-logo purpose file (fetched via include above)
    let logoFile = calendar.brand?.uploadedFiles?.[0] ?? null;

    // Fallback: newest brand-level image if no brand-logo record exists
    if (!logoFile && calendar.brandId) {
      logoFile = await prisma.uploadedFile.findFirst({
        where: {
          brandId: calendar.brandId,
          calendarPostId: null,
          fileType: { startsWith: "image/" },
        },
        orderBy: { createdAt: "desc" },
      });
    }

    if (logoFile?.filePath && logoFile?.fileType?.startsWith("image/")) {
      try {
        logoBuffer   = await readFile(join(process.cwd(), "public", logoFile.filePath));
        logoMimeType = logoFile.fileType;
      } catch {
        // Logo missing from disk — skip gracefully
      }
    }

    const pdfBuffer = await generatePdf(rows, calendar, logoBuffer, logoMimeType);
    return new Response(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="content-calendar-${safeName}.pdf"`,
      },
    });

  } catch (err) {
    console.error("[CalendarExport] Error:", err);
    return NextResponse.json(
      { error: "Export failed. Please try again." },
      { status: 500 }
    );
  }
}
