"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import { FILE_PURPOSES } from "@/lib/uploads";

const ACCENT_SLUGS = new Set(["reference-image"]);
const WIDE_SLUGS = new Set(["website-screenshot"]);

function Thumb({ file, onDelete, deleting }) {
  const isImage = file.fileType?.startsWith("image/");
  const ratio = WIDE_SLUGS.has(file.purpose) ? "16 / 10" : "1 / 1";

  return (
    <div
      title={file.fileName}
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: ratio,
        border: "1px solid var(--sketch-line)",
        borderRadius: "1px",
        overflow: "hidden",
        background: "var(--sketch-paper-bright)",
        boxShadow: "0 1px 0 rgba(28,24,18,0.06), 0 0 0 0.75px rgba(28,24,18,0.05)",
      }}
    >
      {isImage ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={file.filePath}
          alt={file.fileName}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "flex-end",
            padding: 6,
            background: "repeating-linear-gradient(45deg, var(--sketch-paper-raw) 0 6px, var(--sketch-paper-bright) 6px 12px)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono-ink)",
              fontSize: 8,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--sketch-ink-faint)",
              lineHeight: 1.2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "100%",
            }}
          >
            {file.fileName}
          </span>
        </div>
      )}
      {/* Delete button — visible on hover via CSS-in-JS isn't great, so always show with low opacity */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDelete(file.id); }}
        disabled={deleting}
        style={{
          position: "absolute",
          top: 3,
          right: 3,
          width: 18,
          height: 18,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(28,24,18,0.55)",
          color: "var(--sketch-paper-bright)",
          border: "none",
          borderRadius: "50%",
          cursor: "pointer",
          fontSize: 11,
          lineHeight: 1,
          opacity: 0.7,
          transition: "opacity 120ms ease",
        }}
        title="Remove"
      >
        &times;
      </button>
      {/* Filename overlay */}
      {isImage && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            background: "rgba(28,24,18,0.50)",
            padding: "2px 6px",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono-ink)",
              fontSize: 8,
              color: "var(--sketch-paper-bright)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              display: "block",
            }}
          >
            {file.fileName}
          </span>
        </div>
      )}
    </div>
  );
}

function BrandFileCard({ brandId, purpose, files, onUploaded, onDeleted }) {
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const accent = ACCENT_SLUGS.has(purpose.slug);
  const columns = WIDE_SLUGS.has(purpose.slug) ? 3 : 4;
  const thumbRatio = WIDE_SLUGS.has(purpose.slug) ? "16 / 10" : "1 / 1";
  const count = files.length;
  const empty = count === 0;
  const lineColor = accent ? "var(--sketch-vermilion)" : "var(--sketch-line)";

  async function handleSelect(e) {
    const selected = Array.from(e.target.files ?? []);
    if (!selected.length) return;
    setUploading(true);
    const added = [];
    for (const file of selected) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("purpose", purpose.slug);
      try {
        const res = await fetch(`/api/brands/${brandId}/files`, { method: "POST", body: fd });
        if (!res.ok) {
          const err = await res.json();
          toast.error(`${file.name}: ${err.error ?? "Upload failed"}`);
        } else {
          added.push(await res.json());
        }
      } catch {
        toast.error(`${file.name}: Upload failed`);
      }
    }
    if (added.length) {
      onUploaded(added);
      toast.success(`${added.length} file${added.length > 1 ? "s" : ""} uploaded.`);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleDelete(fileId) {
    setDeletingId(fileId);
    try {
      const res = await fetch(`/api/brands/${brandId}/files/${fileId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      onDeleted(fileId);
      toast.success("File removed.");
    } catch {
      toast.error("Failed to remove file.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        background: "var(--sketch-paper-bright)",
        border: `1px solid ${accent ? "var(--sketch-vermilion)" : "var(--sketch-line)"}`,
        borderRadius: "1px",
        boxShadow: "0 1px 0 rgba(28,24,18,0.06), 0 0 0 0.75px rgba(28,24,18,0.05)",
        padding: "20px 22px",
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf"
        multiple
        style={{ display: "none" }}
        onChange={handleSelect}
      />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 17,
              fontWeight: 600,
              color: "var(--sketch-ink)",
            }}
          >
            {purpose.label}
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono-ink)",
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: "0.12em",
              color: accent ? "var(--sketch-vermilion)" : "var(--sketch-ink-faint)",
              border: `1px solid ${lineColor}`,
              borderRadius: "1px",
              padding: "2px 7px 1px",
              lineHeight: 1,
            }}
          >
            {String(count).padStart(2, "0")}
          </span>
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            background: "transparent",
            color: "var(--sketch-ink)",
            fontFamily: "var(--font-mono-ink)",
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            border: "1px solid var(--sketch-ink)",
            borderRadius: "1px",
            padding: "6px 13px",
            cursor: uploading ? "wait" : "pointer",
            lineHeight: 1,
            opacity: uploading ? 0.5 : 1,
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 13, lineHeight: 0 }}>↑</span>
          {uploading ? "Uploading…" : "Upload"}
        </button>
      </div>

      {/* Body */}
      {empty ? (
        <div
          onClick={() => fileInputRef.current?.click()}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            minHeight: 146,
            border: "1px dashed var(--sketch-line)",
            borderRadius: "1px",
            background: "repeating-linear-gradient(45deg, transparent 0 9px, rgba(180,156,120,0.05) 9px 10px)",
            cursor: "pointer",
            textAlign: "center",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              fontFamily: "var(--font-mono-ink)",
              fontSize: 22,
              color: "var(--sketch-ink-faint)",
              lineHeight: 1,
            }}
          >
            ⊕
          </span>
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 14,
              fontStyle: "italic",
              color: "var(--sketch-ink-faint)",
            }}
          >
            Upload {purpose.label.toLowerCase()} files
          </span>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
            gap: 10,
          }}
        >
          {files.map((file) => (
            <Thumb
              key={file.id}
              file={file}
              onDelete={handleDelete}
              deleting={deletingId === file.id}
            />
          ))}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
              aspectRatio: thumbRatio,
              border: "1px dashed var(--sketch-line)",
              borderRadius: "1px",
              background: "transparent",
              cursor: "pointer",
              color: "var(--sketch-ink-faint)",
            }}
          >
            <span
              aria-hidden="true"
              style={{ fontFamily: "var(--font-mono-ink)", fontSize: 16, lineHeight: 0 }}
            >
              ⊕
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono-ink)",
                fontSize: 9,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
              }}
            >
              Add
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

export default function BrandFilesGallery({ brandId, initialFiles }) {
  const [files, setFiles] = useState(initialFiles);

  const totalFiles = files.length;
  const filledCats = FILE_PURPOSES.filter((p) => filesForPurpose(p.slug).length > 0).length;

  function filesForPurpose(slug) {
    return files.filter((f) => f.purpose === slug);
  }

  function handleUploaded(newFiles) {
    setFiles((prev) => [...newFiles, ...prev]);
  }

  function handleDeleted(fileId) {
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 18, marginBottom: 24 }}>
      {/* Section header */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          paddingBottom: 8,
          borderBottom: "2px solid var(--sketch-vermilion)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 900,
              fontSize: 34,
              lineHeight: 0.9,
              letterSpacing: "-0.01em",
              textTransform: "uppercase",
              color: "var(--sketch-ink)",
            }}
          >
            Brand Files
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono-ink)",
              fontSize: 11,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--sketch-ink-faint)",
            }}
          >
            {totalFiles} files &middot; {filledCats} of {FILE_PURPOSES.length} categories
          </span>
        </div>
        <span
          style={{
            fontFamily: "var(--font-mono-ink)",
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--sketch-ink-faint)",
          }}
        >
          Ref &middot; Source Material
        </span>
      </div>

      {/* Category grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 18,
          alignItems: "start",
        }}
      >
        {FILE_PURPOSES.map((purpose) => (
          <BrandFileCard
            key={purpose.slug}
            brandId={brandId}
            purpose={purpose}
            files={filesForPurpose(purpose.slug)}
            onUploaded={handleUploaded}
            onDeleted={handleDeleted}
          />
        ))}
      </div>
    </section>
  );
}
