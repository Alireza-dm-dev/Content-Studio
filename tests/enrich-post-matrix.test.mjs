// Enrich post across BOTH regeneration routes, on carousel (and static) posts.
//
// tests/enrich-post-route.test.mjs covers the saved route for a static post and
// tests/enrich-post.test.mjs the prompt. This file adds what was missing:
//   - the UNSAVED route (/api/content-calendar/regenerate-post) had no Enrich test
//   - a CAROUSEL post (slide structure must survive Enrich untouched)
//   - Enrich must not be affected by the change_slide_count scope that shares the
//     same routes (no newSlideCount, no slide validation, no slide-count prompt)
//   - failures / invalid provider output write nothing
//   - the access matrix: brand access decides, calendar status does not

import { test, mock } from "node:test";
import assert from "node:assert/strict";

const SIX = Array.from({ length: 6 }, (_, i) => ({
  slideNumber: i + 1, slideRole: i === 0 ? "Hook" : i === 5 ? "CTA" : "Body",
  fields: { main_headline: `Headline ${i + 1}`, supporting_text: `Detail ${i + 1}` },
}));
const META = {
  hookTitle: "Is your CCTV recording?",
  mainAngle: "education",
  coreMessage: "A camera that looks fine can fail silently.",
  caption: "Silent failures are common.\nContact us.\n\n#cctv #security #london",
  hashtags: ["#cctv", "#security", "#london"],
  hashtagsMergedIntoCaption: true,
  imageText: "image text",
  outputImageTextRequirements: "Slide 1: {main_headline: 'Headline 1'}",
  outputImageTextRequirementsStructured: { type: "carousel", slides: SIX },
  structure: "carousel layout",
  textOnVideo: "keep me",
  narrationOrDialogueOfCharacterOrCharacters: "narration",
  cameraMovement: "push in",
};
const CONTENT_STRUCTURE = SIX.map(s => `Slide ${s.slideNumber}: ${s.slideRole} — c${s.slideNumber}`).join("\n");
const VISUAL = "Overall: navy. " + SIX.map(s => `Slide ${s.slideNumber}: v${s.slideNumber}.`).join(" ");
const POST_ROW = {
  id: "post-1", calendarId: "cal-1", postNumber: 3, date: new Date("2026-05-02"),
  platform: "Instagram", format: "Carousel", status: "approved",
  suggestedHook: META.hookTitle, suggestedCaption: META.caption, hashtags: "#cctv #security #london",
  visualDirection: VISUAL, contentStructure: CONTENT_STRUCTURE,
  outputImageTextRequirements: META.outputImageTextRequirements,
  postData: JSON.stringify(META),
  calendar: { brandId: "brand-1", allowTx: false, status: "draft", mainMonthlySubject: "Spring", mainGoal: "g", mainOfferOrMessage: "o" },
};

const state = { user: { id: "u1", role: "admin" }, calendarStatus: "draft", brandId: "brand-1", ai: null, prompt: null, aiCalls: 0, updates: [], forbiddenTouched: [] };
const trap = (name) => async () => { state.forbiddenTouched.push(name); throw new Error(`${name} must not be touched by Enrich`); };

// Mirrors lib/auth.getBrandCalendarAccess: no session 401; admin allowed; a user is
// allowed only for brands assigned to them (u2 → brand-1); everyone else 403.
const ASSIGNED = { u2: ["brand-1"] };
mock.module("@/lib/auth", {
  exports: {
    getCurrentUser: async () => state.user,
    getBrandCalendarAccess: async (brandId) => {
      if (!state.user) return { allowed: false, error: "Authentication required", status: 401 };
      if (state.user.role === "admin") return { allowed: true, isAdmin: true, user: state.user };
      if ((ASSIGNED[state.user.id] || []).includes(brandId)) return { allowed: true, isAdmin: false, user: state.user };
      return { allowed: false, error: "You do not have access to this brand.", status: 403 };
    },
  },
});
mock.module("@/lib/prisma", {
  exports: {
    prisma: {
      calendarPost: {
        findUnique: async () => ({ ...POST_ROW, calendar: { ...POST_ROW.calendar, status: state.calendarStatus, brandId: state.brandId } }),
        update: async ({ where, data }) => { state.updates.push({ where, data }); return { ...POST_ROW, ...data }; },
      },
      // Anything generated for the post must be left alone: touching these throws.
      generatedMedia: { update: trap("generatedMedia.update"), updateMany: trap("generatedMedia.updateMany"), delete: trap("generatedMedia.delete") },
      generatedPrompt: { update: trap("generatedPrompt.update"), updateMany: trap("generatedPrompt.updateMany"), delete: trap("generatedPrompt.delete") },
      combinedVisualDirection: { updateMany: trap("combinedVisualDirection.updateMany") },
      // Enrich never opens a transaction; only change_slide_count does (opt-in per test).
      $transaction: async (fn) => {
        if (!state.allowTx) return trap("$transaction")();
        return fn({
          calendarPost: { update: async ({ where, data }) => { state.updates.push({ where, data }); return { ...POST_ROW, ...data }; } },
          generatedMedia: { findMany: async () => [] },
          generatedPrompt: { findMany: async () => [] },
          combinedVisualDirection: { updateMany: async () => ({ count: 0 }) },
        });
      },
      uploadedFile: { findMany: async () => [] },
      brand: { findUnique: async () => ({ id: "brand-1", name: "CUCCTV", contentLanguage: "en" }) },
      brandIdentity: { findFirst: async () => null },
    },
  },
});
mock.module("@/lib/calendar-attachment-context", { exports: { resolveCalendarAttachmentContext: async () => ({ ok: true, block: "REF_MARKER_ENRICH" }) } });
mock.module("@/lib/ai", { exports: { generateWithPromptTemplate: async (o) => { state.prompt = o.userInput; state.aiCalls++; return state.ai(); } } });

const saved = await import("../app/api/calendar-posts/[id]/regenerate/route.js");
const unsaved = await import("../app/api/content-calendar/regenerate-post/route.js");

const ENRICHED = { postNumber: 3, hookTitle: "Is your CCTV recording — or just switched on?", coreMessage: "A live image can hide a recorder that stopped writing footage.", caption: "A camera that powers on is not a camera that records.\n\nA maintenance visit checks recorder health and storage retention.\n\nContact us." };
const okAi = (extra = {}) => async () => ({ raw: JSON.stringify({ ...ENRICHED, ...extra }) });
const reset = () => { state.user = { id: "u1", role: "admin" }; state.calendarStatus = "draft"; state.brandId = "brand-1"; state.allowTx = false; state.prompt = null; state.aiCalls = 0; state.updates = []; state.forbiddenTouched = []; };
const post = (body) => new Request("https://app.test/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const callSaved = (body) => saved.POST(post(body), { params: Promise.resolve({ id: "post-1" }) });
const UNSAVED_POST = { ...META, postNumber: 3, date: "2026-05-02", platform: "Instagram", format: "Carousel", status: "Approved", contentStructure: CONTENT_STRUCTURE, visualDirection: VISUAL };
const callUnsaved = (body) => unsaved.POST(post({ post: UNSAVED_POST, brandId: "brand-1", calendarContext: { mainMonthlySubject: "Spring" }, ...body }));

// ── Saved route, carousel post ────────────────────────────────────────────────

test("saved: enrich_post on a carousel succeeds with the enrichment prompt, without newSlideCount", async () => {
  reset(); state.ai = okAi();
  const res = await callSaved({ scope: "enrich_post", brandId: "brand-1", calendarId: "cal-1" });
  const data = await res.json();
  assert.equal(res.status, 200, JSON.stringify(data));
  assert.equal(data.scope, "enrich_post");
  assert.ok(state.prompt.includes("=== TASK: ENRICH THIS POST ==="));
  assert.ok(state.prompt.includes("REF_MARKER_ENRICH"));
  assert.ok(!state.prompt.includes("CHANGE SLIDE COUNT"));
  assert.ok(!("sourceMapping" in data) && !("slideCount" in data) && !("staleOutputs" in data), "enrich must not return slide-count results");
});

test("saved: slide-count inputs are irrelevant to enrich (invalid newSlideCount / instruction ignored, no 400)", async () => {
  reset(); state.ai = okAi();
  const res = await callSaved({ scope: "enrich_post", newSlideCount: 99, slideCountInstruction: "x".repeat(5000) });
  assert.equal(res.status, 200);
  assert.equal(state.updates.length, 1);
});

test("saved: only hook, core message and caption change; everything else, including the slide structure, is preserved", async () => {
  reset(); state.ai = okAi();
  const res = await callSaved({ scope: "enrich_post" });
  const data = await res.json();
  const { data: written } = state.updates[0];
  const meta = JSON.parse(written.postData);

  assert.equal(written.suggestedHook, ENRICHED.hookTitle);
  assert.equal(meta.coreMessage, ENRICHED.coreMessage);
  assert.ok(written.suggestedCaption.startsWith("A camera that powers on"));

  assert.equal(meta.mainAngle, META.mainAngle);
  assert.deepEqual(meta.hashtags, META.hashtags);
  assert.equal(written.hashtags, "#cctv #security #london");
  assert.ok(written.suggestedCaption.trimEnd().endsWith("#cctv #security #london"));
  assert.equal(written.contentStructure, CONTENT_STRUCTURE);
  assert.equal(written.visualDirection, VISUAL);
  assert.equal(written.outputImageTextRequirements, META.outputImageTextRequirements);
  assert.deepEqual(meta.outputImageTextRequirementsStructured, META.outputImageTextRequirementsStructured);
  assert.equal(meta.outputImageTextRequirementsStructured.slides.length, 6);
  assert.equal(meta.imageText, META.imageText);
  for (const k of ["textOnVideo", "narrationOrDialogueOfCharacterOrCharacters", "cameraMovement", "structure"]) assert.equal(meta[k], META[k], k);
  for (const k of ["date", "platform", "format", "status", "postNumber", "id", "calendarId"]) assert.ok(!(k in written), `${k} must not be written`);
  assert.equal(data.post.format, "Carousel");
  assert.equal(state.forbiddenTouched.length, 0);
});

test("saved: a model that returns slide-count / visual / hashtag fields cannot change them", async () => {
  reset();
  state.ai = okAi({
    slides: [{ slideNumber: 1, sourceSlides: [1], contentStructure: "x", visualDirection: "y", fields: { main_headline: "z" } }],
    contentStructure: "Slide 1: hacked", visualDirection: "hacked", hashtags: ["#hacked"], mainAngle: "hacked", format: "Static",
    outputImageTextRequirementsStructured: { type: "static", items: [{ main_headline: "hacked" }] }, imageText: "hacked", textOnVideo: "hacked",
  });
  const res = await callSaved({ scope: "enrich_post" });
  assert.equal(res.status, 200);
  const { data: written } = state.updates[0];
  const meta = JSON.parse(written.postData);
  assert.equal(written.contentStructure, CONTENT_STRUCTURE);
  assert.equal(written.visualDirection, VISUAL);
  assert.deepEqual(meta.hashtags, META.hashtags);
  assert.equal(meta.mainAngle, META.mainAngle);
  assert.equal(meta.outputImageTextRequirementsStructured.type, "carousel");
  assert.equal(meta.textOnVideo, META.textOnVideo);
  assert.ok(!("format" in written));
});

test("saved: provider failure and invalid provider output write nothing", async () => {
  const broken = [
    async () => { throw new Error("provider down"); },
    async () => ({ raw: "not json" }),
    async () => ({ raw: "" }),
  ];
  for (const impl of broken) {
    reset(); state.ai = impl;
    const res = await callSaved({ scope: "enrich_post" });
    assert.equal(res.status, 500);
    assert.equal((await res.json()).success, false);
    assert.equal(state.updates.length, 0);
  }
});

// ── Unsaved route ─────────────────────────────────────────────────────────────

test("unsaved: enrich_post succeeds without newSlideCount and replaces only hook, core message and caption", async () => {
  reset(); state.ai = okAi();
  const res = await callUnsaved({ scope: "enrich_post", attachmentIds: [] });
  const data = await res.json();
  assert.equal(res.status, 200, JSON.stringify(data));
  assert.equal(data.scope, "enrich_post");
  assert.ok(state.prompt.includes("=== TASK: ENRICH THIS POST ==="));
  assert.ok(!state.prompt.includes("CHANGE SLIDE COUNT"));
  assert.equal(state.updates.length, 0, "unsaved flow never writes");

  const p = data.post;
  assert.equal(p.hookTitle, ENRICHED.hookTitle);
  assert.equal(p.coreMessage, ENRICHED.coreMessage);
  assert.ok(p.caption.startsWith("A camera that powers on"));
  assert.deepEqual(p.hashtags, META.hashtags);
  assert.ok(p.caption.trimEnd().endsWith("#cctv #security #london"));
  // every other field is the inline post's, untouched
  for (const k of Object.keys(UNSAVED_POST)) {
    if (["hookTitle", "coreMessage", "caption"].includes(k)) continue;
    assert.deepEqual(p[k], UNSAVED_POST[k], k);
  }
});

test("unsaved: slide-count inputs are ignored; model over-reach is discarded", async () => {
  reset();
  state.ai = okAi({ contentStructure: "hacked", visualDirection: "hacked", hashtags: ["#x"], slides: [], format: "Static", mainAngle: "hacked" });
  const res = await callUnsaved({ scope: "enrich_post", newSlideCount: -4 });
  const p = (await res.json()).post;
  assert.equal(res.status, 200);
  assert.equal(p.contentStructure, CONTENT_STRUCTURE);
  assert.equal(p.visualDirection, VISUAL);
  assert.deepEqual(p.hashtags, META.hashtags);
  assert.equal(p.format, "Carousel");
  assert.equal(p.mainAngle, META.mainAngle);
});

test("unsaved: provider failure / invalid output return an error and no post", async () => {
  for (const impl of [async () => { throw new Error("down"); }, async () => ({ raw: "nope" })]) {
    reset(); state.ai = impl;
    const res = await callUnsaved({ scope: "enrich_post" });
    const data = await res.json();
    assert.equal(res.status, 500);
    assert.equal(data.success, false);
    assert.equal(data.post, undefined);
  }
});

test("unsaved: a static post enriches too", async () => {
  reset(); state.ai = okAi();
  const staticPost = { ...UNSAVED_POST, format: "Static", contentStructure: "Single image", outputImageTextRequirementsStructured: { type: "static", items: [{ main_headline: "H" }] } };
  const res = await unsaved.POST(post({ post: staticPost, brandId: "brand-1", scope: "enrich_post" }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).post.format, "Static");
});

// ── Dispatch isolation: other scopes are unchanged by the slide-count work ──

test("scope dispatch: each scope reaches its own prompt on both routes", async () => {
  const markers = {
    enrich_post: "=== TASK: ENRICH THIS POST ===",
    visual_only: "Regenerate visual direction and production fields",
    visual_ideas_only: "Regenerate visual direction and production fields",
    entire_post: "Full post regeneration",
    custom_instruction: "=== USER INSTRUCTION ===",
    image_text_only: "Your ONLY task is to regenerate outputImageTextRequirementsStructured",
  };
  for (const [scope, marker] of Object.entries(markers)) {
    for (const [route, call] of [["saved", callSaved], ["unsaved", callUnsaved]]) {
      reset(); state.ai = async () => ({ raw: JSON.stringify({ ...ENRICHED, outputImageTextRequirementsStructured: { type: "carousel", slides: SIX } }) });
      const res = await call({ scope, customInstruction: "Make the tone friendlier please." });
      assert.equal(res.status, 200, `${route} ${scope}`);
      assert.ok(state.prompt.includes(marker), `${route} ${scope} prompt`);
      assert.ok(!state.prompt.includes("CHANGE SLIDE COUNT"), `${route} ${scope} must not use the slide-count prompt`);
    }
  }
});

test("change_slide_count still validates its own inputs and is not reachable by enrich", async () => {
  reset(); state.ai = okAi();
  const res = await callSaved({ scope: "change_slide_count" });
  assert.equal(res.status, 400); // newSlideCount required — only for THIS scope
  assert.equal(state.aiCalls, 0);
  const res2 = await callUnsaved({ scope: "change_slide_count", newSlideCount: 99 });
  assert.equal(res2.status, 400);
});

test("an unknown scope is still rejected on both routes", async () => {
  reset(); state.ai = okAi();
  assert.equal((await callSaved({ scope: "enrich" })).status, 400);
  assert.equal((await callUnsaved({ scope: "enrich" })).status, 400);
  assert.equal(state.updates.length, 0);
});

// ── Authorization matrix (saved regeneration) ────────────────────────────────
// Brand access decides; calendar status does NOT. Applies to every scope.

const ADMIN = { id: "u1", role: "admin" };
const ASSIGNED_USER = { id: "u2", role: "user" };   // assigned to brand-1
const UNASSIGNED_USER = { id: "u3", role: "user" }; // assigned to nothing

for (const status of ["draft", "approved"]) {
  test(`access: admin + ${status} calendar → enrich succeeds`, async () => {
    reset(); state.ai = okAi(); state.user = ADMIN; state.calendarStatus = status;
    assert.equal((await callSaved({ scope: "enrich_post" })).status, 200);
  });

  test(`access: assigned user + ${status} calendar → enrich succeeds and changes only hook/core/caption`, async () => {
    reset(); state.ai = okAi(); state.user = ASSIGNED_USER; state.calendarStatus = status;
    const res = await callSaved({ scope: "enrich_post" });
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    const { data: written } = state.updates[0];
    const meta = JSON.parse(written.postData);
    assert.equal(written.suggestedHook, ENRICHED.hookTitle);
    assert.equal(meta.mainAngle, META.mainAngle);
    assert.deepEqual(meta.hashtags, META.hashtags);
    assert.equal(written.contentStructure, CONTENT_STRUCTURE);
    assert.equal(written.visualDirection, VISUAL);
    assert.ok(!("status" in written), "calendar/post status is never written");
  });

  test(`access: unassigned user + ${status} calendar → 403, no provider call, no write`, async () => {
    reset(); state.ai = okAi(); state.user = UNASSIGNED_USER; state.calendarStatus = status;
    for (const scope of ["enrich_post", "visual_only", "entire_post"]) {
      const res = await callSaved({ scope });
      assert.equal(res.status, 403, scope);
    }
    assert.equal(state.aiCalls, 0);
    assert.equal(state.updates.length, 0);
  });
}

test("access: assigned user + approved calendar → every scope is allowed through (not blocked by status)", async () => {
  for (const scope of ["visual_only", "visual_ideas_only", "entire_post", "enrich_post", "image_text_only"]) {
    reset(); state.user = ASSIGNED_USER; state.calendarStatus = "approved";
    state.ai = async () => ({ raw: JSON.stringify({ ...ENRICHED, outputImageTextRequirementsStructured: { type: "carousel", slides: SIX } }) });
    const res = await callSaved({ scope });
    assert.equal(res.status, 200, scope);
  }
  reset(); state.user = ASSIGNED_USER; state.calendarStatus = "approved";
  state.ai = okAi();
  assert.equal((await callSaved({ scope: "custom_instruction", customInstruction: "Make the tone friendlier." })).status, 200);
});

test("access: assigned user + approved calendar → change_slide_count reaches its OWN validation, then succeeds", async () => {
  reset(); state.user = ASSIGNED_USER; state.calendarStatus = "approved"; state.ai = okAi();
  const missing = await callSaved({ scope: "change_slide_count" });
  assert.equal(missing.status, 400);                       // its own rule, not a 403 from status
  assert.match((await missing.json()).error, /required/i);
  const same = await callSaved({ scope: "change_slide_count", newSlideCount: 6 });
  assert.equal(same.status, 400);
  assert.equal((await same.json()).error, "Choose a different slide count.");
  state.aiCalls = 0;
  state.ai = async () => ({ raw: JSON.stringify({ overallVisualDirection: "Overall: navy.", slides: [
    { slideNumber: 1, sourceSlides: [1], slideRole: "Hook", contentStructure: "c1", visualDirection: "v1", fields: { main_headline: "H1", supporting_text: "D1" } },
    { slideNumber: 2, sourceSlides: [2, 3, 4, 5, 6], slideRole: "Body", contentStructure: "c2", visualDirection: "v2", fields: { main_headline: "H2", supporting_text: "D2" } },
  ] }) });
  state.allowTx = true;
  assert.equal((await callSaved({ scope: "change_slide_count", newSlideCount: 2 })).status, 200, "reaches the slide-count feature");
});

test("access: anonymous → 401 for every scope, before any provider call", async () => {
  reset(); state.ai = okAi(); state.user = null;
  for (const scope of ["enrich_post", "visual_only", "change_slide_count"]) {
    const res = await callSaved({ scope, newSlideCount: 3 });
    assert.equal(res.status, 401, scope);
  }
  assert.equal(state.aiCalls, 0);
  assert.equal(state.updates.length, 0);
});

test("access: cross-brand — an assigned user on another brand's calendar → 403 (status irrelevant)", async () => {
  for (const status of ["draft", "approved"]) {
    reset(); state.ai = okAi(); state.user = ASSIGNED_USER; state.brandId = "brand-2"; state.calendarStatus = status;
    assert.equal((await callSaved({ scope: "enrich_post" })).status, 403, status);
    assert.equal(state.aiCalls, 0);
    assert.equal(state.updates.length, 0);
  }
});

test("a request body claiming another brand is still rejected (400), even for an authorized user", async () => {
  reset(); state.ai = okAi(); state.user = ASSIGNED_USER; state.calendarStatus = "approved";
  assert.equal((await callSaved({ scope: "enrich_post", brandId: "brand-2" })).status, 400);
  assert.equal(state.updates.length, 0);
});

test("regeneration never changes the calendar's status", async () => {
  reset(); state.ai = okAi(); state.user = ASSIGNED_USER; state.calendarStatus = "approved";
  await callSaved({ scope: "enrich_post" });
  assert.equal(state.calendarStatus, "approved");
  assert.ok(state.updates.every(u => !("calendar" in u.data) && !("status" in u.data)));
});
