#!/usr/bin/env node
// Focused verification for authoritative Brand output-language support.
//
// Run: node scripts/verify-content-language.js
// Exit 0 on all pass, 1 on any failure.

import assert from "node:assert/strict";
import {
  CONTENT_LANGUAGES,
  DEFAULT_CONTENT_LANGUAGE,
  normalizeLanguageCode,
  isSupportedLanguageCode,
  getLanguageInfo,
  getTextDirection,
  isRtlLanguage,
  buildLanguageInstruction,
} from "../lib/content-language.js";

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

// ─── A. Language definitions ────────────────────────────────────────────────

test("exactly 7 supported language codes", () => {
  assert.equal(CONTENT_LANGUAGES.length, 7);
});

test("no duplicate codes", () => {
  const codes = CONTENT_LANGUAGES.map(l => l.code);
  assert.equal(new Set(codes).size, codes.length);
});

test("default content language is en", () => {
  assert.equal(DEFAULT_CONTENT_LANGUAGE, "en");
});

test("fa and ar are rtl", () => {
  for (const lang of CONTENT_LANGUAGES) {
    if (lang.code === "fa" || lang.code === "ar") {
      assert.equal(lang.direction, "rtl", `${lang.code} should be rtl`);
    } else {
      assert.equal(lang.direction, "ltr", `${lang.code} should be ltr`);
    }
  }
});

// ─── B. Normalization ───────────────────────────────────────────────────────

test('normalizeLanguageCode(" fa ") returns "fa"', () => {
  assert.equal(normalizeLanguageCode(" fa "), "fa");
});

test("normalizeLanguageCode handles case normalization", () => {
  assert.equal(normalizeLanguageCode("FA"), "fa");
  assert.equal(normalizeLanguageCode("Ar"), "ar");
  assert.equal(normalizeLanguageCode("FR"), "fr");
});

test("normalizeLanguageCode null/undefined/empty returns en", () => {
  assert.equal(normalizeLanguageCode(null), "en");
  assert.equal(normalizeLanguageCode(undefined), "en");
  assert.equal(normalizeLanguageCode(""), "en");
  assert.equal(normalizeLanguageCode("   "), "en");
});

test("normalizeLanguageCode unsupported code falls back to en", () => {
  assert.equal(normalizeLanguageCode("zz"), "en");
  assert.equal(normalizeLanguageCode("xyz"), "en");
  assert.equal(normalizeLanguageCode("123"), "en");
});

test("isSupportedLanguageCode rejects null/undefined", () => {
  assert.equal(isSupportedLanguageCode(null), false);
  assert.equal(isSupportedLanguageCode(undefined), false);
});

test("isSupportedLanguageCode rejects empty string", () => {
  assert.equal(isSupportedLanguageCode(""), false);
});

test("isSupportedLanguageCode rejects unsupported code", () => {
  assert.equal(isSupportedLanguageCode("zz"), false);
  assert.equal(isSupportedLanguageCode("xyz"), false);
});

test("isSupportedLanguageCode accepts valid codes", () => {
  assert.equal(isSupportedLanguageCode("en"), true);
  assert.equal(isSupportedLanguageCode("fa"), true);
  assert.equal(isSupportedLanguageCode("ar"), true);
  assert.equal(isSupportedLanguageCode("fr"), true);
});

test('isSupportedLanguageCode rejects human label "Persian"', () => {
  assert.equal(isSupportedLanguageCode("Persian"), false);
  assert.equal(isSupportedLanguageCode("persian"), false);
});

test('normalizeLanguageCode rejects human label "Persian"', () => {
  assert.equal(normalizeLanguageCode("Persian"), "en");
});

// ─── C. Metadata ────────────────────────────────────────────────────────────

test("getLanguageInfo always returns code, label, direction", () => {
  const info = getLanguageInfo("fa");
  assert.ok(info.code);
  assert.ok(info.label);
  assert.ok(info.direction);
});

test("getLanguageInfo on unsupported code defaults to en metadata", () => {
  const info = getLanguageInfo("zz");
  assert.equal(info.code, "en");
  assert.equal(info.direction, "ltr");
});

test("getTextDirection returns only rtl or ltr", () => {
  for (const lang of CONTENT_LANGUAGES) {
    const dir = getTextDirection(lang.code);
    assert.ok(dir === "rtl" || dir === "ltr", `${lang.code} direction should be rtl or ltr`);
  }
});

test("isRtlLanguage is correct", () => {
  assert.equal(isRtlLanguage("fa"), true);
  assert.equal(isRtlLanguage("ar"), true);
  assert.equal(isRtlLanguage("en"), false);
  assert.equal(isRtlLanguage("fr"), false);
  assert.equal(isRtlLanguage("es"), false);
  assert.equal(isRtlLanguage("de"), false);
  assert.equal(isRtlLanguage("nl"), false);
});

// ─── D. Prompt block ────────────────────────────────────────────────────────

test("buildLanguageInstruction contains authoritative heading", () => {
  const block = buildLanguageInstruction("fa");
  assert.ok(block.includes("=== AUTHORITATIVE OUTPUT LANGUAGE ==="));
});

test("buildLanguageInstruction contains selected language label and code", () => {
  const block = buildLanguageInstruction("fa");
  assert.ok(block.includes("Persian / فارسی"));
  assert.ok(block.includes("(fa)"));
});

test("buildLanguageInstruction for English includes English label", () => {
  const block = buildLanguageInstruction("en");
  assert.ok(block.includes("English"));
  assert.ok(block.includes("(en)"));
});

test("buildLanguageInstruction includes no-mixed-language rule", () => {
  const block = buildLanguageInstruction("fa");
  assert.ok(block.includes("Do not mix other languages"));
});

test("buildLanguageInstruction includes proper-name/URL exception", () => {
  const block = buildLanguageInstruction("fa");
  assert.ok(block.includes("proper name"));
  assert.ok(block.includes("URL"));
  assert.ok(block.includes("Brand name"));
});

test("buildLanguageInstruction includes canonical internal-field rule", () => {
  const block = buildLanguageInstruction("fa");
  assert.ok(block.includes("platform"));
  assert.ok(block.includes("format"));
  assert.ok(block.includes("canonical"));
});

test("buildLanguageInstruction states that sources/examples cannot override", () => {
  const block = buildLanguageInstruction("fa");
  assert.ok(block.includes("overrides language inferred"));
});

test("buildLanguageInstruction on unsupported code defaults to English instruction", () => {
  const block = buildLanguageInstruction("zz");
  assert.ok(block.includes("English"));
  assert.ok(block.includes("(en)"));
});

// ─── Summary ────────────────────────────────────────────────────────────────

console.log(`\nContent Language Verification`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
if (errors.length) {
  console.log("\nErrors:");
  for (const e of errors) console.log(`  ${e}`);
}
console.log();
process.exit(failed > 0 ? 1 : 0);
