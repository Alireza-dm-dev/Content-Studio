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
UI = Brand-local timezone. Database (`PublishedPost.scheduledDate`) = canonical UTC instant.
Legacy n8n `Scheduled Date` = **America/Vancouver** wall-clock (backward compatible).

| Field | Meaning | Example (Europe/London, 15 Jul 2026 10:00) |
|---|---|---|
| `Scheduled Date` | legacy n8n-compatible `DD/MM/YYYY HH:mm:ss` wall clock in **America/Vancouver** (IANA/DST-aware, independent of the Brand zone) | `15/07/2026 02:00:00` |
| `scheduled_date_utc` | the canonical instant, ISO-8601 UTC | `2026-07-15T09:00:00.000Z` |
| `brand_timezone` | Brand IANA zone used by the UI | `Europe/London` |
| `brand_local_publish_datetime` | what the Brand user selected/sees, Brand-local ISO without offset | `2026-07-15T10:00:00` |

With no scheduled date, `Scheduled Date`, `scheduled_date_utc` and `brand_local_publish_datetime`
are `""`; `brand_timezone` is always set. A Brand with no timezone falls back to
`America/Vancouver`, so Brand-local time and `Scheduled Date` coincide.

## n8n compatibility
**n8n does NOT need to change its expectation for `Scheduled Date`.** It remains America/Vancouver
local time exactly as before V1.3.39. The UTC/Brand fields are available for future workflow
migration (schedule from `scheduled_date_utc`; do not apply a timezone conversion to it twice).

DST validation (nonexistent/ambiguous times) applies when the user selects a time, in the
**Brand** timezone. Vancouver is used only when serializing `Scheduled Date`.

## Stored payloads
`PublishedPost.jsonPayload` is not bulk-migrated. Payloads stored by V1.3.39 (Brand-local
`Scheduled Date`) remain unchanged until the post is next edited, re-sent, adapted or otherwise
rebuilt; new and rebuilt payloads use the Vancouver `Scheduled Date`.
