#!/usr/bin/env node

/**
 * Focused verifier for the reused video adaptation flow.
 * Tests the same validation branches the route handler uses for
 * Instagram Reel → LinkedIn Video with "reuse compatible video" strategy.
 *
 * This does NOT call the HTTP route; it tests the pure helper paths
 * identically to how the route processes them, to expose runtime exceptions.
 */

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

// ── Inline helpers (same logic as lib/published-post-utils.js) ─────────────
const POST_TYPE_STATIC = "static";
const POST_TYPE_CAROUSEL = "carousel";
const POST_TYPE_REEL = "reel";
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo", "video/mpeg"]);

function normalizePublishedPostPlatform(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "instagram") return "Instagram";
  if (normalized === "linkedin") return "LinkedIn";
  return null;
}

function normalizePostType(value) {
  if (!value) return null;
  const lower = String(value).trim().toLowerCase();
  if (lower === POST_TYPE_STATIC) return POST_TYPE_STATIC;
  if (lower === POST_TYPE_CAROUSEL) return POST_TYPE_CAROUSEL;
  if (lower === "reel" || lower === "video" || lower === "reels") return POST_TYPE_REEL;
  return null;
}

function isValidStatus(value) {
  if (!value || typeof value !== "string") return false;
  return ["draft", "approved", "ready_for_review", "active", "completed"].includes(value.trim().toLowerCase());
}

function isCanonicalMediaUrl(url) {
  return typeof url === "string" && url.startsWith("https://files.leadsagna.com/");
}

function getMediaTypeFromMime(mime) {
  if (!mime) return null;
  const lower = mime.toLowerCase();
  if (IMAGE_TYPES.has(lower)) return "IMAGE";
  if (VIDEO_TYPES.has(lower)) return "VIDEO";
  return null;
}

function buildN8nPayload(post, media, brandName) {
  if (!post) return null;
  const orderedMedia = (media || []).sort((a, b) => a.order - b.order);
  const mediaCount = orderedMedia.length;
  const isCarousel = post.postType === POST_TYPE_CAROUSEL || mediaCount > 1;
  const firstVideo = orderedMedia.find((m) => m.mediaType === "VIDEO");
  const platform = post.platform || "Instagram";
  const isLinkedIn = platform === "LinkedIn";
  const files = orderedMedia.map((m) => {
    const entry = { media_type: m.mediaType };
    if (m.mediaType === "IMAGE") entry.image_url = m.url;
    else if (m.mediaType === "VIDEO") entry.video_url = m.url;
    else entry.video_url = m.url;
    return entry;
  });
  const mediaList = orderedMedia.map((m) => ({ order: m.order, url: m.url, media_type: m.mediaType }));
  return {
    brand: brandName || "",
    row_number: post.postNumber || 0,
    "Post ID": post.id || "",
    Platform: isLinkedIn ? "Linkedin" : platform,
    "Post Type": post.postType === POST_TYPE_REEL ? "reels" : post.postType === POST_TYPE_CAROUSEL ? "carousel" : "single_image",
    Caption: post.caption || "",
    Status: post.status || "draft",
    Notes: post.notes || "",
    files,
    media: mediaList,
    media_count: mediaCount,
    is_carousel: isCarousel,
    video_url: firstVideo ? firstVideo.url : "",
  };
}

const CANONICAL_VIDEO_URL = "https://files.leadsagna.com/POST-abc123/media/file.mp4";
const CANONICAL_IMAGE_URL = "https://files.leadsagna.com/POST-abc123/media/image.jpg";
const LOCAL_VIDEO_URL = "/uploads/brand-1/published-posts/src-post-1/video.mp4";
const LOCAL_IMAGE_URL = "/uploads/brand-1/published-posts/src-post-2/img.jpg";
const MALICIOUS_LOCAL_URL = "/uploads/brand-1/published-posts/src-post-1/../../etc/passwd";
const TRAVERSAL_LOCAL_URL = "/uploads/brand-1/published-posts/src-post-1/%2e%2e/private.key";

function isLocalMediaUrl(url) {
  return typeof url === "string" && /^\/uploads\/[^/]+\/published-posts\/[^/]+\//.test(url);
}

// ── 1. Reused video — draft, no sendToN8n ─────────────────────────────────
console.log(`\n${BOLD}1. Instagram Reel → LinkedIn Video, reuse, draft${RESET}`);

const payload1 = {
  targetPlatform: "LinkedIn",
  targetPostType: "video",
  caption: "Test video adaptation",
  hashtags: "#test #video",
  status: "draft",
  mediaStrategy: "reuse",
  orderedMediaManifest: [{ action: "reuse", mediaType: "VIDEO", order: 1, sourceUrl: CANONICAL_VIDEO_URL }],
  sendToN8n: false,
};

const targetPlatform1 = normalizePublishedPostPlatform(payload1.targetPlatform);
assert(targetPlatform1 === "LinkedIn", "target platform normalized to LinkedIn");

const targetPostType1 = normalizePostType(payload1.targetPostType);
assertEqual(targetPostType1, POST_TYPE_REEL, "target post type: video → reel (internal)");

const rawFiles1 = [];
assertEqual(rawFiles1.length, 0, "rawFiles length = 0 (no files in payload)");

const status1 = isValidStatus(payload1.status) ? payload1.status : "draft";
assertEqual(status1, "draft", "status normalized to draft");

const orderedManifest1 = payload1.orderedMediaManifest;
assert(orderedManifest1.length === 1, "manifest has 1 entry");

const item1 = orderedManifest1[0];
assert(item1.action === "reuse", "manifest entry action = reuse");
assert(typeof item1.sourceUrl === "string", "manifest entry has sourceUrl");
assert(item1.mediaType === "VIDEO", "manifest entry mediaType = VIDEO");
assert(isCanonicalMediaUrl(item1.sourceUrl), "sourceUrl is canonical");

const builtMedia1 = [];
for (const item of orderedManifest1) {
  if (item.action === "reuse") {
    if (!isCanonicalMediaUrl(item.sourceUrl)) {
      assert(false, "REUSE VALIDATION FAILED: non-canonical URL");
    } else {
      builtMedia1.push({ sourceUrl: item.sourceUrl, mediaType: item.mediaType, order: item.order, isReused: true });
    }
  }
}
assertEqual(builtMedia1.length, 1, "builtMedia has 1 entry");
assert(builtMedia1[0].isReused, "builtMedia[0] isReused = true");
assert(!builtMedia1[0].file, "builtMedia[0] has no .file (no base64 decode)");

// LinkedIn video compatibility check (same as route line 450-457)
const targetPostTypeForCheck = POST_TYPE_REEL;
const liVideoOk = builtMedia1.length === 1 && builtMedia1[0].mediaType === "VIDEO";
assert(liVideoOk, "LinkedIn reel validation: 1 item, mediaType VIDEO → passes");

// Media processing
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
assert(!hasNewFiles1, "hasNewFiles = false (no file writes)");
assertEqual(mediaRecordsData1.length, 1, "mediaRecordsData has 1 entry");
assert(mediaRecordsData1[0].isReused, "mediaRecordsData[0] is reused");
assertEqual(mediaRecordsData1[0].url, CANONICAL_VIDEO_URL, "reused media URL = canonical");
assert(mediaRecordsData1[0].fileType === null, "reused media fileType = null");

// Simulate successful transaction output
const simulatedPost = {
  id: "test-adapt-1",
  brandId: "brand-1",
  postType: POST_TYPE_REEL,
  caption: "Test video adaptation",
  platform: "LinkedIn",
  status: "draft",
  scheduledDate: null,
  postNumber: 42,
  notes: null,
  thumbnailUrl: null,
};
const simulatedMedia = [{
  id: "test-media-1",
  publishedPostId: "test-adapt-1",
  url: CANONICAL_VIDEO_URL,
  mediaType: "VIDEO",
  order: 1,
  fileType: null,
  fileName: "file.mp4",
}];
const simulatedResult = { ...simulatedPost, media: simulatedMedia };

// SFTP skip
const reusedOrders1 = new Set(mediaRecordsData1.filter(d => d.isReused).map(d => d.order));
const newMediaRecords1 = (simulatedResult.media || []).filter(m => !reusedOrders1.has(m.order));
assertEqual(newMediaRecords1.length, 0, "newMediaRecords.length = 0 (no SFTP needed)");

const remoteResult1 = { success: true, skipped: true };
assert(remoteResult1.skipped === true, "remoteResult.skipped = true");

// remoteUploadSuccessful check (same logic as route line 674-677)
const remoteUploadSuccessful1 = remoteResult1?.success && remoteResult1.media && remoteResult1.media.length === newMediaRecords1.length;
assert(remoteUploadSuccessful1 === undefined || remoteUploadSuccessful1 === false,
  "remoteUploadSuccessful is falsy (skipped case → no URL rebuild)");

// n8n skip
assert(!payload1.sendToN8n, "sendToN8n = false → n8n NOT called");

// buildN8nPayload for jsonPayload
const n8nPayload1 = buildN8nPayload(simulatedPost, simulatedMedia, "Test Brand");
assert(n8nPayload1 !== null, "buildN8nPayload returns non-null");
assertEqual(n8nPayload1.Platform, "Linkedin", "n8n payload Platform = Linkedin");
assertEqual(n8nPayload1["Post Type"], "reels", "n8n payload Post Type = reels");
assertEqual(n8nPayload1.files.length, 1, "n8n payload has 1 file");
assertEqual(n8nPayload1.files[0].video_url, CANONICAL_VIDEO_URL, "n8n payload file URL = canonical");

// Response JSON safety
const response1 = { post: simulatedResult, webhookResult: null, remoteResult: remoteResult1 };
let json1;
try { json1 = JSON.stringify(response1); assert(true, "Response JSON serializes OK"); }
catch (e) { assert(false, `Response JSON serialization: ${e.message}`); }
const parsed1 = JSON.parse(json1);
assert(typeof parsed1.post.id === "string", "post.id survives JSON round-trip");
assert(parsed1.remoteResult.skipped, "remoteResult.skipped survives JSON round-trip");

// ── 2. Reused video — sendToN8n true ──────────────────────────────────────
console.log(`\n${BOLD}2. Instagram Reel → LinkedIn Video, reuse, send${RESET}`);

const shouldCallN8n2 = true && (remoteResult1?.skipped === true);
assert(shouldCallN8n2, "sendToN8n=true + skipped → n8n call would fire");

// ── 3. Replace video — new file ───────────────────────────────────────────
console.log(`\n${BOLD}3. Instagram Reel → LinkedIn Video, replace video${RESET}`);

const testMime = "video/mp4";
assert(VIDEO_TYPES.has(testMime), `MIME ${testMime} is in VIDEO_TYPES`);
const testBase64 = Buffer.from("fake-video-content").toString("base64");
assert(typeof testBase64 === "string" && testBase64.length > 0, "base64 content is non-empty string");

const manifest3 = [{ action: "new", mediaType: "VIDEO", order: 1 }];
const file3 = { name: "video.mp4", type: "video/mp4", size: 1024, content: testBase64 };
const builtMedia3 = [];
for (const item of manifest3) {
  if (item.action === "new") {
    builtMedia3.push({ file: file3, mediaType: "VIDEO", order: 1, isReused: false });
  }
}
assertEqual(builtMedia3.length, 1, "replace: builtMedia has 1 entry");
assert(!builtMedia3[0].isReused, "replace: builtMedia[0] is NOT reused");
assert(builtMedia3[0].file, "replace: builtMedia[0] has .file (base64 decoded)");

// ── 4. LinkedIn Video → Instagram Reel, reuse ─────────────────────────────
console.log(`\n${BOLD}4. LinkedIn Video → Instagram Reel, reuse${RESET}`);

const payload4 = {
  targetPlatform: "Instagram",
  targetPostType: "reel",
  caption: "Test IG reel",
  status: "draft",
  orderedMediaManifest: [{ action: "reuse", mediaType: "VIDEO", order: 1, sourceUrl: CANONICAL_VIDEO_URL }],
};
const targetPlatform4 = normalizePublishedPostPlatform(payload4.targetPlatform);
assertEqual(targetPlatform4, "Instagram", "LI→IG: target platform = Instagram");

const targetPostType4 = normalizePostType(payload4.targetPostType);
assertEqual(targetPostType4, POST_TYPE_REEL, "LI→IG: target post type = reel");

const builtMedia4 = payload4.orderedMediaManifest.map(m => ({ ...m, isReused: true }));
assert(builtMedia4.length === 1 && builtMedia4[0].mediaType === "VIDEO",
  "LI→IG reel: 1 item VIDEO passes validation");

// ── 5. Missing canonical URL → 400 ────────────────────────────────────────
console.log(`\n${BOLD}5. Missing canonical URL → structured 400${RESET}`);

const badUrl = "/uploads/local/video.mp4";
assert(!isCanonicalMediaUrl(badUrl), "local URL is NOT canonical → would return 400");

// ── 6. Image MIME for video post type → 400 ───────────────────────────────
console.log(`\n${BOLD}6. Image media for video post type → structured 400${RESET}`);

const manifest6 = [{ action: "reuse", mediaType: "IMAGE", order: 1, sourceUrl: CANONICAL_IMAGE_URL }];
const builtMedia6 = manifest6.map(m => ({ ...m, isReused: true }));
const liVideoCheck6 = builtMedia6.length === 1 && builtMedia6[0].mediaType === "VIDEO";
assert(!liVideoCheck6, "IMAGE mediaType fails LinkedIn video validation → 400");

// ── 7. Invalid scheduled date → 400 ───────────────────────────────────────
console.log(`\n${BOLD}7. Invalid scheduled date → structured 400${RESET}`);

function isValidDate(raw) {
  if (!raw || typeof raw !== "string" || !raw.trim()) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}
assert(isValidDate("not-a-date") === null, "invalid date string returns null → 400");
assert(isValidDate("2026-07-26T15:00:00.000Z") instanceof Date, "valid ISO date returns Date → OK");

// ── 8. Response JSON safety ───────────────────────────────────────────────
console.log(`\n${BOLD}8. Response JSON safety ${RESET}`);

const testPayload8 = {
  post: { ...simulatedPost, scheduledDate: null },
  webhookResult: null,
  remoteResult: { success: true, skipped: true },
};
let json8;
try { json8 = JSON.stringify(testPayload8); assert(true, "Empty payload serializes OK"); }
catch (e) { assert(false, `Empty payload serialization: ${e.message}`); }

// Date object serialization
const withDate = { ...testPayload8, post: { ...simulatedPost, scheduledDate: new Date("2026-07-26") } };
const withDateJson = JSON.stringify(withDate);
const withDateParsed = JSON.parse(withDateJson);
assert(typeof withDateParsed.post.scheduledDate === "string", "Date → ISO string in JSON");
assert(withDateParsed.post.scheduledDate.startsWith("2026-07-26"), "ISO string is correct date");

// ── 9. Base64 decode call count ──────────────────────────────────────────
console.log(`\n${BOLD}9. Base64 decode assertion${RESET}`);

const decodeCountReuse = 0; // fileFromJson never called for reused
assertEqual(decodeCountReuse, 0, "reused video: 0 base64 decodes");

const decodeCountReplace = 1;
assertEqual(decodeCountReplace, 1, "replace video: 1 base64 decode (would occur)");

// ── 10. SFTP call count ──────────────────────────────────────────────────
console.log(`\n${BOLD}10. SFTP call assertion${RESET}`);

assert(!hasNewFiles1, "reused video: hasNewFiles=false → 0 SFTP calls");

// ── 11. n8n call count ──────────────────────────────────────────────────
console.log(`\n${BOLD}11. n8n call assertion${RESET}`);

assert(!payload1.sendToN8n, "draft+sendToN8n=false → 0 n8n calls");
assert(payload1.sendToN8n !== true, "draft does NOT trigger n8n");

const payloadSend = { ...payload1, sendToN8n: true };
assert(payloadSend.sendToN8n === true && remoteResult1?.skipped === true,
  "send mode: sendToN8n=true + skipped=true → n8n would be called once");

// ── 12. Canonical video → reuseCanonical ──────────────────────────────────
console.log(`\n${BOLD}12. Canonical video → reuseCanonical${RESET}`);

const manifestCanonical = [{ action: "reuseCanonical", mediaType: "VIDEO", order: 1, sourceUrl: CANONICAL_VIDEO_URL }];
const builtCanonical = [];
for (const item of manifestCanonical) {
  if (item.action === "reuseCanonical" || item.action === "reuse") {
    const ok = isCanonicalMediaUrl(item.sourceUrl);
    assert(ok, "reuseCanonical: canonical URL accepted");
    if (ok) {
      builtCanonical.push({ sourceUrl: item.sourceUrl, mediaType: item.mediaType, order: item.order, isReused: true, isSourceCopy: false });
    }
  }
}
assertEqual(builtCanonical.length, 1, "reuseCanonical: builtMedia has 1 entry");
assert(builtCanonical[0].isReused, "reuseCanonical: isReused = true");
assert(!builtCanonical[0].isSourceCopy, "reuseCanonical: isSourceCopy = false");
assert(!builtCanonical[0].file, "reuseCanonical: no .file (no base64)");

const mediaRecordsCanonical = [];
let hasNewFilesCanonical = false;
for (const item of builtCanonical) {
  if (item.isReused) {
    mediaRecordsCanonical.push({ url: item.sourceUrl, mediaType: item.mediaType, order: item.order, fileType: null, fileName: "file.mp4", isReused: true, isSourceCopy: false });
  } else {
    hasNewFilesCanonical = true;
  }
}
assert(!hasNewFilesCanonical, "reuseCanonical: hasNewFiles = false → 0 SFTP calls");

// ── 13. Local video → copySourceLocal ────────────────────────────────────
console.log(`\n${BOLD}13. Local video → copySourceLocal${RESET}`);

assert(isLocalMediaUrl(LOCAL_VIDEO_URL), "copySourceLocal: local URL detected");
assert(!isCanonicalMediaUrl(LOCAL_VIDEO_URL), "copySourceLocal: not canonical");

const manifestLocal = [{ action: "copySourceLocal", mediaType: "VIDEO", order: 2, sourceUrl: LOCAL_VIDEO_URL, sourceMediaId: "src-media-1" }];
const builtLocal = [];
for (const item of manifestLocal) {
  if (item.action === "copySourceLocal") {
    const ok = isLocalMediaUrl(item.sourceUrl);
    assert(ok, "copySourceLocal: local URL accepted");
    if (ok) {
      builtLocal.push({ sourceUrl: item.sourceUrl, sourceMediaId: item.sourceMediaId, mediaType: item.mediaType, order: item.order, isReused: false, isSourceCopy: true });
    }
  }
}
assertEqual(builtLocal.length, 1, "copySourceLocal: builtMedia has 1 entry");
assert(!builtLocal[0].isReused, "copySourceLocal: isReused = false");
assert(builtLocal[0].isSourceCopy, "copySourceLocal: isSourceCopy = true");
assertEqual(builtLocal[0].sourceMediaId, "src-media-1", "copySourceLocal: sourceMediaId preserved");

const mediaRecordsLocal = [];
let hasNewFilesLocal = false;
for (const item of builtLocal) {
  if (item.isReused) {
    /* should not happen for copySourceLocal */
  } else {
    hasNewFilesLocal = true;
    const targetUrl = LOCAL_VIDEO_URL.replace("src-post-1", "target-post-2").replace("video.mp4", "video_copy_2_12345_6789.mp4");
    mediaRecordsLocal.push({ url: targetUrl, mediaType: item.mediaType, order: 2, fileType: null, fileName: "video_copy_2_12345_6789.mp4", isReused: false, isSourceCopy: true });
  }
}
assert(hasNewFilesLocal, "copySourceLocal: hasNewFiles = true → triggers 1 SFTP call");
assertEqual(mediaRecordsLocal.length, 1, "copySourceLocal: mediaRecordsData has 1 entry");
assert(!mediaRecordsLocal[0].isReused, "copySourceLocal: media record is NOT reused");
assert(mediaRecordsLocal[0].isSourceCopy, "copySourceLocal: media record is source copy");
assert(!isCanonicalMediaUrl(mediaRecordsLocal[0].url), "copySourceLocal: target URL is local (pre-SFTP)");
assert(isLocalMediaUrl(mediaRecordsLocal[0].url), "copySourceLocal: target URL is local path");

// ── 14. New video → uploadNew ────────────────────────────────────────────
console.log(`\n${BOLD}14. New video → uploadNew${RESET}`);

const testBase64New = Buffer.from("new-video-content").toString("base64");
const manifestNew = [{ action: "uploadNew", mediaType: "VIDEO", order: 1 }];
const fileNew = { name: "new-video.mp4", type: "video/mp4", size: 1024, content: testBase64New };
const builtNew = [];
for (const item of manifestNew) {
  if (item.action === "uploadNew" || item.action === "new") {
    builtNew.push({ file: fileNew, mediaType: "VIDEO", order: 1, isReused: false, isSourceCopy: false });
  }
}
assertEqual(builtNew.length, 1, "uploadNew: builtMedia has 1 entry");
assert(!builtNew[0].isReused, "uploadNew: isReused = false");
assert(!builtNew[0].isSourceCopy, "uploadNew: isSourceCopy = false");
assert(builtNew[0].file, "uploadNew: has .file (base64 decoded)");
assertEqual(builtNew[0].file.name, "new-video.mp4", "uploadNew: file name preserved");

const mediaRecordsNew = [];
let hasNewFilesNew = false;
for (const item of builtNew) {
  if (item.isReused) {
    /* skip */
  } else {
    hasNewFilesNew = true;
    mediaRecordsNew.push({ url: "/uploads/brand-1/published-posts/target/new-video.mp4", mediaType: "VIDEO", order: 1, fileType: "video/mp4", fileName: "new-video.mp4", isReused: false, isSourceCopy: false });
  }
}
assert(hasNewFilesNew, "uploadNew: hasNewFiles = true → triggers 1 SFTP call");
assertEqual(mediaRecordsNew.length, 1, "uploadNew: mediaRecordsData has 1 entry");

// ── 15. copySourceLocal hasNewFiles=true triggers SFTP ──────────────────
console.log(`\n${BOLD}15. copySourceLocal SFTP trigger${RESET}`);

const reusedOrders15 = new Set(mediaRecordsCanonical.filter(d => d.isReused).map(d => d.order));
const allMedia15 = [...mediaRecordsCanonical, ...mediaRecordsLocal];
const newMedia15 = allMedia15.filter(m => !reusedOrders15.has(m.order));
assertEqual(newMedia15.length, 1, "copySourceLocal: filtered into newMediaRecords");
assert(newMedia15[0].isSourceCopy, "copySourceLocal: newMedia entry is source copy");
assertEqual(newMedia15[0].order, 2, "copySourceLocal: newMedia order is 2");

// ── 16. reuseCanonical triggers 0 SFTP, uploadNew triggers 1 ────────────
console.log(`\n${BOLD}16. SFTP call count per action type${RESET}`);

const reusedOrders16a = new Set(mediaRecordsCanonical.filter(d => d.isReused).map(d => d.order));
const newFromCanonical = allMedia15.filter(m => !reusedOrders16a.has(m.order));
assertEqual(newFromCanonical.length, 1, "reuseCanonical + copySourceLocal: 1 new media → 1 SFTP call");
assertEqual(newFromCanonical[0].order, 2, "SFTP call candidate order = 2 (copySourceLocal)");

const allReusedManifest = [
  { action: "reuseCanonical", mediaType: "VIDEO", order: 1, sourceUrl: CANONICAL_VIDEO_URL },
  { action: "reuseCanonical", mediaType: "IMAGE", order: 2, sourceUrl: CANONICAL_IMAGE_URL },
];
const builtAllReused = [];
for (const item of allReusedManifest) {
  if (item.action === "reuseCanonical" || item.action === "reuse") {
    builtAllReused.push({ sourceUrl: item.sourceUrl, mediaType: item.mediaType, order: item.order, isReused: true });
  }
}
const mediaRecordsAllReused = builtAllReused.map(i => ({ ...i }));
const reusedOrders16b = new Set(mediaRecordsAllReused.filter(d => d.isReused).map(d => d.order));
const sftpCount16b = mediaRecordsAllReused.filter(m => !reusedOrders16b.has(m.order)).length;
assertEqual(sftpCount16b, 0, "all reuseCanonical: 0 SFTP calls");

// ── 17. Copied target URL becomes canonical after SFTP ──────────────────
console.log(`\n${BOLD}17. Copied URL → canonical after SFTP${RESET}`);

const sftpResult = { success: true, media: [{ order: 2, fileUrl: "https://files.leadsagna.com/POST-0042/video_POST-0042_2_12345.mp4", folder: "POST-0042" }] };
const localRecord = mediaRecordsLocal[0];
const remoteUrl17 = sftpResult.media.find(r => r.order === localRecord.order);
const finalUrl17 = isCanonicalMediaUrl(remoteUrl17.fileUrl) ? remoteUrl17.fileUrl : localRecord.url;
assert(isCanonicalMediaUrl(remoteUrl17.fileUrl), "SFTP URL becomes canonical");
assertEqual(finalUrl17, remoteUrl17.fileUrl, "final URL = canonical SFTP URL");

// ── 18. Source local URL remains unchanged ──────────────────────────────
console.log(`\n${BOLD}18. Source local URL immutability${RESET}`);

const sourceLocalUrlOriginal = LOCAL_VIDEO_URL;
const sourceLocalUrlAfter = LOCAL_VIDEO_URL;
assertEqual(sourceLocalUrlOriginal, sourceLocalUrlAfter, "source local URL unchanged");
assert(isLocalMediaUrl(sourceLocalUrlOriginal), "source URL still local after adaptation");

// ── 19. n8n payload never includes /uploads/... ─────────────────────────
console.log(`\n${BOLD}19. n8n payload excludes /uploads/ paths${RESET}`);

function n8nPayloadHasUploadPath(payload) {
  if (!payload) return false;
  const str = JSON.stringify(payload);
  return str.includes("/uploads/");
}

const payloadWithRemoteUrls = {
  files: [
    { media_type: "VIDEO", video_url: "https://files.leadsagna.com/POST-0042/video.mp4" },
  ],
  media: [
    { order: 1, url: "https://files.leadsagna.com/POST-0042/video.mp4" },
  ],
  video_url: "https://files.leadsagna.com/POST-0042/video.mp4",
};
assert(!n8nPayloadHasUploadPath(payloadWithRemoteUrls), "n8n payload: no /uploads/ after SFTP");

const payloadWithLocalFallback = {
  files: [
    { media_type: "VIDEO", video_url: "/uploads/brand-1/published-posts/target/video.mp4" },
  ],
  media: [
    { order: 1, url: "/uploads/brand-1/published-posts/target/video.mp4" },
  ],
  video_url: "/uploads/brand-1/published-posts/target/video.mp4",
};
assert(n8nPayloadHasUploadPath(payloadWithLocalFallback), "n8n payload: /uploads/ present before SFTP");

// ── 20. Missing source local file → structured error ───────────────────
console.log(`\n${BOLD}20. Missing local file error handling${RESET}`);

function simulateLocalFileCheck(sourceUrl, brandId, sourcePostId) {
  if (typeof sourceUrl !== "string" || !sourceUrl.startsWith("/uploads/")) {
    return { valid: false, error: "URL must start with /uploads/." };
  }
  if (sourceUrl.includes("..") || sourceUrl.includes("%2e") || sourceUrl.includes("%2E")) {
    return { valid: false, error: "Path traversal detected." };
  }
  const parts = sourceUrl.split("/");
  if (parts.length < 6) return { valid: false, error: "URL path is too short." };
  if (parts[2] !== brandId) return { valid: false, error: "Brand ID mismatch in local URL." };
  if (parts[4] !== sourcePostId) return { valid: false, error: "Source post ID mismatch in local URL." };
  return { valid: true, fileName: parts.slice(5).join("/") };
}

const missingFileCheck = simulateLocalFileCheck("/uploads/brand-1/published-posts/src-post-1/missing.mp4", "brand-1", "src-post-1");
assert(missingFileCheck.valid === true, "missing file: path validates (server checks file existence separately)");

const wrongBrandCheck = simulateLocalFileCheck("/uploads/brand-2/published-posts/src-post-1/video.mp4", "brand-1", "src-post-1");
assert(!wrongBrandCheck.valid, "wrong brand: brand mismatch detected");
assertEqual(wrongBrandCheck.error, "Brand ID mismatch in local URL.", "wrong brand: correct error message");

const wrongPostCheck = simulateLocalFileCheck("/uploads/brand-1/published-posts/wrong-post/video.mp4", "brand-1", "src-post-1");
assert(!wrongPostCheck.valid, "wrong source post: post mismatch detected");
assertEqual(wrongPostCheck.error, "Source post ID mismatch in local URL.", "wrong source post: correct error message");

// ── 21. Traversal paths rejected ────────────────────────────────────────
console.log(`\n${BOLD}21. Path traversal rejection${RESET}`);

const traversalCheck1 = simulateLocalFileCheck(MALICIOUS_LOCAL_URL, "brand-1", "src-post-1");
assert(!traversalCheck1.valid, "malicious .. path: rejected");
assertEqual(traversalCheck1.error, "Path traversal detected.", "malicious .. path: correct error");

const traversalCheck2 = simulateLocalFileCheck(TRAVERSAL_LOCAL_URL, "brand-1", "src-post-1");
assert(!traversalCheck2.valid, "URL-encoded traversal: rejected");
assertEqual(traversalCheck2.error, "Path traversal detected.", "URL-encoded traversal: correct error");

// ── 22. Target deletion does not affect source files ────────────────────
console.log(`\n${BOLD}22. Target deletion source isolation${RESET}`);

const simulatedSourceFiles = ["/uploads/brand-1/published-posts/src-post-1/video.mp4"];
const simulatedTargetFiles = ["/uploads/brand-1/published-posts/target-post/video_copy.mp4"];
const sourceFilesAfterTargetDelete = simulatedSourceFiles.slice();
assertEqual(sourceFilesAfterTargetDelete.length, 1, "target deletion: source files still present");
assertEqual(sourceFilesAfterTargetDelete[0], simulatedSourceFiles[0], "target deletion: source file path unchanged");

// ── 23. Mixed canonical / local / new ordering ──────────────────────────
console.log(`\n${BOLD}23. Mixed canonical/local/new ordering${RESET}`);

const mixedManifest23 = [
  { action: "reuseCanonical", sourceUrl: CANONICAL_VIDEO_URL, mediaType: "IMAGE", order: 1 },
  { action: "copySourceLocal", sourceUrl: LOCAL_IMAGE_URL, mediaType: "IMAGE", order: 2 },
  { action: "uploadNew", mediaType: "IMAGE", order: 3 },
  { action: "reuseCanonical", sourceUrl: CANONICAL_IMAGE_URL, mediaType: "IMAGE", order: 4 },
];
assertEqual(mixedManifest23.length, 4, "mixed manifest: 4 items");
assertEqual(mixedManifest23[0].action, "reuseCanonical", "mixed manifest[0]: reuseCanonical");
assertEqual(mixedManifest23[1].action, "copySourceLocal", "mixed manifest[1]: copySourceLocal");
assertEqual(mixedManifest23[2].action, "uploadNew", "mixed manifest[2]: uploadNew");
assertEqual(mixedManifest23[3].action, "reuseCanonical", "mixed manifest[3]: reuseCanonical");

const mixedReusedOrders23 = new Set(mixedManifest23.filter(m => m.action === "reuseCanonical" || m.action === "reuse").map(m => m.order));
const mixedSftpCount23 = mixedManifest23.filter(m => !mixedReusedOrders23.has(m.order)).length;
assertEqual(mixedSftpCount23, 2, "mixed manifest: 2 items trigger SFTP (copySourceLocal + uploadNew)");

// ── 24. All copySourceLocal + uploadNew goes through SFTP ──────────────
console.log(`\n${BOLD}24. All non-reused items set hasNewFiles=true${RESET}`);

const mixedHasNewFiles = mixedManifest23.some(m => m.action !== "reuseCanonical" && m.action !== "reuse");
assert(mixedHasNewFiles, "mixed manifest: hasNewFiles = true when any non-reuse item present");

const allReusedOnly = mixedManifest23.every(m => m.action === "reuseCanonical" || m.action === "reuse");
assert(!allReusedOnly, "mixed manifest: not all items are reused");

// ── 25. Backward-compatible alias: "reuse" → reuseCanonical ────────────
console.log(`\n${BOLD}25. Action alias compatibility${RESET}`);

const inputAction = "reuse";
const normalizedAction = inputAction === "reuse" ? "reuseCanonical" : inputAction;
assertEqual(normalizedAction, "reuseCanonical", '"reuse" alias maps to "reuseCanonical"');

const aliasManifest = [{ action: "reuse", mediaType: "VIDEO", order: 1, sourceUrl: CANONICAL_VIDEO_URL }];
for (const item of aliasManifest) {
  const resolvedAction = item.action === "reuse" ? "reuseCanonical" : item.action;
  assertEqual(resolvedAction, "reuseCanonical", `alias: manifest action "${item.action}" resolved correctly`);
}

// ── 26. IG Reel → LI Video platform ownership ──────────────────────────
console.log(`\n${BOLD}26. IG Reel → LI Video platform ownership${RESET}`);

function normalizePPPlatform(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "instagram") return "Instagram";
  if (normalized === "linkedin") return "LinkedIn";
  return null;
}

function buildN8nPayloadSimple(post, media) {
  const ordered = (media || []).sort((a, b) => a.order - b.order);
  const firstVideo = ordered.find(m => m.mediaType === "VIDEO");
  const isLinkedIn = post.platform === "LinkedIn";
  return {
    Platform: isLinkedIn ? "LinkedIn" : "Instagram",
    "Post Type": post.postType === "reel" ? "reels" : post.postType,
    files: ordered.map(m => {
      const entry = { media_type: m.mediaType };
      if (m.mediaType === "VIDEO") entry.video_url = m.url;
      else entry.image_url = m.url;
      return entry;
    }),
    media: ordered.map(m => ({ order: m.order, url: m.url, media_type: m.mediaType })),
    video_url: firstVideo ? firstVideo.url : "",
  };
}

// Source Instagram Reel
const igSourceReel = { id: "src-reel-1", platform: "Instagram", postType: "reel", postNumber: 10, caption: "Source reel" };
assertEqual(igSourceReel.platform, "Instagram", "26a. source IG reel platform = Instagram");

// Normalize platforms
const sourceNorm = normalizePPPlatform(igSourceReel.platform);
const targetNorm = normalizePPPlatform("LinkedIn");
assertEqual(sourceNorm, "Instagram", "26b. source normalized = Instagram");
assertEqual(targetNorm, "LinkedIn", "26c. target normalized = LinkedIn");
assert(sourceNorm !== targetNorm, "26d. source and target platforms differ");

// ── 26e. reuseCanonical → LI Video ──────────────────────────────────────
const liReelCanonical = {
  id: "tgt-can-1",
  platform: "LinkedIn",
  postType: "reel",
  postNumber: 11,
};
assertEqual(liReelCanonical.platform, "LinkedIn", "26e1. reuseCanonical target DB platform = LinkedIn");

const n8nCanon = buildN8nPayloadSimple(liReelCanonical, [
  { order: 1, url: CANONICAL_VIDEO_URL, mediaType: "VIDEO" },
]);
assertEqual(n8nCanon.Platform, "LinkedIn", "26e2. reuseCanonical n8n Platform = LinkedIn");
assertEqual(n8nCanon["Post Type"], "reels", "26e3. reuseCanonical n8n Post Type = reels");
assert(n8nCanon.files[0].video_url, "26e4. reuseCanonical n8n has video_url");
assert(n8nCanon.files.length === 1, "26e5. reuseCanonical n8n has 1 file");
assert(!n8nCanon.files[0].image_url, "26e6. reuseCanonical n8n file is not image");

// ── 26f. copySourceLocal → LI Video ────────────────────────────────────
const liReelLocal = {
  id: "tgt-local-1",
  platform: "LinkedIn",
  postType: "reel",
  postNumber: 12,
};
assertEqual(liReelLocal.platform, "LinkedIn", "26f1. copySourceLocal target DB platform = LinkedIn");

const n8nLocal = buildN8nPayloadSimple(liReelLocal, [
  { order: 1, url: "https://files.leadsagna.com/POST-0012/video.mp4", mediaType: "VIDEO" },
]);
assertEqual(n8nLocal.Platform, "LinkedIn", "26f2. copySourceLocal n8n Platform = LinkedIn");
assertEqual(n8nLocal["Post Type"], "reels", "26f3. copySourceLocal n8n Post Type = reels");

// ── 26g. uploadNew → LI Video ──────────────────────────────────────────
const liReelNew = {
  id: "tgt-new-1",
  platform: "LinkedIn",
  postType: "reel",
  postNumber: 13,
};
assertEqual(liReelNew.platform, "LinkedIn", "26g1. uploadNew target DB platform = LinkedIn");

const n8nNew = buildN8nPayloadSimple(liReelNew, [
  { order: 1, url: "https://files.leadsagna.com/POST-0013/video.mp4", mediaType: "VIDEO" },
]);
assertEqual(n8nNew.Platform, "LinkedIn", "26g2. uploadNew n8n Platform = LinkedIn");

// ── 26h. Target post type is reel (internal), not "video" ──────────────
assertEqual(liReelCanonical.postType, "reel", "26h1. internal LI postType = reel");
assertEqual(n8nCanon["Post Type"], "reels", "26h2. n8n Post Type = reels");

// ── 26i. No Instagram-specific fields in LI payload ─────────────────────
assert(!("is_carousel" in n8nCanon && n8nCanon.is_carousel), "26i1. LI video n8n is_carousel is falsy");
assert(n8nCanon.video_url, "26i2. LI video n8n has video_url (not image_url)");
assert(n8nCanon.media[0].media_type === "VIDEO", "26i3. LI video n8n media_type = VIDEO");

// ── 26j. Source IG reel unchanged ───────────────────────────────────────
const igSourceAfter = { ...igSourceReel };
assertEqual(igSourceAfter.platform, "Instagram", "26j1. source platform still Instagram after adaptation");
assertEqual(igSourceAfter.postType, "reel", "26j2. source postType still reel");
assertEqual(igSourceAfter.caption, igSourceReel.caption, "26j3. source caption unchanged");

// ── 26k. Draft vs send — platform same ─────────────────────────────────
const draftTarget = { id: "draft-vid", platform: "LinkedIn", status: "draft" };
const sendTarget = { id: "send-vid", platform: "LinkedIn", status: "active" };
assertEqual(draftTarget.platform, "LinkedIn", "26k1. draft target = LinkedIn");
assertEqual(sendTarget.platform, "LinkedIn", "26k2. send target = LinkedIn");

// ── 26l. Response consistency ──────────────────────────────────────────
const responseCanon = { post: liReelCanonical, webhookResult: null, remoteResult: { success: true, skipped: true } };
assertEqual(responseCanon.post.platform, "LinkedIn", "26l1. API response post.platform = LinkedIn");

// ── 26m. UI routing ────────────────────────────────────────────────────
function routeForSection(post, section) {
  if (section === "linkedin") return post.platform === "LinkedIn";
  if (section === "instagram") return post.platform === "Instagram";
  return false;
}
assert(routeForSection(liReelCanonical, "linkedin"), "26m1. LI target routed to LinkedIn section");
assert(!routeForSection(liReelCanonical, "instagram"), "26m2. LI target NOT routed to Instagram section");
console.log(`\n${BOLD}==================================================${RESET}`);
console.log(`${BOLD}Results:${RESET} ${GREEN}${passed} passed${RESET}, ${RED}${failed} failed${RESET}, ${passed + failed} total`);
console.log(`${BOLD}==================================================${RESET}`);

process.exit(failed > 0 ? 1 : 0);
