// Streamed-response contract of POST /api/content-calendar/generate.
//
// Once the keep-alive heartbeat starts, the HTTP status line (200) is already
// sent, so every failure from then on must still reach the client as
//   { success: false, code, error, status }
// with the correct semantic code/status, and the client must decide success from
// that body — never from `response.ok`. Uses the real route and the real
// heartbeat helper with short timings, and a delayed mocked provider.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

import * as realCalendarPostUtils from "../lib/calendar-post-utils.js";
const realHeartbeat = await import("../lib/heartbeat-json-response.js");
const realBudget = await import("../lib/calendar-generation-budget.js");
const {
  readCalendarGenerationResult,
  CALENDAR_TIMEOUT_MESSAGE,
  CALENDAR_INVALID_OUTPUT_MESSAGE,
} = await import("../lib/calendar-generation-errors.js");

const state = {
  heartbeat: { startAfterMs: 20, intervalMs: 10 },
  aiImpl: null,
  aiCalls: 0,
  validateThrows: null,
  dbWrites: [],
  now: null,
};

mock.module("@/lib/auth", {
  exports: {
    getCurrentUser: async () => ({ id: "u1", role: "admin" }),
    getBrandCalendarAccess: async () => ({ allowed: true, status: 200, error: null }),
  },
});
mock.module("@/lib/prisma", {
  exports: {
    prisma: new Proxy({}, {
      get(_, model) {
        if (model === "brand") return { findUnique: async ({ where }) => ({ id: where.id, name: "کلینیک", contentLanguage: "fa" }) };
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
      ok: true, block: "", attachmentIds: [], attachmentCount: 0, wasTruncated: false, attachments: [],
    }),
  },
});
mock.module("@/lib/ai", {
  exports: {
    generateWithPromptTemplate: async (opts) => { state.aiCalls++; return state.aiImpl(opts); },
  },
});
mock.module("@/lib/heartbeat-json-response", {
  exports: { respondWithHeartbeat: (work) => realHeartbeat.respondWithHeartbeat(work, state.heartbeat) },
});
mock.module("@/lib/calendar-generation-budget", {
  exports: {
    ...realBudget,
    getProviderTimeoutForAttempt: (deadline) => realBudget.getProviderTimeoutForAttempt(deadline, state.now ?? Date.now()),
  },
});
mock.module("@/lib/calendar-post-utils", {
  exports: {
    ...realCalendarPostUtils,
    validateOutputImageTextRequirements: (post) => {
      if (state.validateThrows) throw new Error(state.validateThrows);
      return realCalendarPostUtils.validateOutputImageTextRequirements(post);
    },
  },
});

const { POST } = await import("../app/api/content-calendar/generate/route.js");

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const DELAY_MS = 60; // longer than heartbeat.startAfterMs → streaming has begun

let uniq = 0;
function faPosts(count) {
  return Array.from({ length: count }, () => {
    const n = ++uniq;
    return {
      hookTitle: `لبخند «زیباتر» با نیم‌فاصله ۱۲۳ — ${n}`, coreMessage: `می‌خواهم ${n}`, mainAngle: `زاویه ${n}`,
      caption: "آیا می‌دانید؟ نوبت بگیرید؛ ۰۹۱۲", format: "Reel", platform: "Instagram",
      hashtags: ["#می‌خواهم"], outputImageTextRequirements: "تیتر: لبخند",
    };
  });
}

function reset() {
  state.heartbeat = { startAfterMs: 20, intervalMs: 10 };
  state.aiCalls = 0;
  state.validateThrows = null;
  state.dbWrites = [];
  state.now = null;
  state.aiImpl = async (opts) => {
    await delay(DELAY_MS);
    const count = Math.min(Number(opts.userInput.match(/(\d+)\s+posts?/i)?.[1] ?? 4), 5);
    return { content: null, raw: JSON.stringify({ posts: faPosts(count) }), finishReason: "stop" };
  };
}

const BODY = {
  brandId: "b1", numberOfPostsNeeded: 4, mainMonthlySubject: "ماه لبخند", platforms: "Instagram",
  requiredPostFormats: "Carousel, Reel, Static", calendarPeriodStart: "2026-11-01", calendarPeriodEnd: "2026-11-30",
};

// Reads the response chunk by chunk, recording what arrived before the end.
async function readStream(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return { chunks: chunks.filter((c) => c.length), text: chunks.join("") };
}

async function call(body = BODY) {
  const res = await POST(new Request("http://localhost/api/content-calendar/generate", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  const { chunks, text } = await readStream(res);
  return { res, chunks, text, data: JSON.parse(text) };
}

// With a fake clock, a provider call "uses" its whole timeout.
async function withFakeClock(fn) {
  const realNow = Date.now;
  state.now = realNow();
  Date.now = () => state.now;
  try { return await fn(); } finally { Date.now = realNow; }
}
function timeoutAi(afterMs) {
  return async (opts) => {
    await delay(afterMs);
    state.now += opts.timeoutMs;
    const e = new Error("The AI provider did not respond in time."); e.code = "AI_TIMEOUT"; throw e;
  };
}

function assertStreamedFailure({ res, chunks, data }, { code, status }) {
  assert.equal(res.status, 200, "status line is already sent once the heartbeat starts");
  assert.match(res.headers.get("cache-control"), /no-transform/);
  assert.ok(chunks.length >= 2, "heartbeat bytes precede the JSON");
  assert.equal(data.success, false);
  assert.equal(data.code, code);
  assert.equal(data.status, status);
  assert.ok(typeof data.error === "string" && data.error.length > 0);
  const result = readCalendarGenerationResult(data);
  assert.equal(result.ok, false, "client must not proceed to Review");
  assert.equal(result.posts, undefined, "no partial calendar reaches the client");
  assert.deepEqual(state.dbWrites, []);
  return result;
}

test("heartbeat + successful Persian JSON: whitespace-only heartbeats, one complete JSON chunk, Unicode intact", async () => {
  reset();
  const { res, chunks, text, data } = await call({ ...BODY, numberOfPostsNeeded: 12 });
  assert.equal(res.status, 200);
  assert.ok(chunks.length >= 2);
  const heartbeats = chunks.slice(0, -1);
  assert.ok(heartbeats.every((c) => /^ +$/.test(c)), "heartbeat chunks are spaces only — no partial JSON");
  assert.doesNotThrow(() => JSON.parse(chunks.at(-1)), "the JSON arrives whole in the final chunk");
  assert.equal(text.trimStart(), chunks.at(-1).trimStart());
  assert.equal(data.success, true);
  assert.equal(data.posts.length, 12);
  assert.ok(data.posts[0].hookTitle.startsWith("لبخند «زیباتر» با نیم‌فاصله ۱۲۳"));
  const result = readCalendarGenerationResult(data);
  assert.equal(result.ok, true);
  assert.equal(result.posts.length, 12);
  assert.deepEqual(state.dbWrites, []);
});

test("heartbeat body is accepted by Response.json()", async () => {
  reset();
  const res = await POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(BODY) }));
  const data = await res.json();
  assert.equal(data.success, true);
});

test("provider timeout BEFORE the heartbeat starts keeps the real 504 status", async () => {
  reset();
  state.heartbeat = { startAfterMs: 2_000, intervalMs: 10 };
  state.aiImpl = timeoutAi(0);
  await withFakeClock(async () => {
    const { res, chunks, data } = await call();
    assert.equal(res.status, 504);
    assert.equal(chunks.length, 1, "not streamed");
    assert.equal(data.success, false);
    assert.equal(data.code, "CALENDAR_GENERATION_TIMEOUT");
    assert.equal(readCalendarGenerationResult(data).message, CALENDAR_TIMEOUT_MESSAGE);
  });
});

test("provider timeout AFTER the heartbeat starts: HTTP 200, body success:false, code/status preserved", async () => {
  reset();
  state.aiImpl = timeoutAi(DELAY_MS);
  await withFakeClock(async () => {
    const r = await call();
    const result = assertStreamedFailure(r, { code: "CALENDAR_GENERATION_TIMEOUT", status: 504 });
    assert.equal(result.message, CALENDAR_TIMEOUT_MESSAGE);
  });
});

test("route deadline reached AFTER the heartbeat starts (provider keeps returning nothing usable)", async () => {
  reset();
  state.aiImpl = async (opts) => {
    await delay(DELAY_MS);
    state.now += opts.timeoutMs;
    return { content: null, raw: '{"posts":[]}', finishReason: "stop" };
  };
  await withFakeClock(async () => {
    const r = await call();
    assertStreamedFailure(r, { code: "CALENDAR_GENERATION_TIMEOUT", status: 504 });
    assert.ok(r.data.requestedCount === 4 && r.data.generatedCount === 0);
  });
});

test("provider connection failure AFTER the heartbeat starts", async () => {
  reset();
  state.aiImpl = async () => {
    await delay(DELAY_MS);
    const e = new Error("Couldn't reach the AI service (OpenAI)."); e.code = "AI_CONNECTION_ERROR"; throw e;
  };
  const r = await call();
  const result = assertStreamedFailure(r, { code: "AI_PROVIDER_UNAVAILABLE", status: 503 });
  assert.match(result.message, /AI service/);
  assert.equal(state.aiCalls, 1, "fails fast");
});

test("invalid AI output AFTER the heartbeat starts → validation error", async () => {
  reset();
  state.validateThrows = "Invalid JSON shape in post payload";
  const r = await call();
  const result = assertStreamedFailure(r, { code: "CALENDAR_OUTPUT_INVALID", status: 422 });
  assert.equal(result.message, CALENDAR_INVALID_OUTPUT_MESSAGE);
});

test("unparseable AI output on every attempt AFTER the heartbeat starts → incomplete-count error", async () => {
  reset();
  state.aiImpl = async () => { await delay(DELAY_MS); return { content: null, raw: "not json {", finishReason: "length" }; };
  const r = await call();
  assertStreamedFailure(r, { code: "CALENDAR_POST_COUNT_INCOMPLETE", status: 422 });
});

test("client result reader: HTTP status is never consulted, only the body", () => {
  assert.equal(readCalendarGenerationResult({ success: false, code: "CALENDAR_GENERATION_TIMEOUT", status: 504, error: "x" }).ok, false);
  assert.equal(readCalendarGenerationResult({ success: false, code: "CALENDAR_OUTPUT_INVALID", error: "x" }).message, CALENDAR_INVALID_OUTPUT_MESSAGE);
  assert.equal(readCalendarGenerationResult({ success: false, error: "Brand not found." }).message, "Brand not found.");
  // A body without an explicit success flag is not treated as a calendar.
  assert.equal(readCalendarGenerationResult({ posts: [{}] }).ok, false);
  assert.equal(readCalendarGenerationResult(null).ok, false);
  assert.equal(readCalendarGenerationResult({ success: true, posts: [] }).ok, true);
});
