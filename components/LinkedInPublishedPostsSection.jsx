"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { SectionLabel } from "@/components/content-report/SectionLabel";
import { StatusPill } from "@/components/content-report/StatusPill";
import { FileText, Image as ImageIcon, Video as VideoIcon, MessageCircle } from "lucide-react";
import LinkedInPostUploadForm from "@/components/LinkedInPostUploadForm";
import LinkedInPostDetailModal from "@/components/LinkedInPostDetailModal";
import PublishedPostCommentsPanel from "@/components/PublishedPostCommentsPanel";

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

// Recognizable LinkedIn logo is served from /brand-icons/linkedin.png.

function formatPostIdShort(postNumber) {
  if (postNumber == null) return null;
  return `P-${String(postNumber).padStart(3, "0")}`;
}

function fmtDate(date) {
  if (!date) return "—";
  try {
    return new Date(date).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "America/Vancouver",
    });
  } catch {
    return String(date);
  }
}

// Determine the row kind using post.postType and the first media record.
// Defensive about case differences (IMAGE/image, VIDEO/video, document/DOCUMENT).
export function detectKind(post) {
  const first = post.media?.[0];
  const postType = (post.postType || "").toLowerCase();
  const mt = (first?.mediaType || "").toLowerCase();
  const fileType = (first?.fileType || "").toLowerCase();
  const fileName = (first?.fileName || "").toLowerCase();

  if (postType === "reel" || postType === "video" || mt === "video") return "video";
  if (
    postType === "carousel" &&
    (mt === "document" || fileType === "application/pdf" || fileName.endsWith(".pdf"))
  ) {
    return "pdf";
  }
  if (postType === "static" || mt === "image") return "image";
  if (mt === "document") return "pdf";
  // Legacy LinkedIn posts default to PDF behavior.
  return "pdf";
}

const KIND_META = {
  image: { label: "Single Image", Icon: ImageIcon, action: "Open Image" },
  pdf: { label: "PDF Carousel", Icon: FileText, action: "Open PDF" },
  video: { label: "Video", Icon: VideoIcon, action: "Open Video" },
};

function PostRow({ post, onOpen, onCommentClick }) {
  const kind = detectKind(post);
  const meta = KIND_META[kind] || KIND_META.pdf;
  const { Icon, label, action } = meta;

  const firstMedia = post.media?.[0];
  const fileName =
    firstMedia?.fileName || firstMedia?.url?.split("/").pop() || "file";
  const mediaUrl = firstMedia?.url;
  const postId = formatPostIdShort(post.postNumber);

  const canOpenModal =
    kind === "image" || kind === "video" || kind === "pdf";

  function handleRowKeyDown(e) {
    // Only open when the row container itself has focus, not when a nested
    // link/button is activated via the keyboard.
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen();
    }
  }

  return (
    <div
      className="li-post-row"
      role="button"
      tabIndex={0}
      aria-label={`Open LinkedIn post ${postId || ""}`}
      onClick={canOpenModal ? onOpen : undefined}
      onKeyDown={handleRowKeyDown}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        border: "1px solid var(--sketch-line)",
        background: "var(--sketch-paper-bright)",
        boxShadow: "2px 2px 0 rgba(28,24,18,0.10)",
        padding: "12px 14px",
        cursor: canOpenModal ? "pointer" : "default",
      }}
    >
      {/* Icon */}
      <div style={{ flexShrink: 0, color: "var(--sketch-ink-faint)" }}>
        <Icon size={22} aria-hidden="true" />
      </div>

      {/* Main info */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: 3,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {postId && (
            <span
              style={{
                fontFamily: "var(--font-mono-ink)",
                fontSize: 11,
                color: "var(--sketch-vermilion)",
              }}
            >
              {postId}
            </span>
          )}
          <StatusPill status={post.status} />
          <span
            style={{
              fontFamily: "var(--font-mono-ink)",
              fontSize: 9,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--sketch-ink-faint)",
            }}
          >
            {label}
          </span>
        </div>

        {post.caption ? (
          <div
            title={post.caption}
            style={{
              fontFamily: "var(--font-mono-ink)",
              fontSize: 11,
              color: "var(--sketch-ink)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {post.caption}
          </div>
        ) : (
          <div style={{ ...lbl, fontSize: 9 }}>No caption</div>
        )}

        <div
          style={{
            ...lbl,
            fontSize: 9,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={fileName}
        >
          {label}: {fileName}
        </div>

        <div style={{ ...lbl, fontSize: 9 }}>
          Scheduled: {post.scheduledDate ? fmtDate(post.scheduledDate) : "—"}
          {" · "}
          Uploaded: {fmtDate(post.createdAt)}
        </div>
      </div>

      {/* Action */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
        <button
          type="button"
          className="li-comment-btn"
          onClick={(e) => {
            e.stopPropagation();
            onCommentClick(post);
          }}
          aria-label={`Comments for ${postId || "LinkedIn post"}, ${post.commentCount ?? 0} comments`}
          style={{
            fontFamily: "var(--font-mono-ink)",
            fontSize: 11,
            fontWeight: 600,
            color: "var(--sketch-ink-soft)",
            background: "var(--sketch-paper-bright)",
            border: "1px solid var(--sketch-ink)",
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
            boxShadow: "1px 1px 0 rgba(28,24,18,0.10)",
            transition: "background 140ms ease",
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
        >
          <MessageCircle size={20} />
          <span>{post.commentCount ?? 0}</span>
        </button>
        {mediaUrl ? (
          <a
            href={mediaUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              ...inkBtn,
              borderColor: "var(--sketch-vermilion)",
              color: "var(--sketch-vermilion)",
            }}
          >
            {action}
          </a>
        ) : (
          <span style={{ ...lbl, fontSize: 9 }}>No file</span>
        )}
      </div>
    </div>
  );
}

export default function LinkedInPublishedPostsSection({ brand }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);
  const [commentsPost, setCommentsPost] = useState(null);

  function handleCountChange(newCount) {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === commentsPost.id ? { ...p, commentCount: newCount } : p
      )
    );
    setCommentsPost((prev) =>
      prev ? { ...prev, commentCount: newCount } : prev
    );
    setSelectedPost((prev) =>
      prev && prev.id === commentsPost.id ? { ...prev, commentCount: newCount } : prev
    );
  }

  function getPostLabel(post) {
    if (!post) return "LinkedIn post";
    const shortId = formatPostIdShort(post.postNumber);
    if (shortId) return shortId;
    if (post.caption) return post.caption.slice(0, 60) + (post.caption.length > 60 ? "\u2026" : "");
    return "LinkedIn post";
  }

  useEffect(() => {
    let active = true;
    fetch(`/api/brands/${brand.id}/published-posts?platform=LinkedIn`)
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        const list = Array.isArray(data) ? data : [];
        list.sort(
          (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
        );
        setPosts(list);
      })
      .catch(() => {
        if (active) setError("Failed to load LinkedIn posts.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [brand.id]);

  function handleCreated(newPost) {
    setPosts((prev) => [{ ...newPost, commentCount: newPost.commentCount ?? 0 }, ...prev]);
    setShowForm(false);
    toast.success("LinkedIn post added.");
  }

  function handleUpdated(updatedPost) {
    setPosts((prev) =>
      prev.map((p) => (p.id === updatedPost.id ? updatedPost : p)),
    );
    setSelectedPost(updatedPost);
  }

  function handleDeleted(deletedId) {
    setPosts((prev) => prev.filter((p) => p.id !== deletedId));
    setSelectedPost(null);
  }

  return (
    <section style={{ marginTop: 36 }}>
      <style>{`
        .li-post-row { display: flex; align-items: center; gap: 14px; cursor: pointer; }
        .li-post-row:hover { border-color: var(--sketch-vermilion); }
        .li-post-row:focus-visible { outline: 2px solid var(--sketch-vermilion); outline-offset: 2px; }
        .li-comment-btn:hover { background: var(--sketch-paper-raw) !important; border-color: var(--sketch-vermilion) !important; color: var(--sketch-vermilion) !important; }
        .li-comment-btn:focus-visible { outline: 2px solid var(--sketch-vermilion); outline-offset: 2px; }
        @media (max-width: 640px) {
          .li-post-row { flex-direction: column; align-items: stretch; gap: 10px; }
        }
      `}</style>

      {/* Section header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand-icons/linkedin.png"
            alt=""
            width={22}
            height={22}
            style={{ display: "inline-block", flexShrink: 0, objectFit: "contain" }}
          />
          <SectionLabel meta={`${posts.length} total`}>
            LinkedIn Published Posts
          </SectionLabel>
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
            + Upload LinkedIn Post
          </button>
        )}
      </div>

      <div style={{ ...lbl, marginBottom: 16, lineHeight: 1.5 }}>
        LinkedIn posts (single image, PDF carousel, and video) for publishing,
        review, and future automation.
      </div>

      {/* Upload form */}
      {showForm && (
        <LinkedInPostUploadForm
          brandId={brand.id}
          onCreated={handleCreated}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Loading */}
      {loading && (
        <div style={{ padding: "24px 0", textAlign: "center", ...lbl }}>
          Loading LinkedIn posts…
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div
          style={{
            border: "1px solid var(--sketch-vermilion)",
            padding: "20px 0",
            textAlign: "center",
            ...lbl,
            color: "var(--sketch-vermilion)",
          }}
        >
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && posts.length === 0 && !showForm && (
        <div
          style={{
            border: "2px dashed var(--sketch-line)",
            padding: "40px 0",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono-ink)",
              fontSize: 12,
              fontWeight: 500,
              color: "var(--sketch-ink-faint)",
              marginBottom: 6,
            }}
          >
            No LinkedIn posts yet.
          </div>
          <div
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 13,
              color: "var(--sketch-ink-faint)",
              marginBottom: 16,
            }}
          >
            Upload a LinkedIn post — single image, PDF carousel, or video.
          </div>
          <button
            onClick={() => setShowForm(true)}
            style={{
              ...inkBtn,
              borderColor: "var(--sketch-vermilion)",
              color: "var(--sketch-vermilion)",
            }}
          >
            Upload LinkedIn Post
          </button>
        </div>
      )}

      {/* Document list */}
      {!loading && !error && posts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {posts.map((post) => (
            <PostRow
              key={post.id}
              post={post}
              onOpen={() => setSelectedPost(post)}
              onCommentClick={(p) => setCommentsPost(p)}
            />
          ))}
        </div>
      )}

      {/* Detail modal */}
      {selectedPost && (
        <LinkedInPostDetailModal
          key={selectedPost.id}
          post={selectedPost}
          brandId={brand.id}
          onClose={() => setSelectedPost(null)}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
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
}
