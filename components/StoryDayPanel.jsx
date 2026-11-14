"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// One Story day: ordered assets, publishing instructions and the manual
// "Mark as Uploaded" confirmation. Created lazily on the first save/upload.

const ACCEPT = ".jpg,.jpeg,.png,.webp,.mp4,.mov";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const lbl = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--sketch-ink-faint)",
};

const btn = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  padding: "5px 10px",
  border: "1px solid var(--sketch-ink)",
  background: "transparent",
  color: "var(--sketch-ink-soft)",
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
};
const primaryBtn = { ...btn, background: "var(--sketch-vermilion)", borderColor: "var(--sketch-vermilion)", color: "var(--sketch-paper-bright)" };
const sageBtn = { ...btn, background: "var(--sketch-sage)", borderColor: "var(--sketch-sage)", color: "var(--sketch-paper-bright)" };
const dangerBtn = { ...btn, borderColor: "var(--sketch-vermilion)", color: "var(--sketch-vermilion)" };

function formatLongDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function formatStamp(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function readJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || "Request failed.");
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
}

function AssetRow({ asset, index, total, busy, onMove, onRemove }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--sketch-line-soft)", flexWrap: "wrap" }}>
      <div style={{ ...lbl, fontSize: 14, color: "var(--sketch-ink)", width: 22, textAlign: "right" }}>{asset.position}</div>
      <div style={{ width: 72, height: 128, background: "var(--sketch-paper-raw)", border: "1px solid var(--sketch-line)", flexShrink: 0, overflow: "hidden" }}>
        {asset.mediaType === "VIDEO" ? (
          <video src={asset.url} controls preload="metadata" playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.url} alt={asset.fileName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        )}
      </div>
      <div style={{ flex: "1 1 160px", minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-mono-ink)", fontSize: 12, color: "var(--sketch-ink)", overflowWrap: "anywhere" }}>{asset.fileName}</div>
        <div style={{ ...lbl, fontSize: 9, marginTop: 4 }}>
          {asset.mediaType === "VIDEO" ? "Video" : "Image"} · {formatSize(asset.fileSize)} · by {asset.uploadedByName}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <a href={asset.downloadUrl} style={btn} download>Download</a>
        <button type="button" style={btn} disabled={busy || index === 0} onClick={() => onMove(index, -1)} aria-label={`Move ${asset.fileName} up`}>↑</button>
        <button type="button" style={btn} disabled={busy || index === total - 1} onClick={() => onMove(index, 1)} aria-label={`Move ${asset.fileName} down`}>↓</button>
        <button type="button" style={dangerBtn} disabled={busy} onClick={() => onRemove(asset)}>Remove</button>
      </div>
    </div>
  );
}

export default function StoryDayPanel({ brandId, date, storyId: initialId, onClose, onChanged, onMoved }) {
  const [story, setStory] = useState(null);
  const [loading, setLoading] = useState(Boolean(initialId));
  const [comments, setComments] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [confirm, setConfirm] = useState(null); // { message, action }
  const [moveTo, setMoveTo] = useState("");
  const fileRef = useRef(null);
  const base = `/api/brands/${brandId}/story-content`;

  useEffect(() => {
    if (!initialId) return;
    let alive = true;
    fetch(`${base}/${initialId}`)
      .then(readJson)
      .then((d) => { if (alive) { setStory(d.story); setComments(d.story.comments || ""); } })
      .catch((e) => toast.error(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [base, initialId]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  function apply(next) {
    setStory(next);
    onChanged(next);
  }

  // Create the day on first use; reuse it if another tab created it meanwhile.
  async function ensureStory() {
    if (story) return story;
    try {
      const d = await readJson(await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyDate: date, comments }),
      }));
      apply(d.story);
      return d.story;
    } catch (e) {
      if (e.status === 409 && e.data?.existingId) {
        const d = await readJson(await fetch(`${base}/${e.data.existingId}`));
        apply(d.story);
        return d.story;
      }
      throw e;
    }
  }

  async function run(fn) {
    setBusy(true);
    try { await fn(); } catch (e) { toast.error(e.message); } finally { setBusy(false); setProgress(null); }
  }

  const saveComments = () => run(async () => {
    const s = await ensureStory();
    const d = await readJson(await fetch(`${base}/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comments }),
    }));
    apply(d.story);
    toast.success("Instructions saved.");
  });

  const upload = (fileList) => run(async () => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    let s = await ensureStory();
    // One file per request, in the order chosen, so Story order is preserved
    // and large videos stay inside the request-size limit.
    for (let i = 0; i < files.length; i++) {
      setProgress(`Uploading ${i + 1} of ${files.length}…`);
      const form = new FormData();
      form.append("file", files[i]);
      const d = await readJson(await fetch(`${base}/${s.id}/assets`, { method: "POST", body: form }));
      s = d.story;
      apply(s);
    }
    toast.success(files.length === 1 ? "Story asset uploaded." : `${files.length} Story assets uploaded.`);
  });

  const move = (index, delta) => run(async () => {
    const ids = story.assets.map((a) => a.id);
    const j = index + delta;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    const d = await readJson(await fetch(`${base}/${story.id}/assets`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetIds: ids }),
    }));
    apply(d.story);
  });

  const removeAsset = (asset) => setConfirm({
    message: `Remove "${asset.fileName}" from this Story day? The file is deleted.`,
    action: async () => {
      const d = await readJson(await fetch(`${base}/${story.id}/assets/${asset.id}`, { method: "DELETE" }));
      apply(d.story);
    },
  });

  const deleteDay = () => setConfirm({
    message: `Delete all Story content for ${formatLongDate(story.storyDate)}? All ${story.assets.length} assets are deleted.`,
    action: async () => {
      await readJson(await fetch(`${base}/${story.id}`, { method: "DELETE" }));
      onChanged(null);
      onClose();
    },
  });

  const setStatus = (status) => run(async () => {
    const d = await readJson(await fetch(`${base}/${story.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }));
    apply(d.story);
  });

  const moveDate = () => run(async () => {
    if (!moveTo || moveTo === story.storyDate) return;
    const d = await readJson(await fetch(`${base}/${story.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storyDate: moveTo }),
    }));
    toast.success(`Moved to ${formatLongDate(d.story.storyDate)}.`);
    onMoved(d.story);
  });

  const uploaded = story?.status === "UPLOADED";
  const assets = story?.assets ?? [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Story content for ${formatLongDate(date)}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "var(--sketch-scrim)" }}
    >
      <div style={{ width: "100%", maxWidth: 720, maxHeight: "calc(100vh - 32px)", overflowY: "auto", background: "var(--sketch-paper)", border: "1px solid var(--sketch-ink)", padding: "22px 24px", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div style={lbl}>Story Content</div>
            <h2 style={{ margin: "4px 0 0", fontFamily: "var(--font-display)", fontWeight: 900, fontSize: 28, textTransform: "uppercase", color: "var(--sketch-ink)" }}>
              {formatLongDate(story?.storyDate ?? date)}
            </h2>
          </div>
          <button type="button" style={btn} onClick={onClose} disabled={busy}>Close</button>
        </div>

        {loading ? (
          <div style={{ ...lbl, marginTop: 20 }}>Loading…</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 14, ...lbl, fontSize: 9 }}>
              <span>
                Status:{" "}
                <strong style={{ color: !story ? "var(--sketch-ink-faint)" : uploaded ? "var(--sketch-sage)" : "var(--sketch-vermilion)" }}>
                  {!story ? "Empty" : uploaded ? "Uploaded" : "Ready"}
                </strong>
              </span>
              {story && <span>Created by: <strong style={{ color: "var(--sketch-ink)" }}>{story.createdByName}</strong> · {formatStamp(story.createdAt)}</span>}
              {story && <span>Last updated: {formatStamp(story.updatedAt)}</span>}
              {uploaded && <span>Marked uploaded by: <strong style={{ color: "var(--sketch-ink)" }}>{story.completedByName}</strong> · {formatStamp(story.completedAt)}</span>}
            </div>

            <div style={{ marginTop: 20 }}>
              <label htmlFor="story-comments" style={lbl}>Comments / Publishing instructions</label>
              <textarea
                id="story-comments"
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                rows={4}
                maxLength={5000}
                placeholder="e.g. Publish in this order. Add link sticker on Story 3."
                style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 6, padding: 10, fontFamily: "var(--font-mono-ink)", fontSize: 12, color: "var(--sketch-ink)", background: "var(--sketch-paper-bright)", border: "1px solid var(--sketch-line)", resize: "vertical" }}
              />
              <div style={{ marginTop: 6 }}>
                <button type="button" style={btn} disabled={busy || (story ? comments === (story.comments || "") : !comments.trim())} onClick={saveComments}>
                  Save instructions
                </button>
              </div>
            </div>

            <div style={{ marginTop: 22 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "1px solid var(--sketch-line)", paddingBottom: 6 }}>
                <span style={{ ...lbl, color: "var(--sketch-ink)" }}>Story Assets</span>
                <span style={{ ...lbl, fontSize: 9 }}>{assets.length} / 20 · in publishing order</span>
              </div>
              {assets.length === 0 && (
                <div style={{ ...lbl, fontSize: 9, padding: "14px 0" }}>No Story assets yet. JPG, PNG, WebP (10 MB) · MP4, MOV (100 MB).</div>
              )}
              {assets.map((a, i) => (
                <AssetRow key={a.id} asset={a} index={i} total={assets.length} busy={busy} onMove={move} onRemove={removeAsset} />
              ))}
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
                <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
                <button type="button" style={primaryBtn} disabled={busy || assets.length >= 20} onClick={() => fileRef.current?.click()}>
                  + Upload Story Assets
                </button>
                {progress && <span style={{ ...lbl, fontSize: 9 }}>{progress}</span>}
              </div>
            </div>

            {story && (
              <div style={{ marginTop: 24, paddingTop: 14, borderTop: "1px solid var(--sketch-ink)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {uploaded ? (
                    <button type="button" style={btn} disabled={busy} onClick={() => setStatus("READY")}>Reopen</button>
                  ) : (
                    <button type="button" style={sageBtn} disabled={busy || assets.length === 0} onClick={() => setStatus("UPLOADED")}>Mark as Uploaded</button>
                  )}
                  <button type="button" style={dangerBtn} disabled={busy} onClick={deleteDay}>Delete Story Day</button>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <label htmlFor="story-move" style={{ ...lbl, fontSize: 9 }}>Move to</label>
                  <input id="story-move" type="date" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} style={{ fontFamily: "var(--font-mono-ink)", fontSize: 11, padding: "3px 6px", border: "1px solid var(--sketch-line)", background: "var(--sketch-paper-bright)", color: "var(--sketch-ink)" }} />
                  <button type="button" style={btn} disabled={busy || !moveTo || moveTo === story.storyDate} onClick={moveDate}>Move</button>
                </div>
              </div>
            )}
            <div style={{ ...lbl, fontSize: 8, marginTop: 14 }}>
              Manual handoff only — nothing here publishes to Instagram. &ldquo;Uploaded&rdquo; records that a person posted it.
            </div>
          </>
        )}
      </div>

      {confirm && (
        <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "var(--sketch-scrim)" }}>
          <div style={{ maxWidth: 420, background: "var(--sketch-paper)", border: "1px solid var(--sketch-ink)", padding: 20 }}>
            <div style={{ ...lbl, color: "var(--sketch-ink)", fontSize: 11, marginBottom: 16, lineHeight: 1.5 }}>{confirm.message}</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" style={btn} onClick={() => setConfirm(null)}>Cancel</button>
              <button type="button" style={primaryBtn} onClick={() => { const a = confirm.action; setConfirm(null); run(a); }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
