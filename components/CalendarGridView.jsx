"use client";

const TICK_COLOR = {
  image: "var(--sketch-class-image)",
  video: "var(--sketch-class-video)",
  caption: "var(--sketch-class-caption)",
  calendar: "var(--sketch-vermilion)",
};

const DOW = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

const lbl = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--sketch-ink-faint)",
};

export default function CalendarGridView({ calendar, posts }) {
  const now = new Date();
  const todayDate = now.getDate();
  const todayMonth = now.getMonth();
  const todayYear = now.getFullYear();

  const timePeriod = calendar.timePeriod || "";
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  let displayMonth = todayMonth;
  let displayYear = todayYear;
  for (let i = 0; i < monthNames.length; i++) {
    if (timePeriod.toLowerCase().includes(monthNames[i].toLowerCase())) {
      displayMonth = i;
      const yearMatch = timePeriod.match(/\d{4}/);
      if (yearMatch) displayYear = parseInt(yearMatch[0]);
      break;
    }
  }

  const monthName = monthNames[displayMonth];
  const firstDay = new Date(displayYear, displayMonth, 1).getDay();
  const offset = firstDay === 0 ? 6 : firstDay - 1;
  const daysInMonth = new Date(displayYear, displayMonth + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const eventsByDay = {};
  for (const post of posts) {
    if (post.date) {
      const d = new Date(post.date);
      if (d.getMonth() === displayMonth && d.getFullYear() === displayYear) {
        const day = d.getDate();
        if (!eventsByDay[day]) eventsByDay[day] = [];
        const kind = post.format?.toLowerCase().includes("video") ? "video"
          : post.format?.toLowerCase().includes("image") ? "image"
          : "caption";
        eventsByDay[day].push({
          k: kind,
          t: post.suggestedHook || post.mainAngleAndCoreMessage || `Post #${post.postNumber}`,
        });
      }
    }
  }

  const totalPosts = posts.length;
  const draftPosts = posts.filter((p) => p.status === "draft").length;

  return (
    <div style={{ padding: "36px 44px 48px", position: "relative" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 32, marginBottom: 4 }}>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 22 }}>
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 900,
                fontSize: 52,
                lineHeight: 1,
                textTransform: "uppercase",
                color: "var(--sketch-ink)",
              }}
            >
              {monthName}
            </span>
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 800,
                fontSize: 52,
                lineHeight: 1,
                color: "var(--sketch-ink-soft)",
              }}
            >
              {displayYear}
            </span>
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono-ink)",
              fontSize: 11,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--sketch-ink-faint)",
              marginTop: 6,
            }}
          >
            Content Calendar{calendar.brand ? ` · Brand: ${calendar.brand.name}` : ""} · {calendar.title}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, paddingTop: 6 }}>
          <span style={{ width: 4, background: "var(--sketch-vermilion)", alignSelf: "stretch" }} />
          <div style={{ fontFamily: "var(--font-mono-ink)", fontSize: 12, lineHeight: 1.5 }}>
            <div style={{ color: "var(--sketch-vermilion)" }}>{totalPosts} posts scheduled</div>
            <div style={{ color: "var(--sketch-ink-soft)" }}>{draftPosts} drafts pending</div>
          </div>
        </div>
      </div>
      <div style={{ borderBottom: "2px solid var(--sketch-ink)", margin: "14px 0 0" }} />

      {/* Weekday header */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 0 }}>
        {DOW.map((d, i) => (
          <div
            key={d}
            style={{
              padding: "10px 8px",
              fontFamily: "var(--font-mono-ink)",
              fontSize: 10,
              letterSpacing: "0.12em",
              color: "var(--sketch-ink-faint)",
              borderRight: i < 6 ? "1px solid var(--sketch-line-soft)" : "none",
            }}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          border: "1px solid var(--sketch-line)",
          borderBottom: "none",
        }}
      >
        {cells.map((d, idx) => {
          const col = idx % 7;
          const weekend = col >= 5;
          const isToday = d === todayDate && displayMonth === todayMonth && displayYear === todayYear;
          const evs = d ? eventsByDay[d] || [] : [];
          return (
            <div
              key={idx}
              style={{
                minHeight: 118,
                padding: "8px 9px",
                borderRight: col < 6 ? "1px solid var(--sketch-line-soft)" : "none",
                borderBottom: "1px solid var(--sketch-line)",
                background: isToday
                  ? "var(--sketch-vermilion-wash)"
                  : weekend
                    ? "var(--sketch-paper-raw)"
                    : "transparent",
                boxShadow: isToday ? "inset 0 0 0 1.5px var(--sketch-vermilion)" : "none",
                position: "relative",
              }}
            >
              {d && (
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 800,
                    fontSize: 26,
                    lineHeight: 1,
                    color: isToday ? "var(--sketch-vermilion)" : "var(--sketch-ink)",
                  }}
                >
                  {d}
                </div>
              )}
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
                {evs.map((e, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span
                      style={{
                        width: 3,
                        height: 11,
                        background: TICK_COLOR[e.k] || TICK_COLOR.caption,
                        flex: "0 0 3px",
                      }}
                    />
                    <span
                      style={{
                        fontFamily: "var(--font-mono-ink)",
                        fontSize: 9.5,
                        letterSpacing: "0.04em",
                        color: "var(--sketch-ink-soft)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {(e.t || "").slice(0, 18)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div
        style={{
          position: "absolute",
          top: 150,
          right: 44,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          width: 188,
        }}
      >
        <div
          style={{
            background: "var(--sketch-paper-bright)",
            border: "1px solid var(--sketch-line)",
            boxShadow: "2px 2px 0 rgba(28,24,18,0.10)",
            padding: "12px 14px",
          }}
        >
          <div
            style={{
              ...lbl,
              color: "var(--sketch-ink)",
              marginBottom: 9,
              borderBottom: "1px solid var(--sketch-line)",
              paddingBottom: 6,
            }}
          >
            POST TYPES
          </div>
          {[
            ["image", "IMAGE"],
            ["video", "VIDEO"],
            ["caption", "CAPTION"],
            ["calendar", "CALENDAR"],
          ].map(([k, l]) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ width: 10, height: 10, background: TICK_COLOR[k] }} />
              <span
                style={{
                  fontFamily: "var(--font-mono-ink)",
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  color: "var(--sketch-ink-soft)",
                }}
              >
                {l}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 22,
          fontFamily: "var(--font-mono-ink)",
          fontSize: 10,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--sketch-ink-faint)",
        }}
      >
        <span>Content Studio &middot; Calendar View</span>
        <span style={{ color: "var(--sketch-vermilion)" }}>
          Today: {todayDate} {monthName} {todayYear}
        </span>
      </div>
    </div>
  );
}
