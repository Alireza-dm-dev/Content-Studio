# Project Context for AI

This file is the primary orientation document for AI agents (Claude Code, etc.) working in this repository. Read this before making changes. It summarizes facts gathered from a project audit on 2026-06-08, with updates on 2026-06-15 (Higgsfield integration) and 2026-07-18 (auth, published-posts, reviews, reports) — verify against current code if something looks stale, and update this file when the facts change.

## 1. Project purpose

Content Studio is a **local-first AI content production tool** for social media, growing from a single-operator tool toward multi-user brand-team support. It lets operators:
- manage "Brand" profiles (identity, visual style, uploaded reference assets)
- build content calendars of scheduled posts
- generate AI prompts for images, videos, and captions — either from a raw idea or derived from brand identity / reference imagery
- generate actual images/video via the Higgsfield API or OpenAI (`/generated-media`, `app/api/higgsfield/*`, `lib/higgsfield.js`, `app/api/openai/*`), tracked against an operator token balance
- manage published posts with approval workflows and public review links
- store generated output in a prompt library and export calendars (CSV/Excel/PDF)
- log in with email/password (session-based auth, `app/login/`, `lib/auth.js`)

It is **not** a SaaS product — auth is session-based with a single `User` table, designed for a small team sharing one instance.

## 2. Actual tech stack

- **Next.js 16.2.7** (App Router, Turbopack) — APIs differ from training-data Next.js; read `node_modules/next/dist/docs/` before writing Next.js code (see `AGENTS.md`)
- **React 19.2.4**
- **Tailwind CSS v4** — CSS-first config in `app/globals.css` via `@import "tailwindcss"` and `@theme inline`; there is **no** `tailwind.config.js`
- **shadcn/ui on Base UI** (`@base-ui/react`), not Radix — `components/ui/` wraps Base UI primitives; `Button` additionally uses `@radix-ui/react-slot` for `asChild`
- `class-variance-authority` (cva), `lucide-react` icons, `geist` fonts (`geist/font/sans`, `geist/font/mono` — NOT `next/font/google`)
- **Prisma 7** + `better-sqlite3` via `@prisma/adapter-better-sqlite3` — split config (schema in `prisma/schema.prisma`, datasource URL in `prisma.config.ts` reading `DATABASE_URL`)
- **OpenAI SDK** (`openai` ^6), default model `gpt-4o`
- **Higgsfield SDK** (`@higgsfield/client` ^0.2.1, via `@higgsfield/client/v2`) — image/video generation provider; credentials resolved by `lib/higgsfield.js` from the `Settings` table (`HIGGSFIELD_API_KEY`), falling back to env
- `sonner` (toasts), `next-themes` (light/dark), `xlsx` + `pdfmake` (calendar export to Excel/PDF), `tailwind-merge` / `clsx` (via `cn()`)
- `bcryptjs` (password hashing), `ssh2-sftp-client` (SFTP upload), `tw-animate-css` (animation utilities)
- **JavaScript**, not TypeScript — only `prisma.config.ts` is `.ts` (a Prisma 7 requirement)
- **No test framework configured** — `npm run lint` (ESLint) is the only automated check

## 3. Folder map

```
app/
  api/                ~50 REST route handlers, 21 resource groups (incl. `higgsfield/`, `auth/`, `openai/`)
  page.js             Home (login-gated)
  layout.js           Root shell (fonts, SidebarNav, Toaster, paper-grain bg)
  globals.css         Tailwind v4 theme + Conceptual Sketch design tokens/utilities
  brands/, brand-workspace/, content-calendar/, create-image/,
  create-video/, generated-media/, generated-prompts/, prompt-library/, settings/
  login/              Email/password login page
  calendar-portal/    Brand-specific calendar portal (multi-user)
  content-report/     Brand content reporting
  review/             Public workspace review pages ([token])
components/
  ui/                 shadcn/Base UI primitives (button, card, input, select,
                      badge, page-container, page-header, empty-state, …)
  *.jsx               feature components (modals, galleries, uploaders, sidebar-nav,
                      published-posts, workspace-review, LinkedIn, OpenAI gen)
lib/
  prisma.js           Prisma singleton (better-sqlite3 adapter)
  ai.js               OpenAI generation pipeline (generateWithPromptTemplate)
  higgsfield.js       Higgsfield SDK config + credential resolution (image/video generation)
  auth.js             Session-based authentication (bcryptjs, session tokens)
  template-utils.js / template-variables.js   prompt templating engine
  brand-identity-utils.js, calendar-export.js, calendar-post-utils.js, uploads.js, utils.js
  calendar-attachment-*.js   Attachment extraction & interpretation
  published-post-*.js        Published post management & webhooks
  workspace-review-*.js      Public review access & tokens
  image-visual-controls.js   Visual production controls
  timezone.js, url-resource-utils.js
  generated/prisma/   generated Prisma client (gitignored, regenerate after schema changes)
prisma/
  schema.prisma, seed.js, migrations/ (19 so far)
public/uploads/
  images/, videos/, logos/, brands/, reference-images/, + per-brand-id directories
docs/                 project documentation (this folder)
```
Root also has `.agents/`, `.claude/` (agent/skill scaffolding), `skills-lock.json`, `components.json` (shadcn config), `design_system.md` (252-line "Conceptual Sketch" UI spec), `CLAUDE.md`, `AGENTS.md`. Note: `dev.db` is now in `.gitignore`.

## 4. Important files

| File | Role |
|---|---|---|
| `app/layout.js` | Root shell: fonts, `SidebarNav`, `Toaster`, global paper-grain background |
| `components/sidebar-nav.jsx` | Defines the entire primary navigation / IA |
| `lib/prisma.js` | Prisma singleton — all DB access goes through this |
| `lib/ai.js` | `generateWithPromptTemplate()` — loads a `PromptTemplate`, interpolates variables, calls OpenAI with optional images |
| `lib/auth.js` | Session-based auth: password hashing, session token generation/verification |
| `lib/template-utils.js` / `template-variables.js` | Prompt templating engine (placeholders, variable extraction, validation) |
| `prisma/schema.prisma` + `seed.js` | 22-model schema and DB seed script |
| `design_system.md` | "Conceptual Sketch" design spec — source of truth for the in-progress UI redesign |
| `CLAUDE.md` / `AGENTS.md` | Agent working rules — Prisma 7 quirks, Next.js 16 API drift warnings, token-saving rules |
| `components.json` | shadcn config: style `base-nova`, base color `neutral`, RSC on, JSX (not TSX) |

## 5. Development commands

```bash
npm run dev          # next dev (Turbopack, default port 3000; can pass -- --port <n>)
npm run start        # next start (production server)
npm run seed         # node prisma/seed.js (also wired as Prisma's seed hook)
npx prisma migrate dev --name <name>   # create + apply a migration
npx prisma generate                     # regenerate client into lib/generated/prisma
npx prisma studio                       # DB GUI
```

## 6. Build, lint, and test commands

```bash
npm run build   # next build — also the way to catch compile errors
npm run lint    # eslint (eslint-config-next/core-web-vitals)
```
**There is no test command.** No test framework is installed (no Jest/Vitest/Playwright/etc. in `devDependencies`), and `CLAUDE.md` states explicitly: "No test suite is configured." Verifying changes currently means: `npm run build`, `npm run lint`, and manual exercising in the browser.

## 7. Database notes

- SQLite via Prisma 7, file `dev.db` at the **project root** (not `prisma/dev.db`) — `DATABASE_URL="file:./dev.db"`
- 22 models: `Brand`, `User`, `BrandAssignment`, `BrandMembership`, `BrandIdentity`, `UploadedFile`, `ContentCalendar`, `CalendarPost`, `VideoStoryboard`, `GeneratedPrompt`, `PromptTemplate`, `ReferenceImageAnalysis`, `CombinedVisualDirection`, `WorkspaceReview`, `Settings`, `HiggsfieldModel`, `OperatorTokenBalance`, `TokenLedgerEntry`, `GeneratedMedia`, `PublishedPost`, `PublishedPostMedia`, `PublishedPostComment`
- IDs are `cuid()`; most foreign keys are optional with `onDelete: SetNull` (a few `Cascade`, e.g. `Brand → BrandIdentity`, `ContentCalendar → CalendarPost`)
- Several fields store **JSON as strings** (`jsonOutput`, `editedJson`, `referenceData`, `finalPrompt`) — no DB-level schema validation; shape is enforced only in app code
- 19 migrations exist (`2026-06-02` → `2026-07-18`), most recently `20260718083341_add_calendar_reference_interpretation_fields`; generated client lives at `lib/generated/prisma/` (gitignored — must run `prisma generate` after pulling schema changes)
- App settings (e.g. `OPENAI_API_KEY`, `HIGGSFIELD_API_KEY`) are stored in the `Settings` table via `/api/settings`; the `.env` values are fallback placeholders only

## 8. Auth notes

**Session-based authentication is implemented.** Users log in via `app/login/page.js` → `POST /api/auth/login` → server verifies bcrypt password hash against the `User` table and sets a `sessionToken` cookie. Protected pages check the session via `lib/auth.js`. There is a `User` model with `email`, `name`, `role`, `passwordHash`, `sessionToken`, and `sessionExpiresAt` fields.

- Users can be assigned to brands via `BrandAssignment` (direct owner assignment) and `BrandMembership` (role-based access, e.g. `calendar_editor`)
- Admin functionality exists at `app/api/admin/users` and `app/api/admin/generate`
- The `scripts/seed-admin.js` and `scripts/ensure-owner-admin.js` scripts provision initial admin users
- **No third-party auth providers** (no OAuth, no next-auth) — login is email/password only
- This app should not be exposed to a public network without reviewing the auth layer's security posture

There is also a **stubbed Google Drive OAuth integration** (`app/api/content-calendar/[calendarId]/export/google-drive/route.js`), surfaced in Settings as "Not connected." It requires `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` env vars and an OAuth callback that does not yet exist — explicitly unimplemented, not a bug.

## 9. Styling and design system notes

- Tailwind v4, CSS-first (`@theme inline` block in `app/globals.css`), OKLCH color tokens, light/dark via `.dark` class (`next-themes`)
- shadcn/ui component layer on Base UI primitives
- An in-progress **"Conceptual Sketch" design system** (spec: `design_system.md`) is being incrementally rolled in:
  - hand-drawn ink-line aesthetic: irregular `sketch-frame`/`sketch-card` borders & radii, offset flat poster shadows, single "vermilion" accent color, mono "annotation" type for labels/eyebrows
  - new `--sketch-*` tokens and `.sketch-*` utility classes live in `app/globals.css` under `@layer components`
  - already wired into shared primitives (`Button`, `Input`, `Textarea`, `Select`, `Card`, `Badge`) and into new page-level wrappers (`PageContainer`, `PageHeader`, `EmptyState`), now applied across all 7 main pages
  - **rollout is incremental and ongoing** — see `docs/DESIGN_SYSTEM.md` for current adoption status and open TODOs

## 10. Architecture rules

- All database access goes through the `prisma` singleton in `lib/prisma.js` — Server Components and API route handlers import it directly; Client Components call API routes via `fetch`
- Server Components that fetch data declare `export const dynamic = "force-dynamic"` to prevent static caching
- API routes live in `app/api/` and follow REST conventions (`GET`/`POST`/etc. exporting `NextResponse.json(...)`)
- `searchParams` in server page components must be **awaited**: `const params = await searchParams`
- AI generation funnels through `lib/ai.js` (`generateWithPromptTemplate`), which loads a `PromptTemplate` from the DB, interpolates `{{variables}}`, and calls OpenAI
- Uploaded files live under `public/uploads/` (`images/`, `videos/`, `logos/` subdirectories); `filePath` values stored in the DB are relative to `public/`
- After any Prisma schema change: `prisma migrate dev` then `prisma generate`

## 11. Claude Code low-token rules

(Carried from `CLAUDE.md` — apply these when working in this repo.)

1. Do not scan the entire codebase unless explicitly requested.
2. Before editing, identify the smallest set of files needed.
3. Use search/grep before opening large files.
4. If a file is very large, inspect only the relevant sections.
5. Do not re-read files already inspected in the same session unless necessary.
6. For large features, propose a plan first, then wait for approval.
7. Refactor large files into smaller feature-based components before adding more logic.
8. Preserve existing architecture and avoid unnecessary dependencies.
9. Do not modify unrelated files.
10. After changes, summarize: files changed, reason for change, testing command/result.

## 12. Current known risks

- **No automated tests** — 36 API routes and the AI-generation pipeline are unverified by anything but manual exercise; regressions surface only in the browser
- **`dev.db` is now in `.gitignore`** — the database file is excluded from git; the `.env` placeholder fallback pattern means secrets still shouldn't be committed, but accidental DB leakage via `git add` is mitigated
- **JSON-as-string DB fields** (`jsonOutput`, `editedJson`, `referenceData`, …) have no schema validation — drift between what app code writes and reads is possible and silent
- **Stubbed Google Drive export** — half-built feature, surfaced in the UI as "Not connected"; could read as either WIP or abandoned to a new contributor
- **Design system mid-migration** — `.sketch-*` classes/tokens coexist with legacy shadcn defaults (e.g. `heading-display` ≈ `sketch-heading` aliasing, legacy low-contrast `--border`/`--input` tokens alongside the new `--sketch-line`); pausing the rollout mid-way would leave visual inconsistencies
- **`public/uploads/` has two overlapping storage conventions** — generic `images/videos/logos/` dirs alongside ad hoc per-brand-ID directories; no single documented convention
- Stray `.DS_Store` files present in `lib/`, `prisma/`, and root (minor hygiene)
- A stray `dev.db.backup-before-higgsfield-20260611184523` file sits at the project root (pre-migration DB snapshot) — `*.db.backup-*` is now gitignored, but the file persists on disk; confirm it isn't needed before deleting. There are also `dev.db.backup-before-linkedin-template-20260705161653` and `dev.db.backup-before-restore-20260711-155716` backups.
- `README.md` is still the generic `create-next-app` boilerplate — gives no indication this is "Content Studio"

## 13. Current development phase

The app is **functionally extensive** (~50 API routes, 22 DB models, the original brand → calendar → prompt-generation → library workflow, plus auth/login, a published-posts lifecycle with public workspace reviews, OpenAI image generation/editing, content reports, brand assignments/memberships, calendar attachment interpretation, and LinkedIn publishing scaffolding) and is currently in a **feature-expansion phase** following the addition of multi-user auth and publishing workflows. The "Conceptual Sketch" redesign (`design_system.md`) is ongoing. Documentation and automated testing remain the least-developed areas.

TODO: confirm with the project owner whether finishing the redesign, adding test coverage, or the next feature (e.g. Google Drive export, LinkedIn publishing completion) is the highest near-term priority.
