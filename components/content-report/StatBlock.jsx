export function StatBlock({ value, label, accent = false, size = "md" }) {
  const sizes = { sm: "40px", md: "56px", lg: "72px", xl: "120px" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <div
        style={{
          fontFamily: "'Big Shoulders Display', 'Arial Narrow', sans-serif",
          fontWeight: 900,
          fontSize: sizes[size] || sizes.md,
          lineHeight: 0.9,
          letterSpacing: "-0.01em",
          color: accent ? "#B23E26" : "#1C1812",
          fontVariantNumeric: "lining-nums tabular-nums",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: "'DM Mono', ui-monospace, monospace",
          fontSize: "11px",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "#6B6052",
        }}
      >
        {label}
      </div>
    </div>
  );
}
