import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBrandAccess } from "@/lib/brand-access";
import { buildCanonicalPublishPayload } from "@/lib/published-post-utils";
import { buildSchedulePresentation } from "@/lib/timezone";
import { viewablePublishedPostWhere } from "@/lib/published-post-collaborators";

// READ-ONLY preview of the canonical publish payload for a SAVED post.
//
// The JSON viewer, Copy JSON and Download JSON all use this response, so the
// four schedule fields (Scheduled Date, scheduled_date_utc, brand_timezone,
// brand_local_publish_datetime) come from the server's timezone database via
// the exact builder sendPublishedPostToN8n uses — never from the browser.
//
// It never sends to n8n, never uploads media and never writes to the DB. It is
// a preview of what would be sent NOW for the current saved state, not a record
// of an earlier delivery (e.g. "Webhook Sent At" reflects the stored value).

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function GET(request, { params }) {
  const { id, postId } = await params;

  const brandAccess = await requireBrandAccess(id);
  if (!brandAccess.ok) return json({ error: brandAccess.error }, brandAccess.status);

  // Same read rule as GET /published-posts/[postId]: the post's own Brand, or an
  // Instagram collaborator Brand (read-only). Unrelated/guessed ids → 404.
  const post = await prisma.publishedPost.findFirst({
    where: viewablePublishedPostWhere(id, postId),
    include: {
      media: { orderBy: { order: "asc" } },
      brand: { select: { id: true, name: true, timezone: true } },
    },
  });
  if (!post) return json({ error: "Published post not found" }, 404);

  // The OWNING Brand is authoritative, exactly as in the send-webhook route.
  const owner = post.brand;
  if (!owner) return json({ error: "Brand not found" }, 404);

  const built = buildCanonicalPublishPayload({
    post,
    media: post.media || [],
    brandName: owner.name,
    brandTimezone: owner.timezone,
  });
  if (!built.ok) return json({ error: built.error, code: built.code }, 500);

  return json({
    postId: post.id,
    payload: built.payload,
    rebuilt: built.rebuilt,
    schedule: buildSchedulePresentation(post.scheduledDate, owner.timezone ?? null),
  });
}
