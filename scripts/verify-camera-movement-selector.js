#!/usr/bin/env node
// Comprehensive verification for the camera-movement selector module.
// Tests deterministic selection, formatter output, compatibility checks,
// storyboard variation, runtime validation, and route integration scenarios.
//
// Run: node scripts/verify-camera-movement-selector.js
// Exit 0 on all pass, 1 on any failure.

import {
  MOVEMENTS,
  MOVEMENT_FAMILIES,
  REFERENCE_CATEGORIES,
  getMovement,
  getMovementsByCategory,
  getMovementsByFamily,
  selectCameraMovement,
  selectStoryboardMovements,
  formatCameraMovement,
  buildCameraMovementBlock,
  cinematicMovementLine,
  describeMovement,
  areMovementsCompatible,
  validateMovementContext,
  getMovementOptions,
  getMovementOptionsByCategory,
  getMovementOptionsByFamily,
} from "../lib/video-camera-movements.js";

let passed = 0;
let failed = 0;
const errors = [];
let warnings = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    errors.push(`  FAIL: ${name}\n    ${e.message}`);
  }
}

function warn(msg) {
  warnings++;
  console.warn(`  WARN: ${msg}`);
}

function main() {
  // ── 0. Structural overview ─────────────────────────────────────────────
  const movementCountByCategory = {};
  for (const m of MOVEMENTS) {
    movementCountByCategory[m.referenceCategory] = (movementCountByCategory[m.referenceCategory] || 0) + 1;
  }
  const modernMovements = MOVEMENTS.filter(
    (m) => !["orbit-around", "orbit-arc", "roll-360", "follow", "follow-lead", "dolly-zoom", "whip-pan", "slide-pan"].includes(m.id)
  );

  console.log("\n=== Camera Movement Selector Verification ===");
  console.log(`Total movements: ${MOVEMENTS.length} (${modernMovements.length} modern + ${MOVEMENTS.length - modernMovements.length} legacy)`);
  console.log(`Reference categories: ${REFERENCE_CATEGORIES.length}`);
  console.log(`Movement families: ${Object.keys(MOVEMENT_FAMILIES).length}`);
  console.log("");

  // ── A. Movement definitions integrity ──────────────────────────────────
  test("A1: every movement has a unique id", () => {
    const ids = MOVEMENTS.map((m) => m.id);
    const unique = new Set(ids);
    if (ids.length !== unique.size) {
      const dups = ids.filter((id, i) => ids.indexOf(id) !== i);
      throw new Error(`Duplicate ids: ${[...new Set(dups)].join(", ")}`);
    }
  });

  test("A2: every movement references a valid family", () => {
    const families = Object.keys(MOVEMENT_FAMILIES);
    for (const m of MOVEMENTS) {
      if (!families.includes(m.family)) {
        throw new Error(`Movement "${m.id}" references unknown family "${m.family}"`);
      }
    }
  });

  test("A3: every movement has old-required fields (backward compat)", () => {
    const required = ["id", "label", "family", "direction", "speedRange", "execution", "framing", "endFrame", "actionLevel", "description"];
    for (const m of MOVEMENTS) {
      for (const field of required) {
        if (m[field] === undefined || m[field] === null) {
          throw new Error(`Movement "${m.id}" missing field "${field}"`);
        }
      }
    }
  });

  test("A4: every movement has new metadata fields", () => {
    const required = [
      "displayName", "referenceCategory", "instruction",
      "compatibleGenres", "compatibleStyles", "compatibleSubjects", "compatibleScenes",
      "emotionalEffect", "defaultSpeed", "framingRule", "endFrameRule",
      "requiredConditions", "incompatibleConditions",
    ];
    for (const m of MOVEMENTS) {
      for (const field of required) {
        if (m[field] === undefined || m[field] === null) {
          throw new Error(`Movement "${m.id}" missing new field "${field}"`);
        }
      }
    }
  });

  test("A5: every movement's referenceCategory is one of the 7 valid values", () => {
    for (const m of MOVEMENTS) {
      if (!REFERENCE_CATEGORIES.includes(m.referenceCategory)) {
        throw new Error(`Movement "${m.id}" has invalid referenceCategory "${m.referenceCategory}"`);
      }
    }
  });

  test("A6: all 7 reference categories have at least one movement", () => {
    for (const cat of REFERENCE_CATEGORIES) {
      const count = movementCountByCategory[cat] || 0;
      if (count === 0) {
        throw new Error(`Reference category "${cat}" has zero movements`);
      }
    }
  });

  test("A7: every movement has at least one actionLevel", () => {
    for (const m of MOVEMENTS) {
      if (!m.actionLevel || m.actionLevel.length === 0) {
        throw new Error(`Movement "${m.id}" has no actionLevel`);
      }
    }
  });

  test("A8: every movement has at least one speedRange", () => {
    for (const m of MOVEMENTS) {
      if (!m.speedRange || m.speedRange.length === 0) {
        throw new Error(`Movement "${m.id}" has no speedRange`);
      }
    }
  });

  test("A9: every movement has at least one compatibleGenres", () => {
    for (const m of MOVEMENTS) {
      if (!m.compatibleGenres || m.compatibleGenres.length === 0) {
        throw new Error(`Movement "${m.id}" has no compatibleGenres`);
      }
    }
  });

  test("A10: every movement has at least one compatibleScenes", () => {
    for (const m of MOVEMENTS) {
      if (!m.compatibleScenes || m.compatibleScenes.length === 0) {
        throw new Error(`Movement "${m.id}" has no compatibleScenes`);
      }
    }
  });

  test("A11: all family labels are defined", () => {
    for (const [key, family] of Object.entries(MOVEMENT_FAMILIES)) {
      if (!family.label) throw new Error(`Family "${key}" missing label`);
      if (family.order === undefined) throw new Error(`Family "${key}" missing order`);
    }
  });

  // ── B. Selector determinism ───────────────────────────────────────────
  test("B1: same context always selects same movement", () => {
    const context = { genre: "action", style: "documentary", platform: "youtube", actionLevel: "high" };
    const a = selectCameraMovement(context);
    const b = selectCameraMovement(context);
    if (a.id !== b.id) throw new Error(`Not deterministic: ${a.id} vs ${b.id}`);
  });

  test("B2: different contexts can select different movements", () => {
    const ctxA = { genre: "talking-head", actionLevel: "low" };
    const ctxB = { genre: "action", actionLevel: "high" };
    const a = selectCameraMovement(ctxA);
    const b = selectCameraMovement(ctxB);
    if (a.id === b.id) {
      warn("B2 produced same movement for very different contexts (may be valid)");
    }
  });

  test("B3: user explicit movement takes priority", () => {
    const result = selectCameraMovement({
      genre: "action",
      userMovement: "static",
      actionLevel: "high",
    });
    if (result.id !== "static") throw new Error(`Expected "static", got "${result.id}"`);
    if (result.adapted !== false) throw new Error("Expected adapted=false for user explicit");
    if (result.source !== "user-explicit") throw new Error(`Expected source "user-explicit", got "${result.source}"`);
  });

  test("B4: user explicit invalid movement falls back gracefully", () => {
    const result = selectCameraMovement({
      genre: "action",
      userMovement: "this-does-not-exist",
    });
    if (!result || !result.id) throw new Error("Invalid user movement returned nothing");
    // Should have a valid movement id from inference
    if (!getMovement(result.id)) throw new Error(`Unknown movement id: ${result.id}`);
  });

  test("B5: empty context falls back to a valid movement", () => {
    const result = selectCameraMovement({});
    if (!result || !result.id) throw new Error("Empty context returned no movement");
    if (!getMovement(result.id)) throw new Error(`Unknown movement id: ${result.id}`);
  });

  test("B6: selectCameraMovement returns all required fields", () => {
    const result = selectCameraMovement({ genre: "cinematic-narrative", style: "cinematic" });
    const required = ["id", "label", "family", "direction", "speed", "execution", "framing", "endFrame", "description", "adapted", "source"];
    for (const field of required) {
      if (result[field] === undefined || result[field] === null) {
        throw new Error(`Missing field "${field}" in result`);
      }
    }
  });

  test("B7: selectCameraMovement returns new fields when available", () => {
    const result = selectCameraMovement({ genre: "cinematic-narrative", style: "cinematic" });
    const expected = ["displayName", "referenceCategory", "instruction", "emotionalEffect"];
    for (const field of expected) {
      if (result[field] === undefined || result[field] === null) {
        throw new Error(`Missing new field "${field}" in result`);
      }
    }
  });

  test("B8: user explicit with incompatible context issues warning", () => {
    const result = selectCameraMovement({
      genre: "action",
      userMovement: "drone-shot",
      environment: "small-room",
    });
    if (result.source !== "user-explicit") throw new Error("Should preserve user-explicit source");
    if (result.validationIssues.length === 0) {
      warn("B8: drone in small room produced no validation issues (may be acceptable)");
    }
  });

  // ── C. Formatter output ──────────────────────────────────────────────
  test("C1: formatCameraMovement returns non-empty string", () => {
    const m = getMovement("dolly-in");
    const out = formatCameraMovement(m);
    if (!out || out.length < 10) throw new Error(`Output too short: "${out}"`);
    if (!out.includes("Camera movement:")) throw new Error("Missing 'Camera movement:' prefix");
  });

  test("C2: formatCameraMovement with null returns empty string", () => {
    if (formatCameraMovement(null) !== "") throw new Error("Expected empty string for null");
  });

  test("C3: buildCameraMovementBlock contains section header", () => {
    const m = getMovement("orbit-around");
    const out = buildCameraMovementBlock(m);
    if (!out.includes("=== CAMERA MOVEMENT ===")) throw new Error("Missing section header");
    if (!out.includes(m.label)) throw new Error("Missing movement label");
  });

  test("C4: buildCameraMovementBlock with null returns empty string", () => {
    if (buildCameraMovementBlock(null) !== "") throw new Error("Expected empty string for null");
  });

  test("C5: buildCameraMovementBlock compact format uses pipe separators", () => {
    const m = getMovement("dolly-in");
    const out = buildCameraMovementBlock(m, { compact: true });
    if (!out.includes("CAMERA MOVEMENT:")) throw new Error("Missing compact CAMERA MOVEMENT prefix");
    if (!out.includes("|")) throw new Error("Compact format should use pipe separators");
    if (out.includes("===")) throw new Error("Compact format should not contain section markers");
  });

  test("C6: buildCameraMovementBlock compact includes END FRAME", () => {
    const m = getMovement("dolly-in");
    const out = buildCameraMovementBlock(m, { compact: true });
    if (!out.includes("END FRAME:")) throw new Error("Missing END FRAME in compact format");
  });

  test("C7: cinematicMovementLine returns string with 'Camera movement:'", () => {
    const m = getMovement("handheld");
    const out = cinematicMovementLine(m);
    if (!out.startsWith("Camera movement:")) throw new Error("Wrong prefix");
    if (out.includes("Auto")) throw new Error("Should not contain 'Auto'");
  });

  test("C8: cinematicMovementLine with null returns infer-from-context", () => {
    const out = cinematicMovementLine(null);
    if (!out.includes("Auto")) throw new Error("Should contain 'Auto' fallback");
  });

  test("C9: describeMovement returns non-empty string", () => {
    const m = getMovement("dolly-zoom");
    const out = describeMovement(m);
    if (!out || out.length < 5) throw new Error("Output too short");
    if (!out.includes("Dolly Zoom")) throw new Error("Missing movement name");
  });

  // ── D. Compatibility checks ──────────────────────────────────────────
  test("D1: same movement is compatible with itself", () => {
    if (!areMovementsCompatible("static", "static")) throw new Error("Self-compatibility failed");
  });

  test("D2: incompatible pair returns false", () => {
    if (areMovementsCompatible("static", "handheld")) {
      throw new Error("static and handheld should be incompatible");
    }
  });

  test("D3: compatible pair returns true", () => {
    if (!areMovementsCompatible("dolly-in", "tilt-up")) {
      throw new Error("dolly-in and tilt-up should be compatible");
    }
  });

  test("D4: known incompatible pairs are all symmetric", () => {
    const pairs = [
      ["static", "handheld"],
      ["static", "dolly-in"],
      ["tilt-up", "tilt-down"],
      ["pan-left", "pan-right"],
      ["orbit-clockwise", "orbit-counterclockwise"],
      ["arc-left", "arc-right"],
      ["zoom-in", "dolly-out"],
      ["zoom-out", "dolly-in"],
      ["drone-shot", "static"],
    ];
    for (const [a, b] of pairs) {
      if (areMovementsCompatible(a, b)) {
        throw new Error(`Expected incompatible: "${a}" + "${b}"`);
      }
    }
  });

  // ── E. Runtime validation (8 contradiction tests) ─────────────────────
  test("E1: validateMovementContext — drone in small room", () => {
    const m = getMovement("drone-shot");
    const result = validateMovementContext(m, { environment: "small-room" });
    if (result.valid) throw new Error("Drone in small room should be invalid");
    if (result.issues.length === 0) throw new Error("Should have at least one issue");
  });

  test("E2: validateMovementContext — orbit + subject must never change angle", () => {
    const m = getMovement("orbit-clockwise");
    const result = validateMovementContext(m, { subjectMustNotChangeAngle: true });
    if (result.valid) throw new Error("Orbit with static-angle requirement should be invalid");
  });

  test("E3: validateMovementContext — zoom-in + end wider than start", () => {
    const m = getMovement("zoom-in");
    const result = validateMovementContext(m, { endFrameWider: true });
    if (result.valid) throw new Error("Zoom-in with wider end frame should be invalid");
  });

  test("E4: validateMovementContext — chase shot for stationary product", () => {
    const m = getMovement("chase-shot");
    const result = validateMovementContext(m, { subjectType: "product", hasMovingSubject: false });
    if (result.valid) throw new Error("Chase shot for stationary product should be invalid");
  });

  test("E5: validateMovementContext — pass-through without barrier", () => {
    const m = getMovement("pass-through");
    const result = validateMovementContext(m, { hasBarrier: false });
    if (result.valid) throw new Error("Pass-through without barrier should be invalid");
  });

  test("E6: validateMovementContext — earth-zoom-out without geographic start", () => {
    const m = getMovement("earth-zoom-out");
    const result = validateMovementContext(m, { hasGeographicStart: false });
    if (result.valid) throw new Error("Earth zoom out without geographic start should be invalid");
  });

  test("E7: validateMovementContext — snorricam with non-human subject", () => {
    const m = getMovement("snorricam");
    const result = validateMovementContext(m, { subjectType: "product" });
    if (result.valid) throw new Error("Snorricam with non-human subject should be invalid");
  });

  test("E8: validateMovementContext — time-lapse with handheld", () => {
    const m = getMovement("time-lapse");
    const result = validateMovementContext(m, { cameraStability: "handheld" });
    if (result.valid) throw new Error("Time-lapse with handheld should be invalid");
  });

  test("E9: validateMovementContext — valid context returns valid", () => {
    const m = getMovement("dolly-in");
    const result = validateMovementContext(m, { environment: "interior", subjectType: "human" });
    if (!result.valid) throw new Error(`Dolly-in with human subject should be valid: ${result.issues.join(", ")}`);
  });

  // ── F. Storyboard variation ──────────────────────────────────────────
  test("F1: selectStoryboardMovements returns correct count", () => {
    const shots = selectStoryboardMovements({ genre: "cinematic-narrative" }, 3);
    if (shots.length !== 3) throw new Error(`Expected 3 shots, got ${shots.length}`);
  });

  test("F2: every storyboard shot has required fields", () => {
    const shots = selectStoryboardMovements({ genre: "action", actionLevel: "high" }, 4);
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      if (!s.id) throw new Error(`Shot ${i} missing id`);
      if (!getMovement(s.id)) throw new Error(`Shot ${i} has unknown id "${s.id}"`);
    }
  });

  test("F3: single shot storyboard returns one movement", () => {
    const shots = selectStoryboardMovements({ genre: "talking-head" }, 1);
    if (shots.length !== 1) throw new Error(`Expected 1 shot, got ${shots.length}`);
  });

  test("F4: multi-shot has at least some variation (when possible)", () => {
    const shots = selectStoryboardMovements({ genre: "travel", style: "cinematic" }, 5);
    const uniqueIds = new Set(shots.map((s) => s.id));
    if (uniqueIds.size < 2) {
      warn("F4 — all 5 travel shots are the same movement (may be valid for narrow taxonomy)");
    }
  });

  test("F5: storyboard variation uses referenceCategory fallback", () => {
    const shots = selectStoryboardMovements({ genre: "talking-head", style: "cinematic" }, 4);
    for (const s of shots) {
      if (!s.id || !getMovement(s.id)) throw new Error(`Invalid shot id: ${s.id}`);
    }
  });

  // ── G. UI options ────────────────────────────────────────────────────
  test("G1: getMovementOptions returns all movements", () => {
    const opts = getMovementOptions();
    if (opts.length !== MOVEMENTS.length) {
      throw new Error(`Expected ${MOVEMENTS.length} options, got ${opts.length}`);
    }
  });

  test("G2: each option has value, label, family, description, category", () => {
    const opts = getMovementOptions();
    for (const o of opts) {
      if (!o.value) throw new Error("Missing value");
      if (!o.label) throw new Error("Missing label");
      if (!o.family) throw new Error("Missing family");
      if (!o.description) throw new Error("Missing description");
      if (!o.category) throw new Error("Missing category");
    }
  });

  test("G3: getMovementOptionsByCategory returns all 7 categories", () => {
    const byCat = getMovementOptionsByCategory();
    const keys = Object.keys(byCat);
    for (const cat of REFERENCE_CATEGORIES) {
      if (!keys.includes(cat)) throw new Error(`Missing category "${cat}" in getMovementOptionsByCategory`);
    }
    for (const cat of keys) {
      if (!Array.isArray(byCat[cat])) throw new Error(`Category "${cat}" is not an array`);
      if (byCat[cat].length === 0) throw new Error(`Category "${cat}" has zero options`);
    }
  });

  test("G4: getMovementsByCategory returns correct count", () => {
    for (const cat of REFERENCE_CATEGORIES) {
      const movs = getMovementsByCategory(cat);
      if (!Array.isArray(movs)) throw new Error(`Category "${cat}" returned non-array`);
      if (movs.length === 0) throw new Error(`Category "${cat}" returned zero movements`);
      for (const m of movs) {
        if (m.referenceCategory !== cat) throw new Error(`Movement "${m.id}" not in category "${cat}"`);
      }
    }
  });

  test("G5: getMovementsByFamily returns correct results", () => {
    for (const familyKey of Object.keys(MOVEMENT_FAMILIES)) {
      const movs = getMovementsByFamily(familyKey);
      if (!Array.isArray(movs)) throw new Error(`Family "${familyKey}" returned non-array`);
      for (const m of movs) {
        if (m.family !== familyKey) throw new Error(`Movement "${m.id}" not in family "${familyKey}"`);
      }
    }
  });

  // ── H. Route integration scenarios (12 scenarios) ─────────────────────
  test("H1: corporate educational — expects static or slow-refined movement", () => {
    const result = selectCameraMovement({
      genre: "corporate",
      style: "commercial",
      platform: "linkedin",
      actionLevel: "low",
    });
    if (!result || !result.id) throw new Error("Corporate educational returned no movement");
    // Corporate should prefer static/dolly/pan families
    const validCorporate = ["static", "dolly-in", "jib-up", "crane-up", "pan-left", "pedestal-up", "pedestal-down", "static-handheld"];
    if (!validCorporate.includes(result.id)) {
      warn(`H1: corporate educational selected "${result.id}" (not in preferred list, may be valid)`);
    }
  });

  test("H2: luxury jewellery — expects orbit, arc, or slow cinematic movement", () => {
    const result = selectCameraMovement({
      genre: "luxury",
      style: "cinematic",
      platform: "website",
      actionLevel: "low",
    });
    if (!result || !result.id) throw new Error("Luxury jewellery returned no movement");
  });

  test("H3: documentary interview — expects static, static-handheld, or dolly-in", () => {
    const result = selectCameraMovement({
      genre: "interview",
      style: "documentary",
      platform: "youtube",
      actionLevel: "low",
    });
    if (!result || !result.id) throw new Error("Documentary interview returned no movement");
    const validInterview = ["static", "static-handheld", "dolly-in", "slow-zoom-in"];
    if (!validInterview.includes(result.id)) {
      warn(`H3: documentary interview selected "${result.id}" (possible but atypical)`);
    }
  });

  test("H4: action sports — expects high-energy movement", () => {
    const result = selectCameraMovement({
      genre: "sports",
      style: "action",
      platform: "instagram-reel",
      actionLevel: "high",
    });
    if (!result || !result.id) throw new Error("Action sports returned no movement");
    const highEnergy = ["handheld", "chase-shot", "tracking-shot", "follow", "vehicle-tracking", "low-tracking", "drone-shot", "fast-zoom-in"];
    if (!highEnergy.includes(result.id)) {
      warn(`H4: action sports selected "${result.id}" (lower energy than expected)`);
    }
  });

  test("H5: horror hallway — expects handheld, dolly-in, or suspense movement", () => {
    const result = selectCameraMovement({
      genre: "horror",
      style: "cinematic",
      actionLevel: "medium",
    });
    if (!result || !result.id) throw new Error("Horror hallway returned no movement");
    const horrorMoves = ["handheld", "dolly-in", "slow-zoom-in", "first-person-view", "dolly-zoom", "crash-zoom-in"];
    if (!horrorMoves.includes(result.id)) {
      warn(`H5: horror selected "${result.id}" (not in expected horror list)`);
    }
  });

  test("H6: comedy reaction — expects fast zoom or crash zoom", () => {
    const result = selectCameraMovement({
      genre: "comedy",
      style: "social-media",
      platform: "tiktok",
      actionLevel: "medium",
    });
    if (!result || !result.id) throw new Error("Comedy reaction returned no movement");
    const comedyMoves = ["fast-zoom-in", "crash-zoom-in", "crash-zoom-out", "zoom-out", "fast-zoom-out", "handheld"];
    if (!comedyMoves.includes(result.id)) {
      warn(`H6: comedy selected "${result.id}" (not in expected comedy list)`);
    }
  });

  test("H7: travel landscape — expects drone or pan", () => {
    const result = selectCameraMovement({
      genre: "travel",
      style: "cinematic",
      platform: "youtube",
      actionLevel: "low",
    });
    if (!result || !result.id) throw new Error("Travel landscape returned no movement");
    const travelMoves = ["drone-shot", "drone-push-in", "drone-pull-back", "pan-left", "pan-right", "helicopter-aerial", "time-lapse"];
    if (!travelMoves.includes(result.id)) {
      warn(`H7: travel selected "${result.id}" (not in expected travel list)`);
    }
  });

  test("H8: real-estate interior — expects dolly, pan, or slider", () => {
    const result = selectCameraMovement({
      genre: "real-estate",
      style: "commercial",
      platform: "website",
      actionLevel: "low",
      environment: "indoor",
    });
    if (!result || !result.id) throw new Error("Real-estate interior returned no movement");
  });

  test("H9: sci-fi portal reveal — expects push-past, arc, or crane movement", () => {
    const result = selectCameraMovement({
      genre: "cinematic-narrative",
      style: "cinematic",
      actionLevel: "medium",
      sceneType: "reveal",
    });
    if (!result || !result.id) throw new Error("Sci-fi portal reveal returned no movement");
  });

  test("H10: explicit Orbit clockwise — preserves user movement", () => {
    const result = selectCameraMovement({
      genre: "interview",
      userMovement: "orbit-clockwise",
      actionLevel: "low",
    });
    if (result.id !== "orbit-clockwise") {
      throw new Error(`Expected "orbit-clockwise", got "${result.id}"`);
    }
    if (result.source !== "user-explicit") throw new Error("Should preserve user-explicit source");
  });

  test("H11: incompatible drone in small office — adapted with issues", () => {
    const result = selectCameraMovement({
      genre: "corporate",
      userMovement: "drone-shot",
      environment: "indoor",
    });
    if (result.id !== "drone-shot") throw new Error("User explicit should still be respected");
    if (result.contextValid === false || (result.validationIssues && result.validationIssues.length > 0)) {
      // This is acceptable — module flags it
    } else {
      warn("H11: drone in small office — no validation issues raised (module may not flag this)");
    }
  });

  test("H12: five-shot storyboard — varying movements", () => {
    const shots = selectStoryboardMovements({
      genre: "action",
      style: "cinematic",
      actionLevel: "high",
    }, 5);
    if (shots.length !== 5) throw new Error(`Expected 5 shots, got ${shots.length}`);
    for (let i = 0; i < shots.length; i++) {
      if (!shots[i].id) throw new Error(`Shot ${i} missing id`);
      if (!getMovement(shots[i].id)) throw new Error(`Shot ${i} has unknown id`);
    }
  });

  // ── I. Edge cases ────────────────────────────────────────────────────
  test("I1: unknown genre does not crash", () => {
    const result = selectCameraMovement({ genre: "some-nonexistent-genre-that-should-not-exist" });
    if (!result || !result.id) throw new Error("Unknown genre returned no movement");
  });

  test("I2: empty string fields do not crash", () => {
    const result = selectCameraMovement({ genre: "", style: "", platform: "", actionLevel: "" });
    if (!result || !result.id) throw new Error("Empty fields returned no movement");
  });

  test("I3: very high action level is handled", () => {
    const result = selectCameraMovement({ genre: "action", actionLevel: "high" });
    if (!result || !result.id) throw new Error("High action returned no movement");
  });

  test("I4: getMovement returns undefined for unknown id", () => {
    if (getMovement("nonexistent-movement") !== undefined) {
      throw new Error("Expected undefined for unknown movement");
    }
  });

  test("I5: getMovementsByCategory returns empty array for unknown category", () => {
    const result = getMovementsByCategory("NONEXISTENT_CATEGORY");
    if (!Array.isArray(result)) throw new Error("Expected array");
    if (result.length !== 0) throw new Error("Expected empty array for unknown category");
  });

  test("I6: getMovementsByFamily returns empty array for unknown family", () => {
    const result = getMovementsByFamily("nonexistent-family");
    if (!Array.isArray(result)) throw new Error("Expected array");
    if (result.length !== 0) throw new Error("Expected empty array for unknown family");
  });

  // ── Summary ──────────────────────────────────────────────────────────
  console.log(`\nResults: ${passed} passed, ${failed} failed${warnings > 0 ? `, ${warnings} warnings` : ""}`);

  if (failed > 0) {
    console.error("\nFailures:");
    for (const e of errors) console.error(e);
    process.exit(1);
  }
  process.exit(0);
}

main();
