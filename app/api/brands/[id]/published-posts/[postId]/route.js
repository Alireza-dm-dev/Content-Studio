import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBrandAccess } from "@/lib/brand-access";
import {
  deletePublishedPostFiles,
  buildN8nPayload,
  buildRemoteAwareMedia,
  safeParseJson,
  isCanonicalMediaUrl,
  normalizePostType,
  isValidStatus,
  normalizePublishedPostPlatform,
  serializePublishedPost,
  POST_TYPE_STATIC,
  POST_TYPE_CAROUSEL,
  POST_TYPE_REEL,
} from "@/lib/published-post-utils";
import {
  requiresExternalDeleteWebhook,
  sendPublishedPostDeleteToN8n,
} from "@/lib/published-post-delete-webhook";
import { sendPublishedPostToN8n } from "@/lib/published-post-webhook";
import { normalizeScheduledDate } from "@/lib/timezone";

// The local row survives every one of these, so the client can retry.
const DELETE_WEBHOOK_ERROR_STATUS = {
  DELETE_WEBHOOK_TIMEOUT: 504,
  DELETE_WEBHOOK_NOT_CONFIGURED: 500,
  DELETE_WEBHOOK_PAYLOAD_BUILD_FAILED: 500,
};

export async function GET(request, { params }) {
  const { id, postId } = await params;

  const brandAccess = await requireBrandAccess(id);
  if (!brandAccess.ok) {
    return NextResponse.json(
      { error: brandAccess.error },
      { status: brandAccess.status },
    );
  }

  const brand = await prisma.brand.findUnique({ where: { id } });
  if (!brand) {
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }

  const post = await prisma.publishedPost.findFirst({
    where: { id: postId, brandId: id },
    include: {
      media: { orderBy: { order: "asc" } },
      _count: { select: { comments: true } },
    },
  });

  if (!post) {
    return NextResponse.json({ error: "Published post not found" }, { status: 404 });
  }

  return NextResponse.json(serializePublishedPost(post));
}

export async function DELETE(request, { params }) {
  const { id, postId } = await params;

  const brandAccess = await requireBrandAccess(id);
  if (!brandAccess.ok) {
    return NextResponse.json(
      { error: brandAccess.error },
      { status: brandAccess.status },
    );
  }

  const brand = await prisma.brand.findUnique({ where: { id } });
  if (!brand) {
    return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  }

  const post = await prisma.publishedPost.findFirst({
    where: { id: postId, brandId: id },
    include: { media: { orderBy: { order: "asc" } } },
  });

  if (!post) {
    return NextResponse.json({ error: "Published post not found" }, { status: 404 });
  }

  // Instagram and LinkedIn posts also exist on the social network, and n8n owns
  // deleting them there. Ask n8n first and only delete locally once it confirms:
  // this row carries the identifiers n8n needs, so removing it before the
  // external delete succeeds would strand a live post with no way to find it.
  // No DB transaction is open across this call.
  if (requiresExternalDeleteWebhook(post.platform)) {
    const webhookResult = await sendPublishedPostDeleteToN8n({
      post,
      media: post.media || [],
      brand,
      user: brandAccess.user,
    });

    if (!webhookResult.success) {
      console.error("[PublishedPosts] external delete refused, keeping local post", {
        postId,
        brandId: id,
        platform: post.platform,
        code: webhookResult.code,
        httpStatus: webhookResult.webhookStatus ?? null,
        durationMs: webhookResult.durationMs ?? null,
      });
      return NextResponse.json(
        { error: webhookResult.error, code: webhookResult.code },
        { status: DELETE_WEBHOOK_ERROR_STATUS[webhookResult.code] || 502 },
      );
    }
  }

  // Delete DB records first (media cascade from publishedPost)
  await prisma.publishedPost.delete({ where: { id: postId } });

  // Best-effort cleanup of uploaded files from disk
  await deletePublishedPostFiles(postId, id);

  return NextResponse.json({ success: true });
}

export async function POST(request, { params }) {
  try {
    const { id, postId } = await params;

  const brandAccess = await requireBrandAccess(id);
  if (!brandAccess.ok) {
    return NextResponse.json(
      { error: brandAccess.error },
      { status: brandAccess.status },
    );
  }

    const brand = await prisma.brand.findUnique({ where: { id } });
    if (!brand) {
      return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    }

    const existing = await prisma.publishedPost.findFirst({
      where: { id: postId, brandId: id },
      include: {
        media: { orderBy: { order: "asc" } },
        _count: { select: { comments: true } },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Published post not found" }, { status: 404 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // PATCH must not accept client-provided media or payload fields. Media URLs
    // are owned by the server (remote SFTP) and must be preserved from the
    // stored jsonPayload, never supplied by the client.
    const FORBIDDEN_FIELDS = [
      "media",
      "files",
      "jsonPayload",
      "media_url",
      "video_url",
      "thumbnail_url",
    ];
    const forbidden = FORBIDDEN_FIELDS.filter((f) => f in body);
    if (forbidden.length > 0) {
      return NextResponse.json(
        { error: `Cannot edit protected fields: ${forbidden.join(", ")}.` },
        { status: 400 },
      );
    }

    // ── Validate editable fields ──────────────────────────────────────────────
    const updateData = {};

    // Platform: normalize case, reject unsupported values. Fall back to existing
    // platform when not provided in the request body.
    const rawPlatform = body.platform !== undefined ? body.platform : existing.platform;
    const finalPlatform = normalizePublishedPostPlatform(rawPlatform);
    if (!finalPlatform) {
      return NextResponse.json(
        { error: "Unsupported platform. Must be Instagram or LinkedIn." },
        { status: 400 },
      );
    }

    // Post type: normalize (video -> reel). Fall back to existing when not provided.
    let finalPostType = existing.postType;
    if (body.postType !== undefined) {
      const normalized = normalizePostType(body.postType);
      if (!normalized) {
        return NextResponse.json({
          error: "Invalid postType. Must be one of: static, carousel, reel, video",
        }, { status: 400 });
      }
      finalPostType = normalized;
    }

    // ── Validate resulting platform + postType against existing media ──────────
    // PATCH does not replace media, so the existing media must already be
    // compatible with the requested platform/postType combination.
    const existingMedia = existing.media || [];
    const isPdfLike = (m) =>
      (m.fileType && m.fileType.toLowerCase() === "application/pdf") ||
      (m.fileName && m.fileName.toLowerCase().endsWith(".pdf")) ||
      (m.url && m.url.toLowerCase().endsWith(".pdf"));
    const isPdfDocument =
      existingMedia.length === 1 &&
      existingMedia[0].mediaType === "document" &&
      isPdfLike(existingMedia[0]);

    if (finalPlatform === "LinkedIn") {
      // PATCH does not replace media, so the existing single media record must
      // already match the requested LinkedIn post type exactly.
      if (finalPostType === POST_TYPE_CAROUSEL) {
        if (!isPdfDocument) {
          return NextResponse.json(
            {
              error:
                "This post's existing media is not compatible with a LinkedIn PDF carousel.",
            },
            { status: 400 },
          );
        }
      } else if (finalPostType === POST_TYPE_REEL) {
        if (
          existingMedia.length !== 1 ||
          existingMedia[0].mediaType !== "VIDEO"
        ) {
          return NextResponse.json(
            { error: "LinkedIn video posts require exactly one video file." },
            { status: 400 },
          );
        }
      } else if (finalPostType === POST_TYPE_STATIC) {
        if (
          existingMedia.length !== 1 ||
          existingMedia[0].mediaType !== "IMAGE"
        ) {
          return NextResponse.json(
            { error: "LinkedIn single-image posts require exactly one image file." },
            { status: 400 },
          );
        }
      } else {
        return NextResponse.json(
          { error: "Unsupported LinkedIn post type." },
          { status: 400 },
        );
      }
    } else {
      // Instagram
      if (isPdfDocument) {
        return NextResponse.json(
          {
            error:
              "LinkedIn PDF media cannot be converted to an Instagram post without replacing the media.",
          },
          { status: 400 },
        );
      }
      if (finalPostType === POST_TYPE_REEL) {
        if (
          existingMedia.length === 0 ||
          !existingMedia.some((m) => m.mediaType === "VIDEO")
        ) {
          return NextResponse.json(
            { error: "Instagram reel posts require video media." },
            { status: 400 },
          );
        }
      } else if (
        finalPostType === POST_TYPE_STATIC ||
        finalPostType === POST_TYPE_CAROUSEL
      ) {
        if (
          existingMedia.length > 0 &&
          !existingMedia.some((m) => m.mediaType === "IMAGE")
        ) {
          return NextResponse.json(
            { error: "Instagram image posts require image media." },
            { status: 400 },
          );
        }
      }
    }

    updateData.platform = finalPlatform;
    updateData.postType = finalPostType;

    if (body.caption !== undefined) {
      updateData.caption = body.caption || null;
    }

    if (body.scheduledDate !== undefined) {
      if (!body.scheduledDate || body.scheduledDate === "") {
        updateData.scheduledDate = null;
      } else {
        const date = normalizeScheduledDate(body.scheduledDate);
        if (!date) {
          return NextResponse.json({ error: "Invalid scheduled date." }, { status: 400 });
        }
        updateData.scheduledDate = date;
      }
    }

    if (body.notes !== undefined) {
      updateData.notes = body.notes || null;
    }

    if (body.status !== undefined) {
      updateData.status = isValidStatus(body.status) ? body.status : "draft";
    }

    // ── Update post ───────────────────────────────────────────────────────────
    const updated = await prisma.publishedPost.update({
      where: { id: postId },
      data: updateData,
    });

    // ── Rebuild jsonPayload with updated fields ───────────────────────────────
    // Preserve the exact public media URLs already stored in jsonPayload. The
    // Prisma media rows hold local /uploads paths, so we must NOT rebuild from
    // them directly during a metadata-only edit.
    const existingPayload = safeParseJson(existing.jsonPayload);
    if (!existingPayload) {
      console.warn(
        `[PublishedPosts] post ${postId} missing or invalid jsonPayload;` +
          ` falling back to Prisma media URLs for rebuild.`,
      );
    }

    const remoteAwareMedia = buildRemoteAwareMedia(existing.media, existingPayload);

    // Prefer the stored public thumbnail URL; fall back to the DB thumbnail.
    const storedThumb = existingPayload?.thumbnail_url;
    const thumbnailUrl = isCanonicalMediaUrl(storedThumb)
      ? storedThumb
      : existing.thumbnailUrl;

    const payload = buildN8nPayload(
      {
        ...updated,
        thumbnailUrl,
        webhookSentAt: existingPayload?.["Webhook Sent At"],
        errorLog: existingPayload?.["Error Log"],
        payloadData: existingPayload?.data,
        payloadOutput: existingPayload?.output,
        fromSmartcc: existingPayload?.from_smartcc,
      },
      remoteAwareMedia,
      brand.name,
    );
    const payloadJson = payload ? JSON.stringify(payload, null, 2) : null;

    await prisma.publishedPost.update({
      where: { id: postId },
      data: { jsonPayload: payloadJson },
    });

    // ── Notify n8n of the edit ───────────────────────────────────────────────
    // Same fire-and-forget contract as publish: the edit is already saved above,
    // so a webhook failure is reported back but never rolls back or blocks it.
    let webhookResult = null;
    try {
      webhookResult = await sendPublishedPostToN8n({
        post: { ...updated, jsonPayload: payloadJson },
        media: remoteAwareMedia,
        brandName: brand.name,
      });
    } catch (webhookError) {
      webhookResult = { success: false, error: "Failed to send to n8n webhook." };
      console.error("[PublishedPosts] n8n webhook send failed on edit", {
        postId,
        error: webhookError?.message,
      });
    }

    // Same serializer as the list/single-item read paths, so an edited post is
    // shaped exactly like it will be on the next page load.
    const result = serializePublishedPost({
      ...updated,
      jsonPayload: payloadJson,
      media: remoteAwareMedia,
      _count: existing._count,
    });

    return NextResponse.json({ ...result, webhookResult });
  } catch (error) {
    console.error("[PublishedPosts] update failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update failed" },
      { status: 500 },
    );
  }
}
