"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { SectionLabel } from "@/components/content-report/SectionLabel";
import { StatBlock } from "@/components/content-report/StatBlock";
import { StatusPill } from "@/components/content-report/StatusPill";

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

const QUICK_ACTIONS = [
  { label: "IDENTITY", sub: "ai extraction", href: (id) => `/brands/${id}/extract-identity` },
  { label: "CALENDAR", sub: "schedule posts", href: (id) => `/content-calendar?brandId=${id}` },
  { label: "IMAGE", sub: "generate prompts", href: (id) => `/create-image?brandId=${id}` },
  { label: "VIDEO", sub: "video prompts", href: (id) => `/create-video?brandId=${id}` },
  { label: "PROMPTS", sub: "ai output library", href: (id) => `/generated-prompts?brandId=${id}` },
  { label: "REPORT", sub: "identity report", href: (id) => `/brands/${id}/identity-report` },
];

function PostDropdown({ calendarId, brandId, type, onClose }) {
  const [posts, setPosts] = useState(null);
  const router = useRouter();

  useEffect(() => {
    fetch(`/api/calendars/${calendarId}/posts`)
      .then((r) => r.json())
      .then(setPosts)
      .catch(() => setPosts([]));
  }, [calendarId]);

  return (
    <div style={{
      position: "absolute",
      zIndex: 50,
      top: "100%",
      left: 0,
      marginTop: 4,
      width: 280,
      background: "var(--sketch-paper-bright)",
      border: "1px solid var(--sketch-line)",
      boxShadow: "2px 2px 0 rgba(28,24,18,0.10)",
      overflow: "hidden",
    }}>
      <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--sketch-line-soft)", ...lbl, color: "var(--sketch-ink)" }}>
        Select post → {type} prompt
      </div>
      <div style={{ maxHeight: 200, overflowY: "auto" }}>
        {posts === null ? (
          <div style={{ padding: "20px", textAlign: "center", ...lbl }}>Loading…</div>
        ) : posts.length === 0 ? (
          <div style={{ padding: "20px", textAlign: "center", ...lbl }}>No posts in this calendar.</div>
        ) : (
          posts.map((post) => (
            <button
              key={post.id}
              onClick={() => {
                onClose();
                router.push(`/brands/${brandId}/post-prompt?type=${type}&postId=${post.id}&calendarId=${calendarId}`);
              }}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "8px 12px",
                background: "transparent",
                border: "none",
                borderBottom: "1px solid var(--sketch-line-soft)",
                cursor: "pointer",
                fontFamily: "var(--font-mono-ink)",
                fontSize: 11,
                color: "var(--sketch-ink-soft)",
              }}
            >
              {post.postNumber != null && (
                <span style={{ color: "var(--sketch-vermilion)", marginRight: 8 }}>
                  {String(post.postNumber).padStart(2, "0")}
                </span>
              )}
              {post.suggestedHook || post.mainAngleAndCoreMessage || `Post ${post.postNumber ?? ""}`}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function CalendarCard({ calendar, brandId, onDuplicated, onDeleted }) {
  const [duplicating, setDuplicating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [openDropdown, setOpenDropdown] = useState(null);

  async function handleDuplicate() {
    setDuplicating(true);
    try {
      const res = await fetch(`/api/calendars/${calendar.id}/duplicate`, { method: "POST" });
      if (!res.ok) throw new Error();
      const dup = await res.json();
      onDuplicated(dup);
      toast.success("Calendar duplicated.");
    } catch {
      toast.error("Failed to duplicate.");
    } finally {
      setDuplicating(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/calendars/${calendar.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      onDeleted(calendar.id);
      toast.success("Calendar deleted.");
    } catch {
      toast.error("Failed to delete.");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  function handleExport() {
    const blob = new Blob([JSON.stringify(calendar, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${calendar.title.replace(/\s+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{
      border: "1px solid var(--sketch-line)",
      background: "var(--sketch-paper-bright)",
      boxShadow: "2px 2px 0 rgba(28,24,18,0.10)",
      padding: "14px 18px",
      marginBottom: 12,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <div style={{ fontFamily: "var(--font-mono-ink)", fontSize: 13, fontWeight: 500, color: "var(--sketch-ink)" }}>
            {calendar.title}
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 4, alignItems: "center" }}>
            <StatusPill status={calendar.status} />
            {calendar.platform && <span style={lbl}>{calendar.platform}</span>}
            {calendar.timePeriod && <span style={lbl}>{calendar.timePeriod}</span>}
            <span style={lbl}>{calendar._count?.posts ?? 0} posts</span>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
        <Link href={`/content-calendar/${calendar.id}`} style={inkBtn}>Open</Link>
        <Link href={`/content-calendar/${calendar.id}/grid`} style={{ ...inkBtn, borderColor: "var(--sketch-vermilion)", color: "var(--sketch-vermilion)" }}>Grid View</Link>
        <Link href={`/content-calendar/${calendar.id}?edit=true`} style={inkBtn}>Edit</Link>
        <button onClick={handleDuplicate} disabled={duplicating} style={{ ...inkBtn, opacity: duplicating ? 0.5 : 1 }}>
          {duplicating ? "…" : "Duplicate"}
        </button>
        <button onClick={handleExport} style={inkBtn}>Export</button>

        {/* Image from Post */}
        <div style={{ position: "relative" }}>
          <button onClick={() => setOpenDropdown(openDropdown === "image" ? null : "image")} style={inkBtn}>
            Image from Post ▾
          </button>
          {openDropdown === "image" && (
            <PostDropdown calendarId={calendar.id} brandId={brandId} type="image" onClose={() => setOpenDropdown(null)} />
          )}
        </div>

        {/* Video from Post */}
        <div style={{ position: "relative" }}>
          <button onClick={() => setOpenDropdown(openDropdown === "video" ? null : "video")} style={inkBtn}>
            Video from Post ▾
          </button>
          {openDropdown === "video" && (
            <PostDropdown calendarId={calendar.id} brandId={brandId} type="video" onClose={() => setOpenDropdown(null)} />
          )}
        </div>

        {/* Delete */}
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)} style={{ ...inkBtn, marginLeft: "auto", borderColor: "transparent", color: "var(--sketch-ink-faint)", fontSize: 12 }}>&times;</button>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
            <span style={{ ...lbl, fontSize: 9 }}>Delete?</span>
            <button onClick={handleDelete} disabled={deleting} style={{
              ...inkBtn, fontSize: 9, padding: "3px 8px",
              borderColor: "var(--sketch-vermilion)", background: "var(--sketch-vermilion)", color: "var(--sketch-paper-bright)",
              opacity: deleting ? 0.5 : 1,
            }}>{deleting ? "…" : "Yes"}</button>
            <button onClick={() => setConfirmDelete(false)} disabled={deleting} style={{ ...inkBtn, fontSize: 9, padding: "3px 8px" }}>No</button>
          </div>
        )}
      </div>
    </div>
  );
}

function CalendarSection({ brand, initialCalendars }) {
  const [calendars, setCalendars] = useState(initialCalendars);

  return (
    <section style={{ marginTop: 36 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <SectionLabel meta={`${calendars.length} total`}>Content Calendars</SectionLabel>
        <Link href={`/content-calendar/new?brandId=${brand.id}`} style={{
          ...inkBtn,
          borderColor: "var(--sketch-vermilion)",
          background: "var(--sketch-vermilion)",
          color: "var(--sketch-paper-bright)",
        }}>
          + New Calendar
        </Link>
      </div>

      {calendars.length === 0 ? (
        <div style={{
          border: "2px dashed var(--sketch-line)",
          padding: "40px 0",
          textAlign: "center",
        }}>
          <div style={{ fontFamily: "var(--font-mono-ink)", fontSize: 12, fontWeight: 500, color: "var(--sketch-ink-faint)", marginBottom: 6 }}>
            No content calendars yet
          </div>
          <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 13, color: "var(--sketch-ink-faint)", marginBottom: 16 }}>
            Create a calendar to start planning posts for this brand.
          </div>
          <Link href={`/content-calendar/new?brandId=${brand.id}`} style={{ ...inkBtn, borderColor: "var(--sketch-vermilion)", color: "var(--sketch-vermilion)" }}>
            Create First Calendar
          </Link>
        </div>
      ) : (
        <div>
          {calendars.map((cal) => (
            <CalendarCard
              key={cal.id}
              calendar={cal}
              brandId={brand.id}
              onDuplicated={(dup) => setCalendars((prev) => [dup, ...prev])}
              onDeleted={(id) => setCalendars((prev) => prev.filter((c) => c.id !== id))}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function WorkspaceClient({ brand, initialCalendars = [] }) {
  return (
    <div style={{ padding: "36px 44px 48px" }}>
      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ ...lbl, fontSize: 9 }}>
          <Link href="/brands" style={{ color: "var(--sketch-ink-faint)", textDecoration: "none" }}>Brands</Link>
          {" · "}Workspace
        </div>
        <div style={{ ...lbl, fontSize: 9 }}>System Ready &middot; Local</div>
      </div>
      <div style={{ borderBottom: "1px solid var(--sketch-ink)", marginBottom: 24 }} />

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontWeight: 900,
            fontSize: 56,
            lineHeight: 0.9,
            textTransform: "uppercase",
            color: "var(--sketch-ink)",
          }}>
            {brand.name}
          </h1>
          <div style={{ borderBottom: "2px solid var(--sketch-vermilion)", width: 220, marginTop: 8 }} />
          <div style={{ ...lbl, marginTop: 8 }}>
            {brand.businessType || "Brand Workspace"}
            {brand.businessLocation ? ` · ${brand.businessLocation}` : ""}
          </div>
        </div>
        <Link href={`/brands/${brand.id}`} style={inkBtn}>Edit Brand</Link>
      </div>

      {/* Quick actions */}
      <div style={{ marginTop: 32 }}>
        <SectionLabel>Quick Actions</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginTop: 14 }}>
          {QUICK_ACTIONS.map((a) => (
            <Link key={a.label} href={a.href(brand.id)} style={{ textDecoration: "none" }}>
              <div style={{
                border: "1px solid var(--sketch-line)",
                background: "var(--sketch-paper-bright)",
                padding: "14px 14px 18px",
                transition: "border-color 120ms ease",
                cursor: "pointer",
                clipPath: "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--sketch-stone)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--sketch-line)"; }}
              >
                <div style={{
                  fontFamily: "var(--font-mono-ink)",
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--sketch-ink)",
                  lineHeight: 1.4,
                }}>
                  {a.label}
                </div>
                <div style={{
                  fontFamily: "var(--font-mono-ink)",
                  fontSize: 9,
                  letterSpacing: "0.04em",
                  color: "var(--sketch-ink-faint)",
                  marginTop: 3,
                }}>
                  {a.sub}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Calendar section */}
      <CalendarSection brand={brand} initialCalendars={initialCalendars} />

      {/* Footer */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        marginTop: 40,
        ...lbl,
        borderTop: "1px solid var(--sketch-line)",
        paddingTop: 14,
      }}>
        <span>Content Studio &middot; Brand Workspace</span>
        <span>Ink Cartography System</span>
      </div>
    </div>
  );
}
