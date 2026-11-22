import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBrandAccess } from "@/lib/brand-access";
import { checkInstagramCaption } from "@/lib/instagram-caption-check";
import { INSTAGRAM_MAIN_ANGLES } from "@/lib/instagram-caption";
import { COLLABORATOR_MANAGE_FORBIDDEN, isCollaboratorOnlyPost } from "@/lib/published-post-collaborators";

const MAX_CAPTION_CHARS = 5000;

/**
 * POST /api/brands/:id/published-posts/caption-check
 * Body: { caption: string, mainAngle?: string, postId?: string, useAi?: boolean }
 *
 * Instagram only. Checks and normalises a caption WITHOUT saving anything.
 * `:id` is the brand the post is (or will be) owned by. When `postId` is given
 * (edit flow) the post must belong to `:id`, so a collaboration post is always
 * checked against its PRIMARY brand and never through a collaborator brand.
 */
export async function POST(request, { params }) {
  const { id } = await params;

  const access = await requireBrandAccess(id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const caption = body?.caption;
  if (typeof caption !== "string") {
    return NextResponse.json({ error: "caption must be a string." }, { status: 400 });
  }
  if (caption.length > MAX_CAPTION_CHARS) {
    return NextResponse.json({ error: `Caption must be ${MAX_CAPTION_CHARS} characters or fewer.` }, { status: 400 });
  }

  const rawAngle = typeof body.mainAngle === "string" ? body.mainAngle.trim() : "";
  const mainAngle = INSTAGRAM_MAIN_ANGLES.find((a) => a.toLowerCase() === rawAngle.toLowerCase()) || "";

  if (body.postId !== undefined) {
    if (typeof body.postId !== "string" || !body.postId) {
      return NextResponse.json({ error: "postId must be a string." }, { status: 400 });
    }
    const post = await prisma.publishedPost.findFirst({
      where: { id: body.postId, brandId: id },
      select: { id: true, platform: true },
    });
    if (!post) {
      if (await isCollaboratorOnlyPost(id, body.postId)) {
        return NextResponse.json({ error: COLLABORATOR_MANAGE_FORBIDDEN }, { status: 403 });
      }
      return NextResponse.json({ error: "Published post not found" }, { status: 404 });
    }
  }

  try {
    const result = await checkInstagramCaption({
      brandId: id,
      caption,
      mainAngle,
      useAi: body.useAi !== false,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error?.code === "BRAND_NOT_FOUND") {
      return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    }
    console.error("[CaptionCheck] failed", error?.message);
    return NextResponse.json({ error: "Caption check failed." }, { status: 500 });
  }
}
