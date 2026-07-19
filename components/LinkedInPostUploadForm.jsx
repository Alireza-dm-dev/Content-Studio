"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import { parseWallClockInTz } from "@/lib/timezone";

const lbl = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--sketch-ink-faint)",
};

const inkBtn = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  padding: "4px 10px",
  border: "1px solid var(--sketch-ink)",
  background: "transparent",
  color: "var(--sketch-ink-soft)",
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
};

const fieldStyle = {
  width: "100%",
  padding: "6px 10px",
  fontFamily: "var(--font-mono-ink)",
  fontSize: 11,
  color: "var(--sketch-ink)",
  background: "var(--sketch-paper-bright)",
  border: "1px solid var(--sketch-line)",
  borderRadius: 0,
  outline: "none",
  boxSizing: "border-box",
};

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

const FORMATS = [
  { value: "static", label: "Single Image" },
  { value: "carousel", label: "PDF Carousel" },
  { value: "reel", label: "Video" },
];

const ACCEPT = {
  static: "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp",
  carousel: "application/pdf,.pdf",
  reel: "video/*",
};

const UPLOAD_LABEL = {
  static: "Upload image",
  carousel: "Upload PDF",
  reel: "Upload video",
};

const DISPLAY_LABEL = {
  static: "Image",
  carousel: "PDF Carousel",
  reel: "Video",
};

const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const IMAGE_EXT = [".jpg", ".jpeg", ".png", ".webp"];

// Accepted image types for an optional LinkedIn video thumbnail. Broader than
// the main image post type set (includes GIF and AVIF).
const THUMBNAIL_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);
const THUMBNAIL_IMAGE_EXT = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"];
const THUMBNAIL_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/avif";
const VIDEO_EXT = [".mp4", ".webm", ".mov", ".avi", ".mpeg", ".mpg"];

function extOf(name) {
  const i = (name || "").lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function isImageFile(file) {
  if (!file) return false;
  const t = (file.type || "").toLowerCase();
  if (IMAGE_MIME.has(t)) return true;
  return IMAGE_EXT.includes(extOf(file.name));
}

function isVideoFile(file) {
  if (!file) return false;
  const t = (file.type || "").toLowerCase();
  if (t.startsWith("video/")) return true;
  return VIDEO_EXT.includes(extOf(file.name));
}

function isPdfFile(file) {
  if (!file) return false;
  const t = (file.type || "").toLowerCase();
  if (t === "application/pdf") return true;
  return extOf(file.name) === ".pdf";
}

function isThumbnailImage(file) {
  if (!file) return false;
  const t = (file.type || "").toLowerCase();
  if (THUMBNAIL_IMAGE_MIME.has(t)) return true;
  return THUMBNAIL_IMAGE_EXT.includes(extOf(file.name));
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 1 ? 1 : 2)} ${units[i - 1]}`;
}

export default function LinkedInPostUploadForm({ brandId, onCreated, onCancel }) {
  const [format, setFormat] = useState("carousel"); // default: PDF Carousel
  const [caption, setCaption] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("draft");
  const [file, setFile] = useState(null);
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const fileInputRef = useRef(null);
  const thumbnailInputRef = useRef(null);

  function resetFileInput() {
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function resetThumbnailInput() {
    if (thumbnailInputRef.current) thumbnailInputRef.current.value = "";
  }

  function handleFormatChange(next) {
    setFormat(next);
    // Clear selection, errors, and native input when switching formats.
    setFile(null);
    setThumbnailFile(null);
    setError(null);
    resetFileInput();
    resetThumbnailInput();
  }

  function handleFileChange(e) {
    const f = e.target.files?.[0] || null;
    setError(null);
    if (!f) {
      setFile(null);
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      setFile(null);
      resetFileInput();
      setError("File exceeds 100 MB limit.");
      return;
    }
    if (format === "carousel" && !isPdfFile(f)) {
      setFile(null);
      resetFileInput();
      setError("LinkedIn carousel file must be a PDF.");
      return;
    }
    if (format === "static" && !isImageFile(f)) {
      setFile(null);
      resetFileInput();
      setError("LinkedIn single-image file must be a JPEG, PNG, or WebP image.");
      return;
    }
    if (format === "reel" && !isVideoFile(f)) {
      setFile(null);
      resetFileInput();
      setError("LinkedIn video post file must be a supported video.");
      return;
    }
    setFile(f);
  }

  function clearFile() {
    setFile(null);
    setError(null);
    resetFileInput();
  }

  function handleThumbnailChange(e) {
    const f = e.target.files?.[0] || null;
    if (!f) {
      setThumbnailFile(null);
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      setThumbnailFile(null);
      resetThumbnailInput();
      setError("Thumbnail exceeds 100 MB limit.");
      return;
    }
    if (!isThumbnailImage(f)) {
      setThumbnailFile(null);
      resetThumbnailInput();
      setError("LinkedIn video thumbnail must be an image (JPEG, PNG, WebP, GIF, or AVIF).");
      return;
    }
    setThumbnailFile(f);
  }

  function clearThumbnail() {
    setThumbnailFile(null);
    resetThumbnailInput();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!file) {
      if (format === "carousel") setError("Select one PDF.");
      else if (format === "static") setError("Select one image.");
      else setError("Select one video.");
      return;
    }

    setUploading(true);

    try {
      const fd = new FormData();
      fd.append("files", file);
      fd.append("platform", "LinkedIn");
      fd.append("postType", format); // static | carousel | reel (never "video")
      fd.append("caption", caption);
      if (scheduledDate) {
        const vancouverDate = parseWallClockInTz(scheduledDate, "America/Vancouver");
        if (vancouverDate) {
          fd.append("scheduledDate", vancouverDate.toISOString());
        }
      }
      fd.append("notes", notes);
      fd.append("status", status || "draft");

      // Optional LinkedIn video thumbnail — only for reel/video posts.
      if (format === "reel" && thumbnailFile) {
        fd.append("thumbnail", thumbnailFile);
      }

      const res = await fetch(`/api/brands/${brandId}/published-posts`, {
        method: "POST",
        body: fd,
      });

      let data;
      try {
        const text = await res.text();
        if (!text) {
          throw new Error(`Upload failed with status ${res.status}`);
        }
        data = JSON.parse(text);
      } catch {
        throw new Error(`Upload failed with status ${res.status}`);
      }

      if (!res.ok) {
        throw new Error(data?.error || `Upload failed with status ${res.status}`);
      }

      const remoteFailed =
        data.remoteResult == null ||
        (data.remoteResult && data.remoteResult.success === false && !data.remoteResult.skipped);
      const webhookFailed = data.webhookResult?.success === false;

      if (webhookFailed && remoteFailed) {
        toast.warning(
          "LinkedIn post uploaded, but remote media upload failed and n8n sending failed.",
        );
        const parts = [];
        if (data.remoteResult?.error) parts.push(`Remote: ${data.remoteResult.error}`);
        if (data.webhookResult?.error) parts.push(`n8n: ${data.webhookResult.error}`);
        if (parts.length) setError(parts.join(" "));
      } else if (webhookFailed) {
        toast.warning("LinkedIn post uploaded, but n8n sending failed.");
        if (data.webhookResult?.error) setError(data.webhookResult.error);
      } else if (remoteFailed) {
        toast.warning("LinkedIn post uploaded, but remote media upload failed.");
        if (data.remoteResult?.error) {
          const codePart = data.remoteResult.code ? ` [${data.remoteResult.code}]` : "";
          setError(`Remote upload failed: ${data.remoteResult.error}${codePart}`);
        } else {
          setError("Remote media upload failed.");
        }
      } else {
        toast.success("LinkedIn post uploaded and sent to n8n.");
      }
      // Reset the optional thumbnail on success (parent will unmount the form).
      setThumbnailFile(null);
      resetThumbnailInput();
      onCreated(data);
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        border: "1px solid var(--sketch-line)",
        background: "var(--sketch-paper-bright)",
        boxShadow: "2px 2px 0 rgba(28,24,18,0.10)",
        padding: "18px 20px",
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Format selector */}
        <div>
          <div style={{ ...lbl, marginBottom: 4 }}>Post Format</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {FORMATS.map((f) => {
              const active = format === f.value;
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => handleFormatChange(f.value)}
                  aria-pressed={active}
                  style={{
                    ...inkBtn,
                    borderColor: active ? "var(--sketch-vermilion)" : "var(--sketch-line)",
                    background: active ? "var(--sketch-vermilion)" : "transparent",
                    color: active ? "var(--sketch-paper-bright)" : "var(--sketch-ink-soft)",
                  }}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* File */}
        <div>
          <div style={{ ...lbl, marginBottom: 4 }}>
            {UPLOAD_LABEL[format]} *
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT[format]}
            onChange={handleFileChange}
            style={fieldStyle}
          />
          {file && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                marginTop: 6,
              }}
            >
              <span
                style={{
                  ...lbl,
                  fontSize: 9,
                  color: "var(--sketch-ink-soft)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {DISPLAY_LABEL[format]} · {file.name} · {formatBytes(file.size)}
              </span>
              <button
                type="button"
                onClick={clearFile}
                style={{
                  ...inkBtn,
                  fontSize: 9,
                  padding: "2px 8px",
                  flexShrink: 0,
                }}
              >
                Clear
              </button>
            </div>
          )}
        </div>

        {/* Video thumbnail (optional, reel/video only) */}
        {format === "reel" && (
          <div>
            <div style={{ ...lbl, marginBottom: 4 }}>Video thumbnail (optional)</div>
            <input
              ref={thumbnailInputRef}
              type="file"
              accept={THUMBNAIL_ACCEPT}
              onChange={handleThumbnailChange}
              disabled={uploading}
              style={fieldStyle}
            />
            <div
              style={{
                ...lbl,
                fontSize: 9,
                marginTop: 3,
                color: "var(--sketch-ink-soft)",
              }}
            >
              Optional poster image shown as the video preview. JPEG, PNG, WebP, GIF, or AVIF.
            </div>
            {thumbnailFile && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  marginTop: 6,
                }}
              >
                <span
                  title={thumbnailFile.name}
                  style={{
                    ...lbl,
                    fontSize: 9,
                    color: "var(--sketch-ink-soft)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {thumbnailFile.name} · {formatBytes(thumbnailFile.size)}
                </span>
                <button
                  type="button"
                  onClick={clearThumbnail}
                  disabled={uploading}
                  style={{
                    ...inkBtn,
                    fontSize: 9,
                    padding: "2px 8px",
                    flexShrink: 0,
                  }}
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        )}

        {/* Caption */}
        <div>
          <div style={{ ...lbl, marginBottom: 4 }}>Caption</div>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={3}
            style={{ ...fieldStyle, resize: "vertical" }}
          />
        </div>

        {/* Scheduled date */}
        <div>
          <div style={{ ...lbl, marginBottom: 4 }}>Scheduled Date (optional)</div>
          <input
            type="datetime-local"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            style={fieldStyle}
          />
        </div>

        {/* Notes */}
        <div>
          <div style={{ ...lbl, marginBottom: 4 }}>Notes (optional)</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            style={{ ...fieldStyle, resize: "vertical" }}
          />
        </div>

        {/* Status */}
        <div>
          <div style={{ ...lbl, marginBottom: 4 }}>Status</div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            style={fieldStyle}
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        {/* Error */}
        {error && (
          <div style={{ ...lbl, color: "var(--sketch-vermilion)", fontSize: 10 }}>
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={uploading}
            style={{ ...inkBtn, opacity: uploading ? 0.5 : 1 }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={uploading}
            style={{
              ...inkBtn,
              borderColor: "var(--sketch-vermilion)",
              background: "var(--sketch-vermilion)",
              color: "var(--sketch-paper-bright)",
              opacity: uploading ? 0.5 : 1,
            }}
          >
            {uploading ? "Uploading…" : "Upload LinkedIn Post"}
          </button>
        </div>
      </div>
    </form>
  );
}
