// Integration tests for POST /api/video/brand-based/generate.
//
// Heavy dependencies are mocked; the real cinematic-style validation/resolution
// and prompt construction run untouched.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const state = {
  capturedUserInput: null,
  aiImpl: async () => ({ content: "Generate a video with the following prompt, dont change it - \n\nsubject: a barista making coffee" }),
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
      generatedPrompt: {
        create: async ({ data }) => ({ id: "video-saved-1", type: "video", ...data }),
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
    createCompactBrandVisualIdentitySummaryForVideoPrompt: () => "Video brand identity summary",
  },
});

mock.module("@/lib/video-camera-movements", {
  exports: {
    selectCameraMovement: () => ({
      label: "Dolly In",
      execution: "tracked-smooth",
      speed: "slow",
      endFrame: "tighter",
    }),
  },
});

let route;
async function getRoute() {
  if (!route) route = await import("../app/api/video/brand-based/generate/route.js");
  return route.POST;
}

function makeRequest(body) {
  return new Request("http://localhost/api/video/brand-based/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const BASE = {
  brandId: "brand-1",
  rawVideoIdea: "Film a barista crafting a pour-over coffee",
  platform: "Instagram",
  videoFormat: "Reel",
  videoGoal: "Awareness",
  targetVideoCreatorModel: "Higgsfield",
  duration: "15 seconds",
  aspectRatio: "9:16",
};

async function parse(res) {
  const text = await res.text();
  assert.ok(text.trim(), `response body must not be empty (status ${res.status})`);
  return JSON.parse(text);
}

test("video request with a valid cinematic style resolves its instructions into the prompt", async () => {
  state.db = { brand: { id: "brand-1", name: "Test Brand" }, brandIdentity: { id: "bi-1", brandId: "brand-1" } };
  state.capturedUserInput = null;

  const POST = await getRoute();
  const res = await POST(makeRequest({ ...BASE, cinematicStyle: "anamorphic-blockbuster" }));

  assert.equal(res.status, 200);
  const data = await parse(res);
  assert.equal(data.success, true);
  assert.ok(data.generatedPrompt.finalPrompt.startsWith("Generate a video with the following prompt"));

  const input = state.capturedUserInput;
  assert.ok(input.includes("CINEMATIC VISUAL STYLE"));
  assert.ok(input.includes("Anamorphic Blockbuster"));
  assert.ok(input.includes("Anamorphic prime lenses"));
  assert.ok(input.includes("Motion character"));
  assert.ok(input.includes("controlled dolly, tracking, crane, or orbit"));
  assert.ok(!input.includes("anamorphic-blockbuster"), "raw id must not leak into the prompt");
});

test("video request with no cinematic style omits the style block", async () => {
  state.db = { brand: { id: "brand-1", name: "Test Brand" }, brandIdentity: { id: "bi-1", brandId: "brand-1" } };
  state.capturedUserInput = null;

  const POST = await getRoute();
  const res = await POST(makeRequest(BASE));

  assert.equal(res.status, 200);
  await parse(res);
  assert.ok(state.capturedUserInput);
  assert.ok(!state.capturedUserInput.includes("CINEMATIC VISUAL STYLE"));
});

test("video request with an invalid cinematic style returns a clear 400 JSON error", async () => {
  state.db = { brand: { id: "brand-1", name: "Test Brand" }, brandIdentity: { id: "bi-1", brandId: "brand-1" } };
  state.capturedUserInput = null;

  const POST = await getRoute();
  const res = await POST(makeRequest({ ...BASE, cinematicStyle: "bogus-style" }));

  assert.equal(res.status, 400);
  const data = await parse(res);
  assert.equal(data.success, false);
  assert.match(data.error, /Unsupported cinematic style: "bogus-style"/);
  assert.equal(state.capturedUserInput, null, "AI must not be called for an invalid preset");
});

test("video backend exceptions always return valid JSON", async () => {
  state.db = { brand: { id: "brand-1", name: "Test Brand" }, brandIdentity: { id: "bi-1", brandId: "brand-1" } };

  const POST = await getRoute();
  state.aiImpl = async () => {
    throw new Error("OpenAI exploded");
  };
  const aiRes = await POST(makeRequest({ ...BASE, cinematicStyle: "anamorphic-blockbuster" }));
  assert.equal(aiRes.status, 500);
  const aiData = await parse(aiRes);
  assert.equal(aiData.success, false);
  assert.match(aiData.error, /failed|exploded/i);
  assert.match(aiData.details ?? "", /OpenAI exploded/);

  state.aiImpl = async () => ({ content: "Generate a video with the following prompt, dont change it - ok" });
  state.throwOnIdentity = true;
  const dbRes = await POST(makeRequest(BASE));
  assert.equal(dbRes.status, 500);
  await parse(dbRes);
  state.throwOnIdentity = false;
});
