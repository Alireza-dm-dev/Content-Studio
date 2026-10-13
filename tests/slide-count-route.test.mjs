// Route tests for the change_slide_count scope on BOTH regeneration paths:
//   saved   POST /api/calendar-posts/[id]/regenerate
//   unsaved POST /api/content-calendar/regenerate-post
// Prompt/validator details live in tests/slide-count.test.mjs.

import { test, mock } from "node:test";
import assert from "node:assert/strict";

const ROLES = ["Hook", "Problem", "Cause", "Explanation", "Benefit", "CTA"];
const six = Array.from({ length: 6 }, (_, i) => ({
  slideNumber: i + 1,
  slideRole: ROLES[i],
  fields: { main_headline: `Headline ${i + 1}`, supporting_text: `Detail ${i + 1}` },
}));

const ORIGINAL_META = {
  hookTitle: "Is your CCTV recording?",
  mainAngle: "education",
  coreMessage: "A camera that looks fine can fail silently.",
  caption: "Silent failures are common.\nContact us.\n\n#cctv #security",
  hashtags: ["#cctv", "#security"],
  hashtagsMergedIntoCaption: true,
  imageText: "old image text",
  outputImageTextRequirements: "old oitr",
  outputImageTextRequirementsStructured: { type: "carousel", slides: six },
  structure: "carousel layout",
  narrationOrDialogueOfCharacterOrCharacters: "",
  textOnVideo: "keep me",
  visualMood: "calm",
};

const CONTENT_STRUCTURE = six.map(s => `Slide ${s.slideNumber}: ${s.slideRole} — source ${s.slideNumber}`).join("\n");
const VISUAL = "Overall carousel visual system: navy. " + six.map(s => `Slide ${s.slideNumber}: v${s.slideNumber}.`).join(" ");

const POST_ROW = {
  id: "post-1",
  calendarId: "cal-1",
  postNumber: 3,
  date: new Date("2026-05-02"),
  platform: "Instagram",
  format: "Carousel",
  status: "approved",
  suggestedHook: ORIGINAL_META.hookTitle,
  mainAngleAndCoreMessage: "education. A camera that looks fine can fail silently.",
  suggestedCaption: ORIGINAL_META.caption,
  hashtags: "#cctv #security",
  visualDirection: VISUAL,
  contentStructure: CONTENT_STRUCTURE,
  outputImageTextRequirements: "old oitr",
  postData: JSON.stringify(ORIGINAL_META),
  calendar: { brandId: "brand-1", status: "draft", mainMonthlySubject: "Spring", mainGoal: "g", mainOfferOrMessage: "o" },
};

const state = { capturedUserInput: null, aiImpl: null, updates: [], aiCalls: 0, db: null, failTx: false };

// In-memory generated-output tables: some belong to post-1, some are unrelated.
function freshDb() {
  return {
    media: [
      { id: "m-img-1", calendarPostId: "post-1", mediaType: "image", brandId: null, filePath: "uploads/images/a.png" },
      { id: "m-img-2", calendarPostId: "post-1", mediaType: "image", brandId: "brand-1", filePath: "uploads/images/b.png" },
      { id: "m-vid-1", calendarPostId: "post-1", mediaType: "video", brandId: "brand-1", filePath: "uploads/videos/c.mp4" },
      { id: "m-other-post", calendarPostId: "post-2", mediaType: "image", brandId: "brand-1", filePath: "uploads/images/d.png" },
      { id: "m-brand", calendarPostId: null, mediaType: "image", brandId: "brand-1", filePath: "uploads/images/e.png" },
    ],
    prompts: [
      { id: "p-img-1", calendarPostId: "post-1", type: "image", rawInput: JSON.stringify({ carouselMode: "exact_slide", carouselSlideNumber: 4 }) },
      { id: "p-vid-1", calendarPostId: "post-1", type: "video", rawInput: "{}" },
      { id: "p-other", calendarPostId: "post-2", type: "image", rawInput: "{}" },
    ],
    cvd: [
      { id: "c-1", calendarPostId: "post-1", carouselSlideNumber: 3 },
      { id: "c-2", calendarPostId: "post-2", carouselSlideNumber: 1 },
    ],
    refAnalyses: [{ id: "r-1", calendarPostId: "post-1" }],
    files: [{ id: "f-1", calendarPostId: "post-1" }],
  };
}
const matches = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v);
const table = (name) => ({
  findMany: async ({ where }) => state.db[name].filter(r => matches(r, where)).map(r => ({ ...r })),
  update: async ({ where, data }) => { Object.assign(state.db[name].find(r => r.id === where.id), data); return {}; },
  updateMany: async ({ where, data }) => {
    const rows = state.db[name].filter(r => matches(r, where));
    rows.forEach(r => Object.assign(r, data));
    return { count: rows.length };
  },
});
const txApi = () => ({
  calendarPost: {
    update: async ({ where, data }) => { if (state.failTx) throw new Error("tx failure"); state.updates.push({ where, data }); return { ...POST_ROW, ...data }; },
  },
  generatedMedia: table("media"),
  generatedPrompt: table("prompts"),
  combinedVisualDirection: table("cvd"),
});

mock.module("@/lib/auth", {
  exports: {
    getCurrentUser: async () => ({ id: "u1", role: "admin" }),
    getBrandCalendarAccess: async () => ({ allowed: true, isAdmin: true, membership: null, user: { id: "u1", role: "admin" } }),
  },
});
mock.module("@/lib/prisma", {
  exports: {
    prisma: {
      $transaction: async (fn) => {
        // Roll back everything on failure, like a real transaction.
        const snapshot = JSON.stringify(state.db);
        const updatesBefore = state.updates.length;
        try { return await fn(txApi()); }
        catch (e) { state.db = JSON.parse(snapshot); state.updates.length = updatesBefore; throw e; }
      },
      calendarPost: {
        findUnique: async ({ where }) => (where.id === POST_ROW.id ? { ...POST_ROW } : null),
        update: async ({ where, data }) => { state.updates.push({ where, data }); return { ...POST_ROW, ...data }; },
      },
      uploadedFile: { findMany: async () => [] },
      brand: { findUnique: async () => ({ id: "brand-1", name: "CUCCTV", contentLanguage: "de" }) },
      brandIdentity: { findFirst: async () => null },
    },
  },
});
mock.module("@/lib/calendar-attachment-context", {
  exports: { resolveCalendarAttachmentContext: async () => ({ ok: true, block: "REF_MARKER_9001 recorder health" }) },
});
mock.module("@/lib/ai", {
  exports: {
    generateWithPromptTemplate: async (opts) => {
      state.capturedUserInput = opts.userInput ?? null;
      state.aiCalls++;
      return state.aiImpl();
    },
  },
});

const saved = await import("../app/api/calendar-posts/[id]/regenerate/route.js");
const unsaved = await import("../app/api/content-calendar/regenerate-post/route.js");

function reset() { state.capturedUserInput = null; state.updates = []; state.aiCalls = 0; state.db = freshDb(); state.failTx = false; }
const post = (body) => new Request("https://app.test/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
function callSaved(body) { reset(); return saved.POST(post(body), { params: Promise.resolve({ id: "post-1" }) }); }

// The unsaved flow sends the inline post (a client-side normalized shape).
const UNSAVED_POST = {
  ...ORIGINAL_META,
  postNumber: 3, date: "2026-05-02", platform: "Instagram", format: "Carousel", status: "Approved",
  contentStructure: CONTENT_STRUCTURE, visualDirection: VISUAL,
};
function callUnsaved(body) {
  reset();
  return unsaved.POST(post({ post: UNSAVED_POST, brandId: "brand-1", calendarContext: { mainMonthlySubject: "Spring" }, ...body }));
}

function mapSources(from, to) {
  const out = [];
  if (to <= from) {
    for (let t = 0; t < to; t++) {
      const lo = Math.floor((t * from) / to) + 1, hi = Math.floor(((t + 1) * from) / to);
      out.push(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i));
    }
  } else for (let t = 0; t < to; t++) out.push([Math.floor((t * from) / to) + 1]);
  return out;
}

function aiSlides(n, from = 6) {
  const map = mapSources(from, n);
  return {
    postNumber: 3,
    // Over-reach attempt: none of these may ever land.
    caption: "HACKED caption", hashtags: ["#hacked"], hookTitle: "HACKED", mainAngle: "HACKED", format: "Static", textOnVideo: "HACKED",
    overallVisualDirection: "Overall carousel visual system: navy.",
    slides: Array.from({ length: n }, (_, i) => ({
      slideNumber: i + 1,
      sourceSlides: map[i],
      slideRole: i === 0 ? "Hook" : i === n - 1 ? "CTA" : `Part ${i}`,
      contentStructure: `merged ${i + 1}`,
      visualDirection: `new visual ${i + 1}`,
      fields: { main_headline: `New headline ${i + 1}`, supporting_text: `New detail ${i + 1}` },
    })),
  };
}
const ok = (n, from = 6) => async () => ({ raw: JSON.stringify(aiSlides(n, from)) });

// ── Saved flow ────────────────────────────────────────────────────────────────

test("saved: scope accepted, 6 → 2 uses the slide-count prompt with refs, language, instruction", async () => {
  state.aiImpl = ok(2);
  const instr = "Keep slide 1 unchanged. Merge slides 2–6 into slide 2.";
  const res = await callSaved({ scope: "change_slide_count", newSlideCount: 2, slideCountInstruction: instr });
  const data = await res.json();
  assert.equal(res.status, 200, JSON.stringify(data));
  assert.equal(data.success, true);
  assert.equal(data.scope, "change_slide_count");
  assert.equal(data.slideCount, 2);
  assert.ok(state.capturedUserInput.includes("CHANGE SLIDE COUNT FROM 6 TO 2"));
  assert.ok(state.capturedUserInput.includes(instr));
  assert.ok(state.capturedUserInput.includes("REF_MARKER_9001"));
  assert.ok(state.capturedUserInput.includes("German")); // brand contentLanguage "de" via the shared language instruction
  for (let n = 1; n <= 6; n++) assert.ok(state.capturedUserInput.includes(`CURRENT SLIDE ${n} (`));
});

test("saved: every slide-based field is rewritten to the target count; nothing else is written", async () => {
  state.aiImpl = ok(3);
  await callSaved({ scope: "change_slide_count", newSlideCount: 3 });
  assert.equal(state.updates.length, 1);
  const { data } = state.updates[0];
  const meta = JSON.parse(data.postData);

  // exactly the slide columns + postData
  assert.deepEqual(Object.keys(data).sort(), ["contentStructure", "outputImageTextRequirements", "postData", "visualDirection"]);
  assert.equal(data.contentStructure.split("\n").length, 3);
  assert.deepEqual([...data.contentStructure.matchAll(/Slide (\d+):/g)].map(m => +m[1]), [1, 2, 3]);
  assert.deepEqual([...data.visualDirection.matchAll(/Slide (\d+):/g)].map(m => +m[1]), [1, 2, 3]);
  assert.equal(meta.outputImageTextRequirementsStructured.slides.length, 3);
  assert.deepEqual(meta.outputImageTextRequirementsStructured.slides.map(s => s.slideNumber), [1, 2, 3]);
  assert.equal(meta.imageText, data.outputImageTextRequirements);
  assert.deepEqual([...meta.imageText.matchAll(/Slide (\d+):/g)].map(m => +m[1]), [1, 2, 3]);
  assert.ok(!/Slide [4-6]\b/.test(data.contentStructure + data.visualDirection + meta.imageText));
});

test("saved: caption, hashtags, hook, angle, core message, schedule, platform, status, format and video fields are preserved", async () => {
  state.aiImpl = ok(2);
  const res = await callSaved({ scope: "change_slide_count", newSlideCount: 2 });
  const out = await res.json();
  const { data } = state.updates[0];
  const meta = JSON.parse(data.postData);

  for (const key of ["suggestedCaption", "suggestedHook", "hashtags", "mainAngleAndCoreMessage", "date", "platform", "status", "format", "postNumber"]) {
    assert.ok(!(key in data), `${key} must not be written`);
  }
  for (const key of ["caption", "hashtags", "hookTitle", "mainAngle", "coreMessage", "hashtagsMergedIntoCaption", "structure", "textOnVideo", "visualMood", "narrationOrDialogueOfCharacterOrCharacters"]) {
    assert.deepEqual(meta[key], ORIGINAL_META[key], key);
  }
  // response keeps preserved values too
  assert.equal(out.post.caption, ORIGINAL_META.caption);
  assert.deepEqual(out.post.hashtags, ORIGINAL_META.hashtags);
  assert.equal(out.post.format, "Carousel");
  assert.equal(out.post.status, "approved");
  assert.equal(out.post.textOnVideo, "keep me");
});

test("saved: 6 → 5 succeeds and rewrites five slides", async () => {
  state.aiImpl = ok(5);
  const res = await callSaved({ scope: "change_slide_count", newSlideCount: 5 });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(state.updates[0].data.postData).outputImageTextRequirementsStructured.slides.length, 5);
});

test("saved: validation failures are 400 and never reach the AI or the DB", async () => {
  state.aiImpl = ok(2);
  const cases = [
    [{}, /required/i],
    [{ newSlideCount: 0 }, /at least/i],
    [{ newSlideCount: -1 }, /at least/i],
    [{ newSlideCount: 1 }, /at least/i],
    [{ newSlideCount: 2.5 }, /whole number/i],
    [{ newSlideCount: "x" }, /whole number/i],
    [{ newSlideCount: 99 }, /at most/i],
    [{ newSlideCount: 6 }, /different slide count/i],
  ];
  for (const [extra, re] of cases) {
    const res = await callSaved({ scope: "change_slide_count", ...extra });
    const data = await res.json();
    assert.equal(res.status, 400, JSON.stringify(extra));
    assert.match(data.error, re);
    assert.equal(state.aiCalls, 0);
    assert.equal(state.updates.length, 0);
  }
});

test("saved: invalid scope still rejected", async () => {
  state.aiImpl = ok(2);
  const res = await callSaved({ scope: "change_slides", newSlideCount: 2 });
  assert.equal(res.status, 400);
  assert.equal(state.updates.length, 0);
});

test("saved: invalid AI results cause ZERO db updates", async () => {
  const broken = [
    async () => ({ raw: JSON.stringify(aiSlides(3)) }),                                   // wrong count (3 vs 2)
    async () => ({ raw: "not json at all" }),
    async () => ({ raw: JSON.stringify({ ...aiSlides(2), slides: [aiSlides(2).slides[0], { ...aiSlides(2).slides[1], slideNumber: 1 }] }) }), // duplicate numbers
    async () => ({ raw: JSON.stringify({ ...aiSlides(2), slides: [aiSlides(2).slides[0], { ...aiSlides(2).slides[1], fields: {} }] }) }),     // empty slide text
    async () => ({ raw: JSON.stringify({ postNumber: 3, caption: "only caption" }) }),
    async () => { throw new Error("provider down"); },
  ];
  for (const impl of broken) {
    state.aiImpl = impl;
    const res = await callSaved({ scope: "change_slide_count", newSlideCount: 2 });
    assert.ok(res.status >= 422, `status ${res.status}`);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.ok(data.error);
    assert.equal(state.updates.length, 0);
  }
});

test("saved: static / reel posts are rejected with a meaningful error and no AI call", async () => {
  state.aiImpl = ok(2);
  const orig = { ...POST_ROW };
  for (const format of ["Static", "Reel"]) {
    POST_ROW.format = format;
    const res = await callSaved({ scope: "change_slide_count", newSlideCount: 3 });
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.match(data.error, /only available for Carousel/);
    assert.equal(state.aiCalls, 0);
  }
  POST_ROW.format = orig.format;
});

test("saved: unsaved client edits to contentStructure are the source of truth (currentPost)", async () => {
  state.aiImpl = ok(2, 4);
  const edited = six.slice(0, 4).map(s => `Slide ${s.slideNumber}: edited ${s.slideNumber}`).join("\n");
  const res = await callSaved({ scope: "change_slide_count", newSlideCount: 2, currentPost: { id: "post-1", contentStructure: edited } });
  assert.equal(res.status, 200);
  assert.ok(state.capturedUserInput.includes("CHANGE SLIDE COUNT FROM 4 TO 2"));
});

test("saved: existing modes still work", async () => {
  state.aiImpl = async () => ({ raw: JSON.stringify({ postNumber: 3, hookTitle: "H", coreMessage: "C", caption: "Enriched caption body." }) });
  const res = await callSaved({ scope: "enrich_post" });
  assert.equal(res.status, 200);
  assert.ok(state.capturedUserInput.includes("=== TASK: ENRICH THIS POST ==="));
  assert.ok(!state.capturedUserInput.includes("CHANGE SLIDE COUNT"));
  const meta = JSON.parse(state.updates[0].data.postData);
  assert.deepEqual(meta.outputImageTextRequirementsStructured.slides.length, 6);
});

// ── Unsaved flow ──────────────────────────────────────────────────────────────

test("unsaved: 6 → 2 returns the inline post with only slide fields changed and no DB write", async () => {
  state.aiImpl = ok(2);
  const instr = "Keep slide 1 unchanged. Merge text from slides 2, 3, 4, 5 and 6 into slide 2.";
  const res = await callUnsaved({ scope: "change_slide_count", newSlideCount: 2, slideCountInstruction: instr, attachmentIds: ["a1"] });
  const data = await res.json();
  assert.equal(res.status, 200, JSON.stringify(data));
  assert.equal(data.scope, "change_slide_count");
  assert.equal(state.updates.length, 0);
  assert.ok(state.capturedUserInput.includes(instr));
  assert.ok(state.capturedUserInput.includes("REF_MARKER_9001"));

  const p = data.post;
  assert.equal(p.outputImageTextRequirementsStructured.slides.length, 2);
  assert.deepEqual([...p.contentStructure.matchAll(/Slide (\d+):/g)].map(m => +m[1]), [1, 2]);
  assert.deepEqual([...p.imageText.matchAll(/Slide (\d+):/g)].map(m => +m[1]), [1, 2]);
  assert.equal(p.imageText, p.outputImageTextRequirements);

  // preserved exactly
  for (const k of ["caption", "hashtags", "hookTitle", "mainAngle", "coreMessage", "date", "platform", "status", "format", "postNumber", "textOnVideo", "visualMood", "hashtagsMergedIntoCaption"]) {
    assert.deepEqual(p[k], UNSAVED_POST[k], k);
  }
});

test("unsaved: 5 → 3 and 2 → 5 work from posts of those sizes", async () => {
  for (const [from, to] of [[5, 3], [2, 5]]) {
    const slides = six.slice(0, from);
    const inline = {
      ...UNSAVED_POST,
      contentStructure: slides.map(s => `Slide ${s.slideNumber}: ${s.slideRole} — x`).join("\n"),
      outputImageTextRequirementsStructured: { type: "carousel", slides },
    };
    state.aiImpl = ok(to, from);
    reset();
    const res = await unsaved.POST(post({ post: inline, brandId: "brand-1", scope: "change_slide_count", newSlideCount: to }));
    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    assert.ok(state.capturedUserInput.includes(`FROM ${from} TO ${to}`));
    assert.equal(data.post.outputImageTextRequirementsStructured.slides.length, to);
    assert.equal(data.post.contentStructure.split("\n").length, to);
    assert.equal(data.post.caption, UNSAVED_POST.caption);
  }
});

test("unsaved: validation errors are 400 with no AI call", async () => {
  state.aiImpl = ok(2);
  for (const extra of [{}, { newSlideCount: 0 }, { newSlideCount: 11 }, { newSlideCount: 6 }, { newSlideCount: 1.5 }]) {
    const res = await callUnsaved({ scope: "change_slide_count", ...extra });
    assert.equal(res.status, 400, JSON.stringify(extra));
    assert.equal(state.aiCalls, 0);
  }
  reset();
  const res = await unsaved.POST(post({ post: { ...UNSAVED_POST, format: "Static" }, brandId: "brand-1", scope: "change_slide_count", newSlideCount: 3 }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /only available for Carousel/);
});

test("unsaved: invalid AI output returns an error and no post", async () => {
  state.aiImpl = ok(3); // asked for 2
  const res = await callUnsaved({ scope: "change_slide_count", newSlideCount: 2 });
  const data = await res.json();
  assert.equal(res.status, 422);
  assert.equal(data.success, false);
  assert.equal(data.post, undefined);
});

test("unsaved: existing modes unchanged", async () => {
  state.aiImpl = async () => ({ raw: JSON.stringify({ postNumber: 3, hookTitle: "H", coreMessage: "C", caption: "Enriched caption body." }) });
  const res = await callUnsaved({ scope: "enrich_post" });
  assert.equal(res.status, 200);
  assert.ok(state.capturedUserInput.includes("=== TASK: ENRICH THIS POST ==="));
  const res2 = await callUnsaved({ scope: "nope" });
  assert.equal(res2.status, 400);
});

// ── Coverage enforcement through the routes ──────────────────────────────────

const withSources = (n, from, sources) => async () => {
  const ai = aiSlides(n, from);
  sources.forEach((src, i) => { ai.slides[i].sourceSlides = src; });
  return { raw: JSON.stringify(ai) };
};

test("saved: reduction that drops source slide 4 → 422, zero DB writes, nothing detached", async () => {
  state.aiImpl = withSources(2, 6, [[1], [2, 3, 5, 6]]);
  const res = await callSaved({ scope: "change_slide_count", newSlideCount: 2, slideCountInstruction: "Keep slide 1. Merge 2-6 into slide 2." });
  const data = await res.json();
  assert.equal(res.status, 422);
  assert.match(data.error, /omitted content from one or more original slides/);
  assert.match(data.details, /slide 4/);
  assert.equal(state.updates.length, 0);
  assert.deepEqual(state.db, freshDb()); // media/prompts/CVD untouched
});

test("saved: nonexistent source slide → 422 and no writes", async () => {
  state.aiImpl = withSources(2, 6, [[1], [2, 3, 4, 5, 6, 9]]);
  const res = await callSaved({ scope: "change_slide_count", newSlideCount: 2 });
  assert.equal(res.status, 422);
  assert.equal(state.updates.length, 0);
});

test("saved: 6→2 [1] + [2..6] and 6→3 [1] [2..5] [6] complete mappings are accepted", async () => {
  state.aiImpl = withSources(2, 6, [[1], [2, 3, 4, 5, 6]]);
  assert.equal((await callSaved({ scope: "change_slide_count", newSlideCount: 2 })).status, 200);
  state.aiImpl = withSources(3, 6, [[1], [2, 3, 4, 5], [6]]);
  assert.equal((await callSaved({ scope: "change_slide_count", newSlideCount: 3 })).status, 200);
});

test("saved: explicit 'remove slide 4' lets slide 4 be omitted", async () => {
  state.aiImpl = withSources(2, 6, [[1], [2, 3, 5, 6]]);
  const res = await callSaved({ scope: "change_slide_count", newSlideCount: 2, slideCountInstruction: "Remove slide 4 and merge the rest into slide 2." });
  assert.equal(res.status, 200);
  assert.match(state.capturedUserInput, /EXPLICIT REMOVAL requested by the user: current slide 4/);
});

// ── Stale generated output policy ────────────────────────────────────────────

test("saved: slide-specific image outputs are detached (not deleted); everything else is untouched", async () => {
  state.aiImpl = ok(2);
  const res = await callSaved({ scope: "change_slide_count", newSlideCount: 2 });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(data.staleOutputs, { media: 2, prompts: 1, visualDirections: 1 });
  assert.match(data.staleOutputsMessage, /2 generated images and 1 image prompt/);
  assert.match(data.staleOutputsMessage, /detached from this post/);

  const byId = (t, id) => state.db[t].find(r => r.id === id);
  // nothing deleted, files untouched
  assert.equal(state.db.media.length, 5);
  assert.equal(state.db.prompts.length, 3);
  assert.equal(byId("media", "m-img-1").filePath, "uploads/images/a.png");
  // old-layout image outputs detached; brand preserved/backfilled so they stay visible
  assert.equal(byId("media", "m-img-1").calendarPostId, null);
  assert.equal(byId("media", "m-img-1").brandId, "brand-1");
  assert.equal(byId("media", "m-img-2").calendarPostId, null);
  assert.equal(byId("prompts", "p-img-1").calendarPostId, null);
  assert.equal(JSON.parse(byId("prompts", "p-img-1").rawInput).detachedFromPost.previousSlideCount, 6);
  assert.equal(JSON.parse(byId("prompts", "p-img-1").rawInput).carouselSlideNumber, 4);
  assert.equal(byId("cvd", "c-1").calendarPostId, null);
  // unaffected: video outputs, other posts, brand-level media, reference analyses, reference files
  assert.equal(byId("media", "m-vid-1").calendarPostId, "post-1");
  assert.equal(byId("prompts", "p-vid-1").calendarPostId, "post-1");
  assert.equal(byId("media", "m-other-post").calendarPostId, "post-2");
  assert.equal(byId("prompts", "p-other").calendarPostId, "post-2");
  assert.equal(byId("cvd", "c-2").calendarPostId, "post-2");
  assert.equal(byId("media", "m-brand").calendarPostId, null);
  assert.equal(state.db.refAnalyses[0].calendarPostId, "post-1");
  assert.equal(state.db.files[0].calendarPostId, "post-1");
});

test("saved: if the transaction fails the post AND the outputs are unchanged", async () => {
  state.aiImpl = ok(2);
  reset();
  state.failTx = true;
  const res = await saved.POST(post({ scope: "change_slide_count", newSlideCount: 2 }), { params: Promise.resolve({ id: "post-1" }) });
  assert.equal(res.status, 500);
  assert.equal(state.updates.length, 0);
  assert.deepEqual(state.db, freshDb());
});

test("saved: no stale message when there is nothing to detach", async () => {
  state.aiImpl = ok(2);
  reset();
  state.db.media = []; state.db.prompts = []; state.db.cvd = [];
  const res = await saved.POST(post({ scope: "change_slide_count", newSlideCount: 2 }), { params: Promise.resolve({ id: "post-1" }) });
  const data = await res.json();
  assert.equal(data.staleOutputsMessage, null);
});

test("unsaved: touches no generated outputs", async () => {
  state.aiImpl = ok(2);
  const res = await callUnsaved({ scope: "change_slide_count", newSlideCount: 2 });
  assert.equal(res.status, 200);
  assert.deepEqual(state.db, freshDb());
  assert.equal((await res.json()).staleOutputsMessage, undefined);
});
