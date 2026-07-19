// Safely populates the "image-prompt-booster-raw-idea" PromptTemplate in an
// EXISTING database.
//
// Behavior:
//   - If the template does not exist, create it with the real default instruction
//     and the same metadata used by prisma/seed.js.
//   - If it exists and is still a placeholder, replace it with the real default.
//   - If it exists and already has real (user-authored) content, leave it untouched.
//
// Idempotent: re-running never overwrites a custom template.
// Prints only a single status line — never template contents, API keys, or secrets.

import { PrismaClient } from "../lib/generated/prisma/client.ts";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { isPlaceholder } from "../lib/template-utils.js";
import { IMAGE_PROMPT_BOOSTER_RAW_IDEA_TEXT } from "../lib/default-prompt-templates.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbUrl = process.env.DATABASE_URL ?? "file:" + path.join(__dirname, "../dev.db");

const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

const SLUG = "image-prompt-booster-raw-idea";

// Metadata mirrors prisma/seed.js for this template so a created row matches a
// fresh-database seed exactly.
const DEFAULTS = {
  id: "tpl-image-prompt-booster-raw-idea",
  name: "Image Prompt Booster (Raw Idea)",
  slug: SLUG,
  category: "image",
  outputType: "text",
  templateText: IMAGE_PROMPT_BOOSTER_RAW_IDEA_TEXT,
  defaultTemplateText: IMAGE_PROMPT_BOOSTER_RAW_IDEA_TEXT,
};

async function main() {
  const existing = await prisma.promptTemplate.findUnique({ where: { slug: SLUG } });

  if (!existing) {
    await prisma.promptTemplate.create({ data: DEFAULTS });
    console.log("created");
    return;
  }

  if (isPlaceholder(existing.templateText)) {
    await prisma.promptTemplate.update({
      where: { slug: SLUG },
      data: {
        templateText: IMAGE_PROMPT_BOOSTER_RAW_IDEA_TEXT,
        defaultTemplateText: IMAGE_PROMPT_BOOSTER_RAW_IDEA_TEXT,
      },
    });
    console.log("updated placeholder");
    return;
  }

  console.log("skipped custom template");
}

main()
  .catch((err) => {
    console.error("Update failed:", err.message ?? err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
