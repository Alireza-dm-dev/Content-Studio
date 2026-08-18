"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { StatusPill } from "@/components/content-report/StatusPill";
import { detectKind } from "@/components/LinkedInPublishedPostsSection";
import {
  parseWallClockInTz,
  formatToDateTimeLocalInTz,
  formatScheduledDateInTz,
} from "@/lib/timezone";
import CrossPlatformPostModal from "@/components/CrossPlatformPostModal";

const CLIENT_FETCH_TIMEOUT = 660000;

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

// Recognizable LinkedIn "in" mark drawn inline (no external asset / package).
function LinkedInIcon({ size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-label="LinkedIn"
      role="img"
      style={{ display: "inline-block", flexShrink: 0 }}
    >
      <rect width="24" height="24" rx="4" fill="#0A66C2" />
      <path
        d="M6.94 8.2H4.3V18h2.64V8.2zM5.62 4.3a1.53 1.53 0 1 0 0 3.06 1.53 1.53 0 0 0 0-3.06zM19.7 18v-5.36c0-2.86-1.53-4.19-3.57-4.19-1.64 0-2.37.9-2.78 1.54V8.2H10.7c.04.94 0 9.8 0 9.8h2.64v-5.47c0-.29.02-.58.1-.79.23-.58.76-1.18 1.65-1.18.16 0 1.13 0 1.13 1.18V18h2.48z"
        fill="#fff"
      />
    </svg>
  );
}

function formatPostId(postNumber) {
  if (postNumber == null) return null;
  return `POST-${String(postNumber).padStart(4, "0")}`;
}

function fmtDate(date) {
  if (!date) return null;
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

function isPublicUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url.trim());
}

function safeParse(value) {
  if (value == null) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// Resolve the best public PDF URL in priority order:
//   1. parsed jsonPayload.media[0].url when it is an absolute public URL
//   2. parsed jsonPayload.files[0].document_url
//   3. post.media[0].url
// We never replace a public SFTP URL with a local /uploads path.
function resolvePdfUrl(post) {
  const parsed = safeParse(post.jsonPayload);
  if (parsed && typeof parsed === "object") {
    const media0 = Array.isArray(parsed.media) ? parsed.media[0] : null;
    if (media0 && typeof media0.url === "string" && isPublicUrl(media0.url)) {
      return media0.url;
    }
    const file0 = Array.isArray(parsed.files) ? parsed.files[0] : null;
    if (
      file0 &&
      typeof file0.document_url === "string" &&
      isPublicUrl(file0.document_url)
    ) {
      return file0.document_url;
    }
  }
  const docMedia =
    (post.media || []).find((m) => m.mediaType === "document") ||
    post.media?.[0] ||
    null;
  return docMedia?.url || "";
}

// Match a stored media_type (e.g. "IMAGE"/"VIDEO"/"document") against a
// high-level kind ("image"/"video"/"pdf").
function matchMediaKind(mediaType, kind) {
  const t = (mediaType || "").toLowerCase();
  if (kind === "image") return t === "image";
  if (kind === "video") return t === "video";
  if (kind === "pdf") return t === "document";
  return false;
}

// Resolve the public media URL(s) for a LinkedIn post from the most reliable
// stored source. Prefers the public URLs already in jsonPayload (remote SFTP),
// then falls back to Prisma media rows. Never converts a public URL to a local
// /uploads path, and never rebuilds the payload.
function resolveLinkedInMedia(post) {
  const parsed = safeParse(post.jsonPayload);
  const payload = parsed && typeof parsed === "object" ? parsed : null;
  const pMedia = Array.isArray(payload?.media) ? payload.media : [];
  const pFiles = Array.isArray(payload?.files) ? payload.files : [];
  const dbMedia = Array.isArray(post.media) ? post.media : [];

  const kind = detectKind(post);

  let url = "";
  let thumbnailUrl = "";

  if (pMedia.length) {
    const match = pMedia.find((m) => matchMediaKind(m.media_type, kind)) || pMedia[0];
    if (match?.url && isPublicUrl(match.url)) url = match.url;
  }
  if (!url) {
    const f = pFiles[0];
    if (f) {
      const candidate =
        kind === "video" ? f.video_url : kind === "pdf" ? f.document_url : f.image_url;
      if (candidate && isPublicUrl(candidate)) url = candidate;
    }
  }
  if (
    !url &&
    kind === "video" &&
    typeof payload?.video_url === "string" &&
    isPublicUrl(payload.video_url)
  ) {
    url = payload.video_url;
  }
  if (typeof payload?.thumbnail_url === "string" && isPublicUrl(payload.thumbnail_url)) {
    thumbnailUrl = payload.thumbnail_url;
  }

  if (!url) {
    const m = dbMedia.find((x) => matchMediaKind(x.mediaType, kind)) || dbMedia[0];
    if (m) url = m.fileUrl || m.url || m.filePath || "";
  }
  if (!thumbnailUrl && post.thumbnailUrl) thumbnailUrl = post.thumbnailUrl;

  const src = url || thumbnailUrl || "";
  const fileName = src ? src.split("/").pop() || "" : "";

  return { kind, url, thumbnailUrl, fileName };
}

// Human-readable LinkedIn post-type label (display only; stored postType is
// never changed).
function linkedInPostTypeLabel(postType) {
  const t = (postType || "").toLowerCase();
  if (t === "static") return "Single Image";
  if (t === "carousel") return "PDF Document";
  if (t === "reel" || t === "video") return "Video";
  return postType || "Unknown";
}

function mediaFormatLabel(kind) {
  if (kind === "video") return "Video";
  if (kind === "image") return "Image";
  return "PDF Document";
}

// Minimal LinkedIn fallback payload — used ONLY when the stored JSON is missing,
// empty, or invalid, so the modal never breaks. It deliberately omits media_url
// and mirrors the canonical n8n shape for the post's media kind. Valid stored
// JSON is displayed exactly as-is (no rewriting).
function buildLinkedInFallback(post, url, thumbnailUrl, kind) {
  const postId = formatPostId(post.postNumber) || post.id;
  const scheduledDateStr = post.scheduledDate
    ? formatScheduledDateInTz(post.scheduledDate, "America/Vancouver")
    : "";

  let postTypeLabel;
  let mediaType;
  let filesEntry;
  let mediaEntry;
  let isCarousel = false;
  let videoUrl = "";

  if (kind === "video") {
    postTypeLabel = "reels";
    mediaType = "VIDEO";
    filesEntry = { media_type: "VIDEO", video_url: url };
    mediaEntry = { order: 1, url, media_type: "VIDEO" };
    videoUrl = url;
  } else if (kind === "image") {
    postTypeLabel = "single_image";
    mediaType = "IMAGE";
    filesEntry = { media_type: "IMAGE", image_url: url };
    mediaEntry = { order: 1, url, media_type: "IMAGE" };
  } else {
    postTypeLabel = "carousel";
    mediaType = "document";
    filesEntry = { media_type: "document", document_url: url };
    mediaEntry = { order: 1, url, media_type: "document" };
    isCarousel = true;
  }

  return {
    "Post ID": postId,
    Platform: "LinkedIn",
    "Post Type": postTypeLabel,
    Caption: post.caption || "",
    "Scheduled Date": scheduledDateStr,
    Status: post.status || "draft",
    Notes: post.notes || "",
    files: [filesEntry],
    media: [mediaEntry],
    media_count: 1,
    is_carousel: isCarousel,
    video_url: videoUrl,
    thumbnail_url: thumbnailUrl || "",
  };
}

function getPayload(post, url, thumbnailUrl, kind) {
  const parsed = safeParse(post.jsonPayload);
  if (parsed && typeof parsed === "object") {
    return { payload: parsed, usedFallback: false };
  }
  return { payload: buildLinkedInFallback(post, url, thumbnailUrl, kind), usedFallback: true };
}

function InfoField({ label, value }) {
  if (value == null) return null;
  return (
    <div>
      <div style={{ ...lbl, marginBottom: 2 }}>{label}</div>
      <div
        style={{
          fontFamily: "var(--font-mono-ink)",
          fontSize: 11,
          color: "var(--sketch-ink)",
          textTransform: "capitalize",
        }}
      >
        {String(value)}
      </div>
    </div>
  );
}

export default function LinkedInPostDetailModal({
  post,
  brandId,
  onClose,
  onUpdated,
  onDeleted,
  onCrossPlatformCreated,
}) {
  const [copied, setCopied] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showAdapt, setShowAdapt] = useState(false);

  // Track whether the modal has already been closed so late async responses
  // (e.g. a slow DELETE) do not mutate parent state or reopen the modal.
  const closedRef = useRef(false);

  // Edit form state
  const [editCaption, setEditCaption] = useState(post.caption || "");
  const [editScheduledDate, setEditScheduledDate] = useState(
    post.scheduledDate
      ? formatToDateTimeLocalInTz(post.scheduledDate, "America/Vancouver")
      : "",
  );
  const [editNotes, setEditNotes] = useState(post.notes || "");
  const [editStatus, setEditStatus] = useState(post.status || "draft");

  const resolvedPdfUrl = useMemo(() => resolvePdfUrl(post), [post]);
  const media = useMemo(() => resolveLinkedInMedia(post), [post]);
  const { payload, usedFallback } = useMemo(
    () => getPayload(post, media.url, media.thumbnailUrl, media.kind),
    [post, media],
  );
  const payloadStr = useMemo(() => JSON.stringify(payload, null, 2), [payload]);

  const docMedia =
    (post.media || []).find((m) => m.mediaType === "document") ||
    post.media?.[0] ||
    null;
  const pdfFileName =
    docMedia?.fileName ||
    (resolvedPdfUrl ? resolvedPdfUrl.split("/").pop() : "") ||
    "document.pdf";
  const pdfFileSize = docMedia?.fileSize;

  const postIdShort = formatPostId(post.postNumber);
  const uploadDate = fmtDate(post.createdAt);
  const scheduledDateStr = fmtDate(post.scheduledDate);

  // A destructive / in-flight request is active — block dismiss actions.
  const busy = saving || deleting || sending;

  function requestClose() {
    if (busy) return;
    closedRef.current = true;
    onClose();
  }

  // Escape closes the modal unless a save/delete/send is in flight.
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape" && !busy) {
        requestClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, onClose]);

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

  function handleDownloadJson() {
    const blob = new Blob([payloadStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const postId = formatPostId(post.postNumber) || post.id;
    a.href = url;
    a.download = `linkedin-post-${postId}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleSendToN8n() {
    if (!brandId) {
      toast.error("Missing brand ID for sending to n8n.");
      return;
    }
    setSending(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CLIENT_FETCH_TIMEOUT);
    try {
      console.log("[SendToN8n] sending", { brandId, postId: post.id });
      const res = await fetch(
        `/api/brands/${brandId}/published-posts/${post.id}/send-webhook`,
        { method: "POST", signal: controller.signal },
      );
      let data;
      try {
        const text = await res.text();
        if (!text) throw new Error(`Send failed with status ${res.status}`);
        data = JSON.parse(text);
      } catch {
        throw new Error(`Send failed with status ${res.status}`);
      }

      if (closedRef.current) return;

      if (res.ok || (data.post && data.webhookResult?.success === false)) {
        if (data.post && onUpdated && !closedRef.current) {
          onUpdated(data.post);
        } else if (onUpdated && !closedRef.current) {
          const refreshRes = await fetch(
            `/api/brands/${brandId}/published-posts/${post.id}`,
          );
          if (refreshRes.ok) {
            const refreshed = await refreshRes.json();
            if (!closedRef.current) onUpdated(refreshed);
          }
        }
        if (data.webhookResult?.success) {
          console.log("[SendToN8n] success", { postId: post.id });
          toast.success("LinkedIn post sent to n8n.");
        } else if (data.webhookResult?.success === false) {
          const wr = data.webhookResult;
          console.error("[SendToN8n] failed", {
            httpStatus: res.status,
            code: wr.code || null,
            detailCode: wr.detailCode || null,
            details: wr.details || null,
            skipped: wr.skipped || false,
            webhookStatus: wr.webhookStatus ?? null,
            error: wr.error || null,
          });
          const reason =
            wr.details || wr.detailCode || (wr.webhookStatus ? `HTTP ${wr.webhookStatus}` : wr.code);
          toast.warning(
            reason
              ? `${wr.error || "LinkedIn post sent to n8n with warnings."} (${reason})`
              : wr.error || "LinkedIn post sent to n8n with warnings.",
          );
        }
      } else {
        throw new Error(data?.error || `Send failed with status ${res.status}`);
      }
    } catch (err) {
      if (err.name === "AbortError") {
        toast.error("Request timed out. The post may still be processing.");
      } else {
        toast.error(err.message);
      }
    } finally {
      clearTimeout(timeoutId);
      setSending(false);
    }
  }

  function handleEdit() {
    setEditCaption(post.caption || "");
    setEditScheduledDate(
      post.scheduledDate
        ? formatToDateTimeLocalInTz(post.scheduledDate, "America/Vancouver")
        : "",
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
      const scheduledDateIso = editScheduledDate
        ? parseWallClockInTz(editScheduledDate, "America/Vancouver")?.toISOString() ??
          null
        : null;

      // Only editable metadata is sent. Platform / postType / media / files /
      // jsonPayload / media_url / document_url / thumbnail_url are owned by the
      // server and must not be supplied by the client.
      const body = {
        caption: editCaption,
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
      toast.success("LinkedIn post updated.");
      setEditing(false);
      if (onUpdated && !closedRef.current) onUpdated(data);
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
        try {
          msg = JSON.parse(text).error;
        } catch {
          msg = `Delete failed with status ${res.status}`;
        }
        throw new Error(msg);
      }
      toast.success("LinkedIn post deleted.");
      if (onDeleted && !closedRef.current) onDeleted(post.id);
      closedRef.current = true;
      onClose();
    } catch (err) {
      toast.error(err.message);
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  function handleAdaptCreated(createdPost) {
    if (onCrossPlatformCreated) onCrossPlatformCreated(createdPost);
    setShowAdapt(false);
    closedRef.current = true;
    onClose();
  }

  function handleCancelDelete() {
    setConfirmDelete(false);
  }

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
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      {/* Backdrop */}
      <div
        onClick={requestClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.60)",
          backdropFilter: "blur(4px)",
        }}
      />

      {/* Modal card */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="li-post-modal-title"
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 620,
          maxHeight: "90vh",
          overflowY: "auto",
          background: "var(--sketch-paper-bright)",
          border: "1px solid var(--sketch-line)",
          boxShadow: "2px 2px 0 rgba(28,24,18,0.10)",
        }}
      >
        {/* Header */}
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
            <LinkedInIcon size={18} />
            <span
              id="li-post-modal-title"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 16,
                fontWeight: 700,
                textTransform: "uppercase",
                color: "var(--sketch-ink)",
                lineHeight: 1,
              }}
            >
              LinkedIn Post
            </span>
            {postIdShort && (
              <span style={{ ...lbl, fontSize: 9, color: "var(--sketch-vermilion)" }}>
                {postIdShort}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {!editing && (
              <>
                <button
                  type="button"
                  onClick={() => setShowAdapt(true)}
                  disabled={busy}
                  aria-label="Adapt for Instagram"
                  style={{
                    ...inkBtn,
                    opacity: busy ? 0.5 : 1,
                    borderColor: "transparent",
                    background: "var(--sketch-paper-raw)",
                    color: "var(--sketch-ink)",
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "inline-block", flexShrink: 0 }}>
                    <rect width="24" height="24" rx="5" fill="url(#ig-adapt-li)" />
                    <defs><linearGradient id="ig-adapt-li" x1="0" y1="0" x2="24" y2="24"><stop offset="0%" stopColor="#F58529"/><stop offset="50%" stopColor="#DD2A7B"/><stop offset="100%" stopColor="#8134AF"/></linearGradient></defs>
                    <circle cx="12" cy="12" r="5.5" stroke="#fff" strokeWidth="1.5" fill="none" />
                    <circle cx="18" cy="6" r="1.2" fill="#fff" />
                  </svg>
                  Adapt for Instagram
                </button>
                <button
                  type="button"
                  onClick={handleEdit}
                  disabled={busy}
                  aria-label="Edit LinkedIn post"
                  style={{ ...inkBtn, opacity: busy ? 0.5 : 1 }}
                >
                  Edit
                </button>
                {confirmDelete ? (
                  <>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      aria-label="Confirm delete LinkedIn post"
                      style={{
                        ...inkBtn,
                        color: "var(--sketch-paper-bright)",
                        background: "var(--sketch-vermilion)",
                        borderColor: "var(--sketch-vermilion)",
                      }}
                    >
                      {deleting ? "Deleting…" : "Confirm Delete"}
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelDelete}
                      disabled={deleting}
                      aria-label="Cancel delete"
                      style={{
                        ...inkBtn,
                        opacity: deleting ? 0.5 : 1,
                      }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={busy}
                    aria-label="Delete LinkedIn post"
                    style={{
                      ...inkBtn,
                      color: "var(--sketch-vermilion)",
                      borderColor: "var(--sketch-vermilion)",
                      opacity: busy ? 0.5 : 1,
                    }}
                  >
                    Delete
                  </button>
                )}
              </>
            )}
            <button
              type="button"
              onClick={requestClose}
              aria-label="Close"
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

        {/* Body */}
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
              <div style={{ ...lbl, fontSize: 9, color: "var(--sketch-ink-soft)" }}>
                Platform: LinkedIn · Post Type: {linkedInPostTypeLabel(post.postType)} (fixed)
              </div>
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
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Metadata rows */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <InfoField label="Post ID" value={postIdShort} />
                <InfoField label="Platform" value="LinkedIn" />
                <InfoField label="Post Type" value={linkedInPostTypeLabel(post.postType)} />
                <InfoField label="Media" value={mediaFormatLabel(media.kind)} />
                <div>
                  <div style={{ ...lbl, marginBottom: 2 }}>Status</div>
                  <StatusPill status={post.status} />
                </div>
                {scheduledDateStr && <InfoField label="Scheduled" value={scheduledDateStr} />}
                {uploadDate && <InfoField label="Uploaded" value={uploadDate} />}
              </div>

              {/* Caption */}
              {post.caption && (
                <div>
                  <div style={{ ...lbl, marginBottom: 4 }}>Caption</div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono-ink)",
                      fontSize: 11,
                      color: "var(--sketch-ink)",
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      maxHeight: 120,
                      overflowY: "auto",
                    }}
                  >
                    {post.caption}
                  </div>
                </div>
              )}

              {/* Notes */}
              {post.notes && <InfoField label="Notes" value={post.notes} />}

              {/* Media (image / video / PDF document) */}
              <div>
                <div style={{ ...lbl, marginBottom: 4 }}>
                  {mediaFormatLabel(media.kind)}
                </div>

                {media.kind === "image" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {media.url ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={media.url}
                          alt={post.caption || `LinkedIn post ${postIdShort || ""}`}
                          style={{
                            width: "100%",
                            maxHeight: 360,
                            objectFit: "contain",
                            background: "var(--sketch-paper-raw)",
                            display: "block",
                          }}
                        />
                        <div
                          title={media.fileName || media.url}
                          style={{
                            ...lbl,
                            fontSize: 9,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {media.fileName || media.url}
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <a
                            href={media.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Open image in a new tab"
                            style={{
                              ...inkBtn,
                              borderColor: "var(--sketch-vermilion)",
                              color: "var(--sketch-vermilion)",
                            }}
                          >
                            Open image
                          </a>
                        </div>
                      </>
                    ) : (
                      <div style={{ ...lbl, fontSize: 10, color: "var(--sketch-vermilion)" }}>
                        Image unavailable
                      </div>
                    )}
                  </div>
                )}

                {media.kind === "video" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {media.url ? (
                      <>
                        <video
                          src={media.url}
                          controls
                          preload="metadata"
                          poster={media.thumbnailUrl || undefined}
                          aria-label="LinkedIn video preview"
                          style={{
                            width: "100%",
                            maxHeight: 360,
                            objectFit: "contain",
                            background: "var(--sketch-paper-raw)",
                            display: "block",
                          }}
                        />
                        <div
                          title={media.fileName || media.url}
                          style={{
                            ...lbl,
                            fontSize: 9,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {media.fileName || media.url}
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <a
                            href={media.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Open video in a new tab"
                            style={{
                              ...inkBtn,
                              borderColor: "var(--sketch-vermilion)",
                              color: "var(--sketch-vermilion)",
                            }}
                          >
                            Open video
                          </a>
                          {media.thumbnailUrl && (
                            <a
                              href={media.thumbnailUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label="Open thumbnail in a new tab"
                              style={inkBtn}
                            >
                              Open thumbnail
                            </a>
                          )}
                        </div>
                      </>
                    ) : (
                      <div style={{ ...lbl, fontSize: 10, color: "var(--sketch-vermilion)" }}>
                        Video unavailable
                      </div>
                    )}
                  </div>
                )}

                {media.kind === "pdf" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div
                      title={pdfFileName}
                      style={{
                        fontFamily: "var(--font-mono-ink)",
                        fontSize: 11,
                        color: "var(--sketch-ink)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {pdfFileName}
                      {pdfFileSize != null && (
                        <span style={{ ...lbl, fontSize: 9, marginLeft: 6 }}>
                          {`(${(pdfFileSize / 1024).toFixed(0)} KB)`}
                        </span>
                      )}
                    </div>
                    <div
                      title={resolvedPdfUrl}
                      style={{
                        ...lbl,
                        fontSize: 9,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {resolvedPdfUrl || "No document URL"}
                    </div>
                    {resolvedPdfUrl && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <a
                          href={resolvedPdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="Open PDF in a new tab"
                          style={{
                            ...inkBtn,
                            borderColor: "var(--sketch-vermilion)",
                            color: "var(--sketch-vermilion)",
                          }}
                        >
                          Open PDF
                        </a>
                        <a
                          href={resolvedPdfUrl}
                          download={pdfFileName}
                          aria-label="Download PDF"
                          style={inkBtn}
                        >
                          Download PDF
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {/* n8n JSON payload */}
          <div style={{ borderTop: "1px solid var(--sketch-line)", paddingTop: 12 }}>
            <button
              type="button"
              onClick={() => setShowJson((v) => !v)}
              aria-expanded={showJson}
              aria-label="Toggle n8n JSON payload"
              style={{
                ...inkBtn,
                border: "none",
                width: "100%",
                justifyContent: "space-between",
                padding: 0,
              }}
            >
              <span>n8n JSON Payload</span>
              <span>{showJson ? "▲" : "▼"}</span>
            </button>

            {showJson && (
              <div style={{ marginTop: 10 }}>
                {usedFallback && (
                  <div
                    style={{
                      ...lbl,
                      fontSize: 9,
                      color: "var(--sketch-vermilion)",
                      marginBottom: 8,
                      lineHeight: 1.5,
                    }}
                  >
                    Stored JSON is missing or invalid — showing a generated
                    LinkedIn fallback payload for preview only.
                  </div>
                )}
                <div
                  style={{
                    ...lbl,
                    fontSize: 9,
                    color: "var(--sketch-ink-soft)",
                    marginBottom: 8,
                    lineHeight: 1.5,
                  }}
                >
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
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={handleCopyJson}
                    aria-label="Copy JSON payload"
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
                    aria-label="Download JSON payload"
                    style={inkBtn}
                  >
                    Download JSON
                  </button>
                  <button
                    type="button"
                    onClick={handleSendToN8n}
                    disabled={sending}
                    aria-label="Send payload to n8n"
                    style={{
                      ...inkBtn,
                      borderColor: sending ? "var(--sketch-ink-soft)" : "var(--sketch-ink)",
                      color: sending ? "var(--sketch-ink-soft)" : "var(--sketch-ink-soft)",
                    }}
                  >
                    {sending ? "Sending…" : "Send to n8n"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showAdapt && (
        <CrossPlatformPostModal
          sourcePost={post}
          sourcePlatform="LinkedIn"
          targetPlatform="Instagram"
          brandId={brandId}
          onCreated={handleAdaptCreated}
          onClose={() => setShowAdapt(false)}
        />
      )}
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
