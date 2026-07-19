# Roadmap

This roadmap is inferred from the current state of the code (audited 2026-06-08, updated 2026-06-15 for Higgsfield, updated 2026-07-18 for auth/publishing/reviews), not from a stated product plan. Where intent is unclear, items are marked TODO — confirm with the project owner rather than assuming.

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
- **AI image generation/editing (OpenAI)**: direct OpenAI image generation and editing endpoints (`app/api/openai/{edit-image,generate-image}`, `OpenAIImageGenerationCard`)
- **File uploads** (`lib/uploads.js`, `ReferenceImageUploader`, `BrandFilesGallery`, `public/uploads/`)
- **Shared UI system**: shadcn/Base UI primitives, sidebar navigation, toasts, light/dark theming
- **"Conceptual Sketch" design system rollout** (in progress — see `docs/DESIGN_SYSTEM.md`): CSS utilities → shared primitives (`Button`, `Input`, `Textarea`, `Select`, `Card`, `Badge`) → page wrappers (`PageContainer`, `PageHeader`, `EmptyState`) applied across Home, Brands, Content Calendar, Create Image, Create Video, Generated Prompts, Settings
- **Authentication**: session-based email/password login (`app/login/`, `lib/auth.js`, `User` model, `app/api/auth/{login,logout,me}`), bcryptjs password hashing, session token cookies
- **User & brand access control**: `User` model with roles, `BrandAssignment` (direct owner), `BrandMembership` (role-based, e.g. `calendar_editor`), admin endpoints (`app/api/admin/users`, `app/api/admin/generate`)
- **Published posts lifecycle**: `PublishedPost`, `PublishedPostMedia`, `PublishedPostComment` models with CRUD, comments panel, upload forms (`PublishedPostUploadForm`, `LinkedInPostUploadForm`, `PublishedPostsSection`, `LinkedInPublishedPostsSection`, `PublishedPostCommentsPanel`)
- **Workspace reviews**: `WorkspaceReview` model with token-based public review URLs (`/review/[token]`), review panels (`WorkspaceReviewPanel`), public comment access, permission scoping (calendars, Instagram, LinkedIn)
- **Content reports**: per-brand content reporting (`/content-report`, `app/api/content-report/`)
- **Calendar attachment interpretation**: extraction, OCR, and AI interpretation of uploaded calendar files (`lib/calendar-attachment-utils.js`, `lib/calendar-attachment-context.js`, `lib/calendar-attachment-interpreter.js`)
- **LinkedIn publishing scaffolding**: LinkedIn-specific components (`LinkedInPostDetailModal`, `LinkedInPostUploadForm`, `LinkedInPublishedPostsSection`) alongside the generic publishing system

## 2. What seems incomplete

- **Google Drive export** — UI present in Settings (explicitly shown as "Not connected" with setup instructions inline), API route scaffolded, but it requires `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` env vars and an OAuth callback that doesn't exist yet
- **Conceptual Sketch redesign** — landed on shared primitives and the 7 main pages, but:
  - `SelectContent` panel still appears to use a regular `rounded-lg` radius vs. the new irregular control-tier trigger radius (visual mismatch)
  - legacy low-contrast `--border`/`--input` tokens still coexist with the new high-contrast `--sketch-line`
  - TODO: confirm whether sub-pages/detail views (`content-calendar/[id]`, `brands/[id]`, `brand-workspace`, `prompt-library`, multi-step create flows) have adopted the new wrappers and `.sketch-*` styling
- **`README.md`** — still generic `create-next-app` boilerplate, not project-specific
- **Test coverage** — none exists; "incomplete" in the sense that there is no safety net for the ~50 API routes or the AI pipeline
- TODO: confirm the LinkedIn publishing integration's completeness — scaffolding exists but the full publish-to-LinkedIn flow (OAuth, actual API posting) is not confirmed
- TODO: confirm whether the auth UI covers all planned access-control scenarios (e.g. brand-level page gating, role-based route protection)

## 3. Suggested next development phases

> TODO: these are inferred priorities based on risk and visible gaps, not a confirmed plan — validate ordering with the project owner.

1. **Finish the Conceptual Sketch rollout** — extend `PageContainer`/`PageHeader`/`EmptyState` + `.sketch-*` styling to the remaining detail/sub-pages, then resolve the known token/radius inconsistencies (see `docs/DESIGN_SYSTEM.md` §5 TODOs)
2. **Write a project-specific README** — purpose, setup, env vars, seeding, screenshots (low effort, high onboarding value, pure documentation)
3. **Decide the fate of Google Drive export** — either implement the OAuth flow or remove/hide the UI entry point so it doesn't read as broken to a new contributor
4. **Introduce a minimal automated test layer** — at minimum, smoke tests for the ~50 API routes and the AI-template interpolation logic in `lib/template-utils.js`, since both are pure-logic and don't require a browser
5. **Complete the LinkedIn publishing integration** — the scaffolding (models, components, routes) exists but the actual LinkedIn API OAuth + posting flow needs implementation
6. **Document and normalize `public/uploads/` storage conventions** — pick one layout (per-brand-ID vs. generic type folders) and update `lib/uploads.js` + `CLAUDE.md` to match
7. **Add lightweight runtime validation for JSON-string DB fields** — a small schema-check helper around `jsonOutput`/`editedJson`/`referenceData` parsing would reduce silent drift risk

## 4. Known bugs or technical debt if visible

- `.DS_Store` files present in `lib/`, `prisma/`, and root — should be gitignored and removed from tracking if committed
- `SelectContent`/`SelectTrigger` radius mismatch (regular `rounded-lg` panel vs. new irregular control-tier trigger) — cosmetic, but visible once a `Select` is opened on a sketch-styled page
- Legacy `--border`/`--input` contrast tokens (≈1.4–1.6:1) fall short of the WCAG 1.4.11 3:1 UI-boundary guidance and are inconsistent with the new `--sketch-line` (≈3.8:1) tokens used on redesigned surfaces
- `heading-display`/`sketch-heading` and `heading-section`/`sketch-subheading` exist as parallel aliases in `globals.css` — `design_system.md` itself flags this as a naming reconciliation that should eventually collapse to one name
- TODO: no issue tracker or backlog file was found in the repo — if bugs/tasks are tracked elsewhere (Linear, GitHub Issues, Notion, etc.), add a pointer here

## 5. Next safest steps

These are low-risk, high-value, and don't touch business logic or running data:

1. Replace `README.md` with project-specific content (pure documentation change, zero code risk)
2. Add `*.DS_Store` to `.gitignore` (low effort, repo hygiene)
3. Continue the Conceptual Sketch rollout one page at a time using the now-established pattern (`PageContainer` + `PageHeader` + `EmptyState` + `.sketch-*` classes), verifying with `npm run build` and a manual browser check after each page
4. Write a short route-by-route reference for the ~50 API handlers in `docs/` — pure documentation, no code change, and it surfaces inconsistencies for free as you go
5. Decide and write down (without yet implementing) the intended plan for Google Drive export — removes ambiguity before any engineering time is spent on it
