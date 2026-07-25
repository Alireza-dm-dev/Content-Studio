#!/usr/bin/env node
// Idempotent update of the camera movement instruction inside the
// video-prompt-enhancer-raw-idea template. Replaces old "choose from: Static,
// Handheld, ..." guidance with a "do not override — system pre-selects
// deterministically" instruction.
//
// Handles two template formats:
//   1. Seed format (short, Field rules: section)
//   2. Custom format (long, ## Camera movement section)
//
// Usage:
//   node scripts/update-camera-movement-template.js --check   (exit 0 if current)
//   node scripts/update-camera-movement-template.js --apply   (apply the patch)
//   node scripts/update-camera-movement-template.js --force   (re-apply even if current)
//
// Exit 0 on success / already-patched / check-ok, 1 on failure.

import { PrismaClient } from "../lib/generated/prisma/client.ts";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbUrl = process.env.DATABASE_URL ?? "file:" + path.join(__dirname, "../dev.db");

const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

const SLUG = "video-prompt-enhancer-raw-idea";
const MANAGED_MARKER = "<!-- managed:camera-movement-deterministic:v1 -->";

// ── Old camera movement section (custom/long format) ────────────────────
// The user-authored template has a `## Camera movement` section with
// "Allowed examples:" listing 18 options.
const OLD_CAMERA_SECTION_START = "## Camera movement";
const OLD_CAMERA_SECTION_BLOCK = `## Camera movement

Always include camera movement in the final output.

Allowed examples:
Static
Handheld
Zoom Out
Zoom in
Camera follows
Pan left
Pan right
Tilt up
Tilt down
Orbit around
Dolly in
Dolly out
Jib up
Jib down
Drone shot
Dolly left
Dolly right
360 roll
Custom value when needed

Selection rule:
If the user provides camera movement, use it.
If uploaded image or visual context exists, infer the best camera movement from the visual composition and action.
If none is clear, use Auto or a simple stable movement.
If none of the listed options fits, write a short custom camera movement value.`;

// ── New camera movement section ─────────────────────────────────────────
const NEW_CAMERA_SECTION = `## Camera movement

Camera movement is pre-selected by the system's deterministic camera movement module (genre/style/scene/action-driven taxonomy). The provided camera movement value is the final resolved choice — do not override it. Use it exactly as given. The value is never "Auto" — it is always a specific, resolved movement.

Allowed values (pre-selected by the system — do not change):
Static, Static handheld, Pan left, Pan right, Whip pan left, Whip pan right, Tilt up, Tilt down, Zoom in, Zoom out, Slow zoom in, Slow zoom out, Fast zoom in, Fast zoom out, Crash zoom in, Crash zoom out, Dolly in, Dolly out, Tracking shot, Follow over-the-shoulder, Reverse tracking, Side tracking, Low tracking, Vehicle tracking, Chase shot, Truck left, Truck right, Pedestal up, Pedestal down, Slider left, Slider right, Push-past, Arc left, Arc right, Orbit clockwise, Orbit counterclockwise, Handheld, Snorricam, Crane up, Crane down, Drone shot, Drone push in, Drone pull back, Helicopter aerial, First-person view, Tilt-shift, Infinite zoom, Earth zoom out, Time-lapse, Pass-through

Selection rule:
The system selects the movement deterministically. Use the value passed in — it is already resolved. Do not override it.`;

const NEW_CAMERA_SECTION_WITH_MARKER = NEW_CAMERA_SECTION + "\n" + MANAGED_MARKER;

// ── Old camera movement instruction in seed (short) format ──────────────
// The seed format has "- Camera movement — if the input is ..." inside Field rules.
const OLD_SEED_CAMERA_LINE = `- Camera movement — if the input is "Auto" or "Auto — infer from context", choose one of: Static, Handheld, Zoom Out, Zoom in, Camera follows, Pan left, Pan right, Tilt up, Tilt down, Orbit around, Dolly in, Dolly out, Jib up, Jib down, Drone shot, Dolly left, Dolly right, 360 roll, or a short custom value that better fits the scene. Otherwise keep the given value exactly.`;

const NEW_SEED_CAMERA_LINE = `- Camera movement — the system pre-selects the camera movement deterministically based on genre, style, scene, action level, and platform. The input value is already resolved (never "Auto"). Use the exact value provided. Do not override or change it.`;

const NEW_SEED_EXTRA = `Camera movement is pre-selected by the system's deterministic camera movement module (genre/style/scene/action-driven taxonomy). The provided camera movement value is the final resolved choice — do not override it. Use it exactly as given.`;

// ── Detect current format ──────────────────────────────────────────────
function detectFormat(text) {
  if (text.includes(OLD_CAMERA_SECTION_BLOCK)) return "custom-old";
  if (text.includes(MANAGED_MARKER)) return "already-patched";
  if (text.includes("system pre-selects the camera movement deterministically")) return "new-seed";
  if (text.includes("Camera movement is pre-selected by the system")) return "new-seed-alt";
  if (text.includes(OLD_SEED_CAMERA_LINE)) return "seed-old";
  if (text.includes(OLD_CAMERA_SECTION_START)) return "custom-check";
  return "unknown";
}

// ── Patch template text ─────────────────────────────────────────────────
function patchTemplate(text) {
  const format = detectFormat(text);

  switch (format) {
    case "already-patched":
    case "new-seed":
    case "new-seed-alt":
      return { text: null, status: "already_patched" };

    case "custom-old": {
      // Replace old camera section with new one + marker
      const idx = text.indexOf(OLD_CAMERA_SECTION_BLOCK);
      const before = text.substring(0, idx);
      const after = text.substring(idx + OLD_CAMERA_SECTION_BLOCK.length);
      return { text: before + NEW_CAMERA_SECTION_WITH_MARKER + after, status: "patched" };
    }

    case "seed-old": {
      // Replace old camera line and ensure the extra paragraph exists
      let patched = text.replace(OLD_SEED_CAMERA_LINE, NEW_SEED_CAMERA_LINE);
      if (!patched.includes(NEW_SEED_EXTRA)) {
        // Add the extra paragraph after the field rules
        patched = patched.replace(
          /- Aperture —[^\n]+\n/,
          (match) => match + "\n" + NEW_SEED_EXTRA + "\n"
        );
      }
      patched += "\n" + MANAGED_MARKER;
      return { text: patched, status: "patched" };
    }

    case "custom-check": {
      // Found ## Camera movement header but content doesn't match old block exactly
      // Try a more flexible replacement
      const startIdx = text.indexOf(OLD_CAMERA_SECTION_START);
      if (startIdx === -1) return { text: null, status: "unknown" };

      // Find the next ## section header after the camera section
      const searchFrom = startIdx + OLD_CAMERA_SECTION_START.length;
      const nextSectionMatch = text.slice(searchFrom).match(/\n## /);
      const endIdx = nextSectionMatch
        ? searchFrom + nextSectionMatch.index
        : text.length;

      const before = text.substring(0, startIdx);
      const after = text.substring(endIdx);
      return {
        text: before + NEW_CAMERA_SECTION_WITH_MARKER + after,
        status: "patched_flexible",
      };
    }

    default:
      return { text: null, status: "unknown", format };
  }
}

// ── Apply with optimistic concurrency ───────────────────────────────────
async function applyPatch(id, patchedText, originalText, label) {
  const result = await prisma.promptTemplate.updateMany({
    where: { id, templateText: originalText },
    data: { templateText: patchedText },
  });
  if (result.count === 0) {
    throw new Error(
      `Concurrent modification detected: template changed between read and update.\n` +
      `Run --check to see the current state.`
    );
  }
  console.log(`  ✓ Patch applied (${label})`);
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const isCheck = args.includes("--check");
  const isApply = args.includes("--apply");
  const isForce = args.includes("--force");

  if (!isCheck && !isApply && !isForce) {
    console.error("Usage: node scripts/update-camera-movement-template.js --check|--apply [--force]");
    process.exit(1);
  }

  const template = await prisma.promptTemplate.findUnique({ where: { slug: SLUG } });
  if (!template) {
    console.error(`Template "${SLUG}" not found.`);
    process.exit(1);
  }

  const format = detectFormat(template.templateText);
  console.log(`\nTemplate: ${SLUG}`);
  console.log(`Format detected: ${format}`);

  switch (format) {
    case "already-patched":
    case "new-seed":
    case "new-seed-alt":
      if (isForce) {
        console.log("  (force mode — will re-patch)");
      } else {
        console.log("  Already up to date. Nothing to do.");
        await prisma.$disconnect();
        process.exit(0);
      }
      break;
    case "unknown":
      console.log("  Unknown format — cannot patch safely.");
      await prisma.$disconnect();
      process.exit(1);
  }

  const result = patchTemplate(template.templateText);

  if (result.status === "already_patched") {
    console.log("  Already up to date. Nothing to do.");
    await prisma.$disconnect();
    process.exit(0);
  }

  if (result.status === "unknown") {
    console.log(`  Cannot patch: unknown format "${result.format}".`);
    await prisma.$disconnect();
    process.exit(1);
  }

  if (isCheck) {
    console.log(`  Check: patch would be applied (${result.status}).`);
    await prisma.$disconnect();
    process.exit(1); // exit 1 to signal "not current"
  }

  // Apply
  try {
    await applyPatch(template.id, result.text, template.templateText, result.status);
    console.log("  Done.");
  } catch (err) {
    console.error(`  ${err.message}`);
    process.exit(1);
  }

  await prisma.$disconnect();
  process.exit(0);
}

main();
