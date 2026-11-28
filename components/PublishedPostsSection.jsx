"use client";

import { useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { toast } from "sonner";
import { MessageCircle, CheckCircle } from "lucide-react";
import PublishedPostUploadForm from "@/components/PublishedPostUploadForm";
import PostDetailModal from "@/components/PostDetailModal";
import PublishedPostCommentsPanel from "@/components/PublishedPostCommentsPanel";
import { SectionLabel } from "@/components/content-report/SectionLabel";
import { resolveBrandTimezone } from "@/lib/timezone";
import { getSavedPostFooterState } from "@/lib/published-post-footer";
import { sortPublishedPosts } from "@/lib/published-post-order";
import { CollaborationBadge } from "@/components/CollaboratorBrandPicker";
import { DeliveryModeBadge } from "@/components/DeliveryMode";

const lbl = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--sketch-ink-faint)",
};

const inkBtn = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  padding: "4px 10px",
  border: "1px solid var(--sketch-ink)",
  background: "transparent",
  color: "var(--sketch-ink-soft)",
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
};

function MediaPlaceholder() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "repeating-linear-gradient(45deg, var(--sketch-paper-raw) 0 6px, var(--sketch-paper-bright) 6px 12px)",
      }}
    >
      <span style={{ ...lbl, fontSize: 9 }}>No preview</span>
    </div>
  );
}

function GridCard({ post, timeZone, onClick, onCommentClick }) {
  const firstMedia = post.media?.[0];
  const isCarousel = post.postType === "carousel" || (post.media?.length || 0) > 1;
  const isVideo = post.postType === "reel" || firstMedia?.mediaType === "VIDEO";
  const thumbnailUrl = post.thumbnailUrl;
  const postId = formatPostIdShort(post.postNumber);
  // Server-built schedule only (owning Brand's zone) — no browser conversion.
  const footerState = getSavedPostFooterState(post);
  // A media file can still be unreachable (an old post whose upload to the
  // public media server never completed). Fall back to the placeholder rather
  // than leaving a broken-image icon in the grid. Tracking the failed URL
  // rather than a flag means a later edit that changes the URL retries it.
  const [failedSrc, setFailedSrc] = useState(null);
  // A video's poster and the video itself are separate fetches. If only the
  // poster is unreachable, fall through to the video rather than giving up:
  // the poster is decoration, the video is the content.
  const [posterFailed, setPosterFailed] = useState(null);

  const usePoster = isVideo && thumbnailUrl && posterFailed !== thumbnailUrl;
  const previewSrc =
    firstMedia?.mediaType === "IMAGE"
      ? firstMedia.url
      : isVideo
      ? (usePoster ? thumbnailUrl : firstMedia?.url) || null
      : null;
  const mediaFailed = previewSrc != null && failedSrc === previewSrc;

  return (
    <div
      title={`${postId || ""} ${post.caption?.slice(0, 60) || ""}`}
      onClick={onClick}
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "3 / 4",
        border: "1px solid var(--sketch-line)",
        overflow: "hidden",
        background: "var(--sketch-paper-bright)",
        cursor: "pointer",
      }}
    >
      {mediaFailed ? (
        <MediaPlaceholder />
      ) : firstMedia && firstMedia.mediaType === "IMAGE" ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={firstMedia.url}
          alt={post.caption || "Post media"}
          onError={() => setFailedSrc(previewSrc)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : usePoster ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={thumbnailUrl}
          alt={post.caption || "Video thumbnail"}
          onError={() => setPosterFailed(thumbnailUrl)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : isVideo && firstMedia?.url ? (
        <video
          src={firstMedia.url}
          muted
          preload="metadata"
          onError={() => setFailedSrc(previewSrc)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        <MediaPlaceholder />
      )}

      {/* Collaboration marker (separate from the publishing state below) */}
      {post.isCollaboration && (
        <CollaborationBadge style={{ position: "absolute", top: 6, left: 6 }} />
      )}

      {/* Delivery mode (Trial / Save Only / Production). Legacy posts: none. */}
      <DeliveryModeBadge mode={post.deliveryMode} style={{ position: "absolute", top: 6, right: 6 }} />

      {/* Bottom overlay with post ID, publishing state, comment button, media indicators */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          background: "rgba(28,24,18,0.55)",
          padding: "4px 8px",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {postId && (
          <span
            style={{
              fontFamily: "var(--font-mono-ink)",
              fontSize: 8,
              color: "var(--sketch-paper-bright)",
              flexShrink: 0,
            }}
          >
            {postId}
          </span>
        )}
        <span
          aria-label={footerState.ariaLabel}
          style={{
            fontFamily: "var(--font-mono-ink)",
            fontSize: 7,
            color: "var(--sketch-paper-bright)",
            opacity: 0.85,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: "1 1 auto",
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 3,
          }}
        >
          {footerState.type === "posted" && <CheckCircle size={10} aria-hidden="true" />}
          {footerState.type === "scheduled" && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          )}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{footerState.label}</span>
        </span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCommentClick(post);
            }}
            aria-label={"Comments for " + (postId || "Instagram post")}
            style={{
              fontFamily: "var(--font-mono-ink)",
              fontSize: 11,
              fontWeight: 600,
              color: "var(--sketch-paper-bright)",
              background: "rgba(247,244,236,0.12)",
              backdropFilter: "blur(2px)",
              WebkitBackdropFilter: "blur(2px)",
              border: "1px solid rgba(247,244,236,0.25)",
              borderRadius: 4,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
              minWidth: 44,
              minHeight: 44,
              padding: "0 10px",
              lineHeight: 1,
              boxShadow: "1px 1px 0 rgba(0,0,0,0.15)",
              transition: "background 140ms ease",
              userSelect: "none",
              WebkitUserSelect: "none",
            }}
          >
            <MessageCircle size={20} />
            <span>{post.commentCount ?? 0}</span>
          </button>
          {isVideo && (
            <span
              style={{
                fontFamily: "var(--font-mono-ink)",
                fontSize: 10,
                color: "var(--sketch-paper-bright)",
                lineHeight: 1,
              }}
            >
              {"\u25B6"}
            </span>
          )}
          {isCarousel && (
            <span
              style={{
                fontFamily: "var(--font-mono-ink)",
                fontSize: 10,
                color: "var(--sketch-paper-bright)",
                lineHeight: 1,
              }}
            >
              {"\u25A3"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function formatPostIdShort(postNumber) {
  if (postNumber == null) return null;
  return `P-${String(postNumber).padStart(3, "0")}`;
}

const PublishedPostsSection = forwardRef(function PublishedPostsSection({ brand, onCrossPlatformPostCreated }, ref) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);
  const [commentsPost, setCommentsPost] = useState(null);
  // The trial result of a Trial-mode upload/adaptation, shown once in that
  // post's detail modal ({ postId, trial }). Cleared on close/edit/other post.
  const [trialHandoff, setTrialHandoff] = useState(null);
  function openWithTrial(post, extra) {
    if (extra?.publishingMode !== "trial" || !post) return;
    setTrialHandoff({ postId: post.id, trial: extra.trial ?? null });
    setSelectedPost(post);
  }

  // ── Collaboration posts ────────────────────────────────────────────────────
  // A post may be owned by another brand and only shown here as a collaborator.
  // Manage actions (edit/delete/thumbnail/n8n/adapt/comments) always go to the
  // OWNING brand's URL; the server re-checks access to it. A viewer without
  // access to the owner gets a read-only modal and read-only comments, routed
  // through this brand's URL (which the server allows for viewing only).
  function apiBrandIdFor(post) {
    if (!post || post.canManage === false) return brand.id;
    return post.brandId || brand.id;
  }

  function isReadOnly(post) {
    return post?.canManage === false;
  }

  // The schedule belongs to the owning brand, so show it in that brand's zone.
  function timezoneFor(post) {
    if (post?.brandId && post.brandId !== brand.id && post.primaryBrand) {
      return post.primaryBrand.timezone;
    }
    return brand.timezone;
  }

  function belongsInThisGrid(post) {
    if (!post) return false;
    if (!post.brandId || post.brandId === brand.id) return true;
    return (
      post.platform === "Instagram" &&
      (post.collaboratorBrands || []).some((b) => b.id === brand.id)
    );
  }

  function addPostToSection(post, _linkedInRetention, extra) {
    setPosts((prev) => {
      const exists = prev.some((p) => p.id === post.id);
      if (exists) return prev.map((p) => (p.id === post.id ? post : p));
      return sortPublishedPosts([{ ...post, commentCount: post.commentCount ?? 0 }, ...prev]);
    });
    openWithTrial(post, extra);
  }

  useImperativeHandle(ref, () => ({
    addPost: addPostToSection,
  }));

  function handleCountChange(newCount) {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === commentsPost.id ? { ...p, commentCount: newCount } : p
      )
    );
    setCommentsPost((prev) =>
      prev ? { ...prev, commentCount: newCount } : prev
    );
  }

  function getPostLabel(post) {
    if (!post) return "Instagram post";
    const shortId = formatPostIdShort(post.postNumber);
    if (shortId) return shortId;
    if (post.caption) return post.caption.slice(0, 60) + (post.caption.length > 60 ? "\u2026" : "");
    return "Instagram post";
  }

  useEffect(() => {
    fetch(`/api/brands/${brand.id}/published-posts?platform=Instagram`)
      .then((r) => r.json())
      .then((data) => {
        setPosts(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        setPosts([]);
      })
      .finally(() => setLoading(false));
  }, [brand.id]);

  function handleCreated(newPost, extra) {
    setPosts((prev) => sortPublishedPosts([{ ...newPost, commentCount: newPost.commentCount ?? 0 }, ...prev]));
    setShowForm(false);
    openWithTrial(newPost, extra);
  }

  function handleUpdated(updatedPost) {
    // Some responses (thumbnail, send-webhook) do not carry the collaboration
    // fields; keep the ones we already have unless the response replaces them.
    const previous = posts.find((p) => p.id === updatedPost.id);
    const merged = previous ? { ...previous, ...updatedPost } : updatedPost;

    if (!belongsInThisGrid(merged)) {
      // e.g. this brand was removed as a collaborator: drop it from this grid.
      setPosts((prev) => prev.filter((p) => p.id !== merged.id));
      setSelectedPost(null);
      return;
    }
    setPosts((prev) =>
      sortPublishedPosts(prev.map((p) => (p.id === merged.id ? merged : p)))
    );
    setTrialHandoff(null); // an edit/send makes the upload's trial result stale
    setSelectedPost(merged);
  }

  function handleCrossPlatformCreated(createdPost, linkedInRetention, extra) {
    // LinkedIn retention removed the new copy itself: only pass the pruning on.
    if (!createdPost) {
      onCrossPlatformPostCreated?.(null, linkedInRetention);
      return;
    }
    // An adaptation of a collaboration post is created under its owning brand;
    // it does not belong in this brand's sections.
    if (createdPost.brandId && createdPost.brandId !== brand.id) return;
    if (createdPost.platform === "Instagram") {
      addPostToSection(createdPost, null, extra);
    } else {
      onCrossPlatformPostCreated?.(createdPost, linkedInRetention, extra);
    }
  }

  function handleDeleted(deletedId, linkedInRetention) {
    setPosts((prev) => prev.filter((p) => p.id !== deletedId));
    // An Instagram post edited into LinkedIn can trigger LinkedIn retention;
    // let the LinkedIn section drop whatever it removed.
    if (linkedInRetention?.deletedIds?.length) onCrossPlatformPostCreated?.(null, linkedInRetention);
  }

  return (
    <section style={{ marginTop: 36 }}>
      {/* Section header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand-icons/instagram.png"
            alt=""
            width={22}
            height={22}
            style={{ display: "inline-block", flexShrink: 0, objectFit: "contain" }}
          />
          <SectionLabel meta={`${posts.length} total`}>Instagram Published Posts</SectionLabel>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            style={{
              ...inkBtn,
              borderColor: "var(--sketch-vermilion)",
              background: "var(--sketch-vermilion)",
              color: "var(--sketch-paper-bright)",
            }}
          >
            + Upload Post
          </button>
        )}
      </div>

      <div style={{ ...lbl, marginBottom: 16, lineHeight: 1.5 }}>
        Manually uploaded posts for publishing, review, and future automation.
      </div>

      {/* Upload form */}
      {showForm && (
        <PublishedPostUploadForm
          brandId={brand.id}
          brandTimezone={brand.timezone}
          onCreated={handleCreated}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Loading */}
      {loading && (
        <div style={{ padding: "24px 0", textAlign: "center", ...lbl }}>
          Loading posts\u2026
        </div>
      )}

      {/* Empty state */}
      {!loading && posts.length === 0 && !showForm && (
        <div
          style={{
            border: "2px dashed var(--sketch-line)",
            padding: "40px 0",
            textAlign: "center",
          }}
        >
          <div style={{ fontFamily: "var(--font-mono-ink)", fontSize: 12, fontWeight: 500, color: "var(--sketch-ink-faint)", marginBottom: 6 }}>
            No published posts yet
          </div>
          <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 13, color: "var(--sketch-ink-faint)", marginBottom: 16 }}>
            Upload static, carousel, or reel/video posts for this brand.
          </div>
          <button
            onClick={() => setShowForm(true)}
            style={{ ...inkBtn, borderColor: "var(--sketch-vermilion)", color: "var(--sketch-vermilion)" }}
          >
            Upload First Post
          </button>
        </div>
      )}

      {/* Grid */}
      {posts.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 6,
          }}
        >
          {posts.map((post) => (
            <GridCard
              key={post.id}
              post={post}
              timeZone={resolveBrandTimezone(timezoneFor(post))}
              onClick={() => { setTrialHandoff(null); setSelectedPost(post); }}
              onCommentClick={(p) => setCommentsPost(p)}
            />
          ))}
        </div>
      )}

      {/* Post detail modal */}
      {selectedPost && (
        <PostDetailModal
          post={selectedPost}
          brandId={apiBrandIdFor(selectedPost)}
          brandTimezone={timezoneFor(selectedPost)}
          readOnly={isReadOnly(selectedPost)}
          initialTrial={trialHandoff?.postId === selectedPost.id ? trialHandoff.trial : null}
          onClose={() => { setSelectedPost(null); setTrialHandoff(null); }}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
          onCrossPlatformCreated={handleCrossPlatformCreated}
        />
      )}

      {/* Comments panel */}
      {commentsPost && (
        <PublishedPostCommentsPanel
          key={commentsPost.id}
          brandId={apiBrandIdFor(commentsPost)}
          readOnly={isReadOnly(commentsPost)}
          postId={commentsPost.id}
          postLabel={getPostLabel(commentsPost)}
          initialCommentCount={commentsPost.commentCount ?? 0}
          onCountChange={handleCountChange}
          onClose={() => setCommentsPost(null)}
        />
      )}
    </section>
  );
});

export default PublishedPostsSection;
