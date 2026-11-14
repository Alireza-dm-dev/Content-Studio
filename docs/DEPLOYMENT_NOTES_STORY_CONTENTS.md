# Deployment note: Story Contents (V1.3.43)

## What changed
- New Brand Workspace section **Story Contents**, between Instagram and LinkedIn Published Posts:
  a month calendar for handing off Instagram Story assets that are uploaded to Instagram **by hand**.
- Migration `20261114102117_add_brand_story_contents` adds two tables only:
  `BrandStoryContent` (unique per `brandId` + `storyDate`) and `BrandStoryAsset`.
  No existing table or row is changed.
- No publishing integration: nothing calls n8n, the Instagram API or any webhook, and no
  `PublishedPost` is created. "Uploaded" only records that a person posted the Story manually.

## Deploy steps
`npx prisma migrate deploy`, `npx prisma generate`, `npm run build`, restart — as usual.

## Storage and backups — action required
Story assets are stored privately on disk, **not** in the database and not under `public/`:

    .data/story-content/<brandId>/<storyId>/<random-uuid>.<ext>

They are served only through the brand-authorized route
`/api/brands/<id>/story-content/<storyId>/assets/<assetId>`.

**Production backups must now include `.data/story-content/`.** A database-only backup restores
the Story rows but not their files. (`.data/brand-knowledge/` has the same requirement.)
The directory must be writable by the app process and must persist across deploys.

## Limits
Images: JPG/JPEG, PNG, WebP up to 10 MB. Videos: MP4, MOV up to 100 MB. Max 20 assets per Story day.
