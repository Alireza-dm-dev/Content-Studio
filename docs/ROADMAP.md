# Roadmap

This roadmap is inferred from the current state of the code (audited 2026-06-08, updated 2026-06-15 for the new Higgsfield media-generation integration), not from a stated product plan. Where intent is unclear, items are marked TODO — confirm with the project owner rather than assuming.

## 1. What appears already built

- **Brand management**: CRUD for `Brand` profiles, brand identity extraction/approval flow, brand file uploads & gallery (`/brands`, `/brands/[id]`, `/brands/new`, `extract-identity`)
- **Brand workspace**: a per-brand hub view (`/brand-workspace`)
- **Content calendars**: create/list/view calendars and their posts, AI-assisted calendar generation and post suggestions (`/content-calendar`, `/content-calendar/[id]`, `/create`, `/new`, `app/api/content-calendar/generate`, `/suggest-posts`)
- **Prompt generation pipelines** for:
  - Images — raw-idea, from-brand, reference-image flows (`/create-image/*`, `app/api/image/*`)
  - Video — raw-idea and brand-based, plus video storyboards (`/create-video`, `app/api/video/*`, `app/api/video-storyboards/*`)
  - Combined visual direction (reference image + brand identity merge, `app/api/image/combined-visual-direction/*`)
- **Prompt library / generated prompts** browsing (`/generated-prompts`, `/prompt-library`, `app/api/prompts`, `/prompt-templates`)
- **Reference image analysis** (upload + AI analysis, `app/api/reference-image/*`, `reference-analyses`)
- **Settings**: OpenAI API key storage (DB-backed, `/api/settings`), AI connectivity test (`AiTestCard`), Google Drive export status panel, storage path/about info
- **Calendar export** to CSV/Excel/PDF (`lib/calendar-export.js`, `xlsx` + `pdfmake` dependencies, `ExportCalendarModal`)
- **AI media generation (Higgsfield)**: image/video generation via the Higgsfield API (`/generated-media`, `app/api/higgsfield/{balance,models,generate-image}`, `lib/higgsfield.js`), with an operator token balance + ledger (`OperatorTokenBalance`, `TokenLedgerEntry`, `HiggsfieldModel`, `GeneratedMedia` models) — added in migration `20260611151726_add_higgsfield_foundation`
- **File uploads** (`lib/uploads.js`, `ReferenceImageUploader`, `BrandFilesGallery`, `public/uploads/`)
- **Shared UI system**: shadcn/Base UI primitives, sidebar navigation, toasts, light/dark theming
- **"Conceptual Sketch" design system rollout** (in progress — see `docs/DESIGN_SYSTEM.md`): CSS utilities → shared primitives (`Button`, `Input`, `Textarea`, `Select`, `Card`, `Badge`) → page wrappers (`PageContainer`, `PageHeader`, `EmptyState`) applied across Home, Brands, Content Calendar, Create Image, Create Video, Generated Prompts, Settings

## 2. What seems incomplete

- **Google Drive export** — UI present in Settings (explicitly shown as "Not connected" with setup instructions inline), API route scaffolded, but it requires `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` env vars and an OAuth callback that doesn't exist yet
- **Conceptual Sketch redesign** — landed on shared primitives and the 7 main pages, but:
  - `SelectContent` panel still appears to use a regular `rounded-lg` radius vs. the new irregular control-tier trigger radius (visual mismatch)
  - legacy low-contrast `--border`/`--input` tokens still coexist with the new high-contrast `--sketch-line`
  - TODO: confirm whether sub-pages/detail views (`content-calendar/[id]`, `brands/[id]`, `brand-workspace`, `prompt-library`, multi-step create flows) have adopted the new wrappers and `.sketch-*` styling
- **`README.md`** — still generic `create-next-app` boilerplate, not project-specific
- **Test coverage** — none exists; "incomplete" in the sense that there is no safety net for the 42 API routes or the AI pipeline
- TODO: the Higgsfield media-generation integration (`/generated-media`, `app/api/higgsfield/*`) was added after the 2026-06-08 audit and has not yet had a completeness pass — confirm error handling, token-balance edge cases, and whether `generated-media` has adopted the Conceptual Sketch page wrappers

## 3. Suggested next development phases

> TODO: these are inferred priorities based on risk and visible gaps, not a confirmed plan — validate ordering with the project owner.

1. **Finish the Conceptual Sketch rollout** — extend `PageContainer`/`PageHeader`/`EmptyState` + `.sketch-*` styling to the remaining detail/sub-pages, then resolve the known token/radius inconsistencies (see `docs/DESIGN_SYSTEM.md` §5 TODOs)
2. **Write a project-specific README** — purpose, setup, env vars, seeding, screenshots (low effort, high onboarding value, pure documentation)
3. **Decide the fate of Google Drive export** — either implement the OAuth flow or remove/hide the UI entry point so it doesn't read as broken to a new contributor
4. **Introduce a minimal automated test layer** — at minimum, smoke tests for the 36 API routes and the AI-template interpolation logic in `lib/template-utils.js`, since both are pure-logic and don't require a browser
5. **Document and normalize `public/uploads/` storage conventions** — pick one layout (per-brand-ID vs. generic type folders) and update `lib/uploads.js` + `CLAUDE.md` to match
6. **Add lightweight runtime validation for JSON-string DB fields** — a small schema-check helper around `jsonOutput`/`editedJson`/`referenceData` parsing would reduce silent drift risk

## 4. Known bugs or technical debt if visible

- `dev.db` is not listed in `.gitignore` — verify it isn't tracked in git (potential secret/data leakage risk if shared)
- `.DS_Store` files present in `lib/`, `prisma/`, and root — should be gitignored and removed from tracking if committed
- `SelectContent`/`SelectTrigger` radius mismatch (regular `rounded-lg` panel vs. new irregular control-tier trigger) — cosmetic, but visible once a `Select` is opened on a sketch-styled page
- Legacy `--border`/`--input` contrast tokens (≈1.4–1.6:1) fall short of the WCAG 1.4.11 3:1 UI-boundary guidance and are inconsistent with the new `--sketch-line` (≈3.8:1) tokens used on redesigned surfaces
- `heading-display`/`sketch-heading` and `heading-section`/`sketch-subheading` exist as parallel aliases in `globals.css` — `design_system.md` itself flags this as a naming reconciliation that should eventually collapse to one name
- TODO: no issue tracker or backlog file was found in the repo — if bugs/tasks are tracked elsewhere (Linear, GitHub Issues, Notion, etc.), add a pointer here

## 5. Next safest steps

These are low-risk, high-value, and don't touch business logic or running data:

1. Replace `README.md` with project-specific content (pure documentation change, zero code risk)
2. Add `dev.db` and `*.DS_Store` to `.gitignore` — talk to the owner first if `dev.db` may already be tracked, since untracking touches git history
3. Continue the Conceptual Sketch rollout one page at a time using the now-established pattern (`PageContainer` + `PageHeader` + `EmptyState` + `.sketch-*` classes), verifying with `npm run build` and a manual browser check after each page
4. Write a short route-by-route reference for the 36 API handlers in `docs/` — pure documentation, no code change, and it surfaces inconsistencies for free as you go
5. Decide and write down (without yet implementing) the intended plan for Google Drive export — removes ambiguity before any engineering time is spent on it
