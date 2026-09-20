// Deterministic tests for the ENRICH POST regeneration mode.
//
// Same contract style as tests/regeneration-prompt.test.mjs: assertions run
// against the ACTUAL assembled provider input and the ACTUAL field-merge
// policy, so anything proven here is proven for the real request path.
//
// The mode's whole purpose is "same post, professional version", so most of
// these tests are preservation tests: what must survive enrichment, and what
// the prompt forbids the model from doing.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildEnrichPostUserInput,
  buildVisualOrEntirePostUserInput,
  buildCustomInstructionUserInput,
  buildImageTextOnlyUserInput,
  applyScopedPostRegeneration,
  SCOPE_FIELDS,
  ENRICHMENT_FIELDS,
  VISUAL_FIELDS,
} from "@/lib/calendar-regeneration-prompt";
import { resolveCalendarAttachmentContext } from "@/lib/calendar-attachment-context";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WEAK_CAPTION = [
  "Regular CCTV maintenance helps keep your security system working properly.",
  "Contact us to arrange a check.",
].join("\n");

const STATIC_POST = {
  postNumber: 4,
  date: "2026-04-18",
  platform: "Instagram",
  format: "Static",
  hookTitle: "Is your CCTV actually recording?",
  mainAngle: "education",
  coreMessage: "A camera that looks fine can still be failing silently.",
  caption: WEAK_CAPTION,
  hashtags: ["#cctv", "#security", "#maintenance", "#london", "#cucctv"],
  visualDirection: "Single frame, engineer checking a camera on a wall mount, cool blue grade, logo bottom right.",
  contentStructure: "Single image with headline and CTA badge.",
  outputImageTextRequirements: "main_headline: Is your CCTV actually recording?",
  outputImageTextRequirementsStructured: {
    type: "static",
    items: [{ main_headline: "Is your CCTV actually recording?", call_to_action: "Book a check" }],
  },
  imageText: "main_headline: Is your CCTV actually recording?",
  structure: "static layout",
  inspiration: "selected post idea",
};

const CAROUSEL_POST = {
  ...STATIC_POST,
  postNumber: 7,
  format: "Carousel",
  contentStructure: "Slide 1 hook, slide 2 what fails, slide 3 what we check, slide 4 CTA.",
  outputImageTextRequirementsStructured: {
    type: "carousel",
    slides: [
      { slideNumber: 1, slideRole: "Hook", fields: { main_headline: "Is your CCTV actually recording?" } },
      { slideNumber: 2, slideRole: "Problem", fields: { main_headline: "Silent failures" } },
      { slideNumber: 3, slideRole: "Solution", fields: { main_headline: "What we check" } },
      { slideNumber: 4, slideRole: "CTA", fields: { call_to_action: "Book a check" } },
    ],
  },
};

const VIDEO_POST = {
  ...STATIC_POST,
  postNumber: 9,
  format: "Reel",
  narrationOrDialogueOfCharacterOrCharacters: "Speaker 1: Most failures are silent.",
  mainIntegratedScenario: "Engineer walks the site, checks a recorder, shows footage.",
  cameraMovement: "slow push in",
  visualMood: "calm, technical",
  textOnVideo: "Silent failures",
};

function enrichContext(overrides = {}) {
  return {
    current: { ...STATIC_POST },
    currentOitrDisplay: "main_headline: Is your CCTV actually recording?",
    brandSummary: "Brand: CUCCTV. Type: Security installer. Tone: Practical and technical. Audience: London property managers. Services: CCTV installation and maintenance.",
    contentLanguage: "en",
    calendarContext: {
      mainMonthlySubject: "Spring maintenance campaign",
      mainGoal: "Book more maintenance visits",
      mainOfferOrMessage: "Free first system health report",
    },
    attachmentBlock: null,
    ...overrides,
  };
}

// ─── 1-2. Mode is accepted and sources the existing post ──────────────────────

test("enrich_post is a real backend scope with its own field whitelist", () => {
  assert.ok(Object.keys(SCOPE_FIELDS).includes("enrich_post"), "routes validate against SCOPE_FIELDS keys");
  assert.deepEqual(SCOPE_FIELDS.enrich_post, ENRICHMENT_FIELDS);
  assert.deepEqual(ENRICHMENT_FIELDS, ["hookTitle", "coreMessage", "caption"]);
});

test("enrichment uses the existing post as its source, not a blank brief", () => {
  const input = buildEnrichPostUserInput(enrichContext());

  assert.ok(input.includes("=== CURRENT POST"), "the current post must be in the prompt");
  assert.ok(input.includes(WEAK_CAPTION), "the existing caption must be passed verbatim");
  assert.ok(input.includes("Is your CCTV actually recording?"), "the existing hook must be present");
  assert.ok(input.includes("A camera that looks fine can still be failing silently."), "core message present");
  assert.ok(input.includes("enriching ONE existing, already-approved post"));
  assert.ok(input.includes("STANDARD POST → SAME POST, PROFESSIONAL VERSION"));
});

// ─── 3-7. The preservation contract reaches the model ─────────────────────────

test("topic, idea, angle, audience, funnel intent and offer are contractually preserved", () => {
  const input = buildEnrichPostUserInput(enrichContext());

  assert.ok(input.includes("The topic and the post idea. Do NOT replace the concept with a different or 'better' one."));
  assert.ok(input.includes("The main angle, campaign purpose, and funnel intent."));
  assert.ok(input.includes("The target audience and who the post speaks to."));
  assert.ok(input.includes("The offer, product, or service being discussed"));
});

test("CTA intent may be sharpened but not changed", () => {
  const input = buildEnrichPostUserInput(enrichContext());
  const ctaLine = input.split("\n").find((l) => l.includes("The CTA intent"));
  assert.ok(ctaLine, "the CTA preservation line must exist");
  assert.match(ctaLine, /you may not change what is being asked/i);
});

test("platform, format, schedule and hashtags are declared out of scope", () => {
  const input = buildEnrichPostUserInput(enrichContext());
  assert.ok(input.includes("The post format, platform, schedule, hashtags, visual direction, on-image text, and all video production fields — these are NOT yours to touch in this mode"));
  // And the merge policy backs the promise up.
  for (const field of ["platform", "format", "date", "hashtags", "mainAngle"]) {
    assert.ok(!SCOPE_FIELDS.enrich_post.includes(field), `${field} must not be enrichable`);
  }
});

test("platform-aware depth adapts to the post's platform", () => {
  const ig = buildEnrichPostUserInput(enrichContext());
  assert.ok(ig.includes("PLATFORM — Instagram"), "Instagram guidance");
  assert.ok(ig.includes("readable on a phone"));

  const li = buildEnrichPostUserInput(enrichContext({ current: { ...STATIC_POST, platform: "LinkedIn" } }));
  assert.ok(li.includes("PLATFORM — LinkedIn"));
  assert.ok(li.includes("deeper professional and educational treatment"));

  const fb = buildEnrichPostUserInput(enrichContext({ current: { ...STATIC_POST, platform: "Facebook" } }));
  assert.ok(fb.includes("PLATFORM — Facebook"));

  const other = buildEnrichPostUserInput(enrichContext({ current: { ...STATIC_POST, platform: "TikTok" } }));
  assert.ok(other.includes("respect the existing platform conventions"));
});

// ─── 8-9. Language and brand voice ────────────────────────────────────────────

test("content language uses the shared language mechanism and forbids switching", () => {
  const en = buildEnrichPostUserInput(enrichContext());
  assert.ok(en.includes("=== LANGUAGE INSTRUCTION ==="));
  assert.ok(en.includes("never switch or mix languages"));

  const fa = buildEnrichPostUserInput(enrichContext({ contentLanguage: "fa" }));
  assert.notEqual(
    fa.split("=== LANGUAGE INSTRUCTION ===")[1].slice(0, 200),
    en.split("=== LANGUAGE INSTRUCTION ===")[1].slice(0, 200),
    "a different content language must produce a different language instruction"
  );
});

test("brand context is included and generic thought-leadership voice is forbidden", () => {
  const input = buildEnrichPostUserInput(enrichContext());
  assert.ok(input.includes("=== BRAND ==="));
  assert.ok(input.includes("Audience: London property managers"));
  assert.ok(input.includes("Tone: Practical and technical"));
  assert.ok(input.includes("Do not convert every brand into the same generic 'thought leadership' voice."));
  // Calendar/campaign context travels too.
  assert.ok(input.includes("Spring maintenance campaign"));
  assert.ok(input.includes("Free first system health report"));
});

// ─── 10-11. Reference files, through the shared mechanism ─────────────────────

test("calendar-level and post-level reference material reach the enrichment prompt", async () => {
  const CALENDAR_FACT = "REFERENCE_MARKER_11001: Maintenance visits cover recorder health, storage retention, and lens cleaning.";
  const POST_FACT = "REFERENCE_MARKER_11002: The spring package includes a written system health report.";

  const resolved = await resolveCalendarAttachmentContext({
    attachmentIds: ["att-post", "att-cal"],
    brandId: "b1",
    mode: "post",
    calendarId: "c1",
    calendarPostId: "p4",
    loadAttachmentsFn: async () => [
      {
        id: "att-post", brandId: "b1", calendarId: "c1", calendarPostId: "p4",
        purpose: "calendar_post_regeneration_reference", fileName: "package.txt",
        interpretationJson: { schemaVersion: 1, language: "English", documentType: "service sheet", summary: POST_FACT, keyFacts: [POST_FACT] },
        interpretationStatus: "complete", expiresAt: null,
      },
      {
        id: "att-cal", brandId: "b1", calendarId: "c1", calendarPostId: null,
        purpose: "calendar_reference", fileName: "brief.txt",
        interpretationJson: { schemaVersion: 1, language: "English", documentType: "campaign brief", summary: CALENDAR_FACT, keyFacts: [CALENDAR_FACT] },
        interpretationStatus: "complete", expiresAt: null,
      },
    ],
  });
  assert.ok(resolved.ok);

  const input = buildEnrichPostUserInput(
    enrichContext({ attachmentBlock: `\n=== INTERPRETED UPLOADED REFERENCE MATERIAL ===\n${resolved.block}` })
  );

  assert.ok(input.includes(POST_FACT), "post-specific reference must reach the prompt");
  assert.ok(input.includes(CALENDAR_FACT), "calendar-level reference must reach the prompt");
  // And the prompt tells the model to mine them for real detail.
  assert.ok(input.includes("The interpreted uploaded reference material above, when present — use it to add real detail"));
});

// ─── 12-15. Untouched fields stay untouched (merge policy) ────────────────────

function enrichMerge(original, aiPost) {
  return applyScopedPostRegeneration(original, aiPost, "enrich_post");
}

test("an over-reaching AI response cannot change visual, image-text or video fields", () => {
  const greedyAi = {
    hookTitle: "Is your CCTV actually recording? Most silent failures start at the recorder",
    coreMessage: "Cameras can appear live while the recorder has stopped writing usable footage.",
    caption: "Enriched caption with real depth.",
    // Everything below must be discarded:
    mainAngle: "promotion",
    hashtags: ["#different", "#tags"],
    platform: "LinkedIn",
    format: "Carousel",
    date: "2026-12-01",
    visualDirection: "Completely different neon visual.",
    contentStructure: "A different structure.",
    outputImageTextRequirements: "different image text",
    outputImageTextRequirementsStructured: { type: "static", items: [{ main_headline: "different" }] },
    imageText: "different image text",
    structure: "carousel layout",
    narrationOrDialogueOfCharacterOrCharacters: "A brand new script.",
    mainIntegratedScenario: "A different scenario.",
    cameraMovement: "crash zoom",
    visualMood: "chaotic",
    textOnVideo: "different",
  };

  const merged = enrichMerge(VIDEO_POST, greedyAi);

  // Enriched:
  assert.equal(merged.hookTitle, greedyAi.hookTitle);
  assert.equal(merged.coreMessage, greedyAi.coreMessage);
  assert.equal(merged.caption, greedyAi.caption);

  // Preserved byte-for-byte:
  assert.equal(merged.mainAngle, VIDEO_POST.mainAngle);
  assert.deepEqual(merged.hashtags, VIDEO_POST.hashtags);
  assert.equal(merged.platform, VIDEO_POST.platform);
  assert.equal(merged.format, VIDEO_POST.format);
  assert.equal(merged.date, VIDEO_POST.date);
  assert.equal(merged.postNumber, VIDEO_POST.postNumber);
  assert.equal(merged.visualDirection, VIDEO_POST.visualDirection);
  assert.equal(merged.contentStructure, VIDEO_POST.contentStructure);
  assert.equal(merged.outputImageTextRequirements, VIDEO_POST.outputImageTextRequirements);
  assert.deepEqual(merged.outputImageTextRequirementsStructured, VIDEO_POST.outputImageTextRequirementsStructured);
  assert.equal(merged.imageText, VIDEO_POST.imageText);
  assert.equal(merged.narrationOrDialogueOfCharacterOrCharacters, VIDEO_POST.narrationOrDialogueOfCharacterOrCharacters);
  assert.equal(merged.mainIntegratedScenario, VIDEO_POST.mainIntegratedScenario);
  assert.equal(merged.cameraMovement, VIDEO_POST.cameraMovement);
  assert.equal(merged.visualMood, VIDEO_POST.visualMood);
  assert.equal(merged.textOnVideo, VIDEO_POST.textOnVideo);
});

test("no visual field is reachable from the enrichment scope", () => {
  for (const field of VISUAL_FIELDS) {
    assert.ok(!SCOPE_FIELDS.enrich_post.includes(field), `${field} must stay out of enrichment`);
  }
});

test("identity and review metadata are never part of enrichment output", () => {
  const merged = enrichMerge(
    { ...STATIC_POST, id: "post-1", calendarId: "cal-1", status: "approved" },
    { id: "hacked", calendarId: "other-cal", status: "draft", postNumber: 99, caption: "Enriched." }
  );
  assert.equal(merged.id, "post-1");
  assert.equal(merged.calendarId, "cal-1");
  assert.equal(merged.status, "approved");
  assert.equal(merged.postNumber, STATIC_POST.postNumber);
});

// ─── 16. Failure leaves the original post alone ───────────────────────────────

test("an empty or partial AI response leaves every original value in place", () => {
  const untouched = enrichMerge(STATIC_POST, {});
  assert.deepEqual(untouched, { ...STATIC_POST });

  // A partial response enriches only what actually came back.
  const partial = enrichMerge(STATIC_POST, { caption: "Enriched caption only.", hookTitle: "" });
  assert.equal(partial.caption, "Enriched caption only.");
  assert.equal(partial.hookTitle, STATIC_POST.hookTitle, "an empty string must not blank the hook");
  assert.equal(partial.coreMessage, STATIC_POST.coreMessage);
});

// ─── 17-18. Anti-hallucination and anti-replacement instructions ──────────────

test("the prompt explicitly forbids invented facts and unsupported specifics", () => {
  const input = buildEnrichPostUserInput(enrichContext());

  assert.ok(input.includes("Invented statistics, percentages, survey results, studies, research citations, or expert quotes."));
  assert.ok(input.includes("Fabricated testimonials, case studies, client names, or results."));
  assert.ok(input.includes("Unverifiable numbers of any kind"));
  assert.ok(input.includes("FACTUAL SAFETY (CRITICAL)"));
  assert.ok(input.includes("do not invent it"));
  assert.ok(input.includes("Make the point generally instead"));
  assert.ok(input.includes("better to return a shorter, fully-supported post than a longer one containing one invented fact"));
});

test("the prompt forbids concept replacement and length padding", () => {
  const input = buildEnrichPostUserInput(enrichContext());

  assert.ok(input.includes("NOT a different post"));
  assert.ok(input.includes("Never STANDARD POST → DIFFERENT POST."));
  assert.ok(input.includes("DO NOT PAD — length is not the goal."));
  assert.ok(input.includes("Every added sentence must carry information the reader did not already have."));
  assert.ok(input.includes("Restatements of something the post already says."));
  assert.ok(input.includes("Generic filler"));
});

// ─── 19-20. Carousel and static behaviour ─────────────────────────────────────

test("carousel enrichment preserves the carousel concept and slide plan", () => {
  const input = buildEnrichPostUserInput(enrichContext({ current: { ...CAROUSEL_POST } }));

  assert.ok(input.includes("CAROUSEL POST — enrich the progression, not just the words:"));
  assert.ok(input.includes("Keep the central carousel concept, the main angle, and the existing number and order of slides"));
  assert.ok(input.includes("Do not re-plan the carousel."));
  assert.ok(input.includes("a slide that gains one sharp, specific point is better than a slide that gains a paragraph"));
  // The existing slide plan is visible to the model as read-only context.
  assert.ok(input.includes("Slide 1 hook, slide 2 what fails, slide 3 what we check, slide 4 CTA."));
  // And the slide plan itself is not an enrichable field.
  assert.ok(!SCOPE_FIELDS.enrich_post.includes("contentStructure"));
});

test("static enrichment targets hook, explanation and caption depth", () => {
  const input = buildEnrichPostUserInput(enrichContext());

  assert.ok(input.includes("STATIC / SINGLE POST — the caption carries everything:"));
  assert.ok(input.includes("Sharpen the hook so it promises the same thing more specifically."));
  assert.ok(input.includes("Add the supporting reasoning and concrete detail that a single image cannot show."));
  assert.ok(input.includes("Keep the original concept intact — this is the same post, explained properly."));
  // A weak post keeps its own facts in front of the model.
  assert.ok(input.includes("Regular CCTV maintenance helps keep your security system working properly."));
});

test("video-format enrichment refuses to touch the script and production fields", () => {
  const input = buildEnrichPostUserInput(enrichContext({ current: { ...VIDEO_POST } }));
  assert.ok(input.includes("VIDEO / REEL POST — enrich only the written content"));
  assert.ok(input.includes("must not appear in your output"));
});

// ─── Optional enrichment guidance ─────────────────────────────────────────────

test("the optional instruction guides enrichment without overriding preservation", () => {
  const without = buildEnrichPostUserInput(enrichContext());
  assert.ok(!without.includes("=== WHAT THE USER ASKED TO ENRICH"), "omitted when empty");

  const blank = buildEnrichPostUserInput(enrichContext({ enrichmentInstruction: "   " }));
  assert.ok(!blank.includes("=== WHAT THE USER ASKED TO ENRICH"), "whitespace counts as empty");

  const guided = buildEnrichPostUserInput(
    enrichContext({ enrichmentInstruction: "Add more technical detail about what is checked." })
  );
  assert.ok(guided.includes("=== WHAT THE USER ASKED TO ENRICH (guidance only) ==="));
  assert.ok(guided.includes("Add more technical detail about what is checked."));
  assert.ok(guided.includes("It does NOT license you to change the topic, concept, angle, audience, offer, CTA intent, or any preserved field above."));
});

test("the output contract restricts the model to the three enrichable fields", () => {
  const input = buildEnrichPostUserInput(enrichContext());
  assert.ok(input.includes("Return ONLY valid JSON with EXACTLY these fields"));
  assert.ok(input.includes("Do NOT return mainAngle, hashtags, format, platform, date, contentStructure, visualDirection, outputImageTextRequirements, imageText, or any video production field."));
});

// ─── 21. Existing modes are unchanged ─────────────────────────────────────────

test("the existing regeneration scopes keep their exact field whitelists", () => {
  assert.deepEqual(SCOPE_FIELDS.visual_only, VISUAL_FIELDS);
  assert.deepEqual(SCOPE_FIELDS.visual_ideas_only, VISUAL_FIELDS);
  assert.deepEqual(SCOPE_FIELDS.entire_post, [
    "hookTitle", "mainAngle", "coreMessage", "caption", "hashtags", ...VISUAL_FIELDS,
  ]);
  assert.deepEqual(SCOPE_FIELDS.custom_instruction, [
    "format", "hookTitle", "mainAngle", "coreMessage", "caption", "hashtags", ...VISUAL_FIELDS,
  ]);
  assert.deepEqual(SCOPE_FIELDS.image_text_only, [
    "outputImageTextRequirementsStructured", "outputImageTextRequirements", "imageText",
  ]);
});

test("the existing mode prompts carry no enrichment contract and still behave as before", () => {
  const full = buildVisualOrEntirePostUserInput({ ...enrichContext(), scope: "entire_post" });
  assert.ok(full.includes("Full post regeneration"));
  assert.ok(!full.includes("STANDARD POST → SAME POST"), "enrichment rules must not leak into entire_post");

  const visual = buildVisualOrEntirePostUserInput({ ...enrichContext(), scope: "visual_only" });
  assert.ok(visual.includes("Regenerate ONLY the visual direction"));
  assert.ok(!visual.includes("DO NOT PAD"));

  const custom = buildCustomInstructionUserInput({ ...enrichContext(), customInstruction: "Make the CTA shorter." });
  assert.ok(custom.includes("TARGETED EDIT vs FULL REWRITE"));
  assert.ok(!custom.includes("=== TASK: ENRICH THIS POST ==="));

  const imageText = buildImageTextOnlyUserInput({ ...enrichContext(), guidedReasons: [], guidedFeatures: [] });
  assert.ok(imageText.includes("Your ONLY task is to regenerate outputImageTextRequirementsStructured"));
  assert.ok(!imageText.includes("=== TASK: ENRICH THIS POST ==="));
});
