#!/usr/bin/env node
// Idempotent PromptTemplate provisioning for the
// calendar-reference-attachment-interpreter template.
//
// Usage:
//   node scripts/ensure-calendar-attachment-interpreter-template.js --check
//   node scripts/ensure-calendar-attachment-interpreter-template.js --apply
//
// A managed marker is embedded in the template text so the script can
// recognise its own template and refuse to overwrite a custom one.

import { PrismaClient } from "../lib/generated/prisma/client.ts";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import {
  CALENDAR_ATTACHMENT_INTERPRETER_TEMPLATE_TEXT,
  CALENDAR_ATTACHMENT_INTERPRETER_MANAGED_MARKER,
} from "../lib/default-prompt-templates.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbUrl = process.env.DATABASE_URL ?? "file:" + path.join(__dirname, "../dev.db");

const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

const SLUG = "calendar-reference-attachment-interpreter";
// Single source of truth for the template text lives in
// lib/default-prompt-templates.js — shared with prisma/seed.js so both
// provisioning paths stay in sync.
const MANAGED_MARKER = CALENDAR_ATTACHMENT_INTERPRETER_MANAGED_MARKER;
const TEMPLATE_TEXT = CALENDAR_ATTACHMENT_INTERPRETER_TEMPLATE_TEXT;

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function readTemplate() {
  return prisma.promptTemplate.findUnique({ where: { slug: SLUG } });
}

async function createTemplate() {
  await prisma.promptTemplate.create({
    data: {
      id: "tpl-calendar-reference-attachment-interpreter",
      name: "Calendar Reference Attachment Interpreter",
      slug: SLUG,
      category: "calendar",
      outputType: "json",
      templateText: TEMPLATE_TEXT,
      defaultTemplateText: TEMPLATE_TEXT,
    },
  });
}

async function updateTemplate() {
  await prisma.promptTemplate.update({
    where: { slug: SLUG },
    data: {
      name: "Calendar Reference Attachment Interpreter",
      category: "calendar",
      outputType: "json",
      templateText: TEMPLATE_TEXT,
      defaultTemplateText: TEMPLATE_TEXT,
    },
  });
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes("--apply") ? "apply" : "check";

  const existing = await readTemplate();

  if (!existing) {
    if (mode === "check") {
      console.log("Template not found.");
      process.exit(1);
    }
    await createTemplate();
    console.log("Template created.");
    return;
  }

  const isManaged = existing.templateText && existing.templateText.includes(MANAGED_MARKER);

  if (!isManaged) {
    console.log("Existing template is not managed by this script. Manual review required.");
    process.exit(mode === "check" ? 0 : 1);
  }

  if (mode === "check") {
    console.log("Template exists and is managed.");
    process.exit(0);
  }

  // mode === "apply"
  await updateTemplate();
  console.log("Template updated.");
}

main()
  .catch((err) => {
    console.error("Error:", err.message ?? err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
