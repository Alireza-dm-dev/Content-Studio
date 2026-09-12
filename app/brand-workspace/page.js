import Link from "next/link";
import { prisma } from "@/lib/prisma";
import WorkspaceClient from "./WorkspaceClient";
import { requireBrandAccess } from "@/lib/brand-access";
import { NotAuthorized } from "@/components/NotAuthorized";

export const dynamic = "force-dynamic";

const lbl = {
  fontFamily: "var(--font-mono-ink)",
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--sketch-ink-faint)",
};

export default async function BrandWorkspacePage({ searchParams }) {
  const params = await searchParams;
  const brandId = params?.brandId;

  if (!brandId) {
    return (
      <div style={{ padding: "36px 44px 48px" }}>
        <h1 style={{
          margin: 0, fontFamily: "var(--font-display)", fontWeight: 900,
          fontSize: 48, lineHeight: 0.92, textTransform: "uppercase", color: "var(--sketch-ink)",
        }}>
          Brand Workspace
        </h1>
        <div style={{ borderBottom: "2px solid var(--sketch-vermilion)", width: 200, marginTop: 8, marginBottom: 20 }} />
        <div style={{ fontFamily: "var(--font-mono-ink)", fontSize: 12, color: "var(--sketch-ink-faint)" }}>
          No brand selected.{" "}
          <Link href="/brands" style={{ color: "var(--sketch-vermilion)", textDecoration: "underline" }}>
            Select a brand
          </Link>{" "}
          to get started.
        </div>
      </div>
    );
  }

  const access = await requireBrandAccess(brandId);
  if (!access.ok) {
    return (
      <NotAuthorized
        message={
          access.status === 404
            ? "That brand no longer exists."
            : "You do not have access to this brand's workspace."
        }
      />
    );
  }

  const [brand, calendars] = await Promise.all([
    prisma.brand.findUnique({ where: { id: brandId } }),
    prisma.contentCalendar.findMany({
      where: { brandId },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { _count: { select: { posts: true } } },
    }),
  ]);

  if (!brand) {
    return (
      <div style={{ padding: "36px 44px 48px" }}>
        <Link href="/brands" style={{ ...lbl, color: "var(--sketch-vermilion)", textDecoration: "none" }}>&larr; Back to Brands</Link>
        <div style={{ fontFamily: "var(--font-mono-ink)", fontSize: 12, color: "var(--sketch-ink-faint)", marginTop: 16 }}>
          Brand not found.
        </div>
      </div>
    );
  }

  return <WorkspaceClient brand={brand} initialCalendars={calendars} />;
}
