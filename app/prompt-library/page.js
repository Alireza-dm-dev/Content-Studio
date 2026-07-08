import { prisma } from "@/lib/prisma";
import PromptLibraryClient from "./PromptLibraryClient";

export const dynamic = "force-dynamic";

export default async function PromptLibraryPage() {
  const templates = await prisma.promptTemplate.findMany({
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  return (
    <div className="flex flex-col h-screen">
      <div className="shrink-0 px-6 py-4 border-b border-border">
        <h1 className="text-xl font-semibold">Prompt Library</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Edit and manage prompt templates used by AI workflows.
        </p>
      </div>
      <div className="flex-1 min-h-0">
        <PromptLibraryClient initialTemplates={templates} />
      </div>
    </div>
  );
}
