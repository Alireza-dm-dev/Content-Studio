# Project Context for AI

This file is the primary orientation document for AI agents (Claude Code, etc.) working in this repository. Read this before making changes. It summarizes facts gathered from a project audit on 2026-06-08, with an update on 2026-06-15 reflecting the new Higgsfield media-generation integration — verify against current code if something looks stale, and update this file when the facts change.

## 1. Project purpose

Content Studio is a **local-first, single-user AI content production tool** for social media. It lets one operator:
- manage "Brand" profiles (identity, visual style, uploaded reference assets)
- build content calendars of scheduled posts
- generate AI prompts for images, videos, and captions — either from a raw idea or derived from brand identity / reference imagery
- generate actual images/video via the Higgsfield API (`/generated-media`, `app/api/higgsfield/*`, `lib/higgsfield.js`), tracked against an operator token balance
- store generated output in a prompt library and export calendars (CSV/Excel/PDF now; Google Drive planned)

It is **not** a SaaS or multi-tenant product — there is one operator, one local SQLite database, no accounts.

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
- **JavaScript**, not TypeScript — only `prisma.config.ts` is `.ts` (a Prisma 7 requirement)
- **No test framework configured** — `npm run lint` (ESLint) is the only automated check

## 3. Folder map

```
app/
  api/                42 REST route handlers, 15 resource groups (incl. `higgsfield/`)
  page.js             Home
  layout.js           Root shell (fonts, SidebarNav, Toaster, paper-grain bg)
  globals.css         Tailwind v4 theme + Conceptual Sketch design tokens/utilities
  brands/, brand-workspace/, content-calendar/, create-image/,
  create-video/, generated-media/, generated-prompts/, prompt-library/, settings/
components/
  ui/                 shadcn/Base UI primitives (button, card, input, select,
                      badge, page-container, page-header, empty-state, …)
  *.jsx               feature components (modals, galleries, uploaders, sidebar-nav)
lib/
  prisma.js           Prisma singleton (better-sqlite3 adapter)
  ai.js               OpenAI generation pipeline (generateWithPromptTemplate)
  higgsfield.js       Higgsfield SDK config + credential resolution (image/video generation)
  template-utils.js / template-variables.js   prompt templating engine
  brand-identity-utils.js, calendar-export.js, calendar-post-utils.js, uploads.js, utils.js
  generated/prisma/   generated Prisma client (gitignored, regenerate after schema changes)
prisma/
  schema.prisma, seed.js, migrations/ (8 so far)
public/uploads/
  images/, videos/, logos/, brands/, reference-images/, + per-brand-id directories
docs/                 project documentation (this folder)
```
Root also has `.agents/`, `.claude/` (agent/skill scaffolding), `skills-lock.json`, `components.json` (shadcn config), `design_system.md` (252-line "Conceptual Sketch" UI spec), `dev.db` (SQLite file), `CLAUDE.md`, `AGENTS.md`.

## 4. Important files

| File | Role |
|---|---|
| `app/layout.js` | Root shell: fonts, `SidebarNav`, `Toaster`, global paper-grain background |
| `components/sidebar-nav.jsx` | Defines the entire primary navigation / IA (9 routes, incl. Generated Media) |
| `lib/prisma.js` | Prisma singleton — all DB access goes through this |
| `lib/ai.js` | `generateWithPromptTemplate()` — loads a `PromptTemplate`, interpolates variables, calls OpenAI with optional images |
| `lib/template-utils.js` / `template-variables.js` | Prompt templating engine (placeholders, variable extraction, validation) |
| `prisma/schema.prisma` + `seed.js` | 11-model schema and DB seed script |
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
- 15 models: `Brand` (the hub — 1-to-many to nearly everything), `BrandIdentity`, `UploadedFile`, `ContentCalendar`, `CalendarPost`, `VideoStoryboard`, `GeneratedPrompt`, `PromptTemplate`, `ReferenceImageAnalysis`, `CombinedVisualDirection`, `Settings` (key/value store), plus 4 added for the Higgsfield integration: `HiggsfieldModel`, `OperatorTokenBalance`, `TokenLedgerEntry`, `GeneratedMedia`
- IDs are `cuid()`; most foreign keys are optional with `onDelete: SetNull` (a few `Cascade`, e.g. `Brand → BrandIdentity`, `ContentCalendar → CalendarPost`)
- Several fields store **JSON as strings** (`jsonOutput`, `editedJson`, `referenceData`, `finalPrompt`) — no DB-level schema validation; shape is enforced only in app code
- 10 migrations exist (`2026-06-02` → `2026-06-11`), most recently `20260611151726_add_higgsfield_foundation`; generated client lives at `lib/generated/prisma/` (gitignored — must run `prisma generate` after pulling schema changes)
- App settings (e.g. `OPENAI_API_KEY`, `HIGGSFIELD_API_KEY`) are stored in the `Settings` table via `/api/settings`; the `.env` values are fallback placeholders only

## 8. Auth notes

**There is no authentication or authorization system.** No `next-auth`, no middleware, no session/JWT/login code. This is intentional — a single-user local tool.

The only auth-adjacent code is a **stubbed Google Drive OAuth integration** (`app/api/content-calendar/[calendarId]/export/google-drive/route.js`), surfaced in Settings as "Not connected." It requires `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` env vars and an OAuth callback that does not yet exist — explicitly unimplemented, not a bug.

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
- **`dev.db` (SQLite, ~724 KB) sits in the repo root** and is **not** in `.gitignore` — confirm it isn't accidentally committed; double check no secrets live in its `Settings` table before sharing the repo
- **JSON-as-string DB fields** (`jsonOutput`, `editedJson`, `referenceData`, …) have no schema validation — drift between what app code writes and reads is possible and silent
- **Stubbed Google Drive export** — half-built feature, surfaced in the UI as "Not connected"; could read as either WIP or abandoned to a new contributor
- **Design system mid-migration** — `.sketch-*` classes/tokens coexist with legacy shadcn defaults (e.g. `heading-display` ≈ `sketch-heading` aliasing, legacy low-contrast `--border`/`--input` tokens alongside the new `--sketch-line`); pausing the rollout mid-way would leave visual inconsistencies
- **`public/uploads/` has two overlapping storage conventions** — generic `images/videos/logos/` dirs alongside ad hoc per-brand-ID directories; no single documented convention
- Stray `.DS_Store` files present in `lib/`, `prisma/`, and root (minor hygiene)
- A stray `dev.db.backup-before-higgsfield-20260611184523` file sits at the project root (pre-migration DB snapshot) — same untracked-large-file concern as `dev.db` itself; confirm it isn't needed before deleting
- `README.md` is still the generic `create-next-app` boilerplate — gives no indication this is "Content Studio"

## 13. Current development phase

The app is **functionally built out** (42 API routes, 15 DB models, a complete brand → calendar → prompt-generation → library workflow, a working AI pipeline, plus a newly-added Higgsfield image/video generation pipeline with token balance tracking) and is currently in a **UI/design-system migration phase**: the "Conceptual Sketch" redesign (`design_system.md`) is being rolled from CSS utilities → shared primitives → page-level wrappers, page by page, with the 7 main pages done as of the 2026-06-08 audit (a `generated-media` page has since been added — TODO: confirm whether it has adopted `PageContainer`/`PageHeader`/`EmptyState` and `.sketch-*` styling). Documentation and automated testing are the least-developed areas.

TODO: confirm with the project owner whether finishing the redesign, adding test coverage, or something else (e.g. Google Drive export) is the highest near-term priority.
