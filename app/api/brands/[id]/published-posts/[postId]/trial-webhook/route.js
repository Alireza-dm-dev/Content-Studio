import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBrandAccess } from "@/lib/brand-access";
import { isCollaboratorOnlyPost, COLLABORATOR_MANAGE_FORBIDDEN } from "@/lib/published-post-collaborators";
import { buildOutboundPublishBody, findNonPublicMediaFields } from "@/lib/published-post-webhook";
import { buildSchedulePresentation } from "@/lib/timezone";
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

// Trial Send to n8n for a SAVED post.
//   GET   read-only preflight for the confirmation dialog (sends nothing)
//   POST  send the post's real outbound body to the configured TRIAL webhook
//
// Same permission as the manual production send: access to the post's OWNING
// brand (collaborator-only access is refused). The destination comes only from
// server Settings; the request body can only set { payloadOnly: true }.
// Nothing is written: no DB update, no media upload, no retention, no
// production or delete webhook.

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };
const json = (body, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

async function loadContext(params) {
  const { id, postId } = await params;
  const access = await requireBrandAccess(id);
  if (!access.ok) return { response: json({ error: access.error }, access.status) };

  const post = await prisma.publishedPost.findUnique({
    where: { id: postId },
    include: {
      media: { orderBy: { order: "asc" } },
      brand: { select: { id: true, name: true, timezone: true } },
    },
  });
  if (!post || post.brandId !== id) {
    if (post && (await isCollaboratorOnlyPost(id, postId))) {
      return { response: json({ error: COLLABORATOR_MANAGE_FORBIDDEN }, 403) };
    }
    return { response: json({ error: "Published post not found." }, 404) };
  }
  const brand = post.brand;
  if (!brand) return { response: json({ error: "Brand not found." }, 404) };

  const built = buildOutboundPublishBody({
    post,
    media: post.media || [],
    brandName: brand.name,
    brandTimezone: brand.timezone,
  });
  if (!built.ok) return { response: json({ error: built.error, code: built.code }, 500) };

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
  // Binds a confirmation to the exact body and trial configuration it showed.
  const fingerprint = createHash("sha256")
    .update([built.body, config.url, config.authMode, config.headerName].join("\n"))
    .digest("hex")
    .slice(0, 32);
  return {
    fingerprint,
    id,
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

/** Syntax-level config status for the dialog (DNS is checked at send time). */
function configStatus(config) {
  if (!config.url) {
    return { configured: false, ready: false, code: "TRIAL_NOT_CONFIGURED", message: "Trial webhook is not configured." };
  }
  const parsed = parseTrialUrl(config.url);
  if (!parsed.ok) return { configured: true, ready: false, code: parsed.code, message: "The trial webhook configuration is invalid. Ask an administrator to check Settings → n8n Webhooks." };
  const auth = validateTrialAuth(config);
  if (!auth.ok) return { configured: true, ready: false, code: auth.code, message: "The trial webhook authentication is incomplete. Ask an administrator to check Settings → n8n Webhooks." };
  return { configured: true, ready: true, destinationType: describeDestination(parsed.url), authMode: config.authMode };
}

export async function GET(request, { params }) {
  const ctx = await loadContext(params);
  if (ctx.response) return ctx.response;
  return json({
    ...configStatus(ctx.config),
    fingerprint: ctx.fingerprint,
    warning: DOWNSTREAM_WARNING,
    summary: ctx.summary,
    unavailableMedia: ctx.unavailableMedia,
    blockedFields: ctx.blockedFields,
  });
}

export async function POST(request, { params }) {
  let payloadOnly = false;
  let confirmFingerprint = null;
  try {
    const body = await request.json();
    payloadOnly = body?.payloadOnly === true;
    confirmFingerprint = typeof body?.confirmFingerprint === "string" ? body.confirmFingerprint : null;
    // Every other field (destination, payload, headers, …) is ignored.
  } catch {
    // no body → rejected below (a confirmation is required)
  }

  const ctx = await loadContext(params);
  if (ctx.response) return ctx.response;
  const { post, built, config, secrets, summary, unavailableMedia, blockedFields, fingerprint } = ctx;

  const status = configStatus(config);
  if (!status.ready) return json({ error: status.message, code: status.code }, 409);
  if (confirmFingerprint !== fingerprint) {
    return json({
      error: "The post or the trial configuration changed since this trial was confirmed (or it was not confirmed). Review the confirmation again. Nothing was sent.",
      code: "TRIAL_CONFIRMATION_STALE",
    }, 409);
  }

  // Revalidate the destination NOW (production settings may have changed).
  const dest = await validateTrialDestination(config.url);
  if (!dest.ok) {
    return json({ error: `${dest.error} Nothing was sent.`, code: dest.code }, 409);
  }
  if (blockedFields.length) {
    return json({
      error: "The payload contains values that must not leave the server. Nothing was sent.",
      code: "TRIAL_PAYLOAD_BLOCKED",
      blockedFields,
    }, 422);
  }
  if (unavailableMedia.length && !payloadOnly) {
    return json({
      error: "Some media has no public URL yet, so a full media test is not possible. Confirm a payload-only trial to continue.",
      code: "PAYLOAD_ONLY_CONFIRMATION_REQUIRED",
      unavailableMedia,
    }, 409);
  }
  if (!acquireTrialLock(post.id)) {
    return json({ error: "A trial for this post is already running.", code: "TRIAL_ALREADY_RUNNING" }, 409);
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
    releaseTrialLock(post.id);
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

  return json({
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
  });
}
