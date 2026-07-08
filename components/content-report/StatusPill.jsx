const STATUS_MAP = {
  approved: { fill: "var(--sketch-vermilion)", color: "var(--sketch-paper-bright)", solid: true, label: "APPROVED" },
  used: { fill: "transparent", color: "var(--sketch-ink-soft)", solid: false, label: "USED" },
  draft: { fill: "transparent", color: "var(--sketch-ink-faint)", solid: false, label: "DRAFT" },
  archived: { fill: "transparent", color: "var(--sketch-line)", solid: false, label: "ARCHIVED" },
  pending: { fill: "transparent", color: "var(--sketch-vermilion)", solid: false, label: "PENDING REVIEW" },
};

export function StatusPill({ status = "draft", label }) {
  const s = STATUS_MAP[status] || STATUS_MAP.draft;
  const text = label || s.label;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontFamily: "var(--font-mono-ink)",
        fontSize: "10.5px",
        fontWeight: 500,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        lineHeight: 1,
        padding: s.solid ? "4px 12px 3px" : "0",
        background: s.fill,
        color: s.color,
        borderRadius: "1px",
      }}
    >
      {text}
    </span>
  );
}
