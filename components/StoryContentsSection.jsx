"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SectionLabel } from "@/components/content-report/SectionLabel";
import StoryDayPanel from "@/components/StoryDayPanel";
import { buildMonthGrid, shiftMonth } from "@/lib/story-content-dates";

// Story Contents: a manual Instagram Story handoff calendar. Nothing in this
// section publishes anything; "Uploaded" is a human confirmation.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

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
};

function todayParts() {
  const d = new Date();
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
  };
}

function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function DayCell({ date, summary, isToday, onOpen }) {
  const day = Number(date.slice(8));
  const uploaded = summary?.status === "UPLOADED";
  const has = Boolean(summary);
  return (
    <button
      type="button"
      onClick={() => onOpen(date)}
      aria-label={`${day} ${has ? `${summary.assetCount} stories, ${uploaded ? "uploaded" : "ready"}` : "no story content"}`}
      style={{
        all: "unset",
        boxSizing: "border-box",
        cursor: "pointer",
        minHeight: 72,
        padding: "6px 6px 8px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minWidth: 0,
        border: "1px solid var(--sketch-line)",
        borderTop: has ? `3px solid ${uploaded ? "var(--sketch-sage)" : "var(--sketch-vermilion)"}` : "1px solid var(--sketch-line)",
        background: has ? "var(--sketch-paper-bright)" : "transparent",
        outline: isToday ? "1px solid var(--sketch-ink)" : "none",
        outlineOffset: -3,
      }}
    >
      <span style={{ fontFamily: "var(--font-mono-ink)", fontSize: 12, fontWeight: isToday ? 700 : 500, color: "var(--sketch-ink)" }}>
        {day}
      </span>
      {has && (
        <>
          <span style={{ ...lbl, fontSize: 9, letterSpacing: "0.04em", color: "var(--sketch-ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {summary.assetCount} {summary.assetCount === 1 ? "Story" : "Stories"}
          </span>
          <span style={{ ...lbl, fontSize: 8, color: uploaded ? "var(--sketch-sage)" : "var(--sketch-vermilion)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {uploaded ? "Uploaded" : "Ready"}
          </span>
        </>
      )}
    </button>
  );
}

export default function StoryContentsSection({ brandId }) {
  const today = useMemo(() => todayParts(), []);
  const [view, setView] = useState({ year: today.year, month: today.month });
  const [days, setDays] = useState({});
  // { key, error } of the last finished fetch; "loading" is derived from it.
  const [loaded, setLoaded] = useState({ key: null, error: null });
  const [reloadTick, setReloadTick] = useState(0);
  const [openDate, setOpenDate] = useState(null);

  const key = monthKey(view.year, view.month);
  const requestKey = `${key}#${reloadTick}`;
  const loading = loaded.key !== requestKey;
  const error = loading ? null : loaded.error;

  useEffect(() => {
    let alive = true;
    fetch(`/api/brands/${brandId}/story-content?month=${key}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not load Story content.");
        return Object.fromEntries((data.days || []).map((d) => [d.storyDate, d]));
      })
      .then((map) => { if (alive) { setDays(map); setLoaded({ key: requestKey, error: null }); } })
      .catch((err) => { if (alive) { setDays({}); setLoaded({ key: requestKey, error: err.message }); } });
    return () => { alive = false; };
  }, [brandId, key, requestKey]);

  const load = useCallback(() => setReloadTick((t) => t + 1), []);

  const cells = useMemo(() => buildMonthGrid(view.year, view.month), [view]);
  const count = Object.keys(days).length;

  function go(delta) {
    setView((v) => shiftMonth(v.year, v.month, delta));
  }

  // Keep the grid in sync with whatever the panel changed, without refetching.
  function handleDayChanged(date, story) {
    setDays((prev) => {
      const next = { ...prev };
      for (const [d, s] of Object.entries(next)) if (story && s.id === story.id) delete next[d];
      if (!story) delete next[date];
      else if (story.storyDate.startsWith(`${key}-`)) {
        next[story.storyDate] = { id: story.id, storyDate: story.storyDate, status: story.status, assetCount: story.assets.length };
      }
      return next;
    });
  }

  return (
    <section style={{ marginTop: 36 }}>
      <SectionLabel meta={loading ? "Loading…" : `${count} ${count === 1 ? "day" : "days"} this month`}>Story Contents</SectionLabel>
      <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 13, color: "var(--sketch-ink-faint)", margin: "8px 0 14px" }}>
        Plan, hand off and track Instagram Story content for manual publishing.
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 900, fontSize: 22, textTransform: "uppercase", color: "var(--sketch-ink)" }}>
          {MONTHS[view.month - 1]} {view.year}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" style={inkBtn} onClick={() => go(-1)} aria-label="Previous month">‹ Prev</button>
          <button type="button" style={inkBtn} onClick={() => setView({ year: today.year, month: today.month })}>Today</button>
          <button type="button" style={inkBtn} onClick={() => go(1)} aria-label="Next month">Next ›</button>
        </div>
      </div>

      {error && (
        <div style={{ ...lbl, color: "var(--sketch-vermilion)", marginBottom: 8 }}>
          {error} <button type="button" style={{ ...inkBtn, marginLeft: 8 }} onClick={load}>Retry</button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4 }}>
        {DOW.map((d) => (
          <div key={d} style={{ ...lbl, fontSize: 9, textAlign: "center", padding: "4px 0" }}>{d}</div>
        ))}
        {cells.map((date, i) =>
          date ? (
            <DayCell key={date} date={date} summary={days[date]} isToday={date === today.iso} onOpen={setOpenDate} />
          ) : (
            <div key={`pad-${i}`} aria-hidden="true" />
          ),
        )}
      </div>

      {!loading && !error && count === 0 && (
        <div style={{ ...lbl, fontSize: 9, marginTop: 8 }}>Click a date to add Story content.</div>
      )}

      {openDate && (
        <StoryDayPanel
          brandId={brandId}
          date={openDate}
          storyId={days[openDate]?.id ?? null}
          onClose={() => setOpenDate(null)}
          onChanged={(story) => handleDayChanged(openDate, story)}
          onMoved={(story) => { handleDayChanged(openDate, story); setOpenDate(null); }}
        />
      )}
    </section>
  );
}
