// Makes the "post-regeneration" Prompt Library template available on every
// installation without a manual deploy step: fresh databases get it from
// prisma/seed.js, existing ones get it created here on first use.
//
// Create-only: an existing row is never modified, so an administrator's edits
// (and their "restore default" through the Prompt Library) are always kept.

import { prisma } from "@/lib/prisma";
import {
  POST_REGENERATION_TEMPLATE_SLUG,
  POST_REGENERATION_TEMPLATE_NAME,
  POST_REGENERATION_TEMPLATE_TEXT,
} from "@/lib/default-prompt-templates";

let ensured = false;

/** @returns {Promise<string>} the template slug to pass to generateWithPromptTemplate */
export async function ensurePostRegenerationTemplate() {
  if (ensured) return POST_REGENERATION_TEMPLATE_SLUG;
  try {
    const existing = await prisma.promptTemplate.findUnique({
      where: { slug: POST_REGENERATION_TEMPLATE_SLUG },
      select: { id: true },
    });
    if (!existing) {
      await prisma.promptTemplate.create({
        data: {
          id: "tpl-post-regeneration",
          name: POST_REGENERATION_TEMPLATE_NAME,
          slug: POST_REGENERATION_TEMPLATE_SLUG,
          category: "calendar",
          outputType: "json",
          templateText: POST_REGENERATION_TEMPLATE_TEXT,
          defaultTemplateText: POST_REGENERATION_TEMPLATE_TEXT,
        },
      });
      console.log("[PostRegeneration] created default Prompt Library template", POST_REGENERATION_TEMPLATE_SLUG);
    }
    ensured = true;
  } catch (err) {
    // A concurrent request created it first: that is the desired end state.
    if (err?.code === "P2002") ensured = true;
    else console.warn("[PostRegeneration] could not ensure template:", err?.message);
  }
  return POST_REGENERATION_TEMPLATE_SLUG;
}
