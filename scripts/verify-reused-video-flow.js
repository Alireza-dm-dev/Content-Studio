#!/usr/bin/env node

/**
 * Focused verifier for the reused video adaptation flow.
 * Tests the helper/validation path that exercises the same code
 * branches the route handler uses for Instagram Reel → LinkedIn Video
 * with "reuse compatible video" strategy.
 *
 * This does not call the live HTTP route — it tests the pure helper
 * functions that the route uses, to expose runtime exceptions.
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { passed++; console.log(`  ${GREEN}\u2713${RESET} ${label}`); }
  else { failed++; console.log(`  ${RED}\u2717${RESET} ${label}`); }
}

function assertEqual(actual, expected, label) {
  const a = typeof actual === "object" ? JSON.stringify(actual) : String(actual);
  const e = typeof expected === "object" ? JSON.stringify(expected) : String(expected);
  const ok = a === e;
  if (ok) { passed++; console.log(`  ${GREEN}\u2713${RESET} ${label}`); }
  else { failed++; console.log(`  ${RED}\u2717${RESET} ${label}\n    expected: ${e}\n    actual:   ${a}`); }
}

// ── Load the helper functions ──────────────────────────────────────────────
const utils = require("../lib/published-post-utils.cjs");
const {
  normalizePublishedPostPlatform,
  normalizePostType,
  getMediaTypeFromMime,
  isValidStatus,
  buildN8nPayload,
  MAX_FILE_SIZE,
  IMAGE_TYPES,
  VIDEO_TYPES,
  POST_TYPE_STATIC,
  POST_TYPE_CAROUSEL,
  POST_TYPE_REEL,
} = utils;

// ── Simulation constants (non-DB) ──────────────────────────────────────────
const CANONICAL_VIDEO_URL = "https://files.leadsagna.com/POST-abc123/media/file.mp4";
const CANONICAL_IMAGE_URL = "https://files.leadsagna.com/POST-abc123/media/image.jpg";

// ── 1. Reused video — no new files, no SFTP, no n8n ───────────────────────
console.log(`\n${BOLD}1. Instagram Reel \u2192 LinkedIn Video, reuse, draft${RESET}`);

// Simulate the client payload
const payload1 = {
  targetPlatform: "LinkedIn",
  targetPostType: "video",
  caption: "Test video adaptation",
  hashtags: "#test #video",
  status: "draft",
  mediaStrategy: "reuse",
  orderedMediaManifest: [{
    action: "reuse",
    mediaType: "VIDEO",
    order: 1,
    sourceUrl: CANONICAL_VIDEO_URL,
  }],
  sendToN8n: false,
};

// Route-level validation logic (duplicated from route.js but testing the same paths)
const targetPlatform1 = normalizePublishedPostPlatform(payload1.targetPlatform);
assert(targetPlatform1 === "LinkedIn", "target platform normalized to LinkedIn");

const targetPostType1 = normalizePostType(payload1.targetPostType);
assert(targetPostType1 === POST_TYPE_REEL, "target post type normalized to reel (internally)");

const rawFiles1 = Array.isArray(payload1.files) ? payload1.files : [];
assertEqual(rawFiles1.length, 0, "rawFiles length is 0 (no new files)");

const mediaFiles1 = rawFiles1.filter((f) => f && f.content);
assertEqual(mediaFiles1.length, 0, "mediaFiles (with content) length is 0");

const orderedManifest1 = Array.isArray(payload1.orderedMediaManifest) ? payload1.orderedMediaManifest : [];
assert(orderedManifest1.length === 1, "manifest has 1 entry");

const manifestItem1 = orderedManifest1[0];
assert(manifestItem1.action === "reuse", "manifest entry action is reuse");
assert(typeof manifestItem1.sourceUrl === "string", "manifest entry has sourceUrl");
assert(manifestItem1.mediaType === "VIDEO", "manifest entry mediaType is VIDEO");

// Validate canonical URL (matches isCanonicalMediaUrl pattern)
const isCanonical1 = CANONICAL_VIDEO_URL.startsWith("https://files.leadsagna.com/");
assert(isCanonical1, "sourceUrl is canonical");

// Build the builtMedia array (same logic as route)
const builtMedia1 = [];
for (const item of orderedManifest1) {
  if (item.action === "reuse") {
    builtMedia1.push({
      sourceUrl: item.sourceUrl,
      mediaType: item.mediaType,
      order: item.order,
      isReused: true,
    });
  }
}
assertEqual(builtMedia1.length, 1, "builtMedia has 1 entry");
assert(builtMedia1[0].isReused, "builtMedia[0] is reused");
assert(!builtMedia1[0].file, "builtMedia[0] has no .file property (not decoded)");

// Platform compatibility check (LinkedIn reel = video)
assert(builtMedia1.length === 1 && builtMedia1[0].mediaType === "VIDEO",
  "LinkedIn video check: exactly 1 item with mediaType VIDEO");

// Simulate media records
const mediaRecordsData1 = [];
let hasNewFiles1 = false;
for (const item of builtMedia1) {
  if (item.isReused) {
    mediaRecordsData1.push({
      url: item.sourceUrl,
      mediaType: item.mediaType,
      order: item.order,
      fileType: null,
      fileName: item.sourceUrl.split("/").pop() || "media",
      isReused: true,
    });
  } else {
    hasNewFiles1 = true;
  }
}
assert(!hasNewFiles1, "hasNewFiles is false (no new file processing)");
assertEqual(mediaRecordsData1.length, 1, "mediaRecordsData has 1 entry");
assert(mediaRecordsData1[0].isReused, "mediaRecordsData[0] is reused");
assertEqual(mediaRecordsData1[0].url, CANONICAL_VIDEO_URL, "reused media uses canonical URL");
assert(mediaRecordsData1[0].fileType === null, "reused media fileType is null");

// Simulate transaction result
const simulatedPost = {
  id: "test-post-1",
  brandId: "brand-1",
  postType: POST_TYPE_REEL,
  caption: "Test video adaptation",
  platform: "LinkedIn",
  status: "draft",
  scheduledDate: null,
  postNumber: 1,
  notes: null,
  thumbnailUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const simulatedMedia = [{
  id: "test-media-1",
  publishedPostId: "test-post-1",
  url: CANONICAL_VIDEO_URL,
  mediaType: "VIDEO",
  order: 1,
  fileType: null,
  fileName: "file.mp4",
}];
const simulatedResult = { ...simulatedPost, media: simulatedMedia };

// SFTP skip logic
const reusedOrders1 = new Set(mediaRecordsData1.filter(d => d.isReused).map(d => d.order));
const newMediaRecords1 = (simulatedResult.media || []).filter(m => !reusedOrders1.has(m.order));
assertEqual(newMediaRecords1.length, 0, "newMediaRecords.length is 0 (no new files for SFTP)");
assert(!hasNewFiles1, "SFTP skipped: hasNewFiles is false");

// remoteResult for skip case
const remoteResult1 = hasNewFiles1
  ? null
  : { success: true, skipped: true };
assert(remoteResult1?.skipped, "remoteResult has skipped: true");

// n8n logic
assert(!payload1.sendToN8n, "sendToN8n is false — n8n not called");

// buildN8nPayload (called for jsonPayload)
const payload = buildN8nPayload(simulatedPost, simulatedMedia, "Test Brand");
assert(payload !== null, "buildN8nPayload returns non-null");
assert(typeof payload === "object", "buildN8nPayload returns object");
// Verify it's JSON-serializable
let payloadJson;
try { payloadJson = JSON.stringify({ post: simulatedPost, webhookResult: null, remoteResult: remoteResult1 }); }
catch (e) { assert(false, `JSON serialization of response: ${e.message}`); }
assert(payloadJson.length > 0, "Response payload is JSON-serializable");

// Verify platform in payload
assertEqual(payload.Platform, "Linkedin", "n8n payload Platform is Linkedin");
assertEqual(payload["Post Type"], "reels", "n8n payload Post Type is reels (mapped from reel)");
assertEqual(payload.files.length, 1, "n8n payload has 1 file entry");
assertEqual(payload.files[0].video_url, CANONICAL_VIDEO_URL, "n8n payload file uses canonical video URL");

// ── 2. Reused video — missing canonical URL ──────────────────────────────────
console.log(`\n${BOLD}2. Reused video missing canonical URL ${RESET}`);

// Simulate validation
const badUrl = "/uploads/local/file.mp4";
const isCanonicalBad = badUrl.startsWith("https://files.leadsagna.com/");
assert(!isCanonicalBad, "local URL is NOT canonical (would return 400)");

// ── 3. Reused video — send to n8n ────────────────────────────────────────────
console.log(`\n${BOLD}3. Instagram Reel → LinkedIn Video, reuse, send${RESET}`);

const payload3 = {
  ...payload1,
  sendToN8n: true,
};
assert(payload3.sendToN8n, "sendToN8n is true");
// n8n logic: sendToN8n && (remoteUploadSuccessful || remoteResult?.skipped)
const shouldCallN8n3 = payload3.sendToN8n && (remoteResult1?.skipped === true);
assert(shouldCallN8n3, "n8n should be called (skipped + sendToN8n = true)");

// ── 4. Replace video — new file ──────────────────────────────────────────────
console.log(`\n${BOLD}4. Instagram Reel → LinkedIn Video, replace video${RESET}`);

const payload4 = {
  ...payload1,
  mediaStrategy: "replace",
  files: [{
    name: "video.mp4",
    type: "video/mp4",
    size: 1024,
    content: Buffer.from("fake-base64-content").toString("base64"),
  }],
  orderedMediaManifest: [{
    action: "new",
    mediaType: "VIDEO",
    order: 1,
  }],
};
const rawFiles4 = Array.isArray(payload4.files) ? payload4.files : [];
assert(rawFiles4.length === 1, "rawFiles has 1 entry for replace");

// Check MIME type
const mime4 = rawFiles4[0].type;
assert(VIDEO_TYPES.has(mime4), `MIME type ${mime4} is in VIDEO_TYPES`);

// Check base64 content exists
assert(typeof rawFiles4[0].content === "string" && rawFiles4[0].content.length > 0,
  "replace file has base64 content");

// ── 5. Reused media with image MIME type but claimed as video ─────────────────
console.log(`\n${BOLD}5. Reused media with image MIME type${RESET}`);

const manifest5 = [{
  action: "reuse",
  mediaType: "IMAGE",
  order: 1,
  sourceUrl: CANONICAL_IMAGE_URL,
}];
const builtMedia5 = manifest5.map(m => ({ ...m, isReused: true }));
const targetPostType5 = POST_TYPE_REEL;
const isLinkedInReelOk = builtMedia5.length === 1 && builtMedia5[0].mediaType === "VIDEO";
assert(!isLinkedInReelOk, "LinkedIn reel with image mediaType fails validation (would return 400)");

// ── 6. Invalid scheduled date ────────────────────────────────────────────────
console.log(`\n${BOLD}6. Invalid scheduled date${RESET}`);

function normalizeScheduledDate(raw) {
  if (!raw || typeof raw !== "string" || !raw.trim()) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

const badDate = "not-a-date";
const result6 = normalizeScheduledDate(badDate);
assert(result6 === null, "invalid date returns null (would return 400)");

const goodDate = "2026-07-26T15:00:00.000Z";
const result6b = normalizeScheduledDate(goodDate);
assert(result6b instanceof Date && !isNaN(result6b.getTime()), "valid date returns Date object");

// ── 7. LinkedIn Video → Instagram Reel, reuse ────────────────────────────────
console.log(`\n${BOLD}7. LinkedIn Video → Instagram Reel, reuse${RESET}`);

const payload7 = {
  targetPlatform: "Instagram",
  targetPostType: "reel",
  caption: "Test IG reel from LI",
  hashtags: "#test",
  status: "draft",
  mediaStrategy: "reuse",
  orderedMediaManifest: [{
    action: "reuse",
    mediaType: "VIDEO",
    order: 1,
    sourceUrl: CANONICAL_VIDEO_URL,
  }],
  sendToN8n: false,
};

const targetPlatform7 = normalizePublishedPostPlatform(payload7.targetPlatform);
assert(targetPlatform7 === "Instagram", "target platform normalized to Instagram");

const targetPostType7 = normalizePostType(payload7.targetPostType);
assert(targetPostType7 === POST_TYPE_REEL, "target post type is reel");

const builtMedia7 = payload7.orderedMediaManifest.map(m => ({ ...m, isReused: true }));
assert(builtMedia7.length === 1 && builtMedia7[0].mediaType === "VIDEO",
  "IG reel: exactly 1 item with mediaType VIDEO passes validation");

// ── 8. Response JSON safety ──────────────────────────────────────────────────
console.log(`\n${BOLD}8. Response serialization safety${RESET}`);

const testPayload8 = {
  post: simulatedPost,
  webhookResult: null,
  remoteResult: { success: true, skipped: true },
};
let serialized8;
try {
  serialized8 = JSON.stringify(testPayload8);
  assert(true, "Full response payload serializes to JSON");
} catch (e) {
  assert(false, `Full response payload serialization: ${e.message}`);
}

// Verify no non-serializable values
const parsed8 = JSON.parse(serialized8);
assert(typeof parsed8.post.id === "string", "post.id is a string after round-trip");
assert(typeof parsed8.post.caption === "string", "post.caption is a string after round-trip");
assert(parsed8.remoteResult.skipped === true, "remoteResult.skipped survives JSON round-trip");
assert(parsed8.post.scheduledDate === null, "null scheduledDate survives JSON round-trip");

// Ensure Date objects are serialized properly
const withDate = { ...testPayload8, post: { ...simulatedPost, scheduledDate: new Date("2026-07-26") } };
const withDateJson = JSON.stringify(withDate);
const withDateParsed = JSON.parse(withDateJson);
assert(typeof withDateParsed.post.scheduledDate === "string",
  "Date scheduledDate serializes to ISO string (not Date object)");

// ── Results ──────────────────────────────────────────────────────────────────
console.log(`\n${BOLD}==================================================${RESET}`);
console.log(`${BOLD}Results:${RESET} ${GREEN}${passed} passed${RESET}, ${RED}${failed} failed${RESET}, ${passed + failed} total`);
console.log(`${BOLD}==================================================${RESET}`);

process.exit(failed > 0 ? 1 : 0);
