// Idempotent database patch for the video-prompt-enhancer-raw-idea
// PromptTemplate record.
//
// Replaces the obsolete "ask the user to choose" conflict-resolution
// instruction with a verified self-resolution instruction.
//
// Deployment:
//   1. Ensure database and Prisma client are available
//   2. node scripts/patch-video-prompt-conflict.js --check
//   3. node scripts/patch-video-prompt-conflict.js --apply
//   4. node scripts/patch-video-prompt-conflict.js --check
//
// This is an explicit controlled operation. It is NOT automatically
// triggered by npm install, postinstall, migrations, or application startup.

import { PrismaClient } from "../lib/generated/prisma/client.ts";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbUrl = process.env.DATABASE_URL ?? "file:" + path.join(__dirname, "../dev.db");

const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

const SLUG = "video-prompt-enhancer-raw-idea";

// Exact obsolete instruction as it appears in the database template.
// This is the full paragraph that tells the model to ask the user for
// clarification on conflicts.
const OLD_TEXT =
  "If there is a conflict, do not create the final structured prompt yet.\n" +
  "Instead, ask the user to choose between the conflicting options.\n" +
  "Clearly show the conflicting options in a simple way.\n" +
  "\n" +
  "If there is no conflict, create the final structured prompt normally.";

// Verified replacement instruction. The model is told to resolve conflicts
// itself using the supplied priority order rather than asking the user.
// Canonical form (shorter):
//   "If there is a conflict, resolve it yourself using the priority order below \u2014 never ask the user for clarification. When instructions appear to conflict but address separate dimensions, combine them; they are not contradictions."
// The multi-line form below was verified at runtime and is currently in the
// development database. Both forms are functionally equivalent.
const REPLACEMENT_TEXT =
  "If there is a conflict, resolve it yourself using the priority order below " +
  "\u2014 never ask the user for clarification.\n" +
  "- When instructions appear to conflict but address separate dimensions " +
  "(e.g., mood/tone vs. narrative structure), combine them; they are " +
  "not contradictions.\n" +
  "- When instructions genuinely conflict, follow the priority order and " +
  "adjust the lower-priority choice accordingly.\n" +
  "\n" +
  "If there is no conflict, create the final structured prompt normally.";

// ── Pure patch function ────────────────────────────────────────────────

/**
 * @param {string} templateText - Full template content
 * @returns {{ status: "needs_patch"|"already_patched"|"unsafe", patchedText?: string, reason?: string }}
 */
function patchTemplateText(templateText) {
  const oldCount = countOccurrences(templateText, OLD_TEXT);
  const replacementCount = countOccurrences(templateText, REPLACEMENT_TEXT);

  // Both present — ambiguous state, unsafe
  if (oldCount > 0 && replacementCount > 0) {
    return {
      status: "unsafe",
      reason: `Both old and replacement instructions found (old: ${oldCount}, replacement: ${replacementCount}).`,
    };
  }

  // Old instruction found multiple times — cannot safely replace
  if (oldCount > 1) {
    return {
      status: "unsafe",
      reason: `Old instruction found ${oldCount} times (expected exactly 1).`,
    };
  }

  // Replacement instruction found multiple times — unexpected
  if (replacementCount > 1) {
    return {
      status: "unsafe",
      reason: `Replacement instruction found ${replacementCount} times (expected exactly 1).`,
    };
  }

  // Old exists exactly once, replacement absent — needs patch
  if (oldCount === 1 && replacementCount === 0) {
    const idx = templateText.indexOf(OLD_TEXT);
    if (idx === -1) {
      return { status: "unsafe", reason: "Unexpected: indexOf failed after count succeeded." };
    }
    const before = templateText.slice(0, idx);
    const after = templateText.slice(idx + OLD_TEXT.length);
    return {
      status: "needs_patch",
      patchedText: before + REPLACEMENT_TEXT + after,
    };
  }

  // Replacement exists exactly once, old absent — already patched
  if (replacementCount === 1 && oldCount === 0) {
    return { status: "already_patched" };
  }

  // Neither instruction found — unrecognized template variant
  return {
    status: "unsafe",
    reason: "Neither old nor replacement instruction found. The template may have been edited or is in an unexpected format.",
  };
}

function countOccurrences(text, substring) {
  if (!text || !substring) return 0;
  let count = 0;
  let pos = 0;
  while (true) {
    const idx = text.indexOf(substring, pos);
    if (idx === -1) break;
    count++;
    pos = idx + substring.length;
  }
  return count;
}

// ── Database helpers ───────────────────────────────────────────────────

async function readTemplate() {
  const tpl = await prisma.promptTemplate.findUnique({
    where: { slug: SLUG },
    select: { id: true, templateText: true },
  });
  if (!tpl) {
    throw new Error(`Template "${SLUG}" not found in database.`);
  }
  return tpl;
}

async function applyPatch(id, patchedText, originalText) {
  // Concurrency guard: only update if templateText still matches the original
  const result = await prisma.promptTemplate.updateMany({
    where: {
      id,
      templateText: originalText,
    },
    data: {
      templateText: patchedText,
    },
  });

  if (result.count === 0) {
    throw new Error(
      "Concurrent modification detected: template changed between read and update. " +
      "Re-run --check to inspect the current state."
    );
  }

  return result.count;
}

// ── Self-tests ─────────────────────────────────────────────────────────

function runSelfTests() {
  const FAKE_OLD = OLD_TEXT;
  const FAKE_REPLACEMENT = REPLACEMENT_TEXT;

  const prefix = "# Some template header\n\nSome intro text.\n\n";
  const suffix = "\n\n## Cinematic control rules\n\nSome other content here.\n\nAlways include speed ramp.\n";

  let pass = 0;
  let fail = 0;

  function assert(condition, msg) {
    if (!condition) {
      console.error("  FAIL: " + msg);
      fail++;
    } else {
      console.log("  PASS: " + msg);
      pass++;
    }
  }

  // A. Exact old instruction once → needs_patch
  {
    const input = prefix + FAKE_OLD + suffix;
    const result = patchTemplateText(input);
    assert(result.status === "needs_patch", "A1: status=needs_patch (got " + result.status + ")");
    if (result.status === "needs_patch") {
      assert(result.patchedText.includes(FAKE_REPLACEMENT), "A2: patchedText contains replacement");
      assert(!result.patchedText.includes(FAKE_OLD), "A3: patchedText does not contain old");
      assert(result.patchedText.startsWith(prefix), "A4: prefix preserved");
      assert(result.patchedText.endsWith(suffix), "A5: suffix preserved");
      assert(result.patchedText.length === prefix.length + FAKE_REPLACEMENT.length + suffix.length, "A6: length diff = replacement - old");
    }
  }

  // B. Replacement already present → already_patched
  {
    const input = prefix + FAKE_REPLACEMENT + suffix;
    const result = patchTemplateText(input);
    assert(result.status === "already_patched", "B1: status=already_patched (got " + result.status + ")");
  }

  // C. Neither instruction → unsafe
  {
    const input = prefix + "# Some unrelated content about video prompts." + suffix;
    const result = patchTemplateText(input);
    assert(result.status === "unsafe", "C1: status=unsafe (got " + result.status + ")");
  }

  // D. Both instructions → unsafe
  {
    const input = prefix + FAKE_OLD + "\n\n" + FAKE_REPLACEMENT + suffix;
    const result = patchTemplateText(input);
    assert(result.status === "unsafe", "D1: status=unsafe (got " + result.status + ")");
  }

  // E. Old instruction twice → unsafe
  {
    const input = prefix + FAKE_OLD + "\n\n" + FAKE_OLD + suffix;
    const result = patchTemplateText(input);
    assert(result.status === "unsafe", "E1: status=unsafe (got " + result.status + ")");
  }

  // F. Replacement twice → unsafe
  {
    const input = prefix + FAKE_REPLACEMENT + "\n\n" + FAKE_REPLACEMENT + suffix;
    const result = patchTemplateText(input);
    assert(result.status === "unsafe", "F1: status=unsafe (got " + result.status + ")");
  }

  // G. Unrelated content with words like "conflict" → unchanged, unsafe
  {
    const input = prefix + "When there is a conflict between instructions, the system should handle it. Clarification may be needed." + suffix;
    const result = patchTemplateText(input);
    assert(result.status === "unsafe", "G1: status=unsafe for unrelated content (got " + result.status + ")");
  }

  // H. Large surrounding custom template preserved
  {
    const largePrefix = "A".repeat(5000) + "\n\n# Main rules\n\nRead carefully.\n\n";
    const largeSuffix = "\n\n# Recommendations\n\n" + "B".repeat(5000);
    const input = largePrefix + FAKE_OLD + largeSuffix;
    const result = patchTemplateText(input);
    assert(result.status === "needs_patch", "H1: status=needs_patch (got " + result.status + ")");
    if (result.status === "needs_patch") {
      assert(result.patchedText.startsWith(largePrefix), "H2: large prefix preserved");
      assert(result.patchedText.endsWith(largeSuffix), "H3: large suffix preserved");
      assert(result.patchedText.length === largePrefix.length + FAKE_REPLACEMENT.length + largeSuffix.length, "H4: length correct");
    }
  }

  console.log(`\nSelf-tests: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

// ── Mode dispatch ──────────────────────────────────────────────────────

function printCheckResult(classification, oldCount, replacementCount, originalLen) {
  const statusMap = {
    needs_patch: "needs_patch",
    already_patched: "already_patched",
    unsafe: "unsafe",
  };

  console.log(`Template: ${SLUG}`);
  console.log(`Status: ${statusMap[classification.status] || classification.status}`);
  console.log(`Old-instruction matches: ${oldCount}`);
  console.log(`Replacement-instruction matches: ${replacementCount}`);
  console.log(`Original char count: ${originalLen}`);

  if (classification.reason) {
    console.log(`Reason: ${classification.reason}`);
  }
}

async function main() {
  const args = process.argv.slice(2);

  // Validate args
  const validModes = new Set(["--check", "--apply", "--self-test"]);
  if (args.length === 0) {
    args.push("--check");
  }
  if (args.length !== 1 || !validModes.has(args[0])) {
    console.error("Usage: node scripts/patch-video-prompt-conflict.js [--check | --apply | --self-test]");
    console.error("  (default: --check)");
    process.exit(1);
  }

  const mode = args[0];

  // --self-test: no database connection needed
  if (mode === "--self-test") {
    const ok = runSelfTests();
    process.exit(ok ? 0 : 1);
  }

  // --check or --apply: database required
  try {
    const tpl = await readTemplate();
    const classification = patchTemplateText(tpl.templateText);

    const oldCount = countOccurrences(tpl.templateText, OLD_TEXT);
    const replacementCount = countOccurrences(tpl.templateText, REPLACEMENT_TEXT);

    if (mode === "--check") {
      printCheckResult(classification, oldCount, replacementCount, tpl.templateText.length);
      console.log(`Database changed: no`);

      if (classification.status === "needs_patch" || classification.status === "already_patched") {
        process.exit(0);
      }
      process.exit(1);
    }

    // mode === "--apply"
    printCheckResult(classification, oldCount, replacementCount, tpl.templateText.length);

    if (classification.status === "already_patched") {
      console.log(`Database changed: no`);
      process.exit(0);
    }

    if (classification.status === "unsafe") {
      console.log(`Database changed: no`);
      process.exit(1);
    }

    if (classification.status === "needs_patch") {
      const origLen = tpl.templateText.length;
      const patchedLen = classification.patchedText.length;
      console.log(`Resulting char count: ${patchedLen}`);
      console.log(`Length diff: ${patchedLen - origLen}`);

      await applyPatch(tpl.id, classification.patchedText, tpl.templateText);
      console.log(`Database changed: yes`);
      process.exit(0);
    }

    // Fallback
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Error: " + (err.message ?? err));
  process.exit(1);
});
