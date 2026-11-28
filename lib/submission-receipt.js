import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { canonicalJson } from "@/lib/publishing-mode";

// Durable submission receipts (V1.3.56): the AUTHORITATIVE duplicate
// protection for Published Post create / adapt. Database uniqueness on
// `scopeKey` decides which request owns a submission id, across restarts and
// app instances. See lib/submission-guard.js for the request flow.
//
// States:
//   processing  reserved; no post committed yet
//   saved       the post was committed in the SAME transaction that set this
//               state (markSubmissionSaved); the outcome was not recorded yet
//   completed   outcome summary recorded
//
// A receipt never stores captions, payloads, credentials or media.

export const RECEIPT_RETENTION_DAYS = 30;
// Longer than any request can run (client timeout 11 min): a "processing"
// receipt older than this cannot belong to a live request.
export const STALE_PROCESSING_MS = 15 * 60 * 1000;

export function submissionScopeKey({ userId, brandId, operation, sourcePostId = "", submissionId }) {
  return createHash("sha256")
    .update(canonicalJson({ u: String(userId || "anonymous"), b: String(brandId), o: String(operation), s: String(sourcePostId || ""), id: String(submissionId) }))
    .digest("hex");
}

const isUniqueViolation = (e) => e?.code === "P2002" || /Unique constraint/i.test(String(e?.message || ""));

/**
 * Reserve a submission. Returns
 *   { status: "reserved", receipt }   this request owns it (new, or a stale
 *                                     crashed reservation that never saved)
 *   { status: "existing", receipt }   another request owns / owned it
 */
export async function reserveSubmission({ scopeKey, requestDigest }, db = prisma) {
  try {
    const receipt = await db.publishedPostSubmission.create({ data: { scopeKey, requestDigest, state: "processing" } });
    return { status: "reserved", receipt };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
  const receipt = await db.publishedPostSubmission.findUnique({ where: { scopeKey } });
  if (!receipt) return reserveSubmission({ scopeKey, requestDigest }, db); // pruned meanwhile
  // Crash before the post was saved (stage A): nothing was created, so the
  // same request may take the reservation over. Conditional update = only one
  // taker wins.
  if (
    receipt.state === "processing" && !receipt.postId && receipt.requestDigest === requestDigest &&
    Date.now() - new Date(receipt.updatedAt).getTime() > STALE_PROCESSING_MS
  ) {
    // Only one taker wins: the winner refreshes updatedAt, so the condition
    // no longer holds for anyone else.
    const { count } = await db.publishedPostSubmission.updateMany({
      where: { id: receipt.id, state: "processing", postId: null, updatedAt: { lt: new Date(Date.now() - STALE_PROCESSING_MS) } },
      data: { updatedAt: new Date() },
    });
    if (count === 1) return { status: "reserved", receipt: { ...receipt, tookOver: true } };
  }
  return { status: "existing", receipt };
}

/** Inside the post-creation transaction: the post and "saved" commit together. */
export async function markSubmissionSaved(tx, receiptId, postId) {
  await tx.publishedPostSubmission.update({ where: { id: receiptId }, data: { state: "saved", postId } });
}

/** Small outcome summary only (no caption, payload, credentials). */
export function summarizeOutcome(body) {
  const wr = body?.webhookResult;
  const t = body?.trial;
  return {
    publishingMode: body?.publishingMode ?? null,
    kept: body?.kept === false ? false : Boolean(body?.post),
    webhook: wr ? { success: wr.success ?? null, code: wr.code ?? null, httpStatus: wr.webhookStatus ?? null, skipped: Boolean(wr.skipped) } : null,
    trial: t ? { sent: Boolean(t.sent), code: t.code ?? null, outcome: t.result?.outcome ?? null, httpStatus: t.result?.httpStatus ?? null, trialId: t.result?.trialId ?? null } : null,
  };
}

/**
 * After the handler returned. A receipt that never saved a post is released
 * (the request was refused before saving and may be corrected and resent
 * with the same id). A saved receipt is completed with the outcome on 2xx,
 * and otherwise left "saved" (the post exists; nothing is re-run).
 */
export async function finishSubmission(receiptId, { status, body }, db = prisma) {
  const current = await db.publishedPostSubmission.findUnique({ where: { id: receiptId } });
  if (!current) return;
  if (current.state === "processing" && !current.postId) {
    const ok = status >= 200 && status < 300;
    // 2xx without a saved post happens only when retention removed the new
    // post at once: that still counts as completed (never re-run).
    if (ok && body && body.kept === false) {
      await db.publishedPostSubmission.update({ where: { id: receiptId }, data: { state: "completed", outcome: JSON.stringify(summarizeOutcome(body)) } });
    } else {
      await db.publishedPostSubmission.deleteMany({ where: { id: receiptId, state: "processing", postId: null } });
    }
    return;
  }
  if (status >= 200 && status < 300 && body) {
    await db.publishedPostSubmission.update({ where: { id: receiptId }, data: { state: "completed", outcome: JSON.stringify(summarizeOutcome(body)) } });
  }
}

/** Bounded growth: receipts older than RECEIPT_RETENTION_DAYS are removed. */
export async function pruneExpiredSubmissions(db = prisma, now = Date.now()) {
  await db.publishedPostSubmission.deleteMany({ where: { createdAt: { lt: new Date(now - RECEIPT_RETENTION_DAYS * 86400e3) } } });
}
