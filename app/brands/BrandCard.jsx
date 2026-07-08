"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

const lbl = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--sketch-ink-faint)",
};

export default function BrandCard({ brand }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e) {
    e.stopPropagation();
    setDeleting(true);
    try {
      const res = await fetch(`/api/brands/${brand.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success(`"${brand.name}" deleted.`);
      router.refresh();
    } catch {
      toast.error("Failed to delete brand.");
      setDeleting(false);
      setConfirming(false);
    }
  }

  const metaRows = [
    brand.businessLocation && { label: "LOCATION", value: brand.businessLocation },
    brand.brandTone && { label: "TONE", value: brand.brandTone },
    brand.targetAudience && { label: "AUDIENCE", value: brand.targetAudience },
    brand.mainServicesOrProducts && { label: "SERVICES", value: brand.mainServicesOrProducts },
  ]
    .filter(Boolean)
    .slice(0, 3);

  return (
    <div
      onClick={() => router.push(`/brand-workspace?brandId=${brand.id}`)}
      style={{
        cursor: "pointer",
        border: "1px solid var(--sketch-line)",
        background: "var(--sketch-paper-bright)",
        boxShadow: "2px 2px 0 rgba(28,24,18,0.10)",
        display: "flex",
        flexDirection: "column",
        transition: "border-color 160ms ease, box-shadow 160ms ease",
        position: "relative",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--sketch-stone)";
        e.currentTarget.style.boxShadow = "3px 3px 0 rgba(28,24,18,0.14)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--sketch-line)";
        e.currentTarget.style.boxShadow = "2px 2px 0 rgba(28,24,18,0.10)";
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 18px 12px",
          borderBottom: "1px solid var(--sketch-line-soft)",
        }}
      >
        <div style={{ ...lbl, fontSize: 9, marginBottom: 4 }}>
          {brand.businessType || "Brand"}
        </div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 800,
            fontSize: 22,
            lineHeight: 1.05,
            textTransform: "uppercase",
            color: "var(--sketch-ink)",
            letterSpacing: "-0.01em",
          }}
        >
          {brand.name}
        </div>
      </div>

      {/* Meta rows */}
      <div style={{ padding: "12px 18px", flex: 1 }}>
        {metaRows.length > 0 ? (
          metaRows.map(({ label, value }) => (
            <div
              key={label}
              style={{
                display: "flex",
                gap: 12,
                padding: "5px 0",
                borderBottom: "1px solid var(--sketch-line-soft)",
              }}
            >
              <div style={{ ...lbl, width: 72, flex: "0 0 72px", paddingTop: 1 }}>
                {label}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono-ink)",
                  fontSize: 11,
                  color: "var(--sketch-ink-soft)",
                  lineHeight: 1.4,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                }}
              >
                {value}
              </div>
            </div>
          ))
        ) : (
          <div
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 12,
              color: "var(--sketch-ink-faint)",
            }}
          >
            No details yet.
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div
        style={{
          padding: "10px 18px",
          borderTop: "1px solid var(--sketch-line-soft)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <InkButton href={`/brands/${brand.id}`}>Edit</InkButton>
        <InkButton href={`/brand-workspace?brandId=${brand.id}`}>Workspace</InkButton>
        <InkButton href={`/brands/${brand.id}/identity-report`} accent>
          Report
        </InkButton>

        {/* Delete */}
        <div style={{ marginLeft: "auto" }}>
          {!confirming ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setConfirming(true);
              }}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                ...lbl,
                color: "var(--sketch-ink-faint)",
                padding: "2px 4px",
                fontSize: 11,
              }}
              title="Delete brand"
            >
              &times;
            </button>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ ...lbl, fontSize: 9 }}>Delete?</span>
              <button
                onClick={handleDelete}
                disabled={deleting}
                style={{
                  fontFamily: "var(--font-mono-ink)",
                  fontSize: 9,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  padding: "3px 8px",
                  border: "1px solid var(--sketch-vermilion)",
                  background: "var(--sketch-vermilion)",
                  color: "var(--sketch-paper-bright)",
                  cursor: "pointer",
                  opacity: deleting ? 0.5 : 1,
                }}
              >
                {deleting ? "…" : "Yes"}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirming(false);
                }}
                disabled={deleting}
                style={{
                  fontFamily: "var(--font-mono-ink)",
                  fontSize: 9,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  padding: "3px 8px",
                  border: "1px solid var(--sketch-line)",
                  background: "transparent",
                  color: "var(--sketch-ink-soft)",
                  cursor: "pointer",
                }}
              >
                No
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InkButton({ href, children, accent = false }) {
  return (
    <Link
      href={href}
      onClick={(e) => e.stopPropagation()}
      style={{
        fontFamily: "var(--font-mono-ink)",
        fontSize: 10,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        padding: "4px 10px",
        border: `1px solid ${accent ? "var(--sketch-vermilion)" : "var(--sketch-ink)"}`,
        background: accent ? "transparent" : "transparent",
        color: accent ? "var(--sketch-vermilion)" : "var(--sketch-ink-soft)",
        textDecoration: "none",
        display: "inline-flex",
        alignItems: "center",
        cursor: "pointer",
        transition: "background 120ms ease, color 120ms ease",
      }}
    >
      {children}
    </Link>
  );
}
