// Unit tests for the change_slide_count scope: request validation, source-slide
// extraction, prompt contract, and strict result assembly. Route behaviour is
// covered in tests/slide-count-route.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseExplicitDrops,
  validateSourceCoverage,
  SOURCE_COVERAGE_ERROR,
  MAX_SLIDE_COUNT,
  getPostSlideCount,
  validateSlideCountRequest,
  buildSlideCountChangeFields,
  extractSourceSlides,
  SLIDE_COUNT_FIELDS,
} from "../lib/calendar-slide-count.js";
import {
  SCOPE_FIELDS,
  buildChangeSlideCountUserInput,
  buildCurrentPostContextLines,
} from "../lib/calendar-regeneration-prompt.js";
import { buildLanguageInstruction } from "../lib/content-language.js";
import { parseSlideCountFromContentStructure } from "../lib/calendar-post-utils.js";

export const ROLES = ["Hook", "Problem", "Cause", "Explanation", "Benefit", "CTA"];

export function makeCarousel(n = 6) {
  const slides = Array.from({ length: n }, (_, i) => ({
    slideNumber: i + 1,
    slideRole: ROLES[i] ?? `Point ${i}`,
    fields: { main_headline: `Headline ${i + 1}`, supporting_text: `Detail for source slide ${i + 1}` },
  }));
  return {
    postNumber: 3,
    platform: "Instagram",
    format: "Carousel",
    hookTitle: "Is your CCTV recording?",
    mainAngle: "education",
    coreMessage: "A camera that looks fine can fail silently.",
    caption: "Silent failures are common.\nContact us.",
    hashtags: ["#cctv", "#security"],
    contentStructure: slides.map(s => `Slide ${s.slideNumber}: ${s.slideRole} — source content ${s.slideNumber}`).join("\n"),
    visualDirection: "Overall carousel visual system: dark navy, white type. " +
      slides.map(s => `Slide ${s.slideNumber}: visual ${s.slideNumber}.`).join(" "),
    outputImageTextRequirementsStructured: { type: "carousel", slides },
  };
}

// Valid source mapping: reductions merge contiguous groups; increases split sources.
export function mapSources(from, to) {
  const out = [];
  if (to <= from) {
    for (let t = 0; t < to; t++) {
      const lo = Math.floor((t * from) / to) + 1, hi = Math.floor(((t + 1) * from) / to);
      out.push(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i));
    }
  } else {
    for (let t = 0; t < to; t++) out.push([Math.floor((t * from) / to) + 1]);
  }
  return out;
}

export function makeAiSlides(n, extra = {}, from = 6) {
  const map = mapSources(from, n);
  return {
    postNumber: 3,
    overallVisualDirection: "Overall carousel visual system: dark navy, white type.",
    slides: Array.from({ length: n }, (_, i) => ({
      slideNumber: i + 1,
      sourceSlides: map[i],
      slideRole: i === 0 ? "Hook" : i === n - 1 ? "CTA" : `Part ${i}`,
      contentStructure: `merged content ${i + 1}`,
      visualDirection: `new visual ${i + 1}`,
      fields: { main_headline: `New headline ${i + 1}`, supporting_text: `New detail ${i + 1}` },
    })),
    ...extra,
  };
}

const promptArgs = (over = {}) => ({
  current: makeCarousel(6),
  currentOitrDisplay: "Slide 1: {main_headline: Headline 1}",
  brandSummary: "Brand: CUCCTV",
  contentLanguage: "en",
  calendarContext: { mainMonthlySubject: "Spring maintenance" },
  attachmentBlock: "\n=== INTERPRETED UPLOADED REFERENCE MATERIAL ===\nREF_MARKER_77",
  currentCount: 6,
  targetCount: 2,
  slideCountInstruction: "",
  ...over,
});

// ── Slide count discovery ─────────────────────────────────────────────────────

test("current slide count is inferred from contentStructure for carousels", () => {
  assert.equal(getPostSlideCount(makeCarousel(6)), 6);
  assert.equal(getPostSlideCount(makeCarousel(2)), 2);
});

test("static and video posts have no slide count", () => {
  assert.equal(getPostSlideCount({ ...makeCarousel(6), format: "Static" }), 0);
  assert.equal(getPostSlideCount({ ...makeCarousel(6), format: "Reel" }), 0);
});

// ── Scope registration ────────────────────────────────────────────────────────

test("change_slide_count is a registered scope limited to the five slide fields", () => {
  assert.deepEqual(SCOPE_FIELDS.change_slide_count, SLIDE_COUNT_FIELDS);
  for (const banned of ["caption", "hashtags", "hookTitle", "mainAngle", "coreMessage", "format", "textOnVideo", "narrationOrDialogueOfCharacterOrCharacters"]) {
    assert.ok(!SCOPE_FIELDS.change_slide_count.includes(banned), `${banned} must not be updatable`);
  }
});

test("existing scopes keep their field lists", () => {
  assert.deepEqual(SCOPE_FIELDS.enrich_post, ["hookTitle", "coreMessage", "caption"]);
  assert.deepEqual(SCOPE_FIELDS.image_text_only, ["outputImageTextRequirementsStructured", "outputImageTextRequirements", "imageText"]);
  for (const s of ["visual_only", "visual_ideas_only", "entire_post", "custom_instruction"]) assert.ok(SCOPE_FIELDS[s]);
});

// ── Request validation ────────────────────────────────────────────────────────

test("new slide count is required", () => {
  for (const v of [undefined, null, ""]) {
    const r = validateSlideCountRequest(makeCarousel(6), v);
    assert.equal(r.ok, false);
    assert.match(r.error, /required/i);
  }
});

test("counts below the minimum, non-integers and non-numbers are rejected", () => {
  for (const v of [0, -3, 1, 2.5, "abc", "3.5", NaN]) {
    assert.equal(validateSlideCountRequest(makeCarousel(6), v).ok, false, String(v));
  }
});

test("excessive counts are rejected", () => {
  const r = validateSlideCountRequest(makeCarousel(6), MAX_SLIDE_COUNT + 1);
  assert.equal(r.ok, false);
  assert.match(r.error, /at most/i);
  assert.equal(validateSlideCountRequest(makeCarousel(6), MAX_SLIDE_COUNT).ok, true);
});

test("same-as-current count asks for a different one", () => {
  const r = validateSlideCountRequest(makeCarousel(6), 6);
  assert.equal(r.ok, false);
  assert.equal(r.error, "Choose a different slide count.");
});

test("static and video posts are rejected without conversion", () => {
  for (const format of ["Static", "Reel"]) {
    const r = validateSlideCountRequest({ ...makeCarousel(6), format }, 3);
    assert.equal(r.ok, false);
    assert.match(r.error, /only available for Carousel/i);
  }
});

test("numeric strings are accepted and instruction length is capped", () => {
  const ok = validateSlideCountRequest(makeCarousel(6), "3", "  merge 2-6  ");
  assert.deepEqual([ok.ok, ok.currentCount, ok.targetCount, ok.instruction], [true, 6, 3, "merge 2-6"]);
  assert.equal(validateSlideCountRequest(makeCarousel(6), 3, "x".repeat(2001)).ok, false);
});

// ── Source slides + prompt contract ───────────────────────────────────────────

test("source slides expose number, role, structure, visual note and image text", () => {
  const slides = extractSourceSlides(makeCarousel(6));
  assert.equal(slides.length, 6);
  assert.equal(slides[1].slideNumber, 2);
  assert.equal(slides[1].role, "Problem");
  assert.match(slides[1].structure, /source content 2/);
  assert.match(slides[1].visual, /visual 2/);
  assert.equal(slides[1].imageText.main_headline, "Headline 2");
});

test("prompt lists every current slide and the exact target", () => {
  const p = buildChangeSlideCountUserInput(promptArgs());
  for (let n = 1; n <= 6; n++) assert.ok(p.includes(`CURRENT SLIDE ${n} (`), `slide ${n}`);
  assert.ok(p.includes("CHANGE SLIDE COUNT FROM 6 TO 2"));
  assert.ok(p.includes("EXACTLY 2 slides"));
  assert.ok(p.includes("REDUCE 6 → 2"));
});

test("user redistribution instruction is passed through verbatim (6 → 2)", () => {
  const instr = "Keep slide 1 unchanged. Merge slides 2–6 into slide 2.";
  const p = buildChangeSlideCountUserInput(promptArgs({ slideCountInstruction: instr }));
  assert.ok(p.includes("USER REDISTRIBUTION INSTRUCTION"));
  assert.ok(p.includes(instr));
  assert.ok(p.includes("refer to the CURRENT slides"));
});

test("5 → 3 prompt targets 3 slides", () => {
  const p = buildChangeSlideCountUserInput(promptArgs({ current: makeCarousel(5), currentCount: 5, targetCount: 3 }));
  assert.ok(p.includes("FROM 5 TO 3"));
  assert.ok(p.includes("REDUCE 5 → 3"));
  assert.ok(!p.includes("CURRENT SLIDE 6"));
});

test("reducing forbids dropping content and mechanical concatenation", () => {
  const p = buildChangeSlideCountUserInput(promptArgs());
  assert.match(p, /REDUCING SLIDES — consolidate, do not delete/);
  assert.match(p, /Keep every important fact/);
  assert.match(p, /ONLY if the user's redistribution instruction explicitly says to remove/);
  assert.match(p, /Do not concatenate them mechanically/);
  assert.ok(!p.includes("INCREASING SLIDES"));
});

test("increasing forbids invented facts and filler (2 → 5)", () => {
  const p = buildChangeSlideCountUserInput(promptArgs({ current: makeCarousel(2), currentCount: 2, targetCount: 5 }));
  assert.match(p, /INCREASING SLIDES — split, do not invent/);
  assert.match(p, /Do NOT invent new facts/);
  assert.match(p, /filler/);
  assert.ok(p.includes("INCREASE 2 → 5"));
  assert.ok(!p.includes("REDUCING SLIDES"));
});

test("prompt carries the preservation contract, language, references and brand/calendar context", () => {
  const p = buildChangeSlideCountUserInput(promptArgs({ contentLanguage: "de" }));
  assert.ok(p.includes(buildLanguageInstruction("de")));
  assert.ok(p.includes("REF_MARKER_77"));
  assert.ok(p.includes("Brand: CUCCTV"));
  assert.ok(p.includes("Spring maintenance"));
  assert.match(p, /never translate or mix languages/);
  assert.match(p, /caption, hashtags, hook title, main angle, core message, format, schedule and video fields are NOT yours to change/);
  assert.match(p, /SAME POST → DIFFERENT SLIDE STRUCTURE/);
  // current post context (caption, hashtags) is present read-only
  for (const line of buildCurrentPostContextLines(promptArgs().current, "")) assert.ok(p.includes(line));
});

test("prompt demands the strict slides JSON contract", () => {
  const p = buildChangeSlideCountUserInput(promptArgs({ targetCount: 3 }));
  assert.match(p, /"slides": \[/);
  assert.match(p, /exactly 3 entries, slideNumber 1\.\.3/);
  assert.match(p, /sourceSlides/);
  assert.match(p, /Do NOT return caption, hashtags/);
});

// ── Result assembly ───────────────────────────────────────────────────────────

for (const [from, to] of [[6, 2], [5, 3], [2, 5], [6, 3]]) {
  test(`${from} → ${to}: every slide-based field agrees on ${to} slides`, () => {
    const current = makeCarousel(from);
    const r = buildSlideCountChangeFields({ aiPost: makeAiSlides(to, {}, from), targetCount: to, current });
    assert.equal(r.ok, true, r.error);
    const f = r.fields;

    assert.equal(parseSlideCountFromContentStructure(f.contentStructure), to);
    assert.equal(f.outputImageTextRequirementsStructured.type, "carousel");
    assert.equal(f.outputImageTextRequirementsStructured.slides.length, to);
    assert.deepEqual(
      f.outputImageTextRequirementsStructured.slides.map(s => s.slideNumber),
      Array.from({ length: to }, (_, i) => i + 1),
    );
    // imageText + display string: one "Slide N:" entry per slide, none beyond `to`
    const imageSlides = [...f.imageText.matchAll(/Slide\s+(\d+)\s*:/g)].map(m => +m[1]);
    assert.deepEqual(imageSlides, Array.from({ length: to }, (_, i) => i + 1));
    assert.equal(f.imageText, f.outputImageTextRequirements);
    // visual direction: overall system kept + one "Slide N:" per slide
    const visualSlides = [...f.visualDirection.matchAll(/Slide\s+(\d+)\s*:/g)].map(m => +m[1]);
    assert.deepEqual(visualSlides, Array.from({ length: to }, (_, i) => i + 1));
    assert.ok(f.visualDirection.startsWith("Overall carousel visual system"));
    assert.ok(!f.contentStructure.includes(`Slide ${Math.max(from, to) + 1}`));
  });
}

test("result only contains the five slide fields", () => {
  const r = buildSlideCountChangeFields({ aiPost: makeAiSlides(3, { caption: "HACKED", hashtags: ["#x"], format: "Static", mainAngle: "x" }), targetCount: 3, current: makeCarousel(6) });
  assert.deepEqual(Object.keys(r.fields).sort(), [...SLIDE_COUNT_FIELDS].sort());
});

test("missing overall visual direction falls back to the current post's", () => {
  const ai = makeAiSlides(3);
  delete ai.overallVisualDirection;
  const r = buildSlideCountChangeFields({ aiPost: ai, targetCount: 3, current: makeCarousel(6) });
  assert.ok(r.fields.visualDirection.startsWith("Overall carousel visual system: dark navy, white type."));
});

test("model-added 'Slide N:' prefixes are not doubled", () => {
  const ai = makeAiSlides(2);
  ai.slides[0].contentStructure = "Slide 1: already labelled";
  const r = buildSlideCountChangeFields({ aiPost: ai, targetCount: 2, current: makeCarousel(6) });
  assert.match(r.fields.contentStructure, /^Slide 1: Hook — already labelled\n/);
});

const bad = (mutate, expected) => {
  const ai = makeAiSlides(3);
  mutate(ai);
  const r = buildSlideCountChangeFields({ aiPost: ai, targetCount: 3, current: makeCarousel(6) });
  assert.equal(r.ok, false);
  assert.match(r.error, expected);
};

test("wrong slide count is rejected", () => {
  bad(ai => ai.slides.pop(), /2 slides but 3 were requested/);
  bad(ai => ai.slides.push({ ...ai.slides[0], slideNumber: 4 }), /4 slides but 3/);
});
test("missing slides list is rejected", () => bad(ai => { delete ai.slides; }, /did not contain a slides list/));
test("duplicate slide numbers are rejected", () => bad(ai => { ai.slides[2].slideNumber = 2; }, /duplicate slide number 2/));
test("gaps in numbering are rejected", () => bad(ai => { ai.slides[2].slideNumber = 5; }, /not sequential/));
test("non-integer slide numbers are rejected", () => bad(ai => { ai.slides[1].slideNumber = "two"; }, /valid slide number/));
test("slides without content are rejected", () => bad(ai => { ai.slides[1].contentStructure = "  "; }, /Slide 2 has no content/));
test("slides without visual direction are rejected", () => bad(ai => { ai.slides[1].visualDirection = ""; }, /Slide 2 has no visual direction/));
test("slides without on-image text are rejected", () => {
  bad(ai => { delete ai.slides[1].fields; }, /no on-image text fields/);
  bad(ai => { ai.slides[1].fields = { main_headline: "" }; }, /no usable on-image text/);
});
test("all-identical slides are rejected by the shared validator", () => bad(ai => {
  ai.slides.forEach(s => { s.fields = { main_headline: "Same", supporting_text: "Same" }; });
}, /duplicate_slides/));

// ── Source-slide coverage ─────────────────────────────────────────────────────

const slidesWith = (sources) => sources.map((src, i) => ({ slideNumber: i + 1, sourceSlides: src }));
const cov = (sources, from, extra = {}) =>
  validateSourceCoverage({ slides: slidesWith(sources), currentCount: from, targetCount: sources.length, ...extra });

test("complete mappings are accepted: 6→2, 6→3, 5→3", () => {
  assert.equal(cov([[1], [2, 3, 4, 5, 6]], 6).ok, true);
  assert.equal(cov([[1], [2, 3, 4, 5], [6]], 6).ok, true);
  assert.equal(cov([[1], [2, 3], [4, 5]], 5).ok, true);
});

test("increase: one source may feed several targets (2→5) and the helper mapping is accepted", () => {
  assert.equal(cov([[1], [1], [2], [2], [2]], 2).ok, true);
  assert.equal(cov(mapSources(2, 5), 2).ok, true);
});

test("reduction missing a source slide is rejected with the omission error", () => {
  for (const sources of [[[1], [2, 3, 5, 6]], [[1], [2, 3, 4, 5]], [[2, 3, 4, 5, 6], [2]]]) {
    const r = cov(sources, 6);
    assert.equal(r.ok, false, JSON.stringify(sources));
  }
  const r = cov([[1], [2, 3, 5, 6]], 6);
  assert.equal(r.error, SOURCE_COVERAGE_ERROR);
  assert.match(r.details, /slide 4 not accounted for/);
});

test("increase must still represent every original slide", () => {
  const r = cov([[1], [1], [1], [1], [1]], 2);
  assert.equal(r.ok, false);
  assert.equal(r.error, SOURCE_COVERAGE_ERROR);
  assert.match(r.details, /slide 2/);
});

test("nonexistent, non-integer, zero, or empty sources are rejected", () => {
  for (const sources of [[[1], [2, 7]], [[1], [0, 2, 3, 4, 5, 6]], [[1], ["2", 3, 4, 5, 6]], [[1], [2.5]], [[1], []], [[1], null]]) {
    const r = validateSourceCoverage({ slides: slidesWith(sources), currentCount: 6, targetCount: 2 });
    assert.equal(r.ok, false, JSON.stringify(sources));
  }
  assert.match(cov([[1], [2, 7]], 6).error, /does not exist/);
  assert.equal(validateSourceCoverage({ slides: [{ slideNumber: 1 }, { slideNumber: 2 }], currentCount: 6, targetCount: 2 }).ok, false);
});

test("in a reduction an original slide cannot feed several new slides; repeats inside one slide are rejected", () => {
  assert.match(cov([[1, 2], [2, 3, 4, 5, 6]], 6).details, /several new slides/);
  assert.match(cov([[1, 1], [2, 3, 4, 5, 6]], 6).details, /more than once/);
});

test("explicit removal allows omitting exactly the named slides", () => {
  assert.equal(cov([[1], [2, 3, 5, 6]], 6, { explicitDrops: [4] }).ok, true);
  assert.equal(cov([[1], [2, 3, 6]], 6, { explicitDrops: [4] }).ok, false); // 5 also missing
});

test("parseExplicitDrops: recognises removal, ignores merging, keeping and negations", () => {
  assert.deepEqual(parseExplicitDrops("Remove slide 4.", 6), [4]);
  assert.deepEqual(parseExplicitDrops("Keep slide 1, drop slides 2 and 3, merge the rest", 6), [2, 3]);
  assert.deepEqual(parseExplicitDrops("delete slides 3-5", 6), [3, 4, 5]);
  assert.deepEqual(parseExplicitDrops("Omit slide 2, 4 & 5", 6), [2, 4, 5]);
  assert.deepEqual(parseExplicitDrops("Remove slide 9", 6), []);
  assert.deepEqual(parseExplicitDrops("Keep slide 1 unchanged. Merge slides 2–6 into slide 2.", 6), []);
  assert.deepEqual(parseExplicitDrops("Do not remove slide 4", 6), []);
  assert.deepEqual(parseExplicitDrops("Remove the repetition from slide 4", 6), []);
  assert.deepEqual(parseExplicitDrops("", 6), []);
  assert.deepEqual(parseExplicitDrops(undefined, 6), []);
});

test("builder enforces coverage and uses the instruction for explicit removal", () => {
  const ai = makeAiSlides(2);
  ai.slides[0].sourceSlides = [1];
  ai.slides[1].sourceSlides = [2, 3, 5, 6]; // slide 4 missing
  const current = makeCarousel(6);
  const miss = buildSlideCountChangeFields({ aiPost: ai, targetCount: 2, current, instruction: "Merge slides 2-6 into slide 2." });
  assert.equal(miss.ok, false);
  assert.equal(miss.error, SOURCE_COVERAGE_ERROR);
  const allowed = buildSlideCountChangeFields({ aiPost: ai, targetCount: 2, current, instruction: "Remove slide 4 and merge the rest into slide 2." });
  assert.equal(allowed.ok, true, allowed.error);
});

test("prompt makes sourceSlides a machine-checked contract and names explicit removals", () => {
  const p = buildChangeSlideCountUserInput(promptArgs({ slideCountInstruction: "Merge slides 2-6 into slide 2." }));
  assert.match(p, /SOURCE MAPPING CONTRACT \(machine-checked/);
  assert.match(p, /not descriptive metadata/);
  assert.match(p, /exactly one new slide's sourceSlides/);
  assert.match(p, /NO current slide may be omitted: all 6/);
  const drop = buildChangeSlideCountUserInput(promptArgs({ slideCountInstruction: "Remove slide 4, merge the rest" }));
  assert.match(drop, /EXPLICIT REMOVAL requested by the user: current slide 4/);
  const inc = buildChangeSlideCountUserInput(promptArgs({ current: makeCarousel(2), currentCount: 2, targetCount: 5 }));
  assert.match(inc, /at least one new slide's sourceSlides/);
  assert.match(inc, /MAY feed several new slides/);
});

test("source slides are extracted from single-line ' / ' separated structures (real stored shape)", () => {
  const post = {
    ...makeCarousel(3),
    contentStructure: "Slide 1: Hook — 'Summer!' / Slide 2: Offer — 'Early-bird discount' / Slide 3: CTA — 'Enroll now'",
  };
  const slides = extractSourceSlides(post);
  assert.equal(slides.length, 3);
  assert.equal(slides[0].structure, "Hook — 'Summer!'");
  assert.equal(slides[1].structure, "Offer — 'Early-bird discount'");
  assert.equal(slides[2].structure, "CTA — 'Enroll now'");
});

test("a leading duplicate of the slide role inside the content is dropped", () => {
  const ai = makeAiSlides(2);
  ai.slides[0].slideRole = "Hook";
  ai.slides[0].contentStructure = "Hook — 'Summer Learning!'";
  const r = buildSlideCountChangeFields({ aiPost: ai, targetCount: 2, current: makeCarousel(6) });
  assert.match(r.fields.contentStructure, /^Slide 1: Hook — 'Summer Learning!'\n/);
});

test("prompt demands concrete text, not meta-descriptions of merged slides", () => {
  const p = buildChangeSlideCountUserInput(promptArgs());
  assert.match(p, /CONCRETE TEXT ONLY/);
  assert.match(p, /NEVER write meta-descriptions/);
});
