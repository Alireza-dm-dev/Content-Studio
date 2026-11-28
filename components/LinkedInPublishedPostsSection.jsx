"use client";

import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { SectionLabel } from "@/components/content-report/SectionLabel";
import { StatusPill } from "@/components/content-report/StatusPill";
import { FileText, Image as ImageIcon, Video as VideoIcon, MessageCircle, CheckCircle, Play, AlignLeft } from "lucide-react";
import LinkedInPostUploadForm from "@/components/LinkedInPostUploadForm";
import LinkedInPostDetailModal from "@/components/LinkedInPostDetailModal";
import PublishedPostCommentsPanel from "@/components/PublishedPostCommentsPanel";
import {
  resolveBrandTimezone,
  NOT_SCHEDULED_LABEL,
  keepServerSchedule,
} from "@/lib/timezone";
import { getSavedPostFooterState } from "@/lib/published-post-footer";
import { sortPublishedPosts } from "@/lib/published-post-order";
import { detectKind, getLinkedInPreview, buildCaptionExcerpt } from "@/lib/linkedin-post-preview";

// Re-exported for existing importers (LinkedInPostDetailModal).
export { detectKind };

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

function fmtDate(date, timeZone) {
  if (!date) return "—";
  try {
    return new Date(date).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: resolveBrandTimezone(timeZone),
    });
  } catch {
    return String(date);
  }
}

const KIND_META = {
  image: { label: "Single Image", Icon: ImageIcon, action: "Open Image" },
  pdf: { label: "PDF Carousel", Icon: FileText, action: "Open PDF" },
  video: { label: "Video", Icon: VideoIcon, action: "Open Video" },
};

const PREVIEW_SIZE = 88;

const tileBase = {
  width: PREVIEW_SIZE,
  height: PREVIEW_SIZE,
  flexShrink: 0,
  position: "relative",
  overflow: "hidden",
  border: "1px solid var(--sketch-line)",
  background: "var(--sketch-paper-raw)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

function PlayBadge() {
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: "rgba(28,24,18,0.65)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Play size={14} fill="currentColor" />
      </span>
    </span>
  );
}

function FallbackTile({ Icon, label, sub, dark }) {
  return (
    <div
      style={{
        ...tileBase,
        flexDirection: "column",
        gap: 4,
        background: dark ? "var(--sketch-ink)" : "var(--sketch-paper-raw)",
        color: dark ? "var(--sketch-paper-bright)" : "var(--sketch-ink-faint)",
        padding: 6,
        textAlign: "center",
      }}
    >
      <Icon size={22} aria-hidden="true" />
      <span style={{ ...lbl, fontSize: 9, color: "inherit" }}>{label}</span>
      {sub ? (
        <span
          style={{
            ...lbl,
            fontSize: 8,
            letterSpacing: "0.04em",
            textTransform: "none",
            color: "inherit",
            opacity: 0.8,
            maxWidth: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {sub}
        </span>
      ) : null}
    </div>
  );
}

// Mounts a metadata-only <video> once the tile is near the viewport, so a long
// list never starts fetching every video. preload="metadata" + #t=0.1 asks the
// browser for just enough to paint the first frame, never the whole file.
function LazyVideoFrame({ src, fileName }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    // No observer → stay on the play-badge tile rather than load every video.
    if (!el || visible || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  if (failed) return <FallbackTile Icon={VideoIcon} label="Video" sub={fileName} dark />;

  return (
    <div ref={ref} style={{ ...tileBase, background: "var(--sketch-ink)" }}>
      {visible ? (
        <video
          src={`${src}#t=0.1`}
          preload="metadata"
          muted
          playsInline
          tabIndex={-1}
          aria-hidden="true"
          onError={() => setFailed(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}
        />
      ) : null}
      <PlayBadge />
    </div>
  );
}

function LinkedInPreviewTile({ post }) {
  const preview = getLinkedInPreview(post);
  const [failedSrc, setFailedSrc] = useState(null);
  const alt = `${KIND_META[preview.kind]?.label || "LinkedIn post"} preview`;

  if (preview.mode === "image" && preview.src && failedSrc !== preview.src) {
    return (
      <div style={tileBase}>
        <img
          src={preview.src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailedSrc(preview.src)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
        {preview.kind === "video" ? <PlayBadge /> : null}
        {preview.kind === "pdf" ? (
          <span
            style={{
              ...lbl,
              position: "absolute",
              left: 4,
              bottom: 4,
              fontSize: 8,
              padding: "1px 4px",
              background: "var(--sketch-paper-bright)",
              color: "var(--sketch-ink)",
            }}
          >
            PDF
          </span>
        ) : null}
      </div>
    );
  }
  // A failed video poster falls through to the lazy first-frame preview.
  if (preview.kind === "video" && preview.videoSrc) {
    return <LazyVideoFrame src={preview.videoSrc} fileName={preview.fileName} />;
  }
  if (preview.kind === "pdf") {
    return <FallbackTile Icon={FileText} label="PDF" sub={preview.fileName} />;
  }
  if (preview.kind === "image") {
    return <FallbackTile Icon={ImageIcon} label="Image" sub={preview.fileName} />;
  }
  return <FallbackTile Icon={AlignLeft} label="Text" />;
}

function PostRow({ post, timeZone, onOpen, onCommentClick }) {
  const kind = detectKind(post);
  const meta = KIND_META[kind] || KIND_META.pdf;
  const { label, action } = meta;
  const captionExcerpt = buildCaptionExcerpt(post.caption);

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
      {/* Visual preview */}
      <LinkedInPreviewTile post={post} />

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

        {captionExcerpt ? (
          <div
            className="li-caption-excerpt"
            style={{
              fontFamily: "var(--font-mono-ink)",
              fontSize: 11,
              lineHeight: 1.45,
              color: "var(--sketch-ink)",
              whiteSpace: "pre-line",
              overflowWrap: "anywhere",
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 3,
              overflow: "hidden",
            }}
          >
            {captionExcerpt}
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

        {/*
        // ── Footer state line: POSTED / scheduled time / NOT SCHEDULED ── */}
        <div
          className="li-schedule"
          aria-label={getSavedPostFooterState(post).ariaLabel}
          style={{
            ...lbl,
            fontSize: 9,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          {(() => {
            // Server-built Brand-local schedule only (owning Brand's zone); no
            // browser timezone conversion for saved posts.
            const fs = getSavedPostFooterState(post);
            if (fs.type === "posted") {
              return <>
                <CheckCircle size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
                <span>{fs.label}</span>
              </>;
            }
            if (fs.type === "scheduled") {
              const zoneText = fs.schedule?.timezoneLabel;
              return <>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                <span style={{ textTransform: "none", flexShrink: 0 }}>
                  {fs.label}
                </span>
                {zoneText && (
                  <span
                    title={zoneText}
                    style={{ textTransform: "none", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
                  >
                    · {zoneText}
                  </span>
                )}
              </>;
            }
            return <span style={{ textTransform: "none" }}>{NOT_SCHEDULED_LABEL}</span>;
          })()}
        </div>

        <div style={{ ...lbl, fontSize: 9 }}>
          Uploaded: {fmtDate(post.createdAt, timeZone)}
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

const LinkedInPublishedPostsSection = forwardRef(function LinkedInPublishedPostsSection({ brand, onCrossPlatformPostCreated }, ref) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);
  const [commentsPost, setCommentsPost] = useState(null);

  // Drop rows the server removed by LinkedIn retention after a create/edit.
  function removePrunedPosts(linkedInRetention) {
    const ids = linkedInRetention?.deletedIds;
    if (!Array.isArray(ids) || ids.length === 0) return;
    const gone = new Set(ids);
    setPosts((prev) => prev.filter((p) => !gone.has(p.id)));
  }

  function addPostToSection(post, linkedInRetention) {
    removePrunedPosts(linkedInRetention);
    if (!post) return; // retention removed the new post itself: nothing to insert
    setPosts((prev) => {
      const exists = prev.some((p) => p.id === post.id);
      if (exists) return prev.map((p) => (p.id === post.id ? keepServerSchedule(p, post) : p));
      return sortPublishedPosts([{ ...post, commentCount: post.commentCount ?? 0 }, ...prev]);
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
        // Server already returns publish-date order; keep it as-is.
        setPosts(Array.isArray(data) ? data : []);
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

  function handleCreated(newPost, linkedInRetention) {
    removePrunedPosts(linkedInRetention);
    if (!newPost) {
      // Not kept by retention; the form already explained why.
      setShowForm(false);
      return;
    }
    setPosts((prev) => sortPublishedPosts([{ ...newPost, commentCount: newPost.commentCount ?? 0 }, ...prev]));
    setShowForm(false);
    toast.success("LinkedIn post added.");
  }

  function handleUpdated(updatedResponse) {
    const { linkedInRetention, ...response } = updatedResponse || {};
    removePrunedPosts(linkedInRetention);
    // A response without a usable server schedule keeps the existing one when the
    // scheduled instant is unchanged (never a browser-computed replacement).
    const updatedPost = keepServerSchedule(posts.find((p) => p.id === response.id), response);
    setPosts((prev) =>
      sortPublishedPosts(prev.map((p) => (p.id === updatedPost.id ? updatedPost : p))),
    );
    setSelectedPost(updatedPost);
  }

  function handleCrossPlatformCreated(createdPost, linkedInRetention) {
    if (!createdPost) {
      removePrunedPosts(linkedInRetention);
      return;
    }
    if (createdPost.platform === "LinkedIn") {
      addPostToSection(createdPost, linkedInRetention);
    } else {
      onCrossPlatformPostCreated?.(createdPost, linkedInRetention);
    }
  }

  function handleDeleted(deletedId, linkedInRetention) {
    removePrunedPosts(linkedInRetention);
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
          /* Inline alignItems wins over the rule above; clamp children to the card. */
          .li-post-row > * { max-width: 100%; }
          .li-schedule { white-space: normal !important; flex-wrap: wrap; }
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
          brandTimezone={brand.timezone}
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
              timeZone={brand.timezone ?? null}
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
          brandTimezone={brand.timezone}
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

export default LinkedInPublishedPostsSection;
