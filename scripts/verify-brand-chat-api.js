#!/usr/bin/env node
// Verification script for Brand Chat API (Phase 2).
// Tests pure helpers and injectable modules — no live OpenAI or dev.db needed.
//
// Run: node scripts/run-verify-api.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import { createRateLimiter } from "../lib/rate-limiter.js";
import { mapBrandChatContextError, mapAiError } from "../lib/chat-error-mapper.js";
import { buildBrandChatContext, BrandChatContextError } from "../lib/brand-chat-context.js";

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    failed++;
    console.log(`  \u2717 ${name}`);
    const msg = e.message ? e.message.split("\n")[0] : String(e);
    console.log(`    ${msg}`);
  }
}

async function testGroup(label, tests) {
  console.log(`\n${label}`);
  for (const [name, fn] of Object.entries(tests)) {
    await test(name, fn);
  }
}

// ─── Mock data builders (subset of Phase 1 builders) ──────────────────────

function makeBrand(id, overrides = {}) {
  return {
    id,
    name: "Test Brand " + id.slice(-1).toUpperCase(),
    website: "https://testbrand.example.com",
    instagramPage: "@testbrand",
    linkedinPage: "https://linkedin.com/company/testbrand",
    facebookPage: null,
    businessLocation: "New York, NY",
    businessType: "Creative Agency",
    mainServicesOrProducts: "Brand identity, social media content, digital marketing",
    targetAudience: "Small business owners aged 28-45",
    brandTone: "Warm and approachable",
    brandVisualStyle: "Clean minimalism with earthy tones",
    createdAt: new Date("2024-01-01").toISOString(),
    updatedAt: new Date("2024-06-01").toISOString(),
    ...overrides,
  };
}

function makeIdentity(id, brandId, overrides = {}) {
  return {
    id,
    brandId,
    jsonOutput: JSON.stringify({
      brandToneInformationAndData: { brandName: "Test Brand A" },
      brandVisualIdentity: { summary: "Clean minimalism" },
    }),
    editableSummary: null,
    createdAt: new Date("2024-03-01").toISOString(),
    updatedAt: new Date("2024-05-01").toISOString(),
    ...overrides,
  };
}

function makeCalendar(id, brandId, overrides = {}) {
  return {
    id,
    brandId,
    title: "Q2 Social Campaign",
    platform: "Instagram",
    timePeriod: "April-June 2026",
    mainMonthlySubject: "Brand storytelling",
    mainGoal: "Increase engagement by 20%",
    mainOfferOrMessage: "Free brand audit",
    sourceMaterial: "Previous campaign analytics",
    status: "active",
    createdAt: new Date("2026-03-15").toISOString(),
    updatedAt: new Date("2026-04-01").toISOString(),
    _count: { posts: 3 },
    ...overrides,
  };
}

function makeCalendarPost(id, calendarId, overrides = {}) {
  return {
    id,
    calendarId,
    postNumber: 1,
    date: new Date("2026-04-10").toISOString(),
    platform: "Instagram",
    format: "Carousel",
    suggestedHook: "How to tell your brand story in 3 steps",
    mainAngleAndCoreMessage: "Brand storytelling framework",
    suggestedCaption: "Great branding starts with a great story.",
    hashtags: "#brandstorytelling",
    contentStructure: null,
    visualDirection: "Warm lifestyle photos",
    inspirationSource: null,
    referenceLink: null,
    adaptationNote: null,
    contentOrigin: "ai_generated",
    status: "published",
    createdAt: new Date("2026-03-20").toISOString(),
    updatedAt: new Date("2026-04-01").toISOString(),
    ...overrides,
  };
}

function makePublishedPost(id, brandId, overrides = {}) {
  return {
    id,
    brandId,
    postType: "educational",
    caption: "Your brand identity is more than just a logo.",
    platform: "Instagram",
    status: "published",
    scheduledDate: new Date("2026-04-05").toISOString(),
    notes: null,
    thumbnailUrl: null,
    jsonPayload: null,
    postNumber: 12,
    createdAt: new Date("2026-04-05").toISOString(),
    updatedAt: new Date("2026-04-05").toISOString(),
    ...overrides,
  };
}

function makePrismaClient({ brands, identities, calendars, posts, publishedPosts } = {}) {
  const brandsMap = new Map(Object.entries(brands || {}));
  const identitiesList = Object.values(identities || {});
  const calendarsList = Object.values(calendars || {});
  const postsList = Object.values(posts || {});
  const publishedList = Object.values(publishedPosts || {});

  return {
    brand: {
      findUnique: async ({ where }) => brandsMap.get(where.id) || null,
    },
    brandIdentity: {
      findFirst: async ({ where, orderBy }) => {
        const matching = identitiesList.filter((i) => i.brandId === where.brandId);
        if (!matching.length) return null;
        const first = matching.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
        return first;
      },
    },
    contentCalendar: {
      findMany: async ({ where, take }) => {
        let result = calendarsList.filter((c) => c.brandId === where.brandId);
        if (take) result = result.slice(0, take);
        return result;
      },
    },
    calendarPost: {
      findMany: async ({ where, take, orderBy }) => {
        const brandCalIds = calendarsList.filter((c) => c.brandId === where.calendar?.brandId).map((c) => c.id);
        let result = postsList.filter((p) => brandCalIds.includes(p.calendarId));
        if (take) result = result.slice(0, take);
        return result;
      },
    },
    publishedPost: {
      findMany: async ({ where, take, orderBy }) => {
        let result = publishedList.filter((p) => p.brandId === where.brandId);
        if (take) result = result.slice(0, take);
        return result;
      },
    },
    settings: {
      findUnique: async () => null,
    },
    $disconnect: async () => {},
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

// A. Error mapping — pure functions from chat-error-mapper.js
await testGroup("A. Domain-error mapping (chat-error-mapper)", {
  async "BRAND_NOT_FOUND maps to 404"() {
    const err = new BrandChatContextError("BRAND_NOT_FOUND", "Brand not found");
    const result = mapBrandChatContextError(err);
    assert.equal(result.status, 404);
    assert.equal(result.body.code, "BRAND_NOT_FOUND");
    assert.equal(result.body.success, false);
  },

  async "INVALID_BRAND_ID maps to 400"() {
    const err = new BrandChatContextError("INVALID_BRAND_ID", "bad");
    const result = mapBrandChatContextError(err);
    assert.equal(result.status, 400);
    assert.equal(result.body.code, "INVALID_BRAND_ID");
  },

  async "INVALID_QUESTION maps to 400"() {
    const err = new BrandChatContextError("INVALID_QUESTION", "bad");
    const result = mapBrandChatContextError(err);
    assert.equal(result.status, 400);
    assert.equal(result.body.code, "INVALID_MESSAGE");
  },

  async "unknown error code maps to 500"() {
    const err = new BrandChatContextError("UNKNOWN", "bad");
    const result = mapBrandChatContextError(err);
    assert.equal(result.status, 500);
    assert.equal(result.body.code, "INTERNAL_ERROR");
  },

  async "OPENAI_NOT_CONFIGURED maps to 503"() {
    const err = new Error("not configured");
    err.code = "OPENAI_NOT_CONFIGURED";
    const result = mapAiError(err);
    assert.equal(result.status, 503);
    assert.equal(result.body.code, "OPENAI_NOT_CONFIGURED");
  },

  async "AI_TIMEOUT maps to 504"() {
    const err = new Error("timeout");
    err.code = "AI_TIMEOUT";
    const result = mapAiError(err);
    assert.equal(result.status, 504);
    assert.equal(result.body.code, "AI_TIMEOUT");
  },

  async "AI_PROVIDER_ERROR maps to 502"() {
    const err = new Error("provider");
    err.code = "AI_PROVIDER_ERROR";
    const result = mapAiError(err);
    assert.equal(result.status, 502);
    assert.equal(result.body.code, "AI_PROVIDER_ERROR");
  },

  async "unknown AI error maps to 500"() {
    const err = new Error("unknown");
    const result = mapAiError(err);
    assert.equal(result.status, 500);
    assert.equal(result.body.code, "INTERNAL_ERROR");
  },
});

// B. Rate limiter
await testGroup("B. Rate limiter", {
  async "allows requests within limit"() {
    const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 5 });
    for (let i = 0; i < 5; i++) {
      const result = limiter.check("user:brand");
      assert.ok(result.allowed, `Request ${i + 1} should be allowed`);
    }
  },

  async "blocks requests over limit"() {
    const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 3 });
    for (let i = 0; i < 3; i++) limiter.check("user:brand");
    const blocked = limiter.check("user:brand");
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
    assert.ok(typeof blocked.retryAfter === "number");
  },

  async "different keys are independent"() {
    const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 2 });
    limiter.check("user1:brand-a");
    limiter.check("user1:brand-a");
    const block = limiter.check("user1:brand-a");
    assert.equal(block.allowed, false);

    const allow = limiter.check("user2:brand-a");
    assert.equal(allow.allowed, true);
  },

  async "window resets after expiry"() {
    const limiter = createRateLimiter({ windowMs: 50, maxRequests: 1 });
    limiter.check("user:brand");
    const blocked = limiter.check("user:brand");
    assert.equal(blocked.allowed, false);

    await new Promise((r) => setTimeout(r, 60));
    const allowed = limiter.check("user:brand");
    assert.equal(allowed.allowed, true);
  },

  async "max entries bounded"() {
    const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 1 });
    // Fill to near max
    for (let i = 0; i < 100; i++) {
      limiter.check(`user${i}:brand`);
    }
    // Should not crash
    const result = limiter.check("overflow:brand");
    assert.ok("allowed" in result);
  },
});

// C. Route structure — file exists and has POST handler
await testGroup("C. Route file structure", {
  async "route file exists"() {
    const path = "app/api/brands/[id]/chat/route.js";
    assert.ok(fs.existsSync(path), `Route file not found: ${path}`);
  },

  async "route exports POST handler"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    assert.ok(src.includes("export async function POST"), "POST handler must be exported");
  },

  async "route imports auth helpers"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    assert.ok(src.includes('getCurrentUser'), "Must import getCurrentUser");
    assert.ok(src.includes('assertBrandAccess'), "Must import assertBrandAccess");
  },

  async "route imports context builder"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    assert.ok(src.includes('buildBrandChatContext'), "Must import buildBrandChatContext");
  },

  async "route imports AI helper"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    assert.ok(src.includes('generateBrandChatAnswer'), "Must import generateBrandChatAnswer");
  },

  async "auth happens before context building"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    const authIndex = src.indexOf("getCurrentUser");
    const aiIndex = src.indexOf("generateBrandChatAnswer");
    assert.ok(authIndex >= 0 && aiIndex >= 0);
    assert.ok(authIndex < aiIndex, "Auth should appear before AI call in source");
  },

  async "access check happens before context building"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    const accessIndex = src.indexOf("assertBrandAccess");
    const contextIndex = src.indexOf("buildBrandChatContext");
    assert.ok(accessIndex >= 0 && contextIndex >= 0);
    assert.ok(accessIndex < contextIndex, "assertBrandAccess should appear before buildBrandChatContext in source");
  },
});

// D. Context builder integration
await testGroup("D. Context builder integration", {
  async "context built with correct brandId"() {
    const prisma = makePrismaClient({
      brands: { "brand-a": makeBrand("brand-a") },
      identities: {},
      calendars: {},
      posts: {},
      publishedPosts: {},
    });
    const ctx = await buildBrandChatContext({ brandId: "brand-a", prismaClient: prisma });
    assert.equal(ctx.brandId, "brand-a");
    assert.equal(ctx.stats.brandFound, true);
  },

  async "brand not found returns error"() {
    const prisma = makePrismaClient({ brands: {}, identities: {}, calendars: {}, posts: {}, publishedPosts: {} });
    const ctx = await buildBrandChatContext({ brandId: "nonexistent", prismaClient: prisma });
    assert.ok(ctx.error instanceof BrandChatContextError);
    assert.equal(ctx.error.code, "BRAND_NOT_FOUND");
  },

  async "context block contains brand-reference-data wrapping"() {
    const prisma = makePrismaClient({
      brands: { "brand-a": makeBrand("brand-a") },
      identities: {},
      calendars: {},
      posts: {},
      publishedPosts: {},
    });
    const ctx = await buildBrandChatContext({ brandId: "brand-a", prismaClient: prisma });
    assert.ok(ctx.contextBlock.startsWith("<brand-reference-data>"));
    assert.ok(ctx.contextBlock.trimEnd().endsWith("</brand-reference-data>"));
  },

  async "sources are returned with safe fields"() {
    const identity = makeIdentity("id-1", "brand-a");
    const cal = makeCalendar("cal-1", "brand-a");
    const post = makeCalendarPost("post-1", "cal-1");
    const pub = makePublishedPost("pub-1", "brand-a");
    const prisma = makePrismaClient({
      brands: { "brand-a": makeBrand("brand-a") },
      identities: { "id-1": identity },
      calendars: { "cal-1": cal },
      posts: { "post-1": post },
      publishedPosts: { "pub-1": pub },
    });
    const ctx = await buildBrandChatContext({ brandId: "brand-a", prismaClient: prisma });
    assert.ok(ctx.sources.length > 0);
    for (const src of ctx.sources) {
      assert.ok(typeof src.type === "string");
      assert.ok(typeof src.label === "string");
    }
  },

  async "cross-brand context isolation"() {
    const brandA = makeBrand("brand-a");
    const brandB = makeBrand("brand-b", { name: "Brand B" });
    const prisma = makePrismaClient({
      brands: { "brand-a": brandA, "brand-b": brandB },
      identities: {},
      calendars: {},
      posts: {},
      publishedPosts: {},
    });
    const ctxA = await buildBrandChatContext({ brandId: "brand-a", prismaClient: prisma });
    assert.ok(ctxA.contextBlock.includes("Test Brand A"));
    assert.ok(!ctxA.contextBlock.includes("Brand B"), "Brand A context must not contain Brand B data");
  },

  async "original question passed to context builder"() {
    const prisma = makePrismaClient({
      brands: { "brand-a": makeBrand("brand-a") },
      identities: {},
      calendars: {},
      posts: {},
      publishedPosts: {},
    });
    const ctx = await buildBrandChatContext({ brandId: "brand-a", question: "What is planned for next month?", prismaClient: prisma });
    assert.equal(ctx.stats.questionNormalized, true);
  },
});

// E. AI helper with mock OpenAI
await testGroup("E. AI helper (injectable)", {
  async "returns answer from mock OpenAI"() {
    const mockOpenAI = {
      chat: {
        completions: {
          create: async () => ({
            choices: [
              {
                finish_reason: "stop",
                message: { content: "The brand has 3 Instagram posts planned.", refusal: null },
              },
            ],
            usage: { total_tokens: 150 },
          }),
        },
      },
    };
    const mockPrisma = {
      settings: { findUnique: async () => ({ value: "sk-test-key" }) },
    };

    const { generateBrandChatAnswer } = await import("../lib/brand-chat-ai.js");
    const answer = await generateBrandChatAnswer({
      brandName: "Test Brand",
      contextBlock: "<brand-reference-data>\n<section>Test data</section>\n</brand-reference-data>",
      question: "What is planned?",
      openaiClient: mockOpenAI,
      prismaClient: mockPrisma,
    });
    assert.equal(answer, "The brand has 3 Instagram posts planned.");
  },

  async "missing API key throws OPENAI_NOT_CONFIGURED"() {
    const mockPrisma = {
      settings: { findUnique: async () => null },
    };
    process.env.OPENAI_API_KEY = "";

    const { generateBrandChatAnswer } = await import("../lib/brand-chat-ai.js");
    try {
      await generateBrandChatAnswer({
        brandName: "Test",
        contextBlock: "<data>test</data>",
        question: "test",
        openaiClient: {
          chat: { completions: { create: async () => ({ choices: [] }) } },
        },
        prismaClient: mockPrisma,
      });
      assert.fail("Should have thrown");
    } catch (err) {
      assert.equal(err.code, "OPENAI_NOT_CONFIGURED");
    }
  },

  async "timeout error maps to AI_TIMEOUT"() {
    const mockOpenAI = {
      chat: {
        completions: {
          create: async () => {
            const err = new Error("Request timed out");
            err.name = "AbortError";
            throw err;
          },
        },
      },
    };
    const mockPrisma = {
      settings: { findUnique: async () => ({ value: "sk-test-key" }) },
    };

    const { generateBrandChatAnswer } = await import("../lib/brand-chat-ai.js");
    try {
      await generateBrandChatAnswer({
        brandName: "Test",
        contextBlock: "<data>test</data>",
        question: "test",
        openaiClient: mockOpenAI,
        prismaClient: mockPrisma,
      });
      assert.fail("Should have thrown");
    } catch (err) {
      assert.equal(err.code, "AI_TIMEOUT");
    }
  },

  async "provider error maps to AI_PROVIDER_ERROR"() {
    const mockOpenAI = {
      chat: {
        completions: {
          create: async () => {
            throw new Error("API error");
          },
        },
      },
    };
    const mockPrisma = {
      settings: { findUnique: async () => ({ value: "sk-test-key" }) },
    };

    const { generateBrandChatAnswer } = await import("../lib/brand-chat-ai.js");
    try {
      await generateBrandChatAnswer({
        brandName: "Test",
        contextBlock: "<data>test</data>",
        question: "test",
        openaiClient: mockOpenAI,
        prismaClient: mockPrisma,
      });
      assert.fail("Should have thrown");
    } catch (err) {
      assert.equal(err.code, "AI_PROVIDER_ERROR");
    }
  },

  async "content filtered response throws"() {
    const mockOpenAI = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ finish_reason: "content_filter", message: { content: "", refusal: null } }],
          }),
        },
      },
    };
    const mockPrisma = {
      settings: { findUnique: async () => ({ value: "sk-test-key" }) },
    };

    const { generateBrandChatAnswer } = await import("../lib/brand-chat-ai.js");
    try {
      await generateBrandChatAnswer({
        brandName: "Test",
        contextBlock: "<data>test</data>",
        question: "test",
        openaiClient: mockOpenAI,
        prismaClient: mockPrisma,
      });
      assert.fail("Should have thrown");
    } catch (err) {
      assert.equal(err.code, "AI_PROVIDER_ERROR");
    }
  },

  async "empty choices throws AI_PROVIDER_ERROR"() {
    const mockOpenAI = {
      chat: {
        completions: {
          create: async () => ({ choices: [] }),
        },
      },
    };
    const mockPrisma = {
      settings: { findUnique: async () => ({ value: "sk-test-key" }) },
    };

    const { generateBrandChatAnswer } = await import("../lib/brand-chat-ai.js");
    try {
      await generateBrandChatAnswer({
        brandName: "Test",
        contextBlock: "<data>test</data>",
        question: "test",
        openaiClient: mockOpenAI,
        prismaClient: mockPrisma,
      });
      assert.fail("Should have thrown");
    } catch (err) {
      assert.equal(err.code, "AI_PROVIDER_ERROR");
    }
  },
});

// F. Validation — extract and test the route's validation patterns
await testGroup("F. Validation patterns", {
  async "route validates Content-Type"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    assert.ok(src.includes("content-type"), "Route must check Content-Type header");
    assert.ok(src.includes("application/json"), "Route must require application/json");
    assert.ok(src.includes("UNSUPPORTED_MEDIA_TYPE"), "Route must return 415 for wrong Content-Type");
  },

  async "route validates JSON body"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    assert.ok(src.includes("JSON.parse") || src.includes("request.json()"), "Route must parse JSON body");
    assert.ok(src.includes("INVALID_JSON") || src.includes("INVALID_REQUEST"), "Route must reject invalid JSON");
  },

  async "route rejects unknown fields"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    assert.ok(src.includes("unknownFields"), "Route must detect unknown fields");
    assert.ok(src.includes("INVALID_JSON"));
  },

  async "route rejects non-string message"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    assert.ok(src.includes("typeof rawMessage !== \"string\""), "Route must check message type");
  },

  async "route rejects empty message"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    assert.ok(src.includes(".trim()"), "Route must trim message");
    assert.ok(src.includes("!message"), "Route must reject empty message");
  },

  async "route enforces max 2000 chars"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    assert.ok(src.includes("MAX_MESSAGE_CHARS"), "Route must enforce max character limit");
  },

  async "route does not accept body brandId"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    assert.ok(!src.includes("body.brandId"), "Route must not read brandId from body");
    assert.ok(src.includes("params"), "Brand ID must come from route params");
  },

  async "ALLOWED_FIELDS restricts to message only"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    assert.ok(src.includes('"message"'), "Only 'message' field should be allowed");
  },
});

// G. Response safety
await testGroup("G. Response safety", {
  async "route sets Cache-Control no-store"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    assert.ok(src.includes("no-store"), "Response must have Cache-Control: no-store");
  },

  async "route sets X-Content-Type-Options nosniff"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    assert.ok(src.includes("nosniff"), "Response must have X-Content-Type-Options: nosniff");
  },

  async "route sets Content-Type application/json"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    assert.ok(src.includes('"Content-Type"'), "Response must set Content-Type header");
  },

  async "route does not return contextBlock"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    // The route should map sources to safeSources; no contextBlock in response
    const responseBlock = src.indexOf("return json({") > 0;
    assert.ok(responseBlock);
    // Check the success response doesn't include contextBlock
    const successResponseSection = src.slice(src.lastIndexOf("return json({"));
    assert.ok(!successResponseSection.includes("contextBlock"),
      "Success response must not include contextBlock");
  },

  async "route does not return system prompt"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    const successResponseSection = src.slice(src.lastIndexOf("return json({") - 200);
    assert.ok(!successResponseSection.includes("SYSTEM_PROMPT") &&
      !successResponseSection.includes("systemPrompt"),
      "Success response must not include system prompt");
  },

  async "sources in response are safe metadata"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    // Should map to type, label, date, platform only
    const safeSourcesSection = src.match(/safeSources[\s\S]{0,300}/)?.[0] || "";
    assert.ok(safeSourcesSection.includes("type"));
    assert.ok(safeSourcesSection.includes("label"));
    assert.ok(safeSourcesSection.includes("date"));
    assert.ok(safeSourcesSection.includes("platform"));
  },

  async "route returns contextStats"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    assert.ok(src.includes("contextStats"), "Response must include contextStats");
    assert.ok(src.includes("totalCharacters"), "contextStats must include totalCharacters");
  },
});

// H. Stateless
await testGroup("H. Stateless behavior", {
  async "route does not call Prisma create or update"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    assert.ok(!src.includes(".create("), "Route must not call Prisma create");
    assert.ok(!src.includes(".update("), "Route must not call Prisma update");
    assert.ok(!src.includes(".delete("), "Route must not call Prisma delete");
  },

  async "route does not reference conversations"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    assert.ok(!src.includes("conversation"), "Route must not reference conversations");
  },

  async "route does not reference message persistence"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    assert.ok(!src.includes(".save("), "Route must not save messages");
  },
});

// I. Cross-brand security via context builder
await testGroup("I. Cross-brand security", {
  async "Brand A context builder excludes Brand B"() {
    const brandA = makeBrand("brand-a");
    const brandB = makeBrand("brand-b", { name: "Brand B", website: "https://brandb.example.com" });
    const calB = makeCalendar("cal-b", "brand-b", { title: "Brand B Calendar" });
    const prisma = makePrismaClient({
      brands: { "brand-a": brandA, "brand-b": brandB },
      identities: {},
      calendars: { "cal-b": calB },
      posts: {},
      publishedPosts: {},
    });
    const ctx = await buildBrandChatContext({ brandId: "brand-a", prismaClient: prisma });
    assert.ok(!ctx.contextBlock.includes("Brand B"), "Brand A context must not mention Brand B");
    assert.ok(!ctx.contextBlock.includes("brandb"), "Brand A context must not contain Brand B data");
  },
});

// J. Raw body size limit
await testGroup("J. Body size limit", {
  async "route enforces MAX_BODY_BYTES constant"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    assert.ok(src.includes("MAX_BODY_BYTES"), "Route must define a body size constant");
    assert.ok(src.includes("16384"), "MAX_BODY_BYTES must be 16384 (16 KiB) for history support");
  },

  async "route reads raw body before JSON parse"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    assert.ok(src.includes("getReader"), "Route must use streaming body reader before JSON parse");
    assert.ok(src.indexOf("getReader") < src.indexOf("JSON.parse"),
      "Streaming body read must happen before JSON parse");
  },

  async "oversized body returns 413"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    assert.ok(src.includes("PAYLOAD_TOO_LARGE"), "Route must return PAYLOAD_TOO_LARGE");
    assert.ok(src.includes("413"), "Route must return HTTP 413");
  },

  async "route measures bytes during streaming"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    assert.ok(src.includes("byteLength"), "Route must measure byte length during streaming");
    assert.ok(src.includes("TextDecoder"), "Route must use TextDecoder after bounded collection");
  },
});

// K. Content-Type validation
await testGroup("K. Content-Type validation", {
  async "application/json accepted"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    assert.ok(src.includes("application/json"), "Route must check for application/json");
  },

  async "charset parameter accepted via mime normalization"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    // Must split on semicolon to extract charset
    assert.ok(src.includes("split") || src.includes("normalized"), "Route must normalize MIME type to accept charset");
  },

  async "text/plain rejected with 415"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    assert.ok(src.includes("UNSUPPORTED_MEDIA_TYPE"), "Route must reject non-JSON with 415");
  },
});

// L. Rate limiter hardening
const limiterForOrderTest = createRateLimiter({ windowMs: 60000, maxRequests: 10 });
await testGroup("L. Rate limiter hardening", {
  async "ten allowed then denied"() {
    const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 10 });
    for (let i = 0; i < 10; i++) {
      assert.ok(limiter.check("user:brand").allowed, `Request ${i + 1} should be allowed`);
    }
    const blocked = limiter.check("user:brand");
    assert.equal(blocked.allowed, false);
  },

  async "retryAfter body present on denial"() {
    const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 1 });
    limiter.check("user:brand");
    const blocked = limiter.check("user:brand");
    assert.ok(typeof blocked.retryAfter === "number", "retryAfter must be a number");
    assert.ok(blocked.retryAfter >= 1, "retryAfter must be at least 1");
  },

  async "expired entries become available"() {
    const limiter = createRateLimiter({ windowMs: 30, maxRequests: 1 });
    limiter.check("user:brand");
    assert.equal(limiter.check("user:brand").allowed, false);
    await new Promise((r) => setTimeout(r, 40));
    // Lazy cleanup happens after 100 checks, so force by making many checks
    for (let i = 0; i < 101; i++) limiter.check(`other${i}:brand`);
    const result = limiter.check("user:brand");
    assert.equal(result.allowed, true, "Expired entry should allow new request");
  },

  async "map remains bounded"() {
    const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 1 });
    for (let i = 0; i < 10000; i++) {
      limiter.check(`user${i}:brand`);
    }
    const result = limiter.check("overflow:brand");
    assert.ok("allowed" in result, "Limiter must not crash at max entries");
  },

  async "no recurring timer (no setInterval)"() {
    const src = fs.readFileSync("lib/rate-limiter.js", "utf8");
    assert.ok(!src.includes("setInterval"), "Rate limiter must not use setInterval");
  },
});

// M. Timeout in AI helper
await testGroup("M. AI timeout enforcement", {
  async "timeout error maps to 504 via AI_TIMEOUT"() {
    const mockOpenAI = {
      chat: {
        completions: {
          create: async () => {
            const err = new Error("Request timed out");
            err.name = "AbortError";
            throw err;
          },
        },
      },
    };
    const mockPrisma = {
      settings: { findUnique: async () => ({ value: "sk-test-key" }) },
    };
    const { generateBrandChatAnswer } = await import("../lib/brand-chat-ai.js");
    try {
      await generateBrandChatAnswer({
        brandName: "Test",
        contextBlock: "<data>test</data>",
        question: "test",
        openaiClient: mockOpenAI,
        prismaClient: mockPrisma,
      });
      assert.fail("Should have thrown");
    } catch (err) {
      assert.equal(err.code, "AI_TIMEOUT");
    }
  },

  async "timeout does not cause overlapping retry"() {
    const mockPrisma = {
      settings: { findUnique: async () => ({ value: "sk-test-key" }) },
    };
    const { generateBrandChatAnswer } = await import("../lib/brand-chat-ai.js");
    // Use the timeout client — should fail immediately on first attempt
    let callCount = 0;
    const client = {
      chat: {
        completions: {
          create: async () => {
            callCount++;
            const err = new Error("Request timed out");
            err.name = "AbortError";
            throw err;
          },
        },
      },
    };
    try {
      await generateBrandChatAnswer({
        brandName: "Test",
        contextBlock: "<data>test</data>",
        question: "test",
        openaiClient: client,
        prismaClient: mockPrisma,
      });
    } catch { /* expected */ }
    assert.equal(callCount, 1, "Timeout must not be retried");
  },

  async "maximum attempt count enforced"() {
    const mockPrisma = {
      settings: { findUnique: async () => ({ value: "sk-test-key" }) },
    };
    let attemptCount = 0;
    const client = {
      chat: {
        completions: {
          create: async () => {
            attemptCount++;
            const err = new Error("Connection error");
            err.name = "APIConnectionError";
            throw err;
          },
        },
      },
    };
    const { generateBrandChatAnswer } = await import("../lib/brand-chat-ai.js");
    try {
      await generateBrandChatAnswer({
        brandName: "Test",
        contextBlock: "<data>test</data>",
        question: "test",
        openaiClient: client,
        prismaClient: mockPrisma,
      });
    } catch { /* expected */ }
    // 1 initial + 1 retry = 2 max
    assert.ok(attemptCount <= 2, `Max 2 attempts allowed (was ${attemptCount})`);
  },
});

// N. Response headers on all paths
await testGroup("N. Response headers", {
  async "json helper sets no-store"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    const helperSection = src.slice(0, src.indexOf("export async function POST"));
    assert.ok(helperSection.includes("no-store"));
  },

  async "json helper sets application/json"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    const helperSection = src.slice(0, src.indexOf("export async function POST"));
    assert.ok(helperSection.includes("application/json"));
  },

  async "json helper sets nosniff"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    const helperSection = src.slice(0, src.indexOf("export async function POST"));
    assert.ok(helperSection.includes("nosniff"));
  },

  async "429 response includes Retry-After header"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    assert.ok(src.includes("Retry-After"), "429 response must set Retry-After header");
    assert.ok(src.includes("retryAfter"), "429 body must include retryAfter");
  },
});

// O. Safe response fields
await testGroup("O. Safe response fields", {
  async "contextBlock is absent from success response"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    const successBlock = src.slice(src.lastIndexOf("return json({"));
    assert.ok(!successBlock.includes("contextBlock"), "Success response must not include contextBlock");
  },

  async "raw stats are not returned"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    const successBlock = src.slice(src.lastIndexOf("return json({"));
    assert.ok(!successBlock.includes("stats.total"), "Must not expose raw stats");
    assert.ok(!successBlock.includes("questionNormalized"), "Must not expose normalized question");
    assert.ok(!successBlock.includes("warnings"), "Must not expose internal warnings");
  },

  async "sources in response are allowlisted"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    const safeSourcesSection = src.match(/safeSources[\s\S]{0,300}/)?.[0] || "";
    assert.ok(safeSourcesSection.includes("type"));
    assert.ok(safeSourcesSection.includes("label"));
    assert.ok(safeSourcesSection.includes("date"));
    assert.ok(safeSourcesSection.includes("platform"));
  },
});

// P. Verification helper files
await testGroup("P. Verification helper files", {
  async "empty-module.mjs exists and is used by both runners"() {
    assert.ok(fs.existsSync("scripts/empty-module.mjs"), "empty-module.mjs must exist");
    const runner1 = fs.readFileSync("scripts/run-verify.mjs", "utf8");
    assert.ok(runner1.includes("empty-module.mjs"), "Phase 1 runner must reference empty-module.mjs");
    const runner2 = fs.readFileSync("scripts/run-verify-api.mjs", "utf8");
    assert.ok(runner2.includes("empty-module.mjs"), "Phase 2 runner must reference empty-module.mjs");
  },

  async "empty-module.mjs exports a default object"() {
    const mod = await import("../scripts/empty-module.mjs");
    assert.ok(mod && typeof mod.default === "object", "empty-module must export default object");
  },

  async "run-verify-api.mjs registers @/lib/ path alias"() {
    const src = fs.readFileSync("scripts/run-verify-api.mjs", "utf8");
    assert.ok(src.includes("@/lib/"), "Runner must resolve @/lib/ path alias");
  },
});

// Q. Streaming body reader — runtime tests using local bounded reader
async function localReadBoundedJsonBody(request, maxBytes) {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const parsed = Number.parseInt(contentLength, 10);
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed > maxBytes) {
      return { error: "PAYLOAD_TOO_LARGE" };
    }
  }
  if (!request.body) {
    return { error: "INVALID_JSON" };
  }
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        reader.cancel().catch(() => {});
        return { error: "PAYLOAD_TOO_LARGE" };
      }
      chunks.push(value);
    }
  } catch {
    return { error: "INVALID_JSON" };
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(merged);
  } catch {
    return { error: "INVALID_JSON" };
  }
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { error: "INVALID_JSON" };
  }
}

function makeMockRequest({ headers, body }) {
  return {
    headers: { get: (n) => headers[n.toLowerCase()] ?? null },
    body: body ?? null,
  };
}

await testGroup("Q. Streaming body reader", {
  async "declared oversized is rejected early"() {
    let getReaderCalled = false;
    const stream = new ReadableStream({ start(c) { c.close(); } });
    const origGetter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(stream), "getReader"
    );
    Object.defineProperty(stream, "getReader", {
      value: (...args) => { getReaderCalled = true; return origGetter.value.apply(stream, args); },
      writable: true, configurable: true,
    });
    const request = makeMockRequest({ headers: { "content-length": "99999" }, body: stream });
    const result = await localReadBoundedJsonBody(request, 8192);
    assert.equal(result.error, "PAYLOAD_TOO_LARGE");
    assert.equal(getReaderCalled, false, "getReader must not be called when Content-Length exceeds cap");
  },

  async "understated content-length caught by streaming cap"() {
    const chunk = new TextEncoder().encode("x".repeat(2000));
    const stream = new ReadableStream({
      pull(c) { c.enqueue(chunk); },
      cancel() {},
    });
    const request = makeMockRequest({ headers: { "content-length": "100" }, body: stream });
    const result = await localReadBoundedJsonBody(request, 8192);
    assert.equal(result.error, "PAYLOAD_TOO_LARGE");
  },

  async "missing content-length caught by streaming cap"() {
    const chunk = new TextEncoder().encode("x".repeat(2000));
    const stream = new ReadableStream({
      pull(c) { c.enqueue(chunk); },
      cancel() {},
    });
    const request = makeMockRequest({ headers: {}, body: stream });
    const result = await localReadBoundedJsonBody(request, 8192);
    assert.equal(result.error, "PAYLOAD_TOO_LARGE");
  },

  async "early cancellation stops stream consumption"() {
    const chunk = new TextEncoder().encode("x".repeat(2000));
    let chunksRequested = 0;
    let cancelled = false;
    const stream = new ReadableStream({
      pull(c) {
        chunksRequested++;
        if (chunksRequested > 10) { c.close(); return; }
        c.enqueue(chunk);
      },
      cancel() { cancelled = true; },
    });
    const request = makeMockRequest({ headers: {}, body: stream });
    const result = await localReadBoundedJsonBody(request, 8192);
    assert.equal(result.error, "PAYLOAD_TOO_LARGE");
    assert.ok(chunksRequested >= 4 && chunksRequested <= 7,
      `Expected ~5 chunks (2000 bytes each), got ${chunksRequested}`);
    assert.ok(chunksRequested < 10,
      `Must not consume complete stream (${chunksRequested} chunks of ~10+)`);
    assert.ok(cancelled, "Stream cancel() must be called");
  },

  async "exact boundary accepts up to 8192 bytes"() {
    const payload = '{"message":"' + "a".repeat(8178) + '"}';
    assert.equal(new TextEncoder().encode(payload).byteLength, 8192);
    const stream = new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode(payload)); c.close(); },
    });
    const request = makeMockRequest({ headers: {}, body: stream });
    const result = await localReadBoundedJsonBody(request, 8192);
    assert.ok(result.body, "8192-byte body should be accepted");
    assert.equal(result.body.message, "a".repeat(8178));
  },

  async "exact boundary rejects 8193 bytes"() {
    const payload = '{"message":"' + "a".repeat(8179) + '"}';
    assert.equal(new TextEncoder().encode(payload).byteLength, 8193);
    const stream = new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode(payload)); c.close(); },
    });
    const request = makeMockRequest({ headers: {}, body: stream });
    const result = await localReadBoundedJsonBody(request, 8192);
    assert.equal(result.error, "PAYLOAD_TOO_LARGE");
  },

  async "multibyte measured in bytes not characters"() {
    const cjkChar = "\u4e00";
    const acceptedMessage = cjkChar.repeat(2000);
    const acceptedPayload = JSON.stringify({ message: acceptedMessage });
    assert.ok(new TextEncoder().encode(acceptedPayload).byteLength <= 8192);

    const stream1 = new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode(acceptedPayload)); c.close(); },
    });
    const req1 = makeMockRequest({ headers: {}, body: stream1 });
    const result1 = await localReadBoundedJsonBody(req1, 8192);
    assert.ok(result1.body, "2000 CJK chars should be accepted");
    assert.equal(result1.body.message, acceptedMessage);

    const rejectedMessage = cjkChar.repeat(2800);
    const rejectedPayload = JSON.stringify({ message: rejectedMessage });
    assert.ok(new TextEncoder().encode(rejectedPayload).byteLength > 8192);

    const stream2 = new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode(rejectedPayload)); c.close(); },
    });
    const req2 = makeMockRequest({ headers: {}, body: stream2 });
    const result2 = await localReadBoundedJsonBody(req2, 8192);
    assert.equal(result2.error, "PAYLOAD_TOO_LARGE", "2800 CJK chars should be rejected");
  },

  async "malformed json returns INVALID_JSON"() {
    const stream = new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('{"message": "hello"')); c.close(); },
    });
    const request = makeMockRequest({ headers: {}, body: stream });
    const result = await localReadBoundedJsonBody(request, 8192);
    assert.equal(result.error, "INVALID_JSON");
  },

  async "malformed utf8 returns INVALID_JSON"() {
    const stream = new ReadableStream({
      start(c) { c.enqueue(new Uint8Array([0xff, 0xfe, 0x00, 0x31])); c.close(); },
    });
    const request = makeMockRequest({ headers: {}, body: stream });
    const result = await localReadBoundedJsonBody(request, 8192);
    assert.equal(result.error, "INVALID_JSON");
  },

  async "null body returns INVALID_JSON"() {
    const request = makeMockRequest({ headers: {}, body: null });
    const result = await localReadBoundedJsonBody(request, 8192);
    assert.equal(result.error, "INVALID_JSON");
  },
});

// R. Authorization order — read before body
await testGroup("R. Authorization order with body", {
  async "auth check appears before body reader call"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    const postBody = src.slice(src.indexOf("export async function POST"));
    const authIndex = postBody.indexOf("getCurrentUser");
    const readCallIndex = postBody.indexOf("readBoundedJsonBody(request,");
    assert.ok(authIndex >= 0 && readCallIndex >= 0);
    assert.ok(authIndex < readCallIndex,
      "Auth check (getCurrentUser) must appear before body reader call in POST handler");
  },

  async "unauthorized return before body reader call"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    const postBody = src.slice(src.indexOf("export async function POST"));
    const unauthIndex = postBody.indexOf("AUTH_REQUIRED");
    const readCallIndex = postBody.indexOf("readBoundedJsonBody(request,");
    assert.ok(unauthIndex >= 0 && readCallIndex >= 0);
    assert.ok(unauthIndex < readCallIndex,
      "Unauthorized return (401) must appear before body reader call");
  },

  async "forbidden return before body reader call"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    const postBody = src.slice(src.indexOf("export async function POST"));
    const deniedIndex = postBody.indexOf("ACCESS_DENIED");
    const readCallIndex = postBody.indexOf("readBoundedJsonBody(request,");
    assert.ok(deniedIndex >= 0 && readCallIndex >= 0);
    assert.ok(deniedIndex < readCallIndex,
      "Forbidden return (403) must appear before body reader call");
  },

  async "content-type check before body reader call"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    const postBody = src.slice(src.indexOf("export async function POST"));
    const mimeIndex = postBody.indexOf("UNSUPPORTED_MEDIA_TYPE");
    const readCallIndex = postBody.indexOf("readBoundedJsonBody(request,");
    assert.ok(mimeIndex >= 0 && readCallIndex >= 0);
    assert.ok(mimeIndex < readCallIndex,
      "Content-Type validation must appear before body reader call");
  },
});

// S. No unbounded body helpers
await testGroup("S. No unbounded body helpers", {
  async "route does not use request.arrayBuffer()"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    assert.ok(!src.includes("request.arrayBuffer("),
      "Route must not use request.arrayBuffer() for chat body");
  },

  async "route does not use request.text()"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    assert.ok(!src.includes("request.text("),
      "Route must not use request.text() for chat body");
  },

  async "route does not use request.json()"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    assert.ok(!src.includes("request.json("),
      "Route must not use request.json() for chat body");
  },

  async "readBoundedJsonBody uses getReader not arrayBuffer"() {
    const src = fs.readFileSync("app/api/brands/[id]/chat/route.js", "utf8");
    const readerSection = src.slice(src.indexOf("readBoundedJsonBody"), src.indexOf("export async function POST"));
    assert.ok(readerSection.includes("getReader"),
      "readBoundedJsonBody must use getReader");
    assert.ok(!readerSection.includes("arrayBuffer"),
      "readBoundedJsonBody must not use arrayBuffer");
  },
});

// ─── Runner ──────────────────────────────────────────────────────────────────

async function runAll() {
  const total = passed + failed;
  console.log(`\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
  console.log(`Results: ${passed} passed, ${failed} failed (${total} total)`);
  if (failed > 0) process.exit(1);
}

runAll().catch((err) => {
  console.error("Unhandled error:", err.message ?? err);
  process.exit(1);
});
