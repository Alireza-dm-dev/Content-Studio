import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBrandAccess } from "@/lib/brand-access";
import { isCollaboratorOnlyPost, COLLABORATOR_MANAGE_FORBIDDEN } from "@/lib/published-post-collaborators";
import { DOWNSTREAM_WARNING, acquireTrialLock, releaseTrialLock } from "@/lib/n8n-trial-webhook";
import { buildSavedPostTrialContext, executeTrial, trialConfigStatus } from "@/lib/n8n-trial-runner";
import { preparePublicMedia } from "@/lib/published-post-media-prepare";
import { isNonProductionDeliveryMode } from "@/lib/publishing-mode";

// Trial Send to n8n for a SAVED post.
//   GET   read-only preflight for the confirmation dialog (sends nothing)
//   POST  send the post's real outbound body to the configured TRIAL webhook
//
// Same permission as the manual production send: access to the post's OWNING
// brand (collaborator-only access is refused). The destination comes only from
// server Settings; the request body can only set { payloadOnly, uploadMedia,
// confirmFingerprint }. A trial never promotes the post, never changes its
// deliveryMode, schedule or status, and never calls a production or delete
// webhook.
//
// uploadMedia (Trial / Save Only posts whose media is not public yet): upload
// the missing media with the existing public media storage, persist the public
// URLs, then send the full-media trial. This is the ONLY database write a
// trial can cause, and it is explicitly confirmed.

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };
const json = (body, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

async function loadPost(id, postId) {
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
  if (!post.brand) return { response: json({ error: "Brand not found." }, 404) };
  return { post, brand: post.brand };
}

async function loadContext(params) {
  const { id, postId } = await params;
  const loaded = await loadPost(id, postId);
  if (loaded.response) return loaded;
  const ctx = await buildSavedPostTrialContext(loaded);
  if (ctx.error) return { response: json(ctx.error.body, ctx.error.status) };
  return { ...ctx, id };
}

/** Media recovery is offered only for Trial / Save Only posts with non-public media. */
const canUploadMedia = (ctx) => isNonProductionDeliveryMode(ctx.post.deliveryMode) && ctx.unavailableMedia.length > 0;

export async function GET(request, { params }) {
  const ctx = await loadContext(params);
  if (ctx.response) return ctx.response;
  return json({
    ...trialConfigStatus(ctx.config),
    fingerprint: ctx.fingerprint,
    warning: DOWNSTREAM_WARNING,
    summary: ctx.summary,
    unavailableMedia: ctx.unavailableMedia,
    blockedFields: ctx.blockedFields,
    deliveryMode: ctx.post.deliveryMode ?? null,
    canUploadMedia: canUploadMedia(ctx),
  });
}

export async function POST(request, { params }) {
  let payloadOnly = false;
  let uploadMedia = false;
  let confirmFingerprint = null;
  try {
    const body = await request.json();
    payloadOnly = body?.payloadOnly === true;
    uploadMedia = body?.uploadMedia === true;
    confirmFingerprint = typeof body?.confirmFingerprint === "string" ? body.confirmFingerprint : null;
    // Every other field (destination, payload, headers, …) is ignored.
  } catch {
    // no body → rejected below (a confirmation is required)
  }

  const ctx = await loadContext(params);
  if (ctx.response) return ctx.response;

  const status = trialConfigStatus(ctx.config);
  if (!status.ready) return json({ error: status.message, code: status.code }, 409);
  if (confirmFingerprint !== ctx.fingerprint) {
    return json({
      error: "The post or the trial configuration changed since this trial was confirmed (or it was not confirmed). Review the confirmation again. Nothing was sent.",
      code: "TRIAL_CONFIRMATION_STALE",
    }, 409);
  }

  if (!uploadMedia) {
    const r = await executeTrial(ctx, { payloadOnly });
    return json(r.body, r.status);
  }

  // ── Upload Media & Run Trial ────────────────────────────────────────────
  if (!canUploadMedia(ctx)) {
    return json({
      error: "Media upload is only available for Trial or Save Only posts whose media is not public yet. Nothing was uploaded or sent.",
      code: "TRIAL_MEDIA_UPLOAD_NOT_AVAILABLE",
    }, 409);
  }
  if (ctx.blockedFields.length) {
    return json({
      error: "The payload contains values that must not leave the server. Nothing was uploaded or sent.",
      code: "TRIAL_PAYLOAD_BLOCKED",
      blockedFields: ctx.blockedFields,
    }, 422);
  }
  // The lock covers the upload too, so two clicks cannot upload twice.
  if (!acquireTrialLock(ctx.post.id)) {
    return json({ error: "A trial for this post is already running.", code: "TRIAL_ALREADY_RUNNING" }, 409);
  }
  try {
    const prepared = await preparePublicMedia({ post: ctx.post, brand: ctx.brand, brandId: ctx.id, logPrefix: "[TrialMedia]" });
    if (prepared.notFound) return json({ error: "Published post not found." }, 404);
    if (!prepared.ok) {
      // The saved post is kept; no trial is sent with non-public media.
      return json({
        error: "The post is saved, but its media could not be uploaded to the public media server. No trial was sent.",
        code: "TRIAL_MEDIA_UPLOAD_FAILED",
        mediaUpload: prepared.failure,
      }, 503);
    }
    const fresh = await buildSavedPostTrialContext({ post: { ...prepared.post, brand: ctx.brand }, brand: ctx.brand });
    if (fresh.error) return json(fresh.error.body, fresh.error.status);
    if (fresh.unavailableMedia.length) {
      return json({
        error: "Media was uploaded, but some media URLs are still not public. No trial was sent.",
        code: "TRIAL_MEDIA_STILL_UNAVAILABLE",
        unavailableMedia: fresh.unavailableMedia,
        mediaUploaded: prepared.uploaded,
      }, 409);
    }
    // Same configuration the user confirmed, re-checked before transmission.
    const r = await executeTrial(fresh, { expectedConfigVersion: ctx.configVersion, lockHeld: true });
    return json({ ...r.body, mediaUploaded: prepared.uploaded }, r.status);
  } finally {
    releaseTrialLock(ctx.post.id);
  }
}
