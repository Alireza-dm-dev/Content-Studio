// Integration tests for the enrich_post scope on the SAVED-post regeneration
// route (POST /api/calendar-posts/[id]/regenerate).
//
// Prompt wording is covered by tests/enrich-post.test.mjs; this file proves the
// request path: the scope is accepted, the enrichment prompt is the one that
// actually reaches the provider, the DB write touches only enriched fields, and
// a failure writes nothing at all.

import { test, mock } from "node:test";
import assert from "node:assert/strict";

const ORIGINAL_META = {
  hookTitle: "Is your CCTV actually recording?",
  mainAngle: "education",
  coreMessage: "A camera that looks fine can still be failing silently.",
  caption: "Regular CCTV maintenance helps keep your security system working properly.\nContact us to arrange a check.",
  hashtags: ["#cctv", "#security", "#maintenance", "#london", "#cucctv"],
  hashtagsMergedIntoCaption: true,
  imageText: "main_headline: Is your CCTV actually recording?",
  outputImageTextRequirements: "main_headline: Is your CCTV actually recording?",
  outputImageTextRequirementsStructured: {
    type: "static",
    items: [{ main_headline: "Is your CCTV actually recording?", call_to_action: "Book a check" }],
  },
  structure: "static layout",
  narrationOrDialogueOfCharacterOrCharacters: "Speaker 1: Most failures are silent.",
  mainIntegratedScenario: "Engineer walks the site and checks the recorder.",
  cameraMovement: "slow push in",
  visualMood: "calm, technical",
  textOnVideo: "Silent failures",
};

const POST_ROW = {
  id: "post-1",
  calendarId: "cal-1",
  postNumber: 4,
  date: new Date("2026-04-18"),
  platform: "Instagram",
  format: "Static",
  status: "draft",
  visualDirection: "Single frame, engineer checking a camera on a wall mount, cool blue grade.",
  contentStructure: "Single image with headline and CTA badge.",
  outputImageTextRequirements: ORIGINAL_META.outputImageTextRequirements,
  postData: JSON.stringify(ORIGINAL_META),
  calendar: {
    brandId: "brand-1",
    status: "draft",
    mainMonthlySubject: "Spring maintenance campaign",
    mainGoal: "Book more maintenance visits",
    mainOfferOrMessage: "Free first system health report",
  },
};

const state = {
  capturedUserInput: null,
  aiImpl: null,
  updates: [],
};

mock.module("@/lib/auth", {
  exports: {
    getCurrentUser: async () => ({ id: "u1", role: "admin" }),
    getBrandCalendarAccess: async () => ({ allowed: true, isAdmin: true, membership: null, user: { id: "u1", role: "admin" } }),
  },
});

mock.module("@/lib/prisma", {
  exports: {
    prisma: {
      calendarPost: {
        findUnique: async ({ where }) => (where.id === POST_ROW.id ? { ...POST_ROW } : null),
        update: async ({ where, data }) => {
          state.updates.push({ where, data });
          return { ...POST_ROW, ...data };
        },
      },
      uploadedFile: { findMany: async () => [] },
      brand: {
        findUnique: async () => ({
          id: "brand-1",
          name: "CUCCTV",
          businessType: "Security installer",
          brandTone: "Practical and technical",
          targetAudience: "London property managers",
          mainServicesOrProducts: "CCTV installation and maintenance",
          contentLanguage: "en",
        }),
      },
      brandIdentity: { findFirst: async () => null },
    },
  },
});

mock.module("@/lib/calendar-attachment-context", {
  exports: {
    resolveCalendarAttachmentContext: async () => ({ ok: true, block: "ATTACHMENT_MARKER_5150: maintenance covers recorder health and storage retention." }),
  },
});

mock.module("@/lib/ai", {
  exports: {
    generateWithPromptTemplate: async (opts) => {
      state.capturedUserInput = opts.userInput ?? null;
      return state.aiImpl();
    },
  },
});

const route = await import("../app/api/calendar-posts/[id]/regenerate/route.js");

function call(body) {
  state.capturedUserInput = null;
  state.updates = [];
  return route.POST(
    new Request("https://app.test/api/calendar-posts/post-1/regenerate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "post-1" }) }
  );
}

const ENRICHED = {
  postNumber: 4,
  hookTitle: "Is your CCTV recording — or just switched on?",
  coreMessage: "A camera can show a live image while the recorder has stopped writing usable footage.",
  caption: [
    "A camera that powers on is not the same as a camera that is recording.",
    "",
    "Most systems fail quietly: a full drive stops overwriting, a lens fogs after a cold night, a channel drops off the recorder. Nothing alerts you, and the gap only shows up when you need the footage.",
    "",
    "A maintenance visit checks recorder health, storage retention, camera angles, and image quality in the conditions you actually need them.",
    "",
    "Contact us to arrange a check.",
  ].join("\n"),
};

// ─── Scope acceptance and prompt routing ──────────────────────────────────────

test("enrich_post is accepted and routed to the enrichment prompt", async () => {
  state.aiImpl = async () => ({ raw: JSON.stringify(ENRICHED) });
  const res = await call({ scope: "enrich_post", brandId: "brand-1", calendarId: "cal-1" });
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.success, true);
  assert.equal(data.scope, "enrich_post");

  // The provider really received the enrichment contract, built from this post.
  assert.ok(state.capturedUserInput.includes("=== TASK: ENRICH THIS POST ==="));
  assert.ok(state.capturedUserInput.includes("STANDARD POST → SAME POST, PROFESSIONAL VERSION"));
  assert.ok(state.capturedUserInput.includes("Regular CCTV maintenance helps keep your security system working properly."));
  // …with brand, campaign and reference context attached through the shared mechanism.
  assert.ok(state.capturedUserInput.includes("CUCCTV"));
  assert.ok(state.capturedUserInput.includes("Spring maintenance campaign"));
  assert.ok(state.capturedUserInput.includes("ATTACHMENT_MARKER_5150"));
});

test("an unknown scope is still rejected", async () => {
  state.aiImpl = async () => ({ raw: "{}" });
  const res = await call({ scope: "enrich", brandId: "brand-1" });
  assert.equal(res.status, 400);
  assert.equal(state.updates.length, 0);
});

test("the optional enrichment instruction reaches the prompt", async () => {
  state.aiImpl = async () => ({ raw: JSON.stringify(ENRICHED) });
  await call({ scope: "enrich_post", enrichmentInstruction: "Add more technical detail about what is checked." });
  assert.ok(state.capturedUserInput.includes("=== WHAT THE USER ASKED TO ENRICH (guidance only) ==="));
  assert.ok(state.capturedUserInput.includes("Add more technical detail about what is checked."));
});

// ─── What is written back ─────────────────────────────────────────────────────

test("enrichment writes the enriched text and preserves everything else byte-for-byte", async () => {
  state.aiImpl = async () => ({ raw: JSON.stringify(ENRICHED) });
  const res = await call({ scope: "enrich_post" });
  const data = await res.json();

  const { data: written } = state.updates[0];
  const meta = JSON.parse(written.postData);

  // Enriched:
  assert.equal(written.suggestedHook, ENRICHED.hookTitle);
  assert.ok(written.suggestedCaption.startsWith("A camera that powers on is not the same"));
  assert.equal(meta.coreMessage, ENRICHED.coreMessage);

  // Preserved byte-for-byte:
  assert.equal(written.visualDirection, POST_ROW.visualDirection);
  assert.equal(written.contentStructure, POST_ROW.contentStructure);
  assert.equal(written.outputImageTextRequirements, ORIGINAL_META.outputImageTextRequirements);
  assert.equal(meta.imageText, ORIGINAL_META.imageText);
  assert.deepEqual(meta.outputImageTextRequirementsStructured, ORIGINAL_META.outputImageTextRequirementsStructured);
  assert.equal(meta.narrationOrDialogueOfCharacterOrCharacters, ORIGINAL_META.narrationOrDialogueOfCharacterOrCharacters);
  assert.equal(meta.mainIntegratedScenario, ORIGINAL_META.mainIntegratedScenario);
  assert.equal(meta.cameraMovement, ORIGINAL_META.cameraMovement);
  assert.equal(meta.visualMood, ORIGINAL_META.visualMood);
  assert.equal(meta.textOnVideo, ORIGINAL_META.textOnVideo);
  assert.equal(meta.mainAngle, ORIGINAL_META.mainAngle);

  // Schedule, platform, format and identity are never in the update payload.
  for (const key of ["date", "platform", "format", "status", "calendarId", "id", "postNumber"]) {
    assert.ok(!(key in written), `${key} must not be written by enrichment`);
  }

  // Hashtags survive unchanged and stay merged under the enriched caption,
  // exactly as the existing hashtag policy does for any caption-touching scope.
  assert.deepEqual(meta.hashtags, ORIGINAL_META.hashtags);
  assert.ok(written.suggestedCaption.trimEnd().endsWith("#cctv #security #maintenance #london #cucctv"));
  assert.equal(data.post.mainAngle, ORIGINAL_META.mainAngle);
});

test("an over-reaching model response cannot rewrite visuals through the route", async () => {
  state.aiImpl = async () => ({
    raw: JSON.stringify({
      ...ENRICHED,
      visualDirection: "Completely different neon visual.",
      outputImageTextRequirementsStructured: { type: "static", items: [{ main_headline: "different" }] },
      imageText: "different",
      format: "Carousel",
      hashtags: ["#different"],
    }),
  });
  await call({ scope: "enrich_post" });

  const { data: written } = state.updates[0];
  const meta = JSON.parse(written.postData);
  assert.equal(written.visualDirection, POST_ROW.visualDirection);
  assert.deepEqual(meta.outputImageTextRequirementsStructured, ORIGINAL_META.outputImageTextRequirementsStructured);
  assert.equal(meta.imageText, ORIGINAL_META.imageText);
  assert.deepEqual(meta.hashtags, ORIGINAL_META.hashtags);
  assert.ok(!("format" in written));
});

// ─── Failure behaviour ────────────────────────────────────────────────────────

test("a provider failure leaves the post untouched and reports an error", async () => {
  state.aiImpl = async () => { throw new Error("provider exploded"); };
  const res = await call({ scope: "enrich_post" });
  const data = await res.json();

  assert.equal(res.status, 500);
  assert.equal(data.success, false);
  assert.match(data.error, /AI generation failed/i);
  assert.equal(state.updates.length, 0, "nothing may be written when enrichment fails");
});

test("an unparsable response is not partially saved", async () => {
  state.aiImpl = async () => ({ raw: "Sure! Here is your enriched post:" });
  const res = await call({ scope: "enrich_post" });
  const data = await res.json();

  assert.equal(res.status, 500);
  assert.equal(data.success, false);
  assert.equal(state.updates.length, 0, "a partial/unparsable result must never reach the database");
});
