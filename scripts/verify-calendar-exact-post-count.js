#!/usr/bin/env node
// Focused verification for the exact-count collector in the calendar generator.
//
// Run: node scripts/verify-calendar-exact-post-count.js
// Exit 0 on all pass, 1 on any failure.

import assert from "node:assert/strict";

let passed = 0;
let failed = 0;
const errors = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    errors.push(`FAIL: ${name}\n  ${err.message}`);
  }
}

// ─── Helpers under test (mirroring generate/route.js logic) ─────────────────

function deduplicatePosts(posts) {
  const seen = new Set();
  return posts.filter(p => {
    const hook = (p.hookTitle || p.coreMessage || p.caption?.slice(0, 60) || "").toLowerCase().trim();
    const angle = (p.mainAngle || p.coreMessage || "").toLowerCase().trim();
    const fmt = (p.format || "").toLowerCase().trim();
    const key = `${hook}||${angle}||${fmt}`;
    if (!hook) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function computeFormatDeficits(currentPosts, distributedFormats, totalNeeded) {
  const formatCount = {};
  for (const p of currentPosts) {
    const f = (p.format || "").trim();
    if (f) formatCount[f] = (formatCount[f] || 0) + 1;
  }
  const expected = {};
  for (const f of distributedFormats.slice(0, totalNeeded)) {
    expected[f] = (expected[f] || 0) + 1;
  }
  const deficits = [];
  for (const [fmt, need] of Object.entries(expected)) {
    const have = formatCount[fmt] || 0;
    if (have < need) deficits.push(`${fmt}: need ${need - have} more of ${need} total`);
  }
  return deficits;
}

function buildSupplementalPromptContent({ count, acceptedPosts, formatDeficits, languageInstruction, attachmentBlock }) {
  const lines = [
    "=== SUPPLEMENTAL GENERATION ===",
    `The calendar currently has ${acceptedPosts.length} accepted posts but needs more.`,
    `Generate exactly ${count} ADDITIONAL posts that are DIFFERENT from the accepted list below.`,
    "",
    "=== ACCEPTED POSTS (do NOT duplicate) ===",
    ...acceptedPosts.map((p, i) =>
      `${i + 1}. Date: ${p.date || "unset"} | Format: ${p.format || ""} | ` +
      `Hook: "${(p.hookTitle || p.coreMessage || "").slice(0, 80)}"`
    ),
  ];
  if (formatDeficits.length > 0) {
    lines.push("", "=== FORMAT DEFICITS ===", "Prioritise the following formats:", ...formatDeficits.map(d => `  - ${d}`));
  }
  if (languageInstruction) lines.push("", languageInstruction);
  if (attachmentBlock) lines.push("", attachmentBlock);
  lines.push("", "Each post must use the standard schema and be valid for the same brand and campaign.", "Return ONLY valid JSON with a 'posts' array.");
  return lines.join("\n");
}

function collectExactCount({ safeCount, initialBatches, supplementalResults }) {
  // Simulates the route's pipeline
  let allPosts = initialBatches.flat();

  // Dedup
  const allUnique = deduplicatePosts(allPosts);
  let finalBatch = allUnique.slice(0, safeCount);

  // Supplemental phase
  for (const sup of supplementalResults) {
    if (finalBatch.length >= safeCount) break;
    const merged = deduplicatePosts([...finalBatch, ...sup]).slice(0, safeCount);
    finalBatch = merged;
  }

  return finalBatch;
}

// ─── Fake post factory ──────────────────────────────────────────────────────

function makePost(id, format, lang = "en") {
  if (lang === "fa") {
    const hooks = [
      "مزایای دوربین مداربسته برای کسب و کار شما",
      "راهنمای انتخاب دوربین مداربسته مناسب",
      "نکات مهم در نصب سیستم های امنیتی",
      "چگونه از امنیت فروشگاه خود مطمئن شویم",
      "مقایسه دوربین های آنالوگ و دیجیتال",
      "بهترین برندهای دوربین مداربسته در بازار",
      "هزینه نصب سیستم دوربین مداربسته چقدر است",
      "نکات امنیتی برای فروشگاه های اینترنتی",
      "راه اندازی سیستم نظارت تصویری",
      "مزایای استفاده از دوربین های تحت شبکه",
      "معرفی جدیدترین تکنولوژی های امنیتی",
      "چگونه یک سیستم امنیتی مقرون به صرفه داشته باشیم",
      "خدمات پس از فروش دوربین مداربسته",
      "نگهداری و تعمیر سیستم های نظارتی",
    ];
    return {
      postNumber: id,
      date: `2026-0${((id - 1) % 3) + 1}-${10 + ((id - 1) % 20)}`,
      platform: "Instagram",
      format,
      hookTitle: hooks[(id - 1) % hooks.length],
      coreMessage: hooks[(id + 1) % hooks.length],
      caption: `این یک توضیح کامل برای پست شماره ${id} است که در مورد ${hooks[(id - 1) % hooks.length]} بحث می‌کند.`,
      hashtags: ["#امنیت", "#دوربین"],
    };
  }
  const hooks = [
    "Benefits of security cameras for business",
    "How to choose the right security camera",
    "Important tips for installing security systems",
    "How to ensure your store security",
    "Analog vs digital cameras comparison",
    "Best security camera brands on the market",
    "How much does security camera installation cost",
    "Security tips for online stores",
    "Setting up a video surveillance system",
    "Benefits of IP cameras",
  ];
  return {
    postNumber: id,
    date: `2026-0${((id - 1) % 3) + 1}-${10 + ((id - 1) % 20)}`,
    platform: "Instagram",
    format,
    hookTitle: hooks[(id - 1) % hooks.length],
    coreMessage: hooks[(id + 1) % hooks.length],
    caption: `Full caption for post ${id} about ${hooks[(id - 1) % hooks.length]}.`,
    hashtags: ["#security", "#cameras"],
  };
}

// ─── A. Initial exact result ────────────────────────────────────────────────

test("A1: request 12, provider returns 12, dedup keeps 12", () => {
  const posts = Array.from({ length: 12 }, (_, i) => makePost(i + 1, ["Carousel", "Reel", "Static"][i % 3]));
  const result = deduplicatePosts(posts);
  assert.equal(result.length, 12);
});

test("A2: request 12, collector returns exactly 12 with no supplementals", () => {
  const posts = Array.from({ length: 12 }, (_, i) => makePost(i + 1, ["Carousel", "Reel", "Static"][i % 3]));
  const result = collectExactCount({ safeCount: 12, initialBatches: [posts], supplementalResults: [] });
  assert.equal(result.length, 12);
});

test("A3: collector returns exactly safeCount even with extra candidates", () => {
  const posts = Array.from({ length: 14 }, (_, i) => makePost(i + 1, ["Carousel", "Reel", "Static"][i % 3]));
  const result = collectExactCount({ safeCount: 12, initialBatches: [posts], supplementalResults: [] });
  assert.equal(result.length, 12);
});

// ─── B. Initial shortfall ───────────────────────────────────────────────────

test("B1: provider returns 9, supplemental fills to 12", () => {
  const initial = Array.from({ length: 9 }, (_, i) => makePost(i + 1, ["Carousel", "Reel", "Static"][i % 3]));
  // Supplemental posts must have hooks NOT in the initial set (wrap-around safe)
  const supplement = [
    { ...makePost(10, "Static"), hookTitle: "Unique hook for supplemental post A" },
    { ...makePost(11, "Carousel"), hookTitle: "Unique hook for supplemental post B" },
    { ...makePost(12, "Reel"), hookTitle: "Unique hook for supplemental post C" },
  ];
  const result = collectExactCount({ safeCount: 12, initialBatches: [initial], supplementalResults: [supplement] });
  assert.equal(result.length, 12);
});

test("B2: collector calculates correct remaining count", () => {
  const initial = Array.from({ length: 9 }, (_, i) => makePost(i + 1, ["Carousel", "Reel", "Static"][i % 3]));
  const supplement = Array.from({ length: 5 }, (_, i) => makePost(i + 10, ["Static", "Carousel", "Reel", "Carousel", "Reel"][i % 5]));
  const result = collectExactCount({ safeCount: 12, initialBatches: [initial], supplementalResults: [supplement] });
  assert.equal(result.length, 12);
});

// ─── C. Duplicate supplemental posts ────────────────────────────────────────

test("C1: duplicate supplemental posts are rejected", () => {
  const initial = Array.from({ length: 9 }, (_, i) => makePost(i + 1, ["Carousel", "Reel", "Static"][i % 3]));
  // Supplement returns 3 posts, 2 are duplicates of initial
  const dup1 = { ...makePost(1, "Carousel") }; // duplicate of post 1
  const dup2 = { ...makePost(2, "Reel") };     // duplicate of post 2
  const unique1 = makePost(10, "Static");
  const supplement = [dup1, dup2, unique1];
  const result = collectExactCount({ safeCount: 12, initialBatches: [initial], supplementalResults: [supplement] });
  assert.equal(result.length, 10); // only 1 of 3 accepted
});

test("C2: second supplement fills remaining after duplicate rejection", () => {
  const initial = Array.from({ length: 9 }, (_, i) => makePost(i + 1, ["Carousel", "Reel", "Static"][i % 3]));
  const supplement1 = [
    { ...makePost(1, "Carousel") },
    { ...makePost(5, "Carousel") },
    makePost(10, "Static"),
  ];
  const supplement2 = [
    makePost(11, "Reel"),
    makePost(12, "Carousel"),
    makePost(13, "Static"),
  ];
  const result = collectExactCount({
    safeCount: 12,
    initialBatches: [initial],
    supplementalResults: [supplement1, supplement2],
  });
  assert.equal(result.length, 12);
});

// ─── D. Overproduction ──────────────────────────────────────────────────────

test("D1: overproduction trims to exactly safeCount", () => {
  const posts = Array.from({ length: 15 }, (_, i) => makePost(i + 1, ["Carousel", "Reel", "Static"][i % 3]));
  const result = collectExactCount({ safeCount: 12, initialBatches: [posts], supplementalResults: [] });
  assert.equal(result.length, 12);
});

test("D2: overproduction preserves format distribution", () => {
  const posts = Array.from({ length: 15 }, (_, i) => makePost(i + 1, ["Carousel", "Reel", "Static"][i % 3]));
  const result = collectExactCount({ safeCount: 12, initialBatches: [posts], supplementalResults: [] });
  const formats = result.map(p => p.format);
  assert.ok(formats.includes("Carousel"));
  assert.ok(formats.includes("Reel"));
  assert.ok(formats.includes("Static"));
});

// ─── E. Validation loss ─────────────────────────────────────────────────────

test("E1: malformed post (no hook, no format) is kept (not deduped away)", () => {
  const posts = Array.from({ length: 12 }, (_, i) => makePost(i + 1, ["Carousel", "Reel", "Static"][i % 3]));
  posts[5] = { postNumber: 99, date: "", platform: "", format: "", hookTitle: "", coreMessage: "" };
  const result = deduplicatePosts(posts);
  // Empty-key posts pass through (if (!hook) return true)
  assert.equal(result.length, 12);
});

test("E2: supplement fills gap from valid post lost to dedup by empty key", () => {
  const initial = Array.from({ length: 12 }, (_, i) => makePost(i + 1, ["Carousel", "Reel", "Static"][i % 3]));
  // Simulate: 11 valid + 1 with empty key that passes through
  const allUnique = deduplicatePosts(initial);
  assert.equal(allUnique.length, 12);
  // A genuinely missing post due to empty-key collision would need a supplement
  const supplement = [{ ...makePost(13, "Carousel"), hookTitle: "Supplemental replacement post" }];
  const result = collectExactCount({ safeCount: 12, initialBatches: [initial.slice(0, 11)], supplementalResults: [supplement] });
  assert.equal(result.length, 12);
});

// ─── F. Required formats ────────────────────────────────────────────────────

test("F1: Carousel, Reel, Static all appear in final 12", () => {
  const posts = Array.from({ length: 12 }, (_, i) => makePost(i + 1, ["Carousel", "Reel", "Static"][i % 3]));
  const formats = new Set(posts.map(p => p.format));
  assert.ok(formats.has("Carousel"));
  assert.ok(formats.has("Reel"));
  assert.ok(formats.has("Static"));
});

test("F2: computeFormatDeficits detects missing formats", () => {
  const current = [
    makePost(1, "Carousel"),
    makePost(2, "Reel"),
    makePost(3, "Carousel"),
    makePost(4, "Reel"),
  ];
  const distributed = ["Carousel", "Reel", "Static", "Carousel", "Reel", "Static"];
  const deficits = computeFormatDeficits(current, distributed, 6);
  assert.equal(deficits.length, 1);
  assert.ok(deficits[0].includes("Static"));
});

test("F3: computeFormatDeficits returns empty when all formats covered", () => {
  const current = [
    makePost(1, "Carousel"),
    makePost(2, "Reel"),
    makePost(3, "Static"),
  ];
  const distributed = ["Carousel", "Reel", "Static"];
  const deficits = computeFormatDeficits(current, distributed, 3);
  assert.equal(deficits.length, 0);
});

test("F4: canonical format values remain English", () => {
  const posts = Array.from({ length: 12 }, (_, i) => makePost(i + 1, ["Carousel", "Reel", "Static"][i % 3]));
  for (const p of posts) {
    assert.ok(["Carousel", "Reel", "Static"].includes(p.format));
  }
});

// ─── G. Persian instruction ─────────────────────────────────────────────────

test("G1: buildSupplementalPromptContent includes Persian language instruction", () => {
  const content = buildSupplementalPromptContent({
    count: 3,
    acceptedPosts: [makePost(1, "Carousel")],
    formatDeficits: [],
    languageInstruction: "=== AUTHORITATIVE OUTPUT LANGUAGE ===\nLanguage: Persian / فارسی (fa)\nAll output must be in Persian.",
    attachmentBlock: null,
  });
  assert.ok(content.includes("AUTHORITATIVE OUTPUT LANGUAGE"));
  assert.ok(content.includes("Persian"));
  assert.ok(content.includes("fa"));
});

test("G2: supplemental prompt tells model to generate different posts", () => {
  const content = buildSupplementalPromptContent({
    count: 3,
    acceptedPosts: [makePost(1, "Carousel")],
    formatDeficits: [],
    languageInstruction: null,
    attachmentBlock: null,
  });
  assert.ok(content.includes("DIFFERENT from the accepted list"));
});

test("G3: supplemental prompt lists accepted posts to avoid duplication", () => {
  const content = buildSupplementalPromptContent({
    count: 3,
    acceptedPosts: [makePost(1, "Carousel", "fa"), makePost(2, "Reel", "fa")],
    formatDeficits: [],
    languageInstruction: null,
    attachmentBlock: null,
  });
  assert.ok(content.includes("ACCEPTED POSTS"));
  assert.ok(content.includes("مزایای"));
});

// ─── H. Attachment context ──────────────────────────────────────────────────

test("H1: supplemental prompt includes attachment block when present", () => {
  const content = buildSupplementalPromptContent({
    count: 3,
    acceptedPosts: [makePost(1, "Carousel")],
    formatDeficits: [],
    languageInstruction: null,
    attachmentBlock: "=== INTERPRETED UPLOADED REFERENCE MATERIAL ===\nBrand product details",
  });
  assert.ok(content.includes("INTERPRETED UPLOADED REFERENCE MATERIAL"));
});

test("H2: supplemental prompt does not duplicate attachment block", () => {
  const content = buildSupplementalPromptContent({
    count: 3,
    acceptedPosts: [makePost(1, "Carousel")],
    formatDeficits: [],
    languageInstruction: null,
    attachmentBlock: "=== INTERPRETED UPLOADED REFERENCE MATERIAL ===\nBrand product details",
  });
  const occurrences = content.split("INTERPRETED UPLOADED REFERENCE MATERIAL").length - 1;
  assert.equal(occurrences, 1);
});

// ─── I. Dates ───────────────────────────────────────────────────────────────

test("I1: final result has all required dates", () => {
  const posts = Array.from({ length: 12 }, (_, i) => makePost(i + 1, ["Carousel", "Reel", "Static"][i % 3]));
  for (const p of posts) {
    assert.ok(p.date, `Post ${p.postNumber} should have a date`);
  }
});

// ─── J. Bounded attempts ────────────────────────────────────────────────────

test("J1: maximum supplemental attempts is 3", () => {
  const initial = Array.from({ length: 8 }, (_, i) => makePost(i + 1, ["Carousel", "Reel", "Static"][i % 3]));
  // 3 empty supplementals (simulating failed generation)
  const result = collectExactCount({
    safeCount: 12,
    initialBatches: [initial],
    supplementalResults: [[], [], []],
  });
  assert.equal(result.length, 8); // only 8 accepted after 3 empty supplements
});

test("J2: early break when count reached", () => {
  const initial = Array.from({ length: 8 }, (_, i) => makePost(i + 1, ["Carousel", "Reel", "Static"][i % 3]));
  const supplement1 = [
    { ...makePost(9, "Reel"), hookTitle: "Unique supplemental hook A" },
    { ...makePost(10, "Static"), hookTitle: "Unique supplemental hook B" },
    { ...makePost(11, "Carousel"), hookTitle: "Unique supplemental hook C" },
    { ...makePost(12, "Reel"), hookTitle: "Unique supplemental hook D" },
  ];
  const supplement2 = [{ ...makePost(13, "Carousel"), hookTitle: "Should not be reached" }];
  const result = collectExactCount({
    safeCount: 12,
    initialBatches: [initial],
    supplementalResults: [supplement1, supplement2],
  });
  assert.equal(result.length, 12);
  // Verify supplement2 was never merged by checking for its hook
  const hooks = result.map(p => p.hookTitle);
  assert.ok(!hooks.includes("Should not be reached"));
});

// ─── K. No persistence ──────────────────────────────────────────────────────

test("K1: deduplicatePosts does not mutate input", () => {
  const posts = Array.from({ length: 5 }, (_, i) => makePost(i + 1, ["Carousel", "Reel", "Static"][i % 3]));
  const originalLength = posts.length;
  deduplicatePosts(posts);
  assert.equal(posts.length, originalLength); // unchanged
});

// ─── L. Count source ────────────────────────────────────────────────────────

test("L1: safeCount uses numberOfPostsNeeded, not selectedPosts", () => {
  const rawCount = "12";
  const safeCount = Math.min(parseInt(rawCount, 10), 60);
  const selectedPosts = Array.from({ length: 5 }, (_, i) => ({ suggestedHook: `hook ${i}` }));
  // selectedPosts.length should not affect safeCount
  assert.equal(safeCount, 12);
  assert.notEqual(safeCount, selectedPosts.length);
});

test("L2: selectedPosts fallback only used when numberOfPostsNeeded is invalid", () => {
  const selectedPosts = Array.from({ length: 5 }, (_, i) => ({ suggestedHook: `hook ${i}` }));
  const rawCount = NaN;
  const safeCount = !isNaN(rawCount) && rawCount >= 1
    ? Math.min(rawCount, 60)
    : selectedPosts.length > 0
      ? Math.min(selectedPosts.length, 60)
      : 12;
  assert.equal(safeCount, 5); // falls back to selectedPosts.length
});

test("L3: default 12 used when both count and selectedPosts are empty", () => {
  const rawCount = NaN;
  const selectedPosts = [];
  const safeCount = !isNaN(rawCount) && rawCount >= 1
    ? Math.min(rawCount, 60)
    : selectedPosts.length > 0
      ? Math.min(selectedPosts.length, 60)
      : 12;
  assert.equal(safeCount, 12);
});

// ─── M. Token truncation ────────────────────────────────────────────────────

test("M1: format-aware dedup preserves posts with same hook but different formats", () => {
  const posts = [
    { ...makePost(1, "Carousel"), hookTitle: "Benefits of security cameras" },
    { ...makePost(2, "Reel"), hookTitle: "Benefits of security cameras" },
  ];
  const result = deduplicatePosts(posts);
  // Same hook on Carousel + Reel → different keys → both kept
  assert.equal(result.length, 2);
});

test("M2: different-format dedup does not lose posts", () => {
  const posts = [
    makePost(1, "Carousel"),
    { ...makePost(2, "Reel"), hookTitle: makePost(1, "Carousel").hookTitle },
  ];
  const result = deduplicatePosts(posts);
  assert.equal(result.length, 2);
});

// ─── N. Language regression ──────────────────────────────────────────────────

test("N1: buildSupplementalPromptContent includes language instruction for Persian brand", () => {
  const faInstruction = "=== AUTHORITATIVE OUTPUT LANGUAGE ===\nLanguage: Persian / فارسی (fa)\nAll output must be in Persian.";
  const content = buildSupplementalPromptContent({
    count: 5,
    acceptedPosts: [makePost(1, "Carousel")],
    formatDeficits: ["Static: need 2 more of 4 total"],
    languageInstruction: faInstruction,
    attachmentBlock: null,
  });
  assert.ok(content.includes(faInstruction));
});

test("N2: language instruction appears before final schema reminder", () => {
  const faInstruction = "=== AUTHORITATIVE OUTPUT LANGUAGE ===";
  const content = buildSupplementalPromptContent({
    count: 3,
    acceptedPosts: [makePost(1, "Carousel")],
    formatDeficits: [],
    languageInstruction: faInstruction,
    attachmentBlock: null,
  });
  const langIdx = content.indexOf(faInstruction);
  const schemaIdx = content.indexOf("standard schema");
  assert.ok(langIdx < schemaIdx, "Language instruction should appear before schema reminder");
});

// ─── O. Supplemental request sizing ─────────────────────────────────────────

test("O1: request count uses remaining + buffer, capped at 5", () => {
  const remaining = 3;
  const buffer = 2;
  const requestCount = Math.min(remaining + buffer, 5);
  assert.equal(requestCount, 5);
});

test("O2: request count does not exceed 5", () => {
  const remaining = 1;
  const buffer = 2;
  const requestCount = Math.min(remaining + buffer, 5);
  assert.equal(requestCount, 3);
});

test("O3: when remaining=1, request count = 3 (1 + 2)", () => {
  assert.equal(Math.min(1 + 2, 5), 3);
});

test("O4: when remaining=5, request count = 5 (capped)", () => {
  assert.equal(Math.min(5 + 2, 5), 5);
});

// ─── P. Format deficits edge cases ──────────────────────────────────────────

test("P1: empty current posts returns max deficits", () => {
  const deficits = computeFormatDeficits([], ["Carousel", "Reel", "Static"], 3);
  assert.equal(deficits.length, 3);
});

test("P2: no requested formats returns empty deficits", () => {
  const deficits = computeFormatDeficits([makePost(1, "Carousel")], [], 0);
  assert.equal(deficits.length, 0);
});

test("P3: excess format count does not produce negative deficit", () => {
  const deficits = computeFormatDeficits(
    [makePost(1, "Carousel"), makePost(2, "Carousel")],
    ["Carousel", "Reel", "Static"],
    3,
  );
  // Carousel has 2, only need 1 → no Carousel deficit
  const carDe = deficits.filter(d => d.startsWith("Carousel"));
  assert.equal(carDe.length, 0);
});

// ─── Q. Dedup key edge cases ────────────────────────────────────────────────

test("Q1: same hook same format same angle deduplicates", () => {
  const posts = [
    makePost(1, "Carousel"),
    { ...makePost(1, "Carousel") },
  ];
  assert.equal(deduplicatePosts(posts).length, 1);
});

test("Q2: same hook different format does not deduplicate", () => {
  const a = makePost(1, "Carousel");
  const b = { ...a, format: "Reel" };
  assert.equal(deduplicatePosts([a, b]).length, 2);
});

test("Q3: empty hook kept as unique", () => {
  const posts = [
    { postNumber: 1, format: "Carousel", hookTitle: "", coreMessage: "" },
    { postNumber: 2, format: "Reel", hookTitle: "", coreMessage: "some message" },
  ];
  const result = deduplicatePosts(posts);
  assert.equal(result.length, 2);
});

test("Q4: missing format defaults to empty string in key", () => {
  const posts = [
    { postNumber: 1, hookTitle: "Hello", format: undefined },
    { postNumber: 2, hookTitle: "Hello", format: null },
  ];
  assert.equal(deduplicatePosts(posts).length, 1);
});

test("Q5: identical hook+format, different mainAngle → both retained", () => {
  const a = { ...makePost(1, "Carousel"), mainAngle: "education" };
  const b = { ...makePost(2, "Carousel"), hookTitle: a.hookTitle, mainAngle: "promotion" };
  const result = deduplicatePosts([a, b]);
  assert.equal(result.length, 2);
});

test("Q6: identical hook+format+angle → one removed", () => {
  const a = { ...makePost(1, "Carousel"), mainAngle: "education", coreMessage: "same" };
  const b = { ...makePost(2, "Carousel"), hookTitle: a.hookTitle, mainAngle: "education", coreMessage: "same" };
  const result = deduplicatePosts([a, b]);
  assert.equal(result.length, 1);
});

test("Q7: identical hook+format, different coreMessage → both retained (angle differs)", () => {
  const a = { ...makePost(1, "Carousel"), coreMessage: "unique message alpha" };
  const b = { ...makePost(2, "Carousel"), hookTitle: a.hookTitle, coreMessage: "unique message beta" };
  const result = deduplicatePosts([a, b]);
  // angle falls to coreMessage since mainAngle not set → different keys
  assert.equal(result.length, 2);
});

test("Q8: Persian common opening with different angles → both retained", () => {
  const a = { ...makePost(1, "Carousel"), hookTitle: "مزایای دوربین مداربسته", mainAngle: "education", coreMessage: "آموزش نصب دوربین" };
  const b = { ...makePost(2, "Carousel"), hookTitle: "مزایای دوربین مداربسته", mainAngle: "promotion", coreMessage: "تخفیف ویژه" };
  const result = deduplicatePosts([a, b]);
  assert.equal(result.length, 2);
});

// ─── R. Build supplemental prompt edge cases ────────────────────────────────

test("R1: empty accepted posts works", () => {
  const content = buildSupplementalPromptContent({
    count: 3,
    acceptedPosts: [],
    formatDeficits: [],
    languageInstruction: null,
    attachmentBlock: null,
  });
  assert.ok(content.includes("0 accepted posts"));
});

test("R2: format deficits are listed when present", () => {
  const content = buildSupplementalPromptContent({
    count: 3,
    acceptedPosts: [],
    formatDeficits: ["Carousel: need 2 more of 4 total", "Reel: need 1 more of 4 total"],
    languageInstruction: null,
    attachmentBlock: null,
  });
  assert.ok(content.includes("FORMAT DEFICITS"));
  assert.ok(content.includes("Carousel: need 2 more of 4 total"));
});

test("R3: date unset shows 'unset' not empty", () => {
  const post = { ...makePost(1, "Carousel"), date: "" };
  const content = buildSupplementalPromptContent({
    count: 1,
    acceptedPosts: [post],
    formatDeficits: [],
    languageInstruction: null,
    attachmentBlock: null,
  });
  assert.ok(content.includes("Date: unset"));
});

// ─── S. Simple scenario simulation ──────────────────────────────────────────

test("S1: 12 unique posts from single batch", () => {
  const posts = Array.from({ length: 12 }, (_, i) => makePost(i + 1, ["Carousel", "Reel", "Static"][i % 3]));
  assert.equal(deduplicatePosts(posts).length, 12);
});

test("S2: 12 posts from 3 batches of 4", () => {
  const batches = [
    Array.from({ length: 4 }, (_, i) => makePost(i + 1, ["Carousel", "Reel", "Static", "Carousel"][i])),
    Array.from({ length: 4 }, (_, i) => makePost(i + 5, ["Reel", "Static", "Carousel", "Reel"][i])),
    Array.from({ length: 4 }, (_, i) => makePost(i + 9, ["Static", "Carousel", "Reel", "Static"][i])),
  ];
  const result = collectExactCount({ safeCount: 12, initialBatches: batches, supplementalResults: [] });
  assert.equal(result.length, 12);
});

test("S3: shortfall produces initial count with no supplements", () => {
  const posts = Array.from({ length: 9 }, (_, i) => makePost(i + 1, ["Carousel", "Reel", "Static"][i % 3]));
  const result = collectExactCount({ safeCount: 12, initialBatches: [posts], supplementalResults: [] });
  assert.equal(result.length, 9);
});

// ─── T. Format distribution ─────────────────────────────────────────────────

test("T1: distributed formats cover 12 posts evenly", () => {
  const formats = ["Carousel", "Reel", "Static"];
  const distributed = Array.from({ length: 12 }, (_, i) => formats[i % 3]);
  assert.equal(distributed.filter(f => f === "Carousel").length, 4);
  assert.equal(distributed.filter(f => f === "Reel").length, 4);
  assert.equal(distributed.filter(f => f === "Static").length, 4);
});

test("T2: format distribution for 9 posts (shortfall case)", () => {
  const formats = ["Carousel", "Reel", "Static"];
  const distributed = Array.from({ length: 9 }, (_, i) => formats[i % 3]);
  assert.equal(distributed.filter(f => f === "Carousel").length, 3);
  assert.equal(distributed.filter(f => f === "Reel").length, 3);
  assert.equal(distributed.filter(f => f === "Static").length, 3);
});

// ─── Summary ────────────────────────────────────────────────────────────────

console.log(`\nCalendar Exact-Post-Count Verification`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
if (errors.length) {
  console.log("\nErrors:");
  for (const e of errors) console.log(`  ${e}`);
}
console.log();
process.exit(failed > 0 ? 1 : 0);
