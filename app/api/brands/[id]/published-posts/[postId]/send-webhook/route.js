import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBrandAccess } from "@/lib/brand-access";
import { sendPublishedPostToN8n } from "@/lib/published-post-webhook";
import { getEnvConfig } from "@/lib/published-post-remote-media";
import { serializePublishedPost } from "@/lib/published-post-utils";
import {
  preparePublicMedia,
  storedPayloadHasCanonicalUrls,
  reloadPublishedPost as reloadPost,
} from "@/lib/published-post-media-prepare";
import {
  PUBLISHING_MODE_PRODUCTION,
  isNonProductionDeliveryMode,
  PROMOTION_WARNING,
} from "@/lib/publishing-mode";

// Explicit (manual) production send. For a Trial / Save Only post this is the
// ONLY way into production: it must be confirmed ({ confirmPromotion: true })
// and an HTTP 2xx from n8n promotes the post to deliveryMode "production".
// A failed or timed-out send never promotes. Legacy (null) and production
// posts behave exactly as before.

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
    let confirmPromotion = false;
    try {
      const body = await request.json();
      confirmPromotion = body?.confirmPromotion === true;
    } catch {
      // no / non-JSON body: legacy clients
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

    const promoting = isNonProductionDeliveryMode(post.deliveryMode);
    if (promoting && !confirmPromotion) {
      // Checked before any media upload: nothing happens without confirmation.
      return NextResponse.json({
        error: PROMOTION_WARNING,
        code: "PROMOTION_CONFIRMATION_REQUIRED",
        deliveryMode: post.deliveryMode,
      }, { status: 409 });
    }

    const payloadHasCanonicalUrls = storedPayloadHasCanonicalUrls(post);
    console.log("[SendWebhook] post loaded", {
      postId,
      postNumber: post.postNumber,
      brand: brand.name,
      mediaCount: (post.media || []).length,
      hasThumbnail: Boolean(post.thumbnailUrl),
      hasStoredPayload: Boolean(post.jsonPayload),
      payloadHasCanonicalUrls,
      willUploadMedia: !payloadHasCanonicalUrls,
      deliveryMode: post.deliveryMode ?? null,
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

      const prepared = await preparePublicMedia({ post, brand, brandId: id, logPrefix: "[SendWebhook]" });
      if (prepared.notFound) {
        return NextResponse.json({ error: "Published post not found." }, { status: 404 });
      }
      if (!prepared.ok) {
        // Still return the saved post with the error
        const savedPost = await reloadPost(postId);
        return NextResponse.json(
          {
            success: false,
            webhookResult: prepared.failure,
            post: serializePublishedPost(savedPost, { brandTimezone: brand.timezone ?? null }),
          },
          { status: 503 },
        );
      }
      post = prepared.post;
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
      brandTimezone: brand.timezone,
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

    // ── Promotion (Trial / Save Only → Production) ──────────────────────────
    // Only an HTTP 2xx promotes. A timeout or network failure is NOT proof that
    // n8n received nothing: report the uncertainty, never retry, never promote.
    let promotion;
    if (promoting) {
      if (webhookResult.success) {
        try {
          await prisma.publishedPost.update({ where: { id: postId }, data: { deliveryMode: PUBLISHING_MODE_PRODUCTION } });
          promotion = { promoted: true, from: post.deliveryMode, deliveryMode: PUBLISHING_MODE_PRODUCTION };
        } catch (promotionError) {
          console.error("[SendWebhook] n8n accepted but promotion was not saved", { postId, error: promotionError?.message });
          promotion = {
            promoted: false,
            partialFailure: true,
            from: post.deliveryMode,
            deliveryMode: post.deliveryMode,
            error: "n8n accepted the request, but the post could not be switched to Production mode. Automatic production delivery on edits stays disabled. The request was not resent.",
          };
        }
      } else {
        const uncertain = webhookResult.code === "N8N_WEBHOOK_TIMEOUT" || (webhookResult.code === "N8N_WEBHOOK_FAILED" && webhookResult.webhookStatus == null);
        promotion = {
          promoted: false,
          from: post.deliveryMode,
          deliveryMode: post.deliveryMode,
          deliveryUncertain: uncertain,
          ...(uncertain
            ? { error: "Delivery is uncertain: n8n may still have received and queued this post. It was not resent automatically and stays in its current mode. Check n8n before sending again." }
            : {}),
        };
      }
    }

    // Reload post to get the latest persisted state
    const latestPost = await reloadPost(postId);
    const responsePost = serializePublishedPost(latestPost || post, { brandTimezone: brand.timezone ?? null });

    return NextResponse.json({
      success: webhookResult.success,
      webhookResult,
      post: responsePost,
      ...(promotion ? { promotion } : {}),
    });
  } catch (error) {
    console.error("[PublishedPosts] n8n webhook send failed", error);
    // Attempt to return the post even on unexpected failure
    try {
      const { postId } = await params;
      const savedPost = await reloadPost(postId);
      if (savedPost) {
        // `brand` is out of scope here; load only the owning brand's timezone.
        const owner = await prisma.brand.findUnique({ where: { id: savedPost.brandId }, select: { timezone: true } });
        return NextResponse.json({
          success: false,
          webhookResult: {
            success: false,
            code: "N8N_WEBHOOK_FAILED",
            error: "Failed to send to n8n webhook.",
          },
          post: serializePublishedPost(savedPost, { brandTimezone: owner?.timezone ?? null }),
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
