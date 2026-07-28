#!/usr/bin/env node

const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");

const dbPath = path.join(__dirname, "..", "dev.db");
const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

// Column `order` is a reserved word in SQL — quote it in SQL statements.
const Q = '"';

async function main() {
  console.log("=== MEDIA OWNERSHIP REAL DB TEST ===\n");

  // 1. Find brand
  const brand = db.prepare("SELECT id, name FROM Brand LIMIT 1").get();
  if (!brand) {
    console.log("FAIL: No brand found.");
    process.exit(1);
  }
  console.log("Brand:", brand.id, brand.name);

  // 2. Find or create source post with media
  let sourcePost = db.prepare(
    "SELECT id, caption, platform, postType, status, postNumber, jsonPayload FROM PublishedPost WHERE platform = 'Instagram' AND id NOT LIKE 'test-%' LIMIT 1"
  ).get();

  if (!sourcePost) {
    sourcePost = db.prepare(
      "SELECT id, caption, platform, postType, status, postNumber, jsonPayload FROM PublishedPost WHERE id NOT LIKE 'test-%' LIMIT 1"
    ).get();
  }

  if (!sourcePost) {
    console.log("Creating test source post...");
    const sourceId = "test-ownership-source-" + Date.now();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO PublishedPost (id, brandId, postType, caption, platform, status, postNumber, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(sourceId, brand.id, "static", "Ownership audit source #test123", "Instagram", "draft", 99999, now, now);

    db.prepare(
      `INSERT INTO PublishedPostMedia (id, publishedPostId, url, mediaType, ${Q}order${Q}, fileType, fileName, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(crypto.randomUUID(), sourceId, "https://files.leadsagna.com/POST-TEST/img.jpg", "IMAGE", 1, "image/jpeg", "img.jpg", now);

    sourcePost = db.prepare("SELECT id, caption, platform, postType, status, postNumber, jsonPayload FROM PublishedPost WHERE id = ?").get(sourceId);
  }

  const sourceMedia = db.prepare(
    `SELECT id, url, mediaType, ${Q}order${Q} AS ord, fileType, fileName FROM PublishedPostMedia WHERE publishedPostId = ? ORDER BY ${Q}order${Q} ASC`
  ).all(sourcePost.id);

  console.log("Source post:", sourcePost.id, "num:", sourcePost.postNumber);
  console.log("Source media count:", sourceMedia.length);
  for (const m of sourceMedia) {
    console.log(`  [${m.id}] url="${m.url}" type=${m.mediaType} order=${m.ord}`);
  }

  // Snapshot source
  const sourceSnapshot = {
    id: sourcePost.id,
    caption: sourcePost.caption,
    status: sourcePost.status,
    platform: sourcePost.platform,
    jsonPayload: sourcePost.jsonPayload,
    mediaCount: sourceMedia.length,
    mediaRows: sourceMedia.map(m => ({ id: m.id, url: m.url, mediaType: m.mediaType, ord: m.ord })),
  };

  // 3. Create adapted target with reused canonical URLs
  const targetId = "test-ownership-target-" + Date.now();
  const targetPostNumber = (sourcePost.postNumber || 1000) + 1;
  const now = new Date().toISOString();

  console.log("\n--- Creating adapted target (reusing source canonical URLs) ---");
  db.prepare(
    "INSERT INTO PublishedPost (id, brandId, postType, caption, platform, status, postNumber, notes, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    targetId, brand.id, "carousel",
    "Adapted: " + (sourcePost.caption || "test"),
    "LinkedIn", "draft", targetPostNumber,
    "Adapted from " + sourcePost.id, now, now
  );

  for (const m of sourceMedia) {
    db.prepare(
      `INSERT INTO PublishedPostMedia (id, publishedPostId, url, mediaType, ${Q}order${Q}, fileType, fileName, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(crypto.randomUUID(), targetId, m.url, m.mediaType === "IMAGE" ? "IMAGE" : m.mediaType, m.ord, m.fileType, m.fileName, now);
  }

  const targetMedia = db.prepare(
    `SELECT id, url, mediaType, ${Q}order${Q} AS ord FROM PublishedPostMedia WHERE publishedPostId = ? ORDER BY ${Q}order${Q} ASC`
  ).all(targetId);

  const payload = {
    Platform: "LinkedIn",
    "Post Type": "carousel",
    Caption: "Adapted: " + (sourcePost.caption || "test"),
    media: targetMedia.map(m => ({ order: m.ord, url: m.url, media_type: m.mediaType })),
    files: targetMedia.map(m => ({ media_type: m.mediaType, image_url: m.url })),
    _crossPlatformSource: { postId: sourcePost.id, platform: sourcePost.platform, adaptedAt: now },
  };
  db.prepare("UPDATE PublishedPost SET jsonPayload = ? WHERE id = ?").run(JSON.stringify(payload, null, 2), targetId);

  console.log("Target created:", targetId);
  for (const m of targetMedia) {
    console.log(`  [${m.id}] url="${m.url}" type=${m.mediaType} order=${m.ord}`);
  }

  const sourceUrls = sourceMedia.map(m => m.url);
  const targetUrls = targetMedia.map(m => m.url);
  const allReused = targetUrls.every(url => sourceUrls.includes(url));
  console.log("All target URLs are source URLs:", allReused);

  const targetMediaIds = targetMedia.map(m => m.id);
  const sourceMediaIds = sourceMedia.map(m => m.id);
  const noIdOverlap = targetMediaIds.every(id => !sourceMediaIds.includes(id));
  console.log("Target has own DB record IDs:", noIdOverlap);

  // 4. DELETE target
  console.log("\n--- Deleting target ---");
  db.prepare("DELETE FROM PublishedPost WHERE id = ?").run(targetId);

  // 5. Verify source
  console.log("\n=== VERIFICATION ===\n");
  const sourceFinal = db.prepare(
    "SELECT id, caption, platform, postType, status, postNumber, jsonPayload FROM PublishedPost WHERE id = ?"
  ).get(sourcePost.id);

  const sourceMediaFinal = db.prepare(
    `SELECT id, url, mediaType, ${Q}order${Q} AS ord, fileType, fileName FROM PublishedPostMedia WHERE publishedPostId = ? ORDER BY ${Q}order${Q} ASC`
  ).all(sourcePost.id);

  const checks = [];
  checks.push({ label: "1. Source post exists after target delete", pass: sourceFinal !== null });
  checks.push({ label: "2. Source media count unchanged", pass: sourceMediaFinal.length === sourceSnapshot.mediaCount, detail: `${sourceMediaFinal.length} vs ${sourceSnapshot.mediaCount}` });
  checks.push({ label: "3. Source media URLs unchanged", pass: sourceMediaFinal.every((m, i) => m.url === sourceSnapshot.mediaRows[i].url) });
  checks.push({ label: "4. Source media DB record IDs unchanged", pass: sourceMediaFinal.every((m, i) => m.id === sourceSnapshot.mediaRows[i].id) });
  checks.push({ label: "5. Source caption unchanged", pass: sourceFinal?.caption === sourceSnapshot.caption });
  checks.push({ label: "6. Source status unchanged", pass: sourceFinal?.status === sourceSnapshot.status });
  checks.push({ label: "7. Source platform unchanged", pass: sourceFinal?.platform === sourceSnapshot.platform });

  if (sourceSnapshot.jsonPayload != null) {
    checks.push({ label: "8a. Source jsonPayload unchanged", pass: sourceFinal?.jsonPayload === sourceSnapshot.jsonPayload });
  } else {
    checks.push({ label: "8b. Source jsonPayload still null", pass: sourceFinal?.jsonPayload == null });
  }

  const targetFinal = db.prepare("SELECT id FROM PublishedPost WHERE id = ?").get(targetId);
  checks.push({ label: "9. Target removed from DB", pass: targetFinal == null });

  const targetMediaFinal = db.prepare("SELECT id FROM PublishedPostMedia WHERE publishedPostId = ?").all(targetId);
  checks.push({ label: "10. Target media cascade-deleted", pass: targetMediaFinal.length === 0 });

  for (const sm of sourceSnapshot.mediaRows) {
    const stillThere = sourceMediaFinal.some(m => m.url === sm.url);
    checks.push({ label: `11. URL "${sm.url}" still in source media`, pass: stillThere });
  }

  if (sourceFinal?.jsonPayload) {
    try {
      const parsed = JSON.parse(sourceFinal.jsonPayload);
      checks.push({ label: "12. Source payload has no _crossPlatformSource", pass: !parsed._crossPlatformSource });
    } catch { /* not applicable */ }
  }

  let allPassed = true;
  for (const c of checks) {
    const sym = c.pass ? "\x1b[32m\u2713\x1b[0m" : "\x1b[31m\u2717\x1b[0m";
    console.log(`  ${sym} ${c.label}${c.detail ? "  (" + c.detail + ")" : ""}`);
    if (!c.pass) allPassed = false;
  }

  console.log(`\n\x1b[1m${allPassed ? "ALL CHECKS PASSED \u2014 ownership model is sound." : "SOME CHECKS FAILED \u2014 see above."}\x1b[0m`);

  // Cleanup test artifacts
  db.prepare("DELETE FROM PublishedPostComment WHERE publishedPostId LIKE 'test-%'").run();
  db.prepare("DELETE FROM PublishedPostMedia WHERE publishedPostId LIKE 'test-%'").run();
  db.prepare("DELETE FROM PublishedPost WHERE id LIKE 'test-%'").run();
  console.log("\nTest artifacts cleaned up.");

  db.close();
  process.exit(allPassed ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
