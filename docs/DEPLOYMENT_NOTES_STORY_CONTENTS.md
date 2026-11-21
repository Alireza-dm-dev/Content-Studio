# Deployment note: Story Contents (V1.3.43)

## What changed
- New Brand Workspace section **Story Contents**, between Instagram and LinkedIn Published Posts:
  a month calendar for handing off Instagram Story assets that are uploaded to Instagram **by hand**.
- Migration `20261114102117_add_brand_story_contents` adds two tables only:
  `BrandStoryContent` (unique per `brandId` + `storyDate`) and `BrandStoryAsset`.
  No existing table or row is changed.
- No publishing integration: nothing calls n8n, the Instagram API or any webhook, and no
  `PublishedPost` is created. "Uploaded" only records that a person posted the Story manually.

## Deploy steps — REQUIRED, in this order
```bash
npx prisma migrate deploy     # applies 20261114102117_add_brand_story_contents
npx prisma generate           # client must include BrandStoryContent / BrandStoryAsset
npm run build
# restart the app process
```
Verify before opening the UI:
```bash
npx prisma migrate status     # must NOT list 20261114102117_add_brand_story_contents as unapplied
```

**Skipping `migrate deploy` breaks Story Contents** (and nothing else): the calendar shows
"Could not load Story content" and creating a day fails, because Prisma raises
`P2021 — table main.BrandStoryContent does not exist` on every Story query. A stale client
(`prisma generate` skipped, or built before it) fails the same way.

Since V1.3.44 the Story API detects both cases and returns
`503 { success:false, code:"STORY_CONTENT_NOT_MIGRATED", error:"Story Contents is not available because its database migration has not been applied." }`,
which the UI shows verbatim, and the server log says
`[StoryContent] … Story tables missing — run npx prisma migrate deploy and npx prisma generate`.
Any other failure is a generic `500 STORY_CONTENT_FAILED`; SQL, paths and Prisma messages
never reach the client. The fix is to run the deploy steps above — no code or extra migration.

## Storage and backups — action required
Story assets are stored privately on disk, **not** in the database and not under `public/`:

    .data/story-content/<brandId>/<storyId>/<random-uuid>.<ext>

They are served only through the brand-authorized route
`/api/brands/<id>/story-content/<storyId>/assets/<assetId>`.

**Production backups must now include `.data/story-content/`.** A database-only backup restores
the Story rows but not their files. (`.data/brand-knowledge/` has the same requirement.)
The directory must be writable by the app process and must persist across deploys.
It does not need to exist beforehand: creating a Story day never touches the disk, and
`.data/story-content/<brandId>/<storyId>/` is created (`mkdir -p`) on the first asset upload.
If it is not writable, uploads fail with `500 STORY_CONTENT_FAILED` "Failed to save Story asset"
and nothing is half-saved (the request's rows and files are rolled back).

## Limits
Images: JPG/JPEG, PNG, WebP up to 10 MB. Videos: MP4, MOV up to 100 MB. Max 20 assets per Story day.
