"use client";

// Cards for the TODAY dashboard. Presentational only: opening a card hands the
// post/story to the existing detail UI (PostDetailModal, LinkedInPostDetailModal,
// StoryDayPanel); no editing logic lives here.

import { useState } from "react";
import { StatusPill } from "@/components/content-report/StatusPill";
import { buildCaptionExcerpt, getLinkedInPreview } from "@/lib/linkedin-post-preview";
import { FileText, Play, Image as ImageIcon, AlignLeft, MessageCircle, Users } from "lucide-react";

export const lbl = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--sketch-ink-faint)",
};

export const inkBtn = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  padding: "6px 12px",
  border: "1px solid var(--sketch-vermilion)",
  background: "transparent",
  color: "var(--sketch-vermilion)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const THUMB = 76;

function Badge({ children, tone = "ink", title }) {
  const tones = {
    ink: { border: "var(--sketch-line)", color: "var(--sketch-ink-soft)", bg: "transparent" },
    alert: { border: "var(--sketch-vermilion)", color: "var(--sketch-paper-bright)", bg: "var(--sketch-vermilion)" },
    ok: { border: "var(--sketch-ink)", color: "var(--sketch-ink)", bg: "transparent" },
    ready: { border: "var(--sketch-vermilion)", color: "var(--sketch-vermilion)", bg: "transparent" },
  };
  const t = tones[tone] || tones.ink;
  return (
    <span
      title={title}
      style={{
        ...lbl,
        fontSize: 9,
        color: t.color,
        background: t.bg,
        border: `1px solid ${t.border}`,
        padding: "2px 6px",
        lineHeight: 1.3,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      {children}
    </span>
  );
}

function Tile({ children, dark }) {
  return (
    <div
      style={{
        width: THUMB,
        height: THUMB,
        flexShrink: 0,
        position: "relative",
        overflow: "hidden",
        border: "1px solid var(--sketch-line)",
        background: dark ? "var(--sketch-ink)" : "var(--sketch-paper-raw)",
        color: dark ? "var(--sketch-paper-bright)" : "var(--sketch-ink-faint)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </div>
  );
}

function ImgTile({ src, alt, play }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <Tile dark={play}>{play ? <Play size={20} /> : <ImageIcon size={20} />}</Tile>;
  }
  return (
    <Tile>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
      {play ? (
        <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <span style={{ width: 24, height: 24, borderRadius: "50%", background: "rgba(28,24,18,0.65)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Play size={12} fill="currentColor" />
          </span>
        </span>
      ) : null}
    </Tile>
  );
}

/** Thumbnail from the serialized post; never downloads a video/PDF to render. */
function PostThumb({ post }) {
  if (post.platform === "LinkedIn") {
    const p = getLinkedInPreview(post);
    if (p.mode === "image") return <ImgTile src={p.src} alt="LinkedIn post preview" play={p.kind === "video"} />;
    if (p.kind === "pdf") return <Tile><FileText size={20} /></Tile>;
    if (p.kind === "video") return <Tile dark><Play size={20} /></Tile>;
    return <Tile><AlignLeft size={20} /></Tile>;
  }
  const isVideo = post.postType === "reel" || post.media?.[0]?.mediaType === "VIDEO";
  if (isVideo) return <ImgTile src={post.thumbnailUrl || null} alt="Reel cover" play />;
  return <ImgTile src={post.imageUrl || post.media?.[0]?.url || null} alt="Instagram post preview" />;
}

const TYPE_LABEL = {
  Instagram: { static: "Static", carousel: "Carousel", reel: "Reel" },
  LinkedIn: { static: "Single image", carousel: "PDF carousel", reel: "Video" },
};

export function TodayPostCard({ post, onOpen }) {
  const number = post.postNumber != null ? `P-${String(post.postNumber).padStart(3, "0")}` : null;
  const status = String(post.status || "draft").toLowerCase();
  const excerpt = buildCaptionExcerpt(post.caption, 220);
  const type = TYPE_LABEL[post.platform]?.[post.postType] || post.postType;
  const collabNames = (post.collaboratorBrands || []).map((b) => b.name).filter(Boolean);
  const viaCollab = post.viewerRelation === "collaborator";

  return (
    <div className="today-card">
      <PostThumb post={post} />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={post.platform === "LinkedIn" ? "/brand-icons/linkedin.png" : "/brand-icons/instagram.png"}
            alt={post.platform}
            width={14}
            height={14}
            style={{ display: "block" }}
          />
          {number && <span style={{ fontFamily: "var(--font-mono-ink)", fontSize: 11, color: "var(--sketch-vermilion)" }}>{number}</span>}
          <span style={{ ...lbl, fontSize: 9 }}>{type}</span>
          <StatusPill status={status} label={status.toUpperCase()} />
          {post.today?.overdue && (
            <Badge tone="alert" title="The scheduled time has passed and the post is not marked Published.">Overdue</Badge>
          )}
          {post.isCollaboration && (
            <Badge title={viaCollab ? `Published by ${post.primaryBrand?.name || "the primary Brand"}` : undefined}>
              <Users size={10} />
              {viaCollab
                ? `Collab · published by ${post.primaryBrand?.name || "primary Brand"}`
                : `Collab with ${collabNames.join(", ")}`}
            </Badge>
          )}
        </div>
        <div style={{ fontFamily: "var(--font-mono-ink)", fontSize: 12, color: "var(--sketch-ink)" }}>
          {post.today?.localTime} <span style={{ ...lbl, fontSize: 9 }}>{post.today?.timeZone}</span>
        </div>
        {excerpt ? (
          <div className="today-excerpt">{excerpt}</div>
        ) : (
          <div style={{ ...lbl, fontSize: 9 }}>No caption</div>
        )}
      </div>
      <div className="today-card-actions">
        <span style={{ ...lbl, fontSize: 9, display: "inline-flex", alignItems: "center", gap: 3 }} title="Comments">
          <MessageCircle size={12} /> {post.commentCount ?? 0}
        </span>
        <button type="button" style={inkBtn} onClick={() => onOpen(post)}>Open</button>
      </div>
    </div>
  );
}

export function TodayStoryCard({ story, onOpen }) {
  const uploaded = story.status === "UPLOADED";
  const assets = story.assets || [];
  const shown = assets.slice(0, 4);
  const excerpt = buildCaptionExcerpt(story.comments, 200);

  return (
    <div className="today-card">
      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        {shown.length === 0 ? (
          <Tile><ImageIcon size={20} /></Tile>
        ) : (
          shown.slice(0, 1).map((a) =>
            a.mediaType === "VIDEO" ? <Tile key={a.id} dark><Play size={20} /></Tile> : <ImgTile key={a.id} src={a.url} alt={a.fileName} />,
          )
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ ...lbl, fontSize: 9, color: "var(--sketch-ink)" }}>Story · Today</span>
          {uploaded ? (
            <Badge tone="ok" title="Marked as uploaded">✓ Uploaded</Badge>
          ) : (
            <Badge tone="ready" title="Ready — needs manual publishing">Ready · to publish</Badge>
          )}
          <span style={{ ...lbl, fontSize: 9 }}>
            {assets.length} asset{assets.length === 1 ? "" : "s"}
          </span>
        </div>
        {shown.length > 1 && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {shown.slice(1).map((a) => (
              <span key={a.id} style={{ ...lbl, fontSize: 8, border: "1px solid var(--sketch-line)", padding: "1px 4px" }}>
                {a.mediaType === "VIDEO" ? "VIDEO" : "IMAGE"} {a.position}
              </span>
            ))}
            {assets.length > shown.length && <span style={{ ...lbl, fontSize: 8 }}>+{assets.length - shown.length} more</span>}
          </div>
        )}
        {excerpt ? <div className="today-excerpt">{excerpt}</div> : <div style={{ ...lbl, fontSize: 9 }}>No instructions</div>}
        <div style={{ ...lbl, fontSize: 9 }}>
          Created by {story.createdByName}
          {uploaded && story.completedByName ? ` · Uploaded by ${story.completedByName}` : ""}
        </div>
      </div>
      <div className="today-card-actions">
        <button type="button" style={inkBtn} onClick={() => onOpen(story)}>Open story</button>
      </div>
    </div>
  );
}
