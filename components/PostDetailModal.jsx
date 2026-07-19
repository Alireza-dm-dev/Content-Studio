"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import {
  parseWallClockInTz,
  formatToDateTimeLocalInTz,
  formatScheduledDateInTz,
} from "@/lib/timezone";

const lbl = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--sketch-ink-faint)",
};

// Local fallback: mirrors buildN8nPayload from lib/published-post-utils.js
// but kept here because that module imports fs/promises (not client-safe).
function mapN8nPostType(postType) {
  if (!postType) return "single_image";
  const lower = postType.toLowerCase().trim();
  if (lower === "static") return "single_image";
  if (lower === "carousel") return "carousel";
  if (lower === "reel" || lower === "video" || lower === "reels") return "reels";
  return "single_image";
}

function buildPayloadFromPost(post) {
  const orderedMedia = (post.media || []).sort((a, b) => a.order - b.order);
  const mediaCount = orderedMedia.length;
  const isCarousel = post.postType === "carousel" || mediaCount > 1;
  const firstVideo = orderedMedia.find((m) => m.mediaType === "VIDEO");

  let scheduledDateStr = "";
  if (post.scheduledDate) {
    scheduledDateStr = formatScheduledDateInTz(post.scheduledDate, "America/Vancouver");
  }

  const now = new Date();
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const webhookSentAt = `${now.getFullYear()}-${months[now.getMonth()]} ${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()} ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;

  const postId = post.postNumber != null
    ? `POST-${String(post.postNumber).padStart(4, "0")}`
    : post.id;

  const files = orderedMedia.map((m) => {
    const entry = { media_type: m.mediaType };
    if (m.mediaType === "IMAGE") {
      entry.image_url = m.url;
    } else if (m.mediaType === "VIDEO") {
      entry.video_url = m.url;
    } else if (m.mediaType === "document") {
      entry.document_url = m.url;
    } else {
      entry.video_url = m.url;
    }
    return entry;
  });

  const mediaList = orderedMedia.map((m) => ({
    order: m.order,
    url: m.url,
    media_type: m.mediaType,
  }));

  const n8nPostType = mapN8nPostType(post.postType);

  const hashtags = (post.caption || "").match(/#[\w\u0600-\u06FF\u0400-\u04FF]+/g)?.join(" ") || "";

  const isLinkedIn = (post.platform || "Instagram") === "LinkedIn";
  const includeMediaUrl = n8nPostType !== "reels" && !isLinkedIn;
  const mediaUrl = orderedMedia[0] ? orderedMedia[0].url : "";

  return {
    row_number: post.postNumber || 0,
    "Post ID": postId,
    Platform: post.platform || "Instagram",
    "Post Type": n8nPostType,
    "Scheduled Date": scheduledDateStr,
    Caption: post.caption || "",
    Hashtags: hashtags,
    "Account / Profile": "",
    Status: post.status || "draft",
    "Webhook Sent At": webhookSentAt,
    "Error Log": "",
    Notes: post.notes || "",
    data: "",
    output: "",
    from_smartcc: false,
    ...(includeMediaUrl ? { media_url: mediaUrl } : {}),
    files,
    media: mediaList,
    media_count: mediaCount,
    is_carousel: isCarousel,
    video_url: firstVideo ? firstVideo.url : "",
    thumbnail_url: post.thumbnailUrl || "",
  };
}

function getPayload(post) {
  if (post.jsonPayload) {
    try {
      return typeof post.jsonPayload === "string"
        ? JSON.parse(post.jsonPayload)
        : post.jsonPayload;
    } catch {
      // stored jsonPayload is corrupt — fall through
    }
  }
  return buildPayloadFromPost(post);
}

function formatPostIdShort(postNumber) {
  if (postNumber == null) return null;
  return `P-${String(postNumber).padStart(3, "0")}`;
}

export default function PostDetailModal({ post, brandId, onClose, onUpdated, onDeleted }) {
  const [copied, setCopied] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [carouselIdx, setCarouselIdx] = useState(0);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Edit form state
  const [editCaption, setEditCaption] = useState(post.caption || "");
  const [editPlatform, setEditPlatform] = useState(post.platform || "Instagram");
  const [editPostType, setEditPostType] = useState(post.postType || "static");
  const [editScheduledDate, setEditScheduledDate] = useState(
    post.scheduledDate ? formatToDateTimeLocalInTz(post.scheduledDate, "America/Vancouver") : ""
  );
  const [editNotes, setEditNotes] = useState(post.notes || "");
  const [editStatus, setEditStatus] = useState(post.status || "draft");

  const payload = useMemo(() => getPayload(post), [post]);
  const payloadStr = useMemo(() => JSON.stringify(payload, null, 2), [payload]);

  const orderedMedia = [...(post.media || [])].sort((a, b) => a.order - b.order);
  const isCarousel = post.postType === "carousel" || orderedMedia.length > 1;
  const currentMedia = orderedMedia[carouselIdx] || null;

  const postIdShort = formatPostIdShort(post.postNumber);

  const uploadDate = post.createdAt
    ? new Date(post.createdAt).toLocaleDateString("en-US", {
        year: "numeric", month: "short", day: "numeric",
      })
    : null;

  const scheduledDateStr = post.scheduledDate
    ? new Date(post.scheduledDate).toLocaleDateString("en-US", {
        year: "numeric", month: "short", day: "numeric",
        timeZone: "America/Vancouver",
      })
    : null;

  async function handleCopyJson() {
    try {
      await navigator.clipboard.writeText(payloadStr);
      setCopied(true);
      toast.success("JSON payload copied!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy to clipboard.");
    }
  }

  async function handleSendToN8n() {
    if (!brandId) {
      toast.error("Missing brand ID for sending to n8n.");
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/brands/${brandId}/published-posts/${post.id}/send-webhook`, {
        method: "POST",
      });
      let data;
      try {
        const text = await res.text();
        if (!text) {
          throw new Error(`Send failed with status ${res.status}`);
        }
        data = JSON.parse(text);
      } catch {
        throw new Error(`Send failed with status ${res.status}`);
      }

      if (!res.ok) {
        let message = data.error || `Send failed with status ${res.status}`;
        if (data.webhookStatus && data.details) {
          message += ` (Status ${data.webhookStatus}: ${data.details})`;
        }
        throw new Error(message);
      }
      toast.success("Sent to n8n.");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  }

  function handleDownloadJson() {
    const blob = new Blob([payloadStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const postNumber = post.postNumber ? `POST-${String(post.postNumber).padStart(4, "0")}` : post.id;
    a.href = url;
    a.download = `published-post-${postNumber}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function handleEdit() {
    setEditCaption(post.caption || "");
    setEditPlatform(post.platform || "Instagram");
    setEditPostType(post.postType || "static");
    setEditScheduledDate(
      post.scheduledDate ? formatToDateTimeLocalInTz(post.scheduledDate, "America/Vancouver") : ""
    );
    setEditNotes(post.notes || "");
    setEditStatus(post.status || "draft");
    setEditing(true);
  }

  function handleCancelEdit() {
    setEditing(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const scheduledDateIso =
        editScheduledDate
          ? (parseWallClockInTz(editScheduledDate, "America/Vancouver")?.toISOString() ?? null)
          : null;

      const body = {
        caption: editCaption,
        platform: editPlatform,
        postType: editPostType,
        scheduledDate: scheduledDateIso,
        notes: editNotes,
        status: editStatus,
      };
      const res = await fetch(`/api/brands/${brandId}/published-posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let data;
      try {
        const text = await res.text();
        if (!text) throw new Error(`Save failed with status ${res.status}`);
        data = JSON.parse(text);
      } catch {
        throw new Error(`Save failed with status ${res.status}`);
      }
      if (!res.ok) {
        throw new Error(data?.error || `Save failed with status ${res.status}`);
      }
      toast.success("Post updated.");
      setEditing(false);
      if (onUpdated) onUpdated(data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/brands/${brandId}/published-posts/${post.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const text = await res.text();
        let msg;
        try { msg = JSON.parse(text).error; } catch { msg = `Delete failed with status ${res.status}`; }
        throw new Error(msg);
      }
      toast.success("Post deleted.");
      if (onDeleted) onDeleted(post.id);
      onClose();
    } catch (err) {
      toast.error(err.message);
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  function handlePrev() {
    setCarouselIdx((prev) => (prev > 0 ? prev - 1 : orderedMedia.length - 1));
  }

  function handleNext() {
    setCarouselIdx((prev) => (prev < orderedMedia.length - 1 ? prev + 1 : 0));
  }

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
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.60)",
          backdropFilter: "blur(4px)",
        }}
      />

      {/* Modal card */}
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 640,
          maxHeight: "90vh",
          overflowY: "auto",
          background: "var(--sketch-paper-bright)",
          border: "1px solid var(--sketch-line)",
          boxShadow: "2px 2px 0 rgba(28,24,18,0.10)",
        }}
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
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              fontFamily: "var(--font-display)",
              fontSize: 16,
              fontWeight: 700,
              textTransform: "uppercase",
              color: "var(--sketch-ink)",
              lineHeight: 1,
            }}>
              Published Post
            </span>
            {postIdShort && (
              <span style={{
                ...lbl,
                fontSize: 9,
                color: "var(--sketch-vermilion)",
              }}>
                {postIdShort}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {!editing && (
              <>
                <button
                  type="button"
                  onClick={handleEdit}
                  style={inkBtn}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  style={{
                    ...inkBtn,
                    color: "var(--sketch-vermilion)",
                    borderColor: "var(--sketch-vermilion)",
                  }}
                >
                  {confirmDelete ? "Confirm Delete" : deleting ? "Deleting\u2026" : "Delete"}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              style={{
                ...inkBtn,
                border: "none",
                fontSize: 14,
                padding: "2px 8px",
                lineHeight: 1,
              }}
            >
              &times;
            </button>
          </div>
        </div>

        {/* ── Media ── */}
        <div
          style={{
            position: "relative",
            background: "var(--sketch-paper-raw)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 280,
            maxHeight: 440,
            overflow: "hidden",
          }}
        >
          {currentMedia && currentMedia.mediaType === "VIDEO" ? (
            <video
              src={currentMedia.url}
              controls
              style={{
                width: "100%",
                height: "100%",
                maxHeight: 440,
                objectFit: "contain",
                display: "block",
              }}
            />
          ) : currentMedia ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={currentMedia.url}
              alt={post.caption || "Post media"}
              style={{
                width: "100%",
                height: "100%",
                maxHeight: 440,
                objectFit: "contain",
                display: "block",
              }}
            />
          ) : (
            <div style={{ padding: 40, textAlign: "center", ...lbl }}>
              No media available
            </div>
          )}

          {/* Carousel navigation */}
          {isCarousel && orderedMedia.length > 1 && (
            <>
              <button
                type="button"
                onClick={handlePrev}
                style={{
                  position: "absolute",
                  left: 8,
                  top: "50%",
                  transform: "translateY(-50%)",
                  ...inkBtn,
                  border: "1px solid var(--sketch-line)",
                  background: "var(--sketch-paper-bright)",
                  padding: "4px 10px",
                  fontSize: 16,
                  lineHeight: 1,
                  opacity: 0.8,
                }}
              >
                &#8249;
              </button>
              <button
                type="button"
                onClick={handleNext}
                style={{
                  position: "absolute",
                  right: 8,
                  top: "50%",
                  transform: "translateY(-50%)",
                  ...inkBtn,
                  border: "1px solid var(--sketch-line)",
                  background: "var(--sketch-paper-bright)",
                  padding: "4px 10px",
                  fontSize: 16,
                  lineHeight: 1,
                  opacity: 0.8,
                }}
              >
                &#8250;
              </button>
              <div
                style={{
                  position: "absolute",
                  bottom: 8,
                  left: "50%",
                  transform: "translateX(-50%)",
                  display: "flex",
                  gap: 6,
                  ...lbl,
                  fontSize: 9,
                  color: "var(--sketch-ink)",
                  background: "var(--sketch-paper-bright)",
                  padding: "3px 10px",
                  border: "1px solid var(--sketch-line)",
                  opacity: 0.85,
                }}
              >
                {orderedMedia.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setCarouselIdx(i)}
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      border: "none",
                      background: i === carouselIdx ? "var(--sketch-ink)" : "var(--sketch-line)",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── Info ── */}
        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
          {editing ? (
            <>
              <EditField label="Caption">
                <textarea
                  value={editCaption}
                  onChange={(e) => setEditCaption(e.target.value)}
                  rows={3}
                  style={fieldStyle}
                />
              </EditField>
              <EditField label="Platform">
                <input
                  type="text"
                  value={editPlatform}
                  onChange={(e) => setEditPlatform(e.target.value)}
                  style={fieldStyle}
                />
              </EditField>
              <EditField label="Post Type">
                <select
                  value={editPostType}
                  onChange={(e) => setEditPostType(e.target.value)}
                  style={fieldStyle}
                >
                  <option value="static">Static</option>
                  <option value="carousel">Carousel</option>
                  <option value="reel">Reel / Video</option>
                </select>
              </EditField>
              <EditField label="Scheduled Date">
                <input
                  type="datetime-local"
                  value={editScheduledDate}
                  onChange={(e) => setEditScheduledDate(e.target.value)}
                  style={fieldStyle}
                />
              </EditField>
              <EditField label="Notes">
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={2}
                  style={fieldStyle}
                />
              </EditField>
              <EditField label="Status">
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  style={fieldStyle}
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
                </select>
              </EditField>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  disabled={saving}
                  style={{ ...inkBtn, opacity: saving ? 0.5 : 1 }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    ...inkBtn,
                    borderColor: "var(--sketch-vermilion)",
                    background: "var(--sketch-vermilion)",
                    color: "var(--sketch-paper-bright)",
                    opacity: saving ? 0.5 : 1,
                  }}
                >
                  {saving ? "Saving\u2026" : "Save"}
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Metadata rows */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <InfoField label="Post Type" value={post.postType} />
                <InfoField label="Platform" value={post.platform} />
                <InfoField label="Uploaded" value={uploadDate} />
                {scheduledDateStr && <InfoField label="Scheduled" value={scheduledDateStr} />}
                {post.status && <InfoField label="Status" value={post.status} />}
                {post.notes && <InfoField label="Notes" value={post.notes} />}
              </div>

              {/* Caption */}
              {post.caption && (
                <div>
                  <div style={{ ...lbl, marginBottom: 4 }}>Caption</div>
                  <div style={{
                    fontFamily: "var(--font-mono-ink)",
                    fontSize: 11,
                    color: "var(--sketch-ink)",
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    maxHeight: 120,
                    overflowY: "auto",
                  }}>
                    {post.caption}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── n8n JSON Payload ── */}
          <div style={{ borderTop: "1px solid var(--sketch-line)", paddingTop: 12 }}>
            <button
              type="button"
              onClick={() => setShowJson((v) => !v)}
              style={{
                ...inkBtn,
                border: "none",
                width: "100%",
                justifyContent: "space-between",
                padding: 0,
              }}
            >
              <span>n8n JSON Payload</span>
              <span>{showJson ? "\u25B2" : "\u25BC"}</span>
            </button>

            {showJson && (
              <div style={{ marginTop: 10 }}>
                <div style={{ ...lbl, fontSize: 9, color: "var(--sketch-ink-soft)", marginBottom: 8, lineHeight: 1.5 }}>
                  Webhook-ready payload prepared for n8n or an upload automation server.
                </div>
                <pre
                  style={{
                    fontFamily: "var(--font-mono-ink)",
                    fontSize: 10,
                    lineHeight: 1.5,
                    color: "var(--sketch-ink)",
                    background: "var(--sketch-paper-raw)",
                    border: "1px solid var(--sketch-line)",
                    padding: 10,
                    maxHeight: 360,
                    overflow: "auto",
                    whiteSpace: "pre",
                    wordBreak: "normal",
                    margin: 0,
                  }}
                >
                  {payloadStr}
                </pre>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
                  <button
                    type="button"
                    onClick={handleCopyJson}
                    style={{
                      ...inkBtn,
                      borderColor: "var(--sketch-vermilion)",
                      color: "var(--sketch-vermilion)",
                    }}
                  >
                    {copied ? "Copied!" : "Copy JSON"}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadJson}
                    style={inkBtn}
                  >
                    Download JSON
                  </button>
                  <button
                    type="button"
                    onClick={handleSendToN8n}
                    disabled={sending}
                    style={{
                      ...inkBtn,
                      borderColor: sending ? "var(--sketch-ink-soft)" : "var(--sketch-ink)",
                      color: sending ? "var(--sketch-ink-soft)" : "var(--sketch-ink-soft)",
                    }}
                  >
                    {sending ? "Sending\u2026" : "Send to n8n"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const fieldStyle = {
  width: "100%",
  padding: "6px 10px",
  fontFamily: "var(--font-mono-ink)",
  fontSize: 11,
  color: "var(--sketch-ink)",
  background: "var(--sketch-paper-bright)",
  border: "1px solid var(--sketch-line)",
  borderRadius: 0,
  outline: "none",
  boxSizing: "border-box",
};

function InfoField({ label, value }) {
  if (value == null) return null;
  return (
    <div>
      <div style={{ ...lbl, marginBottom: 2 }}>{label}</div>
      <div style={{
        fontFamily: "var(--font-mono-ink)",
        fontSize: 11,
        color: "var(--sketch-ink)",
        textTransform: "capitalize",
      }}>
        {String(value)}
      </div>
    </div>
  );
}

function EditField({ label, children }) {
  return (
    <div>
      <div style={{ ...lbl, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}
