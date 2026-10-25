// Instagram calendar image prompts must never contain ratio / orientation /
// pixel-size text. Exercises the shared sanitizer plus the real route handlers
// (prisma, auth and AI mocked) for the saved-post, refinement, reference-image
// and fallback paths. Technical size settings and video routes are asserted
// unchanged.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const state = { capturedUserInput: null, aiContent: "", post: {}, cvd: {} };

mock.module("@/lib/brand-access", {
  exports: {
    requireResourceBrandAccess: async () => ({ ok: true, user: { id: "u1", role: "admin" }, status: 200 }),
  },
});
mock.module("@/lib/prisma", {
  exports: {
    prisma: {
      contentCalendar: { findUnique: async () => ({ id: "c1", mainMonthlySubject: "Coffee" }) },
      calendarPost: { findUnique: async () => state.post },
      brand: { findUnique: async () => ({ id: "b1", name: "Bloom" }) },
      brandIdentity: { findFirst: async () => ({ id: "i1", jsonOutput: "{}" }) },
      combinedVisualDirection: {
        findUnique: async () => state.cvd,
        update: async () => ({}),
        findMany: async () => [],
        deleteMany: async () => ({}),
      },
      referenceImageAnalysis: { findUnique: async () => null },
      generatedPrompt: { create: async ({ data }) => ({ id: "g1", ...data }) },
    },
  },
});
mock.module("@/lib/ai", {
  exports: {
    generateWithPromptTemplate: async (opts) => {
      state.capturedUserInput = opts.userInput;
      return { content: state.aiContent };
    },
  },
});

import { stripImageRatioText, isInstagramPlatform, NO_IMAGE_RATIO_INSTRUCTION } from "@/lib/image-prompt-ratio";

const BANNED = [/1:1/, /1\*1/, /square/i, /1080\s*x\s*1080/i, /aspect ratio/i, /4:5/, /9:16/, /16:9/];
function assertRatioFree(text) {
  for (const re of BANNED) assert.ok(!re.test(text), `still contains ${re}: ${text}`);
}

const DIRTY_EN = [
  "Create a professional Instagram post in 1:1 aspect ratio featuring a steaming latte on a marble table, warm window light.",
  "Square Instagram image with bold headline space at the top.",
  "Canvas: 1080x1080 px, ratio 1*1, square format.",
  "Visual Production Controls:",
  "- Lighting: soft golden hour",
  "- Aspect ratio / format: 4:5 portrait",
  "Also works at 9:16 vertical format.",
].join("\n");

const DIRTY_FA = "ایجاد پست اینستاگرام با نسبت 1*1 و نور گرم، square format. یک فنجان قهوه روی میز با ابعاد 1080x1080";

test("sanitizer removes ratio text but keeps visual direction (English)", () => {
  const out = stripImageRatioText(DIRTY_EN);
  assertRatioFree(out);
  assert.match(out, /professional Instagram post featuring a steaming latte on a marble table/);
  assert.match(out, /warm window light/);
  assert.match(out, /Lighting: soft golden hour/);
  assert.match(out, /bold headline space at the top/);
});

test("sanitizer handles Persian posts", () => {
  const out = stripImageRatioText(DIRTY_FA);
  assertRatioFree(out);
  assert.match(out, /فنجان قهوه روی میز/);
  assert.match(out, /نور گرم/);
});

test("sanitizer leaves clock times and unrelated text alone", () => {
  const t = "Doors open at 10:30. Golden ratio layout.";
  assert.equal(stripImageRatioText(t), t);
  assert.ok(isInstagramPlatform("Instagram Reels"));
  assert.ok(!isInstagramPlatform("LinkedIn"));
});

let imageRoute;
async function callImageRoute({ platform, body = {}, ai = DIRTY_EN, post = {} }) {
  imageRoute ??= await import("../app/api/content-calendar/[calendarId]/posts/[postId]/image-prompt/route.js");
  state.post = {
    id: "p1", platform, format: "Single image square 1:1", hookTitle: "Morning ritual",
    visualDirection: "Latte on marble, 1080x1080 square", coreMessage: "Start slow", ...post,
  };
  state.aiContent = ai;
  const req = new Request("http://x/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ brandId: "b1", ...body }),
  });
  const res = await imageRoute.POST(req, { params: Promise.resolve({ calendarId: "c1", postId: "p1" }) });
  return res.json();
}

test("saved Instagram post: generated prompt and AI input are ratio-free", async () => {
  const data = await callImageRoute({
    platform: "Instagram",
    body: { visualControls: { aspectRatio: "1:1", lighting: "auto" } },
  });
  assert.equal(data.success, true);
  assertRatioFree(data.generatedPrompt.finalPrompt);
  assert.match(data.generatedPrompt.finalPrompt, /steaming latte on a marble table/);
  assert.ok(state.capturedUserInput.includes(NO_IMAGE_RATIO_INSTRUCTION));
  const sentToModel = state.capturedUserInput.replace(NO_IMAGE_RATIO_INSTRUCTION, "");
  assertRatioFree(sentToModel);
  assert.match(sentToModel, /Morning ritual/);
});

test("Instagram regeneration (refinement) is ratio-free", async () => {
  const data = await callImageRoute({
    platform: "Instagram",
    body: { currentPrompt: "Old prompt, square 1:1 canvas.", refinementFeedback: "Make it warmer" },
  });
  assert.equal(data.success, true);
  assert.match(data.generatedPrompt.mode, /_refined$/);
  assertRatioFree(data.generatedPrompt.finalPrompt);
  assertRatioFree(state.capturedUserInput.replace(NO_IMAGE_RATIO_INSTRUCTION, ""));
});

test("Persian Instagram post is ratio-free", async () => {
  const data = await callImageRoute({
    platform: "Instagram", ai: DIRTY_FA,
    post: { hookTitle: "صبح قهوه", visualDirection: "فنجان قهوه، قالب مربع" },
  });
  assertRatioFree(data.generatedPrompt.finalPrompt);
  assert.match(data.generatedPrompt.finalPrompt, /فنجان قهوه/);
});

test("other platforms are unchanged", async () => {
  const data = await callImageRoute({
    platform: "LinkedIn", body: { visualControls: { aspectRatio: "1:1" } },
  });
  assert.equal(data.generatedPrompt.finalPrompt, DIRTY_EN);
  assert.ok(!state.capturedUserInput.includes(NO_IMAGE_RATIO_INSTRUCTION));
  assert.match(state.capturedUserInput, /Aspect ratio \/ format: 1:1/);
});

test("reference-image / fallback composition path (Instagram calendar) is ratio-free", async () => {
  const cvdRoute = await import("../app/api/image/combined-visual-direction/[id]/create-nanobanana-prompt/route.js");
  state.cvd = {
    id: "v1", brandId: "b1", calendarPostId: "p1", sourceFlow: "calendar_post_reference_image_mode",
    rawIdeaOrPostInformation: "Hook: Morning ritual\nPlatform: Instagram",
    combinedVisualDirectionJson: JSON.stringify({ combined_visual_direction: { summary: "Latte, 1:1 square layout" } }),
    textRequirements: "Headline: Start slow",
  };
  state.aiContent = DIRTY_EN;
  const req = new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const res = await cvdRoute.POST(req, { params: Promise.resolve({ id: "v1" }) });
  const data = await res.json();
  assert.equal(data.success, true, JSON.stringify(data));
  assertRatioFree(data.finalNanobananaPrompt);
  assert.match(data.finalNanobananaPrompt, /steaming latte/);
});

test("technical size settings and video prompts are untouched", () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const openai = read("app/api/openai/generate-image/route.js");
  assert.match(openai, /"ig-post-4-5": "an Instagram Post \(4:5\)"/);
  assert.match(openai, /square: "a Square post"/);
  assert.match(read("lib/higgsfield.js"), /aspect_ratio: aspectRatio \?\? "9:16"/);
  assert.match(read("lib/image-visual-controls.js"), /\{ value: "1:1", label: "1:1" \}/);
  for (const f of [
    "app/api/content-calendar/[calendarId]/posts/[postId]/video-prompt/route.js",
    "app/api/content-calendar/[calendarId]/posts/[postId]/video-storyboard/route.js",
  ]) {
    const src = read(f);
    assert.ok(!src.includes("image-prompt-ratio"));
    assert.match(src, /`Aspect ratio: \$\{aspectRatio\}`/);
  }
});

// ── Optional visualControls ───────────────────────────────────────────────────
for (const [label, body] of [
  ["omitted", {}],
  ["null", { visualControls: null }],
  ["empty object", { visualControls: {} }],
  ["real selections", { visualControls: { aspectRatio: "1:1", lighting: "natural-soft", cinematicStyle: "auto" } }],
]) {
  test(`visualControls ${label}: route succeeds and Instagram prompt stays ratio-free`, async () => {
    const data = await callImageRoute({ platform: "Instagram", body });
    assert.equal(data.success, true, JSON.stringify(data));
    assertRatioFree(data.generatedPrompt.finalPrompt);
    assertRatioFree(state.capturedUserInput.replace(NO_IMAGE_RATIO_INSTRUCTION, ""));
  });
}

test("LinkedIn with omitted visualControls still succeeds, unchanged", async () => {
  const data = await callImageRoute({ platform: "LinkedIn" });
  assert.equal(data.success, true);
  assert.equal(data.generatedPrompt.finalPrompt, DIRTY_EN);
});

test("non-object visualControls is still rejected with 400", async () => {
  imageRoute ??= await import("../app/api/content-calendar/[calendarId]/posts/[postId]/image-prompt/route.js");
  const req = new Request("http://x/api", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ brandId: "b1", visualControls: "nope" }),
  });
  const res = await imageRoute.POST(req, { params: Promise.resolve({ calendarId: "c1", postId: "p1" }) });
  assert.equal(res.status, 400);
});

// ── Contextual sanitization ───────────────────────────────────────────────────
test("visual ratio notation is removed in context", () => {
  for (const t of [
    "Soft light, aspect ratio 1:1, warm tones.",
    "Warm tones with ratio 1:1 and soft light.",
    "Warm tones, 1:1 aspect ratio, soft light.",
    "A square 1:1 image of a cafe at dawn.",
    "An Instagram 1:1 format cafe scene at dawn.",
    "Canvas 1:1 with a latte on a marble table.",
    "Output 1:1 with moody cafe lighting inside.",
    "Delivery format: 1:1 plus warm cafe lighting here.",
    "Latte on marble in 4:5 with warm light.",
    "Cafe interior in 9:16 with warm light.",
    "Cafe interior at 16:9 cinematic framing wide.",
    "Latte on marble, 1080x1080, warm light.",
    "Cafe scene in portrait format with warm light.",
    "Cafe scene in landscape format with warm light.",
    "Cafe scene in square format with warm light.",
    "- Aspect ratio / format: 1:1\n- Lighting: soft",
  ]) assertRatioFree(stripImageRatioText(t));
  assert.equal(stripImageRatioText("- Aspect ratio / format: 1:1\n- Lighting: soft"), "- Lighting: soft");
});

test("legitimate non-image 1:1, times and square objects survive", () => {
  for (const t of [
    "Offer 1:1 coaching to every founder.",
    "Book a 1:1 consultation this week.",
    "Free 1:1 support for members.",
    "One-to-one / 1:1 training sessions daily.",
    "Doors open at 10:30 sharp.",
    "A square logo sits in the corner.",
  ]) assert.equal(stripImageRatioText(t), t);
});

test("Persian: ratio instructions removed, normal numeric text preserved", () => {
  assertRatioFree(stripImageRatioText("ابعاد 1:1 با نور گرم، نسبت 1:1 و نسبت 4:5 پست"));
  assert.match(stripImageRatioText("ابعاد 1:1 با نور گرم"), /نور گرم/);
  const keep = "جلسه 1:1 مشاوره ساعت 10:30 با لوگوی مربع";
  assert.equal(stripImageRatioText(keep), keep);
});
