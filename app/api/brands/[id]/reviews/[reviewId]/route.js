import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminAccess } from "@/lib/auth";

const SUPPORTED_PATCH_FIELDS = new Set([
  "label",
  "expiresAt",
  "includeCalendars",
  "includeInstagram",
  "includeLinkedIn",
  "allowComments",
  "isActive",
]);

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

async function authorizeAndGetReview(params) {
  const access = await getAdminAccess();
  if (!access.user) {
    return { error: NextResponse.json({ error: access.error }, { status: access.status }) };
  }

  const { id, reviewId } = await params;

  const review = await prisma.workspaceReview.findUnique({
    where: { id: reviewId },
  });

  if (!review || review.brandId !== id) {
    return { error: NextResponse.json({ error: "Review link not found" }, { status: 404 }) };
  }

  return { review, access };
}

export async function PATCH(request, { params }) {
  const result = await authorizeAndGetReview(params);
  if (result.error) return result.error;

  const { review, access } = result;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Check for unknown fields
  const unknownKeys = Object.keys(body).filter((k) => !SUPPORTED_PATCH_FIELDS.has(k));
  if (unknownKeys.length > 0) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Check at least one recognized field is present
  const hasAnyField = SUPPORTED_PATCH_FIELDS.has(Object.keys(body).find((k) => SUPPORTED_PATCH_FIELDS.has(k)) || "");
  if (!hasAnyField) {
    return NextResponse.json({ error: "No review changes provided" }, { status: 400 });
  }

  // Build update data
  const updateData = {};

  // label
  if ("label" in body) {
    const val = body.label;
    if (val !== null) {
      if (typeof val !== "string") {
        return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
      }
      const trimmed = val.trim();
      if (trimmed.length > 120) {
        return NextResponse.json(
          { error: "Label must be 120 characters or fewer" },
          { status: 400 },
        );
      }
      updateData.label = trimmed.length > 0 ? trimmed : null;
    } else {
      updateData.label = null;
    }
  }

  // expiresAt
  if ("expiresAt" in body) {
    const val = body.expiresAt;
    if (val !== null) {
      if (typeof val !== "string") {
        return NextResponse.json({ error: "Invalid expiration date" }, { status: 400 });
      }
      const parsed = new Date(val);
      if (isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "Invalid expiration date" }, { status: 400 });
      }
      if (parsed <= new Date()) {
        return NextResponse.json(
          { error: "Expiration date must be in the future" },
          { status: 400 },
        );
      }
      updateData.expiresAt = parsed;
    } else {
      updateData.expiresAt = null;
    }
  }

  // Boolean fields
  function parseBoolean(value, fieldName) {
    if (value === undefined) return undefined;
    if (typeof value !== "boolean") {
      return { error: true };
    }
    return value;
  }

  function handleBoolean(fieldName) {
    if (!(fieldName in body)) return;
    const parsed = parseBoolean(body[fieldName], fieldName);
    if (parsed && parsed.error) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    updateData[fieldName] = parsed;
  }

  const boolErr1 = handleBoolean("includeCalendars");
  if (boolErr1) return boolErr1;
  const boolErr2 = handleBoolean("includeInstagram");
  if (boolErr2) return boolErr2;
  const boolErr3 = handleBoolean("includeLinkedIn");
  if (boolErr3) return boolErr3;
  const boolErr4 = handleBoolean("allowComments");
  if (boolErr4) return boolErr4;
  const boolErr5 = handleBoolean("isActive");
  if (boolErr5) return boolErr5;

  // At least one section must remain true (considering merged state)
  const mergedCalendars = "includeCalendars" in updateData ? updateData.includeCalendars : review.includeCalendars;
  const mergedInstagram = "includeInstagram" in updateData ? updateData.includeInstagram : review.includeInstagram;
  const mergedLinkedIn = "includeLinkedIn" in updateData ? updateData.includeLinkedIn : review.includeLinkedIn;

  if (!mergedCalendars && !mergedInstagram && !mergedLinkedIn) {
    return NextResponse.json(
      { error: "Select at least one review section" },
      { status: 400 },
    );
  }

  try {
    const updated = await prisma.workspaceReview.update({
      where: { id: review.id },
      data: updateData,
    });

    return NextResponse.json({ review: serializeReview(updated) });
  } catch {
    return NextResponse.json(
      { error: "Failed to update review link" },
      { status: 500 },
    );
  }
}

export async function DELETE(request, { params }) {
  const result = await authorizeAndGetReview(params);
  if (result.error) return result.error;

  const { review } = result;

  try {
    await prisma.workspaceReview.delete({
      where: { id: review.id },
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to delete review link" },
      { status: 500 },
    );
  }
}
