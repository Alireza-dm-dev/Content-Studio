// Regression tests for the shared published-post read-time normalizer.
//
// Background: PublishedPostMedia rows permanently store the LOCAL upload path
// (/uploads/...). The public URL produced by the SFTP upload is persisted only
// inside the post's jsonPayload. Before serializePublishedPost() existed, the
// Brand Workspace list API returned the raw rows, so the Instagram grid tried
// to render local paths that do not exist on the deployed host — every card
// showed broken media until the user opened the post and saved it, because the
// PATCH response happened to run buildRemoteAwareMedia() and returned public
// URLs. These tests lock in that every read path emits the same shape and that
// no edit is needed for a post to render.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  serializePublishedPost,
  serializePublishedPosts,
  buildRemoteAwareMedia,
  resolveCanonicalMediaUrl,
  buildN8nPayload,
} from "@/lib/published-post-utils";

const CDN = "https://files.leadsagna.com";

// ─── Fixtures modelled on real persisted records ───────────────────────────────

// Legacy Instagram single-image post: media row holds the local path, the
// payload holds the public URL. Copied from the shape stored by POST /published-posts.
function legacyInstagramImagePost() {
  const publicUrl = `${CDN}/POST-0004/image_POST-0004_1_1785066071733_9.jpg`;
  return {
    id: "a1c1496b-2343-4ead-9e32-c0bf76615bd5",
    brandId: "brand-1",
    postNumber: 4,
    platform: "Instagram",
    postType: "static",
    status: "draft",
    caption: "Secure your site with a survey booked this week. #CCTV",
    notes: null,
    scheduledDate: null,
    thumbnailUrl: null,
    media: [
      {
        id: "m1",
        order: 1,
        mediaType: "IMAGE",
        fileName: "hero.jpg",
        fileType: "image/jpeg",
        url: "/uploads/brand-1/published-posts/a1c1496b/hero.jpg",
      },
    ],
    jsonPayload: JSON.stringify({
      brand: "CUCCTV",
      "Post ID": "POST-0004",
      Platform: "Instagram",
      "Post Type": "single_image",
      Caption: "Secure your site with a survey booked this week. #CCTV",
      media_url: publicUrl,
      files: [{ media_type: "IMAGE", image_url: publicUrl }],
      media: [{ order: 1, url: publicUrl, media_type: "IMAGE" }],
      media_count: 1,
      is_carousel: false,
      video_url: "",
      thumbnail_url: "",
    }),
    _count: { comments: 3 },
    expectedUrl: publicUrl,
  };
}

// Legacy Instagram reel: payload carries video_url + files[].video_url.
function legacyInstagramVideoPost() {
  const publicUrl = `${CDN}/POST-0002/video_POST-0002_1_1785066071733_9.mp4`;
  return {
    id: "1d4d7b3f-641a-438d-bd25-48be64f6501f",
    brandId: "brand-1",
    postNumber: 2,
    platform: "Instagram",
    postType: "reel",
    status: "draft",
    caption: "Join us for the workshop on August 14th. #CUCCTV #Workshop",
    thumbnailUrl: "/uploads/brand-1/published-posts/1d4d7b3f/thumbnail.jpg",
    media: [
      {
        id: "m1",
        order: 1,
        mediaType: "VIDEO",
        fileName: "reel.mp4",
        fileType: "video/mp4",
        url: "/uploads/brand-1/published-posts/1d4d7b3f/reel.mp4",
      },
    ],
    jsonPayload: JSON.stringify({
      "Post ID": "POST-0002",
      Platform: "Instagram",
      "Post Type": "reels",
      Caption: "Join us for the workshop on August 14th. #CUCCTV #Workshop",
      files: [{ media_type: "VIDEO", video_url: publicUrl }],
      media: [{ order: 1, url: publicUrl, media_type: "VIDEO" }],
      media_count: 1,
      is_carousel: false,
      video_url: publicUrl,
      thumbnail_url: `${CDN}/POST-0002/thumbnail_POST-0002_1_1785066071733_9.jpg`,
    }),
    _count: { comments: 0 },
    expectedUrl: publicUrl,
    expectedThumb: `${CDN}/POST-0002/thumbnail_POST-0002_1_1785066071733_9.jpg`,
  };
}

function legacyLinkedInPdfPost() {
  const publicUrl = `${CDN}/POST-0012/document_POST-0012_1_1785752061179_5705.pdf`;
  return {
    id: "b5c05390-e4bd-40a9-b511-e8323f5738eb",
    brandId: "brand-1",
    postNumber: 12,
    platform: "LinkedIn",
    postType: "carousel",
    status: "draft",
    caption: "Our 2026 security guide is out now.",
    thumbnailUrl: null,
    media: [
      {
        id: "m1",
        order: 1,
        mediaType: "document",
        fileName: "guide.pdf",
        fileType: "application/pdf",
        url: "/uploads/brand-1/published-posts/b5c05390/guide.pdf",
      },
    ],
    jsonPayload: JSON.stringify({
      "Post ID": "POST-0012",
      Platform: "LinkedIn",
      "Post Type": "carousel",
      Caption: "Our 2026 security guide is out now.",
      files: [{ media_type: "document", document_url: publicUrl }],
      media: [{ order: 1, url: publicUrl, media_type: "document" }],
      media_count: 1,
      is_carousel: true,
      video_url: "",
      thumbnail_url: "",
    }),
    _count: { comments: 1 },
    expectedUrl: publicUrl,
  };
}

// A newly created post, as the POST route hands it back: media rows already
// carry the remote URL in memory and the payload was rebuilt with it.
function newInstagramImagePost() {
  const publicUrl = `${CDN}/POST-0021/image_POST-0021_1_1790000000000_11.png`;
  return {
    id: "new-image",
    brandId: "brand-1",
    postNumber: 21,
    platform: "Instagram",
    postType: "static",
    status: "draft",
    caption: "Fresh upload.",
    thumbnailUrl: null,
    media: [
      { id: "m1", order: 1, mediaType: "IMAGE", url: publicUrl, remoteUrl: publicUrl },
    ],
    jsonPayload: JSON.stringify({
      media_url: publicUrl,
      files: [{ media_type: "IMAGE", image_url: publicUrl }],
      media: [{ order: 1, url: publicUrl, media_type: "IMAGE" }],
      thumbnail_url: "",
    }),
    expectedUrl: publicUrl,
  };
}

function newInstagramVideoPost() {
  const publicUrl = `${CDN}/POST-0022/video_POST-0022_1_1790000000000_12.mp4`;
  return {
    id: "new-video",
    brandId: "brand-1",
    postNumber: 22,
    platform: "Instagram",
    postType: "reel",
    status: "draft",
    caption: "Fresh reel.",
    thumbnailUrl: null,
    media: [
      { id: "m1", order: 1, mediaType: "VIDEO", url: publicUrl, remoteUrl: publicUrl },
    ],
    jsonPayload: JSON.stringify({
      files: [{ media_type: "VIDEO", video_url: publicUrl }],
      media: [{ order: 1, url: publicUrl, media_type: "VIDEO" }],
      video_url: publicUrl,
      thumbnail_url: "",
    }),
    expectedUrl: publicUrl,
  };
}

// ─── 1. Legacy Instagram image post renders on the first list load ─────────────

test("legacy Instagram image post exposes the public URL on the initial list load", () => {
  const post = legacyInstagramImagePost();
  const [serialized] = serializePublishedPosts([post]);

  // This is exactly what the grid card reads.
  assert.equal(serialized.media[0].url, post.expectedUrl);
  assert.equal(serialized.media[0].mediaType, "IMAGE");
  assert.equal(serialized.imageUrl, post.expectedUrl);
  assert.equal(serialized.posterUrl, post.expectedUrl);
  // The local path is preserved alongside, never as the render URL.
  assert.equal(
    serialized.media[0].localUrl,
    "/uploads/brand-1/published-posts/a1c1496b/hero.jpg",
  );
  assert.equal(serialized.media[0].isCanonicalUrl, true);
});

// ─── 2. Legacy Instagram video post renders on the first list load ─────────────

test("legacy Instagram video post exposes the public video and thumbnail URLs", () => {
  const post = legacyInstagramVideoPost();
  const [serialized] = serializePublishedPosts([post]);

  assert.equal(serialized.media[0].url, post.expectedUrl);
  assert.equal(serialized.videoUrl, post.expectedUrl);
  // The DB thumbnail column still holds a local path; the payload wins.
  assert.equal(serialized.thumbnailUrl, post.expectedThumb);
  assert.equal(serialized.posterUrl, post.expectedThumb);
});

// ─── 3 & 4. Newly uploaded posts ───────────────────────────────────────────────

test("new Instagram image post serializes to a renderable public URL", () => {
  const post = newInstagramImagePost();
  const serialized = serializePublishedPost(post);
  assert.equal(serialized.media[0].url, post.expectedUrl);
  assert.equal(serialized.imageUrl, post.expectedUrl);
  assert.equal(serialized.videoUrl, null);
});

test("new Instagram video post serializes to a renderable public URL", () => {
  const post = newInstagramVideoPost();
  const serialized = serializePublishedPost(post);
  assert.equal(serialized.media[0].url, post.expectedUrl);
  assert.equal(serialized.videoUrl, post.expectedUrl);
  assert.equal(serialized.imageUrl, null);
});

// ─── 5. List and single-item responses agree ───────────────────────────────────

test("list and single-item responses expose an identical media shape", () => {
  for (const build of [
    legacyInstagramImagePost,
    legacyInstagramVideoPost,
    legacyLinkedInPdfPost,
  ]) {
    // The list route maps over rows; the single-item route serializes one row.
    const [fromList] = serializePublishedPosts([build()]);
    const fromItem = serializePublishedPost(build());

    assert.deepEqual(fromList.media, fromItem.media);
    assert.equal(fromList.thumbnailUrl, fromItem.thumbnailUrl);
    assert.equal(fromList.imageUrl, fromItem.imageUrl);
    assert.equal(fromList.videoUrl, fromItem.videoUrl);
    assert.equal(fromList.documentUrl, fromItem.documentUrl);
    assert.equal(fromList.platform, fromItem.platform);
    assert.equal(fromList.postType, fromItem.postType);
  }
});

// ─── 6. No edit/save is required for rendering ─────────────────────────────────

test("a caption-only edit does not change any media URL the card renders", () => {
  const post = legacyInstagramImagePost();

  // What the Brand Workspace shows on a cold page load.
  const onLoad = serializePublishedPost(post);

  // What the PATCH route produces: rebuilt payload + remote-aware media, run
  // through the very same serializer.
  const payload = JSON.parse(post.jsonPayload);
  const remoteAwareMedia = buildRemoteAwareMedia(post.media, payload);
  const updated = { ...post, caption: "Edited caption." };
  const rebuiltPayload = buildN8nPayload(updated, remoteAwareMedia, "CUCCTV");
  const afterEdit = serializePublishedPost({
    ...updated,
    jsonPayload: JSON.stringify(rebuiltPayload, null, 2),
    media: remoteAwareMedia,
    _count: post._count,
  });

  assert.equal(afterEdit.media[0].url, onLoad.media[0].url);
  assert.equal(afterEdit.imageUrl, onLoad.imageUrl);
  assert.equal(afterEdit.videoUrl, onLoad.videoUrl);
  assert.equal(afterEdit.thumbnailUrl, onLoad.thumbnailUrl);
  assert.equal(afterEdit.caption, "Edited caption.");
});

test("a reel survives a caption-only edit with the same media and thumbnail", () => {
  const post = legacyInstagramVideoPost();
  const onLoad = serializePublishedPost(post);

  const payload = JSON.parse(post.jsonPayload);
  const remoteAwareMedia = buildRemoteAwareMedia(post.media, payload);
  const updated = { ...post, caption: "Edited reel caption." };
  const rebuiltPayload = buildN8nPayload(
    { ...updated, thumbnailUrl: payload.thumbnail_url },
    remoteAwareMedia,
    "CUCCTV",
  );
  const afterEdit = serializePublishedPost({
    ...updated,
    jsonPayload: JSON.stringify(rebuiltPayload, null, 2),
    media: remoteAwareMedia,
  });

  assert.equal(afterEdit.media[0].url, onLoad.media[0].url);
  assert.equal(afterEdit.videoUrl, onLoad.videoUrl);
  assert.equal(afterEdit.thumbnailUrl, onLoad.thumbnailUrl);
});

// ─── 7. LinkedIn is not regressed ──────────────────────────────────────────────

test("LinkedIn PDF post keeps its document URL and canonical platform casing", () => {
  const post = legacyLinkedInPdfPost();
  const serialized = serializePublishedPost(post);

  assert.equal(serialized.platform, "LinkedIn");
  assert.equal(serialized.postType, "carousel");
  assert.equal(serialized.media[0].url, post.expectedUrl);
  assert.equal(serialized.media[0].mediaType, "document");
  assert.equal(serialized.documentUrl, post.expectedUrl);
  assert.equal(serialized.imageUrl, null);
  assert.equal(serialized.videoUrl, null);
});

test("LinkedIn platform casing variants normalize to LinkedIn", () => {
  for (const raw of ["LinkedIn", "Linkedin", "linkedin", "LINKEDIN"]) {
    const serialized = serializePublishedPost({
      ...legacyLinkedInPdfPost(),
      platform: raw,
    });
    assert.equal(serialized.platform, "LinkedIn");
  }
});

test("LinkedIn video post exposes its public video URL", () => {
  const publicUrl = `${CDN}/POST-0013/video_POST-0013_1_1785752061179_9.mp4`;
  const serialized = serializePublishedPost({
    id: "li-video",
    platform: "LinkedIn",
    postType: "reel",
    caption: "Behind the scenes.",
    thumbnailUrl: null,
    media: [
      {
        id: "m1",
        order: 1,
        mediaType: "VIDEO",
        url: "/uploads/brand-1/published-posts/li-video/clip.mp4",
      },
    ],
    jsonPayload: JSON.stringify({
      files: [{ media_type: "VIDEO", video_url: publicUrl }],
      media: [{ order: 1, url: publicUrl, media_type: "VIDEO" }],
      video_url: publicUrl,
    }),
  });

  assert.equal(serialized.platform, "LinkedIn");
  assert.equal(serialized.media[0].url, publicUrl);
  assert.equal(serialized.videoUrl, publicUrl);
});

// ─── 8. Captions still render ──────────────────────────────────────────────────

test("caption, notes and comment count survive serialization", () => {
  const post = legacyInstagramImagePost();
  const serialized = serializePublishedPost(post);

  assert.equal(
    serialized.caption,
    "Secure your site with a survey booked this week. #CCTV",
  );
  assert.equal(serialized.commentCount, 3);
  assert.equal(serialized.postNumber, 4);
  assert.equal(serialized.status, "draft");
  // _count is an internal Prisma artifact and must not leak.
  assert.equal("_count" in serialized, false);
});

test("a post with a caption but no usable public URL keeps the local path", () => {
  // Matches records whose SFTP upload failed: the payload only ever held local
  // paths. Read-time normalization must not blank the media out.
  const localUrl = "/uploads/brand-1/published-posts/e998b93b/clip.mp4";
  const serialized = serializePublishedPost({
    id: "e998b93b",
    platform: "Instagram",
    postType: "reel",
    caption: "Turn three days into a skill for life.",
    thumbnailUrl: null,
    media: [{ id: "m1", order: 1, mediaType: "VIDEO", url: localUrl }],
    jsonPayload: JSON.stringify({
      files: [{ media_type: "VIDEO", video_url: localUrl }],
      media: [{ order: 1, url: localUrl, media_type: "VIDEO" }],
      video_url: localUrl,
    }),
  });

  assert.equal(serialized.media[0].url, localUrl);
  assert.equal(serialized.media[0].isCanonicalUrl, false);
  assert.equal(serialized.media[0].remoteUrl, null);
  assert.equal(serialized.caption, "Turn three days into a skill for life.");
});

// ─── Carousels, ordering, and payload-shape fallbacks ──────────────────────────

test("carousel media is ordered and each item resolves to its own public URL", () => {
  const urls = [1, 2, 3].map(
    (i) => `${CDN}/POST-0009/image_POST-0009_${i}_1785066071733_${i}.jpg`,
  );
  const serialized = serializePublishedPost({
    id: "carousel",
    platform: "Instagram",
    postType: "carousel",
    caption: "Three ways to secure a yard.",
    media: [
      { id: "m3", order: 3, mediaType: "IMAGE", url: "/uploads/b/c/3.jpg" },
      { id: "m1", order: 1, mediaType: "IMAGE", url: "/uploads/b/c/1.jpg" },
      { id: "m2", order: 2, mediaType: "IMAGE", url: "/uploads/b/c/2.jpg" },
    ],
    jsonPayload: JSON.stringify({
      files: urls.map((u) => ({ media_type: "IMAGE", image_url: u })),
      media: urls.map((u, i) => ({ order: i + 1, url: u, media_type: "IMAGE" })),
    }),
  });

  assert.deepEqual(
    serialized.media.map((m) => m.order),
    [1, 2, 3],
  );
  assert.deepEqual(
    serialized.media.map((m) => m.url),
    urls,
  );
  assert.equal(serialized.mediaCount, 3);
});

test("resolveCanonicalMediaUrl falls back through media[], files[] and top-level", () => {
  const url = `${CDN}/POST-0001/image_POST-0001_1_1785066071733_1.jpg`;
  const row = { order: 1, mediaType: "IMAGE", url: "/uploads/a/b.jpg" };

  // media[] by order
  assert.equal(
    resolveCanonicalMediaUrl(row, 0, { media: [{ order: 1, url }] }),
    url,
  );
  // media[] by position when order is missing (legacy payload)
  assert.equal(resolveCanonicalMediaUrl(row, 0, { media: [{ url }] }), url);
  // files[] by position
  assert.equal(
    resolveCanonicalMediaUrl(row, 0, { files: [{ image_url: url }] }),
    url,
  );
  // oldest shape: a single top-level media_url
  assert.equal(resolveCanonicalMediaUrl(row, 0, { media_url: url }), url);
  // nothing usable
  assert.equal(resolveCanonicalMediaUrl(row, 0, null), null);
  assert.equal(
    resolveCanonicalMediaUrl(row, 0, { media: [{ order: 1, url: "/uploads/a/b.jpg" }] }),
    null,
  );
});

test("a fabricated /uploads URL on the public host is never treated as canonical", () => {
  const spoofed = `${CDN}/uploads/brand-1/published-posts/x/hero.jpg`;
  const serialized = serializePublishedPost({
    id: "spoof",
    platform: "Instagram",
    postType: "static",
    media: [{ id: "m1", order: 1, mediaType: "IMAGE", url: "/uploads/a/b.jpg" }],
    jsonPayload: JSON.stringify({
      media: [{ order: 1, url: spoofed, media_type: "IMAGE" }],
    }),
  });

  assert.equal(serialized.media[0].url, "/uploads/a/b.jpg");
  assert.equal(serialized.media[0].isCanonicalUrl, false);
});

test("posts with no media serialize without throwing", () => {
  const serialized = serializePublishedPost({
    id: "empty",
    platform: "Instagram",
    postType: "static",
    caption: "Caption only.",
    media: [],
    jsonPayload: null,
  });

  assert.deepEqual(serialized.media, []);
  assert.equal(serialized.mediaUrl, null);
  assert.equal(serialized.posterUrl, null);
  assert.equal(serialized.caption, "Caption only.");
});

test("a corrupt jsonPayload degrades to the local media path", () => {
  const serialized = serializePublishedPost({
    id: "corrupt",
    platform: "Instagram",
    postType: "static",
    media: [{ id: "m1", order: 1, mediaType: "IMAGE", url: "/uploads/a/b.jpg" }],
    jsonPayload: "{not json",
  });

  assert.equal(serialized.media[0].url, "/uploads/a/b.jpg");
});

test("includePayload:false strips the internal n8n payload", () => {
  const withPayload = serializePublishedPost(legacyInstagramImagePost());
  const withoutPayload = serializePublishedPost(legacyInstagramImagePost(), {
    includePayload: false,
  });

  assert.equal(typeof withPayload.jsonPayload, "string");
  assert.equal("jsonPayload" in withoutPayload, false);
  // Media resolution is unaffected by dropping the payload from the response.
  assert.deepEqual(withoutPayload.media, withPayload.media);
});

test("buildRemoteAwareMedia and serializePublishedPost agree on every URL", () => {
  for (const build of [
    legacyInstagramImagePost,
    legacyInstagramVideoPost,
    legacyLinkedInPdfPost,
  ]) {
    const post = build();
    const payload = JSON.parse(post.jsonPayload);
    const remoteAware = buildRemoteAwareMedia(post.media, payload);
    const serialized = serializePublishedPost(post);

    assert.deepEqual(
      serialized.media.map((m) => m.url),
      remoteAware.map((m) => m.url),
    );
  }
});
