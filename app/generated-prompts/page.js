import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { brandScopeWhere, requireBrandAccess } from "@/lib/brand-access";
import { NotAuthorized } from "@/components/NotAuthorized";
import GeneratedPromptsClient from "./GeneratedPromptsClient";

export const dynamic = "force-dynamic";

function formatDate(date) {
  const d = new Date(date);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default async function GeneratedPromptsPage({ searchParams }) {
  const params = await searchParams;
  const brandId = params?.brandId;

  const user = await getCurrentUser();

  // An explicit ?brandId= must be one the user may see; without it, fall back
  // to every brand they can access rather than to every brand.
  if (brandId) {
    const access = await requireBrandAccess(brandId, { user });
    if (!access.ok) return <NotAuthorized />;
  }

  const prompts = await prisma.generatedPrompt.findMany({
    where: brandId ? { brandId } : await brandScopeWhere(user),
    include: { brand: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  const totalCount = prompts.length;

  const rows = prompts.map((p) => ({
    id: p.id,
    type: p.type || "caption",
    targetTool: p.targetTool || "Native",
    brandName: p.brand?.name || null,
    excerpt: (p.finalPrompt || "").slice(0, 120) + ((p.finalPrompt || "").length > 120 ? "…" : ""),
    date: formatDate(p.createdAt),
    status: "used",
  }));

  return <GeneratedPromptsClient prompts={rows} totalCount={totalCount} />;
}
