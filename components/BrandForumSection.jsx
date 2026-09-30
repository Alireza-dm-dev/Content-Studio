"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { SectionLabel } from "@/components/content-report/SectionLabel";
import { parseApiResponse, getApiErrorMessage } from "@/lib/http";
import { lbl, inkBtn, primaryBtn, textareaStyle, errMessage } from "./brand-forum/forum-ui";
import ForumPostCard from "./brand-forum/ForumPostCard";

const ACCEPT = ".jpg,.jpeg,.png,.webp,.gif,.mp4,.webm,.mov";
const MAX_FILES = 6;

export default function BrandForumSection({ brandId }) {
  const base = `/api/brands/${brandId}/forum`;
  const [posts, setPosts] = useState([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);

  const [composing, setComposing] = useState(false);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState([]);
  const [posting, setPosting] = useState(false);
  const postInFlight = useRef(false);
  const fileInput = useRef(null);

  const [confirm, setConfirm] = useState(null); // { message, resolve }

  const load = useCallback(async (cursor) => {
    const res = await fetch(cursor ? `${base}?cursor=${encodeURIComponent(cursor)}` : base);
    const data = await parseApiResponse(res);
    if (!res.ok) throw new Error(getApiErrorMessage(data));
    return data;
  }, [base]);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((d) => {
        if (cancelled) return;
        setPosts(d.posts);
        setTotal(d.total);
        setNextCursor(d.nextCursor);
      })
      .catch((err) => !cancelled && setLoadError(errMessage(err, "Failed to load the forum.")))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [load]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const d = await load(nextCursor);
      setPosts((prev) => [...prev, ...d.posts.filter((p) => !prev.some((x) => x.id === p.id))]);
      setTotal(d.total);
      setNextCursor(d.nextCursor);
    } catch (err) {
      toast.error(errMessage(err, "Failed to load more posts"));
    } finally {
      setLoadingMore(false);
    }
  }

  function pickFiles(e) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    setFiles((prev) => {
      const next = [...prev, ...picked];
      if (next.length > MAX_FILES) toast.error(`At most ${MAX_FILES} files per post.`);
      return next.slice(0, MAX_FILES);
    });
  }

  async function submitPost(e) {
    e.preventDefault();
    if (postInFlight.current) return;
    if (!body.trim() && files.length === 0) {
      toast.error("Write something or attach an image or video.");
      return;
    }
    postInFlight.current = true;
    setPosting(true);
    try {
      const fd = new FormData();
      fd.append("body", body);
      files.forEach((f) => fd.append("files", f));
      const res = await fetch(base, { method: "POST", body: fd });
      const data = await parseApiResponse(res);
      if (!res.ok) throw new Error(getApiErrorMessage(data));
      setPosts((prev) => [data.post, ...prev]);
      setTotal((t) => t + 1);
      setBody("");
      setFiles([]);
      setComposing(false);
      toast.success("Post published");
    } catch (err) {
      // Draft and files stay intact so the user can retry.
      toast.error(errMessage(err, "Failed to create post"));
    } finally {
      postInFlight.current = false;
      setPosting(false);
    }
  }

  const askConfirm = (message) => new Promise((resolve) => setConfirm({ message, resolve }));
  function answer(value) {
    confirm?.resolve(value);
    setConfirm(null);
  }

  const patchPost = (postId, fn) => setPosts((prev) => prev.map((p) => (p.id === postId ? fn(p) : p)));

  return (
    <section style={{ marginTop: 36 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <SectionLabel meta={`${total} ${total === 1 ? "post" : "posts"}`}>Brand Forum</SectionLabel>
        {!composing && (
          <button type="button" onClick={() => setComposing(true)} style={primaryBtn}>+ New Post</button>
        )}
      </div>
      <div style={{ ...lbl, marginBottom: 16, lineHeight: 1.5 }}>Internal discussion for this brand.</div>

      {composing && (
        <form onSubmit={submitPost} style={{ border: "1px solid var(--sketch-line)", background: "var(--sketch-paper-bright)", padding: "14px 18px", marginBottom: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            maxLength={5000}
            autoFocus
            disabled={posting}
            placeholder="Start a discussion with your team…"
            aria-label="Post text"
            style={textareaStyle}
          />
          {files.length > 0 && (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} style={{ ...lbl, display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ color: "var(--sketch-ink)", overflowWrap: "anywhere" }}>{f.name}</span>
                  <span>{(f.size / (1024 * 1024)).toFixed(1)} MB</span>
                  <button type="button" disabled={posting} onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}
                    style={{ ...lbl, background: "none", border: "none", cursor: "pointer", color: "var(--sketch-vermilion)" }}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input ref={fileInput} type="file" accept={ACCEPT} multiple hidden onChange={pickFiles} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" style={inkBtn} disabled={posting || files.length >= MAX_FILES} onClick={() => fileInput.current?.click()}>
              Attach image / video
            </button>
            <span style={{ ...lbl, fontSize: 9 }}>JPG PNG WEBP GIF · MP4 WEBM MOV</span>
            <span style={{ flex: 1 }} />
            <button type="button" style={inkBtn} disabled={posting} onClick={() => { setComposing(false); setBody(""); setFiles([]); }}>Cancel</button>
            <button type="submit" disabled={posting} style={{ ...primaryBtn, opacity: posting ? 0.6 : 1 }}>
              {posting ? "Posting…" : "Post"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div style={lbl}>Loading discussion…</div>
      ) : loadError ? (
        <div style={{ ...lbl, color: "var(--sketch-vermilion)" }}>
          {loadError}{" "}
          <button type="button" style={{ ...lbl, background: "none", border: "none", textDecoration: "underline", cursor: "pointer" }} onClick={() => window.location.reload()}>Retry</button>
        </div>
      ) : posts.length === 0 && !composing ? (
        <div style={{ border: "1px solid var(--sketch-line)", padding: "28px 18px", textAlign: "center", display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
          <div style={{ ...lbl, color: "var(--sketch-ink)", fontSize: 11 }}>No discussions yet.</div>
          <div style={lbl}>Start a discussion with your team about this brand.</div>
          <button type="button" style={primaryBtn} onClick={() => setComposing(true)}>+ New Post</button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {posts.map((p) => (
            <ForumPostCard
              key={p.id}
              brandId={brandId}
              post={p}
              askConfirm={askConfirm}
              onDeletePost={(id) => { setPosts((prev) => prev.filter((x) => x.id !== id)); setTotal((t) => Math.max(0, t - 1)); }}
              onReplyAdded={(id, reply) => patchPost(id, (x) => ({ ...x, replies: [...x.replies, reply] }))}
              onReplyDeleted={(id, replyId) => patchPost(id, (x) => ({ ...x, replies: x.replies.filter((r) => r.id !== replyId) }))}
            />
          ))}
          {nextCursor && (
            <div>
              <button type="button" style={inkBtn} disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      )}

      {confirm && (
        <div role="dialog" aria-modal="true" onClick={() => answer(false)}
          style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(28,24,18,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: "var(--sketch-paper-bright)", border: "1px solid var(--sketch-line)", boxShadow: "4px 4px 0 rgba(28,24,18,0.12)", padding: 24, maxWidth: 380, width: "90%" }}>
            <div style={{ ...lbl, color: "var(--sketch-ink)", fontSize: 11, marginBottom: 16, lineHeight: 1.5 }}>{confirm.message}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" style={primaryBtn} onClick={() => answer(true)}>Delete</button>
              <button type="button" style={inkBtn} onClick={() => answer(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
