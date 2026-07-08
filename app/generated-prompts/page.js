import { prisma } from "@/lib/prisma";
import GeneratedPromptsClient from "./GeneratedPromptsClient";

export const dynamic = "force-dynamic";

function formatDate(date) {
  const d = new Date(date);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default async function GeneratedPromptsPage({ searchParams }) {
  const params = await searchParams;
  const brandId = params?.brandId;

  const prompts = await prisma.generatedPrompt.findMany({
    where: brandId ? { brandId } : undefined,
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
