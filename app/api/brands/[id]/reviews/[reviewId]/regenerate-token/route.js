import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminAccess } from "@/lib/auth";
import {
  generateWorkspaceReviewToken,
  hashWorkspaceReviewToken,
  getWorkspaceReviewTokenLast4,
} from "@/lib/workspace-review-token";

function serializeReview(review) {
  const now = new Date();
  let status = "active";
  if (!review.isActive) {
    status = "revoked";
  } else if (review.expiresAt && new Date(review.expiresAt) < now) {
    status = "expired";
  }

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
    status,
  };
}

export async function POST(request, { params }) {
  const access = await getAdminAccess();
  if (!access.user) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { id, reviewId } = await params;

  const review = await prisma.workspaceReview.findUnique({
    where: { id: reviewId },
  });

  if (!review || review.brandId !== id) {
    return NextResponse.json({ error: "Review link not found" }, { status: 404 });
  }

  let rawToken;
  let tokenHash;
  let tokenLast4;
  let updated;

  for (let attempt = 0; attempt < 3; attempt++) {
    rawToken = generateWorkspaceReviewToken();
    tokenHash = hashWorkspaceReviewToken(rawToken);
    tokenLast4 = getWorkspaceReviewTokenLast4(rawToken);

    try {
      updated = await prisma.workspaceReview.update({
        where: { id: review.id },
        data: { tokenHash, tokenLast4 },
      });

      // The raw token is returned ONLY in this regeneration response.
      // Only the SHA-256 hash is stored in the database.
      // The raw token cannot be recovered later.
      return NextResponse.json({
        review: serializeReview(updated),
        token: rawToken,
        reviewPath: `/review/${rawToken}`,
      });
    } catch (err) {
      if (
        err?.code === "P2002" &&
        err?.meta?.target?.includes("tokenHash")
      ) {
        continue;
      }
      throw err;
    }
  }

  return NextResponse.json(
    { error: "Failed to regenerate review link" },
    { status: 500 },
  );
}
