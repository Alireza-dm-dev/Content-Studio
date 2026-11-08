# Deployment note: brand-local publishing timezones (V1.3.39)

## What changed
- `Brand.timezone` (nullable IANA zone, e.g. `Europe/London`) is the authority for what a
  publish/schedule time means for Instagram and LinkedIn posts. Migration:
  `20261108072122_add_brand_timezone` (adds one nullable column; no backfill).
- The server converts the Brand-local wall-clock time to a UTC instant and stores it in
  `PublishedPost.scheduledDate`. The browser/server timezone is never used.
- Brands with no timezone keep using `America/Vancouver` (backward compatible), log a warning,
  and the UI labels it as the default. Configure it in Brand settings.
- Nonexistent and ambiguous DST local times are rejected (HTTP 400, no write, no webhook).
- Changing a Brand's timezone never rewrites stored `scheduledDate` values.

## n8n payload contract
| Field | Meaning | Example (Europe/London, 15 Jul 2026 10:00) |
|---|---|---|
| `Scheduled Date` | `DD/MM/YYYY HH:mm:ss` wall clock in the **Brand** timezone | `15/07/2026 10:00:00` |
| `scheduled_date_utc` | the exact instant, ISO-8601 UTC | `2026-07-15T09:00:00.000Z` |
| `brand_timezone` | IANA zone used | `Europe/London` |
| `brand_local_publish_datetime` | Brand-local ISO without offset | `2026-07-15T10:00:00` |

With no scheduled date, `Scheduled Date`, `scheduled_date_utc` and `brand_local_publish_datetime`
are `""`; `brand_timezone` is always set.

## n8n compatibility warning — review BEFORE or WITH deployment
The n8n workflow is **not** modified by this release. Previously `Scheduled Date` was always
Vancouver wall-clock time. It is now the Brand's wall-clock time, so any n8n logic that assumes
`Scheduled Date` is Vancouver-local is no longer valid for non-Vancouver brands.

Recommended: schedule from `scheduled_date_utc`. Use `brand_timezone` and
`brand_local_publish_datetime` only where local-time context is needed. Do not apply a timezone
conversion to `scheduled_date_utc` a second time.

Payloads already stored on existing posts keep the old shape until the post is next edited or
re-sent.
