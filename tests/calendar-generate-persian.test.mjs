// Regression tests for Persian (and English) calendar generation through
// POST /api/content-calendar/generate.
//
// The production failure: a Persian 12-post calendar ended in the browser with
// "Could not reach the server" while English worked. Persian output is valid
// JSON and parses fine — it is simply slower (~25% more completion tokens), and
// the route stayed silent until done, with no deadline of its own, while each
// provider timeout was retried for many minutes. These tests lock in:
//   - Persian text survives prompt construction and response parsing intact,
//   - exact post count / numbering / formats for Persian calendars,
//   - generation is bounded by a deadline and ends in structured JSON,
//   - fatal provider errors fail fast instead of reporting a fake shortfall,
//   - the generate route never writes to the database.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const realBudget = await import("../lib/calendar-generation-budget.js");

const FA = {
  hook: "با این درمان‌ها لبخندتان را «زیباتر» کنید؛ ۱۲۳ نکته",
  core: "می‌خواهم بدانم نیم‌فاصله، اعداد ۱۲۳ و علائم «» حفظ می‌شوند",
  caption: "آیا می‌دانید؟ با ما همراه باشید، نوبت مشاوره بگیرید؛ ۰۹۱۲",
  imageText: "تیتر: لبخند زیبا ۱۲۳",
};

const state = {
  language: "fa",
  aiCalls: [],
  aiImpl: null,
  attachmentBlock: "",
  dbWrites: [],
  now: null,
};

mock.module("@/lib/auth", {
  exports: {
    getCurrentUser: async () => ({ id: "u1", role: "admin" }),
    getBrandCalendarAccess: async () => ({ allowed: true, status: 200, error: null }),
  },
});

// Only the two reads the route needs; touching anything else (a write) is
// recorded and fails the no-persistence assertion.
mock.module("@/lib/prisma", {
  exports: {
    prisma: new Proxy({}, {
      get(_, model) {
        if (model === "brand") return { findUnique: async ({ where }) => ({ id: where.id, name: "کلینیک دکتر", contentLanguage: state.language }) };
        if (model === "brandIdentity") return { findFirst: async () => null };
        state.dbWrites.push(String(model));
        return new Proxy({}, { get: (_, op) => async () => { state.dbWrites.push(`${String(model)}.${String(op)}`); } });
      },
    }),
  },
});

mock.module("@/lib/calendar-attachment-context", {
  exports: {
    resolveCalendarAttachmentContext: async () => ({
      ok: true, block: state.attachmentBlock, attachmentIds: [], attachmentCount: state.attachmentBlock ? 1 : 0,
      wasTruncated: false, attachments: [],
    }),
  },
});

mock.module("@/lib/ai", {
  exports: {
    generateWithPromptTemplate: async (opts) => {
      state.aiCalls.push(opts);
      return state.aiImpl(opts, state.aiCalls.length);
    },
  },
});

// Real budget maths, driven by a controllable clock when a test sets state.now.
mock.module("@/lib/calendar-generation-budget", {
  exports: {
    ...realBudget,
    getProviderTimeoutForAttempt: (deadline) =>
      realBudget.getProviderTimeoutForAttempt(deadline, state.now ?? Date.now()),
  },
});

let route;
async function getRoute() {
  if (!route) route = await import("../app/api/content-calendar/generate/route.js");
  return route.POST;
}

function reset() {
  state.language = "fa";
  state.aiCalls = [];
  state.attachmentBlock = "";
  state.dbWrites = [];
  state.now = null;
  state.aiImpl = personaAi("fa");
}

let uniq = 0;
function makePost(lang, i, format = "Reel") {
  const n = ++uniq;
  return lang === "fa"
    ? { hookTitle: `${FA.hook} ${n}`, coreMessage: `${FA.core} ${n}`, mainAngle: `زاویه ${n}`, caption: FA.caption,
        format, platform: "Instagram", hashtags: ["#می‌خواهم", "#زیبایی"], outputImageTextRequirements: FA.imageText }
    : { hookTitle: `Hook ${n}`, coreMessage: `Core ${n}`, mainAngle: `Angle ${n}`, caption: "Book a consultation today.",
        format, platform: "Instagram", hashtags: ["#smile"], outputImageTextRequirements: "Headline: Smile" };
}

// Answers like the provider: a raw JSON string (as returned before parsing),
// with exactly the number of posts the batch asked for.
function personaAi(lang) {
  return async (opts) => {
    const m = opts.userInput.match(/(\d+)\s+posts?/i);
    const count = Math.min(Number(m?.[1] ?? 4), 5);
    const posts = Array.from({ length: count }, (_, i) => makePost(lang, i));
    return { content: null, raw: JSON.stringify({ posts }), finishReason: "stop" };
  };
}

function req(body) {
  return new Request("http://localhost/api/content-calendar/generate", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

const BASE = {
  brandId: "brand-fa",
  numberOfPostsNeeded: 12,
  mainMonthlySubject: "ماه آگاهی از زیبایی دندان",
  importantDetailsToInclude: "می‌خواهم «مشاوره رایگان» و شماره ۰۲۱-۱۲۳ ذکر شود؛ نیم‌فاصله حفظ شود",
  platforms: "Instagram",
  requiredPostFormats: "Carousel, Reel, Static",
  publishingFrequency: "3 posts per week",
  calendarPeriodStart: "2026-11-01",
  calendarPeriodEnd: "2026-11-30",
  attachmentIds: [],
};

async function run(body) {
  const POST = await getRoute();
  const res = await POST(req(body));
  const text = await res.text();
  return { res, data: JSON.parse(text) };
}

test("Persian request is accepted and the Persian language instruction reaches the provider", async () => {
  reset();
  const { res, data } = await run(BASE);
  assert.equal(res.status, 200);
  assert.equal(data.success, true);
  const input = state.aiCalls[0].userInput;
  assert.match(input, /Output language: Persian \/ فارسی \(fa\)/);
  // Persian Unicode (ZWNJ, Persian digits, guillemets, Persian ;) survives prompt construction.
  assert.ok(input.includes(BASE.importantDetailsToInclude), "Persian form text must reach the prompt verbatim");
  assert.ok(input.includes(BASE.mainMonthlySubject));
});

test("English request on the same inputs still works and asks for English", async () => {
  reset();
  state.language = "en";
  state.aiImpl = personaAi("en");
  const { res, data } = await run(BASE);
  assert.equal(res.status, 200);
  assert.equal(data.posts.length, 12);
  assert.match(state.aiCalls[0].userInput, /Output language: English \(en\)/);
});

test("Persian 12-post mixed-format calendar: exact count, numbering, formats, and intact Persian text", async () => {
  reset();
  const { data } = await run(BASE);
  assert.equal(data.posts.length, 12);
  assert.deepEqual(data.posts.map(p => p.postNumber), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(state.aiCalls.length, 3, "12 posts = 3 batches of 4");
  const counts = {};
  for (const p of data.posts) counts[p.format] = (counts[p.format] || 0) + 1;
  assert.deepEqual(counts, { Carousel: 4, Reel: 4, Static: 4 });
  for (const p of data.posts) {
    assert.ok(p.hookTitle.startsWith(FA.hook), "hook must be Persian and unaltered (ZWNJ, digits, « »)");
    assert.ok(p.coreMessage.includes("نیم‌فاصله"), "ZWNJ must survive parsing");
    assert.ok(p.caption.startsWith(FA.caption), "caption must stay Persian and non-empty");
    assert.ok(!/‌خواهم/.test(p.caption.split("\n\n")[0]), "no orphaned ZWNJ hashtag tail in caption body");
  }
});

for (const [label, formats] of [["Static", "Static"], ["Carousel", "Carousel"], ["Reel", "Reel"]]) {
  test(`Persian ${label}-only calendar keeps every post in that format`, async () => {
    reset();
    const { data } = await run({ ...BASE, numberOfPostsNeeded: 6, requiredPostFormats: formats });
    assert.equal(data.posts.length, 6);
    assert.ok(data.posts.every(p => p.format === label));
    assert.ok(data.posts.every(p => /[؀-ۿ]/.test(p.hookTitle)));
  });
}

for (const n of [1, 3, 6, 12]) {
  test(`Persian ${n}-post calendar returns exactly ${n} posts numbered 1..${n}`, async () => {
    reset();
    const { data } = await run({ ...BASE, numberOfPostsNeeded: n });
    assert.equal(data.posts.length, n);
    assert.deepEqual(data.posts.map(p => p.postNumber), Array.from({ length: n }, (_, i) => i + 1));
  });
}

test("each provider call is bounded and not retried inside the SDK", async () => {
  reset();
  await run(BASE);
  for (const call of state.aiCalls) {
    assert.ok(call.timeoutMs > 0 && call.timeoutMs <= realBudget.CALENDAR_PROVIDER_TIMEOUT_MS);
    assert.equal(call.maxRetries, 0);
  }
});

test("repeated provider timeouts end at the route deadline with a structured timeout error", async () => {
  reset();
  const start = Date.now();
  state.now = start;
  // Pin the route's own start time to the fake clock.
  const realNow = Date.now;
  Date.now = () => state.now;
  try {
    state.aiImpl = async (opts) => {
      state.now += opts.timeoutMs; // the call used its whole timeout
      const err = new Error("The AI provider did not respond in time.");
      err.code = "AI_TIMEOUT";
      throw err;
    };
    const { res, data } = await run(BASE);
    assert.equal(res.status, 504);
    assert.equal(data.success, false);
    assert.equal(data.code, "CALENDAR_GENERATION_TIMEOUT");
    assert.match(data.error, /took too long/);
    assert.equal(data.requestedCount, 12);
    const budget = realBudget.getCalendarGenerationBudgetMs(12);
    assert.ok(state.now - start <= budget, `simulated time ${state.now - start}ms must stay within budget ${budget}ms`);
    assert.ok(state.aiCalls.length <= 4, `bounded attempts, got ${state.aiCalls.length}`);
  } finally {
    Date.now = realNow;
  }
});

test("an unconfigured API key fails fast with its own message, not a post-count shortfall", async () => {
  reset();
  state.aiImpl = async () => { const e = new Error("OPENAI_API_KEY is not configured."); e.code = "AI_NOT_CONFIGURED"; throw e; };
  const { res, data } = await run(BASE);
  assert.equal(res.status, 503);
  assert.equal(state.aiCalls.length, 1);
  assert.match(data.error, /API key/);
});

test("an exhausted provider connection fails fast as a provider error", async () => {
  reset();
  state.aiImpl = async () => { const e = new Error("Couldn't reach the AI service"); e.code = "AI_CONNECTION_ERROR"; throw e; };
  const { res, data } = await run(BASE);
  assert.equal(res.status, 503);
  assert.equal(state.aiCalls.length, 1);
  assert.match(data.error, /AI service/);
});

test("truncated Persian JSON (finish_reason=length) is reported as structured JSON, not a crash", async () => {
  reset();
  const full = JSON.stringify({ posts: [makePost("fa", 0), makePost("fa", 1)] });
  state.aiImpl = async () => ({ content: null, raw: full.slice(0, Math.floor(full.length * 0.6)), finishReason: "length" });
  const { res, data } = await run({ ...BASE, numberOfPostsNeeded: 4 });
  assert.equal(res.status, 422);
  assert.equal(data.success, false);
  assert.equal(data.code, "CALENDAR_POST_COUNT_INCOMPLETE");
  assert.equal(data.generatedCount, 0);
});

test("Persian reference context reaches the provider prompt", async () => {
  reset();
  state.attachmentBlock = "=== REFERENCE ===\nبروشور کلینیک: ایمپلنت، لمینت؛ ۱۴۰۳";
  const { data } = await run({ ...BASE, numberOfPostsNeeded: 4 });
  assert.equal(data.posts.length, 4);
  assert.ok(state.aiCalls[0].userInput.includes("بروشور کلینیک: ایمپلنت، لمینت؛ ۱۴۰۳"));
});

test("generation never writes to the database — success or failure leaves nothing partial", async () => {
  reset();
  await run(BASE);
  state.aiImpl = async () => ({ content: null, raw: "not json", finishReason: "stop" });
  await run(BASE);
  assert.deepEqual(state.dbWrites, []);
});
