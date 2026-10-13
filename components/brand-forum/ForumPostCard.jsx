"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import { parseApiResponse, getApiErrorMessage } from "@/lib/http";
import { lbl, inkBtn, primaryBtn, textareaStyle, fmtStamp, errMessage } from "./forum-ui";
import ForumMedia from "./ForumMedia";

function Byline({ author, at, small }) {
  return (
    <div>
      <div style={{ ...lbl, color: "var(--sketch-ink)", fontSize: small ? 10 : 11, fontWeight: 600 }}>
        {author.name} · <span style={{ color: author.role === "admin" ? "var(--sketch-vermilion)" : "var(--sketch-ink-faint)" }}>{author.role}</span>
      </div>
      <div style={{ ...lbl, fontSize: 9, marginTop: 2 }}>{fmtStamp(at, !small)}</div>
    </div>
  );
}

const bodyStyle = {
  fontFamily: "var(--font-mono-ink)", fontSize: 12, lineHeight: 1.6,
  color: "var(--sketch-ink)", whiteSpace: "pre-wrap", overflowWrap: "anywhere",
};

export default function ForumPostCard({ brandId, post, onDeletePost, onReplyAdded, onReplyDeleted, askConfirm }) {
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(null); // "post" | reply id
  const inFlight = useRef(false);
  const base = `/api/brands/${brandId}/forum/${post.id}`;

  async function submitReply(e) {
    e.preventDefault();
    if (inFlight.current || !draft.trim()) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      const res = await fetch(`${base}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      const data = await parseApiResponse(res);
      if (!res.ok) throw new Error(getApiErrorMessage(data));
      onReplyAdded(post.id, data.reply);
      setDraft("");
      setReplying(false);
      toast.success("Reply posted");
    } catch (err) {
      toast.error(errMessage(err, "Failed to post reply"));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  async function remove(kind, replyId) {
    const ok = await askConfirm(kind === "post" ? "Delete this post and all its replies?" : "Delete this reply?");
    if (!ok) return;
    setDeleting(kind === "post" ? "post" : replyId);
    try {
      const res = await fetch(kind === "post" ? base : `${base}/replies/${replyId}`, { method: "DELETE" });
      const data = await parseApiResponse(res);
      if (!res.ok) throw new Error(getApiErrorMessage(data));
      if (kind === "post") onDeletePost(post.id);
      else onReplyDeleted(post.id, replyId);
      toast.success(kind === "post" ? "Post deleted" : "Reply deleted");
    } catch (err) {
      toast.error(errMessage(err, "Failed to delete"));
      setDeleting(null);
    }
  }

  const n = post.replies.length;

  return (
    <article style={{ border: "1px solid var(--sketch-line)", background: "var(--sketch-paper-bright)", padding: "14px 18px", boxShadow: "2px 2px 0 rgba(28,24,18,0.08)" }}>
      <Byline author={post.author} at={post.createdAt} />
      {post.body && <div style={{ ...bodyStyle, marginTop: 10 }}>{post.body}</div>}
      <ForumMedia attachments={post.attachments} />

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, borderTop: "1px solid var(--sketch-line)", paddingTop: 10 }}>
        <span style={lbl}>{n} {n === 1 ? "reply" : "replies"}</span>
        <button type="button" style={inkBtn} onClick={() => setReplying((v) => !v)} disabled={submitting}>Reply</button>
        <span style={{ flex: 1 }} />
        {post.canDelete && (
          <button
            type="button"
            style={{ ...inkBtn, borderColor: "var(--sketch-vermilion)", color: "var(--sketch-vermilion)", opacity: deleting === "post" ? 0.5 : 1 }}
            disabled={deleting === "post"}
            onClick={() => remove("post")}
          >
            {deleting === "post" ? "Deleting…" : "Delete"}
          </button>
        )}
      </div>

      {(n > 0 || replying) && (
        <div style={{ marginTop: 12, marginLeft: 14, paddingLeft: 14, borderLeft: "2px solid var(--sketch-line)", display: "flex", flexDirection: "column", gap: 12 }}>
          {post.replies.map((r) => (
            <div key={r.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <Byline author={r.author} at={r.createdAt} small />
                {r.canDelete && (
                  <button
                    type="button"
                    disabled={deleting === r.id}
                    onClick={() => remove("reply", r.id)}
                    style={{ ...lbl, fontSize: 9, background: "none", border: "none", cursor: "pointer", color: "var(--sketch-vermilion)" }}
                  >
                    {deleting === r.id ? "Deleting…" : "Delete"}
                  </button>
                )}
              </div>
              <div style={{ ...bodyStyle, marginTop: 6 }}>{r.body}</div>
            </div>
          ))}

          {replying && (
            <form onSubmit={submitReply} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                maxLength={2000}
                autoFocus
                placeholder="Write a reply…"
                aria-label="Reply"
                disabled={submitting}
                style={textareaStyle}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button type="submit" disabled={submitting || !draft.trim()} style={{ ...primaryBtn, opacity: submitting || !draft.trim() ? 0.6 : 1 }}>
                  {submitting ? "Replying…" : "Reply"}
                </button>
                <button type="button" style={inkBtn} disabled={submitting} onClick={() => { setReplying(false); setDraft(""); }}>Cancel</button>
              </div>
            </form>
          )}
        </div>
      )}
    </article>
  );
}
