"use client";

import { useState, useRef, useEffect, useCallback } from "react";

const MAX_VISIBLE = 20;
const MAX_HISTORY = 8;
const MAX_HISTORY_TOTAL_CHARS = 10000;
const MAX_MSG_CHARS = 2000;

const STARTERS = [
  "Summarise this Brand's tone of voice.",
  "What content themes should we prioritise?",
  "Review the latest content calendar.",
  "Suggest a LinkedIn post for this Brand.",
  "What important information is missing from this Brand profile?",
];

const lbl = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--sketch-ink-faint)",
};

function makeSourceChip(src) {
  const parts = [src.label];
  if (src.platform) parts.push(src.platform);
  if (src.date) {
    try { parts.push(new Date(src.date).toLocaleDateString()); } catch { /* skip */ }
  }
  return parts.join(" \u00B7 ");
}

function typeIcon(type) {
  switch (type) {
    case "brand_profile": return "\uD83C\uDF10";
    case "brand_identity": return "\uD83C\uDFA8";
    case "brand_strategy": return "\uD83D\uDCCA";
    case "content_calendar": return "\uD83D\uDCC5";
    case "calendar_post": return "\uD83D\uDCEE";
    case "published_post": return "\uD83D\uDCF1";
    case "reference_attachment": return "\uD83D\uDCCE";
    default: return "\uD83D\uDCCB";
  }
}

function ChatMessage({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
      }}>
        <div style={{
          maxWidth: "80%",
          padding: "8px 12px",
          borderRadius: 8,
          background: isUser ? "var(--sketch-vermilion)" : "var(--sketch-paper-bright)",
          color: isUser ? "#fff" : "var(--sketch-ink)",
          border: isUser ? "none" : "1px solid var(--sketch-line)",
          fontFamily: "var(--font-mono-ink)",
          fontSize: 12,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}>
          {msg.content}
        </div>
      </div>
      {msg.error && (
        <div style={{ ...lbl, color: "var(--sketch-vermilion)", marginTop: 4, fontSize: 9 }}>
          {msg.error}
        </div>
      )}
      {msg.sources && msg.sources.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
          {msg.sources.map((src, i) => (
            <span key={i} style={{
              fontSize: 9,
              fontFamily: "var(--font-mono-ink)",
              color: "var(--sketch-ink-faint)",
              border: "1px solid var(--sketch-line)",
              borderRadius: 3,
              padding: "2px 6px",
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
            }}>
              {typeIcon(src.type)} {makeSourceChip(src)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BrandAssistant({ brandId, brandName }) {
  const [transcript, setTranscript] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [retryMessage, setRetryMessage] = useState(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [showStop, setShowStop] = useState(false);

  const abortRef = useRef(null);
  const submittedRef = useRef(false);
  const mountedRef = useRef(true);
  const transcriptEndRef = useRef(null);
  const brandIdRef = useRef(brandId);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  const clearConversation = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setTranscript([]);
    setError(null);
    setRetryMessage(null);
    setHasStarted(false);
    setLoading(false);
    setShowStop(false);
    setInput("");
  }, []);

  useEffect(() => {
    if (brandId !== brandIdRef.current) {
      clearConversation();
      brandIdRef.current = brandId;
    }
  }, [brandId, clearConversation]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  function addToTranscript(entry) {
    setTranscript((prev) => {
      const next = [...prev, entry];
      return next.length > MAX_VISIBLE ? next.slice(next.length - MAX_VISIBLE) : next;
    });
  }

  function buildHistoryPayload() {
    const msgs = [];
    let totalChars = 0;
    for (const msg of transcript) {
      if (msgs.length >= MAX_HISTORY) break;
      const content = msg.content;
      if (content.length + totalChars > MAX_HISTORY_TOTAL_CHARS) break;
      msgs.push({ role: msg.role, content });
      totalChars += content.length;
    }
    return msgs;
  }

  async function sendMessage(text) {
    if (!text.trim() || loading || submittedRef.current) return;
    submittedRef.current = true;
    setLoading(true);
    setShowStop(true);
    setError(null);
    setRetryMessage(null);
    setHasStarted(true);

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    addToTranscript({ role: "user", content: text.trim() });

    const history = buildHistoryPayload();

    try {
      const res = await fetch(`/api/brands/${encodeURIComponent(brandIdRef.current)}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text.trim(), history }),
        signal: controller.signal,
      });

      if (!mountedRef.current) {
        submittedRef.current = false;
        setLoading(false);
        setShowStop(false);
        return;
      }

      let errorBody;
      try { errorBody = await res.clone().json(); } catch {}

      const code = errorBody?.code;
      const apiMsg = errorBody?.error;

      function showError(message, errorLabel, retry = false) {
        addToTranscript({ role: "assistant", content: message, error: errorLabel });
        if (retry) setRetryMessage(text.trim());
        setLoading(false);
        setShowStop(false);
        submittedRef.current = false;
      }

      if (res.status === 401) {
        showError("Sign in again to use Brand Assistant.", "auth");
        return;
      }
      if (res.status === 403) {
        showError("You do not have access to this Brand.", "access");
        return;
      }
      if (res.status === 429) {
        showError("Too many chat requests. Please wait and try again.", "rate");
        return;
      }
      if (res.status === 504 || code === "AI_TIMEOUT") {
        showError("Brand Assistant timed out. Try again.", "timeout", true);
        return;
      }
      if (res.status === 502 || code === "AI_PROVIDER_ERROR") {
        showError("Brand Assistant could not reach the AI provider. Try again.", "provider", true);
        return;
      }
      if (res.status === 503) {
        if (code === "OPENAI_NOT_CONFIGURED") {
          showError("Brand Assistant is not configured yet.", "config");
        } else {
          showError("Brand Assistant could not be prepared right now. Try again.", "unavailable", true);
        }
        return;
      }
      if (res.status === 400 || res.status === 413 || res.status === 415) {
        showError(apiMsg || "Request could not be processed.", "bad");
        return;
      }
      if (res.status === 500) {
        showError("Brand Assistant encountered an error. Try again.", "server", true);
        return;
      }
      if (!res.ok) {
        showError("Brand Assistant is temporarily unavailable.", "unknown");
        return;
      }

      const textBody = await res.text();
      if (!mountedRef.current) {
        submittedRef.current = false;
        setLoading(false);
        setShowStop(false);
        return;
      }

      let data;
      try { data = JSON.parse(textBody); } catch {
        addToTranscript({ role: "assistant", content: "Brand Assistant is temporarily unavailable.", error: "parse" });
        setLoading(false);
        setShowStop(false);
        submittedRef.current = false;
        return;
      }

      if (!data.success || !data.answer) {
        addToTranscript({ role: "assistant", content: data.error || "Brand Assistant is temporarily unavailable.", error: "business" });
        setLoading(false);
        setShowStop(false);
        submittedRef.current = false;
        return;
      }

      addToTranscript({
        role: "assistant",
        content: data.answer,
        sources: data.sources || [],
      });
      setLoading(false);
      setShowStop(false);
      submittedRef.current = false;
    } catch (err) {
      if (err?.name === "AbortError") {
        submittedRef.current = false;
        setLoading(false);
        setShowStop(false);
        return;
      }
      if (!mountedRef.current) {
        submittedRef.current = false;
        setLoading(false);
        setShowStop(false);
        return;
      }
      addToTranscript({ role: "assistant", content: "Brand Assistant is temporarily unavailable.", error: "network" });
      setLoading(false);
      setShowStop(false);
      submittedRef.current = false;
    }
  }

  function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    setInput("");
    sendMessage(trimmed);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleRetry() {
    if (retryMessage) {
      const msg = retryMessage;
      setRetryMessage(null);
      sendMessage(msg);
    }
  }

  function handleStop() {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setLoading(false);
    setShowStop(false);
    submittedRef.current = false;
  }

  function handleStarter(text) {
    if (loading) return;
    setInput("");
    sendMessage(text);
  }

  const charsRemaining = MAX_MSG_CHARS - input.length;
  const nearLimit = charsRemaining <= 50;

  return (
    <section style={{
      border: "1px solid var(--sketch-line)",
      background: "var(--sketch-paper-bright)",
      boxShadow: "2px 2px 0 rgba(28,24,18,0.10)",
      marginTop: 36,
      overflow: "hidden",
    }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "14px 18px",
        borderBottom: "1px solid var(--sketch-line-soft)",
      }}>
        <div>
          <div style={{ fontFamily: "var(--font-mono-ink)", fontSize: 13, fontWeight: 500, color: "var(--sketch-ink)" }}>
            Brand Assistant
          </div>
          <div style={lbl}>Based on: {brandName}</div>
        </div>
        {hasStarted && (
          <button type="button" onClick={clearConversation}
            aria-label="Clear conversation"
            style={{
              fontFamily: "var(--font-mono-ink)", fontSize: 9, letterSpacing: "0.08em",
              textTransform: "uppercase", padding: "3px 8px",
              border: "1px solid var(--sketch-line)", background: "transparent",
              color: "var(--sketch-ink-faint)", cursor: "pointer",
            }}>
            Clear
          </button>
        )}
      </div>

      <div style={{ padding: "14px 18px", minHeight: 200, maxHeight: 400, overflowY: "auto" }}>
        {!hasStarted ? (
          <div>
            <p style={{ ...lbl, marginBottom: 12, lineHeight: 1.5 }}>
              {"Ask about this Brand's identity, content strategy, calendars, published posts, or reference material."}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {STARTERS.map((s, i) => (
                <button key={i} type="button" onClick={() => handleStarter(s)}
                  disabled={loading}
                  aria-label={s}
                  style={{
                    textAlign: "left", fontFamily: "var(--font-mono-ink)", fontSize: 11,
                    color: "var(--sketch-ink-soft)", border: "1px solid var(--sketch-line)",
                    background: "transparent", padding: "6px 10px", cursor: loading ? "default" : "pointer",
                    opacity: loading ? 0.5 : 1, borderRadius: 4,
                  }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            {transcript.map((msg, i) => (
              <ChatMessage key={i} msg={msg} />
            ))}
            {loading && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <div style={{
                  width: 8, height: 8, borderRadius: "50%", background: "var(--sketch-ink-faint)",
                  animation: "pulse 1.2s ease-in-out infinite",
                }} />
                <span style={{ ...lbl, fontSize: 9 }}>Brand Assistant is thinking...</span>
                <style>{`@keyframes pulse { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }`}</style>
              </div>
            )}
            {retryMessage && !loading && (
              <button type="button" onClick={handleRetry}
                aria-label="Retry"
                style={{
                  fontFamily: "var(--font-mono-ink)", fontSize: 9, letterSpacing: "0.08em",
                  textTransform: "uppercase", padding: "4px 10px",
                  border: "1px solid var(--sketch-vermilion)", background: "transparent",
                  color: "var(--sketch-vermilion)", cursor: "pointer", marginBottom: 12,
                }}>
                Retry
              </button>
            )}
            <div ref={transcriptEndRef} />
          </div>
        )}
      </div>

      <div style={{
        borderTop: "1px solid var(--sketch-line-soft)",
        padding: "10px 18px 14px",
      }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <div style={{ flex: 1, position: "relative" }}>
            <textarea
              value={input}
              onChange={(e) => {
                if (e.target.value.length <= MAX_MSG_CHARS) setInput(e.target.value);
              }}
              onKeyDown={handleKeyDown}
              disabled={loading}
              placeholder="Ask about this Brand..."
              rows={2}
              aria-label="Message"
              style={{
                width: "100%", resize: "none",
                fontFamily: "var(--font-mono-ink)", fontSize: 11,
                border: "1px solid var(--sketch-line)", background: "transparent",
                padding: "6px 8px", color: "var(--sketch-ink)", lineHeight: 1.4,
              }}
            />
            {nearLimit && input.length > 0 && (
              <span style={{
                position: "absolute", right: 4, bottom: 4,
                fontSize: 9, fontFamily: "var(--font-mono-ink)",
                color: "var(--sketch-vermilion)",
              }}>
                {charsRemaining}
              </span>
            )}
          </div>
          {loading ? (
            <button type="button" onClick={handleStop}
              aria-label="Stop generating"
              style={{
                fontFamily: "var(--font-mono-ink)", fontSize: 9, letterSpacing: "0.08em",
                textTransform: "uppercase", padding: "6px 10px",
                border: "1px solid var(--sketch-ink)", background: "transparent",
                color: "var(--sketch-ink)", cursor: "pointer", whiteSpace: "nowrap",
              }}>
              Stop
            </button>
          ) : (
            <button type="button" onClick={handleSend}
              disabled={!input.trim()}
              aria-label="Send message"
              style={{
                fontFamily: "var(--font-mono-ink)", fontSize: 9, letterSpacing: "0.08em",
                textTransform: "uppercase", padding: "6px 10px",
                border: "1px solid var(--sketch-vermilion)",
                background: !input.trim() ? "transparent" : "var(--sketch-vermilion)",
                color: !input.trim() ? "var(--sketch-ink-faint)" : "#fff",
                cursor: !input.trim() ? "default" : "pointer", whiteSpace: "nowrap",
                opacity: !input.trim() ? 0.5 : 1,
              }}>
              Send
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
