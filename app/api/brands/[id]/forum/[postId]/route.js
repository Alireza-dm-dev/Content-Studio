import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBrandAccess, requireResourceBrandAccess } from "@/lib/brand-access";
import { canDeleteForumItem, deleteForumPostFiles } from "@/lib/brand-forum";

// DELETE /api/brands/[id]/forum/[postId] — author or admin.
export async function DELETE(request, { params }) {
  const { id, postId } = await params;

  const brandAccess = await requireBrandAccess(id);
  if (!brandAccess.ok) {
    return NextResponse.json({ error: brandAccess.error }, { status: brandAccess.status });
  }

  // Authorize through the post's OWN brand, then require it to be this brand.
  const access = await requireResourceBrandAccess("forumPost", postId, { user: brandAccess.user });
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (access.brandId !== id) {
    return NextResponse.json({ error: "You do not have access to this resource." }, { status: 403 });
  }

  const post = await prisma.brandForumPost.findUnique({
    where: { id: postId },
    select: { id: true, brandId: true, authorId: true },
  });
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

  if (!canDeleteForumItem(access.user, post)) {
    return NextResponse.json({ error: "Only the author or an admin can delete this post." }, { status: 403 });
  }

  try {
    await prisma.brandForumPost.delete({ where: { id: postId } });
  } catch (err) {
    console.error("[BrandForum] delete post failed:", err.message);
    return NextResponse.json({ error: "Failed to delete the post." }, { status: 500 });
  }

  // DB is already consistent; storage cleanup is best-effort and scoped to this post.
  await deleteForumPostFiles(id, postId);
  return NextResponse.json({ success: true });
}
