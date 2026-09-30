import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireBrandAccess } from "@/lib/brand-access";
import {
  FORUM_PAGE_SIZE,
  MAX_POST_BODY,
  MAX_ATTACHMENTS_PER_POST,
  normalizeText,
  validateForumFile,
  saveForumFiles,
  deleteForumPostFiles,
  authorSnapshot,
  serializeForumPost,
} from "@/lib/brand-forum";

function denied(access) {
  return NextResponse.json({ error: access.error }, { status: access.status });
}

// GET /api/brands/[id]/forum?cursor=<postId>
// Newest posts first, FORUM_PAGE_SIZE per request; replies oldest first.
export async function GET(request, { params }) {
  const { id } = await params;
  const access = await requireBrandAccess(id);
  if (!access.ok) return denied(access);

  const cursor = new URL(request.url).searchParams.get("cursor");

  try {
    const rows = await prisma.brandForumPost.findMany({
      // brandId is always part of the filter, so a foreign cursor cannot leak rows.
      where: { brandId: id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: FORUM_PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        attachments: { orderBy: { createdAt: "asc" } },
        replies: { orderBy: { createdAt: "asc" } },
      },
    });

    const hasMore = rows.length > FORUM_PAGE_SIZE;
    const page = hasMore ? rows.slice(0, FORUM_PAGE_SIZE) : rows;
    const total = await prisma.brandForumPost.count({ where: { brandId: id } });

    return NextResponse.json({
      posts: page.map((p) => serializeForumPost(p, access.user)),
      total,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    });
  } catch (err) {
    console.error("[BrandForum] list failed:", err.message);
    return NextResponse.json({ error: "Failed to load the forum." }, { status: 500 });
  }
}

// POST /api/brands/[id]/forum  (multipart: body, files[])
// The author is ALWAYS the session user; any authorId sent by the client is ignored.
export async function POST(request, { params }) {
  const { id } = await params;
  const access = await requireBrandAccess(id);
  if (!access.ok) return denied(access);

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const text = normalizeText(formData.get("body"), MAX_POST_BODY);
  if (!text.ok) return NextResponse.json({ error: text.error }, { status: 400 });

  const files = formData.getAll("files").filter((f) => f && typeof f !== "string");
  if (!text.text && files.length === 0) {
    return NextResponse.json({ error: "Write something or attach an image or video." }, { status: 400 });
  }
  if (files.length > MAX_ATTACHMENTS_PER_POST) {
    return NextResponse.json(
      { error: `You can attach at most ${MAX_ATTACHMENTS_PER_POST} files per post.` },
      { status: 400 },
    );
  }

  const validated = [];
  for (const file of files) {
    const result = await validateForumFile(file);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    validated.push(result);
  }

  const postId = randomUUID();
  try {
    const saved = await saveForumFiles(id, postId, validated);
    const post = await prisma.brandForumPost.create({
      data: {
        id: postId,
        brandId: id,
        authorId: access.user.id,
        ...authorSnapshot(access.user),
        body: text.text,
        attachments: { create: saved },
      },
      include: { attachments: true, replies: true },
    });
    return NextResponse.json({ post: serializeForumPost(post, access.user) }, { status: 201 });
  } catch (err) {
    await deleteForumPostFiles(id, postId);
    console.error("[BrandForum] create failed:", err.message);
    return NextResponse.json({ error: "Failed to create the post. Please try again." }, { status: 500 });
  }
}
