#!/usr/bin/env node
// Verification script for Brand Assistant UI (Phase 3).
// Dependency-free: inspects source + React component structure.
//
// Run: node scripts/verify-brand-assistant-ui.mjs

import assert from "node:assert/strict";
import fs from "node:fs";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    failed++;
    console.log(`  \u2717 ${name}`);
    const msg = e.message ? e.message.split("\n")[0] : String(e);
    console.log(`    ${msg}`);
  }
}

function testGroup(label, tests) {
  console.log(`\n${label}`);
  for (const [name, fn] of Object.entries(tests)) {
    test(name, fn);
  }
}

const COMPONENT_PATH = "components/BrandAssistant.jsx";
const WORKSPACE_PATH = "app/brand-workspace/WorkspaceClient.jsx";

// ─── A. UI Component Structure ───────────────────────────────────────────────
testGroup("A. UI Component Structure", {
  "BrandAssistant.jsx exists"() {
    assert.ok(fs.existsSync(COMPONENT_PATH));
  },

  "exports default component"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes("export default function BrandAssistant"));
  },

  "client component directive"() {
    const firstLine = fs.readFileSync(COMPONENT_PATH, "utf8").split("\n")[0];
    assert.equal(firstLine.trim(), '"use client";');
  },

  "accepts brandId and brandName props"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes("brandId") && src.includes("brandName"));
  },

  "brand name displayed in header"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes("Based on:") && src.includes("brandName"));
  },

  "has start prompts"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes("Summarise this Brand"));
    assert.ok(src.includes("content themes"));
    assert.ok(src.includes("latest content calendar"));
    assert.ok(src.includes("Suggest a LinkedIn post"));
    assert.ok(src.includes("missing from this Brand profile"));
  },

  "starter prompts call sendMessage"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes("handleStarter"));
  },

  "has textarea input"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes("textarea"));
  },

  "has Send button"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes("Send"));
  },

  "has Clear button"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes("Clear"));
  },

  "has Stop button"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes("Stop"));
  },

  "has loading indicator"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes("thinking"));
  },

  "has retry button"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes("Retry"));
  },

  "uses AbortController"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes("AbortController"));
    assert.ok(src.includes("abort()"));
  },

  "has duplicate-submit guard"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes("submittedRef"));
  },

  "has mounted ref guard"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes("mountedRef"));
  },

  "Enter sends, Shift+Enter newline"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes('e.key === "Enter"'));
    assert.ok(src.includes("e.shiftKey"));
  },

  "empty message cannot submit"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes("!input.trim()"));
  },

  "2000 char limit enforced"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes("MAX_MSG_CHARS"));
  },

  "char count shown near limit"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes("charsRemaining"));
  },

  "accessibility labels on buttons"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes("aria-label"));
  },

  "source chips rendered"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes("sources"));
    assert.ok(src.includes("typeIcon"));
  },

  "empty state text present"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes("Ask about this Brand"));
  },

  "max 20 visible messages"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes("MAX_VISIBLE") || src.includes("20"));
  },

  "max 8 history messages sent to API"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes("MAX_HISTORY") || src.includes("buildHistoryPayload"));
  },

  "history total chars bounded"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes("MAX_HISTORY_TOTAL_CHARS"));
  },

  "no localStorage"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(!src.includes("localStorage"));
    assert.ok(!src.includes("sessionStorage"));
  },

  "no cookies"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(!src.includes("document.cookie"));
  },

  "handles 401 response"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes("401") || src.includes("Sign in again"));
  },

  "handles 403 response"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes("403") || src.includes("do not have access"));
  },

  "handles 429 response"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes("429") || src.includes("Too many chat requests"));
  },

  "handles 504 response"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes("504") || src.includes("timed out"));
  },

  "handles 502/503 response"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes("502") || src.includes("503") || src.includes("temporarily unavailable"));
  },

  "handles abort error without showing failure"() {
    const src = fs.readFileSync(COMPONENT_PATH, "utf8");
    assert.ok(src.includes("AbortError"));
  },
});

// ─── B. Workspace Integration ────────────────────────────────────────────────
testGroup("B. Workspace Integration", {
  "WorkspaceClient.jsx imports BrandAssistant"() {
    const src = fs.readFileSync(WORKSPACE_PATH, "utf8");
    assert.ok(src.includes('import BrandAssistant'));
  },

  "BrandAssistant rendered with brand.id and brand.name"() {
    const src = fs.readFileSync(WORKSPACE_PATH, "utf8");
    assert.ok(src.includes("<BrandAssistant"));
    assert.ok(src.includes("brandId={brand.id}"));
    assert.ok(src.includes("brandName={brand.name}"));
  },

  "rendered after Quick actions section"() {
    const src = fs.readFileSync(WORKSPACE_PATH, "utf8");
    // Search for JSX usage (<BrandAssistant), not the import line
    const jsxIdx = src.indexOf("<BrandAssistant");
    const qaIdx = src.indexOf("Quick Actions");
    assert.ok(jsxIdx >= 0 && qaIdx >= 0);
    assert.ok(jsxIdx > qaIdx, "BrandAssistant JSX should appear after Quick Actions in source");
  },

  "rendered before Calendar section"() {
    const src = fs.readFileSync(WORKSPACE_PATH, "utf8");
    const baIdx = src.indexOf("BrandAssistant");
    const calIdx = src.indexOf("CalendarSection");
    assert.ok(baIdx >= 0 && calIdx >= 0);
    assert.ok(baIdx < calIdx, "BrandAssistant should appear before Calendar section");
  },
});

// ─── Results ─────────────────────────────────────────────────────────────────
runAll();

function runAll() {
  const total = passed + failed;
  console.log(`\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
  console.log(`UI verification: ${passed} passed, ${failed} failed (${total} total)`);
  if (failed > 0) process.exit(1);
}
