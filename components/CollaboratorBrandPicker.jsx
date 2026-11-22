"use client";

import { useEffect, useState } from "react";

// Keep in sync with MAX_COLLABORATOR_BRANDS in lib/published-post-collaborators.js
// (that module imports prisma, so it is not client-safe to import here).
export const MAX_COLLABORATOR_BRANDS = 3;

const lbl = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--sketch-ink-faint)",
};

/**
 * Instagram collaboration picker.
 *
 * Lists only brands the CURRENT USER can access (GET /api/brands is scoped on
 * the server) minus the post's own brand. The server re-checks every id on
 * save, so this list is a convenience, not the authority.
 */
export default function CollaboratorBrandPicker({ currentBrandId, value, onChange, disabled, knownBrands }) {
  const [brands, setBrands] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const selected = value || [];

  useEffect(() => {
    let cancelled = false;
    fetch("/api/brands")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        // Existing collaborators the viewer cannot otherwise list (added by
        // someone with broader access) stay visible so they can be kept/removed.
        for (const known of knownBrands || []) {
          if (known?.id && !list.some((b) => b.id === known.id)) list.push(known);
        }
        setBrands(
          list
            .filter((b) => b && b.id && b.id !== currentBrandId)
            .map((b) => ({ id: b.id, name: b.name }))
            .sort((a, b) => String(a.name).localeCompare(String(b.name))),
        );
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
    // knownBrands only seeds the list on load; it does not need to re-trigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBrandId]);

  function toggle(id) {
    if (selected.includes(id)) {
      onChange(selected.filter((x) => x !== id));
    } else if (selected.length < MAX_COLLABORATOR_BRANDS) {
      onChange([...selected, id]);
    }
  }

  return (
    <div>
      <div style={{ ...lbl, marginBottom: 4 }}>Collaboration (optional)</div>
      <div style={{ ...lbl, fontSize: 9, color: "var(--sketch-ink-soft)", marginBottom: 6, lineHeight: 1.5, textTransform: "none", letterSpacing: "0.02em" }}>
        Also show this post in another brand&apos;s Instagram grid. This does not send an
        Instagram collab invite — invite the collaborator manually on Instagram.
      </div>
      {loadError ? (
        <div style={{ ...lbl, color: "var(--sketch-vermilion)" }}>Could not load your brands.</div>
      ) : brands === null ? (
        <div style={lbl}>Loading brands…</div>
      ) : brands.length === 0 ? (
        <div style={lbl}>No other brands available to you.</div>
      ) : (
        <div role="group" aria-label="Collaborator brands" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {brands.map((b) => {
            const checked = selected.includes(b.id);
            const atLimit = !checked && selected.length >= MAX_COLLABORATOR_BRANDS;
            return (
              <label
                key={b.id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 8px",
                  border: `1px solid ${checked ? "var(--sketch-ink)" : "var(--sketch-line)"}`,
                  background: checked ? "var(--sketch-paper-raw)" : "transparent",
                  fontFamily: "var(--font-mono-ink)",
                  fontSize: 11,
                  color: "var(--sketch-ink)",
                  cursor: disabled || atLimit ? "not-allowed" : "pointer",
                  opacity: atLimit ? 0.5 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled || atLimit}
                  onChange={() => toggle(b.id)}
                />
                {b.name}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Small "Collab" marker used on grid cards and in the detail modal. */
export function CollaborationBadge({ style }) {
  return (
    <span
      aria-label="Collaboration post"
      title="Collaboration post"
      style={{
        fontFamily: "var(--font-mono-ink)",
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--sketch-paper-bright)",
        background: "#5B4BB7",
        border: "1px solid rgba(247,244,236,0.35)",
        padding: "2px 6px",
        lineHeight: 1.2,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        ...style,
      }}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="9" cy="8" r="3.2" />
        <circle cx="16.5" cy="9" r="2.6" />
        <path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
        <path d="M15 14c3 0 6 1.6 6 4.6" />
      </svg>
      Collab
    </span>
  );
}
