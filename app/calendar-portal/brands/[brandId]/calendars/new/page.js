import { prisma } from "@/lib/prisma";
import { getBrandCalendarAccess } from "@/lib/auth";
import { normalizeBrandIdentityOutput, createCompactBrandVisualIdentitySummaryForImagePrompt } from "@/lib/brand-identity-utils";
import { PortalCreateCalendarClient } from "./PortalCreateCalendarClient";

export const dynamic = "force-dynamic";

export default async function PortalNewCalendarPage({ params }) {
  const { brandId } = await params;

  const access = await getBrandCalendarAccess(brandId);
  if (!access.allowed) return <div>Access denied</div>;

  const brand = await prisma.brand.findUnique({
    where: { id: brandId },
  });
  if (!brand) return <div>Brand not found</div>;

  const identities = await prisma.brandIdentity.findMany({
    where: { brandId },
    orderBy: { createdAt: "desc" },
    take: 1,
  });
  const brandIdentity = identities.length > 0
    ? normalizeBrandIdentityOutput(identities[0])
    : null;

  return (
    <PortalCreateCalendarClient
      brand={brand}
      brandIdentity={brandIdentity}
    />
  );
}
