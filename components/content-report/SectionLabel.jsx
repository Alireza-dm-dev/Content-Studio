export function SectionLabel({ children, meta, rule = true, accent = false }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: "12px",
        paddingBottom: "6px",
        borderBottom: rule ? "1px solid #CFC6B4" : "none",
      }}
    >
      <span
        style={{
          fontFamily: "'DM Mono', ui-monospace, monospace",
          fontSize: "13px",
          fontWeight: 500,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: accent ? "#B23E26" : "#1C1812",
        }}
      >
        {children}
      </span>
      {meta != null && (
        <span
          style={{
            fontFamily: "'DM Mono', ui-monospace, monospace",
            fontSize: "11px",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#6B6052",
          }}
        >
          {meta}
        </span>
      )}
    </div>
  );
}
