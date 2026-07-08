export function NodeMap({
  width = 360,
  height = 300,
  hub = { label: "GEN HUB", x: 50, y: 50, color: "var(--sketch-vermilion)" },
  nodes = [],
}) {
  const px = (x) => (x / 100) * width;
  const py = (y) => (y / 100) * height;

  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        background: "var(--sketch-paper-bright)",
        backgroundImage: "radial-gradient(var(--sketch-line-soft) 1px, transparent 1.4px)",
        backgroundSize: "18px 18px",
        border: "1px solid var(--sketch-line)",
      }}
    >
      <svg
        width={width}
        height={height}
        style={{ position: "absolute", inset: 0, overflow: "visible" }}
      >
        {nodes.map((n, i) => (
          <line
            key={`l${i}`}
            x1={px(hub.x)}
            y1={py(hub.y)}
            x2={px(n.x)}
            y2={py(n.y)}
            stroke="var(--sketch-ink-faint)"
            strokeWidth="1"
            strokeDasharray="2 3"
            opacity="0.6"
          />
        ))}
      </svg>

      <MapNode {...hub} hub px={px} py={py} />
      {nodes.map((n, i) => (
        <MapNode key={i} {...n} px={px} py={py} />
      ))}
    </div>
  );
}

function MapNode({ label, x, y, color, hub = false, px, py }) {
  const d = hub ? 46 : 30;
  return (
    <div
      style={{
        position: "absolute",
        left: px(x),
        top: py(y),
        transform: "translate(-50%, -50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "6px",
      }}
    >
      <span
        style={{
          width: d,
          height: d,
          borderRadius: "50%",
          background: color || "var(--sketch-stone)",
          border: "1px solid rgba(28,24,18,0.25)",
          boxShadow: "inset 0 -4px 8px rgba(28,24,18,0.18), 0 1px 2px rgba(28,24,18,0.15)",
          display: "block",
        }}
      />
      <span
        style={{
          fontFamily: "var(--font-mono-ink)",
          fontSize: "9.5px",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
          color: hub ? "var(--sketch-vermilion)" : "var(--sketch-ink-soft)",
        }}
      >
        {label}
      </span>
    </div>
  );
}
