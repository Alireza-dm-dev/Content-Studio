import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveWorkspaceReviewAccess } from "@/lib/workspace-review-access";

export const dynamic = "force-dynamic";

const MAX_DISPLAY_NAME = 80;
const MAX_CONTENT = 2000;

const ALLOWED_POST_KEYS = new Set(["displayName", "content"]);

async function requireReviewAccess(token) {
  const access = await resolveWorkspaceReviewAccess(token);
  if (!access.ok) {
    return { error: NextResponse.json({ error: access.error }, { status: access.status }) };
  }
  return { review: access.review };
}

function hasSectionEnabled(review, publishedPost) {
  if (publishedPost.platform === "instagram" && !review.includeInstagram) return false;
  if (publishedPost.platform === "linkedin" && !review.includeLinkedIn) return false;
  return true;
}

function resolveAuthorName(c) {
  if (c.userId) {
    return c.authorName || "Workspace Admin";
  }
  if (c.reviewerName) {
    return c.reviewerName;
  }
  return "Reviewer";
}

function serializePublicComment(c) {
  return {
    id: c.id,
    content: c.body,
    authorName: resolveAuthorName(c),
    createdAt: c.createdAt,
  };
}

export async function GET(request, { params }) {
  try {
    const { token, postId } = await params;

    const access = await requireReviewAccess(token);
    if (access.error) return access.error;
    const { review } = access;

    if (!review.allowComments) {
      return NextResponse.json({ error: "Comments are disabled for this review" }, { status: 403 });
    }

    const post = await prisma.publishedPost.findFirst({
      where: { id: postId, brandId: review.brandId },
    });
    if (!post) {
      return NextResponse.json({ error: "Published post not found" }, { status: 404 });
    }

    if (!hasSectionEnabled(review, post)) {
      return NextResponse.json({ error: "Published post not found" }, { status: 404 });
    }

    const comments = await prisma.publishedPostComment.findMany({
      where: { publishedPostId: postId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    const serialized = comments.map(serializePublicComment);

    return NextResponse.json({
      comments: serialized,
      commentCount: serialized.length,
    });
  } catch (error) {
    console.error("[Review Comments] GET failed:", error.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const { token, postId } = await params;

    const access = await requireReviewAccess(token);
    if (access.error) return access.error;
    const { review } = access;

    if (!review.allowComments) {
      return NextResponse.json({ error: "Comments are disabled for this review" }, { status: 403 });
    }

    const post = await prisma.publishedPost.findFirst({
      where: { id: postId, brandId: review.brandId },
    });
    if (!post) {
      return NextResponse.json({ error: "Published post not found" }, { status: 404 });
    }

    if (!hasSectionEnabled(review, post)) {
      return NextResponse.json({ error: "Published post not found" }, { status: 404 });
    }

    let raw;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    for (const key of Object.keys(raw)) {
      if (!ALLOWED_POST_KEYS.has(key)) {
        return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
      }
    }

    const rawDisplayName = raw.displayName;
    if (typeof rawDisplayName !== "string") {
      return NextResponse.json({ error: "Display name is required" }, { status: 400 });
    }

    const displayName = rawDisplayName.trim();

    if (displayName.length === 0) {
      return NextResponse.json({ error: "Display name is required" }, { status: 400 });
    }

    if (displayName.length > MAX_DISPLAY_NAME) {
      return NextResponse.json({ error: "Display name must be 80 characters or fewer" }, { status: 400 });
    }

    const rawContent = raw.content;
    if (typeof rawContent !== "string") {
      return NextResponse.json({ error: "Comment is required" }, { status: 400 });
    }

    const content = rawContent.trim();

    if (content.length === 0) {
      return NextResponse.json({ error: "Comment is required" }, { status: 400 });
    }

    if (content.length > MAX_CONTENT) {
      return NextResponse.json({ error: "Comment must be 2000 characters or fewer" }, { status: 400 });
    }

    const created = await prisma.publishedPostComment.create({
      data: {
        publishedPostId: post.id,
        reviewerName: displayName,
        authorName: displayName,
        body: content,
        workspaceReviewId: review.id,
      },
    });

    const count = await prisma.publishedPostComment.count({
      where: { publishedPostId: postId },
    });

    return NextResponse.json(
      {
        comment: serializePublicComment(created),
        commentCount: count,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[Review Comments] POST failed:", error.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
