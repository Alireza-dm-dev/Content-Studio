import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { brandScopeWhere, requireBrandAccess, requireResourceBrandAccess } from "@/lib/brand-access";
import { NotAuthorized } from "@/components/NotAuthorized";
import ReferenceFlowClient from "./ReferenceFlowClient";

export const dynamic = "force-dynamic";

export default async function ReferenceFlowPage({ searchParams }) {
  const sp = await searchParams;
  const brandId      = sp?.brandId      ?? null;
  const calendarId   = sp?.calendarId   ?? null;
  const postId       = sp?.postId       ?? null;

  const user = await getCurrentUser();

  // A brand or post named in the query string must be one the user may open.
  if (brandId) {
    const access = await requireBrandAccess(brandId, { user });
    if (!access.ok) return <NotAuthorized />;
  }
  if (postId) {
    const access = await requireResourceBrandAccess("calendarPost", postId, { user });
    if (!access.ok) return <NotAuthorized message="You do not have access to this post." />;
  }

  const [brands, brand, brandIdentity, calendarPost] = await Promise.all([
    // The selector lists only brands this user belongs to.
    prisma.brand.findMany({
      where: await brandScopeWhere(user, "id"),
      orderBy: { createdAt: "desc" },
    }),
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
