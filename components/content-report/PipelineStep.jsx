export function PipelineStep({ index, lines = [], active = false }) {
  const ink = active ? "var(--sketch-vermilion)" : "var(--sketch-ink)";
  return (
    <div
      style={{
        position: "relative",
        minWidth: "128px",
        padding: "14px 14px 22px",
        background: active ? "var(--sketch-vermilion-wash)" : "var(--sketch-paper-bright)",
        border: `1px solid ${active ? "var(--sketch-vermilion)" : "var(--sketch-line)"}`,
        borderRadius: "1px",
        clipPath: "polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%)",
      }}
    >
      {lines.map((l, i) => (
        <div
          key={i}
          style={{
            fontFamily: "var(--font-mono-ink)",
            fontSize: "12px",
            fontWeight: 500,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: ink,
            lineHeight: 1.4,
          }}
        >
          {l}
        </div>
      ))}
      <span
        style={{
          position: "absolute",
          right: "10px",
          bottom: "6px",
          fontFamily: "var(--font-mono-ink)",
          fontSize: "11px",
          letterSpacing: "0.08em",
          color: active ? "var(--sketch-vermilion)" : "var(--sketch-ink-faint)",
        }}
      >
        {index}
      </span>
    </div>
  );
}
