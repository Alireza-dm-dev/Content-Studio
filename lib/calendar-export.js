// Server-side only — imported by API routes, never by client components.
import { normalizePost, CALENDAR_TABLE_VIEWS } from "./calendar-post-utils.js";

// ── Audience mode constants ───────────────────────────────────────────────────
export const VALID_AUDIENCES = ["creator", "client"];

// ── Column definitions (order determines export column order) ─────────────────
export const EXPORT_COLUMNS = [
  { key: "postNumber",  label: "Post Number" },
  { key: "date",        label: "Date" },
  { key: "platform",    label: "Platform" },
  { key: "format",      label: "Format" },
  { key: "mainAngle",   label: "Main Angle" },
  { key: "coreMessage", label: "Core Message" },
  { key: "hookTitle",   label: "Hook / Title" },
  { key: "caption",     label: "Caption" },
  { key: "referenceLink", label: "Reference" },
  { key: "hashtags",    label: "Hashtags" },
  { key: "contentStructure", label: "Content Structure" },
  { key: "visualDirection",  label: "Visual Direction" },
  { key: "imageText",        label: "Image Text" },
  { key: "structure",        label: "Structure" },
  { key: "inspiration",      label: "Inspiration" },
  { key: "videoConceptTitleAndThumbnailTitleIdea", label: "Video Concept / Thumbnail Idea" },
  { key: "videoRawIdea",     label: "Video Raw Idea" },
  { key: "mainIntegratedScenario", label: "Main Integrated Scenario" },
  { key: "thumbnailIdeaForReel",   label: "Thumbnail Idea for Reel" },
  { key: "narrationOrDialogueOfCharacterOrCharacters", label: "Narration or Dialogue" },
  { key: "rawImageIdeaForFirstFrame", label: "Raw Image Idea for First Frame" },
  { key: "whatHappens",              label: "What Happens" },
  { key: "characterObjectOrEnvironmentAction", label: "Character / Object / Environment Action" },
  { key: "cameraMovement", label: "Camera movement" },
  { key: "speedRamp",      label: "Speed ramp" },
  { key: "camera",         label: "Camera" },
  { key: "lens",           label: "Lens" },
  { key: "focalLength",    label: "Focal length" },
  { key: "aperture",       label: "Aperture" },
  { key: "visualMood",     label: "Visual Mood" },
  { key: "textOnVideo",    label: "Text On Video" },
  { key: "status",         label: "Status" },
];

// ── Client audience: flat CSV column keys ─────────────────────────────────────
const CLIENT_COLUMN_KEYS = new Set([
  "postNumber", "date", "hookTitle", "format", "mainAngle", "coreMessage",
  "referenceLink", "hashtags", "caption", "contentStructure", "imageText",
  "narrationOrDialogueOfCharacterOrCharacters", "whatHappens",
]);

// ── Client audience: per-view column keys for XLSX/PDF ────────────────────────
const CLIENT_VIEW_FILTERS = {
  visual: new Set(["contentStructure", "imageText"]),
  video: new Set(["narrationOrDialogueOfCharacterOrCharacters", "whatHappens"]),
};

function _filterExportColumns(audience) {
  if (audience === "client") return EXPORT_COLUMNS.filter(c => CLIENT_COLUMN_KEYS.has(c.key));
  return EXPORT_COLUMNS;
}

function _filterViewColumns(view, audience) {
  if (audience !== "client") return view.columns;
  const allowed = CLIENT_VIEW_FILTERS[view.id];
  return allowed ? view.columns.filter(c => allowed.has(c.key)) : view.columns;
}

// Hashtags column is only worth showing when at least one exported row still
// carries a separate hashtags value — buildExportRows() already blanks it to
// "" for merged (new-format) posts, so an all-merged calendar naturally needs
// no Hashtags column at all, while legacy hashtag data stays visible. Applied
// AFTER rows are built (never inside buildExportRows itself, which still
// populates a "hashtags" value per row regardless — this only controls
// whether that column is rendered in the final CSV/XLSX/PDF output).
function _dropHashtagsColumnIfUnneeded(columns, rows) {
  const needed = (rows || []).some(r => r.hashtags);
  return needed ? columns : columns.filter(c => c.key !== "hashtags");
}

// Wide text columns — given more space in Excel
const WIDE_KEYS = new Set([
  "caption", "visualDirection", "imageText",
  "coreMessage", "narrationOrDialogueOfCharacterOrCharacters",
  "mainIntegratedScenario", "whatHappens", "hookTitle",
  "videoConceptTitleAndThumbnailTitleIdea",
]);

// ── Filename sanitizer ────────────────────────────────────────────────────────
export function safeFileName(title, id) {
  const base = (title || id || "calendar")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "calendar";
}

// ── Normalize a DB post and return a flat row object for export ───────────────
// Reads both DB scalar columns and the postData JSON blob via normalizePost().
export function buildExportRows(dbPosts, audience = "creator") {
  // Always populate every audience-eligible column per row (including
  // "hashtags", blanked for merged posts) — whether the Hashtags column is
  // rendered at all is decided later, once all rows are known.
  const columns = _filterExportColumns(audience);
  return dbPosts.map((post, idx) => {
    const norm = normalizePost(post, idx);
    const row = {};
    for (const { key } of columns) {
      // New-format posts already end their caption with the 5 hashtags — don't
      // duplicate them in the separate Hashtags export column.
      if (key === "hashtags" && norm.hashtagsMergedIntoCaption) {
        row[key] = "";
        continue;
      }
      let val = norm[key];
      if (Array.isArray(val)) {
        val = val.join(" ");
      } else if (val === null || val === undefined) {
        val = "";
      } else {
        val = String(val);
      }
      row[key] = val;
    }
    return row;
  });
}

// ── CSV ───────────────────────────────────────────────────────────────────────
function csvCell(value) {
  const str = String(value ?? "");
  if (str.includes('"') || str.includes(",") || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Returns a UTF-8 BOM-prefixed CSV string (BOM ensures Excel opens it correctly).
export function generateCsv(rows, audience = "creator") {
  const columns = _dropHashtagsColumnIfUnneeded(_filterExportColumns(audience), rows);
  const header = columns.map(c => csvCell(c.label)).join(",");
  const lines  = rows.map(row =>
    columns.map(c => csvCell(row[c.key] ?? "")).join(",")
  );
  return "﻿" + [header, ...lines].join("\r\n");
}

// ── Excel (xlsx) ──────────────────────────────────────────────────────────────
export async function generateXlsx(rows, calendarInfo, audience = "creator") {
  // Dynamic import keeps xlsx out of any client bundle
  const XLSX = await import("xlsx").then(m => m.default ?? m);

  const wb = XLSX.utils.book_new();

  // ── Sheets: one per tab view — columns filtered by audience ─────────────
  for (const view of CALENDAR_TABLE_VIEWS) {
    const cols = _dropHashtagsColumnIfUnneeded(_filterViewColumns(view, audience), rows);
    const headerRow = cols.map(c => c.label);
    const dataRows  = rows.map(row => cols.map(c => row[c.key] ?? ""));
    const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);

    ws["!cols"] = cols.map(({ key }) => ({ wch: WIDE_KEYS.has(key) ? 48 : 22 }));
    ws["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activeCell: "A2" };

    XLSX.utils.book_append_sheet(wb, ws, view.label);
  }

  // ── Sheet 5: Calendar Info ──────────────────────────────────────────────────
  if (calendarInfo) {
    const infoData = [
      ["Field",            "Value"],
      ["Title",            calendarInfo.title            || ""],
      ["Platform",         calendarInfo.platform         || ""],
      ["Time Period",      calendarInfo.timePeriod       || ""],
      ["Monthly Subject",  calendarInfo.mainMonthlySubject || ""],
      ["Main Goal",        calendarInfo.mainGoal         || ""],
      ["Offer / Message",  calendarInfo.mainOfferOrMessage || ""],
      ["Status",           calendarInfo.status           || ""],
      ["Total Posts",      String(rows.length)],
    ];
    const wsInfo = XLSX.utils.aoa_to_sheet(infoData);
    wsInfo["!cols"] = [{ wch: 22 }, { wch: 55 }];
    XLSX.utils.book_append_sheet(wb, wsInfo, "Calendar Info");
  }

  // Returns Buffer in Node.js, Uint8Array elsewhere
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

// ── PDF ───────────────────────────────────────────────────────────────────────
// Column widths (pt) for landscape A4 (~782pt usable). WIDE_KEYS get '*'.
const PDF_FIXED_WIDTHS = {
  postNumber: 28, date: 62, format: 62, platform: 62,
  contentStructure: 62, structure: 56,
  inspiration: 62, videoRawIdea: 66, thumbnailIdeaForReel: 74,
  rawImageIdeaForFirstFrame: 82, characterObjectOrEnvironmentAction: 82,
  cameraMovement: 70, speedRamp: 64, camera: 60, lens: 60, focalLength: 56, aperture: 64,
  visualMood: 66, textOnVideo: 66, hashtags: 96,
};

function _pdfColWidth(key) {
  if (PDF_FIXED_WIDTHS[key] !== undefined) return PDF_FIXED_WIDTHS[key];
  if (WIDE_KEYS.has(key)) return "*";
  return 72;
}

export async function generatePdf(rows, calendarInfo, logoBuffer, logoMimeType, audience = "creator") {
  const pdfmake = await import("pdfmake").then(m => m.default ?? m);

  pdfmake.setFonts({
    Helvetica: {
      normal: "Helvetica",
      bold: "Helvetica-Bold",
      italics: "Helvetica-Oblique",
      bolditalics: "Helvetica-BoldOblique",
    },
  });
  pdfmake.setUrlAccessPolicy(() => false);
  // Allow standard PDF font names (no path separators); deny actual file paths
  pdfmake.setLocalAccessPolicy((path) => !/[/\\]/.test(path));

  const logoDataUrl =
    logoBuffer && logoMimeType
      ? `data:${logoMimeType};base64,${Buffer.from(logoBuffer).toString("base64")}`
      : null;

  const title = calendarInfo?.title || "Content Calendar";
  const exportDate = new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  const metaParts = [
    calendarInfo?.platform        && `Platform: ${calendarInfo.platform}`,
    calendarInfo?.timePeriod      && `Period: ${calendarInfo.timePeriod}`,
    calendarInfo?.mainMonthlySubject && `Subject: ${calendarInfo.mainMonthlySubject}`,
    calendarInfo?.mainGoal        && `Goal: ${calendarInfo.mainGoal}`,
    calendarInfo?.mainOfferOrMessage && `Offer: ${calendarInfo.mainOfferOrMessage}`,
    `Posts: ${rows.length}`,
  ].filter(Boolean);

  // ── Header block ─────────────────────────────────────────────────────────
  const titleNode  = { text: title, style: "pdfTitle", margin: [0, 0, 0, 4] };
  const metaNode   = { text: metaParts.join("  ·  "), style: "pdfMeta", margin: [0, 0, 0, 3] };
  const dateNode   = { text: `Exported ${exportDate}`, style: "pdfDate", margin: [0, 0, 0, 16] };

  const content = [];
  if (logoDataUrl) {
    content.push({
      columns: [
        { width: 56, stack: [{ image: logoDataUrl, width: 48, margin: [0, 3, 0, 0] }] },
        { stack: [titleNode, metaNode, dateNode], margin: [12, 0, 0, 0] },
      ],
    });
  } else {
    content.push(titleNode, metaNode, dateNode);
  }

  // ── 4 tab sections ────────────────────────────────────────────────────────
  const tableLayout = {
    hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0.5 : 0.3),
    vLineWidth: () => 0.3,
    hLineColor: () => "#cbd5e1",
    vLineColor: () => "#e2e8f0",
    fillColor: (row) => (row === 0 ? "#1e293b" : row % 2 === 1 ? "#f8fafc" : null),
    paddingTop:    () => 3,
    paddingBottom: () => 3,
    paddingLeft:   () => 5,
    paddingRight:  () => 5,
  };

  for (const [i, view] of CALENDAR_TABLE_VIEWS.entries()) {
    const cols = _dropHashtagsColumnIfUnneeded(_filterViewColumns(view, audience), rows);
    content.push({
      text: view.label,
      style: "pdfSection",
      ...(i > 0 ? { pageBreak: "before" } : {}),
    });

    const widths = cols.map(({ key }) => _pdfColWidth(key));
    if (!widths.some((w) => w === "*")) {
      widths[widths.length - 1] = "*";
    }

    const headerRow = cols.map((c) => ({ text: c.label, style: "pdfTh" }));
    const dataRows  = rows.map((row) =>
      cols.map((c) => ({ text: String(row[c.key] ?? ""), style: "pdfTd" }))
    );

    content.push({
      table: { headerRows: 1, widths, body: [headerRow, ...dataRows] },
      layout: tableLayout,
      margin: [0, 0, 0, 8],
    });
  }

  const docDef = {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [30, 40, 30, 36],
    defaultStyle: { font: "Helvetica", fontSize: 8, lineHeight: 1.2 },
    styles: {
      pdfTitle:   { fontSize: 20, bold: true,    color: "#0f172a" },
      pdfMeta:    { fontSize: 8.5,               color: "#64748b" },
      pdfDate:    { fontSize: 7.5, italics: true, color: "#94a3b8" },
      pdfSection: { fontSize: 14, bold: true,    color: "#0f172a", margin: [0, 8, 0, 6] },
      pdfTh:      { bold: true, fontSize: 7.5,   color: "#ffffff" },
      pdfTd:      { fontSize: 7.5,               color: "#1e293b" },
    },
    footer: (currentPage, pageCount) => ({
      text: `${currentPage} / ${pageCount}`,
      alignment: "right",
      margin: [0, 0, 30, 0],
      fontSize: 7,
      color: "#94a3b8",
    }),
    content,
  };

  return pdfmake.createPdf(docDef).getBuffer();
}
