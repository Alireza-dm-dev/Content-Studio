import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getBrandCalendarAccess } from "@/lib/auth";
import { StatusPill } from "@/components/content-report/StatusPill";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function BrandCalendarsPage({ params }) {
  const { brandId } = await params;

  const access = await getBrandCalendarAccess(brandId);
  if (!access.allowed) return <div>Access denied</div>;

  const brand = await prisma.brand.findUnique({
    where: { id: brandId },
    select: { id: true, name: true, businessType: true, businessLocation: true },
  });
  if (!brand) return <div>Brand not found</div>;

  const calendars = await prisma.contentCalendar.findMany({
    where: { brandId },
    include: { _count: { select: { posts: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <Link
          href="/calendar-portal"
          style={{
            fontFamily: "var(--font-mono-ink)",
            fontSize: 10,
            letterSpacing: "0.08em",
            color: "var(--sketch-ink-faint)",
            textDecoration: "none",
            display: "inline-block",
            marginBottom: 12,
          }}
        >
          &larr; All brands
        </Link>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 900,
                fontSize: 38,
                lineHeight: 1,
                color: "var(--sketch-ink)",
                margin: 0,
              }}
            >
              {brand.name}
            </h1>
            {(brand.businessType || brand.businessLocation) && (
              <div
                style={{
                  fontFamily: "var(--font-mono-ink)",
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--sketch-ink-faint)",
                  marginTop: 4,
                }}
              >
                {[brand.businessType, brand.businessLocation].filter(Boolean).join(" · ")}
              </div>
            )}
          </div>
          <Link
            href={`/calendar-portal/brands/${brandId}/calendars/new`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontFamily: "var(--font-mono-ink)",
              fontSize: 10.5,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              padding: "7px 14px",
              borderRadius: 4,
              border: "1px solid var(--sketch-ink)",
              background: "var(--sketch-ink)",
              color: "var(--sketch-paper-bright)",
              textDecoration: "none",
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            New Calendar
          </Link>
        </div>
        <div
          style={{
            width: "40%",
            borderBottom: "2px solid var(--sketch-vermilion)",
            marginTop: 8,
          }}
        />
      </div>

      {/* Calendars */}
      {calendars.length === 0 ? (
        <div
          style={{
            fontFamily: "var(--font-mono-ink)",
            fontSize: 12,
            color: "var(--sketch-ink-faint)",
            padding: "40px 0",
            textAlign: "center",
          }}
        >
          No calendars yet &mdash; create one to get started
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
          {calendars.map((cal) => (
            <Link
              key={cal.id}
              href={`/calendar-portal/brands/${brandId}/calendars/${cal.id}`}
              style={{ textDecoration: "none" }}
            >
              <div
                style={{
                  border: "1px solid var(--sketch-line)",
                  background: "var(--sketch-paper-bright)",
                  padding: "18px 20px",
                  cursor: "pointer",
                  transition: "border-color 160ms ease",
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
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span
                    style={{
                      fontFamily: "var(--font-mono-ink)",
                      fontSize: 9.5,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "var(--sketch-ink-faint)",
                    }}
                  >
                    {cal._count.posts} posts
                  </span>
                  {cal.platform && (
                    <span
                      style={{
                        fontFamily: "var(--font-mono-ink)",
                        fontSize: 9.5,
                        color: "var(--sketch-ink-faint)",
                      }}
                    >
                      {cal.platform}
                    </span>
                  )}
                </div>
                {cal.timePeriod && (
                  <div
                    style={{
                      fontFamily: "var(--font-mono-ink)",
                      fontSize: 9.5,
                      color: "var(--sketch-ink-faint)",
                      marginTop: 4,
                    }}
                  >
                    {cal.timePeriod}
                  </div>
                )}
                <div
                  style={{
                    marginTop: 10,
                    fontFamily: "var(--font-mono-ink)",
                    fontSize: 9.5,
                    letterSpacing: "0.08em",
                    color: "var(--sketch-vermilion)",
                  }}
                >
                  View & edit &rarr;
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
