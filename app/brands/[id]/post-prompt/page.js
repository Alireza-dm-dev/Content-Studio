import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireBrandAccess } from "@/lib/brand-access";
import { NotAuthorized } from "@/components/NotAuthorized";
import PostPromptClient from "./PostPromptClient";

export const dynamic = "force-dynamic";

export default async function PostPromptPage({ params, searchParams }) {
  const { id: brandId } = await params;

  const access = await requireBrandAccess(brandId);
  if (!access.ok) {
    if (access.status === 404) notFound();
    return <NotAuthorized />;
  }
  const sp = await searchParams;
  const type = sp?.type ?? "image"; // "image" | "video"
  const postId = sp?.postId;
  const calendarId = sp?.calendarId;

  const [brand, post, identity] = await Promise.all([
    prisma.brand.findUnique({ where: { id: brandId } }),
    postId ? prisma.calendarPost.findUnique({ where: { id: postId } }) : null,
    prisma.brandIdentity.findFirst({ where: { brandId }, orderBy: { createdAt: "desc" } }),
  ]);

  if (!brand) notFound();

  return (
    <PostPromptClient
      brand={brand}
      post={post}
      brandIdentity={identity}
      type={type}
      calendarId={calendarId}
    />
  );
}
