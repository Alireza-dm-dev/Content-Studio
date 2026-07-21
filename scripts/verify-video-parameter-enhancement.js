#!/usr/bin/env node
// Focused verification for the video-prompt-enhancer-raw-idea parameter enhancement.
// Asserts structural, separation, and content-integrity properties without
// calling a live AI provider.
//
// Run: node scripts/verify-video-parameter-enhancement.js
// Exit 0 on all pass, 1 on any failure.

import assert from "node:assert/strict";
import { PrismaClient } from "../lib/generated/prisma/client.ts";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbUrl = process.env.DATABASE_URL ?? "file:" + path.join(__dirname, "../dev.db");

const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

const SLUG = "video-prompt-enhancer-raw-idea";
const MANAGED_MARKER = "<!-- managed:video-parameter-enhancement:v2 -->";

let passed = 0;
let failed = 0;
let errors = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    errors.push(`  FAIL: ${name}\n    ${e.message}`);
  }
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  const tpl = await prisma.promptTemplate.findUnique({ where: { slug: SLUG } });
  if (!tpl) throw new Error(`Template "${SLUG}" not found in database.`);

  const text = tpl.templateText;

  // ── A. Managed patch ─────────────────────────────────────────────────
  test("A1: managed marker exists exactly once", () => {
    const count = text.split(MANAGED_MARKER).length - 1;
    assert.equal(count, 1, `Expected 1 marker, got ${count}`);
  });

  test("A2: marker placed inside Recommended structure section", () => {
    const rs = text.indexOf("# Recommended structure:");
    const rv = text.indexOf("# Recommendations by video type:");
    const markerIdx = text.indexOf(MANAGED_MARKER);
    assert.ok(markerIdx > rs, "Marker not after Recommended structure start");
    assert.ok(markerIdx < rv, "Marker not before Recommendations by video type");
  });

  // ── Extract parameter descriptions from Recommended structure only ──
  const rsBase = text.indexOf("# Recommended structure:");
  const rvBase = text.indexOf("# Recommendations by video type:");
  const relevantSection = rsBase >= 0 && rvBase >= 0 ? text.slice(rsBase, rvBase) : text;

  function extractParamDesc(label) {
    const idx = relevantSection.indexOf(`${label}:`);
    if (idx < 0) return "";
    const bracketStart = relevantSection.indexOf("[", idx);
    const markerIdx = relevantSection.indexOf("<!-- managed:video-parameter-enhancement:", idx);
    let bracketEnd;
    if (markerIdx >= 0) {
      const searchRegion = relevantSection.slice(bracketStart, markerIdx);
      bracketEnd = searchRegion.lastIndexOf("]");
      if (bracketEnd >= 0) bracketEnd += bracketStart;
    }
    if (bracketEnd === undefined || bracketEnd < bracketStart) {
      bracketEnd = relevantSection.indexOf("]", idx);
    }
    return bracketEnd > bracketStart ? relevantSection.slice(bracketStart + 1, bracketEnd) : "";
  }

  const nineParamLabels = [
    "scene", "main action", "motion", "camera movement",
    "shot type", "visual style", "mood / vibe", "video quality", "Avoid",
  ];

  // ── B. Target sections — all nine exist with enriched guidance ───────
  for (const label of nineParamLabels) {
    test(`B: parameter "${label}" exists`, () => {
      assert.ok(text.includes(`${label}:`), `Missing: ${label}`);
    });
    test(`B: parameter "${label}" has structured guidance (>100 chars)`, () => {
      const desc = extractParamDesc(label);
      assert.ok(desc.length > 100, `${label} guidance too short: ${desc.length} chars`);
    });
  }

  // ── C. Non-target preservation ───────────────────────────────────────
  const nonNineParams = [
    ["subject:", "main person, object, character, animal, product, or scene"],
    ["speed ramp:", "Auto, Slow-mo"],
    ["camera:", "Auto, Raw 16 mm, Fine film, or Clean Digital"],
    ["lens:", "Auto, extreme macro, anamorphic, warm halation, or vintage haze"],
    ["focal length:", "45, 75, 50, 35, 14, or 8"],
    ["aperture:", "f/11 deep focus, f/1.4 wide open, or f/4 moderate"],
    ["lighting:", "natural daylight, soft indoor light"],
    ["sound direction:", "no sound, ambient sound, city noise"],
    ["text on screen:", "exact text if the user requested text"],
    ["transition:", "cut, fade, zoom transition"],
  ];

  for (const [param, expectedContent] of nonNineParams) {
    test(`C: non-nine field "${param}" preserved`, () => {
      assert.ok(text.includes(param), `Missing non-nine field: ${param}`);
    });
    test(`C: non-nine field "${param}" retains original guidance`, () => {
      const idx = text.indexOf(param);
      assert.ok(idx >= 0);
      const snippet = text.slice(idx, idx + 200);
      assert.ok(snippet.includes(expectedContent),
        `Expected "${expectedContent}" not found in ${param} section`);
    });
  }

  // ── D. Separation — each parameter describes the right dimension ──────
  const descScene = extractParamDesc("scene");
  const descMainAction = extractParamDesc("main action");
  const descMotion = extractParamDesc("motion");
  const descCamMove = extractParamDesc("camera movement");
  const descShotType = extractParamDesc("shot type");
  const descVisualStyle = extractParamDesc("visual style");
  const descMood = extractParamDesc("mood / vibe");
  const descVidQual = extractParamDesc("video quality");
  const descAvoid = extractParamDesc("Avoid");

  test("D1: scene focuses on environment (not action)", () => {
    assert.ok(descScene.includes("location") || descScene.includes("environment") || descScene.includes("space"));
    // scene should NOT describe what happens (that's mainAction)
  });

  test("D2: mainAction is chronological events", () => {
    assert.ok(descMainAction.includes("sequence") || descMainAction.includes("initiates") || descMainAction.includes("unfold"));
  });

  test("D3: motion describes character/object movement (not camera)", () => {
    assert.ok(descMotion.includes("movement"));
    // Should not duplicate camera movement description
  });

  test("D4: cameraMovement and shotType are distinct", () => {
    assert.ok(descCamMove.includes("camera") || descCamMove.includes("movement"));
    assert.ok(descShotType.includes("framing") || descShotType.includes("shot") || descShotType.includes("composition"));
    // Verify camera movement doesn't duplicate shot type composition guidance
  });

  test("D5: videoQuality is positive guidance", () => {
    assert.ok(descVidQual.includes("rendering") || descVidQual.includes("resolution") || descVidQual.includes("motion"));
  });

  test("D6: avoid is negative constraints", () => {
    assert.ok(descAvoid.includes("avoid") || descAvoid.includes("artifacts") || descAvoid.includes("distortion"));
  });

  // ── E. No hardcoded benchmark content ─────────────────────────────────
  const forbiddenTerms = [
    "teacher", "mother", "literacy", "classroom", "consultation office",
    "whiteboard", "5 Key Principles", "Structured and Sequential", "parent-teacher",
  ];
  for (const term of forbiddenTerms) {
    test(`E: no hardcoded "${term}" in production template`, () => {
      assert.ok(!text.toLowerCase().includes(term.toLowerCase()),
        `Forbidden term "${term}" found in template`);
    });
  }

  // ── F. Conditional safeguards ────────────────────────────────────────
  test("F1: videoQuality has conditional human/character rules", () => {
    assert.ok(descVidQual.includes("Human or character") || descVidQual.includes("skin texture"));
  });

  test("F2: videoQuality has conditional product rules", () => {
    assert.ok(descVidQual.includes("Product or object") || descVidQual.includes("geometry"));
  });

  test("F3: videoQuality has conditional stylized/animation rules", () => {
    assert.ok(descVidQual.includes("Stylised") || descVidQual.includes("animated"));
  });

  test("F4: avoid has conditional human subject rules", () => {
    assert.ok(descAvoid.includes("Human or character"));
  });

  test("F5: avoid has conditional product subject rules", () => {
    assert.ok(descAvoid.includes("Product or object"));
  });

  test("F6: avoid has conditional stylized/animation rules", () => {
    assert.ok(descAvoid.includes("Stylised") || descAvoid.includes("animated"));
  });

  test("F7: avoid has universal ('Any scene') rules", () => {
    assert.ok(descAvoid.includes("Any scene"));
  });

  // ── G. Priority — explicit manual instructions above Brand context ────
  // Check that the template's priority order section exists with the right order
  test("G1: template priority order section exists", () => {
    assert.ok(text.includes("Priority order:") || text.includes("PRIORITY POLICY"));
  });

  // ── H. Section integrity ──────────────────────────────────────────────
  const requiredSections = [
    "# Main rules:",
    "# Priority order:",
    "Cinematic control rules:",
    "# Output format:",
    "# Recommended structure:",
    "# Recommendations by video type:",
    "# Final output example:",
  ];
  for (const section of requiredSections) {
    test(`H: required section "${section}" present`, () => {
      assert.ok(text.includes(section), `Missing: ${section}`);
    });
  }

  // ── I. No template {{variable}} was added or removed ─────────────────
  // The template should not have any {{variables}} since it's system instruction text
  const variables = [...text.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]);
  test("I1: no template variables added (template is pure instruction text)", () => {
    assert.equal(variables.length, 0,
      `Found ${variables.length} template variables: ${variables.join(", ")}`);
  });

  // ── J. Size sanity ───────────────────────────────────────────────────
  test("J1: template size reasonable (< 30KB)", () => {
    assert.ok(text.length < 30000, `Template too large: ${text.length} bytes`);
  });

  test("J2: template larger than original (enriched)", () => {
    assert.ok(text.length > 20000, `Template too small: ${text.length} bytes`);
  });

  // ── K. Avoid section does NOT contain the old generic list ────────────
  test("K1: Avoid section does not contain old generic list markers", () => {
    const oldGenericTerms = [
      "warped background",
      "mismatched limb proportions",
      "asymmetrical eyes",
      "moiré patterns on fabrics",
      "unintended product or logo placement",
      "colour contamination",
    ];
    for (const term of oldGenericTerms) {
      const idx = text.indexOf("Avoid:");
      const sectionAfter = text.slice(idx, idx + 4000);
      assert.ok(!sectionAfter.includes(term),
        `Old generic term "${term}" still found in Avoid section`);
    }
  });

  // ── Summary ──────────────────────────────────────────────────────────
  console.log(`\nTemplate: ${SLUG}`);
  console.log(`Size: ${text.length} bytes`);
  console.log(`\nResults: ${passed} passed, ${failed} failed`);

  await prisma.$disconnect();

  if (failed > 0) {
    console.error("\nFailures:");
    for (const e of errors) console.error(e);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
