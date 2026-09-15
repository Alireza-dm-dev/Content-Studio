import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBrandAccess } from "@/lib/brand-access";

// Commenting on a post is normal workspace functionality, so any member of the
// owning brand may do it. The brand id is the [id] path segment.
async function requireBrandMemberOrReject(brandId) {
  const access = await requireBrandAccess(brandId);
  if (!access.ok) {
    return { error: NextResponse.json({ error: access.error }, { status: access.status }) };
  }
  return { admin: access.user };
}

export async function DELETE(request, { params }) {
  const { id, postId, commentId } = await params;

  const auth = await requireBrandMemberOrReject(id);
  if (auth.error) return auth.error;

  const post = await prisma.publishedPost.findFirst({
    where: { id: postId, brandId: id },
  });
  if (!post) {
    return NextResponse.json({ error: "Published post not found" }, { status: 404 });
  }

  try {
    const comment = await prisma.publishedPostComment.findFirst({
      where: { id: commentId, publishedPostId: postId },
    });
    if (!comment) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }

    await prisma.publishedPostComment.delete({ where: { id: commentId } });

    const count = await prisma.publishedPostComment.count({
      where: { publishedPostId: postId },
    });

    return NextResponse.json({ success: true, commentCount: count });
  } catch (err) {
    console.error("[Comments] DELETE failed:", err.message);
    return NextResponse.json({ error: "Failed to delete comment" }, { status: 500 });
  }
}
