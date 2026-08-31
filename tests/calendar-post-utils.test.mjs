// Deterministic regression tests for the hashtag normalization/merge helpers
// and the calendar table/export column definitions.
//
// These lock in the guarantees the caption-generation prompt rules cannot
// enforce on their own: exactly-5 cap + dedupe, hashtag line always last, no
// duplicate/scattered AI-authored hashtags left in the caption body, and no
// separate Hashtags column in the schedule grid or in exports once hashtags
// live inside the caption.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeHashtagList,
  mergeHashtagsIntoCaption,
  deriveFallbackHashtags,
  CALENDAR_TABLE_VIEWS,
} from "@/lib/calendar-post-utils";
import { generateCsv, buildExportRows } from "@/lib/calendar-export";

// ─── normalizeHashtagList ──────────────────────────────────────────────────────

test("normalizeHashtagList caps at 5 hashtags", () => {
  const result = normalizeHashtagList(["#a", "#b", "#c", "#d", "#e", "#f", "#g"]);
  assert.equal(result.length, 5);
  assert.deepEqual(result, ["#a", "#b", "#c", "#d", "#e"]);
});

test("normalizeHashtagList dedupes case-insensitively and adds a missing #", () => {
  const result = normalizeHashtagList(["CCTV", "#CCTV", "#cctv", "Security"]);
  assert.deepEqual(result, ["#CCTV", "#Security"]);
});

test("normalizeHashtagList drops blanks and trims whitespace inside a tag", () => {
  const result = normalizeHashtagList(["  #Manchester Training  ", "", null, "#Real"]);
  assert.deepEqual(result, ["#ManchesterTraining", "#Real"]);
});

// ─── mergeHashtagsIntoCaption ───────────────────────────────────────────────────

const HASHTAGS = ["#CCTVTraining", "#ManchesterTraining", "#SecurityInstaller", "#CCTVCourse", "#BEAcademy"];

test("mergeHashtagsIntoCaption appends exactly the 5 hashtags as the final line", () => {
  const { caption, hashtags } = mergeHashtagsIntoCaption("Book your spot today.", HASHTAGS);
  assert.equal(hashtags.length, 5);
  const lines = caption.split("\n");
  assert.equal(lines[lines.length - 1], HASHTAGS.join(" "));
  // Nothing follows the hashtag line.
  assert.ok(caption.endsWith(HASHTAGS.join(" ")));
});

test("mergeHashtagsIntoCaption strips a trailing AI-authored hashtag block before appending", () => {
  const raw = "Book your spot today.\n\n#old1 #old2 #old3";
  const { caption } = mergeHashtagsIntoCaption(raw, HASHTAGS);
  assert.ok(!caption.includes("#old1"), "stray trailing hashtags must be removed");
  assert.equal(caption.split("\n").pop(), HASHTAGS.join(" "));
});

test("mergeHashtagsIntoCaption strips hashtags scattered mid-caption, not just trailing", () => {
  const raw = "Check out our #cctv install today.\nWe cover #Manchester and beyond.\n\nBook now.";
  const { caption } = mergeHashtagsIntoCaption(raw, HASHTAGS);
  const lines = caption.split("\n");
  const hashtagLine = lines.pop();
  const body = lines.join("\n");
  assert.ok(!body.includes("#"), "no hashtags may remain anywhere in the caption body");
  assert.ok(body.includes("Check out our install today."), "surrounding text must survive with whitespace cleaned up");
  assert.equal(hashtagLine, HASHTAGS.join(" "), "hashtag line must still be last");
});

test("mergeHashtagsIntoCaption never leaves duplicate hashtag blocks", () => {
  const raw = "#stray1 #stray2 opening line.\n\nMiddle content.\n\n#stray3 #stray4 #stray5";
  const { caption } = mergeHashtagsIntoCaption(raw, HASHTAGS);
  const hashtagOccurrences = (caption.match(/#\w+/g) || []).length;
  assert.equal(hashtagOccurrences, 5, "only the canonical 5 hashtags may remain");
});

test("mergeHashtagsIntoCaption returns the caption unchanged when there are no hashtags", () => {
  const { caption, hashtags } = mergeHashtagsIntoCaption("Just a plain caption.", []);
  assert.equal(caption, "Just a plain caption.");
  assert.deepEqual(hashtags, []);
});

// ─── Deterministic exactly-5 fallback (Instagram) ──────────────────────────────
// Real known brand/post context, matching the requested derivation examples:
// "BE Academy" -> #BEAcademy, "Manchester" -> #Manchester, "CCTV Training" -> #CCTVTraining.

const BRAND_CONTEXT = {
  brandName: "BE Academy",
  mainServicesOrProducts: "CCTV Training, Access Control, Alarm Installation",
  businessLocation: "Manchester, UK",
  businessType: "Security Training Provider",
  campaignSubject: "Autumn Enrolment Drive",
};

test("deriveFallbackHashtags turns known short fields into hashtags exactly as specified", () => {
  const tags = deriveFallbackHashtags([], {
    brandName: "BE Academy",
    mainServicesOrProducts: "CCTV Training",
    businessLocation: "Manchester",
  }, 5);
  assert.ok(tags.includes("#CCTVTraining"), "service name must derive deterministically");
  assert.ok(tags.includes("#BEAcademy"), "business name acronym must be preserved, not lowercased");
  assert.ok(tags.includes("#Manchester"), "city must derive deterministically");
});

test("deriveFallbackHashtags rejects an overlong free-text phrase instead of mangling it into one giant hashtag", () => {
  const tags = deriveFallbackHashtags([], {
    campaignSubject: "This is a very long marketing campaign subject line that goes on and on",
  }, 5);
  assert.equal(tags.length, 0, "an overlong phrase must be rejected, never turned into a hashtag");
});

test("deriveFallbackHashtags fabricates nothing when there is no known context", () => {
  const tags = deriveFallbackHashtags([], {}, 5);
  assert.deepEqual(tags, [], "with no known context, nothing should be invented");
});

test("mergeHashtagsIntoCaption keeps the AI's 5 hashtags unchanged on Instagram (no fallback triggered)", () => {
  const aiTags = ["#CCTVTraining", "#ManchesterTraining", "#SecurityInstaller", "#CCTVCourse", "#BEAcademy"];
  const { hashtags } = mergeHashtagsIntoCaption("Book now.", aiTags, { platform: "Instagram", context: BRAND_CONTEXT });
  assert.deepEqual(hashtags, aiTags);
});

test("mergeHashtagsIntoCaption pads a 3-hashtag Instagram result up to exactly 5 using known context only", () => {
  const aiTags = ["#SpecialOffer", "#EnrollNow", "#LearnSecurity"];
  const { hashtags, caption } = mergeHashtagsIntoCaption("Book your spot.", aiTags, { platform: "Instagram", context: BRAND_CONTEXT });
  assert.equal(hashtags.length, 5);
  assert.deepEqual(hashtags.slice(0, 3), aiTags, "the AI's own hashtags must be preserved as-is");
  const derived = hashtags.slice(3);
  const knownDerivable = new Set(["#CCTVTraining", "#AccessControl", "#AlarmInstallation", "#BEAcademy", "#Manchester", "#UK", "#SecurityTrainingProvider", "#AutumnEnrolmentDrive"]);
  for (const tag of derived) assert.ok(knownDerivable.has(tag), `${tag} must trace back to known brand/post context`);
  assert.equal(caption.split("\n").pop(), hashtags.join(" "), "hashtag line must still be last");
});

test("mergeHashtagsIntoCaption resolves AI duplicates vs context-derived tags to exactly 5 unique hashtags", () => {
  const aiTags = ["#BEAcademy", "#beacademy", "#CCTVTraining"]; // case-insensitive duplicate
  const { hashtags } = mergeHashtagsIntoCaption("Book now.", aiTags, { platform: "Instagram", context: BRAND_CONTEXT });
  assert.equal(hashtags.length, 5);
  const lower = hashtags.map(h => h.toLowerCase());
  assert.equal(new Set(lower).size, 5, "all 5 hashtags must be unique");
});

test("mergeHashtagsIntoCaption derives all 5 hashtags from known context when the AI returns zero", () => {
  const { hashtags, caption } = mergeHashtagsIntoCaption("Book your spot today.", [], { platform: "Instagram", context: BRAND_CONTEXT });
  assert.equal(hashtags.length, 5);
  assert.equal(caption.split("\n").pop(), hashtags.join(" "));
  const forbidden = ["#love", "#viral", "#instagood", "#fyp"];
  const lower = hashtags.map(h => h.toLowerCase());
  for (const bad of forbidden) assert.ok(!lower.includes(bad), `${bad} must never appear`);
});

// ─── Platform scoping: exactly-5 padding is Instagram-only ────────────────────
// Requirement: only a value that safely, case-insensitively normalizes to
// "instagram" opts into padding. LinkedIn, Facebook, any other current/future
// platform, and a missing/unknown platform must all fall through to the
// existing default (cap-at-5, no padding) — none of them silently inherit
// Instagram's rule.

test("platform 'Instagram' (canonical capitalization) triggers exactly-5 padding", () => {
  const aiTags = ["#SpecialOffer"];
  const { hashtags } = mergeHashtagsIntoCaption("Book now.", aiTags, { platform: "Instagram", context: BRAND_CONTEXT });
  assert.equal(hashtags.length, 5);
});

test("platform 'instagram' (lowercase) also triggers exactly-5 padding — case normalized safely", () => {
  const aiTags = ["#SpecialOffer"];
  const { hashtags } = mergeHashtagsIntoCaption("Book now.", aiTags, { platform: "instagram", context: BRAND_CONTEXT });
  assert.equal(hashtags.length, 5);
});

test("platform 'LinkedIn' never triggers padding (0-3 behavior preserved)", () => {
  const aiTags = ["#SecurityTraining", "#Manchester"];
  const { hashtags } = mergeHashtagsIntoCaption("Great session today.", aiTags, { platform: "LinkedIn", context: BRAND_CONTEXT });
  assert.deepEqual(hashtags, aiTags, "LinkedIn hashtag count must stay exactly what the AI returned");
});

test("platform 'LinkedIn' with zero AI hashtags stays at zero — never forced", () => {
  const { hashtags, caption } = mergeHashtagsIntoCaption("Great session today.", [], { platform: "LinkedIn", context: BRAND_CONTEXT });
  assert.deepEqual(hashtags, []);
  assert.equal(caption, "Great session today.");
});

test("platform 'Facebook' does not inherit Instagram's exactly-5 rule", () => {
  const aiTags = ["#SpecialOffer"];
  const { hashtags } = mergeHashtagsIntoCaption("Book now.", aiTags, { platform: "Facebook", context: BRAND_CONTEXT });
  assert.deepEqual(hashtags, aiTags, "Facebook must not be padded up to 5");
});

test("an unrecognized/future platform value does not inherit Instagram's exactly-5 rule", () => {
  const aiTags = ["#SpecialOffer"];
  const { hashtags } = mergeHashtagsIntoCaption("Book now.", aiTags, { platform: "Threads", context: BRAND_CONTEXT });
  assert.deepEqual(hashtags, aiTags, "an unknown platform must fall through to the existing default, not Instagram's rule");
});

test("a missing/undefined platform does not default to exactly 5 — preserves existing default behavior", () => {
  const aiTags = ["#SpecialOffer"];
  const { hashtags } = mergeHashtagsIntoCaption("Book now.", aiTags, { context: BRAND_CONTEXT });
  assert.deepEqual(hashtags, aiTags, "undefined platform must not be padded");

  const noOptions = mergeHashtagsIntoCaption("Book now.", aiTags);
  assert.deepEqual(noOptions.hashtags, aiTags, "omitting options entirely must behave the same way");
});

// ─── UI: no separate Hashtags column ────────────────────────────────────────────

test("CALENDAR_TABLE_VIEWS schedule view has no separate hashtags column", () => {
  const schedule = CALENDAR_TABLE_VIEWS.find(v => v.id === "schedule");
  assert.ok(schedule, "schedule view must exist");
  assert.ok(
    !schedule.columns.some(c => c.key === "hashtags"),
    "schedule table must not render a separate Hashtags column"
  );
});

// ─── Export: dynamic Hashtags column omission ──────────────────────────────────

function dbPost(overrides) {
  return {
    postNumber: 1,
    date: "2026-01-01",
    platform: "Instagram",
    suggestedCaption: "Some caption.\n\n" + HASHTAGS.join(" "),
    hashtags: HASHTAGS.join(" "),
    postData: JSON.stringify({ hashtagsMergedIntoCaption: true, hashtags: HASHTAGS }),
    ...overrides,
  };
}

test("generateCsv omits the Hashtags column when every post is merged into the caption", () => {
  const rows = buildExportRows([dbPost({}), dbPost({ postNumber: 2 })]);
  const csv = generateCsv(rows);
  const header = csv.split("\r\n")[0];
  assert.ok(!header.includes("Hashtags"), "all-merged export must not include a Hashtags column");
});

test("generateCsv keeps the Hashtags column when a legacy (non-merged) post is present", () => {
  const legacyPost = dbPost({
    postNumber: 2,
    postData: JSON.stringify({ hashtagsMergedIntoCaption: false }),
  });
  const rows = buildExportRows([dbPost({}), legacyPost]);
  const csv = generateCsv(rows);
  const header = csv.split("\r\n")[0];
  assert.ok(header.includes("Hashtags"), "legacy hashtag data must still be exportable");
});
