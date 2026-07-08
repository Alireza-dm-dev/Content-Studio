import { prisma } from "@/lib/prisma";
import ReferenceFlowClient from "./ReferenceFlowClient";

export const dynamic = "force-dynamic";

export default async function ReferenceFlowPage({ searchParams }) {
  const sp = await searchParams;
  const brandId      = sp?.brandId      ?? null;
  const calendarId   = sp?.calendarId   ?? null;
  const postId       = sp?.postId       ?? null;

  const [brands, brand, brandIdentity, calendarPost] = await Promise.all([
    // Need all brands in case user hasn't selected one
    prisma.brand.findMany({ orderBy: { createdAt: "desc" } }),
    brandId ? prisma.brand.findUnique({ where: { id: brandId } }) : null,
    brandId ? prisma.brandIdentity.findFirst({ where: { brandId }, orderBy: { createdAt: "desc" } }) : null,
    postId  ? prisma.calendarPost.findUnique({ where: { id: postId } }) : null,
  ]);

  return (
    <ReferenceFlowClient
      brands={brands}
      initialBrand={brand}
      initialBrandIdentity={brandIdentity}
      initialCalendarPost={calendarPost}
      initialCalendarId={calendarId}
      initialCalendarPostId={postId}
    />
  );
}
