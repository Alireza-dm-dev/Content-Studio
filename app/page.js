import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { getAccessibleBrandIds } from "@/lib/brand-access";
import { StatBlock } from "@/components/content-report/StatBlock";
import { SectionLabel } from "@/components/content-report/SectionLabel";
import { ClassBadge } from "@/components/content-report/ClassBadge";
import { PipelineStep } from "@/components/content-report/PipelineStep";
import { NodeMap } from "@/components/content-report/NodeMap";

export const dynamic = "force-dynamic";

const pipeline = [
  { i: "01", l: ["BRAND", "PROFILE"] },
  { i: "02", l: ["IDENTITY", "EXTRACT"] },
  { i: "03", l: ["PROMPT", "GENERATE"], a: true },
  { i: "04", l: ["HIGGSFIELD", "GENERATE"] },
  { i: "05", l: ["CALENDAR", "SCHEDULE"] },
];

const TYPE_ICON_MAP = {
  image: "image",
  video: "video",
  caption: "caption",
  calendar: "calendar",
  brand: "brand",
};

export default async function HomePage() {
  // The dashboard counts and the recent-activity feed are scoped to the
  // viewer's brands, so the tiles never hint at the size of the wider
  // workspace and the feed never names another brand's work.
  const user = await getCurrentUser();
  const brandIds = await getAccessibleBrandIds(user);
  const scope = brandIds === null ? {} : { brandId: { in: brandIds } };
  const mediaScope =
    brandIds === null
      ? {}
      : {
          OR: [
            { brandId: { in: brandIds } },
            { calendarPost: { calendar: { brandId: { in: brandIds } } } },
          ],
        };
  const brandWhere = brandIds === null ? {} : { id: { in: brandIds } };

  const [brandCount, calendarCount, promptCount, mediaCount, templateCount, recentMedia, recentPrompts] =
    await Promise.all([
      prisma.brand.count({ where: brandWhere }),
      prisma.contentCalendar.count({ where: scope }),
      prisma.generatedPrompt.count({ where: scope }),
      prisma.generatedMedia.count({ where: mediaScope }),
      prisma.promptTemplate.count(),
      prisma.generatedMedia.findMany({
        where: mediaScope,
        take: 3,
        orderBy: { createdAt: "desc" },
        select: { mediaType: true, status: true, createdAt: true, sourcePrompt: true },
      }),
      prisma.generatedPrompt.findMany({
        where: scope,
        take: 3,
        orderBy: { createdAt: "desc" },
        include: { brand: { select: { name: true } } },
        select: undefined,
      }),
    ]);

  const activity = buildActivity(recentMedia, recentPrompts);

  return (
    <div style={{ padding: "40px 48px 56px", display: "flex", gap: 40 }}>
      {/* Main column */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Hero wordmark */}
        <div style={{ position: "relative", marginBottom: 8 }}>
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 0,
              top: -18,
              fontFamily: "var(--font-display)",
              fontWeight: 900,
              fontSize: 168,
              lineHeight: 0.82,
              color: "var(--sketch-ink)",
              opacity: 0.10,
              letterSpacing: "-0.02em",
              userSelect: "none",
              pointerEvents: "none",
            }}
          >
            CS
          </div>
          <h1
            style={{
              position: "relative",
              margin: 0,
              fontFamily: "var(--font-display)",
              fontWeight: 900,
              fontSize: 84,
              lineHeight: 0.9,
              letterSpacing: "-0.01em",
              textTransform: "uppercase",
              color: "var(--sketch-ink)",
            }}
          >
            Content
            <br />
            Studio
          </h1>
        </div>
        <div
          style={{
            width: "64%",
            borderBottom: "2px solid var(--sketch-vermilion)",
            marginBottom: 12,
          }}
        />
        <div
          style={{
            fontFamily: "var(--font-mono-ink)",
            fontSize: 13,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--sketch-ink-soft)",
            marginBottom: 36,
          }}
        >
          AI-powered creative production for social media
        </div>

        {/* Stats */}
        <div style={{ display: "flex", gap: 56, marginBottom: 40 }}>
          <StatBlock value={brandCount} label="Brands" />
          <StatBlock value={calendarCount} label="Calendars" />
          <StatBlock value={promptCount} label="Prompts" accent />
          <StatBlock value={mediaCount} label="Media" />
          <StatBlock value={templateCount} label="Templates" />
        </div>

        {/* Pipeline */}
        <SectionLabel meta="&middot; model: gpt-4o">Production Pipeline</SectionLabel>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            marginTop: 16,
            marginBottom: 12,
          }}
        >
          {pipeline.map((s, idx) => (
            <span key={s.i} style={{ display: "contents" }}>
              <PipelineStep index={s.i} lines={s.l} active={s.a} />
              {idx < pipeline.length - 1 && (
                <span
                  style={{
                    fontFamily: "var(--font-mono-ink)",
                    color: "var(--sketch-ink-faint)",
                  }}
                >
                  &rarr;
                </span>
              )}
            </span>
          ))}
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono-ink)",
            fontSize: 12,
            letterSpacing: "0.04em",
            color: "var(--sketch-vermilion)",
            marginBottom: 40,
          }}
        >
          Active step: PROMPT GENERATION &middot; Model: gpt-4o
        </div>

        {/* Recent activity */}
        <SectionLabel>Recent Activity</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 16 }}>
          {activity.length > 0 ? (
            activity.map((a, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <ClassBadge kind={a.kind} />
                <span
                  style={{
                    fontFamily: "var(--font-mono-ink)",
                    fontSize: 13,
                    color: "var(--sketch-ink)",
                    flex: 1,
                  }}
                >
                  {a.text}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono-ink)",
                    fontSize: 11,
                    letterSpacing: "0.06em",
                    color: "var(--sketch-ink-faint)",
                  }}
                >
                  {a.t}
                </span>
              </div>
            ))
          ) : (
            <div
              style={{
                fontFamily: "var(--font-mono-ink)",
                fontSize: 12,
                color: "var(--sketch-ink-faint)",
                letterSpacing: "0.06em",
              }}
            >
              No recent activity yet &mdash;{" "}
              <Link href="/brands" style={{ color: "var(--sketch-vermilion)", textDecoration: "underline" }}>
                create a brand
              </Link>{" "}
              to get started
            </div>
          )}
        </div>
      </div>

      {/* System map */}
      <div style={{ flex: "0 0 360px" }}>
        <SectionLabel meta="&middot; v0.8">Creative System Map</SectionLabel>
        <div style={{ marginTop: 14 }}>
          <NodeMap
            width={360}
            height={330}
            hub={{ label: "GEN HUB", x: 50, y: 50, color: "var(--sketch-vermilion)" }}
            nodes={[
              { label: "BRANDS", x: 24, y: 20, color: "var(--sketch-class-image)" },
              { label: "CALENDAR", x: 82, y: 26, color: "var(--sketch-sage)" },
              { label: "PROMPTS", x: 20, y: 80, color: "var(--sketch-stone)" },
              { label: "MEDIA", x: 82, y: 80, color: "var(--sketch-class-media)" },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

function formatTimeAgo(date) {
  const now = new Date();
  const diff = now - new Date(date);
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function buildActivity(recentMedia, recentPrompts) {
  const items = [];
  for (const m of recentMedia) {
    items.push({
      kind: m.mediaType || "media",
      text: `${m.mediaType === "video" ? "Video" : "Image"} generated (${m.status})`,
      t: formatTimeAgo(m.createdAt),
      date: m.createdAt,
    });
  }
  for (const p of recentPrompts) {
    items.push({
      kind: p.type || "caption",
      text: `${p.type || "Prompt"} prompt generated${p.brand ? ` for ${p.brand.name}` : ""}`,
      t: formatTimeAgo(p.createdAt),
      date: p.createdAt,
    });
  }
  items.sort((a, b) => new Date(b.date) - new Date(a.date));
  return items.slice(0, 6);
}
