import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { brandScopeWhere } from "@/lib/brand-access";
import FromBrandClient from "./FromBrandClient";

export const dynamic = "force-dynamic";

export default async function CreateImageFromBrandPage() {
  const user = await getCurrentUser();
  const brands = await prisma.brand.findMany({
    where: await brandScopeWhere(user, "id"),
    orderBy: { createdAt: "desc" },
  });
  return <FromBrandClient brands={brands} />;
}
