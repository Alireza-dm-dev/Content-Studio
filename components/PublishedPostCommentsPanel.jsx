"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";

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
  if (err instanceof TypeError && err.message === "Failed to fetch") {
    return "Network error. Please check your connection.";
  }
  if (typeof err === "string") return err;
  if (typeof err.error === "string") return err.error;
  if (typeof err.message === "string") return err.message;
  return fallback;
}

export default function PublishedPostCommentsPanel({
  brandId,
  postId,
  postLabel,
  initialCommentCount = 0,
  onCountChange,
  onClose,
}) {
  const [comments, setComments] = useState([]);
  const [commentCount, setCommentCount] = useState(initialCommentCount);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [fetchKey, setFetchKey] = useState(0);

  const closedRef = useRef(false);
  const textareaRef = useRef(null);
  const onCountRef = useRef(onCountChange);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(false);

  useEffect(() => { onCountRef.current = onCountChange; }, [onCountChange]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const busy = creating || deletingId !== null;
  useEffect(() => { busyRef.current = busy; }, [busy]);

  function emitCount(n) {
    const fn = onCountRef.current;
    if (fn) fn(n);
  }

  const requestClose = useCallback(() => {
    if (busyRef.current) return;
    closedRef.current = true;
    onCloseRef.current();
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape" && !busyRef.current) {
        requestClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [requestClose]);

  function handleRetry() {
    setLoading(true);
    setFetchError(null);
    setFetchKey((k) => k + 1);
  }

  useEffect(() => {
    let cancelled = false;
    const url =
      "/api/brands/" +
      brandId +
      "/published-posts/" +
      postId +
      "/comments";

    fetch(url)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          let msg;
          try {
            const d = await res.json();
            msg = d.error || "Request failed (" + res.status + ")";
          } catch {
            msg = "Request failed (" + res.status + ")";
          }
          throw new Error(msg);
        }
        const data = await res.json();
        if (cancelled) return;
        setComments(data.comments || []);
        const count = data.commentCount ?? 0;
        setCommentCount(count);
        emitCount(count);
        setTimeout(() => textareaRef.current?.focus(), 0);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = parseErr(err, "Failed to load comments.");
        setFetchError(msg);
        toast.error(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [brandId, postId, fetchKey]);

  async function handleCreate(e) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const res = await fetch(
        "/api/brands/" + brandId + "/published-posts/" + postId + "/comments",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: trimmed }),
        }
      );
      if (closedRef.current) return;
      if (!res.ok) {
        let msg;
        try {
          const d = await res.json();
          msg = d.error || "Failed to add comment (" + res.status + ")";
        } catch {
          msg = "Failed to add comment (" + res.status + ")";
        }
        throw new Error(msg);
      }
      const data = await res.json();
      if (closedRef.current) return;
      setComments((prev) => [data.comment, ...prev]);
      setBody("");
      const count = data.commentCount ?? comments.length + 1;
      setCommentCount(count);
      emitCount(count);
      textareaRef.current?.focus();
    } catch (err) {
      if (closedRef.current) return;
      toast.error(parseErr(err, "Failed to add comment."));
    } finally {
      if (!closedRef.current) setCreating(false);
    }
  }

  async function handleDelete(commentId) {
    if (deletingId) return;
    if (!window.confirm("Delete this comment?")) return;
    setDeletingId(commentId);
    try {
      const res = await fetch(
        "/api/brands/" +
          brandId +
          "/published-posts/" +
          postId +
          "/comments/" +
          commentId,
        { method: "DELETE" }
      );
      if (closedRef.current) return;
      if (!res.ok) {
        let msg;
        try {
          const d = await res.json();
          msg = d.error || "Failed to delete comment (" + res.status + ")";
        } catch {
          msg = "Failed to delete comment (" + res.status + ")";
        }
        throw new Error(msg);
      }
      const data = await res.json();
      if (closedRef.current) return;
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      setCommentCount(data.commentCount ?? Math.max(0, comments.length - 1));
      emitCount(data.commentCount ?? Math.max(0, comments.length - 1));
    } catch (err) {
      if (closedRef.current) return;
      toast.error(parseErr(err, "Failed to delete comment."));
    } finally {
      if (!closedRef.current) setDeletingId(null);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="comments-dialog-title"
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
        {/* ── Header ── */}
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
              id="comments-dialog-title"
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
              ...inkBtn,
              border: "none",
              fontSize: 14,
              padding: "2px 8px",
              lineHeight: 1,
              opacity: busy ? 0.35 : 1,
            }}
          >
            &times;
          </button>
        </div>

        {/* ── Scrollable content ── */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "14px 18px",
          }}
        >
          {/* Loading */}
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

          {/* Error */}
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
              <button type="button" onClick={handleRetry} style={inkBtn}>
                Retry
              </button>
            </div>
          )}

          {/* Empty */}
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
                Add the first internal comment about this post.
              </div>
            </div>
          )}

          {/* Comment list */}
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
                    {comment.canDelete && (
                      <button
                        type="button"
                        onClick={() => handleDelete(comment.id)}
                        disabled={deletingId === comment.id}
                        style={{
                          ...inkBtn,
                          border: "none",
                          color: "var(--sketch-vermilion)",
                          padding: "2px 6px",
                          fontSize: 9,
                          opacity: deletingId === comment.id ? 0.4 : 1,
                          cursor:
                            deletingId === comment.id
                              ? "not-allowed"
                              : "pointer",
                        }}
                      >
                        {deletingId === comment.id
                          ? "Deleting\u2026"
                          : "Delete"}
                      </button>
                    )}
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
                    {comment.body}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Composer ── */}
        <div
          style={{
            borderTop: "1px solid var(--sketch-line)",
            padding: "12px 18px",
          }}
        >
          <form onSubmit={handleCreate}>
            <label
              htmlFor="comment-body-input"
              style={{ ...lbl, display: "block", marginBottom: 6 }}
            >
              Add a comment
            </label>
            <Textarea
              id="comment-body-input"
              ref={textareaRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Add a comment\u2026"
              disabled={creating}
            />
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
                {body.length} / 2000
              </span>
              <button
                type="submit"
                disabled={creating || !body.trim()}
                style={{
                  ...inkBtn,
                  borderColor: "var(--sketch-vermilion)",
                  background:
                    creating || !body.trim()
                      ? "transparent"
                      : "var(--sketch-vermilion)",
                  color:
                    creating || !body.trim()
                      ? "var(--sketch-ink-soft)"
                      : "var(--sketch-paper-bright)",
                  opacity: creating ? 0.5 : 1,
                  cursor:
                    creating || !body.trim() ? "not-allowed" : "pointer",
                }}
              >
                {creating ? "Adding\u2026" : "Add comment"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
