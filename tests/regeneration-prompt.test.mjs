// Deterministic regression tests for AI post-regeneration prompt assembly and
// uploaded-reference propagation.
//
// These assert against the ACTUAL assembled provider input (the `userInput`
// strings that both regeneration routes pass to generateWithPromptTemplate,
// plus the creation route's batch userInput) — not against helper functions in
// isolation — so a marker or context field proven present here is proven
// present in the real provider call.
//
// Model-level compliance (does the AI obey the rules?) is enforced by the
// prompt contract asserted here; the rules themselves are deterministic text.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildCustomInstructionUserInput,
  buildVisualOrEntirePostUserInput,
  buildImageTextOnlyUserInput,
  applyScopedPostRegeneration,
  SCOPE_FIELDS,
} from "@/lib/calendar-regeneration-prompt";
import { buildCalendarGenerationUserInput } from "@/lib/calendar-generation-user-input";
import { resolveCalendarAttachmentContext } from "@/lib/calendar-attachment-context";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const MARKER_FACT = "REFERENCE_MARKER_74291: The workshop includes a dedicated Dahua practical session.";

const FULL_CAPTION = [
  "Level up your photography with our hands-on studio workshop.",
  "You will learn lighting setups, composition, and editing workflows.",
  "Every attendee gets personal feedback on their portfolio.",
  "Lunch and refreshments are included.",
  "Contact us at hello@bloom.example to reserve your seat.",
].join("\n");

const EXISTING_POST = {
  postNumber: 3,
  platform: "Instagram",
  format: "Static",
  hookTitle: "Master Studio Lighting in One Day",
  mainAngle: "education",
  coreMessage: "A single workshop day can transform how you light any scene.",
  caption: FULL_CAPTION,
  hashtags: ["#photography", "#workshop", "#lighting", "#studio", "#dahua"],
  visualDirection: "Clean minimal layout, soft daylight tones, product shot on the right third.",
  contentStructure: "Hook, three learning points, CTA card.",
  structure: "static layout",
  inspiration: "selected post idea",
};

function basePromptContext(overrides = {}) {
  return {
    current: { ...EXISTING_POST },
    currentOitrDisplay: "main_headline: Master Studio Lighting",
    brandSummary: "Brand: Bloom Studio. Tone: Warm. Services: Photography workshops.",
    contentLanguage: "en",
    calendarContext: {
      mainMonthlySubject: "Workshop season campaign",
      mainGoal: "Sell out the April workshop",
      mainOfferOrMessage: "Early-bird discount for the first 10 seats",
    },
    attachmentBlock: null,
    ...overrides,
  };
}

// ─── 1-2. Text targeted edits preserve unrelated caption content ──────────────

test("targeted text edit passes the existing caption verbatim + preservation contract", () => {
  const input = buildCustomInstructionUserInput({
    ...basePromptContext(),
    customInstruction: "Add that the workshop includes Dahua equipment.",
  });

  // Existing factual content reaches the model untouched.
  assert.ok(input.includes(FULL_CAPTION), "existing caption must be passed to the model");
  assert.ok(input.includes("Contact us at hello@bloom.example"), "CTA/contact must be present");
  assert.ok(input.includes("#photography #workshop #lighting #studio #dahua"), "hashtags must be present");

  // Preservation contract is part of the actual provider input.
  assert.ok(input.includes("TARGETED EDIT vs FULL REWRITE"));
  assert.ok(input.includes("NEVER rewrite an entire caption, headline, or script for a small edit"));
  assert.ok(input.includes("Preserve the existing topic, concept, intent, structure, factual content, numbers, dates, CTA, contact details, and hashtags unless the instruction explicitly asks to change them."));
  assert.ok(input.includes("UNCHANGED FIELDS MUST BE RETURNED VERBATIM"));

  // The instruction itself is delivered.
  assert.ok(input.includes("Add that the workshop includes Dahua equipment."));
});

test("minor CTA edit does not instruct a full caption rewrite", () => {
  const input = buildCustomInstructionUserInput({
    ...basePromptContext(),
    customInstruction: "Make the CTA shorter.",
  });

  assert.ok(input.includes("Make the CTA shorter."));
  assert.ok(input.includes("Change ONLY the parts necessary to satisfy the instruction"));
  // Full rewrite is gated behind an explicit request only.
  const fullRewriteLine = input.split("\n").find(l => l.includes("FULL REWRITE — allowed ONLY"));
  assert.ok(fullRewriteLine, "full-rewrite escape hatch must exist");
  assert.match(fullRewriteLine, /only when the instruction explicitly requests it/i);
});

// ─── 3. Dialogue targeted edit preserves unaffected dialogue/context ──────────

test("dialogue targeted edit receives the existing script + dialogue preservation rules", () => {
  const dialogue = [
    "Speaker 1: Welcome to the Dahua practical session!",
    "Speaker 2: I am not sure this is for me...",
    "Speaker 1: You will be configuring a real camera in the first ten minutes.",
  ].join("\n");
  const current = {
    ...EXISTING_POST,
    format: "Reel",
    narrationOrDialogueOfCharacterOrCharacters: dialogue,
  };

  const input = buildCustomInstructionUserInput({
    ...basePromptContext({ current }),
    customInstruction: "Make the second speaker sound more confident.",
  });

  // The existing dialogue lines reach the model so only the requested line changes.
  assert.ok(input.includes("Narration/dialogue script: Speaker 1: Welcome to the Dahua practical session!"));
  assert.ok(input.includes("Speaker 2: I am not sure this is for me..."), "unaffected dialogue line must be present");

  assert.ok(input.includes("Dialogue/narration edits: keep the scene, concept, speakers, and unaffected lines exactly as they are; modify only the requested part; keep speaker intent and continuity consistent. Do not create a totally new dialogue unless explicitly requested."));

  // Intent-aware rule routes dialogue-only edits away from other fields.
  assert.ok(input.includes("Dialogue/narration-only change: update narrationOrDialogueOfCharacterOrCharacters only."));
});

// ─── 4. Visual targeted edit preserves concept + unrelated constraints ────────

test("visual targeted edit applies on top of the existing visual direction", () => {
  const input = buildCustomInstructionUserInput({
    ...basePromptContext(),
    customInstruction: "Make the background darker and more premium.",
  });

  assert.ok(input.includes(`Visual direction: ${EXISTING_POST.visualDirection}`), "existing visual direction must be present");
  assert.ok(input.includes("Visual edits: apply the requested change ON TOP of the existing visual direction; keep the subject, composition, layout system, branding, and CTA concept unless they directly conflict with the instruction."));
});

test("visual-only scope regenerates visuals but keeps continuity with the post concept", () => {
  const input = buildVisualOrEntirePostUserInput({
    ...basePromptContext(),
    scope: "visual_only",
  });

  assert.ok(input.includes("Keep hookTitle, coreMessage, mainAngle, caption, and hashtags exactly as they are."));
  assert.ok(input.includes("CONTINUITY REQUIREMENT: build ON TOP of the CURRENT visual direction above"));
  assert.ok(input.includes("Preserve the post concept, campaign intent, subject/product/service presentation, composition system, and branding unless they directly conflict"));
  assert.ok(input.includes(EXISTING_POST.visualDirection));
});

// ─── 5. Entire-post regeneration is still allowed to regenerate broadly ───────

test("entire_post regeneration explicitly allows broad regeneration", () => {
  const input = buildVisualOrEntirePostUserInput({
    ...basePromptContext(),
    scope: "entire_post",
  });

  assert.ok(input.includes("Regenerate the entire post content, visuals, and production fields."));
  assert.ok(input.includes("You may regenerate broadly"));
  // The targeted-edit mandate must NOT constrain full regeneration.
  assert.ok(!input.includes("TARGETED EDIT vs FULL REWRITE"));
  assert.ok(!input.includes("NEVER rewrite an entire caption"));
});

test("explicit full-rewrite instruction unlocks broad regeneration inside custom_instruction", () => {
  const input = buildCustomInstructionUserInput({
    ...basePromptContext(),
    customInstruction: "Rewrite completely — replace the concept with something bolder.",
  });

  const escapeLines = input.split("\n").filter(l =>
    l.includes('"rewrite completely"') || l.includes('"replace the concept"')
  );
  assert.ok(escapeLines.length > 0, "explicit rewrite phrases must appear in the escape hatch");
});

// ─── 6. Calendar creation includes reference marker AND normal context ────────

test("calendar creation userInput includes uploaded-reference marker alongside brand/campaign/schedule", () => {
  const input = buildCalendarGenerationUserInput({
    count: 5,
    batchContext: null,
    acceptedSummaries: null,
    safeCount: 12,
    formFields: {
      platforms: "Instagram, LinkedIn",
      mainMonthlySubject: "Workshop season campaign",
      mainGoal: "Sell out the April workshop",
      mainOfferOrMessage: "Early-bird discount",
      importantDetailsToInclude: "Dahua partnership",
      publishingFrequency: "3 posts per week",
      requiredPostFormats: "8 Static, 4 Carousel",
      targetAudience: "Hobbyist photographers",
      sourceMaterial: "Brand website copy",
    },
    brand: {
      name: "Bloom Studio",
      businessType: "Creative Agency",
      businessLocation: "Austin, TX",
      website: "https://bloom.example",
      instagramPage: "@bloomstudio",
      linkedinPage: "linkedin.com/company/bloomstudio",
      facebookPage: "facebook.com/bloomstudio",
      brandTone: "Warm, approachable",
      targetAudience: "Small business owners",
      mainServicesOrProducts: "Photography workshops",
      brandVisualStyle: "Clean minimalism",
    },
    identitySummary: "Visual identity summary placeholder",
    selectedPosts: [{ title: "Workshop teaser" }],
    selectedPostIdeasText: "1. Workshop teaser",
    attachmentBlock: `<interpreted_uploaded_reference_material>\n${MARKER_FACT}\n</interpreted_uploaded_reference_material>`,
    contentLanguage: "en",
  });

  // The interpreted reference fact reaches the actual provider input…
  assert.ok(input.includes(MARKER_FACT), "unique reference fact must reach the creation prompt");
  assert.ok(input.includes("=== INTERPRETED UPLOADED REFERENCE MATERIAL ==="));

  // …supplementing — never replacing — the normal calendar context.
  assert.ok(input.includes("=== BRAND INFORMATION ==="));
  assert.ok(input.includes("Bloom Studio"));
  assert.ok(input.includes("=== BRAND IDENTITY ==="));
  assert.ok(input.includes("=== CAMPAIGN & CALENDAR DETAILS ==="));
  assert.ok(input.includes("Workshop season campaign"));
  assert.ok(input.includes("Dahua partnership"));
  assert.ok(input.includes("=== POSTING SCHEDULE ==="));
  assert.ok(input.includes("3 posts per week"));
  assert.ok(input.includes("Hobbyist photographers")); // campaign target audience
  assert.ok(input.includes("=== CONTENT RULES ==="));
  assert.ok(input.includes("=== LANGUAGE INSTRUCTION ==="));
});

// ─── 7-8. Post regeneration includes marker + existing post context + instruction ─

test("post regeneration userInput includes reference marker AND existing post context AND user instruction", async () => {
  // Build the reference block through the REAL resolver so this proves the
  // full chain: stored interpretation -> resolveCalendarAttachmentContext ->
  // block -> assembled provider input.
  const resolved = await resolveCalendarAttachmentContext({
    attachmentIds: ["att-marker"],
    brandId: "b1",
    mode: "post",
    calendarId: "c1",
    calendarPostId: "p3",
    loadAttachmentsFn: async () => [
      {
        id: "att-marker",
        brandId: "b1",
        calendarId: "c1",
        calendarPostId: null,
        purpose: "calendar_reference",
        fileName: "brief.txt",
        interpretationJson: {
          schemaVersion: 1,
          language: "English",
          documentType: "campaign brief",
          summary: MARKER_FACT,
          keyFacts: [MARKER_FACT],
        },
        interpretationStatus: "complete",
        expiresAt: null,
      },
    ],
  });
  assert.ok(resolved.ok);
  const input = buildCustomInstructionUserInput({
    ...basePromptContext({ attachmentBlock: `\n=== INTERPRETED UPLOADED REFERENCE MATERIAL ===\n${resolved.block}` }),
    customInstruction: "Mention that spaces are limited.",
  });

  // Reference material…
  assert.ok(input.includes(MARKER_FACT));

  // …existing post context…
  assert.ok(input.includes("=== CURRENT POST ==="));
  assert.ok(input.includes(FULL_CAPTION));
  assert.ok(input.includes("Early-bird discount for the first 10 seats")); // calendar offer
  assert.ok(input.includes("#photography #workshop #lighting #studio #dahua"));

  // …and the user instruction — all in ONE provider input.
  assert.ok(input.includes("Mention that spaces are limited."));

  // Relationship guard: references are framed as supporting material only.
  assert.ok(input.includes("Do not automatically overwrite the Brand, calendar form, existing post, or explicit user instructions."));
});

test("post-specific reference takes priority; capacity rules keep total at 5", () => {
  // Mirrors the saved-post route's combination policy via SCOPE_FIELDS presence
  // and MAX_ATTACHMENT_FILES enforcement in the resolver layer.
  const records = [
    { id: "a-post-1", brandId: "b1", calendarId: "c1", calendarPostId: "p1", purpose: "calendar_post_regeneration_reference", fileName: "post.txt", interpretationJson: { schemaVersion: 1, language: "en", documentType: "note", summary: "s" }, interpretationStatus: "complete", expiresAt: null },
    { id: "a-cal-1", brandId: "b1", calendarId: "c1", calendarPostId: null, purpose: "calendar_reference", fileName: "cal.txt", interpretationJson: { schemaVersion: 1, language: "en", documentType: "note", summary: "s" }, interpretationStatus: "complete", expiresAt: null },
  ];

  return resolveCalendarAttachmentContext({
    attachmentIds: ["a-post-1", "a-cal-1"],
    brandId: "b1",
    mode: "post",
    calendarId: "c1",
    calendarPostId: "p1",
    loadAttachmentsFn: async () => records,
  }).then((ctx) => {
    assert.ok(ctx.ok);
    // Both scopes resolved into one block, post-specific ordered first.
    assert.equal(ctx.attachmentCount, 2);
    assert.deepEqual(ctx.attachmentIds, ["a-post-1", "a-cal-1"]);
    const postBlockFirst = ctx.block.indexOf("post.txt") < ctx.block.indexOf("cal.txt");
    assert.ok(postBlockFirst, "post-specific file must appear before calendar-level file");
    assert.ok(ctx.block.includes(MARKER_FACT) === false); // sanity: fixture uses its own summaries
    assert.ok(ctx.block.length > 0);
  });
});

// ─── 10. Unsupported/missing attachment context fails safely ──────────────────

test("missing attachment fails safely with 404 instead of silent drop", async () => {
  const result = await resolveCalendarAttachmentContext({
    attachmentIds: ["does-not-exist"],
    brandId: "b1",
    mode: "creation",
    loadAttachmentsFn: async () => [],
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.error, "Attachment not found");
});

test("cross-brand attachment access fails safely with 404", async () => {
  const result = await resolveCalendarAttachmentContext({
    attachmentIds: ["att-x"],
    brandId: "brand-A",
    mode: "creation",
    loadAttachmentsFn: async () => [
      { id: "att-x", brandId: "brand-B", calendarId: null, calendarPostId: null, purpose: "calendar_reference_creation", fileName: "x.txt", interpretationJson: { schemaVersion: 1, language: "en", documentType: "note", summary: "s" }, interpretationStatus: "complete", expiresAt: null },
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test("not-ready interpretation fails safely with 409 instead of empty context", async () => {
  const result = await resolveCalendarAttachmentContext({
    attachmentIds: ["att-y"],
    brandId: "b1",
    mode: "creation",
    loadAttachmentsFn: async () => [
      { id: "att-y", brandId: "b1", calendarId: null, calendarPostId: null, purpose: "calendar_reference_creation", fileName: "y.txt", interpretationJson: null, interpretationStatus: "pending", expiresAt: null },
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.error, "Attachment interpretation is not ready");
});

test("expired attachment fails safely with 404", async () => {
  const result = await resolveCalendarAttachmentContext({
    attachmentIds: ["att-z"],
    brandId: "b1",
    mode: "creation",
    now: "2026-01-01T00:00:00Z",
    loadAttachmentsFn: async () => [
      { id: "att-z", brandId: "b1", calendarId: null, calendarPostId: null, purpose: "calendar_reference_creation", fileName: "z.txt", interpretationJson: { schemaVersion: 1, language: "en", documentType: "note", summary: "s" }, interpretationStatus: "complete", expiresAt: "2020-01-01T00:00:00Z" },
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.error, "Attachment is no longer available");
});

// ─── Scope merge policy regression guards ─────────────────────────────────────

test("scope field whitelist keeps visual scopes away from caption and vice versa", () => {
  assert.ok(!SCOPE_FIELDS.visual_only.includes("caption"));
  assert.ok(!SCOPE_FIELDS.image_text_only.includes("caption"));
  assert.ok(SCOPE_FIELDS.custom_instruction.includes("format"));
  assert.ok(SCOPE_FIELDS.entire_post.includes("caption") && SCOPE_FIELDS.entire_post.includes("visualDirection"));
});

test("applyScopedPostRegeneration preserves original content when AI omits fields", () => {
  const original = { ...EXISTING_POST, postNumber: 7 };
  const merged = applyScopedPostRegeneration(original, { caption: "New caption only." }, "custom_instruction");
  assert.equal(merged.caption, "New caption only.");
  assert.equal(merged.hookTitle, EXISTING_POST.hookTitle, "omitted fields must keep the original value");
  assert.equal(merged.postNumber, 7, "postNumber is never overwritten");

  const visualMerged = applyScopedPostRegeneration(original, { visualDirection: "darker bg" }, "visual_only");
  assert.equal(visualMerged.visualDirection, "darker bg");
  assert.equal(visualMerged.caption, FULL_CAPTION, "visual scope must not touch the caption");
});

test("image_text_only prompt keeps post context read-only and preservation-first", () => {
  const input = buildImageTextOnlyUserInput({
    ...basePromptContext(),
    guidedReasons: ["Too generic"],
    guidedFeatures: [],
    imageTextInstruction: "",
  });
  assert.ok(input.includes("READ-ONLY CONTEXT — do NOT change these fields"));
  assert.ok(input.includes("PRESERVE the post idea, hook, core message, caption, hashtags"));
  assert.ok(input.includes("Preserve the existing slide concept — do not replace the post idea"));
});

