// Conversation-history budgeting for Brand chat. Pure functions, no I/O.
//
// Strategy: keep the most recent turns that fit the character budget (always at least
// `minTurnsKept`), preserve chronological order, and replace dropped older turns with a
// deterministic extractive note built only from what the user actually said — no model
// call, so nothing can be invented.

const NOTE_ENTRY_CHARS = 220;
const NOTE_MAX_ENTRIES = 12;

function clip(text, max) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** Drop empty/duplicate-adjacent entries and enforce strict role validity. */
export function normalizeHistory(history) {
  const out = [];
  for (const entry of Array.isArray(history) ? history : []) {
    if (!entry || (entry.role !== "user" && entry.role !== "assistant")) continue;
    if (typeof entry.content !== "string" || !entry.content.trim()) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === entry.role && prev.content === entry.content.trim()) continue;
    out.push({ role: entry.role, content: entry.content.trim() });
  }
  return out;
}

function buildEarlierNote(dropped) {
  const userAsks = dropped.filter((m) => m.role === "user").slice(-NOTE_MAX_ENTRIES);
  if (!userAsks.length) return "";
  const lines = userAsks.map((m) => `- ${clip(m.content, NOTE_ENTRY_CHARS)}`);
  return [
    "Earlier in this conversation (older messages omitted for length), the user asked or decided:",
    ...lines,
    "Treat these as standing context and constraints; do not repeat earlier answers unless asked.",
  ].join("\n");
}

/**
 * @returns {{ messages: {role,content}[], earlierNote: string, keptCount: number, droppedCount: number, chars: number }}
 */
export function budgetHistory(history, { charBudget, minTurnsKept = 4 } = {}) {
  const all = normalizeHistory(history);
  const kept = [];
  let chars = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    const len = all[i].content.length;
    if (kept.length >= minTurnsKept && chars + len > charBudget) break;
    kept.unshift(all[i]);
    chars += len;
  }
  // A conversation window must not start with an assistant turn.
  while (kept.length > 1 && kept[0].role === "assistant") {
    chars -= kept[0].content.length;
    kept.shift();
  }
  const dropped = all.slice(0, all.length - kept.length);
  return {
    messages: kept,
    earlierNote: buildEarlierNote(dropped),
    keptCount: kept.length,
    droppedCount: dropped.length,
    chars,
  };
}
