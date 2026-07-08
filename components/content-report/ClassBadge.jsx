const CLASS_MAP = {
  image: { fill: "#7E84B5", label: "IMAGE" },
  video: { fill: "#587860", label: "VIDEO" },
  caption: { fill: "#9A7B52", label: "CAPTION" },
  calendar: { fill: "#B23E26", label: "CALENDAR" },
  brand: { fill: "#7E84B5", label: "BRAND" },
  media: { fill: "#3A3733", label: "MEDIA" },
};

export function ClassBadge({ kind = "image", label }) {
  const c = CLASS_MAP[kind] || CLASS_MAP.image;
  const text = label || c.label;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        background: c.fill,
        color: "#F7F4EC",
        fontFamily: "'DM Mono', ui-monospace, monospace",
        fontSize: "10px",
        fontWeight: 500,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        padding: "3px 8px 2px",
        borderRadius: "1px",
        lineHeight: 1,
      }}
    >
      {text}
    </span>
  );
}
