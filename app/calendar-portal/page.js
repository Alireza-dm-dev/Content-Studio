import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function CalendarPortalPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  let brands;
  if (user.role === "admin") {
    brands = await prisma.brand.findMany({ orderBy: { name: "asc" } });
  } else {
    brands = await prisma.brand.findMany({
      where: { brandMemberships: { some: { userId: user.id } } },
      orderBy: { name: "asc" },
    });
  }

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 900,
            fontSize: 42,
            lineHeight: 1,
            color: "var(--sketch-ink)",
            margin: 0,
          }}
        >
          Calendar Portal
        </h1>
        <div
          style={{
            fontFamily: "var(--font-mono-ink)",
            fontSize: 10,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--sketch-ink-faint)",
            marginTop: 6,
          }}
        >
          {user.name} &middot; Select a brand to manage its content calendar
        </div>
      </div>

      {brands.length === 0 ? (
        <div
          style={{
            fontFamily: "var(--font-mono-ink)",
            fontSize: 12,
            color: "var(--sketch-ink-faint)",
            padding: "40px 0",
            textAlign: "center",
          }}
        >
          No brands assigned yet. Contact an admin to get access.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {brands.map((brand) => (
            <Link
              key={brand.id}
              href={`/calendar-portal/brands/${brand.id}`}
              style={{ textDecoration: "none" }}
            >
              <div
                style={{
                  border: "1px solid var(--sketch-line)",
                  borderRadius: 4,
                  padding: "20px 22px",
                  background: "var(--sketch-paper-bright)",
                  cursor: "pointer",
                  transition: "border-color 160ms ease, box-shadow 160ms ease",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 700,
                    fontSize: 24,
                    color: "var(--sketch-ink)",
                    marginBottom: 4,
                  }}
                >
                  {brand.name}
                </div>
                {brand.businessType && (
                  <div
                    style={{
                      fontFamily: "var(--font-mono-ink)",
                      fontSize: 10,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "var(--sketch-ink-faint)",
                    }}
                  >
                    {brand.businessType}
                  </div>
                )}
                {brand.businessLocation && (
                  <div
                    style={{
                      fontFamily: "var(--font-mono-ink)",
                      fontSize: 10,
                      color: "var(--sketch-ink-faint)",
                      marginTop: 2,
                    }}
                  >
                    {brand.businessLocation}
                  </div>
                )}
                <div
                  style={{
                    marginTop: 12,
                    fontFamily: "var(--font-mono-ink)",
                    fontSize: 10,
                    letterSpacing: "0.08em",
                    color: "var(--sketch-vermilion)",
                  }}
                >
                  Manage calendar &rarr;
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {user.role === "admin" && (
        <div
          style={{
            marginTop: 32,
            paddingTop: 20,
            borderTop: "1px solid var(--sketch-line)",
            textAlign: "center",
          }}
        >
          <Link
            href="/"
            style={{
              fontFamily: "var(--font-mono-ink)",
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--sketch-ink-faint)",
              textDecoration: "none",
            }}
          >
            &larr; Back to Admin Dashboard
          </Link>
        </div>
      )}
    </div>
  );
}
