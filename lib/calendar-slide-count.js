// Slide-count restructuring for carousel posts ("change_slide_count" scope).
//
// Slide count is NOT a stored field. It is inferred from text/arrays that must
// all agree:
//   contentStructure                        "Slide 1: … / Slide 2: …" (count = highest Slide N, else line count)
//   visualDirection                         "Overall …  Slide 1: …  Slide 2: …"
//   outputImageTextRequirementsStructured   { type:"carousel", slides:[{slideNumber,slideRole,fields}] }
//   outputImageTextRequirements / imageText display strings derived from the structured object
//
// Static and video posts are single-image / single-clip in this schema (static
// OITR has exactly one item), so slide count is only meaningful for carousels.
//
// This module is pure (no DB / network) and shared by both regeneration routes
// and the UI, so there is one definition of "current slide count", one request
// validator, and one strict result assembler.

import {
  parseSlideCountFromContentStructure,
  normalizeOutputImageTextRequirementsStructured,
  formatOutputImageTextRequirementsForDisplay,
  validateOutputImageTextRequirements,
} from "./calendar-post-utils.js";

export const MIN_SLIDE_COUNT = 2; // a 1-slide "carousel" is a static post; the shared validator flags <2 as truncated
export const MAX_SLIDE_COUNT = 10; // Instagram's carousel limit at the time the app's carousel conventions were set
export const MAX_SLIDE_INSTRUCTION_LENGTH = 2000;

export const SLIDE_COUNT_FIELDS = [
  "contentStructure",
  "visualDirection",
  "outputImageTextRequirementsStructured",
  "outputImageTextRequirements",
  "imageText",
];

export function isCarouselFormat(format) {
  return (format || "").toLowerCase().includes("carousel");
}

/** Current slide count of a post, or 0 when it is not a carousel / cannot be determined. */
export function getPostSlideCount(post) {
  if (!post || !isCarouselFormat(post.format)) return 0;
  const fromStructure = parseSlideCountFromContentStructure(post.contentStructure);
  if (fromStructure > 0) return fromStructure;
  const structured = normalizeOutputImageTextRequirementsStructured(
    post.outputImageTextRequirementsStructured ?? post.outputImageTextRequirements
  );
  return structured?.type === "carousel" ? structured.slides.length : 0;
}

/** Strict integer parse: accepts integers and plain digit strings only. */
function parseStrictInteger(value) {
  if (typeof value === "number") return Number.isInteger(value) ? value : NaN;
  if (typeof value === "string" && /^\s*\d+\s*$/.test(value)) return parseInt(value, 10);
  return NaN;
}

/**
 * Validates a change_slide_count request against the post it targets.
 * Returns { ok:true, currentCount, targetCount, instruction } or { ok:false, error }.
 */
export function validateSlideCountRequest(post, newSlideCount, instruction) {
  if (!isCarouselFormat(post?.format)) {
    return {
      ok: false,
      error: `Changing the slide count is only available for Carousel posts. This post's format is "${post?.format || "unknown"}", which is a single ${/reel|story|video|live/i.test(post?.format || "") ? "video" : "image"} — change the format with a custom instruction instead.`,
    };
  }
  if (newSlideCount === undefined || newSlideCount === null || newSlideCount === "") {
    return { ok: false, error: "New slide count is required." };
  }
  const target = parseStrictInteger(newSlideCount);
  if (!Number.isInteger(target)) {
    return { ok: false, error: "New slide count must be a whole number." };
  }
  if (target < MIN_SLIDE_COUNT) {
    return { ok: false, error: `A carousel needs at least ${MIN_SLIDE_COUNT} slides. Choose ${MIN_SLIDE_COUNT} or more.` };
  }
  if (target > MAX_SLIDE_COUNT) {
    return { ok: false, error: `A carousel can have at most ${MAX_SLIDE_COUNT} slides.` };
  }
  const currentCount = getPostSlideCount(post);
  if (currentCount > 0 && target === currentCount) {
    return { ok: false, error: "Choose a different slide count." };
  }
  const text = typeof instruction === "string" ? instruction.trim() : "";
  if (text.length > MAX_SLIDE_INSTRUCTION_LENGTH) {
    return { ok: false, error: `Redistribution instructions must be ${MAX_SLIDE_INSTRUCTION_LENGTH} characters or fewer.` };
  }
  return { ok: true, currentCount, targetCount: target, instruction: text };
}

// ── Source slides (prompt input) ──────────────────────────────────────────────

function splitBySlideMarkers(text, markerRe) {
  const out = new Map();
  if (!text) return out;
  const parts = text.split(markerRe).map(p => p.trim()).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^Slide\s+(\d+)\s*[:.\-–—)]?\s*([\s\S]*)$/i);
    if (m) out.set(parseInt(m[1], 10), m[2].trim().replace(/\s*[\/|;]\s*$/, ""));
  }
  return out;
}

/** Per-slide view of the current post: number, structure entry, visual note, on-image text. */
export function extractSourceSlides(post) {
  const count = getPostSlideCount(post);
  const structure = splitBySlideMarkers(post.contentStructure, /(?=Slide\s+\d+\s*[:.\-–—)])/gi);
  const visual = splitBySlideMarkers(post.visualDirection, /(?=Slide\s+\d+\s*:)/gi);
  const oitr = normalizeOutputImageTextRequirementsStructured(
    post.outputImageTextRequirementsStructured ?? post.outputImageTextRequirements
  );
  const oitrBySlide = new Map((oitr?.type === "carousel" ? oitr.slides : []).map(s => [s.slideNumber, s]));

  const lines = (post.contentStructure || "").split(/\n+/).map(l => l.trim()).filter(Boolean);
  const slides = [];
  for (let n = 1; n <= count; n++) {
    const o = oitrBySlide.get(n);
    slides.push({
      slideNumber: n,
      role: o?.slideRole || null,
      structure: structure.get(n) ?? (structure.size === 0 ? lines[n - 1] ?? null : null),
      visual: visual.get(n) ?? null,
      imageText: o?.fields ?? null,
    });
  }
  return slides;
}

export function formatSourceSlidesForPrompt(slides) {
  return slides.map(s => [
    `--- CURRENT SLIDE ${s.slideNumber}${s.role ? ` (${s.role})` : ""} ---`,
    s.structure ? `Content structure entry: ${s.structure}` : null,
    s.visual ? `Visual note: ${s.visual}` : null,
    s.imageText ? `On-image text: ${JSON.stringify(s.imageText)}` : null,
  ].filter(Boolean).join("\n")).join("\n");
}

/** The overall (non per-slide) part of a visual direction. */
export function extractOverallVisualDirection(visualDirection) {
  const text = (visualDirection || "").trim();
  const idx = text.search(/Slide\s+\d+\s*:/i);
  return (idx === -1 ? text : text.slice(0, idx)).trim();
}

// ── Explicit removal + source coverage ────────────────────────────────────────
// Default contract: every CURRENT slide must feed at least one NEW slide.
// A slide may be left out ONLY when the user's instruction explicitly asks to
// remove it ("remove slide 4", "drop slides 2 and 3"). This is deliberately a
// narrow *removal* detector, not a mapping parser: anything it does not
// recognise keeps the full-coverage requirement.

const DROP_VERB = /\b(?:remove|delete|drop|omit|discard|exclude|get rid of)\s+(?:all\s+)?(?:of\s+)?(?:the\s+)?(?:content\s+(?:of|from)\s+)?slides?\s+((?:\d+(?:\s*(?:-|–|—|to)\s*\d+)?)(?:\s*(?:,|and|&)\s*(?:and\s+)?\d+(?:\s*(?:-|–|—|to)\s*\d+)?)*)/gi;
const NEGATION_BEFORE = /(?:\bdon'?t|\bdo not|\bnever|\bnot|\bwithout|\bno need to|\bavoid)\s+(?:\w+\s+){0,2}$/i;

/** Source slide numbers the instruction explicitly asks to remove (within 1..currentCount). */
export function parseExplicitDrops(instruction, currentCount) {
  const drops = new Set();
  const text = typeof instruction === "string" ? instruction : "";
  for (const m of text.matchAll(DROP_VERB)) {
    if (NEGATION_BEFORE.test(text.slice(Math.max(0, m.index - 24), m.index))) continue;
    for (const part of m[1].split(/\s*(?:,|\band\b|&)\s*/i)) {
      const range = part.trim().match(/^(\d+)(?:\s*(?:-|–|—|to)\s*(\d+))?$/i);
      if (!range) continue;
      const a = parseInt(range[1], 10);
      const b = range[2] ? parseInt(range[2], 10) : a;
      for (let n = Math.min(a, b); n <= Math.max(a, b) && n <= currentCount; n++) if (n >= 1) drops.add(n);
    }
  }
  return [...drops].sort((x, y) => x - y);
}

export const SOURCE_COVERAGE_ERROR =
  "The regenerated slide structure omitted content from one or more original slides.";

/**
 * Validates the model's source mapping. Returns { ok:true } or
 * { ok:false, error, details }. Never repairs anything.
 */
export function validateSourceCoverage({ slides, currentCount, targetCount, explicitDrops = [] }) {
  const bad = (details, error = SOURCE_COVERAGE_ERROR) => ({ ok: false, error, details });
  const reducing = targetCount < currentCount;
  const covered = new Map(); // source -> [target slide numbers]

  for (const s of slides) {
    const src = s.sourceSlides;
    if (!Array.isArray(src) || src.length === 0) {
      return bad(`Slide ${s.slideNumber} has no sourceSlides, so it is not traceable to the original post.`, "The regenerated slide structure did not say which original slides each new slide came from.");
    }
    const seen = new Set();
    for (const n of src) {
      if (!Number.isInteger(n)) return bad(`Slide ${s.slideNumber} has a non-integer source slide (${JSON.stringify(n)}).`, "The regenerated slide structure referenced an invalid original slide.");
      if (n < 1 || n > currentCount) return bad(`Slide ${s.slideNumber} claims source slide ${n}, but the original has only ${currentCount} slides.`, "The regenerated slide structure referenced an original slide that does not exist.");
      if (seen.has(n)) return bad(`Slide ${s.slideNumber} lists source slide ${n} more than once.`, "The regenerated slide structure repeated an original slide within one slide.");
      seen.add(n);
      covered.set(n, [...(covered.get(n) ?? []), s.slideNumber]);
    }
  }

  if (reducing) {
    // Reduction merges; one original slide feeding several new slides would duplicate its content.
    for (const [n, targets] of covered) {
      if (targets.length > 1) return bad(`Original slide ${n} was assigned to several new slides (${targets.join(", ")}) in a reduction; each original slide must be merged into exactly one.`, "The regenerated slide structure duplicated content from an original slide.");
    }
  }

  const dropped = new Set(explicitDrops);
  const missing = [];
  for (let n = 1; n <= currentCount; n++) if (!covered.has(n) && !dropped.has(n)) missing.push(n);
  if (missing.length) {
    return bad(`Original slide${missing.length > 1 ? "s" : ""} ${missing.join(", ")} not accounted for in any new slide's sourceSlides${explicitDrops.length ? ` (explicitly removed: ${explicitDrops.join(", ")})` : ""}.`);
  }
  return { ok: true };
}

// ── Result assembly + strict validation ───────────────────────────────────────

const stripSlideLabel = (s) => String(s ?? "").trim().replace(/^Slide\s+\d+\s*[:.\-–—)]\s*/i, "").trim();

/**
 * Turns the model's `slides` array into the five consistent slide-based fields.
 * All-or-nothing: any problem returns { ok:false, error } and the caller must
 * write nothing.
 */
export function buildSlideCountChangeFields({ aiPost, targetCount, current, currentCount, instruction }) {
  const fail = (error, details) => ({ ok: false, error, ...(details ? { details } : {}) });
  const slides = aiPost?.slides;
  if (!Array.isArray(slides)) return fail("AI response did not contain a slides list.");
  if (slides.length !== targetCount) {
    return fail(`AI returned ${slides.length} slides but ${targetCount} were requested.`);
  }

  const sorted = slides.slice().sort((a, b) => Number(a?.slideNumber) - Number(b?.slideNumber));
  for (let i = 0; i < sorted.length; i++) {
    const n = Number(sorted[i]?.slideNumber);
    if (!Number.isInteger(n)) return fail("AI returned a slide without a valid slide number.");
    if (i > 0 && n === Number(sorted[i - 1].slideNumber)) return fail(`AI returned duplicate slide number ${n}.`);
    if (n !== i + 1) {
      return fail(`AI slide numbering is not sequential 1–${targetCount} (expected ${i + 1}, got ${n}).`);
    }
  }

  const coverage = validateSourceCoverage({
    slides: sorted,
    currentCount: currentCount || getPostSlideCount(current),
    targetCount,
    explicitDrops: parseExplicitDrops(instruction, currentCount || getPostSlideCount(current)),
  });
  if (!coverage.ok) return fail(coverage.error, coverage.details);

  const contentLines = [];
  const visualLines = [];
  const rawOitrSlides = [];
  for (const s of sorted) {
    const n = s.slideNumber;
    const roleText = typeof s.slideRole === "string" ? s.slideRole.trim() : "";
    let content = stripSlideLabel(s.contentStructure ?? s.content);
    // The role is added back as "Slide N: Role — …": drop a duplicated leading "Role —".
    if (roleText) content = content.replace(new RegExp(`^${roleText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:\\-–—]\\s*`, "i"), "").trim();
    if (!content) return fail(`Slide ${n} has no content.`);
    const visual = stripSlideLabel(s.visualDirection);
    if (!visual) return fail(`Slide ${n} has no visual direction.`);
    if (!s.fields || typeof s.fields !== "object" || Array.isArray(s.fields)) {
      return fail(`Slide ${n} has no on-image text fields.`);
    }
    const role = typeof s.slideRole === "string" ? s.slideRole.trim() : "";
    contentLines.push(`Slide ${n}: ${role ? `${role} — ` : ""}${content}`);
    visualLines.push(`Slide ${n}: ${visual}`);
    rawOitrSlides.push({ slideNumber: n, slideRole: role || null, fields: s.fields });
  }

  const structured = normalizeOutputImageTextRequirementsStructured({ type: "carousel", slides: rawOitrSlides });
  if (!structured || structured.slides.length !== targetCount) {
    return fail("One or more slides had no usable on-image text.");
  }

  const overall =
    (typeof aiPost.overallVisualDirection === "string" && aiPost.overallVisualDirection.trim()) ||
    extractOverallVisualDirection(current?.visualDirection);
  const contentStructure = contentLines.join("\n");
  const visualDirection = [overall, ...visualLines].filter(Boolean).join("\n");

  // Cross-field consistency, using the app's own definitions of slide count.
  if (parseSlideCountFromContentStructure(contentStructure) !== targetCount) {
    return fail("Content structure slide count does not match the requested count.");
  }
  const check = validateOutputImageTextRequirements({
    format: "Carousel",
    contentStructure,
    outputImageTextRequirementsStructured: structured,
    outputImageTextRequirements: null,
  });
  if (!check.valid) return fail(`On-image text failed validation (${check.reason}).`);

  const display = formatOutputImageTextRequirementsForDisplay(structured) || "";
  return {
    ok: true,
    sourceMapping: sorted.map(sl => ({ slideNumber: sl.slideNumber, sourceSlides: sl.sourceSlides })),
    fields: {
      contentStructure,
      visualDirection,
      outputImageTextRequirementsStructured: structured,
      outputImageTextRequirements: display,
      imageText: display,
    },
  };
}
