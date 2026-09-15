import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBrandAccess } from "@/lib/brand-access";
import { sendPublishedPostToN8n } from "@/lib/published-post-webhook";
import {
  uploadPublishedPostMedia,
  isCanonicalMediaUrl,
  getEnvConfig,
} from "@/lib/published-post-remote-media";
import { buildN8nPayload, serializePublishedPost } from "@/lib/published-post-utils";

function hasCanonicalUrlsInStoredPayload(post) {
  if (!post.jsonPayload) return false;
  try {
    const p = typeof post.jsonPayload === "string"
      ? JSON.parse(post.jsonPayload)
      : post.jsonPayload;
    if (p.video_url && !isCanonicalMediaUrl(p.video_url)) return false;
    if (p.thumbnail_url && !isCanonicalMediaUrl(p.thumbnail_url)) return false;
    if (Array.isArray(p.files)) {
      for (const f of p.files) {
        if (f.image_url && !isCanonicalMediaUrl(f.image_url)) return false;
        if (f.video_url && !isCanonicalMediaUrl(f.video_url)) return false;
        if (f.document_url && !isCanonicalMediaUrl(f.document_url)) return false;
      }
    }
    if (Array.isArray(p.media)) {
      for (const m of p.media) {
        if (!isCanonicalMediaUrl(m.url)) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function reloadPost(postId) {
  return prisma.publishedPost.findUnique({
    where: { id: postId },
    include: { media: { orderBy: { order: "asc" } } },
  });
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
    const startedAt = Date.now();
    console.log("[SendWebhook] request received", { brandId: id, postId });

    let post = await reloadPost(postId);

    if (!post || post.brandId !== id) {
      console.warn("[SendWebhook] post not found or brand mismatch", {
        brandId: id,
        postId,
        found: Boolean(post),
        postBrandId: post?.brandId ?? null,
      });
      return NextResponse.json({ error: "Published post not found." }, { status: 404 });
    }

    const brand = await prisma.brand.findUnique({ where: { id: post.brandId } });
    if (!brand) {
      console.warn("[SendWebhook] brand not found", { brandId: post.brandId, postId });
      return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    }

    const payloadHasCanonicalUrls = hasCanonicalUrlsInStoredPayload(post);
    console.log("[SendWebhook] post loaded", {
      postId,
      postNumber: post.postNumber,
      brand: brand.name,
      mediaCount: (post.media || []).length,
      hasThumbnail: Boolean(post.thumbnailUrl),
      hasStoredPayload: Boolean(post.jsonPayload),
      payloadHasCanonicalUrls,
      willUploadMedia: !payloadHasCanonicalUrls,
    });

    // Upload to remote media server when stored payload lacks canonical public URLs
    if (!payloadHasCanonicalUrls) {
      const sftpConfig = getEnvConfig();
      console.log("[SendWebhook] uploading media to remote server", {
        postId,
        host: sftpConfig.host || "(missing)",
        port: sftpConfig.port,
        user: sftpConfig.user || "(missing)",
        passwordSet: Boolean(sftpConfig.password),
        remoteBase: sftpConfig.remoteBase,
        publicBase: sftpConfig.publicBase,
        files: (post.media || []).map((m) => ({
          order: m.order,
          type: m.mediaType,
          url: m.url,
        })),
      });

      const remoteResult = await uploadPublishedPostMedia({
        post,
        mediaRecords: post.media || [],
        brandId: id,
      });

      if (!remoteResult.success) {
        console.error("[SendWebhook] remote media upload failed", {
          postId,
          detailCode: remoteResult.detailCode,
          error: remoteResult.error,
          skipped: remoteResult.skipped,
          localPath: remoteResult.localPath,
          durationMs: Date.now() - startedAt,
        });
        // Still return the saved post with the error
        const savedPost = await reloadPost(postId);
        return NextResponse.json(
          {
            success: false,
            webhookResult: {
              success: false,
              code: "REMOTE_MEDIA_UPLOAD_FAILED",
              error: "The post's media could not be uploaded to the public media server.",
              detailCode: remoteResult.detailCode || "SFTP_UPLOAD_FAILED",
              details: remoteResult.error || remoteResult.details || remoteResult.detailCode || null,
              ...(remoteResult.fileSize != null ? { fileSize: remoteResult.fileSize } : {}),
              ...(remoteResult.duration != null ? { duration: remoteResult.duration } : {}),
              skipped: Boolean(remoteResult.skipped),
            },
            post: serializePublishedPost(savedPost),
          },
          { status: 503 },
        );
      }

      // Verify media count match — do not persist a partial mapping
      const expectedCount = (post.media || []).length;
      if (remoteResult.media.length !== expectedCount) {
        console.error("[SendWebhook] remote media count mismatch", {
          detailCode: "SFTP_MEDIA_COUNT_MISMATCH",
          expected: expectedCount,
          got: remoteResult.media.length,
        });
        const savedPost = await reloadPost(postId);
        return NextResponse.json(
          {
            success: false,
            webhookResult: {
              success: false,
              code: "REMOTE_MEDIA_UPLOAD_FAILED",
              error: "The post's media could not be uploaded to the public media server.",
              detailCode: "SFTP_MEDIA_COUNT_MISMATCH",
              details: `Remote media count mismatch: expected ${expectedCount}, got ${remoteResult.media.length}`,
            },
            post: savedPost,
          },
          { status: 503 },
        );
      }

      console.log("[SendWebhook] remote media upload succeeded", {
        postId,
        uploaded: remoteResult.media.length,
        thumbnailUrl: remoteResult.thumbnailUrl || null,
        urls: remoteResult.media.map((m) => m.fileUrl),
        durationMs: Date.now() - startedAt,
      });

      // Rebuild payload with remote URLs and persist
      const remoteUrlByOrder = {};
      for (const r of remoteResult.media) {
        remoteUrlByOrder[r.order] = r;
      }

      const updatedThumbnail = remoteResult.thumbnailUrl || post.thumbnailUrl;

      // Reload post to get clean state before persisting remote URLs
      post = await reloadPost(postId);
      if (!post) {
        return NextResponse.json({ error: "Published post not found." }, { status: 404 });
      }

      const updatedMedia = (post.media || []).map((m) => {
        const remote = remoteUrlByOrder[m.order];
        return remote ? { ...m, url: remote.fileUrl, remoteUrl: remote.fileUrl } : m;
      });

      const remotePayload = buildN8nPayload(
        { ...post, thumbnailUrl: updatedThumbnail },
        updatedMedia,
        brand.name,
      );
      const payloadJson = remotePayload
        ? JSON.stringify(remotePayload, null, 2)
        : null;

      if (payloadJson) {
        await prisma.publishedPost.update({
          where: { id: postId },
          data: { jsonPayload: payloadJson, thumbnailUrl: updatedThumbnail },
        });
      }

      // Reload after persistence so the returned post matches DB
      const persisted = await reloadPost(postId);
      if (persisted) {
        const finalMedia = (persisted.media || []).map((m) => {
          const remote = remoteUrlByOrder[m.order];
          return remote ? { ...m, url: remote.fileUrl, remoteUrl: remote.fileUrl } : m;
        });
        post = { ...persisted, media: finalMedia };
      }
    }

    console.log("[SendWebhook] posting payload to n8n", {
      postId,
      brand: brand.name,
      mediaCount: (post.media || []).length,
    });

    const webhookResult = await sendPublishedPostToN8n({
      post,
      media: post.media || [],
      brandName: brand.name,
    });

    const webhookLog = {
      postId,
      success: webhookResult.success,
      code: webhookResult.code || null,
      httpStatus: webhookResult.webhookStatus ?? null,
      error: webhookResult.error || null,
      details: webhookResult.details || null,
      durationMs: Date.now() - startedAt,
    };
    if (webhookResult.success) {
      console.log("[SendWebhook] n8n accepted the payload", webhookLog);
    } else {
      console.error("[SendWebhook] n8n rejected the payload", webhookLog);
    }

    // Reload post to get the latest persisted state
    const latestPost = await reloadPost(postId);
    const responsePost = serializePublishedPost(latestPost || post);

    return NextResponse.json({
      success: webhookResult.success,
      webhookResult,
      post: responsePost,
    });
  } catch (error) {
    console.error("[PublishedPosts] n8n webhook send failed", error);
    // Attempt to return the post even on unexpected failure
    try {
      const { postId } = await params;
      const savedPost = await reloadPost(postId);
      if (savedPost) {
        return NextResponse.json({
          success: false,
          webhookResult: {
            success: false,
            code: "N8N_WEBHOOK_FAILED",
            error: "Failed to send to n8n webhook.",
          },
          post: savedPost,
        });
      }
    } catch {
      // fall through to generic error
    }
    return NextResponse.json(
      { error: "Failed to send to n8n webhook." },
      { status: 500 },
    );
  }
}
