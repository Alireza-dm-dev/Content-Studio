import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBrandAccess } from "@/lib/brand-access";
import { NotAuthorized } from "@/components/NotAuthorized";
import ExtractIdentityClient from "./ExtractIdentityClient";

export const dynamic = "force-dynamic";

export default async function ExtractIdentityPage({ params }) {
  const { id } = await params;

  const access = await requireBrandAccess(id);
  if (!access.ok) {
    if (access.status === 404) notFound();
    return <NotAuthorized />;
  }

  const [brand, files, existingIdentities] = await Promise.all([
    prisma.brand.findUnique({ where: { id } }),
    prisma.uploadedFile.findMany({
      where: { brandId: id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.brandIdentity.findMany({
      where: { brandId: id },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  if (!brand) notFound();

  return (
    <ExtractIdentityClient
      brand={brand}
      uploadedFiles={files}
      existingIdentities={existingIdentities}
    />
  );
}
