"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { toast } from "sonner";
import { parseWallClockInTz, formatToDateTimeLocalInTz } from "@/lib/timezone";

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

function InstagramIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="Instagram" role="img" style={{ display: "inline-block", flexShrink: 0 }}>
      <rect width="24" height="24" rx="5" fill="url(#ig-grad)" />
      <defs><linearGradient id="ig-grad" x1="0" y1="0" x2="24" y2="24"><stop offset="0%" stopColor="#F58529"/><stop offset="50%" stopColor="#DD2A7B"/><stop offset="100%" stopColor="#8134AF"/></linearGradient></defs>
      <circle cx="12" cy="12" r="5.5" stroke="#fff" strokeWidth="1.5" fill="none" />
      <circle cx="18" cy="6" r="1.2" fill="#fff" />
    </svg>
  );
}

function LinkedInIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="LinkedIn" role="img" style={{ display: "inline-block", flexShrink: 0 }}>
      <rect width="24" height="24" rx="4" fill="#0A66C2" />
      <path d="M6.94 8.2H4.3V18h2.64V8.2zM5.62 4.3a1.53 1.53 0 100 3.06 1.53 1.53 0 000-3.06zM19.7 18v-5.36c0-2.86-1.53-4.19-3.57-4.19-1.64 0-2.37.9-2.78 1.54V8.2H10.7c.04.94 0 9.8 0 9.8h2.64v-5.47c0-.29.02-.58.1-.79.23-.58.76-1.18 1.65-1.18.16 0 1.13 0 1.13 1.18V18h2.48z" fill="#fff" />
    </svg>
  );
}

function formatPostIdShort(postNumber) {
  if (postNumber == null) return null;
  return `P-${String(postNumber).padStart(3, "0")}`;
}

function extractHashtags(text) {
  if (!text) return "";
  const matches = text.match(/#[\w\u0600-\u06FF\u0400-\u04FF]+/g);
  return matches ? matches.join(" ") : "";
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 1 ? 1 : 2)} ${units[i - 1]}`;
}

function isPublicUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url.trim());
}

function isCanonicalMediaUrl(url) {
  if (!isPublicUrl(url)) return false;
  try {
    const u = new URL(url);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return false;
    if (u.pathname.includes("/uploads/")) return false;
    if (!/\/POST-\d{4,}\//.test(u.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

function sourceMediaType(post) {
  if (!post || !post.media || post.media.length === 0) return null;
  const media = post.media[0];
  const pt = (post.postType || "").toLowerCase();
  if (pt === "carousel") {
    if (media.mediaType === "document") return "document";
    return "carousel";
  }
  if (pt === "reel") return "video";
  return media.mediaType === "IMAGE" ? "image" : null;
}

const TARGET_POST_TYPES = {
  "Instagram": [
    { value: "static", label: "Static Image" },
    { value: "carousel", label: "Carousel" },
    { value: "reel", label: "Reel / Video" },
  ],
  "LinkedIn": [
    { value: "static", label: "Single Image" },
    { value: "carousel", label: "Multi-image / Carousel" },
    { value: "reel", label: "Video" },
  ],
};

const MEDIA_STRATEGIES = {
  "Instagram": {
    "static": [
      { value: "reuse", label: "Reuse compatible media" },
      { value: "replace", label: "Replace all media" },
    ],
    "carousel": [
      { value: "reuse", label: "Reuse compatible media" },
      { value: "edit", label: "Edit current media" },
      { value: "replace", label: "Replace all media" },
    ],
    "reel": [
      { value: "reuse", label: "Reuse compatible video" },
      { value: "replace", label: "Replace video" },
    ],
  },
  "LinkedIn": {
    "static": [
      { value: "reuse", label: "Reuse compatible media" },
      { value: "edit", label: "Edit current media" },
      { value: "replace", label: "Replace all media" },
    ],
    "carousel": [
      { value: "reuse", label: "Reuse compatible images" },
      { value: "edit", label: "Edit current media" },
      { value: "replace", label: "Replace all media" },
      { value: "document", label: "Upload PDF document" },
    ],
    "reel": [
      { value: "reuse", label: "Reuse compatible video" },
      { value: "replace", label: "Replace video" },
    ],
  },
};

function isPdfBlocked(sourcePost, targetPlatform) {
  const st = sourceMediaType(sourcePost);
  return sourcePost.platform === "LinkedIn" && st === "document" && targetPlatform === "Instagram";
}

function getIncompatibleWarning(sourcePost, targetPlatform, targetPostType) {
  if (isPdfBlocked(sourcePost, targetPlatform)) {
    return "Instagram does not accept this LinkedIn document as post media. Upload compatible Instagram media before continuing.";
  }
  const st = sourceMediaType(sourcePost);
  if (targetPlatform === "LinkedIn" && targetPostType === "carousel" && st === "carousel") {
    return null;
  }
  return null;
}

function getDefaultPostType(sourcePost, targetPlatform) {
  const st = sourceMediaType(sourcePost);
  if (targetPlatform === "LinkedIn") {
    if (st === "image") return "static";
    if (st === "carousel") return "carousel";
    if (st === "video") return "reel";
    if (st === "document") return "carousel";
    return "static";
  }
  if (targetPlatform === "Instagram") {
    if (st === "image") return "static";
    if (st === "carousel") return "carousel";
    if (st === "video") return "reel";
    if (st === "document") return "static";
    return "static";
  }
  return "static";
}

function buildInitialManifest(sourcePost, targetPlatform, targetPostType) {
  if (!sourcePost || !sourcePost.media || sourcePost.media.length === 0) return [];
  const ordered = [...sourcePost.media].sort((a, b) => a.order - b.order);
  const st = sourceMediaType(sourcePost);

  if (sourcePost.platform === "LinkedIn" && st === "document" && targetPlatform === "Instagram") {
    return [];
  }

  if (targetPlatform === "LinkedIn" && targetPostType === "carousel" && st === "carousel") {
    return ordered.map((m) => ({
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
      action: "reuse",
      sourceUrl: m.url,
      mediaType: m.mediaType === "IMAGE" ? "IMAGE" : "IMAGE",
      fileName: m.fileName,
      preview: isPublicUrl(m.url) ? m.url : null,
    }));
  }

  if (targetPlatform === "LinkedIn" && st === "document" && targetPostType === "carousel") {
    return [];
  }

  const canReuse = ordered.filter((m) => {
    if (targetPlatform === "LinkedIn") {
      return m.mediaType === "IMAGE" || m.mediaType === "VIDEO";
    }
    return m.mediaType === "IMAGE" || m.mediaType === "VIDEO";
  });

  return canReuse.map((m) => ({
    id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
    action: "reuse",
    sourceUrl: m.url,
    mediaType: m.mediaType,
    fileName: m.fileName,
    preview: isPublicUrl(m.url) ? m.url : null,
  }));
}

function validateSubmit(manifest, targetPlatform, targetPostType) {
  if (!manifest || manifest.length === 0) {
    return "At least one media item is required.";
  }
  if (targetPlatform === "Instagram") {
    if (targetPostType === "static") {
      if (manifest.length !== 1) return "Instagram Static requires exactly one image.";
      if (manifest[0].mediaType !== "IMAGE") return "Instagram Static requires an image.";
    }
    if (targetPostType === "carousel") {
      if (manifest.length < 2) return "Instagram Carousel requires at least two images.";
      if (manifest.some((m) => m.mediaType !== "IMAGE")) return "Instagram Carousel requires all items to be images.";
    }
    if (targetPostType === "reel") {
      if (manifest.length !== 1) return "Instagram Reel requires exactly one video.";
      if (manifest[0].mediaType !== "VIDEO") return "Instagram Reel requires a video.";
    }
  }
  if (targetPlatform === "LinkedIn") {
    if (targetPostType === "static" || targetPostType === "carousel") {
      if (manifest.some((m) => m.mediaType !== "IMAGE")) {
        if (targetPostType === "static" && (manifest.length !== 1 || manifest[0].mediaType !== "IMAGE")) {
          return "LinkedIn Single Image requires exactly one image.";
        }
        if (targetPostType === "carousel") {
          const allImages = manifest.every((m) => m.mediaType === "IMAGE");
          const allDocument = manifest.length === 1 && manifest[0].mediaType === "document";
          if (!allImages && !allDocument) return "LinkedIn Carousel requires images or a single PDF document.";
        }
      }
    }
    if (targetPostType === "reel") {
      if (manifest.length !== 1) return "LinkedIn Video requires exactly one video.";
      if (manifest[0].mediaType !== "VIDEO") return "LinkedIn Video requires a video.";
    }
  }
  return null;
}

export default function CrossPlatformPostModal({ sourcePost, sourcePlatform, targetPlatform, brandId, onCreated, onClose }) {
  const isPdfBlockedSource = isPdfBlocked(sourcePost, targetPlatform);

  const [targetPostType, setTargetPostType] = useState(() => getDefaultPostType(sourcePost, targetPlatform));
  const [caption, setCaption] = useState(sourcePost.caption || "");
  const [publishTitle, setPublishTitle] = useState("");
  const [documentTitle, setDocumentTitle] = useState("");
  const [hashtags, setHashtags] = useState(() => extractHashtags(sourcePost.caption || ""));
  const [scheduledDate, setScheduledDate] = useState(
    sourcePost.scheduledDate ? formatToDateTimeLocalInTz(sourcePost.scheduledDate, "America/Vancouver") : ""
  );
  const [mediaStrategy, setMediaStrategy] = useState(isPdfBlockedSource ? "replace" : "reuse");
  const [manifest, setManifest] = useState(() => {
    if (isPdfBlockedSource) return [];
    return buildInitialManifest(sourcePost, targetPlatform, getDefaultPostType(sourcePost, targetPlatform));
  });
  const [status, setStatus] = useState("draft");
  const [sendToN8n, setSendToN8n] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [dragIdx, setDragIdx] = useState(null);
  const closedRef = useRef(false);

  const fileInputRef = useRef(null);
  const pdfInputRef = useRef(null);

  const isImgTarget = targetPlatform === "Instagram";
  const isLiTarget = targetPlatform === "LinkedIn";

  const compatiblePostTypes = TARGET_POST_TYPES[targetPlatform] || [];
  const availableStrategies = useMemo(
    () => MEDIA_STRATEGIES[targetPlatform]?.[targetPostType] || MEDIA_STRATEGIES[targetPlatform]?.static || [],
    [targetPlatform, targetPostType]
  );

  const isDocumentStrategy = mediaStrategy === "document";

  const validationError = useMemo(() => validateSubmit(manifest, targetPlatform, targetPostType), [manifest, targetPlatform, targetPostType]);
  const submitDisabled = submitting || !!validationError || (isPdfBlockedSource && manifest.length === 0);

  function handlePostTypeChange(val) {
    setTargetPostType(val);
    const newManifest = buildInitialManifest(sourcePost, targetPlatform, val);
    setManifest(newManifest);
    const strategies = MEDIA_STRATEGIES[targetPlatform]?.[val] || MEDIA_STRATEGIES[targetPlatform]?.static || [];
    const firstValid = strategies[0]?.value || "reuse";
    setMediaStrategy(firstValid);
    if (isPdfBlocked(sourcePost, targetPlatform)) {
      setManifest([]);
      setMediaStrategy("replace");
    }
    setError(null);
  }

  function handleMediaStrategyChange(val) {
    setMediaStrategy(val);
    setError(null);
    if (val === "replace" || val === "document") {
      setManifest([]);
    }
    if (val === "reuse") {
      setManifest(buildInitialManifest(sourcePost, targetPlatform, targetPostType));
    }
  }

  function handleAddFiles(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const newItems = files.map((f) => ({
      id: Math.random().toString(36).slice(2),
      action: "new",
      mediaType: f.type.startsWith("video/") ? "VIDEO" : "IMAGE",
      file: f,
      fileName: f.name,
      preview: URL.createObjectURL(f),
    }));
    setManifest((prev) => [...prev, ...newItems]);
    e.target.value = "";
  }

  function handleAddPdf(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setManifest([
      {
        id: Math.random().toString(36).slice(2),
        action: "new",
        mediaType: "document",
        file,
        fileName: file.name,
        preview: null,
      },
    ]);
    e.target.value = "";
  }

  function handleRemoveItem(id) {
    setManifest((prev) => prev.filter((item) => item.id !== id));
  }

  function handleReplaceItem(id) {
    const input = document.createElement("input");
    input.type = "file";
    const item = manifest.find((m) => m.id === id);
    if (item?.mediaType === "VIDEO") {
      input.accept = "video/*";
    } else {
      input.accept = "image/*";
    }
    input.onchange = (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      setManifest((prev) =>
        prev.map((m) =>
          m.id === id
            ? { ...m, action: "new", file: f, fileName: f.name, sourceUrl: undefined, preview: URL.createObjectURL(f) }
            : m
        )
      );
    };
    input.click();
  }

  function handleMoveItem(id, direction) {
    setManifest((prev) => {
      const idx = prev.findIndex((m) => m.id === id);
      if (idx === -1) return prev;
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      next.splice(newIdx, 0, item);
      return next;
    });
  }

  async function handleSubmit(asDraft = true) {
    if (submitting) return;
    const guard = validationError;
    if (guard) {
      setError(guard);
      return;
    }
    if (isPdfBlockedSource && manifest.length === 0) {
      setError("Upload compatible Instagram media before continuing.");
      return;
    }

    setSubmitting(true);
    setError(null);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CLIENT_FETCH_TIMEOUT);

    try {
      const fd = new FormData();
      fd.append("targetPlatform", targetPlatform);
      fd.append("targetPostType", targetPostType);
      fd.append("caption", caption);
      fd.append("hashtags", hashtags);
      if (isLiTarget) {
        fd.append("publishTitle", publishTitle);
        if (isDocumentStrategy) {
          fd.append("documentTitle", documentTitle || publishTitle || "Document");
        }
      }
      if (scheduledDate) {
        const dt = parseWallClockInTz(scheduledDate, "America/Vancouver");
        if (dt) fd.append("scheduledDate", dt.toISOString());
      }
      fd.append("status", status);
      fd.append("mediaStrategy", mediaStrategy);

      const orderedManifest = manifest.map((item, idx) => ({
        action: item.action,
        mediaType: item.mediaType,
        order: idx + 1,
        ...(item.action === "reuse" ? { sourceUrl: item.sourceUrl } : {}),
        ...(item.action === "new" ? { fileIndex: idx } : {}),
      }));
      fd.append("orderedMediaManifest", JSON.stringify(orderedManifest));

      const newFiles = manifest.filter((m) => m.action === "new" && m.file);
      for (const item of newFiles) {
        fd.append("files", item.file);
      }

      if (sendToN8n) {
        fd.append("sendToN8n", "true");
      }

      const res = await fetch(`/api/brands/${brandId}/published-posts/${sourcePost.id}/adapt`, {
        method: "POST",
        body: fd,
        signal: controller.signal,
      });

      let data;
      try {
        const text = await res.text();
        if (!text) throw new Error(`Adaptation failed with status ${res.status}`);
        data = JSON.parse(text);
      } catch {
        throw new Error(`Adaptation failed with status ${res.status}`);
      }

      if (!res.ok) {
        throw new Error(data?.error || `Adaptation failed with status ${res.status}`);
      }

      const createdPost = data.post;

      if (data.webhookResult?.success) {
        toast.success(`${targetPlatform === "Instagram" ? "Instagram" : "LinkedIn"} post created and sent to n8n.`);
      } else if (data.webhookResult?.success === false && sendToN8n) {
        toast.warning(`${targetPlatform === "Instagram" ? "Instagram" : "LinkedIn"} draft created, but n8n sending failed.`);
        if (data.webhookResult?.error) {
          setError(data.webhookResult.error);
        }
      } else {
        toast.success(`${targetPlatform === "Instagram" ? "Instagram" : "LinkedIn"} draft created.`);
      }

      if (!closedRef.current) {
        onCreated(createdPost);
      }
    } catch (err) {
      if (err.name === "AbortError") {
        setError("Request timed out. The post may still be processing.");
        toast.error("Adaptation timed out.");
      } else {
        setError(err.message);
        toast.error(err.message);
      }
    } finally {
      clearTimeout(timeoutId);
      setSubmitting(false);
    }
  }

  function handleClose() {
    closedRef.current = true;
    onClose();
  }

  const sourceOrderedMedia = useMemo(() => {
    return [...(sourcePost.media || [])].sort((a, b) => a.order - b.order);
  }, [sourcePost]);

  const incompatibleWarning = isPdfBlockedSource
    ? "Instagram does not accept this LinkedIn document as post media. Upload compatible Instagram media before continuing."
    : null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        onClick={handleClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.60)",
          backdropFilter: "blur(4px)",
        }}
      />

      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 960,
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
            {sourcePlatform === "Instagram" ? <InstagramIcon size={18} /> : <LinkedInIcon size={18} />}
            <span style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 700, textTransform: "uppercase", color: "var(--sketch-ink)", lineHeight: 1 }}>
              {sourcePlatform === "Instagram" ? "Adapt for LinkedIn" : "Adapt for Instagram"}
            </span>
            <span style={{ ...lbl, fontSize: 9, color: "var(--sketch-vermilion)" }}>
              {formatPostIdShort(sourcePost.postNumber)}
            </span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            style={{ ...inkBtn, border: "none", fontSize: 14, padding: "2px 8px", lineHeight: 1 }}
          >
            &times;
          </button>
        </div>

        {/* Two-column body */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
          {/* Left: Source reference */}
          <div style={{ borderRight: "1px solid var(--sketch-line)", padding: "14px 18px", background: "var(--sketch-paper-raw)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
              {sourcePlatform === "Instagram" ? <InstagramIcon size={14} /> : <LinkedInIcon size={14} />}
              <span style={{ ...lbl, fontSize: 9 }}>Original {sourcePlatform} post</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sourceOrderedMedia.map((m, i) => (
                <div key={m.id || i} style={{ border: "1px solid var(--sketch-line)", background: "var(--sketch-paper-bright)", padding: 6 }}>
                  {m.mediaType === "VIDEO" ? (
                    <video src={m.url} style={{ width: "100%", maxHeight: 120, objectFit: "contain", display: "block" }} controls />
                  ) : m.mediaType === "document" ? (
                    <div style={{ ...lbl, fontSize: 9, padding: 8, textAlign: "center" }}>PDF: {m.fileName || "document.pdf"}</div>
                  ) : (
                    <img src={m.url} alt="" style={{ width: "100%", maxHeight: 120, objectFit: "contain", display: "block" }} />
                  )}
                  <div style={{ ...lbl, fontSize: 8, marginTop: 2 }}>#{i + 1} {m.mediaType}</div>
                </div>
              ))}

              {sourcePost.caption && (
                <div>
                  <div style={{ ...lbl, fontSize: 8, marginBottom: 2 }}>Caption</div>
                  <div style={{ fontFamily: "var(--font-mono-ink)", fontSize: 10, color: "var(--sketch-ink)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 80, overflowY: "auto" }}>
                    {sourcePost.caption}
                  </div>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                <div><span style={{ ...lbl, fontSize: 8 }}>Type:</span> <span style={{ fontFamily: "var(--font-mono-ink)", fontSize: 9 }}>{sourcePost.postType}</span></div>
                <div><span style={{ ...lbl, fontSize: 8 }}>Status:</span> <span style={{ fontFamily: "var(--font-mono-ink)", fontSize: 9 }}>{sourcePost.status}</span></div>
                {sourcePost.postNumber && <div><span style={{ ...lbl, fontSize: 8 }}>ID:</span> <span style={{ fontFamily: "var(--font-mono-ink)", fontSize: 9 }}>{formatPostIdShort(sourcePost.postNumber)}</span></div>}
              </div>
            </div>
          </div>

          {/* Right: Target form */}
          <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {targetPlatform === "Instagram" ? <InstagramIcon size={14} /> : <LinkedInIcon size={14} />}
              <span style={{ ...lbl, fontSize: 9 }}>Creating a new {targetPlatform} post</span>
            </div>

            {incompatibleWarning && (
              <div style={{ ...lbl, fontSize: 9, color: "var(--sketch-vermilion)", border: "1px solid var(--sketch-vermilion)", padding: "6px 10px", background: "rgba(196,58,42,0.06)" }}>
                {incompatibleWarning}
              </div>
            )}

            {/* Post type */}
            <div>
              <div style={{ ...lbl, marginBottom: 4, fontSize: 9 }}>Post Type</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {compatiblePostTypes.map((pt) => (
                  <button
                    key={pt.value}
                    type="button"
                    onClick={() => handlePostTypeChange(pt.value)}
                    aria-pressed={targetPostType === pt.value}
                    style={{
                      ...inkBtn,
                      fontSize: 9,
                      padding: "3px 8px",
                      borderColor: targetPostType === pt.value ? "var(--sketch-vermilion)" : "var(--sketch-line)",
                      background: targetPostType === pt.value ? "var(--sketch-vermilion)" : "transparent",
                      color: targetPostType === pt.value ? "var(--sketch-paper-bright)" : "var(--sketch-ink-soft)",
                    }}
                  >
                    {pt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Media strategy (not for document) */}
            {!isDocumentStrategy && (
              <div>
                <div style={{ ...lbl, marginBottom: 4, fontSize: 9 }}>Media Strategy</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {availableStrategies.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => handleMediaStrategyChange(s.value)}
                      aria-pressed={mediaStrategy === s.value}
                      style={{
                        ...inkBtn,
                        fontSize: 9,
                        padding: "3px 8px",
                        borderColor: mediaStrategy === s.value ? "var(--sketch-vermilion)" : "var(--sketch-line)",
                        background: mediaStrategy === s.value ? "var(--sketch-vermilion)" : "transparent",
                        color: mediaStrategy === s.value ? "var(--sketch-paper-bright)" : "var(--sketch-ink-soft)",
                      }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Document strategy indicator */}
            {isDocumentStrategy && (
              <div style={{ ...lbl, fontSize: 9, color: "var(--sketch-ink-soft)" }}>
                Selected: Upload a PDF document. Source images are not included as post media.
              </div>
            )}

            {/* Media editing */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ ...lbl, fontSize: 9 }}>Target Media ({manifest.length})</span>
                <div style={{ display: "flex", gap: 4 }}>
                  {!isDocumentStrategy && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      style={{ ...inkBtn, fontSize: 8, padding: "2px 6px" }}
                    >
                      + Add
                    </button>
                  )}
                  {isDocumentStrategy && (
                    <button
                      type="button"
                      onClick={() => pdfInputRef.current?.click()}
                      style={{ ...inkBtn, fontSize: 8, padding: "2px 6px" }}
                    >
                      + PDF
                    </button>
                  )}
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept={targetPostType === "reel" ? "video/*" : "image/*"}
                multiple
                onChange={handleAddFiles}
                style={{ display: "none" }}
              />
              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf,.pdf"
                onChange={handleAddPdf}
                style={{ display: "none" }}
              />

              {manifest.length === 0 ? (
                <div style={{ ...lbl, fontSize: 9, padding: "12px 0", textAlign: "center", color: "var(--sketch-ink-faint)", border: "1px dashed var(--sketch-line)" }}>
                  {isDocumentStrategy ? "Select a PDF file" : "Add media files for the target post"}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
                  {manifest.map((item, idx) => (
                    <div
                      key={item.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "4px 6px",
                        border: "1px solid var(--sketch-line)",
                        background: "var(--sketch-paper-bright)",
                      }}
                    >
                      {item.preview && item.mediaType !== "document" ? (
                        item.mediaType === "VIDEO" ? (
                          <video src={item.preview} style={{ width: 40, height: 40, objectFit: "cover", flexShrink: 0 }} />
                        ) : (
                          <img src={item.preview} alt="" style={{ width: 40, height: 40, objectFit: "cover", flexShrink: 0 }} />
                        )
                      ) : item.mediaType === "document" ? (
                        <div style={{ width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", ...lbl, fontSize: 8, flexShrink: 0, background: "var(--sketch-paper-raw)" }}>
                          PDF
                        </div>
                      ) : (
                        <div style={{ width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", ...lbl, fontSize: 8, flexShrink: 0, background: "var(--sketch-paper-raw)" }}>
                          {item.file?.name?.split(".").pop() || "?"}
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: "var(--font-mono-ink)", fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {item.fileName || item.file?.name || "media"}
                        </div>
                        <div style={{ ...lbl, fontSize: 8 }}>
                          #{idx + 1} · {item.mediaType} · {item.action === "reuse" ? "reused" : "new"}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                        <button type="button" onClick={() => handleMoveItem(item.id, -1)} disabled={idx === 0} style={{ ...inkBtn, fontSize: 8, padding: "1px 4px", opacity: idx === 0 ? 0.3 : 1 }}>&#9650;</button>
                        <button type="button" onClick={() => handleMoveItem(item.id, 1)} disabled={idx === manifest.length - 1} style={{ ...inkBtn, fontSize: 8, padding: "1px 4px", opacity: idx === manifest.length - 1 ? 0.3 : 1 }}>&#9660;</button>
                        <button type="button" onClick={() => handleReplaceItem(item.id)} style={{ ...inkBtn, fontSize: 8, padding: "1px 4px" }}>R</button>
                        <button type="button" onClick={() => handleRemoveItem(item.id)} style={{ ...inkBtn, fontSize: 8, padding: "1px 4px", color: "var(--sketch-vermilion)", borderColor: "var(--sketch-vermilion)" }}>&times;</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {isDocumentStrategy && manifest.length > 0 && (
                <div style={{ ...lbl, fontSize: 8, marginTop: 4 }}>PDF document selected as post media.</div>
              )}
            </div>

            {/* Caption */}
            <div>
              <div style={{ ...lbl, marginBottom: 4, fontSize: 9 }}>Caption</div>
              <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} style={{ ...fieldStyle, fontSize: 10, resize: "vertical" }} />
            </div>

            {/* Hashtags */}
            <div>
              <div style={{ ...lbl, marginBottom: 4, fontSize: 9 }}>Hashtags</div>
              <input type="text" value={hashtags} onChange={(e) => setHashtags(e.target.value)} style={fieldStyle} placeholder="#tag1 #tag2" />
            </div>

            {/* LinkedIn specific */}
            {isLiTarget && (
              <div>
                <div style={{ ...lbl, marginBottom: 4, fontSize: 9 }}>Post / Publish Title</div>
                <input type="text" value={publishTitle} onChange={(e) => setPublishTitle(e.target.value)} style={fieldStyle} placeholder="Optional title" />
              </div>
            )}

            {isLiTarget && isDocumentStrategy && (
              <div>
                <div style={{ ...lbl, marginBottom: 4, fontSize: 9 }}>Document Title</div>
                <input type="text" value={documentTitle} onChange={(e) => setDocumentTitle(e.target.value)} style={fieldStyle} placeholder="Required for PDF documents" />
              </div>
            )}

            {/* Scheduled date */}
            <div>
              <div style={{ ...lbl, marginBottom: 4, fontSize: 9 }}>Scheduled Date (optional)</div>
              <input type="datetime-local" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} style={fieldStyle} />
            </div>

            {/* Status - hidden, always draft */}
            <div style={{ ...lbl, fontSize: 8, color: "var(--sketch-ink-faint)" }}>
              New post will be saved as <strong>draft</strong>.
            </div>

            {/* Send to n8n toggle */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" id="send-to-n8n" checked={sendToN8n} onChange={(e) => setSendToN8n(e.target.checked)} />
              <label htmlFor="send-to-n8n" style={{ ...lbl, fontSize: 9, cursor: "pointer" }}>Send to n8n after saving</label>
            </div>

            {/* Error */}
            {(error || validationError) && (
              <div style={{ ...lbl, fontSize: 9, color: "var(--sketch-vermilion)" }}>
                {error || validationError}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", borderTop: "1px solid var(--sketch-line)", paddingTop: 12 }}>
              <button type="button" onClick={handleClose} disabled={submitting} style={{ ...inkBtn, opacity: submitting ? 0.5 : 1 }}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleSubmit(true)}
                disabled={submitDisabled}
                style={{ ...inkBtn, borderColor: "var(--sketch-ink)", opacity: submitDisabled ? 0.5 : 1 }}
              >
                {submitting ? "Saving\u2026" : "Save as draft"}
              </button>
              <button
                type="button"
                onClick={() => { setSendToN8n(true); setTimeout(() => handleSubmit(false), 50); }}
                disabled={submitDisabled}
                style={{ ...inkBtn, borderColor: "var(--sketch-vermilion)", background: "var(--sketch-vermilion)", color: "var(--sketch-paper-bright)", opacity: submitDisabled ? 0.5 : 1 }}
              >
                {submitting ? "Sending\u2026" : "Save and send to n8n"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
