// Integration tests for POST /api/content-calendar/generate.
//
// These lock in one invariant above all: whatever fails inside this route, the
// client must receive a parseable JSON body. Calendar generation sits behind a
// generic "unexpected error" toast in the UI, and that toast is only reachable
// when the response is NOT JSON — so a crash that escapes the JSON envelope
// here is indistinguishable, from the browser, from the app being unreachable.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

import * as realCalendarPostUtils from "../lib/calendar-post-utils.js";

const state = {
  currentUser: { id: "u1", role: "admin" },
  authThrows: false,
  access: { allowed: true, status: 200, error: null },
  attachmentCalls: [],
  attachmentResult: {
    ok: true, block: "", attachmentIds: [], attachmentCount: 0,
    wasTruncated: false, attachments: [],
  },
  aiImpl: null,
  validateThrows: null,
};

mock.module("@/lib/auth", {
  exports: {
    getCurrentUser: async () => {
      if (state.authThrows) throw new Error("SQLITE_CANTOPEN: unable to open database file");
      return state.currentUser;
    },
    getBrandCalendarAccess: async () => state.access,
  },
});

mock.module("@/lib/prisma", {
  exports: {
    prisma: {
      brand: { findUnique: async ({ where }) => ({ id: where.id, name: "Test Brand", contentLanguage: "en" }) },
      brandIdentity: { findFirst: async () => null },
    },
  },
});

mock.module("@/lib/calendar-attachment-context", {
  exports: {
    resolveCalendarAttachmentContext: async (opts) => {
      state.attachmentCalls.push(opts);
      return state.attachmentResult;
    },
  },
});

mock.module("@/lib/ai", {
  exports: {
    generateWithPromptTemplate: async (opts) => state.aiImpl(opts),
  },
});

// Real utils throughout, except the one hook a test needs to fail from the
// stretch of the handler that is NOT wrapped in its own try/catch.
mock.module("@/lib/calendar-post-utils", {
  exports: {
    ...realCalendarPostUtils,
    validateOutputImageTextRequirements: (post) => {
      if (state.validateThrows) throw new Error(state.validateThrows);
      return realCalendarPostUtils.validateOutputImageTextRequirements(post);
    },
  },
});

let route;
async function getRoute() {
  if (!route) route = await import("../app/api/content-calendar/generate/route.js");
  return route.POST;
}

function makeRequest(body) {
  return new Request("http://localhost/api/content-calendar/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// The assertion that matters: a body that JSON.parse can read.
async function parseJson(res) {
  const text = await res.text();
  assert.ok(text && text.trim(), `response body must not be empty (status ${res.status})`);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    assert.fail(`response body must be valid JSON (status ${res.status}): ${text.slice(0, 300)}`);
  }
  return data;
}

function post(i) {
  return {
    hookTitle: `Hook ${i}`,
    coreMessage: `Core message ${i}`,
    mainAngle: `Angle ${i}`,
    caption: `Caption ${i}`,
    format: "Reel",
    platform: "Instagram",
    hashtags: ["#a", "#b"],
    outputImageTextRequirements: "Headline: Hi",
  };
}

const BASE = {
  brandId: "brand-1",
  numberOfPostsNeeded: 4,
  mainMonthlySubject: "Launch month",
  platforms: "Instagram",
  requiredPostFormats: "Reel",
  publishingFrequency: "weekly",
  attachmentIds: [],
};

function reset() {
  state.currentUser = { id: "u1", role: "admin" };
  state.authThrows = false;
  state.access = { allowed: true, status: 200, error: null };
  state.attachmentCalls = [];
  state.attachmentResult = {
    ok: true, block: "", attachmentIds: [], attachmentCount: 0,
    wasTruncated: false, attachments: [],
  };
  state.validateThrows = null;
  state.aiImpl = async () => ({
    content: { posts: [post(1), post(2), post(3), post(4)] },
    raw: "",
    finishReason: "stop",
  });
}

test("generates a calendar with no reference file without consulting the attachment interpreter", async () => {
  reset();
  const POST = await getRoute();
  const res = await POST(makeRequest(BASE));

  const data = await parseJson(res);
  assert.equal(res.status, 200);
  assert.equal(data.success, true);
  assert.equal(data.posts.length, 4);

  // The no-attachment flow must still resolve context, but with an empty list —
  // it must never require an interpreted attachment to exist.
  assert.equal(state.attachmentCalls.length, 1);
  assert.deepEqual(state.attachmentCalls[0].attachmentIds, []);
  assert.equal(state.attachmentCalls[0].mode, "creation");
});

test("a session/database failure during authentication still returns JSON", async () => {
  reset();
  state.authThrows = true;

  const POST = await getRoute();
  const res = await POST(makeRequest(BASE));

  // Must not throw out of the handler: that yields a non-JSON error page.
  const data = await parseJson(res);
  assert.equal(res.status, 500);
  assert.equal(data.success, false);
  assert.ok(data.error);
});

test("a failure after the post count is known still returns JSON and reports the count", async () => {
  reset();
  // Thrown from the un-guarded stretch after safeCount is resolved, with a
  // message that routes to the sub-500 branch of the error handler.
  state.validateThrows = "Invalid JSON shape in post payload";

  const POST = await getRoute();
  const res = await POST(makeRequest(BASE));

  const data = await parseJson(res);
  assert.equal(res.status, 422);
  assert.equal(data.success, false);
  assert.equal(data.code, "CALENDAR_OUTPUT_INVALID");
  assert.equal(data.requestedCount, 4);
  assert.equal(data.generatedCount, 0);
});

test("an unauthorized brand is refused as JSON before any attachment work", async () => {
  reset();
  state.access = { allowed: false, status: 403, error: "You do not have access to this brand." };

  const POST = await getRoute();
  const res = await POST(makeRequest(BASE));

  const data = await parseJson(res);
  assert.equal(res.status, 403);
  assert.equal(data.success, false);
  assert.match(data.error, /access/i);
  assert.equal(state.attachmentCalls.length, 0, "authorization must be settled before attachments load");
});

test("a missing prompt template surfaces as JSON rather than a crash", async () => {
  reset();
  state.aiImpl = async () => {
    throw new Error('Prompt template not found: "content-calendar-generator"');
  };

  const POST = await getRoute();
  const res = await POST(makeRequest(BASE));

  const data = await parseJson(res);
  assert.equal(data.success, false);
  assert.ok(data.error);
});

test("an unconfigured API key surfaces its actionable JSON message", async () => {
  reset();
  state.aiImpl = async () => {
    const err = new Error("OPENAI_API_KEY is not configured.");
    err.code = "AI_NOT_CONFIGURED";
    throw err;
  };

  const POST = await getRoute();
  const res = await POST(makeRequest(BASE));

  const data = await parseJson(res);
  assert.equal(data.success, false);
  assert.ok(data.error);
});
