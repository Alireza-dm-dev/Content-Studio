"use client";

import { useState, useEffect } from "react";
import { lbl } from "./forum-ui";

// Images open in a simple lightbox (no existing shared media modal to reuse);
// videos use the native player: controls on, never autoplay, height-capped.
export default function ForumMedia({ attachments }) {
  const [zoom, setZoom] = useState(null);

  useEffect(() => {
    if (!zoom) return undefined;
    const onKey = (e) => e.key === "Escape" && setZoom(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [zoom]);

  if (!attachments?.length) return null;

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 12 }}>
        {attachments.map((a) =>
          a.type === "VIDEO" ? (
            <video
              key={a.id}
              src={a.url}
              controls
              preload="metadata"
              style={{ maxWidth: "100%", maxHeight: 320, border: "1px solid var(--sketch-line)", background: "#000" }}
            />
          ) : (
            <button
              key={a.id}
              type="button"
              onClick={() => setZoom(a)}
              aria-label={`Open ${a.fileName}`}
              style={{ padding: 0, border: "1px solid var(--sketch-line)", background: "none", cursor: "zoom-in" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.url} alt={a.fileName} style={{ display: "block", maxWidth: "100%", maxHeight: 260, objectFit: "contain" }} />
            </button>
          ),
        )}
      </div>
      {zoom && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setZoom(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 999, background: "rgba(28,24,18,0.75)",
            display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 10, padding: 24,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom.url} alt={zoom.fileName} style={{ maxWidth: "100%", maxHeight: "85vh", objectFit: "contain" }} />
          <span style={{ ...lbl, color: "var(--sketch-paper-bright)" }}>{zoom.fileName} · click to close</span>
        </div>
      )}
    </>
  );
}
