# Deployment note: Instagram Published Post thumbnail / cover (V1.3.44)

## What changed
- Instagram Published Posts can have an optional **Thumbnail / Cover** image, separate from
  the post media (it never replaces the video/image).
  - Upload form: "Thumbnail / Cover" picker under Media Files, with preview / Replace / Remove,
    for every post type (labelled "recommended" for Reel / Video).
  - Post detail modal: the cover is shown in its own block under the media, with
    Upload / Replace / Remove applied immediately.
  - Grid card: a video post uses the cover as its preview (existing behaviour; falls back to
    the video when there is no cover or it fails to load). Image posts still show the image.
- New route `PUT|DELETE /api/brands/<id>/published-posts/<postId>/thumbnail` (Instagram only,
  same brand access as editing a post).

## No migration
Reuses the existing `PublishedPost.thumbnailUrl` column, the existing storage folder
`public/uploads/<brandId>/published-posts/<postId>/` (file `thumbnail-<uuid>.<ext>`) and the
existing n8n payload field `thumbnail_url`. Deploy is the usual `npm run build` + restart.

## Validation
JPG/JPEG, PNG, WebP; max 10 MB; extension, MIME and file signature must agree; empty files
rejected; the stored name is random (user file names never reach the path). Invalid covers on
Instagram create now return `400 INVALID_THUMBNAIL` instead of being silently dropped.
LinkedIn's existing video-thumbnail handling is unchanged.

## n8n
The payload shape is unchanged. `thumbnail_url` (already sent) now carries the cover for any
Instagram post type, uploaded to the public media server like the media. A cover changed in
the detail modal is stored but **not auto-sent**: use "Send to n8n" (or save an edit) to
update a post n8n already has. Whether the n8n Instagram workflow uses `thumbnail_url` (e.g.
as the Reel `cover_url`) is decided in n8n, not in this app.
