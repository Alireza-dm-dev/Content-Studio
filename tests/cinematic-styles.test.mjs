// Pure unit tests for the shared cinematic-style resolver and the preset
// serializers. These are the functions that fix the original defect
// (a re-exported helper that was not locally bound) and the single source of
// truth for validating/resolving cinematic style presets.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CINEMATIC_STYLE_OPTIONS,
  resolveCinematicStyle,
  buildImageStyleBlock,
  buildVideoStyleBlock,
} from "@/lib/cinematic-styles";
import { normalizeVisualControls, defaultVisualControls } from "@/lib/image-visual-controls";

const SUPPORTED_IDS = CINEMATIC_STYLE_OPTIONS.filter((o) => o.value !== "auto").map((o) => o.value);

test("resolveCinematicStyle: missing/blank/auto → AI decides", () => {
  for (const v of [undefined, null, "", "   ", "auto", "Auto"]) {
    const result = resolveCinematicStyle(v);
    assert.deepEqual(result, { style: "auto" }, `for value ${JSON.stringify(v)}`);
  }
});

test("resolveCinematicStyle: supported ids pass through", () => {
  assert.ok(SUPPORTED_IDS.length >= 8, "expected the preset library to be populated");
  for (const id of SUPPORTED_IDS) {
    assert.deepEqual(resolveCinematicStyle(id), { style: id }, `for id ${id}`);
  }
});

test("resolveCinematicStyle: display labels are normalized to ids", () => {
  assert.deepEqual(resolveCinematicStyle("Anamorphic Blockbuster"), { style: "anamorphic-blockbuster" });
  assert.deepEqual(resolveCinematicStyle("Neo-Noir Thriller"), { style: "neo-noir-thriller" });
});

test("resolveCinematicStyle: unsupported non-empty value returns an error, never auto", () => {
  const result = resolveCinematicStyle("not-a-real-style");
  assert.ok(result.error, "expected an error for an unsupported preset");
  assert.ok(!result.style, "must not silently fall back to auto");
  assert.match(result.error, /Unsupported cinematic style/);
  assert.match(result.error, /not-a-real-style/);
});

test("normalizeVisualControls: safe normalization never throws and preserves valid cinematic style", () => {
  const withStyle = normalizeVisualControls({
    ...defaultVisualControls(),
    cinematicStyle: "anamorphic-blockbuster",
  });
  assert.equal(withStyle.cinematicStyle, "anamorphic-blockbuster");

  const auto = normalizeVisualControls(defaultVisualControls());
  assert.equal(auto.cinematicStyle, "auto");
});

test("buildImageStyleBlock: valid preset emits resolved production instructions, not the raw id", () => {
  const block = buildImageStyleBlock("anamorphic-blockbuster");
  assert.ok(block, "expected a non-empty style block");

  // The raw identifier must never appear as the only signal.
  assert.ok(!block.includes("anamorphic-blockbuster"), "raw id must not leak into the block");

  // Resolved characteristics must be present.
  assert.match(block, /CINEMATIC VISUAL STYLE/);
  assert.match(block, /Anamorphic Blockbuster/);
  assert.match(block, /Anamorphic prime lenses/);
  assert.match(block, /oval bokeh/);
  assert.match(block, /Widescreen theatrical framing/);
  assert.match(block, /Cinematic contrast/);
  assert.match(block, /Dimensional production lighting/);
  assert.match(block, /Fine grain/);

  // Covers the required characteristic categories.
  for (const label of [
    "Lighting",
    "Lens and optics",
    "Composition",
    "Colour grade",
    "Texture and finish",
    "Atmosphere",
    "Style constraints",
  ]) {
    assert.ok(block.includes(`${label}:`), `expected "${label}" section`);
  }
});

test("buildVideoStyleBlock: valid preset emits resolved motion/pacing instructions", () => {
  const block = buildVideoStyleBlock("anamorphic-blockbuster");
  assert.ok(block, "expected a non-empty style block");
  assert.match(block, /Motion character/);
  assert.match(block, /Pacing/);
  assert.match(block, /controlled dolly, tracking, crane, or orbit/);
  assert.match(block, /Deliberate/);
  assert.ok(!block.includes("anamorphic-blockbuster"), "raw id must not leak into the block");
});

test("buildImageStyleBlock / buildVideoStyleBlock: unknown ids return empty string", () => {
  assert.equal(buildImageStyleBlock("bogus"), "");
  assert.equal(buildVideoStyleBlock("bogus"), "");
});
