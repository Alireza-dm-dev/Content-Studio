import { NextResponse } from "next/server";
import { resolveWorkspaceReviewAccess } from "@/lib/workspace-review-access";
import { loadWorkspaceReviewPublicData } from "@/lib/workspace-review-public-data";

export const dynamic = "force-dynamic";

const PRIVATE_KEYS = [
  "tokenHash",
  "createdById",
  "passwordHash",
  "sessionToken",
  "sessionExpiresAt",
  "jsonPayload",
  "notes",
  "sourceMaterial",
  "mainGoal",
  "mainOfferOrMessage",
  "publishedPostId",
];

function assertNoPrivateKeys(obj, path) {
  for (const key in obj) {
    const fullPath = path ? `${path}.${key}` : key;
    if (PRIVATE_KEYS.includes(key)) {
      throw new Error(`Private key exposed: ${fullPath}`);
    }
    const val = obj[key];
    if (typeof val === "object" && val !== null) {
      if (Array.isArray(val)) {
        val.forEach((item, i) => {
          if (typeof item === "object" && item !== null) {
            assertNoPrivateKeys(item, `${fullPath}[${i}]`);
          }
        });
      } else {
        assertNoPrivateKeys(val, fullPath);
      }
    }
  }
}

export async function GET(request, { params }) {
  try {
    const { token } = await params;

    const access = await resolveWorkspaceReviewAccess(token);

    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const data = await loadWorkspaceReviewPublicData(access.review);

    if (!data.brand) {
      return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    }

    const serialized = {
      review: access.review,
      brand: data.brand,
      calendars: data.calendars,
      instagramPosts: data.instagramPosts,
      linkedinPosts: data.linkedinPosts,
    };

    assertNoPrivateKeys(serialized);

    return NextResponse.json(serialized);
  } catch (error) {
    console.error("[Review API]", error);
    if (error instanceof Error && error.message?.startsWith("Private key exposed")) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
