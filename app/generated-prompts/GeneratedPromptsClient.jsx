"use client";

import { useState } from "react";
import { ClassBadge } from "@/components/content-report/ClassBadge";
import { StatusPill } from "@/components/content-report/StatusPill";

const lbl = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--sketch-ink-faint)",
};

const cell = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 11.5,
  color: "var(--sketch-ink-soft)",
};

const cols = "46px 92px 110px 120px 1fr 70px 130px";
const filters = ["ALL", "IMAGE", "VIDEO", "CAPTION"];

export default function GeneratedPromptsClient({ prompts, totalCount }) {
  const [filter, setFilter] = useState("ALL");

  const visible = prompts.filter(
    (r) => filter === "ALL" || (r.type || "").toUpperCase() === filter
  );

  return (
    <div style={{ padding: "36px 44px 40px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontWeight: 900,
              fontSize: 58,
              lineHeight: 0.88,
              textTransform: "uppercase",
              color: "var(--sketch-ink)",
            }}
          >
            Generated
            <br />
            Prompts
          </h1>
        </div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 900,
            fontSize: 92,
            lineHeight: 0.8,
            color: "var(--sketch-ink)",
          }}
        >
          {totalCount}
        </div>
      </div>
      <div
        style={{
          width: "42%",
          borderBottom: "2px solid var(--sketch-vermilion)",
          margin: "8px 0 10px",
        }}
      />
      <div style={lbl}>AI Output Archive &middot; Production Prompts &middot; Content Studio</div>

      {/* Filter row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 22,
          paddingBottom: 12,
          borderBottom: "1px solid var(--sketch-line)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={lbl}>Filter:</span>
          {filters.map((f) => {
            const on = filter === f;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  fontFamily: "var(--font-mono-ink)",
                  fontSize: 10.5,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  padding: "5px 11px",
                  cursor: "pointer",
                  borderRadius: "1px",
                  border: "1px solid var(--sketch-ink)",
                  background: on ? "var(--sketch-ink)" : "transparent",
                  color: on ? "var(--sketch-paper-bright)" : "var(--sketch-ink-soft)",
                }}
              >
                {f}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 22 }}>
          <span style={lbl}>Sorted: Date &darr;</span>
          <span style={lbl}>{visible.length} Results</span>
        </div>
      </div>

      {/* Table head */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: cols,
          gap: 12,
          padding: "12px 0 10px",
          borderBottom: "1px solid var(--sketch-line)",
        }}
      >
        {["No.", "Type", "Tool", "Brand", "Excerpt", "Date", "Status"].map((h) => (
          <div key={h} style={lbl}>
            {h}
          </div>
        ))}
      </div>

      {/* Rows */}
      <div>
        {visible.length === 0 ? (
          <div
            style={{
              padding: "40px 0",
              textAlign: "center",
              ...lbl,
              fontSize: 12,
            }}
          >
            No prompts found for this filter
          </div>
        ) : (
          visible.map((r, idx) => (
            <div
              key={r.id}
              style={{
                display: "grid",
                gridTemplateColumns: cols,
                gap: 12,
                alignItems: "center",
                padding: "13px 0",
                borderBottom: "1px solid var(--sketch-line-soft)",
              }}
            >
              <div style={cell}>{String(idx + 1).padStart(3, "0")}</div>
              <div>
                <ClassBadge kind={r.type || "caption"} />
              </div>
              <div style={{ ...cell, color: "var(--sketch-ink)" }}>{r.targetTool || "Native"}</div>
              <div style={cell}>{r.brandName || "—"}</div>
              <div
                style={{
                  ...cell,
                  color: "var(--sketch-ink-soft)",
                  lineHeight: 1.45,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {r.excerpt}
              </div>
              <div style={cell}>{r.date}</div>
              <div>
                <StatusPill status={r.status || "draft"} />
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginTop: 20,
        }}
      >
        <span style={lbl}>
          Ref: PS-{new Date().toISOString().split("T")[0]}
        </span>
      </div>
    </div>
  );
}
