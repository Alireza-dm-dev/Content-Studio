"use client";

import { useState } from "react";
import {
  X, Download, FileText, FileSpreadsheet, FileDown, HardDriveUpload,
  Loader2, Check, ExternalLink, AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

const EXPORT_OPTIONS = [
  {
    id: "csv",
    label: "Download CSV",
    desc: "Comma-separated file, opens in any spreadsheet app",
    icon: FileText,
  },
  {
    id: "xlsx",
    label: "Download Excel",
    desc: "Excel workbook with posts and calendar info sheets",
    icon: FileSpreadsheet,
  },
  {
    id: "pdf",
    label: "Download PDF",
    desc: "Professional PDF calendar export with all 4 content sections",
    icon: FileDown,
  },
  {
    id: "google_drive",
    label: "Upload to Google Drive",
    desc: "Upload Excel file directly to your Google Drive",
    icon: HardDriveUpload,
  },
];

// Try to read filename from Content-Disposition header
function extractFilename(headers, fallback) {
  const disposition = headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename[^;=\n]*=\s*["']?([^"';\n]+)["']?/i);
  return match?.[1]?.trim() || fallback;
}

async function triggerDownload(calendarId, format) {
  const res = await fetch(`/api/content-calendar/${calendarId}/export?format=${format}`);
  if (!res.ok) {
    const text = await res.text();
    let msg = "Export failed.";
    try { msg = JSON.parse(text).error || msg; } catch {}
    throw new Error(msg);
  }
  const blob     = await res.blob();
  const ext      = format === "xlsx" ? "xlsx" : format === "pdf" ? "pdf" : "csv";
  const filename = extractFilename(res.headers, `content-calendar.${ext}`);
  const url = window.URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export default function ExportCalendarModal({ calendar, onClose }) {
  const [selected,    setSelected]    = useState("csv");
  const [loading,     setLoading]     = useState(false);
  const [driveResult, setDriveResult] = useState(null); // { fileName, driveFileUrl }
  const [driveError,  setDriveError]  = useState(null);

  const postCount = calendar.posts?.length ?? 0;

  function handleSelect(id) {
    setSelected(id);
    setDriveResult(null);
    setDriveError(null);
  }

  async function handleExport() {
    setLoading(true);
    setDriveResult(null);
    setDriveError(null);

    try {
      if (selected === "csv" || selected === "xlsx" || selected === "pdf") {
        await triggerDownload(calendar.id, selected);
        const label = selected === "xlsx" ? "Excel" : selected === "pdf" ? "PDF" : "CSV";
        toast.success(`${label} downloaded successfully.`);
        onClose();
        return;
      }

      if (selected === "google_drive") {
        const res  = await fetch(`/api/content-calendar/${calendar.id}/export/google-drive`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ format: "xlsx" }),
        });
        const data = await res.json();

        if (!data.success) {
          setDriveError(data.error || "Google Drive upload failed.");
          return;
        }

        setDriveResult({ fileName: data.fileName, driveFileUrl: data.driveFileUrl });
        toast.success("Uploaded to Google Drive.");
      }
    } catch (err) {
      toast.error(err.message || "Export failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-md bg-background rounded-xl border border-border shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-border">
          <div>
            <h2 className="text-base font-semibold">Export Content Calendar</h2>
            <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[280px]">
              {calendar.title} · {postCount} {postCount === 1 ? "post" : "posts"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="ml-4 p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <p className="text-sm text-muted-foreground">
            Choose how you want to export this content calendar.
          </p>

          {/* Option cards */}
          <div className="space-y-2">
            {EXPORT_OPTIONS.map(opt => {
              const Icon   = opt.icon;
              const active = selected === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled={loading}
                  onClick={() => handleSelect(opt.id)}
                  className={`w-full flex items-start gap-3 px-4 py-3 rounded-lg border text-left transition-colors disabled:opacity-60 ${
                    active
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/30 hover:bg-muted/30"
                  }`}
                >
                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`} />
                  <div>
                    <p className={`text-sm font-medium ${active ? "text-primary" : ""}`}>{opt.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Google Drive success */}
          {driveResult && (
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 space-y-1.5">
              <p className="text-xs font-medium text-emerald-400 flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5" />Uploaded to Google Drive
              </p>
              <p className="text-xs text-muted-foreground font-mono truncate">{driveResult.fileName}</p>
              {driveResult.driveFileUrl && (
                <a
                  href={driveResult.driveFileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Open in Google Drive <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          )}

          {/* Google Drive error / setup required */}
          {driveError && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 space-y-1">
              <p className="text-xs font-medium text-destructive flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5" />Google Drive unavailable
              </p>
              <p className="text-xs text-muted-foreground">{driveError}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-5 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-60"
          >
            {driveResult ? "Close" : "Cancel"}
          </button>
          {!driveResult && (
            <button
              type="button"
              onClick={handleExport}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" />Exporting…</>
                : <><Download className="w-4 h-4" />Export</>}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
