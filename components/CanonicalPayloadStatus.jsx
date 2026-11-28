"use client";

// Loading / error state for the server-authoritative JSON payload preview.
// On error nothing is reconstructed in the browser: the user sees why and can retry.
const text = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.08em",
  lineHeight: 1.5,
};

export default function CanonicalPayloadStatus({ canonical }) {
  if (canonical.status === "loading") {
    return (
      <div role="status" style={{ ...text, color: "var(--sketch-ink-soft)", padding: "8px 0" }}>
        Loading the payload from the server…
      </div>
    );
  }
  if (canonical.status !== "error") return null;
  return (
    <div
      role="alert"
      style={{
        ...text,
        color: "var(--sketch-vermilion)",
        border: "1px solid var(--sketch-vermilion)",
        padding: "8px 10px",
        display: "flex",
        gap: 10,
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
      }}
    >
      <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
        Could not load the current payload. {canonical.error} Nothing is shown rather than a
        possibly incorrect copy.
      </span>
      <button
        type="button"
        onClick={canonical.retry}
        style={{
          ...text,
          textTransform: "uppercase",
          padding: "4px 10px",
          border: "1px solid var(--sketch-vermilion)",
          background: "transparent",
          color: "var(--sketch-vermilion)",
          cursor: "pointer",
        }}
      >
        Retry
      </button>
    </div>
  );
}
