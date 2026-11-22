import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBrandAccess, canUserAccessBrand } from "@/lib/brand-access";
import { viewablePublishedPostWhere } from "@/lib/published-post-collaborators";

const MAX_BODY = 2000;

// Commenting on a post is normal workspace functionality, so any member of the
// owning brand may do it. The brand id is the [id] path segment.
async function requireBrandMemberOrReject(brandId) {
  const access = await requireBrandAccess(brandId);
  if (!access.ok) {
    return { error: NextResponse.json({ error: access.error }, { status: access.status }) };
  }
  return { admin: access.user };
}

function serializeComment(c, { canDelete = true } = {}) {
  return {
    id: c.id,
    publishedPostId: c.publishedPostId,
    userId: c.userId,
    authorName: c.authorName,
    body: c.body,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    canDelete,
  };
}

// Reading comments is also allowed from an Instagram collaborator brand's grid.
// Writing/deleting stays with the post's own brand (POST below and the
// [commentId] route still match on { id, brandId }).
export async function GET(request, { params }) {
  const { id, postId } = await params;

  const auth = await requireBrandMemberOrReject(id);
  if (auth.error) return auth.error;

  const post = await prisma.publishedPost.findFirst({
    where: viewablePublishedPostWhere(id, postId),
  });
  if (!post) {
    return NextResponse.json({ error: "Published post not found" }, { status: 404 });
  }

  try {
    const comments = await prisma.publishedPostComment.findMany({
      where: { publishedPostId: postId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const canDelete =
      post.brandId === id || (await canUserAccessBrand(auth.admin, post.brandId));
    const serialized = comments.map((c) => serializeComment(c, { canDelete }));
    return NextResponse.json({
      comments: serialized,
      commentCount: serialized.length,
    });
  } catch (err) {
    console.error("[Comments] GET failed:", err.message);
    return NextResponse.json({ error: "Failed to load comments" }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  const { id, postId } = await params;

  const auth = await requireBrandMemberOrReject(id);
  if (auth.error) return auth.error;
  const admin = auth.admin;

  const post = await prisma.publishedPost.findFirst({
    where: { id: postId, brandId: id },
  });
  if (!post) {
    return NextResponse.json({ error: "Published post not found" }, { status: 404 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const raw = body?.body;
  if (typeof raw !== "string") {
    return NextResponse.json({ error: "Comment body is required" }, { status: 400 });
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return NextResponse.json({ error: "Comment body is required" }, { status: 400 });
  }
  if (trimmed.length > MAX_BODY) {
    return NextResponse.json({ error: "Comment must be 2000 characters or fewer" }, { status: 400 });
  }

  try {
    const authorName = admin.name?.trim() || admin.email || "Unknown";

    const created = await prisma.publishedPostComment.create({
      data: {
        publishedPostId: postId,
        userId: admin.id,
        authorName,
        body: trimmed,
      },
    });

    const count = await prisma.publishedPostComment.count({
      where: { publishedPostId: postId },
    });

    return NextResponse.json(
      {
        comment: serializeComment(created),
        commentCount: count,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[Comments] POST failed:", err.message);
    return NextResponse.json({ error: "Failed to create comment" }, { status: 500 });
  }
}
