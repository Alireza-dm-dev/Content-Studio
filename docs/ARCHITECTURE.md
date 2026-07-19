# Architecture

## 1. Folder responsibilities

| Folder | Responsibility |
|---|---|
| `app/` | Next.js App Router — pages (Server Components by default), layouts, and API route handlers (`app/api/`). Each top-level feature area (`brands/`, `content-calendar/`, `create-image/`, `create-video/`, `generated-media/`, `generated-prompts/`, `prompt-library/`, `brand-workspace/`, `settings/`, `login/`, `calendar-portal/`, `content-report/`, `review/`) is a route segment containing its `page.js` plus any page-local client components/steps |
| `app/api/` | REST endpoints, grouped by resource (auth, admin, brands, calendars, content-calendar, calendar-posts, content-report, video, video-storyboards, image, higgsfield, openai, prompts/prompt-templates, reference-image/reference-analyses, brand-identities, review, settings, upload, generate). Thin handlers: parse request → call `prisma`/`lib/ai.js`/`lib/higgsfield.js`/`lib/auth.js` → return `NextResponse.json` |
| `components/ui/` | Generic, reusable shadcn/Base UI-derived primitives (button, card, input, select, badge, label, separator, sonner/toaster, plus the newer layout primitives `page-container`, `page-header`, `empty-state`). No business logic; styling + accessibility only |
| `components/*.jsx` | Feature-specific shared components used across multiple pages (modals: `ImagePromptModal`, `VideoPromptModal`, `VideoStoryboardModal`, `ExportCalendarModal`, `PostDetailModal`, `LinkedInPostDetailModal`, `PublishedPostUploadForm`, `LinkedInPostUploadForm`; uploaders/galleries: `ReferenceImageUploader`, `BrandFilesGallery`, `GenerationReferenceImageInput`; publishing: `PublishedPostsSection`, `LinkedInPublishedPostsSection`, `PublishedPostCommentsPanel`, `WorkspaceReviewPanel`; navigation: `sidebar-nav`, `SidebarWrapper`) |
| `lib/` | Server-side shared logic: the Prisma singleton (`prisma.js`), session-based auth (`auth.js`), the AI generation pipeline (`ai.js`), the Higgsfield image/video generation client config (`higgsfield.js`), the prompt-templating engine (`template-utils.js`, `template-variables.js`), domain helpers (`brand-identity-utils.js`, `calendar-export.js`, `calendar-post-utils.js`, `uploads.js`, `published-post-utils.js`, `published-post-webhook.js`, `published-post-remote-media.js`, `workspace-review-access.js`, `workspace-review-public-data.js`, `workspace-review-token.js`, `calendar-attachment-utils.js`, `calendar-attachment-context.js`, `calendar-attachment-interpreter.js`, `image-visual-controls.js`, `url-resource-utils.js`, `timezone.js`), and the generic `cn()` className helper (`utils.js`). `lib/generated/prisma/` is the generated Prisma client (build artifact, gitignored) |
| `prisma/` | Database schema (`schema.prisma`), migrations, and seed script (`seed.js`) |
| `public/uploads/` | User-uploaded media, organized (currently with two overlapping conventions — see `docs/ROADMAP.md` §4) into `images/`, `videos/`, `logos/`, `brands/`, `reference-images/`, plus per-brand-ID directories. `filePath` values in the DB are relative to `public/` |
| `docs/` | Project documentation (this folder) |
| Root config | `prisma.config.ts` (DB URL), `components.json` (shadcn config), `app/globals.css` (Tailwind v4 theme + design tokens), `design_system.md` (UI redesign spec), `CLAUDE.md`/`AGENTS.md` (agent instructions) |

## 2. Data flow

```
Server Component (page.js)
  └─ imports `prisma` from lib/prisma.js directly
       └─ queries SQLite via Prisma 7 + better-sqlite3 adapter
            └─ renders with `export const dynamic = "force-dynamic"` (no static caching)

Client Component ("use client")
  └─ fetch("/api/<resource>")
       └─ app/api/<resource>/route.js (route handler)
            └─ imports `prisma` from lib/prisma.js
                 └─ queries SQLite, returns NextResponse.json(...)
```

- **Server Components fetch directly through Prisma** — no API round-trip needed for initial page data
- **Client Components always go through `app/api/` route handlers** — they never import `prisma` directly (it's a server-only singleton backed by `better-sqlite3`)
- `searchParams` passed into server page components are async and must be awaited: `const params = await searchParams`
- AI-driven flows additionally route through `lib/ai.js`'s `generateWithPromptTemplate()`, which itself queries `prisma` for the `PromptTemplate` record before calling OpenAI

## 3. API structure

~50 REST route handlers under `app/api/`, one `route.js` per resource/action, exporting HTTP-verb functions (`GET`, `POST`, `PATCH`/`PUT`, `DELETE` as needed) that return `NextResponse.json(data, { status })`. Grouped by resource:

- `auth` (+ `login`, `logout`, `me`) — session-based authentication
- `admin` (+ `users`, `generate`) — admin-only operations
- `brands` (+ `[id]`, `[id]/identity`, `[id]/files`, `[id]/files/[fileId]`, `[id]/extract-identity`)
- `brand-identities`
- `calendars` (+ `[id]`, `[id]/duplicate`, `[id]/posts`)
- `content-calendar` (+ `generate`, `suggest-posts`, `regenerate-post`, `[calendarId]/export`, `[calendarId]/export/google-drive`, `[calendarId]/posts/[postId]/{image-prompt,video-prompt,video-storyboard}`)
- `calendar-posts` (+ `[id]`, `[id]/regenerate`)
- `content-report` — brand content reporting
- `image` (+ `from-brand/generate`, `combined-visual-direction`, `combined-visual-direction/[id]`, `combined-visual-direction/[id]/create-nanobanana-prompt`)
- `video` (+ `brand-based/generate`, `raw-idea/generate`)
- `video-storyboards` (+ `[id]`, `[id]/generate-final-prompt`)
- `higgsfield` (+ `balance`, `models`, `generate-image`) — Higgsfield media-generation provider integration
- `openai` (+ `edit-image`, `generate-image`) — OpenAI image generation/editing (distinct from the AI prompt pipeline in `image/`)
- `prompts`, `prompt-templates` (+ `[id]`)
- `reference-image` (+ `analyze`, `analysis/[id]`), `reference-analyses`
- `review` (+ `[token]`) — public workspace review access
- `settings` — DB-backed app settings (OpenAI key, etc.)
- `upload` (+ `temp-image`, `temp-images`) — temporary file uploads
- `generate/test` (AI connectivity check)

Conventions: thin handlers, all data access via the `prisma` singleton, AI-generation handlers delegate to `lib/ai.js`, Higgsfield media-generation handlers delegate to `lib/higgsfield.js`, auth handlers delegate to `lib/auth.js`. There is no shared request-validation library — validation is inline per-route (e.g. checking trimmed string fields before insert).

## 4. Auth structure

**Session-based authentication is implemented.** The auth flow:

```
Login page (app/login/page.js)
  └─ POST /api/auth/login
       └─ lib/auth.js verifies bcrypt password hash against User table
            └─ Sets sessionToken cookie on success

Protected pages
  └─ Call getServerSession() or requireAuth() from lib/auth.js
       └─ Reads sessionToken cookie, looks up User record
            └─ Returns user or redirects to /login

Logout
  └─ POST /api/auth/logout
       └─ Clears sessionToken in DB and cookie
```

- **No middleware** — session checks happen inside page/layout Server Components and API route handlers
- **No third-party auth** — email/password only, bcryptjs for password hashing
- **Brand-level access control** via `BrandAssignment` (direct ownership) and `BrandMembership` (role-based, e.g. `calendar_editor`)
- **Admin users** (`role = "admin"`) have access to `app/api/admin/*` endpoints
- **Public review pages** (`/review/[token]`) use a token-based access model via `WorkspaceReview` — this is a separate access mechanism from the session auth

The app also has a stubbed Google Drive OAuth integration (`app/api/content-calendar/[calendarId]/export/google-drive/route.js`, surfaced in `app/settings/page.js`) — this is third-party API authorization (for exporting to a user's own Drive), not application authentication, and is currently unimplemented.

## 5. Business logic location

- **AI generation pipeline**: `lib/ai.js` (`generateWithPromptTemplate` — loads template, interpolates variables, calls OpenAI with optional images) + `lib/template-utils.js`/`template-variables.js` (placeholder interpolation, variable extraction, placeholder-text guards)
- **Auth**: `lib/auth.js` — password hashing, session token generation/verification, server-side session retrieval
- **Domain helpers**: `lib/brand-identity-utils.js`, `lib/calendar-export.js` (Excel/PDF export via `xlsx`/`pdfmake`), `lib/calendar-post-utils.js`, `lib/uploads.js` (file storage)
- **Published posts & reviews**: `lib/published-post-utils.js`, `lib/published-post-webhook.js`, `lib/published-post-remote-media.js`, `lib/workspace-review-access.js`, `lib/workspace-review-public-data.js`, `lib/workspace-review-token.js`
- **Calendar attachments**: `lib/calendar-attachment-utils.js`, `lib/calendar-attachment-context.js`, `lib/calendar-attachment-interpreter.js` — extraction, interpretation, and context injection for uploaded calendar files
- **Image visual controls**: `lib/image-visual-controls.js` — visual production control presets
- **Utilities**: `lib/timezone.js` (timezone helpers), `lib/url-resource-utils.js` (URL extraction/fetching), `lib/default-prompt-templates.js` (default template seed data)
- **Higgsfield media generation**: `lib/higgsfield.js` resolves the `HIGGSFIELD_API_KEY` credential (Settings table, falling back to env) and configures the `@higgsfield/client` SDK; consumed by `app/api/higgsfield/*` route handlers, which also update `OperatorTokenBalance`/`TokenLedgerEntry` records
- **API route handlers** (`app/api/**/route.js`) contain request-level orchestration: validation, calling `lib/` helpers and `prisma`, shaping responses
- **Page components** (`app/**/page.js`) contain primarily data-fetching (Server Components, e.g. `app/generated-prompts/page.js` queries `prisma.generatedPrompt.findMany`) and form/interaction state (Client Components with `"use client"`, e.g. `app/settings/page.js`'s `ApiKeyCard`); business rules largely live below them in `lib/`
- There is **no separate service/repository layer** — `prisma` is queried directly from both Server Components and route handlers; `lib/*-utils.js` files act as the closest thing to a domain layer

## 6. Reusable component strategy

- **`components/ui/`** holds generic, presentation-only primitives derived from shadcn/ui running on Base UI (`@base-ui/react`) rather than Radix. They follow the shadcn `data-slot` convention and use `class-variance-authority` for variants and `cn()` (clsx + tailwind-merge) for class composition
- `Button` is the one primitive that layers in `@radix-ui/react-slot` to support `asChild` (link-as-button pattern) — **always use `<Button asChild>`, not Base UI's `render` prop**, per `CLAUDE.md`
- Newer layout primitives — `PageContainer`, `PageHeader`, `EmptyState` — standardize the page-shell patterns (responsive padding wrapper; eyebrow/title/description/back-link/actions header block; icon-in-frame + heading + description + action empty-list state) that pages previously hand-rolled. Confirmed in use on `app/settings/page.js`, `app/generated-prompts/page.js`, `app/create-image/page.js`, and other main pages — adopted page by page
- **`components/*.jsx`** (non-`ui/`) holds feature-level shared components (modals, uploaders, galleries, the sidebar) reused across 2+ pages but tied to specific domain concepts (brands, prompts, storyboards)
- The Conceptual Sketch design system (`design_system.md`) is layered on top of this structure as CSS-only additions (`@layer components` classes in `app/globals.css`, e.g. `.sketch-frame`, `.sketch-card`, `.icon-sketch`) — components keep their existing APIs and Base UI behavior; only `className` strings change to adopt `.sketch-*` styling (e.g. `app/create-image/page.js` composes `Card` with `sketch-frame icon-sketch` for its option tiles)
