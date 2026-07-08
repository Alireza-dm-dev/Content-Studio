# Decisions

A log of technical decisions that are **visible in the codebase**, with stated or inferable reasons. This is not a formal ADR process — it's a reverse-engineered record (from the 2026-06-08 audit) meant to help future contributors, human or AI, understand "why is it built this way" without re-deriving it from scratch. Add new entries here when you make a significant technical choice, so the next person doesn't have to guess.

## 1. Technical decisions visible in the project

| Decision | Evidence |
|---|---|
| **SQLite + Prisma 7 + better-sqlite3 adapter**, not Postgres/MySQL | `prisma/schema.prisma` (`provider = "sqlite"`), `lib/prisma.js`, `@prisma/adapter-better-sqlite3` dependency, `dev.db` at the project root |
| **Local-first, single-user, no auth** | No auth code, middleware, or session handling anywhere; the DB ships alongside the app; `CLAUDE.md` frames it as a personal tool |
| **App Router + Server Components for data-fetching, API routes for client mutations** | Server pages declare `export const dynamic = "force-dynamic"` and query `prisma` directly (e.g. `app/generated-prompts/page.js`); `"use client"` components `fetch("/api/...")` (e.g. `app/settings/page.js`'s `ApiKeyCard`) |
| **JavaScript over TypeScript** | `jsconfig.json` (not `tsconfig.json`) and `.jsx`/`.js` source files throughout; only `prisma.config.ts` is TypeScript, which is a Prisma 7 requirement, not a project preference |
| **shadcn/ui on Base UI, not Radix** | `components.json`, `@base-ui/react` dependency, and `CLAUDE.md` explicitly calls this out as a gotcha for AI agents |
| **`Button` uses `@radix-ui/react-slot` for `asChild` despite Base UI elsewhere** | `CLAUDE.md`: "always use `<Button asChild>`... do not use Base UI's `render` prop on Button" — a deliberate, documented exception to the Base UI rule |
| **Tailwind v4 CSS-first config (no `tailwind.config.js`)** | `app/globals.css` uses `@import "tailwindcss"` + `@theme inline`, matching Tailwind v4's new convention; no config file exists |
| **`geist` npm package instead of `next/font/google`** | `CLAUDE.md` states plainly: "The Google Fonts path fails in offline/build environments" |
| **Split Prisma 7 config: schema in `prisma/schema.prisma`, URL in `prisma.config.ts`** | Required by Prisma 7's new configuration split; `CLAUDE.md` documents the root-vs-`prisma/` `dev.db` path gotcha that results from it |
| **Settings stored in DB (`Settings` table), not just `.env`** | `/api/settings` route + `ApiKeyCard` in `app/settings/page.js`, which lets the operator paste/replace the OpenAI key from the UI; `.env`'s copy is described as "a fallback placeholder only" |
| **JSON stored as strings in DB columns** (`jsonOutput`, `editedJson`, `referenceData`, `finalPrompt`) rather than normalized tables | SQLite's JSON ergonomics via Prisma are weaker than Postgres's; storing as text and parsing in app code is the pragmatic tradeoff for variable-shaped AI output, at the cost of DB-level validation |
| **Prompt-template engine with DB-stored, slug-keyed templates and `{{variable}}` interpolation** | `lib/template-utils.js`, `PromptTemplate` model — keeps prompt wording tunable without code deploys |
| **Incremental design-system migration** (CSS utilities → shared primitives → page-level wrappers, one slice at a time) | The `design_system.md` rollout pattern, `CLAUDE.md`'s "preserve existing architecture" / "smallest safe changes" rules, and the visible mid-migration state (legacy and `.sketch-*` tokens coexisting) |
| **Pre-mixed alpha tokens instead of `color-mix()`** for translucent washes/scrims (`--destructive-wash`, `--sketch-scrim`) | Avoids Lightning CSS's automatic solid-color `@supports` fallback for `color-mix()`, which would render hover washes and modal scrims as fully opaque — contradicting the translucency the design calls for |

## 2. Reasons (where stated or strongly inferable)

- **SQLite**: zero-ops local persistence appropriate for a single-user, desktop-style tool — there's no server or hosting infrastructure to manage
- **No auth**: there is exactly one operator; adding authentication would be pure overhead for the stated use case, and would only become necessary if the deployment model changes (see Open Questions)
- **Base UI over Radix**: a newer, lighter primitive layer that shadcn now supports — likely chosen to align with the rest of the "bleeding edge" stack (Next.js 16, React 19, Tailwind v4), which the project explicitly tracks via `AGENTS.md`'s "this is NOT the Next.js you know" warning
- **`geist` package over `next/font/google`**: a documented reliability decision — Google Fonts fetches fail in offline/CI/build environments, and the project clearly wants builds to succeed without network access to Google's font CDN
- **DB-stored settings**: lets a non-technical operator change the OpenAI key from the running app's UI rather than editing `.env` and restarting/redeploying — practical for a tool that's meant to be operated, not just developed
- **String-encoded JSON fields**: SQLite + Prisma's native JSON support is weaker than Postgres's; storing as text and parsing in app code is the pragmatic tradeoff for AI outputs whose shape can legitimately vary, at the cost of DB-level validation
- **Incremental design rollout**: minimizes the risk of breaking a working app mid-redesign, and matches `CLAUDE.md`'s explicit "preserve existing architecture," "make the smallest safe changes" philosophy for AI-assisted edits

## 3. Open questions

- **TODO**: Is there a plan to eventually support multiple users or treat brands as tenants, or will this remain a single-operator tool indefinitely? (This determines whether authentication should ever be added.)
- **TODO**: Is `dev.db` meant to ship with the repo (e.g. as seed/demo data), or should it be gitignored as purely local state? It currently isn't excluded from git — confirm intent before changing this.
- **TODO**: Is the Google Drive export feature still actively planned, or should the Settings UI entry point be simplified/removed until someone is ready to build the OAuth flow?
- **TODO**: Will the root `design_system.md` spec be retired or merged into `docs/DESIGN_SYSTEM.md` once the Conceptual Sketch rollout completes, or is it meant to remain the long-term canonical spec?
- **TODO**: Is there an intended testing strategy at all (even a minimal smoke-test layer), or is manual browser verification accepted as the permanent approach for a project of this scale?
- **TODO**: What's the deployment story, if any — is this meant to stay `localhost`-only forever, or could it eventually run on a personal server or hosting platform (which would reopen the authentication question)?
- **TODO**: Why do both `heading-display`/`sketch-heading` (and the section-heading equivalent) exist as parallel aliases — is one meant to be deprecated, and is there a target date or trigger for collapsing them?
