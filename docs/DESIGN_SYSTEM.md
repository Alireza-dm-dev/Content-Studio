# Design System

This documents the **current, observed state** of styling in the codebase — a snapshot from the 2026-06-08 audit, not the aspirational spec. The aspirational spec lives in `design_system.md` at the project root (the "Conceptual Sketch" redesign brief, ~252 lines) and should be treated as the source of truth for new work; this file tracks how much of it has actually landed and what's left.

## 1. Existing styling approach

- **Tailwind CSS v4**, CSS-first configuration — theme tokens and custom utilities live in `app/globals.css` (`@theme inline`, `@layer base`, `@layer components`); there is **no** `tailwind.config.js`
- **shadcn/ui** component layer (`components.json`: style `base-nova`, base color `neutral`, RSC enabled, JSX not TSX) running on **Base UI** (`@base-ui/react`) primitives rather than Radix
- **OKLCH color space** for all theme tokens
- **Light/dark theming** via `next-themes` and a `.dark` class variant (`@custom-variant dark`)
- A global **paper-grain texture** is applied to `<body>` (an inline SVG fractal-noise filter, multiply-blended at low opacity) — this is the foundation of the "sketch paper" feel; per the spec it should not be duplicated on individual page surfaces (a `.sketch-paper-bg` utility exists but is reserved for large surfaces apart from `<body>`, to avoid double-layering grain)
- An in-progress redesign — **"Conceptual Sketch"** — layers a hand-drawn, ink-on-paper, single-accent aesthetic on top of the shadcn base via new `--sketch-*` tokens and `.sketch-*` utility classes in `@layer components`, without changing component APIs or Base UI behavior

## 2. Existing colours

Defined as OKLCH custom properties in `:root` (light) / `.dark` in `app/globals.css`. Light-mode values:

| Token | Value | Role |
|---|---|---|
| `--background` | `oklch(0.965 0.012 85)` | Warm off-white "sketch paper" canvas |
| `--foreground` | `oklch(0.225 0.02 55)` | Near-black "ink" text |
| `--card` / `--popover` | `oklch(0.98 0.009 87)` | Slightly lighter paper surface |
| `--primary` | `oklch(0.24 0.02 55)` | Solid ink fill |
| `--secondary` | `oklch(0.905 0.013 78)` | Tinted-neutral panel |
| `--muted` | `oklch(0.915 0.013 80)` | Tinted-neutral muted surface/text-bg |
| `--accent` | `oklch(0.85 0.06 88)` | Warm highlight |
| `--destructive` | `oklch(0.55 0.2 27)` | Red-ink alarm color |
| `--border` | `oklch(0.225 0.02 55 / 16%)` | **Legacy** low-contrast border (≈1.4:1 against `--background` — short of the WCAG 1.4.11 3:1 UI-boundary guidance) |
| `--input` | `oklch(0.225 0.02 55 / 22%)` | **Legacy** low-contrast input border (≈1.6:1) |
| `--ring` | `oklch(0.55 0.17 35 / 50%)` | Focus ring |
| `--radius` | `0.5rem` | Legacy shadcn base radius |
| `--sidebar` | `oklch(0.955 0.013 85)` | Sidebar surface tint |
| `--accent-vermilion` | `oklch(0.55 0.18 35)` | **The single Conceptual Sketch accent** — "red ink" splash, used sparingly per the "rule of one accent" |
| `--accent-vermilion-foreground` | `oklch(0.97 0.012 85)` | Text-on-vermilion |
| `--sketch-ink` | `var(--foreground)` | Ink alias used by sketch utilities |
| `--sketch-line` | `oklch(0.225 0.02 55 / 55%)` | High-contrast ink-line border (≈3.8:1 — passes the 3:1 guidance) |
| `--sketch-shadow` | `oklch(0.225 0.02 55 / 14%)` | Flat offset "poster shadow" tone |
| `--sketch-scrim` | `oklch(0.225 0.02 55 / 45%)` | Modal backdrop scrim — pre-mixed alpha, not `color-mix()` |
| `--destructive-wash` | `oklch(0.55 0.2 27 / 12%)` | Destructive-button hover wash — pre-mixed alpha, not `color-mix()` |
| `--radius-sketch-control` | `5px 8px 6px 9px / 8px 5px 9px 6px` | Shared asymmetric "control tier" radius (buttons, inputs, badges) |

> Note the **coexistence** of legacy `--border`/`--input` (low contrast, ≈1.4–1.6:1) with the new `--sketch-line` (≈3.8:1) — an intentional-but-unfinished transition; see the TODO list below.
>
> `--destructive-wash` and `--sketch-scrim` were deliberately defined as flat pre-mixed oklch values rather than `color-mix()` expressions, because Lightning CSS auto-generates a solid-color `@supports` fallback for `color-mix()` that would render destructive-button hovers as solid red fills and modal scrims as fully opaque — contradicting the translucency the design calls for.

## 3. Existing typography

- **Geist Sans** (`--font-sans`, via the `geist` npm package — *not* `next/font/google`, which fails offline/in CI per `CLAUDE.md`) for all UI and display text
- **Geist Mono** (`--font-mono`) reserved for short "annotation" strings: eyebrows, captions, nav labels, table meta, badges, timestamps
- Conceptual Sketch type scale, defined in `app/globals.css` `@layer components` (each aliased to a legacy shadcn-style name):
  - `.heading-display` / `.sketch-heading` — `clamp(2.25rem, 1.5rem + 3vw, 3.75rem)`, weight 800, tracking `-0.02em` — page titles / hero moments, intended as one per view
  - `.heading-section` / `.sketch-subheading` — `clamp(1.375rem, 1.1rem + 1vw, 1.875rem)`, weight 700, tracking `-0.01em` — section/card-group titles
  - `.label-sketch` — uppercase Geist Mono, letter-spacing `0.16em`, `0.6875rem` — "margin note" eyebrows/captions/badges
- TODO: the dual naming (`heading-display`/`sketch-heading`, `heading-section`/`sketch-subheading`) is a known **naming-reconciliation debt** explicitly flagged in `design_system.md` — pick one name per scale and remove the alias once the rest of the redesign settles

## 4. Component style rules (observed)

- **Surface tier** (`sketch-frame`, `sketch-card`, `sketch-modal`) shares one irregular four-corner radius family — described in the spec as "cut from the same sketchbook page." **Control tier** (`sketch-button`, `sketch-input`, `sketch-badge`, nav rows) shares the separate `--radius-sketch-control` signature. The two tiers are deliberately distinct but harmonious
- **Offset poster shadow**: flat, hard-edged `2px 2px 0 0 var(--sketch-shadow)` on cards/buttons, `4px 4px 0 0` on modals — never a soft/blurred elevation
- **Single-accent rule**: vermilion (and its destructive red-ink twin) appears on at most 1–2 *steady-state* elements per view (e.g. one primary CTA + the active-nav mark); transient interaction states (focus rings, hover/press flashes, validation messaging) are exempt from the budget but must use the same red-ink register for consistency
- **Press feedback**: primary/accent buttons collapse their offset shadow to `0 0 0 0` and translate by the shadow's offset on `:active` — "pressed flat against the page"
- **`Button`** (`components/ui/button.jsx`) wires `.sketch-button` plus variant classes (`sketch-button-primary/outline/secondary/ghost/destructive`); the `link` variant stays a plain text link and opts out of the sketch treatment
- **`Input`/`Textarea`/`SelectTrigger`** wire `.sketch-input` (paper surface, ink-line border, control-tier radius); legacy `border-input`/`rounded-lg`/`dark:bg-input/30` utilities were stripped to avoid Tailwind-utility-vs-component-layer conflicts (in Tailwind v4's cascade, `@layer utilities` always wins over `@layer components`)
- **`Card`** wires `.sketch-card` (paper surface, ink-line border, irregular radius, offset shadow). Confirmed usage on `app/create-image/page.js`, where option cards combine `Card` with `hover:border-foreground hover:bg-muted/40` and an inner `sketch-frame icon-sketch` tile for the leading icon — the spec calls for media/icons inside cards to live in an inner `sketch-frame`, never a nested `sketch-card`
- **`Badge`** wires `.sketch-badge`; only the `default`/highlight variant may use a vermilion fill — other variants (e.g. `secondary`, `outline`, used for type/tool tags in `app/generated-prompts/page.js`) stay greyscale-on-paper
- **New layout primitives** `PageContainer`, `PageHeader` (`eyebrow`/`title`/`description`/`backHref`, `level="page"|"section"`), `EmptyState` (`icon`/`title`/`description`/optional action) standardize page shells. Confirmed adopted on `app/settings/page.js`, `app/generated-prompts/page.js`, and `app/create-image/page.js` (and, per the prior session's work, all 7 main pages: Home, Brands, Content Calendar, Create Image, Create Video, Generated Prompts, Settings)
- Card titles on small grid tiles (e.g. the Create Image option cards) use plain `text-sm font-semibold tracking-tight` rather than `.sketch-subheading` — the section-heading scale (22–30px) reads as disproportionate at that size, and `text-base`/`text-sm` Tailwind utilities would override the component-layer `font-size: clamp(...)` anyway

## 5. TODO — open design-system items

- **TODO**: Reconcile `heading-display`/`sketch-heading` and `heading-section`/`sketch-subheading` naming (pick one name per scale, per `design_system.md`'s own naming-reconciliation note)
- **TODO**: Resolve the `SelectContent` (apparently `rounded-lg`, regular radius) vs. `SelectTrigger` (`.sketch-input`, irregular control-tier radius) visual mismatch
- **TODO**: Decide whether to migrate the legacy low-contrast `--border`/`--input` tokens (≈1.4–1.6:1) to the higher-contrast `--sketch-line` register (≈3.8:1), or document why both should remain
- **TODO**: Confirm whether detail/sub-pages (`brands/[id]`, `content-calendar/[id]`, `brand-workspace`, `prompt-library`, and the multi-step create flows like `create-image/raw-idea`, `create-image/from-brand`) have adopted `PageContainer`/`PageHeader`/`EmptyState` and `.sketch-*` styling, or are still pending
- **TODO**: `--accent-vermilion` measures roughly 4.7–4.8:1 against the paper background — passes AA for normal text but is close to the 4.5:1 floor; flag if it's ever used for small or thin text directly on the canvas rather than as a fill/border accent
- **TODO**: Confirm the project owner's intended end-state for the root `design_system.md` spec — should it eventually be merged into this file once the rollout completes, or remain a standalone reference document?
