"use client";

import { toast } from "sonner";
import {
  PUBLISHING_MODE_TRIAL,
  PUBLISHING_MODE_SAVE_ONLY,
  uploadTrialBinding,
  adaptTrialBinding,
} from "@/lib/publishing-mode";

// Shared submit plumbing for the per-post Publishing Mode (upload forms and
// the adaptation modal). Trial always goes through an explicit confirmation
// whose token is bound to the exact request being sent.

const TRIAL_UNAVAILABLE = "Trial webhook is not configured. Choose another publishing mode.";
const DIGEST_UNAVAILABLE = "Trial needs a secure (HTTPS) connection to fingerprint the files. Nothing was saved.";

/** One id per intended submission (the server de-duplicates repeats of it). */
export function newSubmissionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

async function bindingOrNull(make) {
  try {
    return await make();
  } catch {
    return null;
  }
}

/** Upload forms (multipart). Mutates fd. Resolves { ok } or { ok: false, error? } (cancelled). */
export async function appendPublishingMode(fd, pm, { brandId, summary }) {
  if (pm.mode === PUBLISHING_MODE_TRIAL) {
    if (!pm.trialAvailable) return { ok: false, error: TRIAL_UNAVAILABLE };
    const binding = await bindingOrNull(() => uploadTrialBinding(brandId, fd));
    if (!binding) return { ok: false, error: DIGEST_UNAVAILABLE };
    const token = await pm.confirmTrial({ binding, summary });
    if (!token) return { ok: false };
    fd.append("publishingMode", PUBLISHING_MODE_TRIAL);
    fd.append("trialConfirmation", token);
  } else {
    fd.append("publishingMode", pm.mode);
  }
  if (pm.submissionId) fd.append("submissionId", pm.submissionId);
  return { ok: true };
}

/** Adaptation (JSON body). Mutates body. Same contract as appendPublishingMode. */
export async function addAdaptPublishingMode(body, pm, { brandId, sourcePostId, summary }) {
  delete body.sendToN8n; // publishingMode is authoritative; never send both
  if (pm.mode === PUBLISHING_MODE_TRIAL) {
    if (!pm.trialAvailable) return { ok: false, error: TRIAL_UNAVAILABLE };
    const binding = await bindingOrNull(() => adaptTrialBinding(brandId, sourcePostId, body));
    if (!binding) return { ok: false, error: DIGEST_UNAVAILABLE };
    const token = await pm.confirmTrial({ binding, summary });
    if (!token) return { ok: false };
    body.publishingMode = PUBLISHING_MODE_TRIAL;
    body.trialConfirmation = token;
  } else {
    body.publishingMode = pm.mode;
  }
  if (pm.submissionId) body.submissionId = pm.submissionId;
  return { ok: true };
}

/**
 * Trial / Save Only create responses. Returns true when handled (the caller
 * stops), false for Production (the caller keeps its existing handling).
 * onCreated(post, { publishingMode, trial }) lets the section open the saved
 * post's detail modal with the trial result.
 */
export function handleModeResult(data, { setError, onCreated, createdPost }) {
  // A repeat of an already-processed submission (e.g. resent after a lost
  // response): nothing new was created or sent. Show the saved post if any.
  if (data?.duplicateSubmission) {
    const msg = data.submission?.message || "This submission was already processed. Nothing was created or sent again.";
    toast.info(msg);
    if (data.post) onCreated(data.post, { publishingMode: data.publishingMode ?? null });
    else setError?.(msg);
    return true;
  }
  const mode = data?.publishingMode;
  if (mode === PUBLISHING_MODE_SAVE_ONLY) {
    toast.success("Post saved (Save Only). Nothing was sent to n8n.");
    onCreated(createdPost, { publishingMode: mode });
    return true;
  }
  if (mode === PUBLISHING_MODE_TRIAL) {
    const t = data.trial;
    if (t?.sent && t.result) {
      const r = t.result;
      const msg = `Post saved. Trial: ${r.label}${r.httpStatus ? ` (HTTP ${r.httpStatus})` : ""}. The post was not published or sent to production.`;
      if (r.outcome === "http_accepted" || r.outcome === "response_truncated") toast.success(msg);
      else toast.warning(msg);
    } else {
      const msg = t?.error || "Post saved. The trial was not sent.";
      toast.warning(msg);
      setError?.(msg);
    }
    onCreated(createdPost, { publishingMode: mode, trial: t || null });
    return true;
  }
  return false;
}
