"use client";

// TODAY: everything due today across the viewer's Brands, grouped by Brand.
// Data: GET /api/today (read-only). Opening an item reuses the existing detail
// UI; any change made there triggers a refetch so counts/badges stay correct.

import { useCallback, useEffect, useMemo, useState } from "react";
import PostDetailModal from "@/components/PostDetailModal";
import LinkedInPostDetailModal from "@/components/LinkedInPostDetailModal";
import StoryDayPanel from "@/components/StoryDayPanel";
import { TodayPostCard, TodayStoryCard, lbl } from "@/components/today/TodayCards";
import { filterTodayBrands } from "@/lib/today-filter";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "instagram", label: "Instagram" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "stories", label: "Stories" },
];

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function Stat({ value, label, alert }) {
  return (
    <div style={{ minWidth: 92 }}>
      <div style={{ fontFamily: "var(--font-display, var(--font-mono-ink))", fontSize: 26, lineHeight: 1, color: alert ? "var(--sketch-vermilion)" : "var(--sketch-ink)" }}>
        {value}
      </div>
      <div style={{ ...lbl, fontSize: 9, marginTop: 4 }}>{label}</div>
    </div>
  );
}

function Group({ title, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ ...lbl, fontSize: 9, color: "var(--sketch-ink-soft)" }}>{title}</div>
      {children}
    </div>
  );
}

export default function TodayDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [brandId, setBrandId] = useState("all");
  const [showEmpty, setShowEmpty] = useState(false);
  const [openPost, setOpenPost] = useState(null);   // { post, brand }
  const [openStory, setOpenStory] = useState(null); // { story, brand }

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/today", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) throw new Error(json?.error || "Could not load today's schedule.");
      setData(json);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/today", { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json) throw new Error(json?.error || "Could not load today's schedule.");
        if (active) setData(json);
      })
      .catch((err) => active && setError(err.message));
    return () => { active = false; };
  }, []);

  const brands = useMemo(
    () => filterTodayBrands(data?.brands, { filter, brandId, showEmpty }),
    [data, filter, brandId, showEmpty],
  );
  const counts = data?.counts;
  const zones = useMemo(() => [...new Set((data?.brands || []).map((b) => b.dateLabel))], [data]);

  function closePost() {
    setOpenPost(null);
    load();
  }

  return (
    <div className="today-page">
      <style>{`
        .today-page { padding: 28px 32px 60px; max-width: 1100px; min-width: 0; }
        .today-card { display: flex; gap: 12px; align-items: flex-start; border: 1px solid var(--sketch-line); background: var(--sketch-paper-bright); box-shadow: 2px 2px 0 rgba(28,24,18,0.08); padding: 10px 12px; min-width: 0; }
        .today-card-actions { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; flex-shrink: 0; }
        .today-excerpt { font-family: var(--font-mono-ink); font-size: 11px; line-height: 1.45; color: var(--sketch-ink); white-space: pre-line; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
        .today-filter { font-family: var(--font-mono-ink); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; padding: 6px 12px; border: 1px solid var(--sketch-line); background: transparent; color: var(--sketch-ink-soft); cursor: pointer; }
        .today-filter[aria-pressed="true"] { border-color: var(--sketch-ink); background: var(--sketch-ink); color: var(--sketch-paper-bright); }
        .today-brand { border: 1px solid var(--sketch-line); background: var(--sketch-paper); padding: 16px; display: flex; flex-direction: column; gap: 14px; min-width: 0; }
        @media (max-width: 720px) {
          .today-page { padding: 18px 14px 40px; }
          .today-card { flex-wrap: wrap; }
          .today-card-actions { flex-direction: row; align-items: center; width: 100%; justify-content: flex-end; }
        }
      `}</style>

      <header style={{ marginBottom: 18 }}>
        <div style={{ ...lbl, color: "var(--sketch-vermilion)" }}>Publish queue</div>
        <h1 style={{ fontFamily: "var(--font-display, inherit)", fontSize: 40, lineHeight: 1.05, margin: "4px 0 6px", color: "var(--sketch-ink)" }}>TODAY</h1>
        <div style={{ fontFamily: "var(--font-mono-ink)", fontSize: 12, color: "var(--sketch-ink-soft)" }}>
          {zones.length === 1 ? zones[0] : zones.length > 1 ? `${zones.join(" / ")} — each Brand uses its own timezone` : ""}
        </div>
      </header>

      {error && !data && (
        <div role="alert" style={{ ...lbl, color: "var(--sketch-vermilion)", fontSize: 11, textTransform: "none" }}>
          {error} <button type="button" className="today-filter" onClick={load}>Retry</button>
        </div>
      )}
      {!data && !error && <div style={lbl}>Loading…</div>}

      {data && (
        <>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", padding: "12px 0 16px", borderTop: "1px solid var(--sketch-line)", borderBottom: "1px solid var(--sketch-line)", marginBottom: 16 }}>
            <Stat value={counts.posts} label={counts.posts === 1 ? "Post" : "Posts"} />
            <Stat value={counts.stories} label={counts.stories === 1 ? "Story" : "Stories"} />
            <Stat value={counts.brandsWithActivity} label="Brands with activity" />
            <Stat value={counts.instagram} label="Instagram" />
            <Stat value={counts.linkedin} label="LinkedIn" />
            {counts.overdue > 0 && <Stat value={counts.overdue} label="Overdue" alert />}
            {counts.storiesReady > 0 && <Stat value={counts.storiesReady} label="Stories to publish" alert />}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 18 }}>
            {FILTERS.map((f) => (
              <button key={f.key} type="button" className="today-filter" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
            {data.brands.length > 1 && (
              <select
                aria-label="Brand filter"
                value={brandId}
                onChange={(e) => setBrandId(e.target.value)}
                className="today-filter"
                style={{ textTransform: "none", maxWidth: "100%" }}
              >
                <option value="all">All accessible Brands</option>
                {data.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            <label style={{ ...lbl, fontSize: 9, display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} />
              Show brands with no activity
            </label>
          </div>

          {brands.length === 0 ? (
            <div style={{ border: "1px dashed var(--sketch-line)", padding: "28px 20px", textAlign: "center" }}>
              <div style={{ fontFamily: "var(--font-mono-ink)", fontSize: 13, color: "var(--sketch-ink)" }}>
                {counts.total === 0
                  ? "No posts or Stories are scheduled for today."
                  : "Nothing matches this filter today."}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {brands.map((b) => {
                const n = b.instagram.length + b.linkedin.length;
                return (
                  <section key={b.id} className="today-brand" aria-label={b.name}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontFamily: "var(--font-display, inherit)", fontSize: 20, color: "var(--sketch-ink)", textTransform: "uppercase", overflowWrap: "anywhere" }}>{b.name}</div>
                        <div style={{ ...lbl, fontSize: 9 }}>
                          {b.timeZone}{b.timeZoneIsFallback ? " (default — set the brand's timezone)" : ""} · {b.dateLabel}
                        </div>
                      </div>
                      <div style={{ ...lbl, fontSize: 10, color: "var(--sketch-ink-soft)" }}>
                        {plural(n, "post")} · {plural(b.stories.length, "story", "stories")}
                        {b.counts.overdue > 0 ? ` · ${b.counts.overdue} overdue` : ""}
                      </div>
                    </div>

                    {b.instagram.length > 0 && (
                      <Group title="Instagram">
                        {b.instagram.map((p) => <TodayPostCard key={p.id} post={p} onOpen={(post) => setOpenPost({ post, brand: b })} />)}
                      </Group>
                    )}
                    {b.linkedin.length > 0 && (
                      <Group title="LinkedIn">
                        {b.linkedin.map((p) => <TodayPostCard key={p.id} post={p} onOpen={(post) => setOpenPost({ post, brand: b })} />)}
                      </Group>
                    )}
                    {b.stories.length > 0 && (
                      <Group title="Stories">
                        {b.stories.map((s) => <TodayStoryCard key={s.id} story={s} onOpen={(story) => setOpenStory({ story, brand: b })} />)}
                      </Group>
                    )}
                    {n + b.stories.length === 0 && <div style={{ ...lbl, fontSize: 9 }}>Nothing scheduled today.</div>}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Existing detail UIs — same props/permissions as the Brand workspace. */}
      {openPost && openPost.post.platform === "LinkedIn" && (
        <LinkedInPostDetailModal
          key={openPost.post.id}
          post={openPost.post}
          brandId={openPost.post.brandId}
          brandTimezone={openPost.post.today?.timeZone}
          onClose={closePost}
          onUpdated={(updated) => { setOpenPost((o) => (o ? { ...o, post: { ...o.post, ...updated } } : o)); load(); }}
          onDeleted={closePost}
          onCrossPlatformCreated={load}
        />
      )}
      {openPost && openPost.post.platform !== "LinkedIn" && (
        <PostDetailModal
          post={openPost.post}
          // Same rule as the Instagram grid: manage through the owning Brand,
          // view a collaboration through the Brand it is shown under.
          brandId={openPost.post.canManage === false ? openPost.brand.id : openPost.post.brandId}
          brandTimezone={openPost.post.today?.timeZone}
          readOnly={openPost.post.canManage === false}
          onClose={closePost}
          onUpdated={(updated) => { setOpenPost((o) => (o ? { ...o, post: { ...o.post, ...updated } } : o)); load(); }}
          onDeleted={closePost}
          onCrossPlatformCreated={load}
        />
      )}
      {openStory && (
        <StoryDayPanel
          brandId={openStory.brand.id}
          date={openStory.story.storyDate}
          storyId={openStory.story.id}
          onClose={() => { setOpenStory(null); load(); }}
          onChanged={load}
          onMoved={() => { setOpenStory(null); load(); }}
        />
      )}
    </div>
  );
}
