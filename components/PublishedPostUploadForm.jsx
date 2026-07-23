"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import { parseWallClockInTz } from "@/lib/timezone";

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

export default function PublishedPostUploadForm({ brandId, onCreated, onCancel }) {
  const [postType, setPostType] = useState("static");
  const [platform, setPlatform] = useState("Instagram");
  const [caption, setCaption] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const mediaInputRef = useRef(null);
  const thumbInputRef = useRef(null);

  function handlePostTypeChange(e) {
    const val = e.target.value;
    setPostType(val);
    if (val !== "reel" && val !== "video") {
      if (thumbInputRef.current) thumbInputRef.current.value = "";
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    const files = mediaInputRef.current?.files;
    if (!files || files.length === 0) {
      setError("At least one media file is required.");
      return;
    }

      setUploading(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CLIENT_FETCH_TIMEOUT);

    try {
      const fd = new FormData();
      for (let i = 0; i < files.length; i++) {
        fd.append("files", files[i]);
      }

      const thumbnail = thumbInputRef.current?.files?.[0];
      if (thumbnail) {
        fd.append("thumbnail", thumbnail);
      }

      fd.append("postType", postType);
      fd.append("platform", platform || "Instagram");
      fd.append("caption", caption);

      if (scheduledDate) {
        const vancouverDate = parseWallClockInTz(scheduledDate, "America/Vancouver");
        if (vancouverDate) {
          fd.append("scheduledDate", vancouverDate.toISOString());
        }
      }

      fd.append("notes", notes);

      const res = await fetch(`/api/brands/${brandId}/published-posts`, {
        method: "POST",
        body: fd,
        signal: controller.signal,
      });

      let data;
      try {
        const text = await res.text();
        if (!text) {
          throw new Error(`Upload failed with status ${res.status}`);
        }
        data = JSON.parse(text);
      } catch {
        throw new Error(`Upload failed with status ${res.status}`);
      }

      if (!res.ok) {
        throw new Error(data?.error || `Upload failed with status ${res.status}`);
      }

      const createdPost = data.post || data;
      const webhookResult = data.webhookResult;
      const remoteResult = data.remoteResult;
      const remoteFailed = remoteResult == null ||
        (remoteResult && remoteResult.success === false && !remoteResult.skipped);

      if (webhookResult?.success) {
        toast.success(remoteFailed ? "Post uploaded and sent to n8n, but remote media upload failed." : "Post uploaded and sent to n8n.");
      } else if (webhookResult?.success === false) {
        toast.success("Post uploaded, but n8n sending failed.");
        if (webhookResult.error) {
          setError(webhookResult.error);
        }
      } else if (remoteFailed) {
        toast.success("Post uploaded, but remote media upload failed.");
        if (remoteResult?.error) {
          const codePart = remoteResult.code ? ` [${remoteResult.code}]` : "";
          setError(`Remote upload failed: ${remoteResult.error}${codePart}`);
        } else {
          setError("Remote media upload failed.");
        }
      } else {
        toast.success("Post uploaded successfully.");
      }
      onCreated(createdPost);
    } catch (err) {
      if (err.name === "AbortError") {
        setError("Request timed out. The post may still be processing.");
        toast.error("Upload timed out.");
      } else {
        setError(err.message);
        toast.error(err.message);
      }
    } finally {
      clearTimeout(timeoutId);
      setUploading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        border: "1px solid var(--sketch-line)",
        background: "var(--sketch-paper-bright)",
        boxShadow: "2px 2px 0 rgba(28,24,18,0.10)",
        padding: "18px 20px",
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Media files */}
        <div>
          <div style={{ ...lbl, marginBottom: 4 }}>Media Files *</div>
          <input
            ref={mediaInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            style={fieldStyle}
          />
          {postType === "static" && (
            <div style={{ ...lbl, fontSize: 9, marginTop: 3, color: "var(--sketch-ink-soft)" }}>
              Static accepts one file. Upload multiple files for carousel.
            </div>
          )}
        </div>

        {/* Post type */}
        <div>
          <div style={{ ...lbl, marginBottom: 4 }}>Post Type *</div>
          <select
            value={postType}
            onChange={handlePostTypeChange}
            style={fieldStyle}
          >
            <option value="static">Static</option>
            <option value="carousel">Carousel</option>
            <option value="reel">Reel / Video</option>
          </select>
        </div>

        {/* Platform */}
        <div>
          <div style={{ ...lbl, marginBottom: 4 }}>Platform</div>
          <input
            type="text"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            placeholder="Instagram"
            style={fieldStyle}
          />
        </div>

        {/* Caption */}
        <div>
          <div style={{ ...lbl, marginBottom: 4 }}>Caption</div>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={3}
            style={{ ...fieldStyle, resize: "vertical" }}
          />
        </div>

        {/* Scheduled date */}
        <div>
          <div style={{ ...lbl, marginBottom: 4 }}>Scheduled Date (optional)</div>
          <input
            type="datetime-local"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            style={fieldStyle}
          />
        </div>

        {/* Notes */}
        <div>
          <div style={{ ...lbl, marginBottom: 4 }}>Notes (optional)</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            style={{ ...fieldStyle, resize: "vertical" }}
          />
        </div>

        {/* Thumbnail for reel/video */}
        {(postType === "reel" || postType === "video") && (
          <div>
            <div style={{ ...lbl, marginBottom: 4 }}>Video Thumbnail (optional)</div>
            <input
              ref={thumbInputRef}
              type="file"
              accept="image/*"
              style={fieldStyle}
            />
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ ...lbl, color: "var(--sketch-vermilion)", fontSize: 10 }}>
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={uploading}
            style={{ ...inkBtn, opacity: uploading ? 0.5 : 1 }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={uploading}
            style={{
              ...inkBtn,
              borderColor: "var(--sketch-vermilion)",
              background: "var(--sketch-vermilion)",
              color: "var(--sketch-paper-bright)",
              opacity: uploading ? 0.5 : 1,
            }}
          >
            {uploading ? "Uploading\u2026" : "Upload Post"}
          </button>
        </div>
      </div>
    </form>
  );
}
