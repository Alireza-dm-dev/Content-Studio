import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminAccess } from "@/lib/auth";
import { getN8nWebhookUrlStatus } from "@/lib/published-post-webhook";
import { getPublishedPostDeleteWebhookUrlStatus } from "@/lib/published-post-delete-webhook";
import {
  TRIAL_URL_KEY,
  TRIAL_AUTH_MODE_KEY,
  TRIAL_HEADER_NAME_KEY,
  TRIAL_HEADER_VALUE_KEY,
  DOWNSTREAM_WARNING,
  readTrialConfig,
  validateTrialAuth,
  validateTrialDestination,
  validateHeaderValue,
  validateHeaderName,
  describeDestination,
  maskTrialUrl,
} from "@/lib/n8n-trial-webhook";

// Admin-only n8n webhook configuration.
//   GET  production publish/delete status (never the URLs) + masked trial config
//   PUT  configure / replace / clear the trial webhook and its header auth
// The trial header secret is write-only: it is never returned by any endpoint.

function hostKey(raw) {
  if (!raw) return null;
  try {
    return new URL(raw).host.toLowerCase().replace(/\.(?=(:\d+)?$)/, "");
  } catch {
    return null;
  }
}

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };
const json = (body, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

async function statusBody() {
  const [publish, del, trial] = await Promise.all([
    getN8nWebhookUrlStatus(),
    getPublishedPostDeleteWebhookUrlStatus(),
    readTrialConfig(),
  ]);
  let destinationType = null;
  if (trial.url) {
    try {
      destinationType = describeDestination(new URL(trial.url));
    } catch {
      destinationType = null;
    }
  }
  return {
    production: { publish, delete: del },
    trial: {
      configured: Boolean(trial.url),
      maskedUrl: trial.url ? maskTrialUrl(trial.url) : null,
      destinationType,
      authMode: trial.authMode,
      headerName: trial.authMode === "header" || trial.headerName ? trial.headerName || null : null,
      secretConfigured: Boolean(trial.headerValue),
      warning: DOWNSTREAM_WARNING,
    },
  };
}

export async function GET() {
  const access = await getAdminAccess();
  if (!access.user) return json({ error: access.error }, access.status);
  return json(await statusBody());
}

/**
 * Body (every field optional; omitted = keep current):
 *   url          string  — "" clears the trial webhook
 *   authMode     "none" | "header"
 *   headerName   string
 *   secret       string  — non-empty replaces the stored secret
 *   clearSecret  true    — removes the stored secret
 * The merged (effective) configuration is validated as a whole and written in
 * one transaction; nothing is saved when any part is invalid.
 */
export async function PUT(request) {
  const access = await getAdminAccess();
  if (!access.user) return json({ error: access.error }, access.status);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid request body." }, 400);

  const current = await readTrialConfig();
  const next = { ...current };

  if ("url" in body) {
    if (body.url !== null && typeof body.url !== "string") return json({ error: "url must be a string.", field: "url" }, 400);
    next.url = (body.url || "").trim();
  }
  if ("authMode" in body) next.authMode = body.authMode;
  if ("headerName" in body) {
    if (body.headerName !== null && typeof body.headerName !== "string") return json({ error: "headerName must be a string.", field: "headerName" }, 400);
    next.headerName = body.headerName || "";
  }
  if (body.clearSecret === true) next.headerValue = "";
  if ("secret" in body && body.secret !== "" && body.secret != null) {
    if (body.clearSecret === true) return json({ error: "Either replace or clear the secret, not both.", field: "secret" }, 400);
    const v = validateHeaderValue(body.secret);
    if (!v.ok) return json({ error: v.error, code: v.code, field: v.field }, 400);
    next.headerValue = body.secret;
  }

  const auth = validateTrialAuth(next);
  if (!auth.ok) return json({ error: auth.error, code: auth.code, field: auth.field }, 400);
  // A header name is only kept when it is valid, even if auth is currently off.
  if (next.authMode === "none" && next.headerName) {
    const n = validateHeaderName(next.headerName);
    if (!n.ok) return json({ error: n.error, code: n.code, field: n.field }, 400);
  }
  // Never forward a stored secret to a different destination host: when the
  // host (or port) changes — or a URL is set while a secret is stored without
  // one — the secret must be re-entered (or removed) in the same request.
  const secretEnteredNow = typeof body.secret === "string" && body.secret !== "";
  const reusesStoredSecret = Boolean(next.headerValue) && !secretEnteredNow;
  if (next.authMode === "header" && next.url && reusesStoredSecret && hostKey(current.url) !== hostKey(next.url)) {
    return json({
      error: "The trial destination host changed. Re-enter the header secret (or remove it) so the stored secret is not sent to a different host.",
      code: "TRIAL_SECRET_REENTRY_REQUIRED",
      field: "secret",
    }, 400);
  }
  if (next.url) {
    const dest = await validateTrialDestination(next.url);
    if (!dest.ok) return json({ error: dest.error, code: dest.code, field: dest.field }, 400);
  }

  const write = (key, value) =>
    value
      ? prisma.settings.upsert({ where: { key }, update: { value, updatedAt: new Date() }, create: { key, value, updatedAt: new Date() } })
      : prisma.settings.deleteMany({ where: { key } });
  const ops = [];
  if (next.url !== current.url) ops.push(write(TRIAL_URL_KEY, next.url));
  if (next.authMode !== current.authMode) ops.push(write(TRIAL_AUTH_MODE_KEY, next.authMode === "header" ? "header" : ""));
  if (next.headerName !== current.headerName) ops.push(write(TRIAL_HEADER_NAME_KEY, next.headerName));
  if (next.headerValue !== current.headerValue) ops.push(write(TRIAL_HEADER_VALUE_KEY, next.headerValue));
  if (ops.length) await prisma.$transaction(ops);

  console.log("[TrialWebhookSettings] updated", {
    by: access.user.id,
    urlChanged: next.url !== current.url,
    authMode: next.authMode,
    secretChanged: next.headerValue !== current.headerValue,
  });
  return json(await statusBody());
}
