"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { X, MessageCircle } from "lucide-react";

const lbl = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--sketch-ink-faint)",
};

function fmtDate(dateStr) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function parseErr(err, fallback) {
  if (!err) return fallback;
  if (typeof err === "string") return err;
  if (typeof err.error === "string") return err.error;
  if (typeof err.message === "string") return err.message;
  return fallback;
}

export default function PublicReviewCommentsPanel({
  reviewToken,
  postId,
  postLabel,
  initialCommentCount,
  displayName,
  onDisplayNameChange,
  onCountChange,
  onClose,
}) {
  const [comments, setComments] = useState([]);
  const [commentCount, setCommentCount] = useState(initialCommentCount);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const closedRef = useRef(false);
  const textareaRef = useRef(null);
  const listEndRef = useRef(null);
  const requestIdRef = useRef(0);

  const encodedToken = encodeURIComponent(reviewToken);
  const encodedPostId = encodeURIComponent(postId);
  const apiUrl = "/api/review/" + encodedToken + "/published-posts/" + encodedPostId + "/comments";
  const busy = submitting;

  const requestClose = useCallback(() => {
    if (busy) return;
    closedRef.current = true;
    onClose();
  }, [busy, onClose]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape" && !busy) {
        requestClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, requestClose]);

  function handleRetry() {
    setLoading(true);
    setFetchError(null);
    setSubmitError(null);
    setComments([]);
  }

  useEffect(() => {
    let cancelled = false;
    const currentId = ++requestIdRef.current;
    const controller = new AbortController();

    fetch(apiUrl, { signal: controller.signal })
      .then(async (res) => {
        if (cancelled) return;
        if (currentId !== requestIdRef.current) return;

        if (res.status === 404) {
          throw new Error("This post is not available for this review.");
        }
        if (res.status === 403) {
          throw new Error("Comments are disabled for this review.");
        }
        if (res.status === 410) {
          throw new Error("This review link is no longer active.");
        }
        if (!res.ok) {
          let msg;
          try {
            const d = await res.json();
            msg = d.error || "Comments could not be loaded.";
          } catch {
            msg = "Comments could not be loaded.";
          }
          throw new Error(msg);
        }
        const data = await res.json();
        if (cancelled) return;
        if (currentId !== requestIdRef.current) return;
        setComments(data.comments || []);
        const count = data.commentCount ?? 0;
        setCommentCount(count);
        if (onCountChange) onCountChange(postId, count);
        setTimeout(() => {
          if (!closedRef.current) textareaRef.current?.focus();
        }, 0);
      })
      .catch((err) => {
        if (cancelled) return;
        if (currentId !== requestIdRef.current) return;
        if (err.name === "AbortError") return;
        const msg = parseErr(err, "Comments could not be loaded.");
        setFetchError(msg);
      })
      .finally(() => {
        if (!cancelled && currentId === requestIdRef.current) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiUrl, postId, onCountChange]);

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmedName = (displayName || "").trim();
    const trimmedContent = content.trim();

    if (!trimmedName || !trimmedContent || submitting) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: trimmedName, content: trimmedContent }),
      });

      if (closedRef.current) return;

      if (res.status === 403) {
        throw new Error("Comments are disabled for this review.");
      }
      if (res.status === 404) {
        throw new Error("This post is not available for this review.");
      }
      if (res.status === 410) {
        throw new Error("This review link is no longer active.");
      }
      if (!res.ok) {
        let msg;
        try {
          const d = await res.json();
          msg = d.error || "Comment could not be submitted.";
        } catch {
          msg = "Comment could not be submitted.";
        }
        throw new Error(msg);
      }

      const data = await res.json();
      if (closedRef.current) return;

      setComments((prev) => [data.comment, ...prev]);
      setContent("");
      const count = data.commentCount ?? 0;
      setCommentCount(count);
      if (onCountChange) onCountChange(postId, count);
      setTimeout(() => {
        if (!closedRef.current) {
          textareaRef.current?.focus();
          listEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }, 50);
    } catch (err) {
      if (closedRef.current) return;
      setSubmitError(parseErr(err, "Comment could not be submitted."));
    } finally {
      if (!closedRef.current) setSubmitting(false);
    }
  }

  const nameValid = (displayName || "").trim().length > 0;
  const contentValid = content.trim().length > 0;
  const canSubmit = nameValid && contentValid && !submitting;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-comments-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        onClick={requestClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "var(--sketch-scrim)",
          backdropFilter: "blur(4px)",
        }}
      />

      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 520,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--sketch-paper-bright)",
          border: "1px solid var(--sketch-line)",
          boxShadow: "2px 2px 0 rgba(28,24,18,0.10)",
        }}
        tabIndex={-1}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "12px 18px",
            borderBottom: "1px solid var(--sketch-line)",
          }}
        >
          <div>
            <span
              id="review-comments-title"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 16,
                fontWeight: 700,
                textTransform: "uppercase",
                color: "var(--sketch-ink)",
                lineHeight: 1,
              }}
            >
              Comments
              {commentCount != null && " (" + commentCount + ")"}
            </span>
            {postLabel && (
              <div style={{ ...lbl, marginTop: 2, fontSize: 9 }}>
                {postLabel}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close comments"
            disabled={busy}
            style={{
              fontFamily: "var(--font-mono-ink)",
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              padding: "4px 10px",
              border: "none",
              background: "transparent",
              color: "var(--sketch-ink-soft)",
              cursor: busy ? "not-allowed" : "pointer",
              fontSize: 14,
              padding: "2px 8px",
              lineHeight: 1,
              opacity: busy ? 0.35 : 1,
              ...(busy ? { pointerEvents: "none" } : {}),
            }}
          >
            &times;
          </button>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "14px 18px",
          }}
        >
          {loading && (
            <div
              style={{
                ...lbl,
                textAlign: "center",
                padding: "32px 0",
              }}
            >
              Loading comments&hellip;
            </div>
          )}

          {!loading && fetchError && (
            <div style={{ textAlign: "center", padding: "24px 0" }}>
              <div
                role="alert"
                style={{
                  color: "var(--sketch-vermilion)",
                  fontFamily: "var(--font-mono-ink)",
                  fontSize: 11,
                  marginBottom: 10,
                }}
              >
                {fetchError}
              </div>
              <button
                type="button"
                onClick={handleRetry}
                style={{
                  fontFamily: "var(--font-mono-ink)",
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  padding: "4px 10px",
                  border: "1px solid var(--sketch-ink)",
                  background: "transparent",
                  color: "var(--sketch-ink-soft)",
                  cursor: "pointer",
                }}
              >
                Retry
              </button>
            </div>
          )}

          {!loading && !fetchError && comments.length === 0 && (
            <div style={{ textAlign: "center", padding: "32px 0" }}>
              <div
                style={{
                  fontFamily: "var(--font-mono-ink)",
                  fontSize: 11,
                  color: "var(--sketch-ink-soft)",
                  marginBottom: 4,
                }}
              >
                No comments yet.
              </div>
              <div style={{ ...lbl, fontSize: 9 }}>
                Be the first to share feedback on this post.
              </div>
            </div>
          )}

          {!loading && !fetchError && comments.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              {comments.map((comment) => (
                <div
                  key={comment.id}
                  style={{
                    borderBottom: "1px solid var(--sketch-line-soft)",
                    paddingBottom: 10,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      marginBottom: 4,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--font-mono-ink)",
                          fontSize: 10,
                          fontWeight: 600,
                          color: "var(--sketch-ink)",
                        }}
                      >
                        {comment.authorName}
                      </span>
                      <span style={{ ...lbl, fontSize: 8 }}>
                        {fmtDate(comment.createdAt)}
                      </span>
                    </div>
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono-ink)",
                      fontSize: 11,
                      color: "var(--sketch-ink)",
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {comment.content}
                  </div>
                </div>
              ))}
              <div ref={listEndRef} />
            </div>
          )}
        </div>

        <div
          style={{
            borderTop: "1px solid var(--sketch-line)",
            padding: "12px 18px",
          }}
        >
          {submitError && (
            <div
              role="alert"
              style={{
                color: "var(--sketch-vermilion)",
                fontFamily: "var(--font-mono-ink)",
                fontSize: 11,
                marginBottom: 8,
              }}
            >
              {submitError}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 8 }}>
              <label
                htmlFor="review-dn-input"
                style={{ ...lbl, display: "block", marginBottom: 4 }}
              >
                Display name
              </label>
              <input
                id="review-dn-input"
                type="text"
                value={displayName}
                onChange={(e) => onDisplayNameChange(e.target.value)}
                maxLength={80}
                placeholder="Your name"
                autoComplete="name"
                disabled={submitting}
                style={{
                  width: "100%",
                  fontFamily: "var(--font-mono-ink)",
                  fontSize: 11,
                  color: "var(--sketch-ink)",
                  border: "1px solid var(--sketch-line)",
                  background: "var(--sketch-paper-raw)",
                  padding: "6px 8px",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div>
              <label
                htmlFor="review-content-input"
                style={{ ...lbl, display: "block", marginBottom: 4 }}
              >
                Add a comment
              </label>
              <textarea
                id="review-content-input"
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="Share your feedback&hellip;"
                disabled={submitting}
                style={{
                  width: "100%",
                  fontFamily: "var(--font-mono-ink)",
                  fontSize: 11,
                  color: "var(--sketch-ink)",
                  border: "1px solid var(--sketch-line)",
                  background: "var(--sketch-paper-raw)",
                  padding: "6px 8px",
                  outline: "none",
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 8,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono-ink)",
                  fontSize: 9,
                  color: "var(--sketch-ink-faint)",
                }}
              >
                {content.length} / 2000
              </span>
              <button
                type="submit"
                disabled={!canSubmit}
                style={{
                  fontFamily: "var(--font-mono-ink)",
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  padding: "4px 10px",
                  border: "1px solid var(--sketch-vermilion)",
                  background: canSubmit ? "var(--sketch-vermilion)" : "transparent",
                  color: canSubmit ? "var(--sketch-paper-bright)" : "var(--sketch-ink-soft)",
                  cursor: canSubmit ? "pointer" : "not-allowed",
                  opacity: submitting ? 0.5 : 1,
                  ...(submitting ? { pointerEvents: "none" } : {}),
                }}
              >
                {submitting ? "Submitting&hellip;" : "Add comment"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
