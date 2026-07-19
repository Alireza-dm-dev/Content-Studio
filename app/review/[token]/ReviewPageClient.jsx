"use client";

import { useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { X, MessageCircle } from "lucide-react";
import PublicReviewCommentsPanel from "./PublicReviewCommentsPanel";

const lbl = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--sketch-ink-faint)",
};

function formatPostIdShort(postNumber) {
  if (postNumber == null) return null;
  return "P-" + String(postNumber).padStart(3, "0");
}

function ReviewCalendarCard({ calendar }) {
  return (
    <div style={{
      border: "1px solid var(--sketch-line)",
      background: "var(--sketch-paper-bright)",
      boxShadow: "2px 2px 0 rgba(28,24,18,0.10)",
      padding: "14px 18px",
      marginBottom: 12,
    }}>
      <div style={{ fontFamily: "var(--font-mono-ink)", fontSize: 13, fontWeight: 500, color: "var(--sketch-ink)" }}>
        {calendar.title}
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
        {calendar.status && (
          <span style={{ ...lbl, fontSize: 9 }}>{calendar.status}</span>
        )}
        {calendar.platform && <span style={lbl}>{calendar.platform}</span>}
        {calendar.timePeriod && <span style={lbl}>{calendar.timePeriod}</span>}
        <span style={lbl}>{calendar.postCount ?? 0} posts</span>
      </div>
    </div>
  );
}

function ReviewInstagramGridCard({ post, onClick, commentCount, onCommentClick }) {
  const firstMedia = post.media?.[0];
  const isCarousel = post.postType === "carousel" || (post.media?.length || 0) > 1;
  const isVideo = post.postType === "reel" || firstMedia?.mediaType === "VIDEO";
  const postId = formatPostIdShort(post.postNumber);

  return (
    <div
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
        <img
          src={firstMedia.url}
          alt={post.caption || "Post media"}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : isVideo && post.thumbnailUrl ? (
        <img
          src={post.thumbnailUrl}
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
        <div style={{
          width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
          background: "repeating-linear-gradient(45deg, var(--sketch-paper-raw) 0 6px, var(--sketch-paper-bright) 6px 12px)",
        }}>
          <span style={{ ...lbl, fontSize: 9 }}>No preview</span>
        </div>
      )}

      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        background: "rgba(28,24,18,0.55)",
        padding: "4px 8px",
        display: "flex", alignItems: "center", gap: 6,
      }}>
        {postId && (
          <span style={{ fontFamily: "var(--font-mono-ink)", fontSize: 8, color: "var(--sketch-paper-bright)" }}>
            {postId}
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          {onCommentClick && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onCommentClick(post.id); }}
              aria-label={"Comments (" + (commentCount ?? 0) + ")"}
              style={{
                display: "inline-flex", alignItems: "center", gap: 3,
                background: "rgba(28,24,18,0.5)", border: "none",
                color: "var(--sketch-paper-bright)", cursor: "pointer",
                padding: "2px 6px", borderRadius: 0,
                fontFamily: "var(--font-mono-ink)", fontSize: 9, lineHeight: 1,
              }}
            >
              <MessageCircle size={14} />
              <span>{commentCount ?? 0}</span>
            </button>
          )}
          {isVideo && (
            <span style={{ fontFamily: "var(--font-mono-ink)", fontSize: 10, color: "var(--sketch-paper-bright)" }}>
              {"\u25B6"}
            </span>
          )}
          {isCarousel && (
            <span style={{ fontFamily: "var(--font-mono-ink)", fontSize: 10, color: "var(--sketch-paper-bright)" }}>
              {"\u25A3"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewLinkedInPostRow({ post, onClick, commentCount, onCommentClick }) {
  const firstMedia = post.media?.[0];
  const isVideo = post.postType === "reel" || post.postType === "video" || firstMedia?.mediaType === "VIDEO";
  const isPdf = post.postType === "carousel" || firstMedia?.mediaType === "document";
  const postId = formatPostIdShort(post.postNumber);
  const mediaUrl = firstMedia?.url;
  const fileName = firstMedia?.fileName || mediaUrl?.split("/").pop() || "file";

  let icon, label;
  if (isVideo) { icon = "\u25B6"; label = "Video"; }
  else if (isPdf) { icon = "\u25A3"; label = "PDF Carousel"; }
  else { icon = "\u25A1"; label = "Single Image"; }

  return (
    <div
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 14,
        border: "1px solid var(--sketch-line)",
        background: "var(--sketch-paper-bright)",
        boxShadow: "2px 2px 0 rgba(28,24,18,0.10)",
        padding: "12px 14px",
        cursor: "pointer",
      }}
    >
      <div style={{ flexShrink: 0, color: "var(--sketch-ink-faint)", fontFamily: "var(--font-mono-ink)", fontSize: 22 }}>
        {icon}
      </div>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {postId && (
            <span style={{ fontFamily: "var(--font-mono-ink)", fontSize: 11, color: "var(--sketch-vermilion)" }}>
              {postId}
            </span>
          )}
          <span style={{ ...lbl, fontSize: 9 }}>{label}</span>
        </div>
        {post.caption ? (
          <div title={post.caption} style={{
            fontFamily: "var(--font-mono-ink)", fontSize: 11, color: "var(--sketch-ink)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {post.caption}
          </div>
        ) : (
          <div style={{ ...lbl, fontSize: 9 }}>No caption</div>
        )}
        <div style={{ ...lbl, fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={fileName}>
          {label}: {fileName}
        </div>
      </div>

      {onCommentClick && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onCommentClick(post.id); }}
          aria-label={"Comments (" + (commentCount ?? 0) + ")"}
          style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            flexShrink: 0, padding: "10px 12px",
            border: "1px solid var(--sketch-line)", background: "transparent",
            cursor: "pointer", color: "var(--sketch-ink-soft)",
            fontFamily: "var(--font-mono-ink)", fontSize: 10,
            letterSpacing: "0.08em", textTransform: "uppercase",
          }}
        >
          <MessageCircle size={16} />
          <span>{commentCount ?? 0}</span>
        </button>
      )}
    </div>
  );
}

function ReviewPostDetailModal({ post, platform, onClose, showComment, onCommentClick }) {
  const orderedMedia = [...(post.media || [])].sort((a, b) => a.order - b.order);
  const isCarousel = post.postType === "carousel" || orderedMedia.length > 1;
  const [carouselIdx, setCarouselIdx] = useState(0);
  const currentMedia = orderedMedia[carouselIdx] || null;
  const postId = formatPostIdShort(post.postNumber);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div onClick={onClose} style={{
        position: "absolute", inset: 0,
        background: "rgba(0,0,0,0.60)", backdropFilter: "blur(4px)",
      }} />

      <div style={{
        position: "relative", width: "100%", maxWidth: 620, maxHeight: "90vh", overflowY: "auto",
        background: "var(--sketch-paper-bright)", border: "1px solid var(--sketch-line)",
        boxShadow: "2px 2px 0 rgba(28,24,18,0.10)",
      }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "12px 18px", borderBottom: "1px solid var(--sketch-line)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 700,
              textTransform: "uppercase", color: "var(--sketch-ink)", lineHeight: 1,
            }}>
              {platform} Post
            </span>
            {postId && (
              <span style={{ ...lbl, fontSize: 9, color: "var(--sketch-vermilion)" }}>
                {postId}
              </span>
            )}
          </div>
          <button onClick={onClose} style={{
            ...lbl, border: "none", background: "none", cursor: "pointer", fontSize: 18,
            color: "var(--sketch-ink-faint)", padding: "2px 4px", lineHeight: 1,
          }}>
            <X size={18} />
          </button>
        </div>

        <div style={{
          position: "relative", background: "var(--sketch-paper-raw)",
          display: "flex", alignItems: "center", justifyContent: "center",
          minHeight: 260, maxHeight: 420, overflow: "hidden",
        }}>
          {currentMedia && currentMedia.mediaType === "VIDEO" ? (
            <video src={currentMedia.url} controls style={{
              width: "100%", maxHeight: 420, objectFit: "contain", display: "block",
            }} />
          ) : currentMedia ? (
            <img src={currentMedia.url} alt={post.caption || "Post media"} style={{
              width: "100%", maxHeight: 420, objectFit: "contain", display: "block",
            }} />
          ) : (
            <div style={{ padding: 40, textAlign: "center", ...lbl }}>No media available</div>
          )}

          {isCarousel && orderedMedia.length > 1 && (
            <>
              <button onClick={() => setCarouselIdx((i) => (i > 0 ? i - 1 : orderedMedia.length - 1))} style={{
                position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)",
                ...lbl, border: "1px solid var(--sketch-line)", background: "var(--sketch-paper-bright)",
                padding: "4px 10px", fontSize: 16, lineHeight: 1, cursor: "pointer", opacity: 0.8,
              }}>
                {"\u2039"}
              </button>
              <button onClick={() => setCarouselIdx((i) => (i < orderedMedia.length - 1 ? i + 1 : 0))} style={{
                position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                ...lbl, border: "1px solid var(--sketch-line)", background: "var(--sketch-paper-bright)",
                padding: "4px 10px", fontSize: 16, lineHeight: 1, cursor: "pointer", opacity: 0.8,
              }}>
                {"\u203A"}
              </button>
              <div style={{
                position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)",
                display: "flex", gap: 6, ...lbl, fontSize: 9, color: "var(--sketch-ink)",
                background: "var(--sketch-paper-bright)", padding: "3px 10px",
                border: "1px solid var(--sketch-line)", opacity: 0.85,
              }}>
                {orderedMedia.map((_, i) => (
                  <button key={i} onClick={() => setCarouselIdx(i)} style={{
                    width: 8, height: 8, borderRadius: "50%", border: "none",
                    background: i === carouselIdx ? "var(--sketch-ink)" : "var(--sketch-line)",
                    cursor: "pointer", padding: 0,
                  }} />
                ))}
              </div>
            </>
          )}
        </div>

        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <InfoField label="Post Type" value={post.postType} />
            <InfoField label="Platform" value={platform} />
            <InfoField label="Status" value={post.status} />
            <InfoField label="Uploaded" value={post.createdAt ? new Date(post.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : null} />
            {post.scheduledDate && (
              <InfoField label="Scheduled" value={new Date(post.scheduledDate).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })} />
            )}
          </div>

          {post.caption && (
            <div>
              <div style={{ ...lbl, marginBottom: 4 }}>Caption</div>
              <div style={{
                fontFamily: "var(--font-mono-ink)", fontSize: 11, color: "var(--sketch-ink)",
                lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word",
                maxHeight: 120, overflowY: "auto",
              }}>
                {post.caption}
              </div>
            </div>
          )}

          {currentMedia && currentMedia.url && (
            <div>
              <div style={{ ...lbl, marginBottom: 4 }}>Media</div>
              <a
                href={currentMedia.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...inkBtn, borderColor: "var(--sketch-vermilion)", color: "var(--sketch-vermilion)", textDecoration: "none" }}
              >
                Open {currentMedia.mediaType === "VIDEO" ? "video" : "media"}
              </a>
            </div>
          )}

          {showComment && (
            <div>
              <button
                type="button"
                onClick={() => onCommentClick(post.id)}
                style={{
                  ...inkBtn,
                  borderColor: "var(--sketch-vermilion)",
                  color: "var(--sketch-vermilion)",
                }}
              >
                <MessageCircle size={14} />
                Comment ({post.commentCount ?? 0})
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoField({ label, value }) {
  if (value == null) return null;
  return (
    <div>
      <div style={{ ...lbl, marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono-ink)", fontSize: 11, color: "var(--sketch-ink)", textTransform: "capitalize" }}>
        {String(value)}
      </div>
    </div>
  );
}

export default function ReviewPageClient({
  brand,
  review,
  calendars: initialCalendars,
  instagramPosts: initialInstagramPosts,
  linkedinPosts: initialLinkedinPosts,
}) {
  const params = useParams();
  const reviewToken = typeof params?.token === "string" ? params.token : "";

  const [selectedPost, setSelectedPost] = useState(null);
  const [commentsPostId, setCommentsPostId] = useState(null);
  const [displayName, setDisplayName] = useState("");
  const [instagramPosts, setInstagramPosts] = useState(initialInstagramPosts || []);
  const [linkedinPosts, setLinkedinPosts] = useState(initialLinkedinPosts || []);
  const [calendars] = useState(initialCalendars || []);

  const allowComments = review?.allowComments === true;

  const handleCardClick = useCallback((post) => {
    setCommentsPostId(null);
    setSelectedPost({ ...post, _platform: post.platform === "Instagram" ? "Instagram" : "LinkedIn" });
  }, []);

  const handleCommentClick = useCallback((postId) => {
    setSelectedPost(null);
    setCommentsPostId(postId);
  }, []);

  const handleDetailCommentClick = useCallback((postId) => {
    setSelectedPost(null);
    setCommentsPostId(postId);
  }, []);

  const handleCountChange = useCallback((postId, newCount) => {
    setInstagramPosts((prev) =>
      prev.map((p) => (p.id === postId ? { ...p, commentCount: newCount } : p))
    );
    setLinkedinPosts((prev) =>
      prev.map((p) => (p.id === postId ? { ...p, commentCount: newCount } : p))
    );
  }, []);

  const handleClosePanel = useCallback(() => {
    setCommentsPostId(null);
  }, []);

  const commentsPost = instagramPosts.find((p) => p.id === commentsPostId) || linkedinPosts.find((p) => p.id === commentsPostId);

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

  return (
    <div style={{ padding: "36px 44px 48px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ ...lbl, fontSize: 9 }}>Review Link</div>
        <div style={{ ...lbl, fontSize: 9 }}>Content Studio &middot; Ink Cartography System</div>
      </div>
      <div style={{ borderBottom: "1px solid var(--sketch-ink)", marginBottom: 24 }} />

      <div>
        <h1 style={{
          margin: 0, fontFamily: "var(--font-display)", fontWeight: 900, fontSize: 56,
          lineHeight: 0.9, textTransform: "uppercase", color: "var(--sketch-ink)",
        }}>
          {brand.name}
        </h1>
        <div style={{ borderBottom: "2px solid var(--sketch-vermilion)", width: 220, marginTop: 8 }} />
        <div style={{ ...lbl, marginTop: 8 }}>
          {brand.businessType || "Brand Review"}
          {brand.businessLocation ? " \u00b7 " + brand.businessLocation : ""}
        </div>
      </div>

      {calendars.length > 0 && (
        <section style={{ marginTop: 36 }}>
          <SectionLabel>Content Calendars</SectionLabel>
          <div style={{ marginTop: 14 }}>
            {calendars.map((cal) => (
              <ReviewCalendarCard key={cal.id} calendar={cal} />
            ))}
          </div>
        </section>
      )}

      {instagramPosts.length > 0 && (
        <section style={{ marginTop: 36 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <img src="/brand-icons/instagram.png" alt="" width={22} height={22} style={{ display: "inline-block", flexShrink: 0, objectFit: "contain" }} />
            <SectionLabel>Instagram Published Posts</SectionLabel>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
            {instagramPosts.map((post) => (
              <ReviewInstagramGridCard
                key={post.id}
                post={post}
                onClick={() => handleCardClick(post)}
                commentCount={post.commentCount}
                onCommentClick={allowComments ? handleCommentClick : null}
              />
            ))}
          </div>
        </section>
      )}

      {linkedinPosts.length > 0 && (
        <section style={{ marginTop: 36 }}>
          <style>{`
            .li-row:hover { border-color: var(--sketch-vermilion) !important; }
          `}</style>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <img src="/brand-icons/linkedin.png" alt="" width={22} height={22} style={{ display: "inline-block", flexShrink: 0, objectFit: "contain" }} />
            <SectionLabel>LinkedIn Published Posts</SectionLabel>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {linkedinPosts.map((post) => (
              <div key={post.id} className="li-row">
                <ReviewLinkedInPostRow
                  post={post}
                  onClick={() => handleCardClick(post)}
                  commentCount={post.commentCount}
                  onCommentClick={allowComments ? handleCommentClick : null}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {calendars.length === 0 && instagramPosts.length === 0 && linkedinPosts.length === 0 && (
        <section style={{ marginTop: 36 }}>
          <div style={{
            border: "2px dashed var(--sketch-line)", padding: "40px 0", textAlign: "center",
          }}>
            <div style={{ fontFamily: "var(--font-mono-ink)", fontSize: 12, fontWeight: 500, color: "var(--sketch-ink-faint)", marginBottom: 6 }}>
              No content to review
            </div>
            <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 13, color: "var(--sketch-ink-faint)" }}>
              This review link has no content sections enabled.
            </div>
          </div>
        </section>
      )}

      <div style={{
        display: "flex", justifyContent: "space-between", marginTop: 40,
        ...lbl, borderTop: "1px solid var(--sketch-line)", paddingTop: 14,
      }}>
        <span>Content Studio &middot; Brand Review</span>
        <span>Ink Cartography System</span>
      </div>

      {selectedPost && (
        <ReviewPostDetailModal
          post={selectedPost}
          platform={selectedPost._platform}
          onClose={() => setSelectedPost(null)}
          showComment={allowComments}
          onCommentClick={handleDetailCommentClick}
        />
      )}

      {commentsPostId && commentsPost && (
        <PublicReviewCommentsPanel
          key={commentsPostId}
          reviewToken={reviewToken}
          postId={commentsPostId}
          postLabel={formatPostIdShort(commentsPost.postNumber) ? formatPostIdShort(commentsPost.postNumber) + " \u00b7 " + commentsPost.platform : commentsPost.platform}
          initialCommentCount={commentsPost.commentCount ?? 0}
          displayName={displayName}
          onDisplayNameChange={setDisplayName}
          onCountChange={handleCountChange}
          onClose={handleClosePanel}
        />
      )}
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{
      display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px",
      paddingBottom: "6px", borderBottom: "1px solid #CFC6B4",
    }}>
      <span style={{
        fontFamily: "'DM Mono', ui-monospace, monospace", fontSize: "13px", fontWeight: 500,
        letterSpacing: "0.14em", textTransform: "uppercase", color: "#1C1812",
      }}>
        {children}
      </span>
    </div>
  );
}
