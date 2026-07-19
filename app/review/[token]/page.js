import { resolveWorkspaceReviewAccess } from "@/lib/workspace-review-access";
import { loadWorkspaceReviewPublicData } from "@/lib/workspace-review-public-data";
import ReviewPageClient from "./ReviewPageClient";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }) {
  const { token } = await params;

  const access = await resolveWorkspaceReviewAccess(token);

  if (!access.ok) {
    if (access.code === "revoked") {
      return <ErrorPage message="This review link has been revoked by the workspace owner." />;
    }
    if (access.code === "expired") {
      return <ErrorPage message="This review link has expired." />;
    }
    return <ErrorPage message="This review link is invalid or does not exist." />;
  }

  const data = await loadWorkspaceReviewPublicData(access.review);

  if (!data.brand) {
    return <ErrorPage message="The brand associated with this review could not be found." />;
  }

  return (
    <ReviewPageClient
      brand={data.brand}
      review={access.review}
      calendars={data.calendars}
      instagramPosts={data.instagramPosts}
      linkedinPosts={data.linkedinPosts}
    />
  );
}

function ErrorPage({ message }) {
  return (
    <div style={{ padding: "60px 44px", textAlign: "center" }}>
      <h1 style={{
        margin: 0,
        fontFamily: "var(--font-display)",
        fontWeight: 900,
        fontSize: 36,
        lineHeight: 0.9,
        textTransform: "uppercase",
        color: "var(--sketch-ink)",
      }}>
        Review Link
      </h1>
      <div style={{ borderBottom: "2px solid var(--sketch-vermilion)", width: 120, margin: "12px auto 24px" }} />
      <div style={{
        fontFamily: "var(--font-serif)",
        fontStyle: "italic",
        fontSize: 15,
        color: "var(--sketch-ink-faint)",
        maxWidth: 420,
        margin: "0 auto",
        lineHeight: 1.6,
      }}>
        {message}
      </div>
    </div>
  );
}
