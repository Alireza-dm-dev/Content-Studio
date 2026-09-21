import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { brandScopeWhere, requireBrandAccess } from "@/lib/brand-access";
import { NotAuthorized } from "@/components/NotAuthorized";
import CalendarBrandSections from "./CalendarBrandSections";

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

  const user = await getCurrentUser();

  if (brandId) {
    const access = await requireBrandAccess(brandId, { user });
    if (!access.ok) return <NotAuthorized />;
  }

  const [calendars, brand] = await Promise.all([
    prisma.contentCalendar.findMany({
      where: brandId ? { brandId } : await brandScopeWhere(user),
      include: { brand: true, _count: { select: { posts: true } } },
      orderBy: { createdAt: "desc" },
    }),
    brandId
      ? prisma.brand.findUnique({ where: { id: brandId }, select: { id: true, name: true } })
      : null,
  ]);

  // Only plain, already brand-scoped fields cross into the client component.
  const cards = calendars.map((cal) => ({
    id: cal.id,
    title: cal.title,
    status: cal.status,
    platform: cal.platform,
    timePeriod: cal.timePeriod,
    brandId: cal.brandId,
    brandName: cal.brand?.name ?? null,
    postCount: cal._count.posts,
  }));

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

      {/* Calendar cards, grouped by brand */}
      <CalendarBrandSections calendars={cards} />
    </div>
  );
}
