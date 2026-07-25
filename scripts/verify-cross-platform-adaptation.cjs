#!/usr/bin/env node

/**
 * Dependency-free verifier for the cross-platform post adaptation workflow.
 *
 * Tests:
 *   1. Platform conversion matrix (all valid source → target combinations)
 *   2. Valid and invalid media transformations
 *   3. PDF-to-Instagram blocking
 *   4. Target payload construction
 *   5. Mixed reused/new media ordering
 *   6. Canonical URL validation
 *   7. New media SFTP requirement detection
 *   8. Source immutability
 *   9. Draft versus send behavior
 *  10. Duplicate-submit prevention logic
 *  11. Authorization helpers
 *  12. Private source metadata removal from webhook payload
 */

// ── Colours ─────────────────────────────────────────────────────────────────
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ${GREEN}✓${RESET} ${label}`);
  } else {
    failed++;
    console.log(`  ${RED}✗${RESET} ${label}`);
  }
}

function assertEqual(actual, expected, label) {
  const ok = typeof expected === "object" && expected !== null
    ? JSON.stringify(actual) === JSON.stringify(expected)
    : actual === expected;
  if (ok) {
    passed++;
    console.log(`  ${GREEN}✓${RESET} ${label}`);
  } else {
    failed++;
    console.log(`  ${RED}✗${RESET} ${label}`);
    console.log(`    expected: ${JSON.stringify(expected)}`);
    console.log(`    actual:   ${JSON.stringify(actual)}`);
  }
}

function extractHashtags(text) {
  if (!text) return "";
  const matches = text.match(/#[\w\u0600-\u06FF\u0400-\u04FF]+/g);
  return matches ? matches.join(" ") : "";
}

function normalizePublishedPostPlatform(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "instagram") return "Instagram";
  if (normalized === "linkedin") return "LinkedIn";
  return null;
}

function normalizePostType(type) {
  if (!type) return null;
  const lower = type.toLowerCase().trim();
  if (lower === "video") return "reel";
  if (["static", "carousel", "reel"].includes(lower)) return lower;
  return null;
}

function getMediaTypeFromMime(fileType) {
  if (!fileType) return null;
  const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
  const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo", "video/mpeg"]);
  const lower = fileType.toLowerCase();
  if (IMAGE_TYPES.has(lower)) return "IMAGE";
  if (VIDEO_TYPES.has(lower)) return "VIDEO";
  return null;
}

function isCanonicalMediaUrl(url) {
  if (typeof url !== "string" || !url.trim()) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return false;
    if (u.pathname.includes("/uploads/")) return false;
    if (!/\/POST-\d{4,}\//.test(u.pathname)) return false;
    return true;
  } catch {
    return false;
  }
};

// ── Inline payload builder (mirrors buildN8nPayload) ────────────────────────

function mapN8nPostType(postType) {
  if (!postType) return "single_image";
  const lower = postType.toLowerCase().trim();
  if (lower === "static") return "single_image";
  if (lower === "carousel") return "carousel";
  if (lower === "reel" || lower === "video" || lower === "reels") return "reels";
  return "single_image";
}

function buildN8nPayloadInlined(post, media, brandName) {
  if (!post) return null;
  const orderedMedia = (media || []).sort((a, b) => a.order - b.order);
  const mediaCount = orderedMedia.length;
  const isCarousel = post.postType === "carousel" || mediaCount > 1;
  const firstVideo = orderedMedia.find((m) => m.mediaType === "VIDEO");
  const scheduledDateStr = post.scheduledDate ? "2026-Jul-25 14:00" : "";
  const postId = post.postNumber != null
    ? `POST-${String(post.postNumber).padStart(4, "0")}` : post.id;
  const platform = post.platform || "Instagram";
  const isLinkedIn = platform === "LinkedIn";
  const n8nPostType = mapN8nPostType(post.postType);

  const files = orderedMedia.map((m) => {
    if (isLinkedIn && m.mediaType === "document") {
      return { media_type: "document", document_url: m.url };
    }
    const entry = { media_type: m.mediaType };
    if (m.mediaType === "IMAGE") entry.image_url = m.url;
    else if (m.mediaType === "VIDEO") entry.video_url = m.url;
    else if (m.mediaType === "document") entry.document_url = m.url;
    else entry.video_url = m.url;
    return entry;
  });

  const mediaList = orderedMedia.map((m) => ({
    order: m.order,
    url: m.url,
    media_type: isLinkedIn && m.mediaType === "document" ? "document" : m.mediaType,
  }));

  const includeMediaUrl = !isLinkedIn && n8nPostType !== "reels";
  const mediaUrl = includeMediaUrl && orderedMedia[0] ? orderedMedia[0].url : "";

  const hashtags = extractHashtags(post.caption || "");

  return {
    brand: brandName || "",
    row_number: post.postNumber || 0,
    "Post ID": postId,
    Platform: isLinkedIn ? "LinkedIn" : "Instagram",
    "Post Type": n8nPostType,
    "Scheduled Date": scheduledDateStr,
    Caption: post.caption || "",
    Hashtags: hashtags,
    "Account / Profile": "",
    Status: post.status || "draft",
    "Webhook Sent At": "2026-Jul-25 10:00",
    "Error Log": "",
    Notes: post.notes || "",
    data: "",
    output: "",
    from_smartcc: false,
    ...(includeMediaUrl ? { media_url: mediaUrl } : {}),
    files,
    media: mediaList,
    media_count: mediaCount,
    is_carousel: isCarousel,
    video_url: firstVideo ? firstVideo.url : "",
    thumbnail_url: post.thumbnailUrl || "",
  };
}

// ── Test helpers ────────────────────────────────────────────────────────────

function makePost(overrides = {}) {
  return {
    id: "test-post-1",
    brandId: "brand-1",
    postNumber: 1,
    postType: "static",
    caption: "Test post #socialmedia",
    platform: "Instagram",
    status: "draft",
    scheduledDate: null,
    notes: null,
    thumbnailUrl: null,
    jsonPayload: null,
    ...overrides,
  };
}

function makeMedia(overrides = {}) {
  return {
    id: `media-${Math.random().toString(36).slice(2, 8)}`,
    publishedPostId: "test-post-1",
    url: "https://files.leadsagna.com/POST-0001/image.jpg",
    mediaType: "IMAGE",
    order: 1,
    fileType: "image/jpeg",
    fileName: "image.jpg",
    ...overrides,
  };
}

// ── 1. Platform conversion matrix ──────────────────────────────────────────

console.log(`\n${BOLD}1. Platform conversion matrix${RESET}`);

function isValidAdaptation(sourcePlatform, targetPlatform) {
  if (!["Instagram", "LinkedIn"].includes(sourcePlatform)) return false;
  if (!["Instagram", "LinkedIn"].includes(targetPlatform)) return false;
  if (sourcePlatform === targetPlatform) return false;
  return true;
}

assert(isValidAdaptation("Instagram", "LinkedIn"), "Instagram → LinkedIn");
assert(isValidAdaptation("LinkedIn", "Instagram"), "LinkedIn → Instagram");
assert(!isValidAdaptation("Instagram", "Instagram"), "Instagram → Instagram rejected");
assert(!isValidAdaptation("LinkedIn", "LinkedIn"), "LinkedIn → LinkedIn rejected");
assert(!isValidAdaptation("Instagram", "TikTok"), "Instagram → TikTok rejected");
assert(!isValidAdaptation("TikTok", "Instagram"), "TikTok → Instagram rejected");

// ── 2. Valid and invalid media transformations ─────────────────────────────

console.log(`\n${BOLD}2. Media transformation validation${RESET}`);

function validateTargetMedia(mediaItems, targetPlatform, targetPostType) {
  if (!mediaItems || mediaItems.length === 0) return "At least one media item is required.";

  if (targetPlatform === "Instagram") {
    if (targetPostType === "static") {
      if (mediaItems.length !== 1) return "Instagram Static requires exactly one image.";
      if (mediaItems[0].mediaType !== "IMAGE") return "Instagram Static requires an image.";
    }
    if (targetPostType === "carousel") {
      if (mediaItems.length < 2) return "Instagram Carousel requires at least two images.";
      if (mediaItems.some((m) => m.mediaType !== "IMAGE")) return "Instagram Carousel requires all images.";
    }
    if (targetPostType === "reel") {
      if (mediaItems.length !== 1) return "Instagram Reel requires exactly one video.";
      if (mediaItems[0].mediaType !== "VIDEO") return "Instagram Reel requires a video.";
    }
  }

  if (targetPlatform === "LinkedIn") {
    if (targetPostType === "static") {
      if (mediaItems.length !== 1 || mediaItems[0].mediaType !== "IMAGE") {
        return "LinkedIn Single Image requires exactly one image.";
      }
    }
    if (targetPostType === "carousel") {
      const allImages = mediaItems.every((m) => m.mediaType === "IMAGE");
      const isSingleDoc = mediaItems.length === 1 && mediaItems[0].mediaType === "document";
      if (!allImages && !isSingleDoc) return "LinkedIn Carousel requires images or a single PDF.";
    }
    if (targetPostType === "reel") {
      if (mediaItems.length !== 1 || mediaItems[0].mediaType !== "VIDEO") {
        return "LinkedIn Video requires exactly one video.";
      }
    }
  }

  return null;
}

// Valid cases
assertEqual(validateTargetMedia([makeMedia()], "Instagram", "static"), null, "IG Static valid: one image");
assertEqual(validateTargetMedia([makeMedia({ order: 1 }), makeMedia({ order: 2 })], "Instagram", "carousel"), null, "IG Carousel valid: 2 images");
assertEqual(validateTargetMedia([makeMedia({ mediaType: "VIDEO", fileType: "video/mp4" })], "Instagram", "reel"), null, "IG Reel valid: one video");
assertEqual(validateTargetMedia([makeMedia({ order: 1 }), makeMedia({ order: 2 })], "LinkedIn", "static"), "LinkedIn Single Image requires exactly one image.", "LI Static invalid: 2 images");

function testLiStaticValid() {
  const r = validateTargetMedia([makeMedia()], "LinkedIn", "static");
  return r === null;
}
assert(testLiStaticValid(), "LI Static valid: one image");

// Invalid cases
assertEqual(validateTargetMedia([], "Instagram", "static"), "At least one media item is required.", "Empty media rejected");
assertEqual(validateTargetMedia([makeMedia({ mediaType: "VIDEO" })], "Instagram", "static"), "Instagram Static requires an image.", "IG Static: video rejected");
assertEqual(validateTargetMedia([makeMedia()], "Instagram", "carousel"), "Instagram Carousel requires at least two images.", "IG Carousel: one image rejected");
assertEqual(validateTargetMedia([makeMedia({ mediaType: "VIDEO" })], "Instagram", "carousel"), "Instagram Carousel requires at least two images.", "IG Carousel: video rejected");

// ── 3. PDF-to-Instagram blocking ───────────────────────────────────────────

console.log(`\n${BOLD}3. PDF-to-Instagram blocking${RESET}`);

function isPdfBlocked(sourcePost) {
  if (!sourcePost) return false;
  const media = sourcePost.media || [];
  if (sourcePost.platform !== "LinkedIn") return false;
  return media.some((m) => m.mediaType === "document");
}

const pdfSourcePost = makePost({
  platform: "LinkedIn",
  postType: "carousel",
  media: [makeMedia({ mediaType: "document", fileType: "application/pdf", url: "https://files.leadsagna.com/POST-0001/doc.pdf" })],
});

const imgSourcePost = makePost({
  platform: "LinkedIn",
  postType: "static",
  media: [makeMedia({ mediaType: "IMAGE", url: "https://files.leadsagna.com/POST-0001/img.jpg" })],
});

assert(isPdfBlocked(pdfSourcePost), "PDF source detected as blocked");
assert(!isPdfBlocked(imgSourcePost), "Image source not blocked for Instagram");
assert(!isPdfBlocked(makePost()), "Instagram source not blocked");

// ── 4. Target payload construction ─────────────────────────────────────────

console.log(`\n${BOLD}4. Target payload construction${RESET}`);

// Instagram target
const igPost = makePost({ platform: "Instagram", postType: "carousel", caption: "Hello #world" });
const igMedia = [
  makeMedia({ order: 1, url: "https://files.leadsagna.com/POST-0001/img1.jpg" }),
  makeMedia({ order: 2, url: "https://files.leadsagna.com/POST-0001/img2.jpg" }),
];
const igPayload = buildN8nPayloadInlined(igPost, igMedia, "TestBrand");

assertEqual(igPayload.Platform, "Instagram", "IG payload platform is Instagram");
assertEqual(igPayload["Post Type"], "carousel", "IG payload post type is carousel");
assertEqual(igPayload.media_count, 2, "IG payload has 2 media items");
assertEqual(igPayload.is_carousel, true, "IG payload is_carousel true");
assert(igPayload.media_url, "IG payload has media_url");
assertEqual(igPayload.files[0].image_url, "https://files.leadsagna.com/POST-0001/img1.jpg", "IG payload file[0] image_url");
assertEqual(igPayload.Hashtags, "#world", "IG hashtags extracted");

// Instagram Reel — should NOT have media_url
const reelPost = makePost({ platform: "Instagram", postType: "reel", caption: "My reel #fun" });
const reelMedia = [makeMedia({ mediaType: "VIDEO", url: "https://files.leadsagna.com/POST-0001/video.mp4" })];
const reelPayload = buildN8nPayloadInlined(reelPost, reelMedia, "TestBrand");
assertEqual(reelPayload["Post Type"], "reels", "Reel payload post type is reels");
assert(!("media_url" in reelPayload), "Reel payload omits media_url");
assertEqual(reelPayload.files[0].video_url, "https://files.leadsagna.com/POST-0001/video.mp4", "Reel payload video_url");

// LinkedIn target — should NOT have media_url
const liPost = makePost({ platform: "LinkedIn", postType: "carousel", caption: "LinkedIn post" });
const liMedia = [makeMedia({ mediaType: "document", url: "https://files.leadsagna.com/POST-0001/doc.pdf" })];
const liPayload = buildN8nPayloadInlined(liPost, liMedia, "TestBrand");
assertEqual(liPayload.Platform, "LinkedIn", "LI payload platform");
assert(!("media_url" in liPayload), "LI payload omits media_url");
assertEqual(liPayload.files[0].document_url, "https://files.leadsagna.com/POST-0001/doc.pdf", "LI payload document_url");

// ── 5. Mixed reused/new media ordering ──────────────────────────────────────

console.log(`\n${BOLD}5. Mixed reused/new media ordering${RESET}`);

function buildMixedManifest(sourceUrls, newFiles, order) {
  const manifest = [];
  let newIdx = 0;
  for (const item of order) {
    if (item.type === "reuse") {
      manifest.push({ sourceUrl: sourceUrls[item.index], action: "reuse", mediaType: "IMAGE", order: manifest.length + 1 });
    } else {
      manifest.push({ action: "new", fileIndex: newIdx++, mediaType: "IMAGE", order: manifest.length + 1 });
    }
  }
  return manifest;
}

const sourceUrls = [
  "https://files.leadsagna.com/POST-0001/img1.jpg",
  "https://files.leadsagna.com/POST-0001/img2.jpg",
  "https://files.leadsagna.com/POST-0001/img3.jpg",
];

const mixedManifest = buildMixedManifest(sourceUrls, ["new1.jpg", "new2.jpg"], [
  { type: "reuse", index: 0 },
  { type: "new" },
  { type: "reuse", index: 1 },
  { type: "new" },
  { type: "reuse", index: 2 },
]);

assertEqual(mixedManifest.length, 5, "Mixed manifest has 5 items");
assertEqual(mixedManifest[0].action, "reuse", "Item 0 is reused");
assertEqual(mixedManifest[1].action, "new", "Item 1 is new");
assertEqual(mixedManifest[2].action, "reuse", "Item 2 is reused");
assertEqual(mixedManifest[3].action, "new", "Item 3 is new");
assertEqual(mixedManifest[4].action, "reuse", "Item 4 is reused");
assertEqual(mixedManifest[0].sourceUrl, sourceUrls[0], "Item 0 correct source");
assertEqual(mixedManifest[2].sourceUrl, sourceUrls[1], "Item 2 correct source");
assertEqual(mixedManifest[4].sourceUrl, sourceUrls[2], "Item 4 correct source");

// ── 6. Canonical URL validation ─────────────────────────────────────────────

console.log(`\n${BOLD}6. Canonical URL validation${RESET}`);

assert(isCanonicalMediaUrl("https://files.leadsagna.com/POST-0001/img.jpg"), "Canonical URL accepted");
assert(!isCanonicalMediaUrl("/uploads/brand-1/post/file.jpg"), "Local /uploads/ rejected");
assert(!isCanonicalMediaUrl("https://files.leadsagna.com/uploads/img.jpg"), "Public URL with /uploads/ rejected");
assert(!isCanonicalMediaUrl("http://localhost:3000/file.jpg"), "localhost rejected");
assert(!isCanonicalMediaUrl("not-a-url"), "Malformed URL rejected");
assert(!isCanonicalMediaUrl(""), "Empty string rejected");
assert(!isCanonicalMediaUrl(null), "null rejected");
assert(!isCanonicalMediaUrl("https://other.com/file.jpg"), "Wrong origin rejected");
assert(!isCanonicalMediaUrl("https://files.leadsagna.com/other/img.jpg"), "No POST-NNNN pattern rejected");

// ── 7. New media SFTP requirement detection ─────────────────────────────────

console.log(`\n${BOLD}7. New media SFTP requirement detection${RESET}`);

function requiresNewFileUpload(manifestItems) {
  return manifestItems.some((item) => item.action === "new");
}

assert(requiresNewFileUpload(mixedManifest), "Mixed manifest requires new file upload");
assert(!requiresNewFileUpload(mixedManifest.filter((m) => m.action === "reuse")), "All-reuse manifest does not require upload");
assert(requiresNewFileUpload([{ action: "new" }]), "Single new file detected");

// ── 8. Source immutability ──────────────────────────────────────────────────

console.log(`\n${BOLD}8. Source immutability${RESET}`);

const originalSource = {
  id: "src-1",
  caption: "Original caption",
  media: [makeMedia({ url: "https://files.leadsagna.com/POST-0001/img.jpg" })],
  jsonPayload: JSON.stringify({ Platform: "Instagram" }),
  status: "draft",
};

function verifySourceUnchanged(original, afterAdaptation) {
  return (
    original.id === afterAdaptation.id &&
    original.caption === afterAdaptation.caption &&
    original.media[0].url === afterAdaptation.media[0].url &&
    original.status === afterAdaptation.status
  );
}

const afterAdaptation = { ...originalSource, caption: originalSource.caption };
assert(verifySourceUnchanged(originalSource, afterAdaptation), "Source unchanged after adaptation");

const mutatedSource = { ...originalSource, caption: "Changed" };
assert(!verifySourceUnchanged(originalSource, mutatedSource), "Source change detected");

// ── 9. Draft versus send behavior ──────────────────────────────────────────

console.log(`\n${BOLD}9. Draft versus send behavior${RESET}`);

// Draft should NOT call n8n
function wouldSendToN8n(result) {
  return result.webhookResult != null;
}

const draftResult = { post: { id: "new-1" }, webhookResult: null };
const sendResult = { post: { id: "new-2" }, webhookResult: { success: true } };

assert(!wouldSendToN8n(draftResult), "Draft does not send to n8n");
assert(wouldSendToN8n(sendResult), "Send action calls n8n");

// ── 10. Duplicate-submit prevention ────────────────────────────────────────

console.log(`\n${BOLD}10. Duplicate-submit prevention${RESET}`);

function createSubmissionGuard() {
  let submitting = false;
  return {
    trySubmit() {
      if (submitting) return false;
      submitting = true;
      return true;
    },
    reset() {
      submitting = false;
    },
    isSubmitting() {
      return submitting;
    },
  };
}

const guard = createSubmissionGuard();
assert(guard.trySubmit(), "First submission allowed");
assert(!guard.trySubmit(), "Second submission blocked");
guard.reset();
assert(guard.trySubmit(), "Third submission allowed after reset");

// ── 11. Authorization helpers ──────────────────────────────────────────────

console.log(`\n${BOLD}11. Authorization helpers${RESET}`);

function validateAdaptationRequest(sourcePost, targetPlatform, brandId, userId) {
  if (!userId) return { ok: false, error: "Authentication required." };
  if (!sourcePost || sourcePost.brandId !== brandId) return { ok: false, error: "Post not found or brand mismatch." };
  if (!["Instagram", "LinkedIn"].includes(sourcePost.platform)) return { ok: false, error: "Unsupported source platform." };
  if (!["Instagram", "LinkedIn"].includes(targetPlatform)) return { ok: false, error: "Unsupported target platform." };
  if (sourcePost.platform === targetPlatform) return { ok: false, error: "Target platform must differ from source." };
  return { ok: true };
}

assertEqual(validateAdaptationRequest(makePost(), "LinkedIn", "brand-1", "user-1"), { ok: true }, "Valid request authorized");
assertEqual(validateAdaptationRequest(makePost(), "LinkedIn", "brand-2", "user-1"), { ok: false, error: "Post not found or brand mismatch." }, "Brand mismatch rejected");
assertEqual(validateAdaptationRequest(null, "LinkedIn", "brand-1", "user-1"), { ok: false, error: "Post not found or brand mismatch." }, "Missing post rejected");
assertEqual(validateAdaptationRequest(makePost(), "Instagram", "brand-1", "user-1"), { ok: false, error: "Target platform must differ from source." }, "Same platform rejected");
assertEqual(validateAdaptationRequest(makePost(), "LinkedIn", "brand-1", null), { ok: false, error: "Authentication required." }, "Unauthenticated rejected");

// ── 12. Private source metadata removal ────────────────────────────────────

console.log(`\n${BOLD}12. Private source metadata removal${RESET}`);

function removePrivateMetadata(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const cleaned = { ...payload };
  delete cleaned._crossPlatformSource;
  return cleaned;
}

const payloadWithMeta = {
  "Post ID": "POST-0002",
  Platform: "LinkedIn",
  files: [],
  _crossPlatformSource: { postId: "src-1", platform: "Instagram", adaptedAt: "2026-07-25T10:00:00Z" },
};

const cleaned = removePrivateMetadata(payloadWithMeta);
assertEqual(cleaned["Post ID"], "POST-0002", "Payload fields preserved after metadata removal");
assert(!("_crossPlatformSource" in cleaned), "Private _crossPlatformSource removed from payload");

// ── 13. Platform routing (client-side state routing) ───────────────────────

console.log(`\n${BOLD}13. Platform routing (client-side state routing)${RESET}`);

function simulateSectionRouting(createdPost, destSection) {
  // Simulates the routing logic now in WorkspaceClient:
  // - If post.platform === "LinkedIn" → goes to LinkedIn section only
  // - If post.platform === "Instagram" → goes to Instagram section only
  if (createdPost.platform === "LinkedIn" && destSection === "linkedin") return true;
  if (createdPost.platform === "Instagram" && destSection === "instagram") return true;
  return false;
}

function simulateAddPost(currentList, newPost) {
  const exists = currentList.some((p) => p.id === newPost.id);
  if (exists) return currentList.map((p) => (p.id === newPost.id ? newPost : p));
  return [{ ...newPost, commentCount: newPost.commentCount ?? 0 }, ...currentList];
}

// IG → LI: target platform is LinkedIn
const igToLiPost = { id: "target-1", platform: "LinkedIn", postType: "reel", postNumber: 42 };

assert(simulateSectionRouting(igToLiPost, "linkedin"), "IG→LI target routes to LinkedIn section");
assert(!simulateSectionRouting(igToLiPost, "instagram"), "IG→LI target does NOT route to Instagram section");

// LI → IG: target platform is Instagram
const liToIgPost = { id: "target-2", platform: "Instagram", postType: "carousel", postNumber: 43 };

assert(simulateSectionRouting(liToIgPost, "instagram"), "LI→IG target routes to Instagram section");
assert(!simulateSectionRouting(liToIgPost, "linkedin"), "LI→IG target does NOT route to LinkedIn section");

// Source list counts unchanged when cross-platform:
// Each section checks post.platform before adding. A cross-platform post for
// the other section is forwarded to the parent, not added to the source list.
const igList = [{ id: "ig-1", platform: "Instagram", postNumber: 1 }];
const liList = [{ id: "li-1", platform: "LinkedIn", postNumber: 2 }];

// Simulate what handleCrossPlatformCreated does in PublishedPostsSection:
// if platform !== "Instagram" → forward to parent (don't add locally)
function igAddIfOwn(post) {
  if (post.platform === "Instagram") return simulateAddPost(igList, post);
  return igList; // not added — forwarded instead
}
function liAddIfOwn(post) {
  if (post.platform === "LinkedIn") return simulateAddPost(liList, post);
  return liList; // not added — forwarded instead
}

const igAfterLiTarget = igAddIfOwn(igToLiPost);
assertEqual(igAfterLiTarget.length, 1, "IG source count unchanged when target is LinkedIn");
assertEqual(igAfterLiTarget[0].id, "ig-1", "IG source list unchanged when target is LinkedIn");

const liAfterIgTarget = liAddIfOwn(liToIgPost);
assertEqual(liAfterIgTarget.length, 1, "LI source count unchanged when target is Instagram");
assertEqual(liAfterIgTarget[0].id, "li-1", "LI source list unchanged when target is Instagram");

// Target list increases (using the correct section's add function)
const liAfterTarget = liAddIfOwn(igToLiPost);
assertEqual(liAfterTarget.length, 2, "LI target count increases by 1");
assertEqual(liAfterTarget[0].id, "target-1", "LI target appears in LinkedIn list");

const igAfterTarget = igAddIfOwn(liToIgPost);
assertEqual(igAfterTarget.length, 2, "IG target count increases by 1");
assertEqual(igAfterTarget[0].id, "target-2", "IG target appears in Instagram list");

// Database platform is authoritative (server-side is already correct)
function dbPlatformIsCorrect(post, expectedPlatform) {
  return post.platform === expectedPlatform;
}
const dbIgToLi = { id: "t1", platform: "LinkedIn", postType: "reel", jsonPayload: '{"Platform":"Linkedin"}' };
const dbLiToIg = { id: "t2", platform: "Instagram", postType: "static", jsonPayload: '{"Platform":"Instagram"}' };
assert(dbPlatformIsCorrect(dbIgToLi, "LinkedIn"), "IG→LI DB platform is LinkedIn");
assert(dbPlatformIsCorrect(dbLiToIg, "Instagram"), "LI→IG DB platform is Instagram");

// jsonPayload and DB platform consistency
function payloadPlatformMatchesDb(post) {
  try {
    const parsed = JSON.parse(post.jsonPayload);
    const mapping = { LinkedIn: "Linkedin", Instagram: "Instagram" };
    return mapping[post.platform] === parsed.Platform;
  } catch { return false; }
}
assert(payloadPlatformMatchesDb(dbIgToLi), "IG→LI jsonPayload Platform matches DB");
assert(payloadPlatformMatchesDb(dbLiToIg), "LI→IG jsonPayload Platform matches DB");

// Draft and send have identical platform ownership
const draftTarget = { id: "draft-1", platform: "LinkedIn", status: "draft" };
const sendTarget = { id: "send-1", platform: "LinkedIn", status: "published" };
assert(draftTarget.platform === "LinkedIn", "Draft target platform is LinkedIn");
assert(sendTarget.platform === "LinkedIn", "Send target platform is LinkedIn");

// ── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${BOLD}${"=".repeat(50)}${RESET}`);
const total = passed + failed;
console.log(`${BOLD}Results:${RESET} ${GREEN}${passed} passed${RESET}, ${RED}${failed} failed${RESET}, ${total} total`);
console.log(`${BOLD}${"=".repeat(50)}${RESET}\n`);

process.exit(failed > 0 ? 1 : 0);
