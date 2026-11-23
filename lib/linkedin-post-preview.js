// Client-safe helpers for the LinkedIn Published Posts row preview.
// Pure: no fs/process, no fetching. Uses only the URLs the serializer already
// hands the client (`/uploads/...` paths go through the membership-checked
// proxy; remote URLs are the public media server). Never downloads a full
// video or PDF: previews use thumbnails/posters, and video falls back to a
// metadata-only element; PDFs never render pages here.

// Row kind from postType + first media record. Defensive about case.
export function detectKind(post) {
  const first = post?.media?.[0];
  const postType = (post?.postType || "").toLowerCase();
  const mt = (first?.mediaType || "").toLowerCase();
  const fileType = (first?.fileType || "").toLowerCase();
  const fileName = (first?.fileName || "").toLowerCase();

  if (postType === "reel" || postType === "video" || mt === "video") return "video";
  if (
    postType === "carousel" &&
    (mt === "document" || fileType === "application/pdf" || fileName.endsWith(".pdf"))
  ) {
    return "pdf";
  }
  if (postType === "static" || mt === "image") return "image";
  if (mt === "document") return "pdf";
  // Legacy LinkedIn posts default to PDF behavior.
  return "pdf";
}

function fileNameOf(media) {
  if (!media) return null;
  return media.fileName || (media.url ? String(media.url).split("/").pop() : null) || null;
}

/**
 * What the row's preview tile should render.
 * Returns { kind, mode, src, videoSrc, fileName }
 *   mode "image"      → <img src> (image itself, or a poster/cover)
 *   mode "video"      → metadata-only <video src={videoSrc}> (no poster exists)
 *   mode "pdf"        → PDF card (no first-page render exists in this app)
 *   mode "text"       → caption tile (no media at all)
 */
export function getLinkedInPreview(post) {
  const first = post?.media?.[0] || null;
  const fileName = fileNameOf(first);
  const thumb = post?.thumbnailUrl || null;

  if (!first) {
    return { kind: "text", mode: thumb ? "image" : "text", src: thumb, videoSrc: null, fileName: null };
  }

  const kind = detectKind(post);
  if (kind === "image") {
    const src = post.imageUrl || first.url || thumb;
    return { kind, mode: src ? "image" : "text", src: src || null, videoSrc: null, fileName };
  }
  if (kind === "video") {
    if (thumb) return { kind, mode: "image", src: thumb, videoSrc: post.videoUrl || first.url || null, fileName };
    const videoSrc = post.videoUrl || first.url || null;
    return { kind, mode: videoSrc ? "video" : "text", src: null, videoSrc, fileName };
  }
  // PDF carousel: a stored cover image when the upload included one.
  if (thumb) return { kind, mode: "image", src: thumb, videoSrc: null, fileName };
  return { kind, mode: "pdf", src: null, videoSrc: null, fileName };
}

/**
 * Readable multi-line excerpt of a caption. Keeps intentional line breaks,
 * collapses runs of blank lines, trims each line, and caps the length (the CSS
 * line clamp handles the visual 3-line limit; this bounds the DOM text).
 */
export function buildCaptionExcerpt(caption, maxChars = 280) {
  if (caption == null) return "";
  const text = String(caption)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut;
  return base.replace(/[\s.,;:!?-]+$/, "") + "…";
}
