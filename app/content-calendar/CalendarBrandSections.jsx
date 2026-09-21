"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { groupCalendarsByBrand, removeCalendar } from "@/lib/calendar-grouping";
import { createCalendarDeleter } from "@/lib/calendar-delete";
import { SectionLabel } from "@/components/content-report/SectionLabel";
import { StatusPill } from "@/components/content-report/StatusPill";

const lbl = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--sketch-ink-faint)",
};

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export default function CalendarBrandSections({ calendars: initialCalendars }) {
  const router = useRouter();
  const [calendars, setCalendars] = useState(initialCalendars);
  const [target, setTarget] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const deleterRef = useRef(null);
  if (deleterRef.current == null) deleterRef.current = createCalendarDeleter();

  const sections = useMemo(() => groupCalendarsByBrand(calendars), [calendars]);

  const handleConfirm = useCallback(async () => {
    if (!target || deletingId) return;
    const { id } = target;
    setDeletingId(id);
    const result = await deleterRef.current(id);
    if (result.skipped) return;
    if (result.ok) {
      setCalendars((current) => removeCalendar(current, id));
      setTarget(null);
      toast.success("Calendar deleted.");
      // Keeps the server-rendered total in the page header in step with the
      // list, which has already updated optimistically above.
      router.refresh();
    } else {
      toast.error(result.error || "Failed to delete calendar.");
    }
    setDeletingId(null);
  }, [target, deletingId, router]);

  if (calendars.length === 0) {
    return (
      <div style={{ marginTop: 40, textAlign: "center", ...lbl, fontSize: 12 }}>
        No calendars yet &mdash; create one to get started
      </div>
    );
  }

  return (
    <div style={{ marginTop: 32 }}>
      <SectionLabel>{plural(calendars.length, "Calendar")}</SectionLabel>

      {sections.map((section) => (
        <section key={section.brandId ?? "no-brand"} style={{ marginTop: 26 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              paddingBottom: 6,
              borderBottom: "1px solid var(--sketch-line)",
            }}
          >
            <h2
              style={{
                margin: 0,
                fontFamily: "var(--font-display)",
                fontWeight: 800,
                fontSize: 20,
                lineHeight: 1.1,
                textTransform: "uppercase",
                letterSpacing: "-0.01em",
                color: "var(--sketch-ink)",
              }}
            >
              {section.brandName}
            </h2>
            <span style={{ ...lbl, fontSize: 10 }}>{plural(section.count, "Calendar")}</span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: 20,
              marginTop: 16,
            }}
          >
            {section.calendars.map((cal) => (
              <CalendarCard
                key={cal.id}
                calendar={cal}
                onRequestDelete={() => setTarget(cal)}
                busy={deletingId === cal.id}
              />
            ))}
          </div>
        </section>
      ))}

      {target && (
        <ConfirmDeleteDialog
          calendar={target}
          deleting={deletingId === target.id}
          onCancel={() => {
            if (deletingId) return;
            setTarget(null);
          }}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  );
}

function CalendarCard({ calendar, onRequestDelete, busy }) {
  return (
    <div style={{ position: "relative" }}>
      <Link href={`/content-calendar/${calendar.id}`} style={{ textDecoration: "none" }}>
        <div
          style={{
            border: "1px solid var(--sketch-line)",
            background: "var(--sketch-paper-bright)",
            padding: "16px 18px",
            boxShadow: "2px 2px 0 rgba(28,24,18,0.10)",
            transition: "border-color 160ms ease",
            cursor: "pointer",
            opacity: busy ? 0.55 : 1,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              marginBottom: 8,
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-mono-ink)",
                fontSize: 13,
                fontWeight: 500,
                color: "var(--sketch-ink)",
                lineHeight: 1.3,
              }}
            >
              {calendar.title}
            </div>
            <StatusPill status={calendar.status} />
          </div>
          {calendar.brandName && <div style={{ ...lbl, marginBottom: 6 }}>{calendar.brandName}</div>}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
            <span style={lbl}>{calendar.postCount} posts</span>
            {calendar.platform && <span style={lbl}>{calendar.platform}</span>}
          </div>
          {calendar.timePeriod && <div style={{ ...lbl, marginTop: 4 }}>{calendar.timePeriod}</div>}
          <div
            style={{
              ...lbl,
              marginTop: 8,
              paddingRight: 24,
              color: "var(--sketch-vermilion)",
              fontSize: 9,
            }}
          >
            View grid &rarr;
          </div>
        </div>
      </Link>

      <button
        type="button"
        onClick={onRequestDelete}
        disabled={busy}
        title={`Delete "${calendar.title}"`}
        aria-label={`Delete calendar ${calendar.title}`}
        style={{
          position: "absolute",
          right: 12,
          bottom: 11,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 3,
          background: "none",
          border: "none",
          color: "var(--sketch-ink-faint)",
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.4 : 1,
        }}
      >
        <Trash2 size={13} strokeWidth={1.6} />
      </button>
    </div>
  );
}

function ConfirmDeleteDialog({ calendar, deleting, onCancel, onConfirm }) {
  const label = [calendar.brandName, calendar.title].filter(Boolean).join(" — ");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Delete calendar"
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(28,24,18,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(420px, 100%)",
          background: "var(--sketch-paper-bright)",
          border: "1px solid var(--sketch-ink)",
          boxShadow: "4px 4px 0 rgba(28,24,18,0.18)",
          padding: "22px 24px 18px",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 800,
            fontSize: 22,
            textTransform: "uppercase",
            color: "var(--sketch-ink)",
            lineHeight: 1.1,
          }}
        >
          Delete calendar?
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono-ink)",
            fontSize: 12,
            color: "var(--sketch-ink)",
            margin: "14px 0 10px",
            lineHeight: 1.4,
          }}
        >
          &ldquo;{label}&rdquo;
        </div>
        <p
          style={{
            fontFamily: "var(--font-mono-ink)",
            fontSize: 11,
            lineHeight: 1.6,
            color: "var(--sketch-ink-soft)",
            margin: 0,
          }}
        >
          This will permanently remove this calendar and its associated calendar posts.
          Uploaded reference files and generated media are kept. This action cannot be undone.
        </p>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            style={{
              fontFamily: "var(--font-mono-ink)",
              fontSize: 10.5,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              padding: "6px 12px",
              border: "1px solid var(--sketch-line)",
              background: "transparent",
              color: "var(--sketch-ink-soft)",
              cursor: deleting ? "default" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            style={{
              fontFamily: "var(--font-mono-ink)",
              fontSize: 10.5,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              padding: "6px 12px",
              border: "1px solid var(--sketch-vermilion)",
              background: "var(--sketch-vermilion)",
              color: "var(--sketch-paper-bright)",
              cursor: deleting ? "default" : "pointer",
              opacity: deleting ? 0.6 : 1,
            }}
          >
            {deleting ? "Deleting…" : "Delete Calendar"}
          </button>
        </div>
      </div>
    </div>
  );
}
