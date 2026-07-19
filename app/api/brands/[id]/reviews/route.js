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

export async function GET(request, { params }) {
  const access = await getAdminAccess();
  if (!access.user) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { id } = await params;

  const brand = await prisma.brand.findUnique({ where: { id } });
  if (!brand) {
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }

  try {
    const reviews = await prisma.workspaceReview.findMany({
      where: { brandId: id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    return NextResponse.json({ reviews: reviews.map(serializeReview) });
  } catch {
    return NextResponse.json(
      { error: "Failed to load review links" },
      { status: 500 },
    );
  }
}

export async function POST(request, { params }) {
  const access = await getAdminAccess();
  if (!access.user) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { id } = await params;

  const brand = await prisma.brand.findUnique({ where: { id } });
  if (!brand) {
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // label validation
  let label = body.label;
  if (label !== undefined && label !== null) {
    if (typeof label !== "string") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    label = label.trim();
    if (label.length === 0) label = null;
    if (label && label.length > 120) {
      return NextResponse.json(
        { error: "Label must be 120 characters or fewer" },
        { status: 400 },
      );
    }
  } else {
    label = null;
  }

  // expiresAt validation
  let expiresAt = body.expiresAt;
  if (expiresAt !== undefined && expiresAt !== null) {
    if (typeof expiresAt !== "string") {
      return NextResponse.json({ error: "Invalid expiration date" }, { status: 400 });
    }
    const parsed = new Date(expiresAt);
    if (isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "Invalid expiration date" }, { status: 400 });
    }
    if (parsed <= new Date()) {
      return NextResponse.json(
        { error: "Expiration date must be in the future" },
        { status: 400 },
      );
    }
    expiresAt = parsed;
  } else {
    expiresAt = null;
  }

  // boolean fields
  function parseBoolean(value, name) {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "boolean") {
      return { error: `Invalid request body` };
    }
    return value;
  }

  const includeCalendars = parseBoolean(body.includeCalendars);
  if (includeCalendars && includeCalendars.error) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const includeInstagram = parseBoolean(body.includeInstagram);
  if (includeInstagram && includeInstagram.error) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const includeLinkedIn = parseBoolean(body.includeLinkedIn);
  if (includeLinkedIn && includeLinkedIn.error) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const allowComments = parseBoolean(body.allowComments);
  if (allowComments && allowComments.error) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const finalCalendars = includeCalendars !== undefined ? includeCalendars : true;
  const finalInstagram = includeInstagram !== undefined ? includeInstagram : true;
  const finalLinkedIn = includeLinkedIn !== undefined ? includeLinkedIn : true;
  const finalAllowComments = allowComments !== undefined ? allowComments : true;

  if (!finalCalendars && !finalInstagram && !finalLinkedIn) {
    return NextResponse.json(
      { error: "Select at least one review section" },
      { status: 400 },
    );
  }

  // Generate and store token
  let rawToken;
  let tokenHash;
  let tokenLast4;
  let created = false;

  for (let attempt = 0; attempt < 3; attempt++) {
    rawToken = generateWorkspaceReviewToken();
    tokenHash = hashWorkspaceReviewToken(rawToken);
    tokenLast4 = getWorkspaceReviewTokenLast4(rawToken);

    try {
      const review = await prisma.workspaceReview.create({
        data: {
          brandId: id,
          createdById: access.user.id,
          label,
          tokenHash,
          tokenLast4,
          isActive: true,
          expiresAt,
          includeCalendars: finalCalendars,
          includeInstagram: finalInstagram,
          includeLinkedIn: finalLinkedIn,
          allowComments: finalAllowComments,
        },
      });

      created = true;

      // The raw token is returned ONLY in this creation response.
      // Only the SHA-256 hash is stored in the database.
      // The raw token cannot be recovered later.
      return NextResponse.json(
        {
          review: serializeReview(review),
          token: rawToken,
          reviewPath: `/review/${rawToken}`,
        },
        { status: 201 },
      );
    } catch (err) {
      // Retry only on unique constraint violation for tokenHash
      if (
        err?.code === "P2002" &&
        err?.meta?.target?.includes("tokenHash")
      ) {
        continue;
      }
      throw err;
    }
  }

  if (!created) {
    return NextResponse.json(
      { error: "Failed to create review link" },
      { status: 500 },
    );
  }
}
