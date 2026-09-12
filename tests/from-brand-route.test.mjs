// Integration tests for POST /api/image/from-brand/generate.
//
// The route's heavy dependencies (prisma, auth, OpenAI) are mocked; the real
// prompt-construction + cinematic-style logic (lib/image-visual-controls,
// lib/cinematic-styles, buildUserInput) runs untouched. This reproduces the
// original bug (ReferenceError escaping the handler → empty 500 body → frontend
// "Unexpected end of JSON input") and locks in the fixed behaviour.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

// ── Mutable test state + mocks ────────────────────────────────────────────────

const state = {
  capturedUserInput: null,
  aiImpl: async () => ({ content: "A clean Nanobanana-ready image prompt for the brand." }),
  db: {},
  throwOnIdentity: false,
};

mock.module("@/lib/auth", {
  exports: {
    getAdminAccess: async () => ({ user: { id: "u1", role: "admin" }, error: null, status: 200 }),
    getCurrentUser: async () => ({ id: "u1", role: "admin" }),
  },
});

// These tests cover prompt construction, not authorization. An admin passes
// every brand check, so the guard is stubbed open here; the brand-authorization
// rules themselves are covered by tests/brand-access.test.mjs.
mock.module("@/lib/brand-access", {
  exports: {
    requireBrandAccess: async (brandId) => ({
      ok: true,
      user: { id: "u1", role: "admin" },
      brandId,
      status: 200,
      error: null,
    }),
  },
});

mock.module("@/lib/prisma", {
  exports: {
    prisma: {
      brand: {
        findUnique: async ({ where }) =>
          state.db.brand && state.db.brand.id === where.id ? state.db.brand : null,
      },
      brandIdentity: {
        findFirst: async () => {
          if (state.throwOnIdentity) throw new Error("DB connection lost");
          return state.db.brandIdentity ?? null;
        },
      },
      promptTemplate: {
        findUnique: async () => ({ templateText: "…Nanobanana-ready image prompt…", outputType: "text" }),
        update: async () => ({}),
      },
      generatedPrompt: {
        create: async ({ data }) => ({ id: "saved-123", ...data }),
      },
    },
  },
});

mock.module("@/lib/ai", {
  exports: {
    generateWithPromptTemplate: async (opts) => {
      state.capturedUserInput = opts.userInput ?? null;
      return state.aiImpl(opts);
    },
  },
});

mock.module("@/lib/brand-identity-utils", {
  exports: {
    normalizeBrandIdentityOutput: () => ({ brandVisualIdentity: { palette: ["#000000"] } }),
    createCompactBrandVisualIdentitySummaryForImagePrompt: () => "Brand identity summary text",
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

let route;
async function getRoute() {
  if (!route) route = await import("../app/api/image/from-brand/generate/route.js");
  return route.POST;
}

function makeRequest(visualControls = {}, extra = {}) {
  const body = JSON.stringify({
    brandId: "brand-1",
    rawIdeaOrPostInformation: "A bold Instagram post about landing pages",
    ...extra,
    visualControls: { preset: "custom", ...visualControls },
  });
  return new Request("http://localhost/api/image/from-brand/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

async function parse(res) {
  const text = await res.text();
  assert.ok(text.trim(), `response body must not be empty (status ${res.status})`);
  return JSON.parse(text);
}

test("image request with no cinematic style succeeds and sends no style block", async () => {
  state.db = { brand: { id: "brand-1", name: "Test Brand" }, brandIdentity: { id: "bi-1", brandId: "brand-1" } };
  state.capturedUserInput = null;

  const POST = await getRoute();
  const res = await POST(makeRequest({ cinematicStyle: "auto" }));

  assert.equal(res.status, 200);
  const data = await parse(res);
  assert.equal(data.success, true);
  assert.ok(data.generatedPrompt.id);
  assert.ok(data.generatedPrompt.finalPrompt.length > 0);
  assert.ok(state.capturedUserInput, "AI should have been called with user input");
  assert.ok(!state.capturedUserInput.includes("CINEMATIC VISUAL STYLE"));
});

test("image request with a valid cinematic style sends resolved instructions to the provider", async () => {
  state.db = { brand: { id: "brand-1", name: "Test Brand" }, brandIdentity: { id: "bi-1", brandId: "brand-1" } };
  state.capturedUserInput = null;

  const POST = await getRoute();
  const res = await POST(makeRequest({ cinematicStyle: "anamorphic-blockbuster" }));

  assert.equal(res.status, 200);
  const data = await parse(res);
  assert.equal(data.success, true);

  const input = state.capturedUserInput;
  assert.ok(input.includes("CINEMATIC VISUAL STYLE"));
  assert.ok(input.includes("Anamorphic Blockbuster"));
  assert.ok(input.includes("Anamorphic prime lenses"), "resolved lens/optics instructions must be present");
  assert.ok(input.includes("oval bokeh"));
  assert.ok(input.includes("Widescreen theatrical framing"));
  assert.ok(input.includes("Dimensional production lighting"));
  assert.ok(input.includes("Cinematic contrast"));
  // The raw identifier is never emitted as the only signal.
  assert.ok(!input.includes("anamorphic-blockbuster"));
});

test("image request with a different valid style resolves that style's instructions", async () => {
  state.db = { brand: { id: "brand-1", name: "Test Brand" }, brandIdentity: { id: "bi-1", brandId: "brand-1" } };
  state.capturedUserInput = null;

  const POST = await getRoute();
  const res = await POST(makeRequest({ cinematicStyle: "neo-noir-thriller" }));

  assert.equal(res.status, 200);
  await parse(res);
  assert.ok(state.capturedUserInput.includes("Neo-Noir Thriller"));
  assert.ok(state.capturedUserInput.includes("deep blacks"));
  assert.ok(state.capturedUserInput.includes("strong shadow geometry"));
});

test("image request with an invalid cinematic style returns a clear 400 JSON error", async () => {
  state.db = { brand: { id: "brand-1", name: "Test Brand" }, brandIdentity: { id: "bi-1", brandId: "brand-1" } };
  state.capturedUserInput = null;

  const POST = await getRoute();
  const res = await POST(makeRequest({ cinematicStyle: "not-a-real-style" }));

  assert.equal(res.status, 400);
  const data = await parse(res);
  assert.equal(data.success, false);
  assert.match(data.error, /Unsupported cinematic style: "not-a-real-style"/);
  // The AI must never be reached for an invalid preset.
  assert.equal(state.capturedUserInput, null);
});

test("image request with a blank cinematic style behaves like auto", async () => {
  state.db = { brand: { id: "brand-1", name: "Test Brand" }, brandIdentity: { id: "bi-1", brandId: "brand-1" } };
  state.capturedUserInput = null;

  const POST = await getRoute();
  const res = await POST(makeRequest({ cinematicStyle: "" }));

  assert.equal(res.status, 200);
  await parse(res);
  assert.ok(state.capturedUserInput);
  assert.ok(!state.capturedUserInput.includes("CINEMATIC VISUAL STYLE"));
});

test("backend exceptions always return valid JSON, never an empty body", async () => {
  state.db = { brand: { id: "brand-1", name: "Test Brand" }, brandIdentity: { id: "bi-1", brandId: "brand-1" } };
  const POST = await getRoute();

  // 1. AI provider throws inside the handler.
  state.aiImpl = async () => {
    throw new Error("OpenAI exploded");
  };
  const aiRes = await POST(makeRequest({}));
  assert.equal(aiRes.status, 500);
  const aiData = await parse(aiRes);
  assert.equal(aiData.success, false);
  assert.match(aiData.error, /OpenAI exploded/);

  // 2. Unexpected DB exception inside the handler.
  state.aiImpl = async () => ({ content: "ok" });
  state.throwOnIdentity = true;
  const dbRes = await POST(makeRequest({}));
  assert.equal(dbRes.status, 500);
  const dbData = await parse(dbRes);
  assert.equal(dbData.success, false);
  assert.match(dbData.error, /DB connection lost/);
  state.throwOnIdentity = false;
});
