import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendPublishedPostToN8n } from "@/lib/published-post-webhook";

export async function POST(request, { params }) {
  try {
    const { id, postId } = await params;

    const post = await prisma.publishedPost.findUnique({
      where: { id: postId },
      include: {
        media: { orderBy: { order: "asc" } },
      },
    });

    if (!post || post.brandId !== id) {
      return NextResponse.json({ error: "Published post not found." }, { status: 404 });
    }

    const brand = await prisma.brand.findUnique({ where: { id: post.brandId } });
    if (!brand) {
      return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    }

    const result = await sendPublishedPostToN8n({
      post,
      media: post.media || [],
      brandName: brand.name,
    });

    if (!result.success) {
      const STATUS_MAP = {
        N8N_WEBHOOK_NOT_CONFIGURED: 503,
        N8N_WEBHOOK_TIMEOUT: 504,
        N8N_WEBHOOK_FAILED: 502,
      };
      const status = STATUS_MAP[result.code] ?? 502;
      return NextResponse.json(result, { status });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("[PublishedPosts] n8n webhook send failed", error);
    return NextResponse.json(
      { error: "Failed to send to n8n webhook." },
      { status: 500 },
    );
  }
}
