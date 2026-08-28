// Focused tests for the unified Cinematic Style + Visual Preset resolution and
// prompt-section building used by ALL image-prompt flows.
//
// Run: node --import ./tests/setup.mjs --test tests/image-style-preset.test.mjs
//
// These assert the deterministic contract each route maps to HTTP behaviour:
//   - invalid explicit cinematic style / visual preset -> { code, 400 }
//   - auto / custom / missing selections must NOT appear as the word "Auto" in
//     the generated prompt section
//   - manual controls > visual preset > cinematic style precedence is emitted
//   - preset characteristics (not just the id) are surfaced

import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveImageStyleAndPreset,
  imageStylePresetErrorResponse,
  buildProductionControlsSection,
  CINEMATIC_STYLE_ERROR_CODE as UNSUPPORTED_CINEMATIC_STYLE,
  VISUAL_PRESET_ERROR_CODE as UNSUPPORTED_VISUAL_PRESET,
} from "@/lib/image-style-preset-resolution";

// ── 1. Auto / missing selections collapse to AI-decides (no "auto" text) ─────
test("raw-idea auto: no production section emitted", () => {
  const r = resolveImageStyleAndPreset({});
  assert.equal(r.ok, true);
  assert.equal(r.cinematicStyle, "auto");
  assert.equal(r.preset, "custom");
  const section = buildProductionControlsSection({
    manualControlsBlock: null,
    cinematicStyle: r.cinematicStyle,
    preset: r.preset,
  });
  assert.equal(section, "");
});

// ── 2. Explicit cinematic style only ────────────────────────────────────────
test("style-only: section includes resolved cinematic directions + precedence", () => {
  const r = resolveImageStyleAndPreset({ cinematicStyle: "epic-golden-hour" });
  assert.equal(r.ok, true);
  assert.equal(r.cinematicStyle, "epic-golden-hour");
  const section = buildProductionControlsSection({
    manualControlsBlock: null,
    cinematicStyle: r.cinematicStyle,
    preset: r.preset,
  });
  assert.match(section, /CINEMATIC VISUAL STYLE/);
  // resolved, expanded instructions must be present (not just the id)
  assert.match(section, /Framing|Lighting|Depth of Field|Grade|Composition/i);
  assert.match(section, /PRECEDENCE RULE/);
  assert.doesNotMatch(section, /Auto/i);
});

// ── 3. Explicit visual preset only (characteristics, not just id) ───────────
test("preset-only: section includes preset label + characteristics + expanded settings", () => {
  const r = resolveImageStyleAndPreset({ preset: "cinematic-night" });
  assert.equal(r.ok, true);
  assert.equal(r.preset, "cinematic-night");
  const section = buildProductionControlsSection({
    manualControlsBlock: null,
    cinematicStyle: r.cinematicStyle,
    preset: r.preset,
  });
  assert.match(section, /SELECTED VISUAL PRESET/);
  assert.match(section, /Cinematic Night/); // human label
  assert.match(section, /neon|moody|low-angle|nocturnal/i); // characteristics text
  assert.match(section, /Preset baseline settings/);
});

// ── 4. Both style + preset: both surface, precedence sentence present ───────
test("style + preset: both blocks present with precedence rule", () => {
  const r = resolveImageStyleAndPreset({ cinematicStyle: "neo-noir-thriller", preset: "premium-product" });
  assert.equal(r.ok, true);
  const section = buildProductionControlsSection({
    manualControlsBlock: null,
    cinematicStyle: r.cinematicStyle,
    preset: r.preset,
  });
  assert.match(section, /CINEMATIC VISUAL STYLE/);
  assert.match(section, /SELECTED VISUAL PRESET/);
  assert.match(section, /PRECEDENCE RULE/);
});

// ── 5. Invalid cinematic style -> structured 400 ────────────────────────────
test("invalid cinematic style -> 400 with UNSUPPORTED_CINEMATIC_STYLE", () => {
  const r = resolveImageStyleAndPreset({ cinematicStyle: "does-not-exist" });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, UNSUPPORTED_CINEMATIC_STYLE);
  const { body, status } = imageStylePresetErrorResponse(r.errors);
  assert.equal(status, 400);
  assert.equal(body.success, false);
  assert.equal(body.code, UNSUPPORTED_CINEMATIC_STYLE);
});

// ── 6. Invalid visual preset -> structured 400 ─────────────────────────────
test("invalid visual preset -> 400 with UNSUPPORTED_VISUAL_PRESET", () => {
  const r = resolveImageStyleAndPreset({ preset: "nope" });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, UNSUPPORTED_VISUAL_PRESET);
  const { body, status } = imageStylePresetErrorResponse(r.errors);
  assert.equal(status, 400);
  assert.equal(body.code, UNSUPPORTED_VISUAL_PRESET);
});

// ── 7. "custom" preset treated as AI-decides (no preset block) ──────────────
test("preset:'custom' is not treated as a preset block", () => {
  const r = resolveImageStyleAndPreset({ preset: "custom" });
  assert.equal(r.ok, true);
  assert.equal(r.preset, "custom");
  const section = buildProductionControlsSection({
    manualControlsBlock: null,
    cinematicStyle: "auto",
    preset: r.preset,
  });
  assert.equal(section, "");
});

// ── 8. Manual controls block is passed through as highest-priority ──────────
test("manual controls block is preserved in the section", () => {
  const manual = "SELECTED VISUAL PRODUCTION CONTROLS\n- Framing: Close-up";
  const section = buildProductionControlsSection({
    manualControlsBlock: manual,
    cinematicStyle: "auto",
    preset: "custom",
  });
  assert.match(section, /Close-up/);
  assert.match(section, /explicit manual choices/);
});

// ── 9. Precedence ordering: manual first, then preset, then style ───────────
test("precedence order in section: manual > preset > cinematic", () => {
  const manual = "SELECTED VISUAL PRODUCTION CONTROLS\n- Framing: Close-up";
  const section = buildProductionControlsSection({
    manualControlsBlock: manual,
    cinematicStyle: "neo-noir-thriller",
    preset: "cinematic-night",
  });
  const manualIdx = section.indexOf("SELECTED VISUAL PRODUCTION CONTROLS");
  const presetIdx = section.indexOf("SELECTED VISUAL PRESET");
  const styleIdx = section.indexOf("CINEMATIC VISUAL STYLE");
  assert.ok(manualIdx >= 0 && presetIdx > manualIdx && styleIdx > presetIdx,
    "manual must precede preset which must precede cinematic style");
});

// ── 10. Reference-image preserve/change notes reach the final section ───────
// The reference flow appends the user's "keep vs change" instructions into the
// same production section mechanism; assert the section can carry that text and
// is not dropped for reference mode specifically.
test("reference preserve/change note is surfaced when supplied as manual block", () => {
  const manual =
    "SELECTED VISUAL PRODUCTION CONTROLS\n" +
    "=== REFERENCE IMAGE — PRESERVE / CHANGE INSTRUCTIONS ===\n" +
    "KEEP the product bottle; CHANGE the background to a sunset";
  const section = buildProductionControlsSection({
    manualControlsBlock: manual,
    cinematicStyle: "auto",
    preset: "custom",
  });
  assert.match(section, /KEEP the product bottle/);
  assert.match(section, /CHANGE the background/);
});

// ── 11. Combined route now reads attractionNotes (source-level guard) ───────
// If this import path changes the test still passes; this only guards that the
// reference route actually wires the preserve/change notes into the prompt.
test("reference create-prompt route emits preserve/change instructions from cvd.attractionNotes", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const routePath = path.resolve(
    "app/api/image/combined-visual-direction/[id]/create-nanobanana-prompt/route.js"
  );
  const src = fs.readFileSync(routePath, "utf8");
  assert.match(src, /cvd\?\.attractionNotes/);
  assert.match(src, /PRESERVE \/ CHANGE INSTRUCTIONS/);
  assert.match(src, /buildProductionControlsSection/);
});

// ── 12. Precedence rule text explicitly forbids silent dropping ─────────────
test("precedence rule forbids silently dropping lower-priority selections", () => {
  const section = buildProductionControlsSection({
    manualControlsBlock: null,
    cinematicStyle: "epic-golden-hour",
    preset: "premium-product",
  });
  assert.match(section, /Never silently drop/);
});

// ── 13. Unknown preset string value (object form) still 400s ────────────────
test("non-string preset value -> 400", () => {
  const r = resolveImageStyleAndPreset({ preset: 123 });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, UNSUPPORTED_VISUAL_PRESET);
});

// ── 14. Valid style id survives round-trip through resolver ─────────────────
test("all known cinematic styles resolve without error", async () => {
  const { CINEMATIC_STYLE_OPTIONS } = await import("@/lib/cinematic-styles");
  for (const opt of CINEMATIC_STYLE_OPTIONS) {
    const r = resolveImageStyleAndPreset({ cinematicStyle: opt.id });
    assert.equal(r.ok, true, `style ${opt.id} should resolve`);
  }
});

// ── 15. All known presets resolve without error ─────────────────────────────
test("all known visual presets resolve without error", async () => {
  const { IMAGE_PRESETS } = await import("@/lib/image-visual-controls");
  for (const p of IMAGE_PRESETS) {
    if (p.value === "custom") continue;
    const r = resolveImageStyleAndPreset({ preset: p.value });
    assert.equal(r.ok, true, `preset ${p.value} should resolve`);
  }
});

// ── 16. Error response from style+preset both invalid aggregates errors ─────
test("multiple invalid selections aggregate into errors array", () => {
  const r = resolveImageStyleAndPreset({ cinematicStyle: "bad", preset: "bad" });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 2);
  const codes = r.errors.map((e) => e.code).sort();
  assert.deepEqual(codes, [UNSUPPORTED_CINEMATIC_STYLE, UNSUPPORTED_VISUAL_PRESET].sort());
});

// ── 17. Final section for a real flow never contains the literal "auto" ─────
test("no literal 'auto' selection leaks into the prompt section", () => {
  const r = resolveImageStyleAndPreset({ cinematicStyle: "luxury-commercial", preset: "natural-lifestyle" });
  const section = buildProductionControlsSection({
    manualControlsBlock: null,
    cinematicStyle: r.cinematicStyle,
    preset: r.preset,
  });
  assert.doesNotMatch(section, /cinematic style: auto/i);
  assert.doesNotMatch(section, /\bAuto\b/);
});
