import { prisma } from "@/lib/prisma";
import FromBrandClient from "./FromBrandClient";

export const dynamic = "force-dynamic";

export default async function CreateImageFromBrandPage() {
  const brands = await prisma.brand.findMany({ orderBy: { createdAt: "desc" } });
  return <FromBrandClient brands={brands} />;
}
