// AI Regenerate Post — quality contract at the PROVIDER BOUNDARY.
//
// Real routes, real prompt builders, real Brand Knowledge retrieval, real merge
// and validation. Only the `openai` SDK, prisma, the session cookie and the
// calendar-attachment resolver are faked. Assertions read the exact `messages`
// passed to chat.completions.create, then the merged result.
//
// The fake provider is deterministic and follows what the prompt says (e.g. it
// writes an educational caption only if the prompt states "Main Angle:
// Educational"), so a prompt that stops carrying the strategy fails here.

import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const A = "brand-a";
const B = "brand-b";
const KB_FACT = "Mount cameras 2.5–3 metres high, angled 15–30 degrees down, covering every entry point.";
const OPEN = "=== BRAND KNOWLEDGE SOURCE MATERIAL ===";

const BRANDS = {
  [A]: { id: A, name: "Guardian CCTV", contentLanguage: "en", businessType: "CCTV installer", mainServicesOrProducts: "CCTV installation and maintenance", targetAudience: "Homeowners" },
  [B]: { id: B, name: "Other Co", contentLanguage: "en", businessType: "CCTV installer", mainServicesOrProducts: "CCTV installation" },
  fa: { id: "fa", name: "نگهبان", contentLanguage: "fa", businessType: "نصب دوربین", mainServicesOrProducts: "نصب دوربین مداربسته" },
};

const DOCS = [
  { id: "kb-1", brandId: A, status: "READY", displayName: "Installation guidance", description: "CCTV camera placement and installation guidance",
    extractedText: `Camera placement guidance for installers. ${KB_FACT} Avoid pointing cameras into direct sunlight.` },
  { id: "kb-fa", brandId: "fa", status: "READY", displayName: "راهنمای نصب", description: "راهنمای نصب و جای دوربین",
    extractedText: "راهنمای نصب دوربین: دوربین را در ارتفاع ۲٫۵ تا ۳ متری نصب کنید." },
];

const users = {
  admin: { id: "admin-1", role: "admin", isActive: true, name: "Admin" },
  memberA: { id: "member-a", role: "user", isActive: true, name: "Arian" },
};
const MEMBERSHIPS = [{ userId: "member-a", brandId: A }];

const state = { calls: [], reply: null, user: users.admin, posts: {}, calendars: {}, updates: [] };

class APIConnectionError extends Error {}
class APIConnectionTimeoutError extends APIConnectionError {}
class FakeOpenAI {
  constructor() {
    this.chat = {
      completions: {
        create: async ({ messages }) => {
          const prompt = messages[0].content;
          state.calls.push({ prompt, messages });
          return { model: "gpt-4o", usage: { total_tokens: 1, completion_tokens: 1 }, choices: [{ finish_reason: "stop", message: { content: state.reply(prompt) } }] };
        },
      },
    };
  }
}
FakeOpenAI.APIConnectionError = APIConnectionError;
FakeOpenAI.APIConnectionTimeoutError = APIConnectionTimeoutError;

const prismaFake = {
  promptTemplate: { findUnique: async ({ where }) => ({ slug: where.slug, name: where.slug, outputType: "json", templateText: `[[TEMPLATE ${where.slug}]] Respond in JSON.` }) },
  settings: { findUnique: async () => ({ value: "sk-test-not-real" }) },
  brand: { findUnique: async ({ where }) => BRANDS[where.id] ?? null },
  brandIdentity: { findFirst: async () => null }, // brand profile path of buildBrandSummary
  brandMembership: { findUnique: async ({ where }) => MEMBERSHIPS.find((m) => m.userId === where.userId_brandId.userId && m.brandId === where.userId_brandId.brandId) ?? null },
  brandAssignment: { findUnique: async () => null },
  brandKnowledgeDocument: { findMany: async ({ where }) => DOCS.filter((d) => d.brandId === where.brandId && d.status === where.status) },
  calendarPost: {
    findUnique: async ({ where, include }) => {
      const p = state.posts[where.id];
      return p ? (include?.calendar ? { ...p, calendar: state.calendars[p.calendarId] } : { ...p }) : null;
    },
    update: async ({ where, data }) => { state.updates.push({ where, data }); return { ...state.posts[where.id], ...data }; },
  },
  uploadedFile: { findMany: async () => [] },
  $transaction: async (fn) => fn(prismaFake),
};

mock.module("openai", { defaultExport: FakeOpenAI });
mock.module("@/lib/prisma", { exports: { prisma: prismaFake } });
mock.module("@/lib/auth", {
  exports: {
    getCurrentUser: async () => state.user,
    // Same rule as lib/auth.getBrandCalendarAccess, over the real brand-access module.
    getBrandCalendarAccess: async (brandId) => {
      const { requireBrandAccess } = await import("../lib/brand-access.js");
      const a = await requireBrandAccess(brandId);
      return a.ok ? { allowed: true, user: a.user, isAdmin: a.user.role === "admin", membership: null } : { allowed: false, error: a.error, status: a.status };
    },
  },
});
mock.module("@/lib/calendar-attachment-context", {
  exports: { resolveCalendarAttachmentContext: async () => ({ ok: true, block: "", attachmentIds: [], attachmentCount: 0, wasTruncated: false, attachments: [] }) },
});

const unsavedRoute = await import("../app/api/content-calendar/regenerate-post/route.js");
const savedRoute = await import("../app/api/calendar-posts/[id]/regenerate/route.js");
for (const m of ["log", "info", "warn", "error"]) mock.method(console, m, () => {});

// ── Fixtures ──────────────────────────────────────────────────────────────────
const ROLES = ["Hook", "Why placement matters", "Height", "Angle", "Entry points", "CTA"];
const SIX = ROLES.map((r, i) => ({ slideNumber: i + 1, slideRole: r, fields: { main_headline: `${r}`, supporting_text: `Detail ${i + 1}` } }));

function cctvPost(angle, extra = {}) {
  return {
    postNumber: 4, date: "2026-12-02", platform: "Instagram", format: "Static", status: "Draft",
    hookTitle: "Where should CCTV cameras go?",
    mainAngle: angle,
    coreMessage: "Explain why CCTV placement matters.",
    caption: "Camera placement matters.\nGood placement helps.\nMessage us.",
    hashtags: ["#cctv", "#security", "#homesafety", "#london", "#installation"],
    contentStructure: "Single image with headline and three placement tips.",
    visualDirection: "Installer mounting a dome camera under an eave.",
    imageText: "main_headline: Placement matters",
    outputImageTextRequirements: "main_headline: Placement matters",
    outputImageTextRequirementsStructured: { type: "static", items: [{ main_headline: "Placement matters" }] },
    ...extra,
  };
}
const CAROUSEL = cctvPost("Educational", {
  format: "Carousel",
  contentStructure: SIX.map((s) => `Slide ${s.slideNumber}: ${s.slideRole}`).join("\n"),
  visualDirection: "Overall carousel visual system: navy and white. " + SIX.map((s) => `Slide ${s.slideNumber}: v${s.slideNumber}.`).join(" "),
  outputImageTextRequirementsStructured: { type: "carousel", slides: SIX },
});

// Fake model that follows the prompt's stated strategy (and tries to over-reach).
function strategicReply(prompt) {
  const angle = /^Main Angle: (.+)$/m.exec(prompt)?.[1] ?? "";
  const kb = prompt.includes(KB_FACT);
  const overreach = { mainAngle: "Promotional sales push", hashtags: ["#buynow"], format: "Reel", platform: "LinkedIn", date: "1999-01-01", status: "Published", visualDirection: "HACKED", contentStructure: "HACKED", imageText: "HACKED" };
  if (/educational/i.test(angle)) {
    return JSON.stringify({ ...overreach, postNumber: 4,
      hookTitle: "Why CCTV placement decides what your cameras actually record",
      coreMessage: "Height, angle and coverage of entry points determine whether footage can identify anyone.",
      caption: [
        "A camera only helps if it records a usable face, and placement decides that.",
        kb ? `Installers mount cameras 2.5–3 metres high, angled 15–30 degrees down, covering every entry point.` : "Height and angle both matter.",
        "Too high and you film the tops of heads; too flat and glare washes out the image.",
        "Questions about your own setup? Ask us.",
      ].join("\n\n") });
  }
  if (/promot/i.test(angle)) {
    return JSON.stringify({ ...overreach, postNumber: 4,
      hookTitle: "Book your CCTV placement check this week",
      coreMessage: "Our installers position every camera so it captures what matters.",
      caption: "Get cameras placed right the first time.\n\nOur team plans placement for your property.\n\nBook your installation today." });
  }
  return JSON.stringify({ ...overreach, postNumber: 4, hookTitle: "x", coreMessage: "x", caption: "x" });
}

function seedSaved(brandId, angle = "Educational") {
  const meta = cctvPost(angle);
  state.calendars = { "cal-1": { id: "cal-1", brandId, status: "draft", mainMonthlySubject: "Home security month", mainGoal: "Educate homeowners", mainOfferOrMessage: "Free site visit" } };
  state.posts = { "post-1": {
    id: "post-1", calendarId: "cal-1", postNumber: 4, date: new Date("2026-12-02"), platform: "Instagram", format: "Static", status: "draft",
    suggestedHook: meta.hookTitle, mainAngleAndCoreMessage: `${angle}. ${meta.coreMessage}`, suggestedCaption: meta.caption,
    hashtags: meta.hashtags.join(" "), visualDirection: meta.visualDirection, contentStructure: meta.contentStructure,
    outputImageTextRequirements: meta.outputImageTextRequirements, postData: JSON.stringify(meta),
  } };
}

beforeEach(() => {
  state.calls = []; state.updates = []; state.user = users.admin; state.reply = strategicReply;
  seedSaved(A);
});

const jsonReq = (body) => new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
async function unsaved(body, post, brandId = A) {
  const res = await unsavedRoute.POST(jsonReq({ post, brandId, calendarContext: { mainMonthlySubject: "Home security month" }, ...body }));
  return { status: res.status, body: await res.json() };
}
async function saved(body) {
  const res = await savedRoute.POST(jsonReq(body), { params: Promise.resolve({ id: "post-1" }) });
  return { status: res.status, body: await res.json() };
}
const lastPrompt = () => state.calls.at(-1).prompt;
const numbers = (s) => new Set((String(s).match(/\d+(?:[.,–-]\d+)*/g) || []));

// ── ENRICH ───────────────────────────────────────────────────────────────────

test("1, 4–10. Educational Enrich: final provider input carries the full spec, the angle contract and Brand Knowledge", async () => {
  const r = await unsaved({ scope: "enrich_post" }, cctvPost("Educational"));
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  const { messages, prompt } = state.calls[0];
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "user");

  assert.match(prompt, /^Main Angle: Educational$/m);
  assert.match(prompt, /The stored Main Angle "Educational" defines this post's purpose/);
  assert.match(prompt, /What "Educational" means for this post: teach and explain/);
  assert.match(prompt, /never a hard sell/);
  assert.match(prompt, /^Core Message: Explain why CCTV placement matters\.$/m);
  assert.match(prompt, /^Platform: Instagram — /m);
  assert.match(prompt, /^Format: Static — Static\/single image/m);
  assert.ok(prompt.includes("Content structure: Single image with headline and three placement tips."));
  assert.ok(prompt.includes("Hashtags: #cctv #security #homesafety #london #installation"), "read-only hashtags are visible");
  assert.ok(prompt.includes(OPEN) && prompt.includes(KB_FACT), "relevant Brand Knowledge reaches the provider");

  // Readable != writable: the mode's contract is stated in the prompt itself.
  assert.match(prompt, /=== FIELDS THIS MODE MAY CHANGE ===\nhookTitle, coreMessage, caption\n/);
  const preserved = /=== FIELDS YOU MUST PRESERVE[^\n]*\n([^\n]+)/.exec(prompt)[1];
  for (const f of ["mainAngle", "hashtags", "contentStructure", "visualDirection", "imageText", "video production fields", "postNumber", "date", "platform", "status", "format"]) {
    assert.ok(preserved.includes(f), `${f} listed as preserved`);
  }
  // The shared "always add a CTA" and "return 5 hashtags" rules no longer apply to Enrich.
  assert.ok(!prompt.includes("Always include a clear call-to-action"));
  assert.ok(!/^HASHTAGS:$/m.test(prompt));
  assert.ok(!prompt.includes("Strengthen the link between the problem described and the service"));
  assert.match(prompt, /Brand Knowledge excerpts above, when present — they are authoritative/);
});

test("1, 10–11, 13. Educational Enrich result: angle and protected fields survive; caption uses only sourced facts", async () => {
  const post = cctvPost("Educational");
  const { body } = await unsaved({ scope: "enrich_post" }, post);
  const out = body.post;
  assert.equal(out.mainAngle, "Educational");
  assert.match(out.hookTitle, /placement/i);
  assert.match(out.coreMessage, /Height, angle and coverage/);
  assert.ok(out.caption.length > post.caption.length * 2, "caption gains depth");
  assert.ok(!/book|buy|order/i.test(out.caption.replace(/#\S+/g, "")), "no sales-first CTA on an educational post");
  for (const f of ["format", "platform", "date", "status", "contentStructure", "visualDirection", "imageText", "outputImageTextRequirements", "postNumber"]) {
    assert.deepEqual(out[f], post[f], `${f} preserved`);
  }
  assert.deepEqual(out.outputImageTextRequirementsStructured, post.outputImageTextRequirementsStructured);
  assert.deepEqual(out.hashtags, post.hashtags, "hashtags exactly preserved");
  // Every number in the caption comes from the post or the Brand Knowledge document.
  const allowed = new Set([...numbers(KB_FACT), ...numbers(JSON.stringify(post))]);
  for (const n of numbers(out.caption.replace(/#\S+/g, ""))) assert.ok(allowed.has(n), `unsourced number ${n}`);
});

test("2–3. Promotional Enrich: same topic, different angle → different prompt and different output", async () => {
  await unsaved({ scope: "enrich_post" }, cctvPost("Educational"));
  const edu = lastPrompt();
  const { body } = await unsaved({ scope: "enrich_post" }, cctvPost("Promotional"));
  const promo = lastPrompt();
  assert.match(promo, /^Main Angle: Promotional$/m);
  assert.match(promo, /What "Promotional" means for this post: promote/);
  assert.ok(!/^Main Angle: Educational$/m.test(promo));
  assert.notEqual(edu, promo);
  assert.equal(body.post.mainAngle, "Promotional");
  assert.match(body.post.caption, /Book your installation/);
});

test("Main Angle guidance works for any stored value, including unknown ones", async () => {
  await unsaved({ scope: "enrich_post" }, cctvPost("Myth-busting for landlords"));
  assert.match(lastPrompt(), /^Main Angle: Myth-busting for landlords$/m);
  await unsaved({ scope: "enrich_post" }, cctvPost("Seasonal reminder"));
  assert.match(lastPrompt(), /Interpret "Seasonal reminder" literally as the post's strategic purpose/);
});

test("10. Saved Enrich writes only hook, core message and caption to the database", async () => {
  const r = await saved({ scope: "enrich_post", brandId: A, calendarId: "cal-1" });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  assert.match(lastPrompt(), /^Main Angle: Educational$/m);
  const written = state.updates[0].data;
  const meta = JSON.parse(written.postData);
  const row = state.posts["post-1"];
  assert.equal(meta.mainAngle, "Educational");
  assert.equal(written.visualDirection, row.visualDirection);
  assert.equal(written.contentStructure, row.contentStructure);
  for (const k of ["date", "platform", "format", "status", "calendarId", "postNumber"]) assert.ok(!(k in written), `${k} written`);
  assert.match(written.suggestedHook, /placement decides/);
});

test("12. Persian Enrich: Persian language contract and Persian content reach the provider; output stays Persian", async () => {
  state.reply = () => JSON.stringify({ postNumber: 4, mainAngle: "تبلیغاتی", hookTitle: "چرا جای دوربین مهم است", coreMessage: "ارتفاع و زاویه دوربین کیفیت تصویر را تعیین می‌کند.", caption: "دوربین را در ارتفاع ۲٫۵ تا ۳ متری نصب کنید.\n\nسؤالی دارید؟ از ما بپرسید." });
  const post = cctvPost("آموزشی", { hookTitle: "دوربین را کجا نصب کنیم؟", coreMessage: "توضیح اهمیت جای دوربین.", caption: "جای دوربین مهم است.", hashtags: ["#دوربین"] });
  const { body } = await unsaved({ scope: "enrich_post" }, post, "fa");
  const p = lastPrompt();
  assert.ok(p.includes("Output language: Persian / فارسی (fa)."));
  assert.match(p, /^Main Angle: آموزشی$/m);
  assert.match(p, /What "آموزشی" means for this post: teach and explain/);
  assert.ok(p.includes("دوربین را کجا نصب کنیم؟") && p.includes("۲٫۵ تا ۳ متری"), "Persian post and Persian Brand Knowledge present");
  assert.equal(body.post.mainAngle, "آموزشی", "Enrich cannot change the angle even if the model tries");
  assert.match(body.post.caption, /[؀-ۿ]/);
  assert.ok(!/[A-Za-z]{4,}/.test(body.post.caption.replace(/#\S+/g, "")), "no English drift");
});

// ── ENTIRE POST ──────────────────────────────────────────────────────────────

test("14–17. Entire Post: complete spec + Main Angle + Brand Knowledge; strategy and metadata survive", async () => {
  const post = cctvPost("Educational");
  // The model tries to switch the angle; the server must keep the stored one.
  state.reply = (prompt) => JSON.stringify({ ...JSON.parse(strategicReply(prompt)), mainAngle: "Promotional" });
  const { status, body } = await unsaved({ scope: "entire_post" }, post);
  assert.equal(status, 200, JSON.stringify(body).slice(0, 300));
  const p = lastPrompt();
  assert.match(p, /^Main Angle: Educational$/m);
  assert.match(p, /STRATEGY STAYS: the stored Main Angle is read-only in this mode/);
  assert.match(p, /mainAngle is read-only here and the application keeps the stored value/);
  assert.ok(p.includes(KB_FACT));
  assert.ok(p.includes("Caption: Camera placement matters.") && p.includes("Visual direction: Installer mounting"));
  assert.equal(body.post.mainAngle, "Educational");
  for (const f of ["postNumber", "date", "platform", "status", "format"]) assert.deepEqual(body.post[f], post[f], `${f} preserved`);
});

// ── CUSTOM INSTRUCTION ───────────────────────────────────────────────────────

test("18–19. Custom Instruction: instruction + Main Angle + Brand Knowledge; the angle constraint survives the instruction", async () => {
  const instruction = "Make it more technical for electricians.";
  await unsaved({ scope: "custom_instruction", customInstruction: instruction }, cctvPost("Educational"));
  const p = lastPrompt();
  assert.ok(p.includes(instruction));
  assert.match(p, /^Main Angle: Educational$/m);
  assert.ok(p.includes(KB_FACT));
  assert.match(p, /change mainAngle ONLY when the instruction explicitly asks to change the post's angle/);
  assert.match(p, /MORE TECHNICAL EDUCATIONAL post — not a new angle/);
  assert.ok(!p.includes("update hookTitle, mainAngle, coreMessage, caption, hashtags"), "mainAngle no longer listed as a routine wording field");
  assert.ok(p.indexOf("=== EXISTING POST SPECIFICATION") < p.indexOf("=== USER INSTRUCTION ==="));
});

// ── IMAGE TEXT ───────────────────────────────────────────────────────────────

test("20–21. Image Text: sees Main Angle and core message; only on-image text fields change", async () => {
  const post = cctvPost("Educational");
  state.reply = () => JSON.stringify({ postNumber: 4, caption: "HACKED", mainAngle: "HACKED", hookTitle: "HACKED", coreMessage: "HACKED", hashtags: ["#hacked"],
    outputImageTextRequirementsStructured: { type: "static", items: [{ main_headline: "Mount at 2.5–3 m, angle 15–30° down", supporting_text: "Cover every entry point" }] }, imageText: "" });
  const { body } = await unsaved({ scope: "image_text_only", imageTextInstruction: "Use the installation height guidance" }, post);
  const p = lastPrompt();
  assert.match(p, /^Main Angle: Educational$/m);
  assert.match(p, /^Core Message: Explain why CCTV placement matters\.$/m);
  assert.match(p, /in the voice of the post's Main Angle/);
  assert.ok(p.includes(KB_FACT), "factual image text can use Brand Knowledge");
  assert.match(p, /=== FIELDS THIS MODE MAY CHANGE ===\nimageText, outputImageTextRequirements \(on-image text\), outputImageTextRequirementsStructured \(on-image text\)|=== FIELDS THIS MODE MAY CHANGE ===\noutputImageTextRequirementsStructured/);
  for (const f of ["caption", "mainAngle", "hookTitle", "coreMessage", "contentStructure", "visualDirection"]) assert.deepEqual(body.post[f], post[f], `${f} untouched`);
  assert.deepEqual(body.post.hashtags, post.hashtags);
  assert.equal(body.post.outputImageTextRequirementsStructured.items[0].main_headline, "Mount at 2.5–3 m, angle 15–30° down");
});

// ── CHANGE SLIDE COUNT ───────────────────────────────────────────────────────

test("22–25. Slide count: sees angle/core/structure, keeps educational flow, and writes only slide fields", async () => {
  state.reply = () => JSON.stringify({
    postNumber: 4, caption: "HACKED", hashtags: ["#hacked"], hookTitle: "HACKED", mainAngle: "HACKED", coreMessage: "HACKED", format: "Static",
    overallVisualDirection: "Overall carousel visual system: navy and white.",
    slides: [
      { slideNumber: 1, sourceSlides: [1], slideRole: "Hook", contentStructure: "Where should CCTV cameras go?", visualDirection: "v1", fields: { main_headline: "Where should CCTV cameras go?" } },
      { slideNumber: 2, sourceSlides: [2, 3, 4, 5], slideRole: "Explanation", contentStructure: "Why placement matters: height, angle and entry-point coverage", visualDirection: "v2", fields: { main_headline: "Height, angle, coverage", supporting_text: "Three placement rules that decide what you record" } },
      { slideNumber: 3, sourceSlides: [6], slideRole: "CTA", contentStructure: "Ask us about your setup", visualDirection: "v6", fields: { main_headline: "Questions?", call_to_action: "Message us" } },
    ],
  });
  const { status, body } = await unsaved({ scope: "change_slide_count", newSlideCount: 3 }, CAROUSEL);
  assert.equal(status, 200, JSON.stringify(body).slice(0, 300));
  const p = lastPrompt();
  assert.match(p, /^Main Angle: Educational$/m);
  assert.match(p, /^Core Message: Explain why CCTV placement matters\.$/m);
  assert.ok(p.includes("Slide 2: Why placement matters"));
  assert.match(p, /FLOW BY MAIN ANGLE — .*an educational carousel keeps setup → explanation → takeaway\/CTA/);
  assert.ok(p.includes(KB_FACT));
  const out = body.post;
  for (const f of ["caption", "hookTitle", "mainAngle", "coreMessage", "format", "platform", "date", "status", "postNumber"]) assert.deepEqual(out[f], CAROUSEL[f], `${f} preserved`);
  assert.deepEqual(out.hashtags, CAROUSEL.hashtags);
  const roles = out.outputImageTextRequirementsStructured.slides.map((s) => s.slideRole);
  assert.deepEqual(roles, ["Hook", "Explanation", "CTA"], "educational setup → explanation → CTA");
});

// ── Every mode carries the same spec ─────────────────────────────────────────

test("every regeneration mode starts from the same post specification", async () => {
  const modes = [
    ["visual_only", {}], ["entire_post", {}], ["enrich_post", {}],
    ["custom_instruction", { customInstruction: "Shorten the caption a little." }],
    ["image_text_only", {}],
  ];
  for (const [scope, extra] of modes) {
    state.reply = strategicReply;
    await unsaved({ scope, ...extra }, cctvPost("Educational"));
    const p = lastPrompt();
    assert.ok(p.includes("=== EXISTING POST SPECIFICATION"), scope);
    assert.match(p, /^Main Angle: Educational$/m, scope);
    assert.match(p, /=== SOURCE PRIORITY/, scope);
  }
});

// ── AUTH ─────────────────────────────────────────────────────────────────────

test("26–27. assigned user can enrich their brand; cross-brand requests are refused before any provider call", async () => {
  state.user = users.memberA;
  const ok = await unsaved({ scope: "enrich_post" }, cctvPost("Educational"), A);
  assert.equal(ok.status, 200);
  assert.equal(state.calls.length, 1);

  state.calls = [];
  const denied = await unsaved({ scope: "enrich_post" }, cctvPost("Educational"), B);
  assert.ok([403, 404].includes(denied.status), `status ${denied.status}`);
  seedSaved(B);
  const deniedSaved = await saved({ scope: "enrich_post" });
  assert.ok([403, 404].includes(deniedSaved.status), `status ${deniedSaved.status}`);
  assert.equal(state.calls.length, 0);
  assert.equal(state.updates.length, 0);
});
