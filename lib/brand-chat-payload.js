// Client-side helper: which transcript turns are sent to the chat API as conversation history.
// Pure, so it is unit-tested without rendering the component.

/**
 * Newest turns, chronological. Failed turns (error notices and the user message they belong to)
 * are never sent — they are not part of the real conversation.
 */
export function buildHistoryPayload(transcript, { maxMessages = 60, maxChars = 100000 } = {}) {
  const valid = [];
  for (let i = 0; i < transcript.length; i++) {
    const msg = transcript[i];
    if (msg.error) continue;
    if (msg.role === "user" && transcript[i + 1]?.error) continue;
    valid.push({ role: msg.role, content: msg.content });
  }
  const msgs = [];
  let total = 0;
  for (let i = valid.length - 1; i >= 0 && msgs.length < maxMessages; i--) {
    if (total + valid[i].content.length > maxChars) break;
    msgs.unshift(valid[i]);
    total += valid[i].content.length;
  }
  return msgs;
}
