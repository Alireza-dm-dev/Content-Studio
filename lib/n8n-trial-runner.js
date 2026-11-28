import { createHmac, randomBytes } from "node:crypto";
import { buildOutboundPublishBody, findNonPublicMediaFields } from "@/lib/published-post-webhook";
import { buildSchedulePresentation } from "@/lib/timezone";
import { canonicalJson } from "@/lib/publishing-mode";
import {
  DOWNSTREAM_WARNING,
  TRIAL_MODE_HEADER,
  TRIAL_ID_HEADER,
  readTrialConfig,
  validateTrialAuth,
  validateTrialDestination,
  parseTrialUrl,
  describeDestination,
  findSensitivePayloadFields,
  knownServerSecrets,
  acquireTrialLock,
  releaseTrialLock,
  sendPinnedRequest,
  interpretTrialOutcome,
  newTrialId,
} from "@/lib/n8n-trial-webhook";

// Shared trial execution (V1.3.56). Used by the saved-post Trial Send route,
// the create and adapt routes (Trial publishing mode) and media recovery.
// Every protection lives here or in lib/n8n-trial-webhook.js and is NOT
// re-implemented by callers: destination revalidation (production exclusion,
// SSRF, DNS pinning, TLS), Header Auth, payload scan, per-post lock, response
// cap, timeout, redirect blocking, secret redaction and the result format.
// Nothing here writes to the database or contacts a production webhook.

// Opaque confirmation tokens. HMAC with a per-process random key: a token
// reveals nothing about the trial secret and cannot be computed by a client.
// A restart invalidates outstanding confirmations (the user re-confirms).
// Kept on globalThis so every route bundle in the process shares one key.
const KEY = (globalThis.__contentStudioTrialConfirmKey ||= randomBytes(32));
const mac = (...parts) => createHmac("sha256", KEY).update(parts.join("\n")).digest("hex");

/**
 * Opaque version of the EFFECTIVE trial configuration, including the header
 * secret: replacing the secret (or any other setting) changes it.
 */
export function trialConfigVersion(config) {
  return mac("config", JSON.stringify([config.url || "", config.authMode || "none", config.headerName || "", config.headerValue || ""])).slice(0, 32);
}

/** Saved-post confirmation: the exact outbound body + the effective config. */
export function savedPostTrialFingerprint(body, config) {
  return mac("saved-post", trialConfigVersion(config), body).slice(0, 32);
}

/** New-post (upload/adapt) confirmation: the effective config + the bound form state. */
export function trialUploadToken(configVersion, binding) {
  return mac("upload", configVersion, canonicalJson(binding)).slice(0, 48);
}

/** Syntax-level config status for dialogs (DNS is checked separately). Never includes the URL. */
export function trialConfigStatus(config) {
  if (!config.url) {
    return { configured: false, ready: false, code: "TRIAL_NOT_CONFIGURED", message: "Trial webhook is not configured." };
  }
  const parsed = parseTrialUrl(config.url);
  if (!parsed.ok) return { configured: true, ready: false, code: parsed.code, message: "The trial webhook configuration is invalid. Ask an administrator to check Settings → n8n Webhooks." };
  const auth = validateTrialAuth(config);
  if (!auth.ok) return { configured: true, ready: false, code: auth.code, message: "The trial webhook authentication is incomplete. Ask an administrator to check Settings → n8n Webhooks." };
  return { configured: true, ready: true, destinationType: describeDestination(parsed.url), authMode: config.authMode };
}

export async function readTrialReadiness() {
  const config = await readTrialConfig();
  return { config, status: trialConfigStatus(config), configVersion: trialConfigVersion(config) };
}

/**
 * Everything a trial of a SAVED post needs: the outbound body (same builder as
 * production), the payload scan, the confirmation fingerprint and the summary.
 * `post` must include `media`; `brand` is the OWNING brand.
 */
export async function buildSavedPostTrialContext({ post, brand }) {
  const built = buildOutboundPublishBody({
    post,
    media: post.media || [],
    brandName: brand.name,
    brandTimezone: brand.timezone,
  });
  if (!built.ok) return { error: { status: 500, body: { error: built.error, code: built.code } } };

  const config = await readTrialConfig();
  // The stored header secret is redacted from responses even when auth is off.
  const secrets = config.headerValue ? [config.headerValue] : [];
  // Scan BOTH the canonical payload and the final adapted body that is sent.
  const scanSecrets = [...(await knownServerSecrets()), ...secrets];
  const seen = new Set();
  const blockedFields = [
    ...findSensitivePayloadFields(built.canonical, { extraSecrets: scanSecrets }),
    ...findSensitivePayloadFields(built.payload, { extraSecrets: scanSecrets }),
  ].filter((f) => (seen.has(`${f.field}|${f.reason}`) ? false : seen.add(`${f.field}|${f.reason}`)));

  return {
    fingerprint: savedPostTrialFingerprint(built.body, config),
    configVersion: trialConfigVersion(config),
    post,
    brand,
    built,
    config,
    secrets,
    summary: {
      postId: built.payload["Post ID"] ?? post.id,
      platform: post.platform || "Instagram",
      brandName: brand.name,
      schedule: buildSchedulePresentation(post.scheduledDate, brand.timezone ?? null),
      n8nScheduledDate: built.payload["Scheduled Date"] ?? "",
    },
    unavailableMedia: findNonPublicMediaFields(built.payload).map(({ field }) => field),
    blockedFields,
  };
}

/**
 * Run a trial for a prepared context. Returns { status, body } where body is
 * either { result } (a request was sent) or { error, code, ... } (nothing sent).
 *
 *   payloadOnly            the user confirmed sending non-public media URLs as-is
 *   expectedConfigVersion  the config the user confirmed; a different current
 *                          config refuses the trial (nothing sent)
 *   lockHeld               the caller already holds this post's trial lock
 */
export async function executeTrial(ctx, { payloadOnly = false, expectedConfigVersion = null, lockHeld = false } = {}) {
  const { post, built, config, secrets, summary, unavailableMedia, blockedFields, configVersion } = ctx;

  const status = trialConfigStatus(config);
  if (!status.ready) return { status: 409, body: { error: status.message, code: status.code } };
  if (expectedConfigVersion !== null && expectedConfigVersion !== configVersion) {
    return {
      status: 409,
      body: { error: "Trial not sent because the trial configuration changed.", code: "TRIAL_CONFIG_CHANGED" },
    };
  }

  // Revalidate the destination NOW (production settings may have changed).
  const dest = await validateTrialDestination(config.url);
  if (!dest.ok) return { status: 409, body: { error: `${dest.error} Nothing was sent.`, code: dest.code } };
  if (blockedFields.length) {
    return {
      status: 422,
      body: { error: "The payload contains values that must not leave the server. Nothing was sent.", code: "TRIAL_PAYLOAD_BLOCKED", blockedFields },
    };
  }
  if (unavailableMedia.length && !payloadOnly) {
    return {
      status: 409,
      body: {
        error: "Some media has no public URL yet, so a full media test is not possible. Confirm a payload-only trial to continue.",
        code: "PAYLOAD_ONLY_CONFIRMATION_REQUIRED",
        unavailableMedia,
      },
    };
  }
  if (!lockHeld && !acquireTrialLock(post.id)) {
    return { status: 409, body: { error: "A trial for this post is already running.", code: "TRIAL_ALREADY_RUNNING" } };
  }

  const trialId = newTrialId();
  const startedAt = new Date();
  const t0 = Date.now();
  let outcome;
  try {
    const headers = { [TRIAL_MODE_HEADER]: "trial", [TRIAL_ID_HEADER]: trialId };
    if (config.authMode === "header") headers[config.headerName] = config.headerValue;
    const raw = await sendPinnedRequest({ url: dest.url, address: dest.address, family: dest.family, headers, body: built.body });
    outcome = interpretTrialOutcome(raw, { secrets });
  } finally {
    if (!lockHeld) releaseTrialLock(post.id);
  }
  const durationMs = Date.now() - t0;

  console.log("[TrialSend] completed", {
    postId: post.id,
    trialId,
    host: dest.url.host,
    outcome: outcome.outcome,
    httpStatus: outcome.httpStatus ?? null,
    durationMs,
    payloadOnly: unavailableMedia.length > 0,
  });

  return {
    status: 200,
    body: {
      result: {
        trialId,
        startedAt: startedAt.toISOString(),
        durationMs,
        destinationType: dest.destinationType,
        ...summary,
        payloadOnly: unavailableMedia.length > 0,
        unavailableMedia,
        ...outcome,
        // The exact serialized body this trial sent (same builder as production).
        requestBody: built.body,
      },
    },
  };
}

/**
 * Before a Trial-mode create/adapt SAVES anything: the trial must be configured,
 * the confirmation token must match the current config AND the actual request,
 * and the destination must pass validation. Returns { ok, configVersion } or
 * { ok: false, status, body } (nothing saved, nothing sent).
 */
export async function verifyTrialSubmission({ binding, token }) {
  const { config, status, configVersion } = await readTrialReadiness();
  if (!status.ready) {
    return { ok: false, status: 409, body: { error: `${status.message} Nothing was saved.`, code: status.code } };
  }
  if (typeof token !== "string" || token !== trialUploadToken(configVersion, binding)) {
    return {
      ok: false,
      status: 409,
      body: {
        error: "The post or the trial configuration changed since this trial was confirmed (or it was not confirmed). Review the confirmation again. Nothing was saved.",
        code: "TRIAL_CONFIRMATION_STALE",
      },
    };
  }
  const dest = await validateTrialDestination(config.url);
  if (!dest.ok) return { ok: false, status: 409, body: { error: `${dest.error} Nothing was saved.`, code: dest.code } };
  return { ok: true, configVersion };
}

/**
 * After a Trial-mode create/adapt saved the post and prepared its media: send
 * the saved post to the trial webhook. Returns the `trial` block of the
 * response: { sent, code?, error?, result? }. Never throws for a send problem.
 */
export async function runTrialForSavedPost({ post, brand, configVersion }) {
  try {
    const ctx = await buildSavedPostTrialContext({ post, brand });
    if (ctx.error) return { sent: false, ...ctx.error.body };
    const r = await executeTrial(ctx, { payloadOnly: false, expectedConfigVersion: configVersion });
    if (r.body.result) return { sent: true, result: r.body.result };
    const message = r.body.code === "TRIAL_CONFIG_CHANGED"
      ? "Post saved. Trial not sent because the trial configuration changed."
      : `Post saved. Trial not sent: ${r.body.error}`;
    return { sent: false, ...r.body, error: message };
  } catch (error) {
    console.error("[TrialSend] trial after save failed", { postId: post?.id, error: error?.message });
    return { sent: false, code: "TRIAL_FAILED", error: "Post saved. The trial could not be run." };
  }
}

export { DOWNSTREAM_WARNING };
