// Shared style tokens and helpers for the Brand Forum UI (Ink Cartography look).

export const lbl = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--sketch-ink-faint)",
};

export const inkBtn = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  padding: "4px 10px",
  border: "1px solid var(--sketch-ink)",
  background: "transparent",
  color: "var(--sketch-ink-soft)",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
};

export const primaryBtn = {
  ...inkBtn,
  borderColor: "var(--sketch-vermilion)",
  background: "var(--sketch-vermilion)",
  color: "var(--sketch-paper-bright)",
};

export const textareaStyle = {
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "var(--font-mono-ink)",
  fontSize: 12,
  lineHeight: 1.6,
  padding: "10px 12px",
  border: "1px solid var(--sketch-line)",
  background: "var(--sketch-paper-bright)",
  color: "var(--sketch-ink)",
  resize: "vertical",
};

export function fmtStamp(dateStr, withYear = true) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  // en-US gives a stable 3-letter month ("Sep"); en-GB can yield "Sept".
  const month = d.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  const day = String(d.getDate()).padStart(2, "0");
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} ${month}${withYear ? ` ${d.getFullYear()}` : ""} · ${time}`;
}

export function errMessage(err, fallback) {
  if (err instanceof TypeError) return "Network error. Please check your connection.";
  return err?.message || fallback;
}
