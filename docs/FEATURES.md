# Features

## 1. Existing features (appear functional)

- **Authentication & user management** — session-based login/logout (`/login`, `POST /api/auth/{login,logout,me}`), bcryptjs password hashing, session tokens stored as cookies, `User` model with roles (`admin`, `user`)
- **Brand management** — create/list/view/edit brand profiles (name, website, social links, business info, tone, visual style); brand identity extraction and approval; brand file uploads & gallery
- **Brand access control** — `BrandAssignment` (direct owner assignment), `BrandMembership` (role-based access, e.g. `calendar_editor`)
- **Brand workspace** — a per-brand hub view (`/brand-workspace`)
- **Calendar portal** — brand-specific calendar view for multi-user access (`/calendar-portal`)
- **Content calendars** — create calendars (with AI-assisted generation/post suggestion), list and view calendars, manage individual posts, duplicate calendars
- **Content calendar export** — to Excel via `xlsx` (`lib/calendar-export.js`, `ExportCalendarModal`)
- **AI image-prompt generation** — from a raw idea, from brand identity, or from a reference-image analysis flow; combined visual-direction merging (reference image + brand identity)
- **AI video-prompt generation** — from a raw idea or brand-based; video storyboard generation and final-prompt assembly
- **AI image generation/editing (OpenAI)** — direct image generation and editing via OpenAI endpoints (`app/api/openai/{edit-image,generate-image}`, `OpenAIImageGenerationCard`)
- **AI media generation (Higgsfield)** — image/video generation via the Higgsfield API (`/generated-media`, `app/api/higgsfield/*`, `OpenAIImageGenerationCard`), with operator token balance + ledger
- **Reference image analysis** — upload an image and receive an AI-generated structural/style analysis, editable and reusable
- **Generated prompt library** — central browse of all AI outputs (`app/generated-prompts/page.js`), filterable by `brandId` query param, typed (`image`/`video`/`caption`/`calendar` with distinct badge styling) and tagged by `targetTool`
- **Prompt templates** — reusable, slug-keyed templates with `{{variable}}` interpolation (`lib/template-utils.js`/`template-variables.js`, `PromptTemplate` model)
- **Published posts lifecycle** — `PublishedPost` model with CRUD, media attachments, comments (`PublishedPostCommentsPanel`), upload forms (`PublishedPostUploadForm`, `LinkedInPostUploadForm`), and published-post sections (`PublishedPostsSection`, `LinkedInPublishedPostsSection`)
- **Workspace reviews** — token-based public review pages (`/review/[token]`, `WorkspaceReviewPanel`), configurable brand scope, allow comments, expiry
- **Content reports** — per-brand content reporting (`/content-report`, `app/api/content-report/`)
- **Calendar attachment interpretation** — upload calendar attachments (PDF/images), extract text via AI, and inject interpreted context into the calendar workflow (`lib/calendar-attachment-{utils,context,interpreter}.js`)
- **LinkedIn publishing scaffolding** — LinkedIn-specific components and API handlers alongside the generic publishing system
- **Settings** — OpenAI API key management (DB-backed via the `Settings` table and `/api/settings`, with show/hide toggle), AI connectivity test (`AiTestCard`), Google Drive export status panel, local storage path reference, "About" panel (version, DB, framework, AI model badges)
- **Navigation & shell** — persistent sidebar nav across multiple routes, toasts (`sonner`), light/dark theming (`next-themes`)
- **Conceptual Sketch UI redesign (in progress)** — hand-drawn "ink on sketch paper" visual identity now applied to shared primitives and confirmed on multiple main pages — see `docs/DESIGN_SYSTEM.md`

## 2. Partially built features

- **Google Drive export** — UI entry point exists in Settings and is unusually self-documenting (it lists the exact missing env vars `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` and notes that an authorized token should be stored as `GOOGLE_ACCESS_TOKEN` in the `Settings` table), but the OAuth flow and callback are explicitly unimplemented
- **Conceptual Sketch redesign** — confirmed landed on shared primitives and several main pages; sub-pages and multi-step create flows are TODO to verify (not confirmed in this audit pass — don't assume they're done or undone)
- **Theming** — `next-themes` + `.dark` tokens are present and wired, but TODO: confirm there's a UI control to toggle theme (none was found in the audited pages — Settings has no theme switcher, which may indicate it's missing)
- **LinkedIn publishing** — scaffolding exists (models, components, routes) but the full OAuth flow and actual LinkedIn API posting is not confirmed implemented

## 3. Missing features

- No automated tests of any kind
- No in-app documentation/help (e.g. onboarding, tooltips explaining the AI workflows)
- No search across brands/calendars/prompts (browsing — optionally filtered by `brandId` for prompts — is the only discovery mechanism observed)
- No bulk operations observed (e.g. bulk-delete prompts, bulk-export calendars)
- TODO: confirm whether there's any notification/reminder system for scheduled posts (the `CalendarPost` model has a date field, but no scheduler/cron/notification code was found in this audit)
- TODO: confirm whether the auth UI covers password reset, user invitation, and brand-scoped page gating

## 4. Future feature ideas (if obvious from the codebase's trajectory)

> These are inferred from existing scaffolding and patterns, not confirmed plans — present them to the project owner as ideas, not commitments.

- Completing Google Drive export naturally extends to other export targets (Notion, Airtable, direct social-platform publishing) given the existing export-modal pattern and the unusually prepared groundwork already in the Settings UI
- Completing LinkedIn OAuth/posting would create a pattern for other social platforms (Instagram, Facebook, TikTok) given the published-posts model is already platform-agnostic
- The `CombinedVisualDirection` model (merging reference-image analysis with brand identity) suggests a natural next step toward a "full creative brief" generator that ties image, video, and caption prompts together per calendar post
- The `VideoStoryboard` model and its "generate final prompt" step suggest a natural progression toward multi-shot/scene-by-scene video planning tools
- Given the prompt-template engine already exists and is DB-backed, a **user-facing template editor** (beyond the current API-level `prompt-templates` CRUD) could let the operator tune generation behavior without touching code
- TODO: ask the project owner what's actually planned — this section is inference only and should not drive engineering decisions on its own
