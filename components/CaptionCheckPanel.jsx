"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import { validateInstagramCaption, INSTAGRAM_MAIN_ANGLES, CAPTION_RULES } from "@/lib/instagram-caption";

const lbl = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--sketch-ink-faint)",
};

const small = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  color: "var(--sketch-ink-soft)",
  lineHeight: 1.5,
};

const btn = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  padding: "4px 10px",
  border: "1px solid var(--sketch-ink)",
  background: "transparent",
  color: "var(--sketch-ink-soft)",
  cursor: "pointer",
};

const RULE_LABELS = [
  ["EMPTY_CAPTION", "Caption text"],
  ["SPACING", "One blank line between paragraphs"],
  ["FOOTER_MISSING", "Brand information before hashtags"],
  ["HASHTAG_COUNT", `Exactly ${CAPTION_RULES.hashtagCount} hashtags on the last line`],
  ["HASHTAGS_OUTSIDE_BLOCK", "No hashtags inside the text"],
];

/**
 * Instagram caption check.
 *
 * "Check caption" sends the caption to the server, which returns grammar and
 * Brand issues, what changed, and a normalised preview. Nothing changes until
 * the user clicks Apply. Once a check has run, the panel re-validates the
 * current caption locally with the SAME function the server uses as its save
 * gate.
 *
 * Imperative API (ref): ensureReady() → Promise<boolean>. Forms call it on
 * submit: true when the caption already passes the rules, otherwise it runs the
 * check, shows the result and returns false so the user can review/apply.
 */
const CaptionCheckPanel = forwardRef(function CaptionCheckPanel(
  { brandId, postId, caption, onApply, disabled },
  ref,
) {
  const [mainAngle, setMainAngle] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [showDetails, setShowDetails] = useState(true);

  const footerInfo = result?.footerInfo || null;
  const live = footerInfo ? validateInstagramCaption(caption, { footerInfo }) : null;
  const previewIsCurrent = result && result.normalizedCaption === caption;

  async function runCheck() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/brands/${brandId}/published-posts/caption-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: caption || "", mainAngle, ...(postId ? { postId } : {}) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Caption check failed (${res.status})`);
      setResult(data);
      setShowDetails(true);
      return data;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }

  useImperativeHandle(ref, () => ({
    async ensureReady() {
      if (live?.ok) return true;
      const data = await runCheck();
      // The check never edits the caption by itself: a valid ORIGINAL caption
      // passes straight through, anything else waits for the user.
      return Boolean(data && data.normalizedCaption === caption && data.validation?.ok);
    },
  }));

  return (
    <div style={{ border: "1px solid var(--sketch-line)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={lbl}>Instagram caption check</span>
        <select
          aria-label="Main Angle (optional)"
          value={mainAngle}
          onChange={(e) => setMainAngle(e.target.value)}
          disabled={disabled || loading}
          style={{ ...small, border: "1px solid var(--sketch-line)", background: "transparent", padding: "3px 6px" }}
        >
          <option value="">Main Angle: not set</option>
          {INSTAGRAM_MAIN_ANGLES.map((a) => (
            <option key={a} value={a}>{`Main Angle: ${a}`}</option>
          ))}
        </select>
        <button type="button" onClick={runCheck} disabled={disabled || loading} style={{ ...btn, marginLeft: "auto", opacity: loading ? 0.6 : 1 }}>
          {loading ? "Checking…" : "Check caption"}
        </button>
      </div>

      {!result && !error && (
        <div style={small}>
          Checks grammar and Brand alignment, keeps paragraphs short with one blank line between them, adds your
          Brand information and exactly {CAPTION_RULES.hashtagCount} hashtags. Nothing changes until you click Apply.
        </div>
      )}

      {error && <div style={{ ...small, color: "var(--sketch-vermilion)" }}>{error}</div>}

      {live && (
        <div role="status" aria-live="polite" style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
          {RULE_LABELS.map(([code, label]) => {
            const failed = live.failures.some((f) => f.code === code);
            return (
              <span key={code} style={{ ...small, color: failed ? "var(--sketch-vermilion)" : "var(--sketch-sage)" }}>
                {failed ? "✗" : "✓"} {label}
              </span>
            );
          })}
          {live.warnings.length > 0 && (
            <span style={{ ...small, color: "var(--sketch-ink-faint)" }}>
              {"⚠"} {live.warnings.length} long paragraph{live.warnings.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      {result && showDetails && (
        <>
          {result.ai?.status === "unavailable" && (
            <div style={{ ...small, color: "var(--sketch-vermilion-ink)" }}>
              {result.ai.message || "Caption quality check unavailable."} Grammar and Brand alignment were not checked;
              formatting rules were still applied.
            </div>
          )}
          {result.ai?.status === "discarded" && (
            <div style={{ ...small, color: "var(--sketch-vermilion-ink)" }}>
              {result.ai.message}
              <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                {result.ai.discardedReasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}

          <IssueList
            title="Grammar"
            empty={result.ai?.status === "ok" ? "No grammar issues found." : null}
            items={(result.ai?.grammarIssues || []).map((g) => `“${g.original}” → “${g.suggestion}”${g.reason ? ` — ${g.reason}` : ""}`)}
          />
          <IssueList
            title="Brand alignment"
            empty={result.ai?.status === "ok" ? "No Brand alignment issues found." : null}
            items={(result.ai?.brandIssues || []).map((b) => `${b.type.replace(/_/g, " ")}: ${b.detail}`)}
          />
          <IssueList title="What changed" empty="No changes needed." items={(result.changes || []).map((c) => c.message)} />
          <IssueList title="Warnings" items={(result.warnings || []).map((w) => w.message)} />

          <div>
            <div style={{ ...lbl, marginBottom: 4 }}>Normalized preview</div>
            <pre
              dir="auto"
              style={{
                ...small,
                fontSize: 11,
                color: "var(--sketch-ink)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                background: "var(--sketch-paper-raw)",
                border: "1px solid var(--sketch-line)",
                padding: 10,
                margin: 0,
                maxHeight: 260,
                overflowY: "auto",
              }}
            >
              {result.normalizedCaption}
            </pre>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" onClick={() => setShowDetails(false)} style={btn}>
              Edit manually
            </button>
            <button
              type="button"
              disabled={disabled || previewIsCurrent}
              onClick={() => {
                onApply(result.normalizedCaption);
                setShowDetails(false);
              }}
              style={{ ...btn, borderColor: "var(--sketch-vermilion)", color: "var(--sketch-vermilion)", opacity: previewIsCurrent ? 0.5 : 1 }}
            >
              {previewIsCurrent ? "Applied" : "Apply"}
            </button>
          </div>
        </>
      )}
      {result && !showDetails && (
        <button type="button" onClick={() => setShowDetails(true)} style={{ ...btn, alignSelf: "flex-start", border: "none", padding: 0 }}>
          Show last check
        </button>
      )}
    </div>
  );
});

function IssueList({ title, items, empty }) {
  if (!items?.length && !empty) return null;
  return (
    <div>
      <div style={{ ...lbl, marginBottom: 2 }}>{title}</div>
      {items?.length ? (
        <ul style={{ ...small, margin: 0, paddingLeft: 16 }} dir="auto">
          {items.map((t, i) => <li key={i}>{t}</li>)}
        </ul>
      ) : (
        <div style={small}>{empty}</div>
      )}
    </div>
  );
}

export default CaptionCheckPanel;
