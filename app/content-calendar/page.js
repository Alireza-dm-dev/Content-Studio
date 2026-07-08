import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { SectionLabel } from "@/components/content-report/SectionLabel";
import { StatusPill } from "@/components/content-report/StatusPill";

export const dynamic = "force-dynamic";

const lbl = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--sketch-ink-faint)",
};

export default async function ContentCalendarPage({ searchParams }) {
  const params = await searchParams;
  const brandId = params?.brandId;

  const [calendars, brand] = await Promise.all([
    prisma.contentCalendar.findMany({
      where: brandId ? { brandId } : undefined,
      include: { brand: true, _count: { select: { posts: true } } },
      orderBy: { createdAt: "desc" },
    }),
    brandId
      ? prisma.brand.findUnique({ where: { id: brandId }, select: { id: true, name: true } })
      : null,
  ]);

  return (
    <div style={{ padding: "36px 44px 48px" }}>
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
            Content
            <br />
            Calendar
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
          {calendars.length}
        </div>
      </div>
      <div
        style={{
          width: "42%",
          borderBottom: "2px solid var(--sketch-vermilion)",
          margin: "8px 0 10px",
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={lbl}>
          Schedule Management{brand ? ` · ${brand.name}` : ""} &middot; Content Studio
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Link
            href={`/content-calendar/create${brandId ? `?brandId=${brandId}` : ""}`}
            style={{
              fontFamily: "var(--font-mono-ink)",
              fontSize: 10.5,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              padding: "5px 11px",
              cursor: "pointer",
              borderRadius: "1px",
              border: "1px solid var(--sketch-ink)",
              background: "var(--sketch-ink)",
              color: "var(--sketch-paper-bright)",
              textDecoration: "none",
            }}
          >
            + New Calendar
          </Link>
        </div>
      </div>

      {/* Calendar cards */}
      {calendars.length === 0 ? (
        <div style={{ marginTop: 40, textAlign: "center", ...lbl, fontSize: 12 }}>
          No calendars yet &mdash; create one to get started
        </div>
      ) : (
        <div style={{ marginTop: 32 }}>
          <SectionLabel>{calendars.length} Calendars</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, marginTop: 16 }}>
            {calendars.map((cal) => (
              <Link key={cal.id} href={`/content-calendar/${cal.id}`} style={{ textDecoration: "none" }}>
                <div
                  style={{
                    border: "1px solid var(--sketch-line)",
                    background: "var(--sketch-paper-bright)",
                    padding: "16px 18px",
                    boxShadow: "2px 2px 0 rgba(28,24,18,0.10)",
                    transition: "border-color 160ms ease",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div
                      style={{
                        fontFamily: "var(--font-mono-ink)",
                        fontSize: 13,
                        fontWeight: 500,
                        color: "var(--sketch-ink)",
                        lineHeight: 1.3,
                      }}
                    >
                      {cal.title}
                    </div>
                    <StatusPill status={cal.status} />
                  </div>
                  {cal.brand && (
                    <div style={{ ...lbl, marginBottom: 6 }}>{cal.brand.name}</div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                    <span style={lbl}>{cal._count.posts} posts</span>
                    {cal.platform && <span style={lbl}>{cal.platform}</span>}
                  </div>
                  {cal.timePeriod && (
                    <div style={{ ...lbl, marginTop: 4 }}>{cal.timePeriod}</div>
                  )}
                  <div
                    style={{
                      ...lbl,
                      marginTop: 8,
                      color: "var(--sketch-vermilion)",
                      fontSize: 9,
                    }}
                  >
                    View grid &rarr;
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
