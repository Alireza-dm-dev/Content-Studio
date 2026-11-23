// LinkedIn Published Posts row preview: what each row renders, from the
// canonical serialized post shape. Pure helpers, no DOM.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getLinkedInPreview, buildCaptionExcerpt, detectKind } from "@/lib/linkedin-post-preview";
import { serializePublishedPost } from "@/lib/published-post-utils";

const base = {
  id: "p1",
  brandId: "b1",
  platform: "LinkedIn",
  status: "draft",
  jsonPayload: null,
  thumbnailUrl: null,
};
const media = (mediaType, url, extra = {}) => ({
  id: "m1",
  publishedPostId: "p1",
  url,
  mediaType,
  order: 1,
  fileName: url.split("/").pop(),
  ...extra,
});

test("14. single image → the image itself (via the serializer's URL)", () => {
  const post = serializePublishedPost({
    ...base,
    postType: "static",
    media: [media("IMAGE", "/uploads/b1/published-posts/p1/photo.png", { fileType: "image/png" })],
  });
  const p = getLinkedInPreview(post);
  assert.equal(p.kind, "image");
  assert.equal(p.mode, "image");
  assert.equal(p.src, "/uploads/b1/published-posts/p1/photo.png");
  assert.equal(p.videoSrc, null);
});

test("14b. image with a public canonical URL in the payload prefers it", () => {
  const post = serializePublishedPost({
    ...base,
    postType: "static",
    jsonPayload: JSON.stringify({ media_url: "https://media.example.com/f/photo.png" }),
    media: [media("IMAGE", "/uploads/b1/published-posts/p1/photo.png")],
  });
  const p = getLinkedInPreview(post);
  assert.equal(p.mode, "image");
  assert.ok(p.src === post.imageUrl && p.src);
});

test("15. video with a poster → poster image, never the video file", () => {
  const post = serializePublishedPost({
    ...base,
    postType: "reel",
    thumbnailUrl: "/uploads/b1/published-posts/p1/thumbnail.jpg",
    media: [media("VIDEO", "/uploads/b1/published-posts/p1/clip.mp4", { fileType: "video/mp4" })],
  });
  const p = getLinkedInPreview(post);
  assert.equal(p.kind, "video");
  assert.equal(p.mode, "image");
  assert.equal(p.src, "/uploads/b1/published-posts/p1/thumbnail.jpg");
});

test("15b. video without a poster → metadata-only video frame source", () => {
  const post = serializePublishedPost({
    ...base,
    postType: "reel",
    media: [media("VIDEO", "/uploads/b1/published-posts/p1/clip.mp4")],
  });
  const p = getLinkedInPreview(post);
  assert.equal(p.mode, "video");
  assert.equal(p.src, null);
  assert.equal(p.videoSrc, "/uploads/b1/published-posts/p1/clip.mp4");
  assert.equal(p.fileName, "clip.mp4");
});

test("16. PDF carousel without a cover → PDF card, the PDF is never used as an image src", () => {
  const post = serializePublishedPost({
    ...base,
    postType: "carousel",
    media: [media("document", "/uploads/b1/published-posts/p1/deck.pdf", { fileType: "application/pdf", fileName: "Q3 deck.pdf" })],
  });
  const p = getLinkedInPreview(post);
  assert.equal(p.kind, "pdf");
  assert.equal(p.mode, "pdf");
  assert.equal(p.src, null);
  assert.equal(p.videoSrc, null);
  assert.equal(p.fileName, "Q3 deck.pdf");
});

test("16b. PDF carousel with an uploaded cover → cover image", () => {
  const post = serializePublishedPost({
    ...base,
    postType: "carousel",
    thumbnailUrl: "/uploads/b1/published-posts/p1/thumbnail.png",
    media: [media("document", "/uploads/b1/published-posts/p1/deck.pdf", { fileType: "application/pdf" })],
  });
  const p = getLinkedInPreview(post);
  assert.equal(p.kind, "pdf");
  assert.equal(p.mode, "image");
  assert.equal(p.src, "/uploads/b1/published-posts/p1/thumbnail.png");
});

test("text-only / media-less post → text tile", () => {
  const p = getLinkedInPreview(serializePublishedPost({ ...base, postType: "static", media: [] }));
  assert.equal(p.kind, "text");
  assert.equal(p.mode, "text");
});

test("detectKind keeps its legacy behaviour", () => {
  assert.equal(detectKind({ postType: "reel", media: [] }), "video");
  assert.equal(detectKind({ postType: "static", media: [{ mediaType: "IMAGE" }] }), "image");
  assert.equal(detectKind({ postType: "carousel", media: [{ mediaType: "document" }] }), "pdf");
  assert.equal(detectKind({ postType: "", media: [] }), "pdf");
});

test("17. caption excerpt keeps line breaks, collapses blank runs, trims and caps", () => {
  assert.equal(buildCaptionExcerpt(null), "");
  assert.equal(buildCaptionExcerpt("  Hello   world  "), "Hello world");
  assert.equal(buildCaptionExcerpt("Line one\r\nLine two"), "Line one\nLine two");
  assert.equal(buildCaptionExcerpt("A\n\n\n\n\nB"), "A\n\nB");

  const long = "word ".repeat(200);
  const ex = buildCaptionExcerpt(long, 100);
  assert.ok(ex.length <= 101, String(ex.length));
  assert.ok(ex.endsWith("…"));
  assert.ok(!/\s…$/.test(ex), "no space before the ellipsis");

  const short = "Short caption\nwith two lines";
  assert.equal(buildCaptionExcerpt(short), short);
});
