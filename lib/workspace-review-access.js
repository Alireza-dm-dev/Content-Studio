import { prisma } from "@/lib/prisma";
import { hashWorkspaceReviewToken } from "@/lib/workspace-review-token";

const MAX_TOKEN_LENGTH = 200;

function safeProject(review) {
  return {
    id: review.id,
    brandId: review.brandId,
    label: review.label,
    tokenLast4: review.tokenLast4,
    isActive: review.isActive,
    expiresAt: review.expiresAt,
    includeCalendars: review.includeCalendars,
    includeInstagram: review.includeInstagram,
    includeLinkedIn: review.includeLinkedIn,
    allowComments: review.allowComments,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
}

export async function resolveWorkspaceReviewAccess(token) {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return {
      ok: false,
      status: 404,
      code: "not_found",
      error: "Review link not found",
    };
  }

  let tokenHash;
  try {
    tokenHash = hashWorkspaceReviewToken(token);
  } catch {
    return {
      ok: false,
      status: 404,
      code: "not_found",
      error: "Review link not found",
    };
  }

  let review;
  try {
    review = await prisma.workspaceReview.findUnique({ where: { tokenHash } });
  } catch {
    return {
      ok: false,
      status: 500,
      code: "server_error",
      error: "Internal server error",
    };
  }

  if (!review) {
    return {
      ok: false,
      status: 404,
      code: "not_found",
      error: "Review link not found",
    };
  }

  if (!review.isActive) {
    return {
      ok: false,
      status: 410,
      code: "revoked",
      error: "This review link has been revoked",
      review: safeProject(review),
    };
  }

  const now = new Date();

  if (review.expiresAt && review.expiresAt <= now) {
    return {
      ok: false,
      status: 410,
      code: "expired",
      error: "This review link has expired",
      review: safeProject(review),
    };
  }

  return {
    ok: true,
    review: safeProject(review),
  };
}
