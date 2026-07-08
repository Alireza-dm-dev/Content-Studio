export function DraftStamp({
  primary = "DRAFT",
  secondary = "REVIEW",
  color = "#B23E26",
  rotate = -7,
  size = 120,
}) {
  return (
    <div
      style={{
        width: size,
        height: size * 0.62,
        border: `2px solid ${color}`,
        borderRadius: "50%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "2px",
        transform: `rotate(${rotate}deg)`,
        boxShadow: `inset 0 0 0 3px ${color}`,
        background: "transparent",
        opacity: 0.9,
      }}
    >
      <span
        style={{
          fontFamily: "'DM Mono', ui-monospace, monospace",
          fontWeight: 500,
          fontSize: `${size * 0.12}px`,
          letterSpacing: "0.16em",
          color,
          lineHeight: 1,
        }}
      >
        {primary}
      </span>
      {secondary && (
        <span
          style={{
            fontFamily: "'DM Mono', ui-monospace, monospace",
            fontSize: `${size * 0.085}px`,
            letterSpacing: "0.22em",
            color,
            opacity: 0.85,
            lineHeight: 1,
          }}
        >
          {secondary}
        </span>
      )}
    </div>
  );
}
