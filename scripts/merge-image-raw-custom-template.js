// SAFELY merges the richer image-prompt enhancement block into the EXISTING
// custom "image-prompt-booster-raw-idea" PromptTemplate.
//
// It does NOT replace the custom template. It:
//   - refuses to run if the row is missing (use templates:update:image-raw first)
//   - refuses to run if the row is still a placeholder (use templates:update first)
//   - refuses to run if the custom template changed since the audit
//   - makes only narrow replacements (tool refs + restrictive rule)
//   - appends the shared enhancement block exactly once (idempotent via marker)
//   - writes a timestamped backup to the OS temp dir (never inside the repo)
//
// Prints only status + counts + backup path — never template contents, keys, secrets.

import { PrismaClient } from "../lib/generated/prisma/client.ts";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";
import fs from "fs";
import { isPlaceholder } from "../lib/template-utils.js";
import {
  IMAGE_RAW_CUSTOM_ENHANCEMENT_BLOCK,
  IMAGE_RAW_ENHANCEMENT_MARKER_START,
  IMAGE_RAW_ENHANCEMENT_MARKER_END,
} from "../lib/default-prompt-templates.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbUrl = process.env.DATABASE_URL ?? "file:" + path.join(__dirname, "../dev.db");

const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

const SLUG = "image-prompt-booster-raw-idea";

// Narrow, known patterns from the audited custom template.
const TOOL_REF_RE = /Nanobanana\s+pro/gi; // "Nanobanana pro" (any case/spacing)
const OLD_RULE =
  "- DON'T CHANGE THE PROMPT, JUST STRUCTURE IT\n- YOU CAN ONLY ADD RECOMMENDATIONS";
const OLD_TASK =
  "Don't add unnecessary details and don't change the prompt, it's better to just divide the text into groups";

const NEW_RULE =
  "- PRESERVE THE USER'S CORE IDEA, SUBJECT, AND MESSAGE. You may structure the " +
  "prompt and add coherent visual production direction (environment, lighting, composition, " +
  "camera, color, materials, and supporting detail) and resolve missing production decisions, " +
  "but never replace the main subject, change the concept, invent brand claims or offers, " +
  "add unrelated logos or text, or contradict explicit user instructions.";

const NEW_TASK =
  "Don't add unnecessary details, invent the concept, or contradict the user; you may " +
  "expand vague visual details and resolve missing production decisions while preserving the " +
  "core idea and dividing the text into clear groups";

function fail(message, code = 1) {
  console.error(message);
  prisma.$disconnect().finally(() => process.exit(code));
}

async function main() {
  const row = await prisma.promptTemplate.findUnique({ where: { slug: SLUG } });

  if (!row) {
    fail(
      `Template "${SLUG}" not found. Run \`npm run templates:update:image-raw\` first to create it.`,
      1,
    );
    return;
  }

  if (isPlaceholder(row.templateText)) {
    fail(
      `Template "${SLUG}" is still a placeholder. Run \`npm run templates:update:image-raw\` first.`,
      1,
    );
    return;
  }

  if (row.templateText.includes(IMAGE_RAW_ENHANCEMENT_MARKER_START)) {
    console.log("already merged");
    await prisma.$disconnect();
    return;
  }

  // Safety check: the custom template must still contain at least one of the
  // expected patterns we intend to adjust. If none match, the template
  // changed since the audit and we must not guess.
  const recognisable =
    TOOL_REF_RE.test(row.templateText) ||
    /ONLY ADD RECOMMENDATIONS/i.test(row.templateText) ||
    /JUST STRUCTURE IT/i.test(row.templateText);
  if (!recognisable) {
    fail(
      "Aborting: the custom template changed since the audit (expected patterns not found). " +
        "No changes were made.",
      1,
    );
    return;
  }

  const original = row.templateText;

  // --- Backup (outside the repository) ---
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(os.tmpdir(), `${SLUG}-${ts}.txt`);
  fs.writeFileSync(backupPath, original);
  console.log(`backup: ${backupPath}`);

  // --- Narrow replacements ---
  let merged = original;

  const toolHits = merged.match(TOOL_REF_RE)?.length ?? 0;
  merged = merged.replaceAll(TOOL_REF_RE, "{{targetTool}}");

  const ruleAdjusted = merged.includes(OLD_RULE);
  if (ruleAdjusted) merged = merged.replace(OLD_RULE, NEW_RULE);

  const taskAdjusted = merged.includes(OLD_TASK);
  if (taskAdjusted) merged = merged.replace(OLD_TASK, NEW_TASK);

  // --- Append the enhancement block exactly once ---
  const separator = merged.endsWith("\n") ? "\n" : "\n\n";
  merged = `${merged.trimEnd()}${separator}${IMAGE_RAW_CUSTOM_ENHANCEMENT_BLOCK}\n`;

  // --- Persist (templateText only; default fallback untouched) ---
  await prisma.promptTemplate.update({
    where: { slug: SLUG },
    data: { templateText: merged },
  });

  console.log("merged successfully");
  console.log(`old characters: ${original.length}`);
  console.log(`new characters: ${merged.length}`);
  console.log(`tool-reference replacements: ${toolHits}`);
  console.log(`restrictive-rule adjustment: ${ruleAdjusted || taskAdjusted ? "yes" : "no"}`);
  console.log(`enhancement block appended: yes (marker ${IMAGE_RAW_ENHANCEMENT_MARKER_START})`);
}

main()
  .catch((err) => fail(`Merge failed: ${err.message ?? err}`, 1))
  .finally(() => prisma.$disconnect());
