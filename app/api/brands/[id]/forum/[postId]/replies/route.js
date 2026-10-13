import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBrandAccess, requireResourceBrandAccess } from "@/lib/brand-access";
import { MAX_REPLY_BODY, normalizeText, authorSnapshot } from "@/lib/brand-forum";

// POST /api/brands/[id]/forum/[postId]/replies  (JSON: { body })
// The author is ALWAYS the session user; any authorId in the payload is ignored.
export async function POST(request, { params }) {
  const { id, postId } = await params;

  const brandAccess = await requireBrandAccess(id);
  if (!brandAccess.ok) {
    return NextResponse.json({ error: brandAccess.error }, { status: brandAccess.status });
  }
  const access = await requireResourceBrandAccess("forumPost", postId, { user: brandAccess.user });
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (access.brandId !== id) {
    return NextResponse.json({ error: "You do not have access to this resource." }, { status: 403 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const text = normalizeText(payload?.body, MAX_REPLY_BODY);
  if (!text.ok) return NextResponse.json({ error: text.error }, { status: 400 });
  if (!text.text) return NextResponse.json({ error: "Reply cannot be empty." }, { status: 400 });

  try {
    const reply = await prisma.brandForumReply.create({
      data: {
        postId,
        authorId: access.user.id,
        ...authorSnapshot(access.user),
        body: text.text,
      },
    });
    return NextResponse.json(
      {
        reply: {
          id: reply.id,
          body: reply.body,
          createdAt: reply.createdAt,
          author: { id: reply.authorId, name: reply.authorName, role: reply.authorRole },
          canDelete: true,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("[BrandForum] create reply failed:", err.message);
    return NextResponse.json({ error: "Failed to post the reply. Please try again." }, { status: 500 });
  }
}
