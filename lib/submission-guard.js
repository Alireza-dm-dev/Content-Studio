import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canonicalJson } from "@/lib/publishing-mode";
import { sha256Hex } from "@/lib/content-digest";
import {
  submissionScopeKey,
  reserveSubmission,
  finishSubmission,
  pruneExpiredSubmissions,
} from "@/lib/submission-receipt";

// Duplicate-submission protection for Published Post create / adapt (V1.3.56).
//
// The client sends one `submissionId` per intended submission. The id is
// scoped to (authenticated user, owning Brand, operation, source post) and
// bound to a digest of the WHOLE request (every field; file contents by
// SHA-256). The DATABASE receipt (lib/submission-receipt.js) is authoritative:
//   same id + same request   → never a second post or webhook; the existing
//                              result or an accurate status is returned
//   same id + other request  → 409 SUBMISSION_ID_REUSED
//   still running elsewhere  → 409 SUBMISSION_IN_PROGRESS
//   no id (existing clients) → unchanged behaviour
// Within one process, concurrent duplicates additionally wait for the first
// to finish (convenience only; correctness never depends on memory).
// Nothing is ever retried or resent automatically. Callers run this AFTER
// authenticating the user and authorizing the Brand (and the source post).

const ID_RE = /^[A-Za-z0-9_-]{8,100}$/;
const IN_FLIGHT = (globalThis.__contentStudioSubmissionsInFlight ||= new Map());

const isFileLike = (v) => v && typeof v === "object" && typeof v.arrayBuffer === "function" && typeof v.size === "number";

/** Digest of a multipart request: every field except submissionId; files by content. */
export async function formDataFingerprint(formData) {
  const fields = [];
  for (const [key, value] of formData.entries()) {
    if (key === "submissionId") continue;
    fields.push([key, isFileLike(value)
      ? { file: value.name, size: value.size, sha256: await sha256Hex(await value.arrayBuffer()) }
      : String(value).replace(/\r\n?/g, "\n")]);
  }
  return sha256Hex(canonicalJson(fields));
}

/** Digest of a JSON request body: every field except submissionId; base64 file content hashed. */
export async function jsonBodyFingerprint(body) {
  const copy = { ...(body || {}) };
  delete copy.submissionId;
  if (Array.isArray(copy.files)) {
    copy.files = await Promise.all(copy.files.map(async (f) => ({
      name: f?.name ?? "", type: f?.type ?? "",
      sha256: typeof f?.content === "string" ? await sha256Hex(f.content) : null,
    })));
  }
  return sha256Hex(canonicalJson(copy));
}

const MESSAGES = {
  completed: "This submission was already completed. No new post was created and nothing was sent again.",
  notRetained: "This submission was already completed, but its post is no longer kept (for example, LinkedIn retention removed it). Nothing was created or sent again.",
  savedUncertain: "This submission saved the post, but its production send result was never recorded: n8n may have received it. Nothing was resent. Check n8n before using Send to n8n on the saved post.",
  savedIncomplete: "This submission saved the post but did not finish. Nothing was resent automatically. Continue from the saved post (Send to n8n, or Upload Media & Run Trial).",
  inProgress: "This submission is still being processed. Nothing was started again; wait for it to finish.",
  reused: "This submission ID was already used for a different request. Nothing was saved or sent. Close and reopen the form to submit a new post.",
};

/** Answer a duplicate from the durable receipt, after the caller re-authorized. */
async function existingSubmissionResponse(receipt, { brandId, brandTimezone }) {
  if (receipt.state === "processing" && !receipt.postId) {
    return NextResponse.json({ error: MESSAGES.inProgress, code: "SUBMISSION_IN_PROGRESS", duplicateSubmission: true, submission: { state: "processing" } }, { status: 409 });
  }
  // Loaded only when replaying, so the create/adapt import graph is unchanged.
  const { serializePublishedPost } = await import("@/lib/published-post-utils");
  const { COLLABORATION_INCLUDE, decorateCollaboration } = await import("@/lib/published-post-collaborators");
  const outcome = receipt.outcome ? JSON.parse(receipt.outcome) : null;
  const post = receipt.postId
    ? await prisma.publishedPost.findUnique({ where: { id: receipt.postId }, include: { media: { orderBy: { order: "asc" } }, ...COLLABORATION_INCLUDE } })
    : null;
  // Never reveal a post that is not (or no longer) owned by this Brand.
  const visible = post && post.brandId === brandId ? post : null;
  let state;
  let message;
  if (!visible) {
    state = receipt.postId || receipt.state === "completed" ? "post_not_retained" : "unknown";
    message = MESSAGES.notRetained;
  } else if (receipt.state === "completed") {
    state = "completed";
    message = MESSAGES.completed;
  } else if (visible.productionDeliveryAttemptedAt) {
    state = "delivery_uncertain";
    message = MESSAGES.savedUncertain;
  } else {
    state = "saved_incomplete";
    message = MESSAGES.savedIncomplete;
  }
  const serialized = visible
    ? decorateCollaboration(serializePublishedPost(visible, { brandTimezone }), visible, { viewerBrandId: brandId, accessibleBrandIds: null })
    : null;
  return NextResponse.json({
    post: serialized,
    ...(visible ? {} : { kept: false }),
    duplicateSubmission: true,
    publishingMode: outcome?.publishingMode ?? visible?.deliveryMode ?? undefined,
    submission: { state, message, outcome },
  }, { status: 200 });
}

/**
 * run({ receipt }) performs the operation; it must commit the post together
 * with markSubmissionSaved(tx, receipt.id, postId) when `receipt` is given.
 */
export async function withSubmissionGuard({ submissionId, userId, brandId, operation, sourcePostId, brandTimezone, fingerprint }, run) {
  if (submissionId === null || submissionId === undefined || submissionId === "") return run({ receipt: null });
  if (typeof submissionId !== "string" || !ID_RE.test(submissionId)) {
    return NextResponse.json({ error: "Invalid submissionId.", code: "INVALID_SUBMISSION_ID" }, { status: 400 });
  }
  const scopeKey = submissionScopeKey({ userId, brandId, operation, sourcePostId, submissionId });
  const requestDigest = await fingerprint();

  // Same process: wait for an identical in-flight submission, then answer
  // from the durable receipt like any other duplicate.
  const inFlight = IN_FLIGHT.get(scopeKey);
  if (inFlight) await inFlight.catch(() => {});

  await pruneExpiredSubmissions().catch((e) => console.warn("[SubmissionGuard] prune failed", e?.message));
  const reservation = await reserveSubmission({ scopeKey, requestDigest });
  if (reservation.status === "existing") {
    if (reservation.receipt.requestDigest !== requestDigest) {
      return NextResponse.json({ error: MESSAGES.reused, code: "SUBMISSION_ID_REUSED" }, { status: 409 });
    }
    console.log("[SubmissionGuard] duplicate submission answered from its receipt", { operation, brandId, state: reservation.receipt.state });
    return existingSubmissionResponse(reservation.receipt, { brandId, brandTimezone });
  }

  const receipt = reservation.receipt;
  let settle;
  IN_FLIGHT.set(scopeKey, new Promise((r) => { settle = r; }));
  try {
    const response = await run({ receipt });
    let body = null;
    try { body = await response.clone().json(); } catch { body = null; }
    await finishSubmission(receipt.id, { status: response.status, body }).catch((e) =>
      // The post (if any) is already committed with a "saved" receipt; a
      // duplicate will report it accurately instead of re-running.
      console.error("[SubmissionGuard] could not record the submission outcome", { operation, error: e?.message }));
    return response;
  } catch (error) {
    await finishSubmission(receipt.id, { status: 500, body: null }).catch(() => {});
    throw error;
  } finally {
    IN_FLIGHT.delete(scopeKey);
    settle();
  }
}
