# Features

## 1. Existing features (appear functional)

- **Brand management** — create/list/view/edit brand profiles (name, website, social links, business info, tone, visual style); brand identity extraction and approval; brand file uploads & gallery
- **Brand workspace** — a per-brand hub view (`/brand-workspace`)
- **Content calendars** — create calendars (with AI-assisted generation/post suggestion), list and view calendars, manage individual posts, duplicate calendars
- **Content calendar export** — to Excel via `xlsx` (`lib/calendar-export.js`, `ExportCalendarModal`)
- **AI image-prompt generation** — from a raw idea, from brand identity, or from a reference-image analysis flow; combined visual-direction merging (reference image + brand identity)
- **AI video-prompt generation** — from a raw idea or brand-based; video storyboard generation and final-prompt assembly
- **Reference image analysis** — upload an image and receive an AI-generated structural/style analysis, editable and reusable
- **Generated prompt library** — central browse of all AI outputs (`app/generated-prompts/page.js`), filterable by `brandId` query param, typed (`image`/`video`/`caption`/`calendar` with distinct badge styling) and tagged by `targetTool`
- **Prompt templates** — reusable, slug-keyed templates with `{{variable}}` interpolation (`lib/template-utils.js`/`template-variables.js`, `PromptTemplate` model)
- **Settings** — OpenAI API key management (DB-backed via the `Settings` table and `/api/settings`, with show/hide toggle), AI connectivity test (`AiTestCard`), Google Drive export status panel, local storage path reference, "About" panel (version, DB, framework, AI model badges)
- **Navigation & shell** — persistent sidebar nav across 8 routes, toasts (`sonner`), light/dark theming (`next-themes`)
- **Conceptual Sketch UI redesign (in progress)** — hand-drawn "ink on sketch paper" visual identity now applied to shared primitives and confirmed on multiple main pages (Settings, Generated Prompts, Create Image, and per the prior session's work, all 7 main pages — see `docs/DESIGN_SYSTEM.md`)

## 2. Partially built features

- **Google Drive export** — UI entry point exists in Settings and is unusually self-documenting (it lists the exact missing env vars `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` and notes that an authorized token should be stored as `GOOGLE_ACCESS_TOKEN` in the `Settings` table), but the OAuth flow and callback are explicitly unimplemented
- **Conceptual Sketch redesign** — confirmed landed on shared primitives and several main pages; sub-pages and multi-step create flows are TODO to verify (not confirmed in this audit pass — don't assume they're done or undone)
- **Theming** — `next-themes` + `.dark` tokens are present and wired, but TODO: confirm there's a UI control to toggle theme (none was found in the audited pages — Settings has no theme switcher, which may indicate it's missing)

## 3. Missing features

- No authentication/authorization (intentional for a local single-user tool — but would need to be added before any multi-user or hosted deployment)
- No automated tests of any kind
- No in-app documentation/help (e.g. onboarding, tooltips explaining the AI workflows)
- No search across brands/calendars/prompts (browsing — optionally filtered by `brandId` for prompts — is the only discovery mechanism observed)
- No bulk operations observed (e.g. bulk-delete prompts, bulk-export calendars)
- TODO: confirm whether there's any notification/reminder system for scheduled posts (the `CalendarPost` model has a date field, but no scheduler/cron/notification code was found in this audit)

## 4. Future feature ideas (if obvious from the codebase's trajectory)

> These are inferred from existing scaffolding and patterns, not confirmed plans — present them to the project owner as ideas, not commitments.

- Completing Google Drive export naturally extends to other export targets (Notion, Airtable, direct social-platform publishing) given the existing export-modal pattern and the unusually prepared groundwork already in the Settings UI
- The `CombinedVisualDirection` model (merging reference-image analysis with brand identity) suggests a natural next step toward a "full creative brief" generator that ties image, video, and caption prompts together per calendar post
- The `VideoStoryboard` model and its "generate final prompt" step suggest a natural progression toward multi-shot/scene-by-scene video planning tools
- Given the prompt-template engine already exists and is DB-backed, a **user-facing template editor** (beyond the current API-level `prompt-templates` CRUD) could let the operator tune generation behavior without touching code
- TODO: ask the project owner what's actually planned — this section is inference only and should not drive engineering decisions on its own
