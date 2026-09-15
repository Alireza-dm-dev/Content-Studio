import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { SectionLabel } from "@/components/content-report/SectionLabel";
import BrandCard from "./BrandCard";
import { getCurrentUser } from "@/lib/auth";
import { brandScopeWhere } from "@/lib/brand-access";
import { NoBrandsAssigned } from "@/components/NotAuthorized";

export const dynamic = "force-dynamic";

export default async function BrandsPage() {
  const user = await getCurrentUser();
  const brands = await prisma.brand.findMany({
    where: await brandScopeWhere(user, "id"),
    orderBy: { createdAt: "desc" },
  });

  if (brands.length === 0 && user?.role !== "admin") {
    return <NoBrandsAssigned />;
  }

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
            Brand
            <br />
            Profiles
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
          {String(brands.length).padStart(2, "0")}
        </div>
      </div>
      <div
        style={{
          width: "42%",
          borderBottom: "2px solid var(--sketch-vermilion)",
          margin: "8px 0 10px",
        }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono-ink)",
            fontSize: 10,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--sketch-ink-faint)",
          }}
        >
          Workspace &middot; Brand Management &middot; Content Studio
        </div>
        <Link
          href="/brands/new"
          style={{
            fontFamily: "var(--font-mono-ink)",
            fontSize: 10.5,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            padding: "6px 14px",
            cursor: "pointer",
            border: "1px solid var(--sketch-vermilion)",
            background: "var(--sketch-vermilion)",
            color: "var(--sketch-paper-bright)",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> New Brand
        </Link>
      </div>

      {/* Brand grid */}
      {brands.length === 0 ? (
        <div
          style={{
            marginTop: 60,
            textAlign: "center",
            fontFamily: "var(--font-mono-ink)",
            fontSize: 13,
            color: "var(--sketch-ink-faint)",
            letterSpacing: "0.06em",
          }}
        >
          No brands yet &mdash;{" "}
          <Link
            href="/brands/new"
            style={{ color: "var(--sketch-vermilion)", textDecoration: "underline" }}
          >
            create your first brand
          </Link>{" "}
          to get started.
        </div>
      ) : (
        <div style={{ marginTop: 28 }}>
          <SectionLabel meta={`${brands.length} registered`}>Brand Registry</SectionLabel>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 20,
              marginTop: 18,
            }}
          >
            {brands.map((brand) => (
              <BrandCard key={brand.id} brand={brand} />
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 40,
          fontFamily: "var(--font-mono-ink)",
          fontSize: 10,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--sketch-ink-faint)",
          borderTop: "1px solid var(--sketch-line)",
          paddingTop: 14,
        }}
      >
        <span>Content Studio &middot; Brand Profiles</span>
        <span>Ink Cartography System</span>
      </div>
    </div>
  );
}
