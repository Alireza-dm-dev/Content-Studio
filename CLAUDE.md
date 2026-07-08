# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Claude Code Working Rules

### Token Saving Rules

When working on this project:

1. Do not scan the entire codebase unless explicitly requested.
2. Before editing, identify the smallest set of files needed.
3. Use search/grep before opening large files.
4. If a file is very large, inspect only the relevant sections.
5. Do not re-read files already inspected in the same session unless necessary.
6. For large features, propose a plan first, then wait for approval.
7. Refactor large files into smaller feature-based components before adding more logic.
8. Preserve existing architecture and avoid unnecessary dependencies.
9. Do not modify unrelated files.
10. After changes, summarize:
   - files changed
   - reason for change
   - testing command/result

### Large File Handling

If a requested change touches a large page or component:

1. First identify the exact functions, components, routes, or API handlers involved.
2. Avoid loading the full file unless required.
3. Prefer small, targeted edits.
4. If the same large file is edited repeatedly, recommend splitting it into smaller files before continuing.
5. When refactoring, preserve current behaviour and UI unless the task specifically asks for changes.

### Before Editing

Before making code changes, briefly state:

1. Which files need to be inspected.
2. Why those files are needed.
3. Whether the task can be completed without scanning the whole project.

## Commands

```bash
npm run dev          # start dev server (default port 3000)
npm run dev -- --port 3030   # start on a specific port
npm run build        # production build (also used to catch compile errors)
npm run lint         # run ESLint
npx prisma migrate dev --name <name>   # create and apply a new migration
npx prisma generate  # regenerate Prisma client after schema changes
npx prisma studio    # open Prisma Studio GUI
```

No test suite is configured.

## Architecture

### Stack quirks to know

- **Next.js 16 / Turbopack** — Read `node_modules/next/dist/docs/` before writing Next.js code; APIs may differ from training data (see AGENTS.md).
- **shadcn/ui uses Base UI**, not Radix UI primitives. Most components in `components/ui/` are built on `@base-ui/react`. The `Button` component is a special case: it wraps `@base-ui/react/button` but adds `asChild` support via `@radix-ui/react-slot` — always use `<Button asChild>` for link-as-button patterns, do **not** use Base UI's `render` prop on Button.
- **Tailwind CSS v4** — config is in `app/globals.css` via `@import "tailwindcss"`, not `tailwind.config.js`.
- **Fonts** — use `geist` npm package (`geist/font/sans`, `geist/font/mono`), NOT `next/font/google`. The Google Fonts path fails in offline/build environments.

### Prisma 7 + SQLite setup

Prisma 7 has a split configuration: schema is in `prisma/schema.prisma` (no `url` field in datasource), and the DB URL lives in `prisma.config.ts` (reads `DATABASE_URL` from `.env`).

- **Migrations** use `DATABASE_URL="file:./dev.db"` which resolves to the **project root** (`dev.db`), not `prisma/dev.db`.
- **Runtime client** (`lib/prisma.js`) uses `@prisma/adapter-better-sqlite3` with a `{ url: "file:<abs-path>" }` config. The absolute path must point to the root `dev.db`.
- After any schema change: run `prisma migrate dev` then `prisma generate`. The generated client lands in `lib/generated/prisma/`.

### Data flow

All database access goes through `lib/prisma.js` (singleton). Server Components and API Route Handlers import `prisma` directly from there. Client Components call API routes via `fetch`.

- **Server Components** (pages that fetch data) use `export const dynamic = "force-dynamic"` to prevent static caching.
- **API routes** are in `app/api/` and follow REST conventions.
- `searchParams` in server page components must be awaited: `const params = await searchParams`.

### Local file storage

Uploaded files are stored under `public/uploads/` with three subdirectories: `images/`, `videos/`, `logos/`. Paths stored in the DB (`filePath` fields) are relative to `public/`.

### Settings

App settings (e.g., `OPENAI_API_KEY`) are stored in the `Settings` table as key-value pairs via `/api/settings`. The `OPENAI_API_KEY` in `.env` is a fallback placeholder only.
