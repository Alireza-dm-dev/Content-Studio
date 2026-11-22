import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBrandAccess } from "@/lib/brand-access";
import { serializePublishedPost } from "@/lib/published-post-utils";
import {
  COLLABORATION_INCLUDE,
  COLLABORATOR_MANAGE_FORBIDDEN,
  isCollaboratorOnlyPost,
  parseCollaboratorBrandIds,
  validateCollaboratorBrands,
  replacePublishedPostCollaborators,
  decorateCollaboration,
} from "@/lib/published-post-collaborators";

/**
 * PUT /api/brands/:id/published-posts/:postId/collaborators
 * Body: { brandIds: string[] }  (empty array removes every collaborator)
 *
 * Replaces the collaborator set of an Instagram post. `:id` must be the post's
 * PRIMARY brand and the user must access it plus every listed brand.
 *
 * Display/organisation only: this never sends anything to n8n and never
 * touches the post's fields, primary brand, or media.
 */
export async function PUT(request, { params }) {
  const { id, postId } = await params;

  const access = await requireBrandAccess(id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const post = await prisma.publishedPost.findFirst({
    where: { id: postId, brandId: id },
    select: { id: true, brandId: true, platform: true },
  });
  if (!post) {
    if (await isCollaboratorOnlyPost(id, postId)) {
      return NextResponse.json({ error: COLLABORATOR_MANAGE_FORBIDDEN }, { status: 403 });
    }
    return NextResponse.json({ error: "Published post not found" }, { status: 404 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || !Array.isArray(body.brandIds)) {
    return NextResponse.json({ error: "brandIds must be an array." }, { status: 400 });
  }

  const parsed = parseCollaboratorBrandIds(body.brandIds);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }

  const existing = await prisma.publishedPostCollaborator.findMany({
    where: { publishedPostId: post.id },
    select: { brandId: true },
  });

  const check = await validateCollaboratorBrands({
    user: access.user,
    primaryBrandId: post.brandId,
    platform: post.platform,
    brandIds: parsed.ids,
    alreadyLinkedIds: existing.map((r) => r.brandId),
  });
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  try {
    await prisma.$transaction((tx) =>
      replacePublishedPostCollaborators(tx, post.id, parsed.ids),
    );

    const fresh = await prisma.publishedPost.findUnique({
      where: { id: post.id },
      include: {
        media: { orderBy: { order: "asc" } },
        _count: { select: { comments: true } },
        ...COLLABORATION_INCLUDE,
      },
    });

    return NextResponse.json({
      post: decorateCollaboration(serializePublishedPost(fresh), fresh, {
        viewerBrandId: id,
        accessibleBrandIds: null, // passed requireBrandAccess on the primary brand
      }),
    });
  } catch (error) {
    console.error("[PublishedPostCollaborators] update failed", { postId, error: error?.message });
    return NextResponse.json({ error: "Failed to update collaborators." }, { status: 500 });
  }
}
