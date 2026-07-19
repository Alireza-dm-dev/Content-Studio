import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

async function requireAdminOrReject() {
  const user = await getCurrentUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  }
  if (user.role !== "admin") {
    return { error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  }
  return { admin: user };
}

export async function DELETE(request, { params }) {
  const auth = await requireAdminOrReject();
  if (auth.error) return auth.error;

  const { id, postId, commentId } = await params;

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
