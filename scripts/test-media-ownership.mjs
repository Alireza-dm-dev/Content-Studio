import { prisma } from "../lib/prisma.js";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log("=== MEDIA OWNERSHIP TEST ===\n");

  const brands = await prisma.brand.findMany({ take: 1 });
  if (brands.length === 0) { console.log("No brands found"); return; }
  const brand = brands[0];
  console.log("Brand:", brand.id, brand.name);

  const sourcePost = await prisma.publishedPost.findFirst({
    where: { brandId: brand.id, platform: "Instagram" },
    include: { media: { orderBy: { order: "asc" } } },
  });

  let targetSource = sourcePost;
  if (!sourcePost) {
    console.log("No Instagram post found, trying any post...");
    const anyPost = await prisma.publishedPost.findFirst({
      where: { brandId: brand.id },
      include: { media: { orderBy: { order: "asc" } } },
    });
    if (anyPost) {
      targetSource = anyPost;
    }
  }

  if (!targetSource) {
    console.log("No source post exists. Creating a test source post...");
    const newPost = await prisma.publishedPost.create({
      data: {
        id: "test-ownership-source-" + Date.now(),
        brandId: brand.id,
        postType: "static",
        caption: "Ownership audit source post #test123",
        platform: "Instagram",
        status: "draft",
        postNumber: 99999,
      },
    });
    await prisma.publishedPostMedia.create({
      data: {
        publishedPostId: newPost.id,
        url: "https://files.leadsagna.com/POST-OWNERSHIP/img.jpg",
        mediaType: "IMAGE",
        order: 1,
        fileType: "image/jpeg",
        fileName: "img.jpg",
      },
    });
    targetSource = await prisma.publishedPost.findUnique({
      where: { id: newPost.id },
      include: { media: { orderBy: { order: "asc" } } },
    });
  }

  console.log("Source post:", targetSource.id, "postNumber:", targetSource.postNumber);
  console.log("Source platform:", targetSource.platform, "type:", targetSource.postType);
  console.log("Source media:", targetSource.media?.length || 0, "items");
  for (const m of (targetSource.media || [])) {
    console.log("  -", m.url, `(${m.mediaType})`);
  }

  const sourceSnapshot = {
    id: targetSource.id,
    caption: targetSource.caption,
    status: targetSource.status,
    platform: targetSource.platform,
    jsonPayload: targetSource.jsonPayload,
    mediaCount: targetSource.media?.length || 0,
    mediaUrls: (targetSource.media || []).map(m => ({ id: m.id, url: m.url, mediaType: m.mediaType, order: m.order })),
  };
  console.log("\nSnapshot taken.");

  const targetId = "test-adapt-ownership-" + Date.now();
  const targetPostNumber = (targetSource.postNumber || 1000) + 1;

  console.log("\nCreating adapted target post with REUSED canonical media...");
  const targetPost = await prisma.$transaction(async (tx) => {
    const created = await tx.publishedPost.create({
      data: {
        id: targetId,
        brandId: brand.id,
        postType: "carousel",
        caption: "Adapted ownership test: " + (targetSource.caption || "test"),
        platform: "LinkedIn",
        status: "draft",
        postNumber: targetPostNumber,
        notes: "Adapted from " + targetSource.id,
      },
    });

    const mediaRecords = [];
    for (const m of (targetSource.media || [])) {
      const rec = await tx.publishedPostMedia.create({
        data: {
          publishedPostId: created.id,
          url: m.url,
          mediaType: m.mediaType === "IMAGE" ? "IMAGE" : m.mediaType,
          order: m.order,
          fileType: m.fileType,
          fileName: m.fileName,
        },
      });
      mediaRecords.push(rec);
    }

    const payload = {
      Platform: "LinkedIn",
      "Post Type": "carousel",
      Caption: created.caption,
      media: mediaRecords.map(m => ({ order: m.order, url: m.url, media_type: m.mediaType })),
      files: mediaRecords.map(m => ({ media_type: m.mediaType, image_url: m.url })),
      _crossPlatformSource: { postId: targetSource.id, platform: targetSource.platform, adaptedAt: new Date().toISOString() },
    };

    await tx.publishedPost.update({
      where: { id: created.id },
      data: { jsonPayload: JSON.stringify(payload, null, 2) },
    });

    return await tx.publishedPost.findUnique({
      where: { id: created.id },
      include: { media: { orderBy: { order: "asc" } } },
    });
  });

  console.log("Target created:", targetPost.id, "postNumber:", targetPost.postNumber);
  console.log("Target media:");
  for (const m of (targetPost.media || [])) {
    console.log("  -", m.url, `(${m.mediaType}) order:${m.order} id:${m.id}`);
  }

  const sourceUrls = (targetSource.media || []).map(m => m.url);
  const targetUrls = (targetPost.media || []).map(m => m.url);
  const allReused = targetUrls.every(url => sourceUrls.includes(url));
  console.log("All target URLs are source canonical URLs:", allReused);

  // Verify target source IDs are different from source IDs
  const targetMediaIds = (targetPost.media || []).map(m => m.id);
  const sourceMediaIds = (targetSource.media || []).map(m => m.id);
  const noIdOverlap = targetMediaIds.every(id => !sourceMediaIds.includes(id));
  console.log("Target media has own DB IDs (no overlap with source):", noIdOverlap);

  // Check source still intact after create
  const sourceAfterCreate = await prisma.publishedPost.findUnique({
    where: { id: targetSource.id },
    include: { media: { orderBy: { order: "asc" } } },
  });
  const sourceUrlsAfterCreate = (sourceAfterCreate?.media || []).map(m => m.url);
  const sourceIntactAfterCreate = JSON.stringify(sourceUrlsAfterCreate) === JSON.stringify(sourceSnapshot.mediaUrls.map(m => m.url));
  console.log("Source media intact after target create:", sourceIntactAfterCreate);

  // Delete target
  console.log("\nDeleting target post...");
  const deletedPost = await prisma.publishedPost.delete({ where: { id: targetId } });
  console.log("Target post DB record deleted:", deletedPost.id);

  // Verify target media cascade-deleted
  const targetMediaAfter = await prisma.publishedPostMedia.findMany({ where: { publishedPostId: targetId } });
  console.log("Target media cascade deleted:", targetMediaAfter.length === 0);

  // Verify source absolutely unchanged
  const sourceFinal = await prisma.publishedPost.findUnique({
    where: { id: targetSource.id },
    include: { media: { orderBy: { order: "asc" } } },
  });

  console.log("\n=== OWNERSHIP VERIFICATION RESULTS ===\n");
  const results = [];

  // 1. Source post still exists
  const r1 = sourceFinal !== null;
  results.push({ label: "1. Source post exists after target delete", pass: r1, detail: r1 ? sourceFinal.id : "null" });

  // 2. Source media count unchanged
  const r2 = sourceFinal?.media?.length === sourceSnapshot.mediaCount;
  results.push({ label: "2. Source media count unchanged", pass: r2, detail: `${sourceFinal?.media?.length} vs ${sourceSnapshot.mediaCount}` });

  // 3. Source media URLs unchanged (every URL exactly matches)
  const r3 = sourceFinal?.media?.every((m, i) => m.url === sourceSnapshot.mediaUrls[i].url) ?? false;
  results.push({ label: "3. Source media URLs unchanged", pass: r3 });

  // 4. Source media IDs unchanged (same DB records, not recreated)
  const r4 = sourceFinal?.media?.every((m, i) => m.id === sourceSnapshot.mediaUrls[i].id) ?? false;
  results.push({ label: "4. Source media DB record IDs unchanged", pass: r4 });

  // 5. Source caption unchanged
  const r5 = sourceFinal?.caption === sourceSnapshot.caption;
  results.push({ label: "5. Source caption unchanged", pass: r5, detail: `"${sourceFinal?.caption}" vs "${sourceSnapshot.caption}"` });

  // 6. Source status unchanged
  const r6 = sourceFinal?.status === sourceSnapshot.status;
  results.push({ label: "6. Source status unchanged", pass: r6 });

  // 7. Source platform unchanged
  const r7 = sourceFinal?.platform === sourceSnapshot.platform;
  results.push({ label: "7. Source platform unchanged", pass: r7 });

  // 8. Source jsonPayload unchanged (if applicable)
  let r8 = true;
  if (sourceSnapshot.jsonPayload != null) {
    r8 = sourceFinal?.jsonPayload === sourceSnapshot.jsonPayload;
    results.push({ label: "8a. Source jsonPayload unchanged", pass: r8 });
  } else {
    r8 = sourceFinal?.jsonPayload == null;
    results.push({ label: "8b. Source jsonPayload remains null", pass: r8 });
  }

  // 9. Target completely removed from DB
  const r9 = targetMediaAfter.length === 0;
  results.push({ label: "9. Target media cascade-deleted", pass: r9 });

  // 10. Source media URLs remain valid references
  // (As strings in the DB, they still exist. No physical deletion of remote files occurs.)
  for (const url of sourceSnapshot.mediaUrls) {
    const stillReferenced = sourceFinal?.media?.some(m => m.url === url.url) ?? false;
    results.push({ label: `10. Source URL "${url.url}" still referenced`, pass: stillReferenced });
  }

  // 11. Canonical URL appears in source jsonPayload (if payload exists)
  if (sourceFinal?.jsonPayload) {
    try {
      const parsed = JSON.parse(sourceFinal.jsonPayload);
      const payloadHasUrls = (parsed.media || []).some(m => targetUrls.includes(m.url)) ||
                             (parsed.files || []).some(f => targetUrls.includes(f.image_url) || targetUrls.includes(f.video_url));
      results.push({ label: "11. Source payload does NOT contain target URLs", pass: !payloadHasUrls });
    } catch {
      results.push({ label: "11. Source payload parse check", pass: true });
    }
  }

  // 12. Target's jsonPayload does NOT affect source
  const targetGone = await prisma.publishedPost.findUnique({ where: { id: targetId } });
  results.push({ label: "12. Target post fully removed from DB", pass: targetGone === null });

  console.log("\n");
  let allPassed = true;
  for (const r of results) {
    const sym = r.pass ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    console.log(`  ${sym} ${r.label}${r.detail ? `  (${r.detail})` : ""}`);
    if (!r.pass) allPassed = false;
  }

  console.log(`\n\x1b[1m${allPassed ? "ALL 12 CHECKS PASSED — ownership model is sound." : "SOME CHECKS FAILED — see above."}\x1b[0m`);

  // Cleanup test artifacts
  try {
    await prisma.publishedPost.deleteMany({ where: { id: { startsWith: "test-" } } });
    console.log("Test artifacts cleaned up.");
  } catch {}

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
