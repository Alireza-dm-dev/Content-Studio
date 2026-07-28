"use client";

import { useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { toast } from "sonner";
import { MessageCircle, CheckCircle } from "lucide-react";
import PublishedPostUploadForm from "@/components/PublishedPostUploadForm";
import PostDetailModal from "@/components/PostDetailModal";
import PublishedPostCommentsPanel from "@/components/PublishedPostCommentsPanel";
import { SectionLabel } from "@/components/content-report/SectionLabel";
import { getPublishedPostFooterState } from "@/lib/published-post-footer";

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

function GridCard({ post, onClick, onCommentClick }) {
  const firstMedia = post.media?.[0];
  const isCarousel = post.postType === "carousel" || (post.media?.length || 0) > 1;
  const isVideo = post.postType === "reel" || firstMedia?.mediaType === "VIDEO";
  const thumbnailUrl = post.thumbnailUrl;
  const postId = formatPostIdShort(post.postNumber);
  const footerState = getPublishedPostFooterState(post);

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
      {firstMedia && firstMedia.mediaType === "IMAGE" ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={firstMedia.url}
          alt={post.caption || "Post media"}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : isVideo && thumbnailUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={thumbnailUrl}
          alt={post.caption || "Video thumbnail"}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : isVideo ? (
        <video
          src={firstMedia?.url}
          muted
          preload="metadata"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
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
      )}

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

  function addPostToSection(post) {
    setPosts((prev) => {
      const exists = prev.some((p) => p.id === post.id);
      if (exists) return prev.map((p) => (p.id === post.id ? post : p));
      return [{ ...post, commentCount: post.commentCount ?? 0 }, ...prev];
    });
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

  function handleCreated(newPost) {
    setPosts((prev) => [{ ...newPost, commentCount: newPost.commentCount ?? 0 }, ...prev]);
    setShowForm(false);
  }

  function handleUpdated(updatedPost) {
    setPosts((prev) =>
      prev.map((p) => (p.id === updatedPost.id ? updatedPost : p))
    );
    setSelectedPost(updatedPost);
  }

  function handleCrossPlatformCreated(createdPost) {
    if (createdPost.platform === "Instagram") {
      addPostToSection(createdPost);
    } else {
      onCrossPlatformPostCreated?.(createdPost);
    }
  }

  function handleDeleted(deletedId) {
    setPosts((prev) => prev.filter((p) => p.id !== deletedId));
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
              onClick={() => setSelectedPost(post)}
              onCommentClick={(p) => setCommentsPost(p)}
            />
          ))}
        </div>
      )}

      {/* Post detail modal */}
      {selectedPost && (
        <PostDetailModal
          post={selectedPost}
          brandId={brand.id}
          onClose={() => setSelectedPost(null)}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
          onCrossPlatformCreated={handleCrossPlatformCreated}
        />
      )}

      {/* Comments panel */}
      {commentsPost && (
        <PublishedPostCommentsPanel
          key={commentsPost.id}
          brandId={brand.id}
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
