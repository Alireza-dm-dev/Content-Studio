"use client";

import { useRef } from "react";

// Instagram Published Post thumbnail / cover picker: preview + Upload / Replace / Remove.
// Purely presentational: the parent decides whether a pick uploads now (detail
// modal) or is held until the post is submitted (upload form).

export const THUMBNAIL_ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
const THUMBNAIL_MAX_BYTES = 10 * 1024 * 1024;
const THUMBNAIL_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Quick client-side check; the server re-validates (including file signature). */
export function checkThumbnailFile(file) {
  if (!file) return "Choose an image.";
  if (!THUMBNAIL_TYPES.has(String(file.type).toLowerCase())) return "Thumbnail must be a JPG, PNG or WebP image.";
  if (file.size === 0) return "Thumbnail file is empty.";
  if (file.size > THUMBNAIL_MAX_BYTES) return "Thumbnail is too large. Maximum is 10 MB.";
  return null;
}

const lbl = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--sketch-ink-faint)",
};

const btn = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  padding: "4px 10px",
  border: "1px solid var(--sketch-ink)",
  background: "transparent",
  color: "var(--sketch-ink-soft)",
  cursor: "pointer",
};

export default function PostThumbnailField({ previewUrl, caption, hint, recommended, busy, onPick, onRemove }) {
  const inputRef = useRef(null);

  function handleChange(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onPick(file);
  }

  return (
    <div>
      <div style={{ ...lbl, marginBottom: 4 }}>
        Thumbnail / Cover {recommended ? "(recommended for video)" : "(optional)"}
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div
          style={{
            width: 72,
            aspectRatio: "3 / 4",
            flexShrink: 0,
            border: `1px ${previewUrl ? "solid" : "dashed"} var(--sketch-line)`,
            background: "var(--sketch-paper-raw)",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {previewUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={previewUrl}
              alt={caption ? `Cover for ${caption.slice(0, 40)}` : "Thumbnail preview"}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          ) : (
            <span style={{ ...lbl, fontSize: 8, textAlign: "center" }}>No cover</span>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} style={{ ...btn, opacity: busy ? 0.5 : 1 }}>
              {busy ? "Working…" : previewUrl ? "Replace" : "Upload cover image"}
            </button>
            {previewUrl && (
              <button type="button" disabled={busy} onClick={onRemove} style={{ ...btn, color: "var(--sketch-vermilion)", borderColor: "var(--sketch-vermilion)", opacity: busy ? 0.5 : 1 }}>
                Remove
              </button>
            )}
          </div>
          <div style={{ ...lbl, fontSize: 9, letterSpacing: "0.04em", textTransform: "none", color: "var(--sketch-ink-soft)" }}>
            {hint || "JPG, PNG or WebP, up to 10 MB. Separate from the post media."}
          </div>
        </div>
      </div>
      <input ref={inputRef} type="file" accept={THUMBNAIL_ACCEPT} onChange={handleChange} style={{ display: "none" }} aria-label="Thumbnail image file" />
    </div>
  );
}
