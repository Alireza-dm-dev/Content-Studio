// Which Instagram Published Post types take a separate Thumbnail / Cover.
// Pure (no fs/path): shared by the upload form, the detail modal and the API.
//
// Rule: only Reel / Video. Static and Carousel already have an image as their
// primary media, which is their preview, so a separate cover is not offered and
// the API refuses a NEW cover for them. Existing covers on old Static/Carousel
// rows are left untouched (never auto-deleted).

export const COVER_NOT_SUPPORTED_CODE = "COVER_NOT_SUPPORTED";
export const COVER_NOT_SUPPORTED_MESSAGE =
  "A separate thumbnail / cover is only used for Reel / Video posts. Static and Carousel posts use their first image as the preview.";

/** True for Reel / Video ("reel", or the legacy alias "video"). */
export function postTypeSupportsCover(postType) {
  const t = String(postType ?? "").trim().toLowerCase();
  return t === "reel" || t === "video";
}
