import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBrandAccess, requireResourceBrandAccess } from "@/lib/brand-access";
import { canDeleteForumItem } from "@/lib/brand-forum";

// DELETE /api/brands/[id]/forum/[postId]/replies/[replyId] — author or admin.
export async function DELETE(request, { params }) {
  const { id, postId, replyId } = await params;

  const brandAccess = await requireBrandAccess(id);
  if (!brandAccess.ok) {
    return NextResponse.json({ error: brandAccess.error }, { status: brandAccess.status });
  }
  const access = await requireResourceBrandAccess("forumReply", replyId, { user: brandAccess.user });
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (access.brandId !== id) {
    return NextResponse.json({ error: "You do not have access to this resource." }, { status: 403 });
  }

  const reply = await prisma.brandForumReply.findUnique({
    where: { id: replyId },
    select: { id: true, postId: true, authorId: true },
  });
  if (!reply || reply.postId !== postId) {
    return NextResponse.json({ error: "Reply not found" }, { status: 404 });
  }

  if (!canDeleteForumItem(access.user, reply)) {
    return NextResponse.json({ error: "Only the author or an admin can delete this reply." }, { status: 403 });
  }

  try {
    await prisma.brandForumReply.delete({ where: { id: replyId } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[BrandForum] delete reply failed:", err.message);
    return NextResponse.json({ error: "Failed to delete the reply." }, { status: 500 });
  }
}
