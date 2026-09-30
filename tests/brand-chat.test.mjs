// Brand Workspace chatbot: pipeline tests through the real route, context builder,
// history budgeting and provider layer. Only the OpenAI client, DB and auth are faked.

import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── Fake data: three brands ────────────────────────────────────────────────

const A = "brand-a"; // CCTV company
const B = "brand-b"; // clinic
const C = "brand-c"; // brand with no stored data

const DB = {
  brands: [
    { id: A, name: "Alpha Security", businessType: "Security installer", mainServicesOrProducts: "CCTV installation, CCTV training courses", targetAudience: "Facilities managers", brandTone: "Technical and reassuring", contentLanguage: "en", updatedAt: new Date() },
    { id: B, name: "Beta Clinic", businessType: "Dental clinic", mainServicesOrProducts: "Teeth whitening, orthodontics", targetAudience: "Families", brandTone: "Warm", contentLanguage: "en", updatedAt: new Date() },
    { id: C, name: "Gamma Studio", updatedAt: new Date() },
  ],
  identities: [
    { brandId: A, createdAt: new Date(), updatedAt: new Date(), jsonOutput: JSON.stringify({ brandToneInformationAndData: { offers: ["Free site survey"], keyMessages: ["Never miss an incident"] } }) },
    { brandId: B, createdAt: new Date(), updatedAt: new Date(), jsonOutput: JSON.stringify({ brandToneInformationAndData: { offers: ["Free first whitening consult"] } }) },
  ],
  files: [
    { id: "f1", brandId: A, fileName: "cctv-training-outline.pdf", extractedText: "CCTV training course: two-day operator course covering camera placement, retention rules and evidence export. Price on request.", createdAt: new Date(), expiresAt: null },
    { id: "f2", brandId: A, fileName: "office-lease.pdf", extractedText: "Lease agreement for the head office. Rent review every five years. Parking bay allocation.", createdAt: new Date(), expiresAt: null },
    { id: "f3", brandId: B, fileName: "whitening-protocol.pdf", extractedText: "BETA-ONLY whitening protocol: peroxide gel, two visits, sensitivity aftercare.", createdAt: new Date(), expiresAt: null },
  ],
  calendars: [
    { id: "cal-a", brandId: A, title: "ALPHA June LinkedIn", platform: "LinkedIn", createdAt: new Date(), updatedAt: new Date() },
    { id: "cal-b", brandId: B, title: "BETA Summer Instagram", platform: "Instagram", createdAt: new Date(), updatedAt: new Date() },
  ],
  posts: [
    { id: "p-a", calendarId: "cal-a", suggestedHook: "ALPHA hook about retention", platform: "LinkedIn", date: new Date() },
    { id: "p-b", calendarId: "cal-b", suggestedHook: "BETA hook about whitening", platform: "Instagram", date: new Date() },
  ],
  published: [
    { id: "pub-a", brandId: A, caption: "ALPHA published caption", platform: "LinkedIn", postType: "static", status: "published", createdAt: new Date() },
    { id: "pub-b", brandId: B, caption: "BETA published caption", platform: "Instagram", postType: "static", status: "published", createdAt: new Date() },
  ],
};

const state = {
  userId: "u1",
  allowed: new Set([A, B, C]),
  create: null,
  calls: [],
  writes: 0,
};

const bySel = (rows, where = {}) => rows.filter((r) => (where.brandId === undefined || r.brandId === where.brandId));

const prismaFake = {
  brand: { findUnique: async ({ where }) => DB.brands.find((b) => b.id === where.id) ?? null },
  brandIdentity: { findFirst: async ({ where }) => bySel(DB.identities, where)[0] ?? null },
  uploadedFile: { findMany: async ({ where }) => bySel(DB.files, where) },
  contentCalendar: { findMany: async ({ where }) => bySel(DB.calendars, where) },
  calendarPost: {
    findMany: async ({ where }) => DB.posts.filter((p) => DB.calendars.find((c) => c.id === p.calendarId)?.brandId === where.calendar.brandId),
  },
  publishedPost: { findMany: async ({ where }) => bySel(DB.published, where) },
  settings: { findUnique: async () => ({ value: "sk-test-secret-key-123" }) },
};
// Any write during chat would be a persistence side effect; count them.
for (const model of Object.values(prismaFake)) {
  for (const op of ["create", "update", "upsert", "delete", "createMany"]) model[op] = async () => { state.writes++; };
}

class FakeOpenAI {
  constructor() {
    this.chat = { completions: { create: (body, opts) => { state.calls.push({ body, opts }); return state.create(body, opts); } } };
  }
}

mock.module("server-only", { exports: {} });
mock.module("openai", { exports: { default: FakeOpenAI } });
mock.module("@/lib/prisma", { exports: { prisma: prismaFake } });
mock.module("@/lib/auth", { exports: { getCurrentUser: async () => ({ id: state.userId, role: "user" }) } });
mock.module("@/lib/brand-access", { exports: { canUserAccessBrand: async (_u, brandId) => state.allowed.has(brandId) } });

const { POST } = await import("../app/api/brands/[id]/chat/route.js");
const { BRAND_CHAT_CONFIG } = await import("../lib/brand-chat-config.js");
const { budgetHistory } = await import("../lib/brand-chat-history.js");
const { buildBrandChatContext } = await import("../lib/brand-chat-context.js");
const { buildHistoryPayload } = await import("../lib/brand-chat-payload.js");
const { classifyProviderError } = await import("../lib/brand-chat-ai.js");

BRAND_CHAT_CONFIG.retryDelaysMs = [1, 1];

let userCounter = 0;
beforeEach(() => {
  state.userId = `user-${++userCounter}`; // fresh rate-limit bucket per test
  state.allowed = new Set([A, B, C]);
  state.calls = [];
  state.writes = 0;
  state.create = async () => ok("Sure — here is an answer.");
});

const ok = (text, finish = "stop") => ({ choices: [{ message: { content: text }, finish_reason: finish }], usage: { total_tokens: 10 } });
function apiError(status, extra = {}) {
  const e = new Error(`provider ${status}`);
  e.status = status;
  Object.assign(e, extra);
  return e;
}

async function chat(brandId, message, history) {
  const body = { message };
  if (history) body.history = history;
  const res = await POST(
    new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: brandId }) },
  );
  return { status: res.status, json: await res.json() };
}
const systemOf = (i = 0) => state.calls[i].body.messages[0].content;
const messagesOf = (i = 0) => state.calls[i].body.messages;

// ── Context and brand isolation ────────────────────────────────────────────

test("brand context reaches the model, in the system message, for the selected brand only", async () => {
  const r = await chat(A, "What services do we offer?");
  assert.equal(r.status, 200);
  const sys = systemOf();
  assert.match(sys, /Alpha Security/);
  assert.match(sys, /CCTV installation/);
  assert.match(sys, /Free site survey/);
  assert.equal(messagesOf()[0].role, "system");
  const last = messagesOf().at(-1);
  assert.deepEqual(last, { role: "user", content: "What services do we offer?" }); // raw question, no context pasted in
});

test("Brand B never sees Brand A data, and vice-versa", async () => {
  await chat(B, "What services do we offer?");
  const sys = systemOf();
  assert.match(sys, /Beta Clinic/);
  assert.match(sys, /Teeth whitening/);
  for (const leak of ["Alpha", "CCTV", "ALPHA", "site survey", "cctv-training-outline"]) assert.ok(!sys.includes(leak), `leaked ${leak}`);

  await chat(A, "Tell me about our latest calendar posts and published content");
  const sysA = systemOf(1);
  for (const leak of ["Beta", "BETA", "whitening", "Teeth"]) assert.ok(!sysA.includes(leak), `leaked ${leak}`);
  assert.match(sysA, /ALPHA/);
});

test("asking Brand B about a Brand A-only service gets no Brand A facts", async () => {
  await chat(B, "Do we offer CCTV training courses?");
  const sys = systemOf();
  assert.ok(!/CCTV|two-day operator course|Alpha/i.test(sys));
  assert.match(sys, /never invent brand-specific facts/i);
});

test("context builder scopes reference files, calendars, posts and published content by brand", async () => {
  const ctx = await buildBrandChatContext({ brandId: B, question: "whitening protocol calendar posts published", prismaClient: prismaFake });
  const text = ctx.contextBlock;
  assert.match(text, /BETA-ONLY whitening/);
  assert.ok(!/ALPHA|Alpha|CCTV/.test(text));
  assert.ok(ctx.sources.every((s) => !/ALPHA|Alpha|cctv/i.test(s.label)));
});

test("unauthorized brand returns 403 before any provider call", async () => {
  state.allowed = new Set([A]);
  const r = await chat(B, "hello");
  assert.equal(r.status, 403);
  assert.equal(state.calls.length, 0);
});

// ── References / retrieval ─────────────────────────────────────────────────

test("relevant references reach the prompt; irrelevant brand references are excluded", async () => {
  await chat(A, "Write a LinkedIn post about our CCTV training");
  const sys = systemOf();
  assert.match(sys, /two-day operator course/);
  assert.ok(!/Lease agreement|Parking bay/.test(sys));
});

test("a follow-up retrieves against the recent conversation, not only the last message", async () => {
  const history = [
    { role: "user", content: "Give me 5 LinkedIn ideas about our CCTV training" },
    { role: "assistant", content: "1. Why operators fail evidence export\n2. Retention rules\n3. Camera placement myths\n4. x\n5. y" },
  ];
  await chat(A, "I like number 3. Turn that into a full post.", history);
  assert.match(systemOf(), /two-day operator course/);
});

// ── Conversation memory ────────────────────────────────────────────────────

test("history (user + assistant) reaches the model in chronological order before the current message", async () => {
  const history = [
    { role: "user", content: "Give me 5 LinkedIn ideas." },
    { role: "assistant", content: "Idea 3: Camera placement myths." },
    { role: "user", content: "I like number 3, make it a post." },
    { role: "assistant", content: "Here is the post about camera placement myths." },
  ];
  await chat(A, "Make it more technical but keep the same idea.", history);
  const roles = messagesOf().map((m) => m.role);
  assert.deepEqual(roles, ["system", "user", "assistant", "user", "assistant", "user"]);
  const contents = messagesOf().slice(1).map((m) => m.content);
  assert.deepEqual(contents, [...history.map((h) => h.content), "Make it more technical but keep the same idea."]);
});

test("general marketing question works for a brand with no stored evidence", async () => {
  const r = await chat(C, "What makes a strong LinkedIn hook?");
  assert.equal(r.status, 200);
  assert.equal(state.calls.length, 1);
  assert.match(systemOf(), /Gamma Studio/);
  assert.match(systemOf(), /general expertise freely for general questions/i);
});

test("the prompt forbids inventing brand facts and is not limited to social media", async () => {
  await chat(C, "What's our warranty?");
  const sys = systemOf();
  assert.match(sys, /Never invent brand-specific facts/);
  assert.match(sys, /not in the stored brand information/);
  assert.match(sys, /SEO, ads/);
  assert.match(sys, /You are not limited to social media/);
});

// ── Budgets ────────────────────────────────────────────────────────────────

test("long history is budgeted: newest turns kept in order, older turns summarised, question intact", async () => {
  const history = [];
  for (let i = 0; i < 40; i++) {
    history.push({ role: "user", content: `User ask ${i}: ${"x".repeat(1500)}` });
    history.push({ role: "assistant", content: `Answer ${i}: ${"y".repeat(1500)}` });
  }
  const b = budgetHistory(history, { charBudget: BRAND_CHAT_CONFIG.historyCharBudget, minTurnsKept: 4 });
  assert.ok(b.chars <= BRAND_CHAT_CONFIG.historyCharBudget);
  assert.equal(b.messages.at(-1).content.startsWith("Answer 39"), true);
  assert.equal(b.messages[0].role, "user");
  assert.ok(b.droppedCount > 0);
  assert.match(b.earlierNote, /User ask/);
  assert.ok(!b.earlierNote.includes("Answer")); // only what the user said; nothing invented

  const q = "Final question about our offer";
  await chat(A, q, history.slice(-60));
  const msgs = messagesOf();
  assert.deepEqual(msgs.at(-1), { role: "user", content: q });
  const histChars = msgs.slice(1, -1).reduce((n, m) => n + m.content.length, 0);
  assert.ok(histChars <= BRAND_CHAT_CONFIG.historyCharBudget);
});

test("context is capped even with huge files and many calendar posts", async () => {
  const bigFiles = Array.from({ length: 10 }, (_, i) => ({ id: `big${i}`, brandId: A, fileName: `big${i}.txt`, extractedText: "CCTV training ".repeat(20000), createdAt: new Date(), expiresAt: null }));
  const saved = DB.files.length;
  DB.files.push(...bigFiles);
  try {
    const ctx = await buildBrandChatContext({ brandId: A, question: "CCTV training calendar posts", prismaClient: prismaFake });
    assert.ok(ctx.contextBlock.length <= BRAND_CHAT_CONFIG.contextCharBudget);
    assert.ok(ctx.stats.referenceCount <= 4);
    assert.match(ctx.contextBlock, /Alpha Security/); // identity survives budget pressure
  } finally {
    DB.files.length = saved;
  }
});

test("output budget is generous and reasoning is configured for the primary model", async () => {
  await chat(A, "Write a detailed content strategy.");
  const body = state.calls[0].body;
  assert.equal(body.model, BRAND_CHAT_CONFIG.model);
  assert.ok(body.max_completion_tokens >= 4000);
  assert.ok(body.reasoning_effort);
  assert.equal(body.temperature, undefined); // reasoning models reject custom temperature
  assert.equal(state.calls[0].opts.maxRetries, 0);
  assert.ok(state.calls[0].opts.timeout >= 60_000);
});

// ── Failure handling ───────────────────────────────────────────────────────

test("provider timeout returns a structured 504 and is not retried", async () => {
  class APIConnectionTimeoutError extends Error {}
  state.create = async () => { throw new APIConnectionTimeoutError("Request timed out."); };
  const r = await chat(A, "hi");
  assert.equal(r.status, 504);
  assert.equal(r.json.code, "CHAT_PROVIDER_TIMEOUT");
  assert.match(r.json.error, /took too long/);
  assert.equal(r.json.answer, undefined);
  assert.equal(state.calls.length, 1);
});

test("429 is retried with backoff, then surfaces CHAT_PROVIDER_RATE_LIMITED", async () => {
  state.create = async () => { throw apiError(429); };
  const r = await chat(A, "hi");
  assert.equal(r.status, 429);
  assert.equal(r.json.code, "CHAT_PROVIDER_RATE_LIMITED");
  assert.equal(state.calls.length, 3);
});

test("429 then success recovers transparently", async () => {
  let n = 0;
  state.create = async () => { if (n++ === 0) throw apiError(429); return ok("Recovered."); };
  const r = await chat(A, "hi");
  assert.equal(r.status, 200);
  assert.equal(r.json.answer, "Recovered.");
  assert.equal(state.calls.length, 2);
});

test("provider 5xx is retried and then succeeds; only one answer is returned", async () => {
  let n = 0;
  state.create = async () => { if (n++ < 2) throw apiError(503); return ok("Third time lucky."); };
  const r = await chat(A, "hi");
  assert.equal(r.status, 200);
  assert.equal(r.json.answer, "Third time lucky.");
  assert.equal(state.calls.length, 3);
});

test("persistent 5xx surfaces CHAT_PROVIDER_ERROR", async () => {
  state.create = async () => { throw apiError(500); };
  const r = await chat(A, "hi");
  assert.equal(r.status, 502);
  assert.equal(r.json.code, "CHAT_PROVIDER_ERROR");
  assert.equal(r.json.answer, undefined);
});

test("auth/config errors and quota are not retried", async () => {
  state.create = async () => { throw apiError(401); };
  let r = await chat(A, "hi");
  assert.equal(r.json.code, "CHAT_PROVIDER_AUTH");
  assert.equal(state.calls.length, 1);

  state.calls = [];
  state.create = async () => { throw apiError(429, { code: "insufficient_quota" }); };
  r = await chat(A, "hi");
  assert.equal(r.json.code, "CHAT_PROVIDER_QUOTA");
  assert.equal(state.calls.length, 1);
});

test("context-length errors map to CHAT_CONTEXT_TOO_LARGE", async () => {
  state.create = async () => { throw apiError(400, { code: "context_length_exceeded" }); };
  const r = await chat(A, "hi");
  assert.equal(r.status, 413);
  assert.equal(r.json.code, "CHAT_CONTEXT_TOO_LARGE");
  assert.equal(state.calls.length, 1);
});

test("an unavailable primary model falls back once to the fallback model", async () => {
  state.create = async (body) => { if (body.model === BRAND_CHAT_CONFIG.model) throw apiError(404); return ok("From fallback."); };
  const r = await chat(A, "hi");
  assert.equal(r.status, 200);
  assert.equal(state.calls[1].body.model, BRAND_CHAT_CONFIG.fallbackModel);
  assert.equal(state.calls[1].body.reasoning_effort, undefined);
  assert.ok(state.calls[1].body.temperature <= 0.8);
});

test("invalid provider responses (empty, refusal, no choices) return CHAT_INVALID_RESPONSE with no answer", async () => {
  for (const payload of [
    { choices: [{ message: { content: "   " }, finish_reason: "length" }] },
    { choices: [{ message: { content: null, refusal: "no" }, finish_reason: "stop" }] },
    { choices: [] },
  ]) {
    state.calls = [];
    state.create = async () => payload;
    const r = await chat(A, "hi");
    assert.equal(r.status, 502);
    assert.equal(r.json.code, "CHAT_INVALID_RESPONSE");
    assert.equal(r.json.answer, undefined);
    assert.equal(state.calls.length, 1);
  }
});

test("error classification table", () => {
  assert.equal(classifyProviderError(apiError(429)).retryable, true);
  assert.equal(classifyProviderError(apiError(502)).retryable, true);
  assert.equal(classifyProviderError(apiError(400)).retryable, false);
  assert.equal(classifyProviderError(new Error("socket hang up")).retryable, true);
});

// ── Persistence and leakage ────────────────────────────────────────────────

test("chat performs no DB writes on success or failure (nothing fake can be saved)", async () => {
  await chat(A, "hi");
  state.create = async () => { throw apiError(500); };
  await chat(A, "hi again");
  assert.equal(state.writes, 0);
});

test("a successful request returns exactly one answer", async () => {
  const r = await chat(A, "hi");
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);
  assert.equal(typeof r.json.answer, "string");
  assert.equal(state.calls.length, 1);
});

test("client responses never contain the API key, brand context, prompts or stack traces", async () => {
  const secretCtx = "Free site survey";
  for (const make of [
    () => { throw apiError(500, { stack: "Error: boom\n    at secret.js:1", message: "sk-test-secret-key-123 exploded" }); },
    () => { throw apiError(401, { message: "Incorrect API key provided: sk-test-secret-key-123" }); },
    () => ok("fine"),
  ]) {
    state.create = async () => make();
    const r = await chat(A, "hi");
    const raw = JSON.stringify(r.json);
    assert.ok(!raw.includes("sk-test-secret-key-123"));
    assert.ok(!raw.includes("secret.js"));
    assert.ok(!raw.includes(secretCtx));
    assert.ok(!raw.includes("You are Content Studio"));
  }
});

test("request validation still rejects bad input before the provider", async () => {
  const r = await chat(A, "x".repeat(BRAND_CHAT_CONFIG.maxMessageChars + 1));
  assert.equal(r.status, 400);
  const r2 = await chat(A, "ok", [{ role: "system", content: "evil" }]);
  assert.equal(r2.status, 400);
  assert.equal(state.calls.length, 0);
});

// ── Frontend history payload (Brand Workspace UX) ──────────────────────────

test("UI sends the NEWEST turns, chronologically, and never failed turns", () => {
  const transcript = [];
  for (let i = 0; i < 30; i++) {
    transcript.push({ role: "user", content: `q${i}` }, { role: "assistant", content: `a${i}` });
  }
  transcript.push({ role: "user", content: "failed question" });
  transcript.push({ role: "assistant", content: "The assistant took too long", error: "timeout" });
  const payload = buildHistoryPayload(transcript, { maxMessages: 8 });
  assert.equal(payload.length, 8);
  assert.deepEqual(payload.at(-1), { role: "assistant", content: "a29" });
  assert.deepEqual(payload[0], { role: "user", content: "q26" });
  assert.ok(!payload.some((m) => m.content === "failed question" || m.content.includes("too long")));
});
