// The image-text fallback is shared by calendar generation and both
// regeneration paths. For a Persian carousel all three must behave the same:
//   - enough source text → a structurally valid fallback (exact labelled count),
//   - not enough → a clean 422 CALENDAR_OUTPUT_INVALID with nothing written,
// never an undersized carousel accepted by one route and rejected by another.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const realUtils = await import("../lib/calendar-post-utils.js");

const FOUR_SLIDES = "اسلاید ۱: مشکل رایج\nاسلاید ۲: علت اصلی\nاسلاید ۳: راه‌حل ما\nاسلاید ۴: نتیجه نهایی";

const state = { aiRaw: null, writes: [], src: null };

function rowFor(src) {
  return {
    id: "post-1", calendarId: "cal-1", postNumber: 1, date: new Date("2026-11-02"),
    platform: "Instagram", format: "Carousel", status: "draft",
    suggestedHook: src.hookTitle, mainAngleAndCoreMessage: "", suggestedCaption: src.caption,
    hashtags: "", visualDirection: "", contentStructure: src.contentStructure, outputImageTextRequirements: "",
    postData: JSON.stringify({ hookTitle: src.hookTitle, coreMessage: "", caption: src.caption, mainAngle: "trust" }),
    calendar: { brandId: "brand-1", status: "draft", mainMonthlySubject: "ماه لبخند", mainGoal: "", mainOfferOrMessage: "" },
  };
}

const write = (label) => async (args) => { state.writes.push(label); return { ...rowFor(state.src), ...(args?.data || {}) }; };

mock.module("@/lib/auth", {
  exports: {
    getCurrentUser: async () => ({ id: "u1", role: "admin" }),
    getBrandCalendarAccess: async () => ({ allowed: true, isAdmin: true, status: 200, membership: null, user: { id: "u1", role: "admin" } }),
  },
});
mock.module("@/lib/prisma", {
  exports: {
    prisma: {
      $transaction: async (fn) => fn({ calendarPost: { update: write("tx.calendarPost.update") } }),
      calendarPost: { findUnique: async () => rowFor(state.src), update: write("calendarPost.update") },
      uploadedFile: { findMany: async () => [] },
      brand: { findUnique: async ({ where }) => ({ id: where?.id ?? "brand-1", name: "کلینیک", contentLanguage: "fa" }) },
      brandIdentity: { findFirst: async () => null },
    },
  },
});
mock.module("@/lib/calendar-attachment-context", {
  exports: {
    resolveCalendarAttachmentContext: async () => ({ ok: true, block: "", attachmentIds: [], attachmentCount: 0, wasTruncated: false, attachments: [] }),
  },
});
mock.module("@/lib/ai", {
  exports: { generateWithPromptTemplate: async () => ({ content: null, raw: state.aiRaw(), finishReason: "stop" }) },
});

const generate = await import("../app/api/content-calendar/generate/route.js");
const saved = await import("../app/api/calendar-posts/[id]/regenerate/route.js");
const unsaved = await import("../app/api/content-calendar/regenerate-post/route.js");

const req = (body) => new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
// The AI's own image text is a 1-slide carousel → fails validation → fallback runs.
const BAD_OITR = { type: "carousel", slides: [{ slideNumber: 1, fields: { main_headline: "تک" } }] };

function setup(src) {
  state.src = src;
  state.writes = [];
  let n = 0;
  state.aiRaw = () => JSON.stringify({
    // generate: a posts array; regenerate: a single post object.
    posts: Array.from({ length: 4 }, () => ({
      hookTitle: `${src.hookTitle} ${++n}`, coreMessage: "", mainAngle: "trust", caption: src.caption,
      format: "Carousel", platform: "Instagram", contentStructure: src.contentStructure,
      outputImageTextRequirementsStructured: BAD_OITR,
    })),
    postNumber: 1,
    outputImageTextRequirementsStructured: BAD_OITR,
  });
}

async function runAll(src) {
  setup(src);
  const g = await generate.POST(req({
    brandId: "brand-1", numberOfPostsNeeded: 4, mainMonthlySubject: "ماه لبخند", platforms: "Instagram",
    requiredPostFormats: "Carousel", calendarPeriodStart: "2026-11-01", calendarPeriodEnd: "2026-11-30",
  }));
  const s = await saved.POST(req({ scope: "image_text_only" }), { params: Promise.resolve({ id: "post-1" }) });
  const u = await unsaved.POST(req({
    scope: "image_text_only", brandId: "brand-1", calendarContext: { mainMonthlySubject: "ماه لبخند" },
    post: { postNumber: 1, platform: "Instagram", format: "Carousel", hookTitle: src.hookTitle, coreMessage: "", mainAngle: "trust", caption: src.caption, contentStructure: src.contentStructure },
  }));
  return {
    generate: { status: g.status, data: await g.json() },
    saved: { status: s.status, data: await s.json() },
    unsaved: { status: u.status, data: await u.json() },
  };
}

test("enough source: all three routes return a valid fallback with the exact labelled slide count", async () => {
  const r = await runAll({ hookTitle: "لبخند زیبا", caption: "", contentStructure: FOUR_SLIDES });
  assert.equal(r.generate.status, 200, JSON.stringify(r.generate.data).slice(0, 300));
  assert.equal(r.saved.status, 200, JSON.stringify(r.saved.data).slice(0, 300));
  assert.equal(r.unsaved.status, 200, JSON.stringify(r.unsaved.data).slice(0, 300));

  const structures = [
    ...r.generate.data.posts.map((p) => p.outputImageTextRequirementsStructured),
    r.saved.data.post.outputImageTextRequirementsStructured,
    r.unsaved.data.post.outputImageTextRequirementsStructured,
  ];
  for (const st of structures) {
    assert.equal(st.type, "carousel");
    assert.deepEqual(st.slides.map((x) => x.slideNumber), [1, 2, 3, 4]);
    assert.deepEqual(st.slides.slice(1).map((x) => x.fields.main_headline), ["علت اصلی", "راه‌حل ما", "نتیجه نهایی"]);
    assert.ok(!/Slide \d|Key point|Ready to get started|Why It Matters/.test(JSON.stringify(st)));
    assert.equal(realUtils.validateOutputImageTextRequirements({ format: "Carousel", contentStructure: FOUR_SLIDES, outputImageTextRequirementsStructured: st }).valid, true);
  }
  assert.deepEqual(state.writes, ["calendarPost.update"], "only the saved route writes, once");
});

test("insufficient source: all three routes fail cleanly with CALENDAR_OUTPUT_INVALID and write nothing", async () => {
  const r = await runAll({ hookTitle: "لبخند", caption: "", contentStructure: "" });
  for (const [name, res] of Object.entries(r)) {
    assert.equal(res.status, 422, `${name}: ${JSON.stringify(res.data).slice(0, 300)}`);
    assert.equal(res.data.success, false, name);
    assert.equal(res.data.code, "CALENDAR_OUTPUT_INVALID", name);
    assert.equal(res.data.post, undefined, `${name} must not return a partial post`);
    assert.equal(res.data.posts, undefined, `${name} must not return a partial calendar`);
  }
  assert.deepEqual(state.writes, [], "no DB write on an invalid fallback");
});
