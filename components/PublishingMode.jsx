"use client";

import { useEffect, useRef, useState } from "react";
import { newSubmissionId } from "@/components/publishing-mode-submit";
import {
  PUBLISHING_MODE_PRODUCTION,
  PUBLISHING_MODE_TRIAL,
  PUBLISHING_MODE_SAVE_ONLY,
  TRIAL_UPLOAD_WARNING,
} from "@/lib/publishing-mode";

// Per-post Publishing Mode for the upload and adaptation forms (V1.3.56).
//
//   const pm = usePublishingMode(brandId);   // default Production, per form
//   <PublishingModeSelector pm={pm} disabled={busy} />
//   const token = await pm.confirmTrial({ binding, summary });  // Trial only
//   {pm.dialog}
//
// The form is mounted fresh for every new post, so the mode always starts at
// Production and a previous Trial selection is never carried over. Trial is
// disabled (never silently switched to Production) when no trial webhook is
// configured; the server enforces the same rule independently.

const mono = { fontFamily: "var(--font-mono-ink)", fontSize: 10, letterSpacing: "0.06em", lineHeight: 1.5 };
const lbl = { ...mono, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--sketch-ink-faint)" };
const btn = {
  ...mono,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  padding: "4px 10px",
  border: "1px solid var(--sketch-ink)",
  background: "transparent",
  color: "var(--sketch-ink-soft)",
  cursor: "pointer",
};

export const MODE_OPTIONS = [
  { value: PUBLISHING_MODE_PRODUCTION, label: "Production", hint: "Save, upload media and send to the production n8n webhook." },
  { value: PUBLISHING_MODE_TRIAL, label: "Trial", hint: "Save, upload media and send ONLY to the n8n trial webhook. Edits never auto-send to production." },
  { value: PUBLISHING_MODE_SAVE_ONLY, label: "Save Only", hint: "Save the post. No media upload, no webhook. Send it later from the post." },
];

/** Mode-specific submit label. labels: { production, trial, save_only }. */
export function modeSubmitLabel(mode, labels) {
  return labels[mode] || labels[PUBLISHING_MODE_PRODUCTION];
}

export function usePublishingMode(brandId) {
  const [mode, setMode] = useState(PUBLISHING_MODE_PRODUCTION);
  // One submission id per opened form: a repeated or retried submit of the
  // same form is recognised by the server and never saved/sent twice.
  const [submissionId] = useState(newSubmissionId);
  const [trialStatus, setTrialStatus] = useState(null); // { ready, message, code, destinationType }
  const [dialogState, setDialogState] = useState(null); // { summary, phase, info, error }
  const resolver = useRef(null);

  useEffect(() => {
    let alive = true;
    if (!brandId) return undefined;
    fetch(`/api/brands/${brandId}/trial-confirmation`, { cache: "no-store" })
      .then((r) => r.json().catch(() => null))
      .then((b) => { if (alive) setTrialStatus(b && typeof b.ready === "boolean" ? b : { ready: false, message: "Trial availability could not be checked." }); })
      .catch(() => { if (alive) setTrialStatus({ ready: false, message: "Trial availability could not be checked." }); });
    return () => { alive = false; };
  }, [brandId]);

  // Never leave a pending confirmation promise behind on unmount.
  useEffect(() => () => { resolver.current?.(null); resolver.current = null; }, []);

  const trialAvailable = trialStatus?.ready === true;

  function finish(token) {
    const r = resolver.current;
    resolver.current = null;
    setDialogState(null);
    r?.(token);
  }

  /**
   * Opens the confirmation; resolves to an opaque token (Confirm) or null
   * (Cancel / not available). The token is requested fresh for THIS binding,
   * so a previous confirmation can never be reused for changed form state.
   */
  async function confirmTrial({ binding, summary }) {
    resolver.current?.(null);
    const promise = new Promise((resolve) => { resolver.current = resolve; });
    setDialogState({ summary, phase: "loading" });
    try {
      const res = await fetch(`/api/brands/${brandId}/trial-confirmation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ binding }),
      });
      const b = await res.json().catch(() => null);
      if (!res.ok || !b?.token) {
        setTrialStatus((prev) => (b && b.ready === false ? { ...prev, ...b } : prev));
        setDialogState({ summary, phase: "error", error: b?.message || b?.error || `Trial is unavailable (HTTP ${res.status}). Nothing was saved.` });
      } else {
        setDialogState({ summary, phase: "ready", info: b });
      }
    } catch {
      setDialogState({ summary, phase: "error", error: "Could not prepare the trial (network error). Nothing was saved." });
    }
    return promise;
  }

  const dialog = dialogState ? (
    <TrialUploadConfirmDialog
      state={dialogState}
      onCancel={() => finish(null)}
      onConfirm={() => finish(dialogState.info?.token ?? null)}
    />
  ) : null;

  return { mode, setMode, trialStatus, trialAvailable, confirmTrial, dialog, submissionId };
}

export function PublishingModeSelector({ pm, disabled = false }) {
  const { mode, setMode, trialStatus, trialAvailable } = pm;
  // A Trial selection whose configuration disappeared is NOT switched to
  // Production: the submit stays blocked until the user picks a mode.
  const current = MODE_OPTIONS.find((o) => o.value === mode);
  return (
    <div data-testid="publishing-mode">
      <div style={{ ...lbl, marginBottom: 4 }} id="publishing-mode-label">Publishing Mode</div>
      <div role="radiogroup" aria-labelledby="publishing-mode-label" style={{ display: "flex", flexWrap: "wrap", gap: 0 }}>
        {MODE_OPTIONS.map((o) => {
          const isTrial = o.value === PUBLISHING_MODE_TRIAL;
          const optionDisabled = disabled || (isTrial && !trialAvailable);
          const selected = mode === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              data-mode={o.value}
              disabled={optionDisabled}
              onClick={() => setMode(o.value)}
              style={{
                ...btn,
                flex: "1 1 0",
                minWidth: 90,
                marginLeft: -1,
                padding: "6px 10px",
                borderColor: selected ? "var(--sketch-vermilion)" : "var(--sketch-line)",
                background: selected ? "var(--sketch-vermilion)" : "var(--sketch-paper-bright)",
                color: selected ? "var(--sketch-paper-bright)" : "var(--sketch-ink-soft)",
                opacity: optionDisabled && !selected ? 0.45 : 1,
                cursor: optionDisabled ? "not-allowed" : "pointer",
                position: "relative",
                zIndex: selected ? 1 : 0,
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <div style={{ ...mono, color: "var(--sketch-ink-soft)", marginTop: 4 }} data-testid="publishing-mode-hint">
        Selected: <strong>{current?.label}</strong> — {current?.hint}
      </div>
      {trialStatus && !trialAvailable && (
        <div style={{ ...mono, color: "var(--sketch-ink-faint)", marginTop: 2 }} data-testid="trial-mode-unavailable">
          {trialStatus.message || "Trial webhook is not configured."}
          {(trialStatus.code === "TRIAL_NOT_CONFIGURED" || !trialStatus.configured) && (
            <> Configure it in <a href="/settings" style={{ color: "inherit" }}>Settings → n8n Webhooks</a>.</>
          )}
        </div>
      )}
      {mode === PUBLISHING_MODE_TRIAL && trialStatus && !trialAvailable && (
        <div role="alert" style={{ ...mono, color: "var(--sketch-vermilion)", marginTop: 2 }}>
          Trial is no longer available. Choose another publishing mode.
        </div>
      )}
    </div>
  );
}

function Row({ label, value }) {
  if (value == null || value === "") return null;
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", ...mono }}>
      <span style={{ textTransform: "uppercase", color: "var(--sketch-ink-faint)", minWidth: 140 }}>{label}</span>
      <span style={{ color: "var(--sketch-ink)", overflowWrap: "anywhere", minWidth: 0 }}>{String(value)}</span>
    </div>
  );
}

function TrialUploadConfirmDialog({ state, onCancel, onConfirm }) {
  const { summary = {}, phase, info, error } = state;
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="Confirm trial upload"
        data-testid="trial-upload-confirm"
        style={{ background: "var(--sketch-paper-bright)", border: "2px solid var(--sketch-ink)", padding: 14, width: "100%", maxWidth: 520, maxHeight: "90vh", overflow: "auto", display: "flex", flexDirection: "column", gap: 6, boxSizing: "border-box" }}
      >
        <div style={{ ...mono, textTransform: "uppercase", color: "var(--sketch-ink)", fontSize: 11 }}>Upload &amp; run trial?</div>
        <Row label="Owning Brand" value={summary.brandName || info?.brandName || (phase === "loading" ? "Checking…" : null)} />
        <Row label="Platform" value={summary.platform} />
        <Row label="Post type" value={summary.postType} />
        <Row label="Schedule" value={summary.schedule || "Not scheduled"} />
        {summary.source && <Row label="Adapted from" value={summary.source} />}
        <Row label="Trial destination" value={phase === "ready" ? info?.destinationType : phase === "loading" ? "Checking…" : "—"} />
        <div style={{ ...mono, color: "var(--sketch-ink)" }}>
          The post is saved first. Its media is then uploaded to the existing public media server (the social post itself is not published) so n8n can fetch the real files, and the saved post is sent to the trial webhook only. A later production send reuses the uploaded media. Nothing is sent to the production webhook, and editing this post later will not send it to production.
        </div>
        <div style={{ ...mono, color: "var(--sketch-vermilion)" }} data-testid="trial-upload-warning">{info?.warning || TRIAL_UPLOAD_WARNING}</div>
        {phase === "error" && <div role="alert" style={{ ...mono, color: "var(--sketch-vermilion)" }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          <button type="button" onClick={onCancel} style={btn} autoFocus>Cancel</button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={phase !== "ready"}
            style={{ ...btn, borderColor: "var(--sketch-vermilion)", color: "var(--sketch-vermilion)", opacity: phase === "ready" ? 1 : 0.5, cursor: phase === "ready" ? "pointer" : "not-allowed" }}
          >
            Confirm &amp; Run Trial
          </button>
        </div>
      </div>
    </div>
  );
}
