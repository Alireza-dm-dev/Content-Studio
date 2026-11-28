"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// Trial Send to n8n for a saved post (Instagram + LinkedIn detail modals).
// Explicit user action only: preflight → confirmation → POST → result panel.
// Everything shown comes from the server; the trial URL and secret never reach
// the browser. The result lives only in this component's state.
//
// The modals mount this with key = post id + scheduledDate + updatedAt, so
// switching posts or saving an edit discards any open confirmation and result.
// Responses that arrive after unmount (e.g. the modal closed or another post
// opened) are ignored. Nothing retries automatically.

const mono = { fontFamily: "var(--font-mono-ink)", fontSize: 10, letterSpacing: "0.06em", lineHeight: 1.5 };
const btn = {
  ...mono,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  padding: "4px 10px",
  border: "1px solid var(--sketch-ink)",
  background: "transparent",
  color: "var(--sketch-ink-soft)",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
};
const box = { border: "1px dashed var(--sketch-line)", padding: "8px 10px", marginTop: 10, display: "flex", flexDirection: "column", gap: 6 };
const pre = {
  ...mono,
  margin: 0,
  padding: 8,
  maxHeight: 240,
  overflow: "auto",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  background: "var(--sketch-paper-raw)",
  border: "1px solid var(--sketch-line)",
  color: "var(--sketch-ink)",
};

function Row({ label, value }) {
  if (value == null || value === "") return null;
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", ...mono }}>
      <span style={{ textTransform: "uppercase", color: "var(--sketch-ink-faint)", minWidth: 150 }}>{label}</span>
      <span style={{ color: "var(--sketch-ink)", overflowWrap: "anywhere", minWidth: 0 }}>{String(value)}</span>
    </div>
  );
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function copy(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied.`);
  } catch {
    toast.error("Failed to copy to clipboard.");
  }
}

const OUTCOME_COLOR = {
  http_accepted: "var(--sketch-ink)",
  response_truncated: "var(--sketch-ink)",
};

export default function TrialSendSection({ brandId, postId }) {
  const url = `/api/brands/${brandId}/published-posts/${postId}/trial-webhook`;
  const [preflight, setPreflight] = useState(null); // preflight
  const [confirm, setConfirm] = useState(null); // preflight shown in the dialog
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const alive = useRef(true);
  const inFlight = useRef(false); // synchronous duplicate-click guard

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    fetch(url, { cache: "no-store" })
      .then(readJson)
      .then((b) => { if (alive) setPreflight(b && !b.error ? b : { ready: false, message: b?.error || "Trial Send is unavailable." }); })
      .catch(() => { if (alive) setPreflight({ ready: false, message: "Trial Send is unavailable." }); });
    return () => { alive = false; };
  }, [url]);

  async function openConfirm() {
    if (inFlight.current) return;
    setError(null);
    setResult(null);
    let res;
    try {
      res = await fetch(url, { cache: "no-store" });
    } catch {
      if (alive.current) setError({ message: "Could not prepare the trial (network error). Nothing was sent." });
      return;
    }
    const b = await readJson(res);
    if (!alive.current) return;
    if (!res.ok || !b) {
      setError({ message: b?.error || `Could not prepare the trial (HTTP ${res.status}).` });
      return;
    }
    setPreflight(b);
    if (!b.ready) return;
    setConfirm(b);
  }

  async function run(payloadOnly) {
    if (inFlight.current || !confirm) return;
    inFlight.current = true;
    const confirmFingerprint = confirm.fingerprint;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payloadOnly, confirmFingerprint }),
      });
      const b = await readJson(res);
      if (!alive.current) return; // modal closed / another post opened: drop it
      if (!res.ok || !b?.result) {
        setError({ message: b?.error || `The trial could not be run (HTTP ${res.status}).`, code: b?.code, blockedFields: b?.blockedFields, unavailableMedia: b?.unavailableMedia });
      } else {
        setResult(b.result);
      }
    } catch {
      if (alive.current) setError({ message: "The trial request did not complete. It is not known whether n8n received it." });
    } finally {
      inFlight.current = false;
      if (alive.current) {
        setRunning(false);
        setConfirm(null);
      }
    }
  }

  function download() {
    const blob = new Blob([JSON.stringify({ kind: "content-studio-n8n-trial", ...result }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `trial-${result.postId || postId}-${result.trialId}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  const ready = preflight?.ready === true;
  const s = confirm?.summary;

  return (
    <div data-testid="trial-send" style={{ marginTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {!ready && preflight && (
          <span style={{ ...mono, color: "var(--sketch-ink-soft)" }} data-testid="trial-unavailable">
            {preflight.message || "Trial webhook is not configured."}
            {preflight.code === "TRIAL_NOT_CONFIGURED" && " An administrator can configure it in Settings → n8n Webhooks."}
          </span>
        )}
        <button
          type="button"
          onClick={openConfirm}
          disabled={!ready || running || Boolean(confirm)}
          aria-label="Trial Send to n8n"
          style={{ ...btn, opacity: !ready || running ? 0.5 : 1, cursor: !ready || running ? "not-allowed" : "pointer" }}
        >
          {running ? "Sending trial…" : "Trial Send to n8n"}
        </button>
      </div>

      {confirm && (
        <div role="alertdialog" aria-label="Confirm trial send" style={box}>
          <div style={{ ...mono, textTransform: "uppercase", color: "var(--sketch-ink)" }}>Run a trial send?</div>
          <Row label="Brand" value={s.brandName} />
          <Row label="Platform" value={s.platform} />
          <Row label="Post ID" value={s.postId} />
          <Row label="Brand-local schedule" value={s.schedule?.scheduled ? `${s.schedule.dateTime} · ${s.schedule.timezoneLabel}` : "Not scheduled"} />
          <Row label="n8n Scheduled Date" value={s.n8nScheduledDate || "(empty — not scheduled)"} />
          <Row label="Destination" value={confirm.destinationType} />
          <div style={{ ...mono, color: "var(--sketch-ink)" }}>
            This sends the saved post payload to the configured trial webhook. Make sure the n8n test workflow is listening and cannot publish or write to production.
          </div>
          <div style={{ ...mono, color: "var(--sketch-vermilion)" }}>{confirm.warning}</div>
          {confirm.blockedFields?.length > 0 && (
            <div role="alert" style={{ ...mono, color: "var(--sketch-vermilion)" }}>
              The payload contains values that must not leave the server, so this trial cannot run:
              <ul style={{ margin: "4px 0 0 16px" }}>
                {confirm.blockedFields.map((f) => <li key={f.field}>{f.field} — {f.reason}</li>)}
              </ul>
            </div>
          )}
          {confirm.unavailableMedia?.length > 0 && !confirm.blockedFields?.length && (
            <div style={{ ...mono, color: "var(--sketch-ink)" }} data-testid="trial-media-warning">
              Some media has no public URL yet, so n8n could not fetch it and a full media test is not possible:
              <ul style={{ margin: "4px 0 0 16px" }}>
                {confirm.unavailableMedia.map((f) => <li key={f}>{f}</li>)}
              </ul>
              You can run a payload-only trial: the payload is sent unchanged and media delivery is not verified.
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => setConfirm(null)} style={btn}>Cancel</button>
            {!confirm.blockedFields?.length && (
              confirm.unavailableMedia?.length ? (
                <button type="button" onClick={() => run(true)} disabled={running} style={{ ...btn, borderColor: "var(--sketch-vermilion)", color: "var(--sketch-vermilion)" }}>
                  Run payload-only trial
                </button>
              ) : (
                <button type="button" onClick={() => run(false)} disabled={running} style={{ ...btn, borderColor: "var(--sketch-vermilion)", color: "var(--sketch-vermilion)" }}>
                  Run Trial
                </button>
              )
            )}
          </div>
        </div>
      )}

      {running && <div role="status" style={{ ...mono, marginTop: 8, color: "var(--sketch-ink-soft)" }}>Sending trial… (up to 30 seconds)</div>}

      {error && (
        <div role="alert" style={{ ...box, borderColor: "var(--sketch-vermilion)" }} data-testid="trial-error">
          <div style={{ ...mono, color: "var(--sketch-vermilion)", overflowWrap: "anywhere" }}>{error.message}</div>
          {error.blockedFields?.length > 0 && (
            <ul style={{ ...mono, margin: "0 0 0 16px" }}>{error.blockedFields.map((f) => <li key={f.field}>{f.field} — {f.reason}</li>)}</ul>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="button" onClick={openConfirm} disabled={!ready || running} style={btn}>Try again</button>
          </div>
        </div>
      )}

      {result && (
        <div aria-label="Trial result" data-testid="trial-result" style={box}>
          <div style={{ ...mono, textTransform: "uppercase", color: OUTCOME_COLOR[result.outcome] || "var(--sketch-vermilion)" }} data-testid="trial-outcome">
            Trial · {result.label}
          </div>
          {result.payloadOnly && (
            <div style={{ ...mono, color: "var(--sketch-vermilion)" }}>Payload-only trial — media not verified.</div>
          )}
          <div style={{ ...mono, color: "var(--sketch-ink-soft)" }}>{result.hint}</div>
          <Row label="HTTP status" value={result.httpStatus ?? "—"} />
          <Row label="Duration" value={`${result.durationMs} ms`} />
          <Row label="Trial time (UTC)" value={result.startedAt} />
          <Row label="Correlation ID" value={result.trialId} />
          <Row label="Post ID" value={result.postId} />
          <Row label="Platform" value={result.platform} />
          <Row label="Brand-local schedule" value={result.schedule?.scheduled ? `${result.schedule.dateTime} · ${result.schedule.timezoneLabel}` : "Not scheduled"} />
          <Row label="n8n Scheduled Date" value={result.n8nScheduledDate || "(empty)"} />
          <Row label="Destination" value={result.destinationType} />
          {result.responseTruncated && <Row label="Response" value={`Truncated at 64 KB`} />}
          <details>
            <summary style={{ ...mono, cursor: "pointer", textTransform: "uppercase" }}>Outgoing Request JSON</summary>
            <pre style={pre} data-testid="trial-request">{result.requestBody}</pre>
          </details>
          <details>
            <summary style={{ ...mono, cursor: "pointer", textTransform: "uppercase" }}>n8n Response</summary>
            <pre style={pre} data-testid="trial-response">
              {result.responseText == null ? "(no response)" : result.responseEmpty ? "(empty response body)" : result.responseText}
            </pre>
          </details>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => copy(result.requestBody, "Request JSON")} style={btn}>Copy Request</button>
            <button type="button" onClick={() => copy(result.responseText ?? "", "Response")} style={btn}>Copy Response</button>
            <button type="button" onClick={download} style={btn}>Download Diagnostic JSON</button>
          </div>
        </div>
      )}
    </div>
  );
}
