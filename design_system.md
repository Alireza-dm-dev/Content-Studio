# Conceptual Sketch — Design System

Single source of truth for the "Conceptual Sketch" redesign of Content Studio.
**Reference this file in future prompts** (e.g. "follow `design_system.md` §8 when restyling the Button component") instead of re-describing the aesthetic each time — it keeps every page/component pulling toward the same visual language.

> Status note: this document specs the *target* system. Some pieces are already implemented in `app/globals.css` (marked **Exists** below); most components have not yet adopted them. No UI was changed while writing this file.

---

## 1. Design philosophy

Content Studio is a place where ideas get drafted, annotated, and iterated before they ship as social posts. **Conceptual Sketch** makes the UI itself feel like an open sketchbook / ideation wall — which mirrors what the tool actually does (draft → mark up → refine → publish), rather than being a decorative skin bolted on top.

Three governing ideas:

- **Spontaneity, but disciplined.** The mood is "visible hand" — imperfect lines, asymmetric corners, off-kilter accents — but the imperfection is a *fixed vocabulary* (specific irregular radii, specific offset shadows, specific rotation values), not randomness. One drawn-by-the-same-hand signature per component family is what makes it read as a system instead of a mockup generator.
- **Raw, behind-the-scenes mood, minimal accent.** Greyscale ink-on-paper dominates; a single muted "red ink" accent is used sparingly, like a circle drawn around the one thing that matters on a page.
- **Function first.** The sketch identity lives in borders, type, texture, and accent marks. It must never reduce density, scanability, contrast, or interaction clarity. Expressive/poster treatment belongs in headers, empty states, and hero moments; data-heavy surfaces (tables, forms, lists) stay calm and legible.

## 2. Visual references summary

**Reference-image check:** `public/uploads/reference-images/` was inspected for this task. Its contents (stroller product photography, a vintage-pram shop-window photo, a pop-art "Rosie the Riveter" poster, and a flat-lay of tools) do not match the Conceptual Sketch brief — no hand-drawn lines, crosshatching, or sketchbook qualities. These look like uploads from an unrelated feature (e.g. brand reference uploads for content generation), not design references for this redesign. **This system is therefore derived from the written style brief's 12 core elements**, not from those images — flag to the user if different reference files exist elsewhere.

Distilled brief, grouped into the working vocabulary used throughout this doc:

- **Surface & line:** off-white sketch-paper canvas, subtle grain, thin ink/pencil-weight borders, irregular hand-drawn frames, crosshatch shading reserved for decorative illustration only.
- **Palette:** greyscale-dominant, warm-toned (paper + ink, not cool digital grey), one disciplined accent color used like a red-pen annotation.
- **Type:** large expressive editorial-poster headlines paired with small mono "margin note" captions/labels — a typed-annotation-next-to-a-drawing contrast.
- **Composition:** editorial/zine layout — generous margins, asymmetric framing, poster-style section openers, restrained data surfaces underneath.
- **Illustration:** simple single-stroke line art; no filled glyphs, gradients, or 3D icons.

## 3. Color palette

Already defined in `app/globals.css` (`:root` / `.dark`) and exposed to Tailwind via `@theme inline`. **Reuse these tokens — never hardcode new `oklch()`/hex values.**

| Token | Role | Light value (approx.) | Notes |
|---|---|---|---|
| `--background` | Sketch-paper canvas | warm off-white `oklch(0.965 0.012 85)` | Base of `sketch-paper-bg` |
| `--foreground` | Ink | warm near-black `oklch(0.225 0.02 55)` | Primary text/line color; also `--sketch-ink` |
| `--card` / `--popover` | Paper surface (cards, menus) | slightly lighter paper `oklch(0.98 0.009 87)` | Reads as a sheet laid on the canvas |
| `--muted` / `--secondary` | De-emphasized surfaces & text | warm light greys | Hover washes, secondary buttons, meta backgrounds |
| `--border` / `--sketch-line` | Hand-drawn outline | translucent ink `oklch(0.225 0.02 55 / 16–55%)` | `--sketch-line` is the heavier, more visible "drawn" stroke |
| `--sketch-shadow` | Offset poster shadow | translucent ink `14%` | Flat hard-edged shadow, never blurred |
| `--accent-vermilion` | **The one accent** — muted red ink | `oklch(0.55 0.18 35)` | Reserved for emphasis: active-nav mark, focus ring, key CTA, links |
| `--destructive` | Error/alarm | `oklch(0.55 0.2 27)` | Intentionally close in tone to the accent — both read as "red ink"; **context** (icon shape, copy, placement) distinguishes "emphasis" from "alarm," not a second hue. Keep it this way — do not separate them into visually distinct reds, that would create a second accent family. |

**Rule of one accent:** vermilion (and its alarm twin, destructive) should appear on at most 1–2 *steady-state* elements per view — e.g. one primary CTA plus the active-nav mark. Interaction-only appearances (the focus ring on whatever currently has focus, hover/press flashes, validation messages) are *transient* and don't count against that budget — only one can be visible at a time, and they must use the **same** red-ink register, never a different hue, so the system still reads as one accent family rather than several. Everything else stays greyscale-on-paper. Dark mode keeps the same architecture — paper/ink roles invert, vermilion brightens to hold contrast on dark paper (already specced in `.dark`).

## 4. Typography system

Stack (already wired in `app/layout.js`): **Geist Sans** (`--font-sans`) for all UI text and display type, **Geist Mono** (`--font-mono`) reserved for short "annotation" strings — eyebrows, captions, nav labels, table meta columns, badges, timestamps. This pairing gives the "typed caption beside a drawing" contrast without sourcing a hand-lettered display face.

| Class | Maps to | Spec | Use |
|---|---|---|---|
| `sketch-heading` | existing `.heading-display` | `clamp(2.25rem, 1.5rem + 3vw, 3.75rem)`, weight 800, tracking `-0.02em`, line-height 1.05 | Page titles, hero/poster moments — **one per view** |
| `sketch-subheading` | existing `.heading-section` | `clamp(1.375rem, 1.1rem + 1vw, 1.875rem)`, weight 700, tracking `-0.01em` | Section / card-group titles |
| Body | `font-sans`, 400–500 | `leading-relaxed`, `--foreground` for primary copy, `--muted-foreground` for secondary | Paragraphs, descriptions, form help text |
| `label-sketch` (annotation) | existing `.label-sketch` | `font-mono`, uppercase, `letter-spacing: 0.16em`, `0.6875rem`, `--muted-foreground` | Eyebrows, nav labels, table headers, badges, timestamps |

**Rules:** never introduce a third typeface. Never set body copy or long-form text in mono — it's an annotation voice, not a reading voice. Keep prose blocks ~60–80ch wide to preserve the "page" feel.

## 5. Spacing system

No custom spacing scale needed — reuse Tailwind's default 4px-based `gap-*`/`p-*`/`space-*`.

- **Sketchbook rhythm:** slightly more generous than typical dense-SaaS spacing, so hand-drawn frames have room to breathe and don't visually collide. Page gutters `p-6`–`p-8` (24–32px) minimum, `gap-6` between major sections, `gap-4` within a card/group, `gap-2` between tightly related inline elements (label + value, icon + text).
- **Regular grid, irregular surface:** the *layout grid* stays perfectly regular. Irregularity belongs to borders/frames drawn on top of it — "hand drawn on a clean grid," never "the grid itself is wobbly."

## 6. Border and frame style

- **Stroke weight:** 1.5px ink-line using `--sketch-line` — thin enough to read as pencil/ink, never a heavy CAD-style border.
- **Irregular radii as fixed signatures, in two tiers** (so every component is legibly part of one family without being identical):
  - *Surface tier* — `sketch-frame`, `sketch-card`, `sketch-modal`: share one asymmetric four-corner radius family (already specced for `.sketch-frame`/`.sketch-card`) so containers read as cut from the same sketchbook page.
  - *Control tier* — `sketch-button`, `sketch-input`, badges/tags: share a second, smaller asymmetric radius family — its own fixed four-corner signature, distinct from but harmonious with the surface tier — so the whole interactive/form vocabulary feels drawn by the same hand.
  - **Never randomize per render.** Fixed values only — randomization causes hydration mismatches and visual jitter. "Hand drawn" means "drawn once, reused everywhere," not "different every load."
- **Offset poster shadow:** flat, hard-edged `2px 2px 0 0 var(--sketch-shadow)` — a card cut out and laid slightly askew on the page, not a glowing digital surface. Modals get a heavier version (e.g. `4px 4px 0 0`).
- **Usage discipline:** reserve frames for discrete content blocks (cards, modals, callouts, media previews). Don't wrap every nested element in its own frame — frame-on-frame reads as clutter, not craft.

## 7. Texture usage

A single global paper-grain layer is already applied to `body` (`globals.css`): an inline SVG fractal-noise filter, desaturated, `multiply`-blended at `opacity: 0.05`.

- **Cap opacity at ~0.05–0.06.** The brief explicitly says "subtle" — this is a mood cue, not a pattern.
- **Don't stack grain.** One texture layer per view (canvas-level). Adding per-card or per-illustration grain on top compounds into visual noise and hurts text contrast.
- **`sketch-texture` (new):** an opt-in overlay for large *decorative* surfaces only (hero/poster panels, modal scrims, empty-state illustrations) — same noise technique at a marginally higher opacity (~0.08), applied via `::before` with `pointer-events: none` so it never sits between the user and readable text or intercepts interaction.

## 8. Button styles

Define **`sketch-button`** (not yet applied — `components/ui/button.jsx` currently uses plain shadcn `rounded-lg` variants):

- **Base:** paper-toned surface, 1.5px `--sketch-line` border, the **control-tier** radius signature from §6 (shared with inputs and badges, so the whole interactive vocabulary reads as one hand).
- **Primary:** solid ink fill (`--primary`) with paper-colored text, offset poster shadow; on press, the shadow collapses to `0 0` and content translates by the shadow's offset — "pressed flat against the page."
| Variant | Treatment |
|---|---|
| Primary | Solid ink fill + paper text + offset shadow |
| Secondary / Outline / Ghost | Paper/transparent fill, ink-line border only; fill appears on hover (`--secondary`/`--muted`) |
| Accent / key CTA | The **one** place vermilion may fill a background — at most one per view (e.g. "Generate", "Publish") |
| Destructive | Ink-line border + text in the shared red-ink tone; solid fill reserved for confirm-destructive dialogs only |

- **Labels:** sentence case for primary actions; an optional `label-sketch` micro-label for utility/icon-only buttons (mono tooltip). The tooltip is a *visual supplement* — icon-only buttons still need an `aria-label` carrying the same text, so screen-reader users get the identical information (see §19).
- **Motion:** keep press/hover transitions snappy (120–160ms) — sketch ≠ slow.

## 9. Input, textarea, and select styles

Define **`sketch-input`** (covers `input.jsx`, `textarea.jsx`, `select.jsx`):

- Paper-toned background, 1.5px `--sketch-line` border, the **control-tier** radius signature from §6 (shared with buttons and badges — dense forms shouldn't feel sloppy).
- Field label set in `label-sketch` (mono uppercase) positioned above the field with a small gap — reads like a margin note captioning the field.
- **Focus:** border goes to full-opacity ink + a soft vermilion ring (`--ring`, already accent-tinted) — this is the accent's *other* sanctioned use (interaction feedback), which is exactly why it must stay rare elsewhere.
- **Textarea:** same border/radius/focus language, generous `min-height`, de-emphasized resize handle.
- **Select/combobox:** identical border/radius/focus treatment; chevron rendered as a simple 1.5px line-art mark, never a filled glyph (consistent with §18).
- **Validation:** error state changes the border tone *and* prints a short mono annotation beneath the field — never color alone (see §19).

## 10. Card styles

`.sketch-card` **already exists** and is wired into `components/ui/card.jsx`:

- Paper surface, 1.5px ink-line border, four-corner irregular radius, flat offset poster shadow.
- **Interactive hover:** translate `-1px` and grow the shadow offset by ~1px — "the card peels slightly off the page." Never a soft glow/blur elevation change (breaks the flat-paper illusion).
- **Media inside cards:** keep thumbnails/previews/video in **full color** inside an inner `sketch-frame`. The ink-line frame carries the mood; the user's actual creative output stays true-to-color — color accuracy is functional here, not decorative.
- Don't nest `sketch-card` inside `sketch-card`; separate sub-sections with a plain `--muted` panel or a `sketch-divider` instead.

## 11. Modal styles

Define **`sketch-modal`**:

- A larger `sketch-frame` "popped" off the page: heavier offset shadow (`4px 4px 0 0`), paper background, same ink-line language, centered over a darkened scrim that combines a semi-opaque ink overlay with `sketch-texture` at low opacity.
- **Close affordance:** a small two-stroke hand-drawn "✕" (line art, not a filled icon button), sized to the 24×24px minimum hit-target.
- **Header:** mono eyebrow + `sketch-subheading` title, optional `sketch-divider` beneath.
- **Footer:** right-aligned `sketch-button`s; primary action follows the single-accent rule from §8.
- **Motion:** scale-and-fade in, no bounce/elastic easing — crisp like a page being laid down, not a cartoon popping up. Respect `prefers-reduced-motion`.

## 12. Table styles

Define **`sketch-table`**:

- **No vertical grid lines** — only horizontal `sketch-divider` hairlines between rows, evoking a ledger page rather than a spreadsheet.
- Header row in `label-sketch` mono-uppercase, sitting over a slightly heavier (2px) ink-line bottom rule.
- **No zebra striping** (too "corporate dashboard"). Rely on generous row padding (`py-3`/`py-4`) and the divider rhythm for scanability instead.
- Row hover: a faint `--muted` wash only — no border changes, preserves the ledger feel.
- Typographic contrast within a row: primary identifying column in `font-sans`; secondary/meta columns (dates, counts, status) in mono — "handwritten entry + typed margin note."
- Long tables: prefer a `label-sketch`-style pagination caption ("Showing 1–20 of 142") over infinite scroll — fits the printed-page mood and keeps state legible.

## 13. Navigation and sidebar style

Define **`sketch-nav-item`** / **`sketch-nav-active`**:

- Sidebar surface uses `--sidebar` (a paper tone subtly distinct from the main canvas), separated from content by a single ink-line `--sidebar-border`.
- Items: `label-sketch`-style mono-uppercase labels, generous vertical padding, a fixed-size simple line-art icon, separated by faint `sketch-divider` rules — **not** boxed/pill backgrounds.
- **Active state:** a small hand-drawn vermilion mark beside the label (a short underline stroke or asterisk) — like someone circled this item in red ink — rather than filling the row with color. This is what keeps the accent feeling like an annotation instead of a theme color.
- Hover: subtle `--muted` wash, no layout shift. Collapsed/icon-only state: icons alone with mono tooltips on hover/focus.

## 14. Page header style

- **Eyebrow:** `label-sketch` mono-uppercase micro-label naming the section ("BRAND WORKSPACE", "CONTENT CALENDAR").
- **Title:** `sketch-heading` — one large expressive display title per page.
- Optional one-line supporting copy in body type / `--muted-foreground`.
- Optional `sketch-divider` beneath the header block — a hand-drawn rule under a poster headline, separating it from page content.
- Actions (primary/secondary `sketch-button`s) right-aligned at the header's baseline; primary action follows the single-accent rule.

## 15. Empty state style

- Centered composition: a simple single-stroke line-art illustration (never a filled icon or stock illustration) inside a loosely-dashed `sketch-frame` — "a blank page waiting to be sketched on."
- `sketch-subheading` for the heading, body copy in `--muted-foreground` for the explanation, **one** clear primary `sketch-button` action.
- Optional `label-sketch` caption beneath ("NOTHING HERE YET — START YOUR FIRST DRAFT").
- Stay greyscale/ink-toned even here — restraint in a "creative" moment is part of the mood; don't reach for new accent colors to make it feel friendlier.

## 16. Badge and tag style

- Small mono-uppercase pill (`label-sketch` type scale), 1px ink-line outline, the **control-tier** radius signature from §6 scaled down, transparent/paper fill by default.
- **Status communicated by icon shape + label text first, color second** — pair a small line-art glyph (check / clock / slash / circle) with the word, never color alone.
- Vermilion fill/outline is reserved for a single "highlight" tag type per context (e.g. "NEW", "FEATURED") — routine status badges stay greyscale-on-paper.

## 17. Toast and alert style

- Rendered as a small "poster card": `sketch-frame` treatment with an offset shadow, popped at a screen corner (toast) or inline at the top of a section (alert).
- Icon: simple 1.5px single-stroke line-art mark (info circle / check / triangle / slash), placed left of the message — never a filled/colored icon badge.
- **Color discipline:** info/success/neutral stay ink-on-paper only; warnings/errors use the shared red-ink register from §3 (vermilion ≈ destructive) — always paired with a distinct icon shape and explicit label text, never color alone.
- Dismissal: the same small line-art "✕" and hit-target rules as the modal close (§11). Toasts stack with a consistent offset; an optional mono timestamp may appear.

## 18. Icon and illustration style

- Icon set: `lucide-react` (already in use). Apply `.icon-sketch` (**exists** — sets `stroke-width: 1.5px`) globally to functional icons so glyphs read closer to pen line work — don't apply it selectively, that creates mismatched stroke weights across the UI.
- No filled/glyph icon styles, no gradients, no 3D/skeuomorphic icons anywhere in functional UI.
- Illustrations (empty states, onboarding, hero moments): simple single-line-weight line art in ink tones. **Crosshatch shading is decorative-illustration-only** — never apply it to functional icons or as a background pattern behind interactive content (it competes with focus/hover states).
- Keep stroke weight consistent across an entire illustration/icon family — mixed weights break the "drawn by one hand" illusion.

## 19. Accessibility rules

- **Contrast:** ink-on-paper pairs must meet WCAG AA — 4.5:1 for body text, 3:1 for large text (≥24px / 19px bold) and UI component boundaries. Re-check whenever `--foreground`/`--background` lightness values change.
- **Color is never the only signal.** Status, validation, and active-nav states must pair the accent/destructive tone with an icon, label, underline, or shape change — required for color-blind users, and it's also exactly what "annotation" mood favors anyway (marks + text over color blocks).
- **Focus stays crisp.** `focus-visible` rings (`--ring`, accent-tinted) must render at full opacity and sufficient width regardless of how rough a component's resting border looks. The sketch aesthetic is a surface treatment — it must never soften focus indicators.
- **Texture vs. text:** the grain overlay must stay ≤0.06 opacity and never sit between text and its background at contrast-reducing levels. Check contrast with the texture *composited*, not against flat token values.
- **Motion:** `sketch-tilt-*`, hover-lift, press-translate, and modal/toast transitions must respect `prefers-reduced-motion: reduce` — fall back to instant state changes, no transforms.
- **Hit targets:** ≥24×24px minimum (44×44px recommended for primary/touch actions), even for "small annotation-style" buttons and icon-only controls.
- **Icon-only controls need a real accessible name.** The mono tooltip in §8/§13 is a sighted-user supplement, not a substitute — pair it with `aria-label`/`aria-labelledby` carrying the same text so screen readers announce it too.
- **Reflow at 400% zoom / 320px width (WCAG 1.4.10):** offset shadows, irregular frames, and `clamp()`-based display type must not cause horizontal scrolling or clipped content. Test `sketch-frame`/`sketch-card`/`sketch-modal`/`sketch-table` surfaces at high zoom, not just narrow viewports.
- **Semantics:** irregular visual framing must never change DOM/reading order; decorative line-art and texture layers get `aria-hidden="true"`.

## 20. Responsive rules

- Display type already uses `clamp()` (`.heading-display` / `.heading-section`) so headlines scale fluidly without manual breakpoint overrides — keep new type scales on this pattern.
- **Dial back "poster" effects on small viewports:** reduce/remove `sketch-tilt-*` rotation and large offset shadows on mobile cards — touch surfaces should feel calm and stable, not skewed.
- Sidebar nav collapses to a top sheet/drawer below `md`, retaining `sketch-nav-item`/mono-label styling so the mood persists in compact form.
- `sketch-table` becomes a stacked list of small `sketch-card`-style row blocks below `sm`/`md`, rather than horizontal scrolling — fits the editorial mood better and avoids horizontal-scroll accessibility issues.
- Keep the *relative* breathing room from §5 at all sizes — shrink absolute values (`p-8` → `p-4`) but don't let frame borders collide with viewport edges.

## 21. Do and do-not rules

**Do**
- Keep the underlying layout grid clean and regular; let "hand drawn" personality live in borders, type, accents, and texture layered on top.
- Give each component family one fixed irregular-radius + shadow signature, reused consistently — cards always look like cards, buttons always look like buttons.
- Reserve the red-ink (vermilion/destructive) register for ≤1–2 *steady-state* elements per view (e.g. one CTA + the active-nav mark); transient interaction states (focus, hover, validation) may use it too since only one shows at a time — restraint in the steady state is what makes it read as an accent rather than a theme color.
- Let real user content (images, video, brand colors) stay full-color inside ink-line frames — the frame carries the mood, the content stays true.
- Use mono "annotation" type for short labels, eyebrows, meta columns, and captions only.

**Do not**
- Don't rotate, tilt, or skew dense functional surfaces (tables, forms, long lists) — `sketch-tilt-*` is for hero/decorative/empty-state moments only.
- Don't stack texture layers (global grain + per-card grain + illustration grain) — one texture location per view.
- Don't introduce a second accent hue "for variety" — use the existing accent, type weight/size, or an annotation mark instead.
- Don't randomize border-radius or rotation per render — fixed signatures only (causes hydration mismatches and visual jitter).
- Don't let "rough" borders soften focus rings, validation cues, or hit-target sizing — the sketch mood is a surface treatment, not license to reduce usability.
- Don't set body copy, long-form text, or dense data in mono type — it's an annotation voice, not a reading voice.

## 22. Implementation notes for Tailwind and CSS classes

- **Home base:** all tokens and component-level utilities live in `app/globals.css` — custom properties in `:root`/`.dark`, mapped to Tailwind via `@theme inline`, component utilities in `@layer components`. This project uses Tailwind v4's CSS-first config; **don't** introduce a parallel `tailwind.config.js`.
- **Reuse tokens, never hardcode.** Any new color must reference an existing `--*` custom property (or a new one added to both `:root` and `.dark`, then mapped in `@theme inline`) — never a raw `oklch()`/hex value inside a utility class or inline style.
- **Naming reconciliation:** this spec's canonical names are listed below. Some already exist in `globals.css` under slightly different names from earlier WIP (`heading-display` ≈ `sketch-heading`, `heading-section` ≈ `sketch-subheading`). Pick **one** approach — rename to match this spec, or add the new names as documented aliases — and apply it consistently; don't let both names coexist silently.
- **Adopt incrementally, following the existing pattern.** Components already use a `data-slot` convention (`card.jsx`); add `sketch-*` classes alongside existing shadcn variant classes the same way `card.jsx` already layers in `sketch-card`, rather than rewriting components from scratch.
- **Always implement both themes.** Every new token/utility needs a `.dark` counterpart in the same pass — `--sketch-line`, `--sketch-shadow`, and `--accent-vermilion` already model this dual-definition pattern; follow it for anything new.

### Reusable class reference

| Class | Purpose | Status |
|---|---|---|
| `sketch-paper-bg` | Off-white sketch-paper canvas background + grain, for page-level surfaces | New — build from `--background` + the existing body-grain technique |
| `sketch-frame` | Generic irregular ink-line frame with offset shadow (callouts, media, misc blocks) | **Exists** in `globals.css` |
| `sketch-card` | Card surface on the sketch-frame language | **Exists** — wired into `components/ui/card.jsx` |
| `sketch-divider` | Hand-drawn horizontal rule for section/row separation | **Exists** |
| `sketch-heading` | Large expressive display heading — page titles, hero/poster moments | Maps to existing `.heading-display` — needs naming reconciliation |
| `sketch-subheading` | Section/card-group heading | Maps to existing `.heading-section` — needs naming reconciliation |
| `sketch-button` | Ink-line bordered button family (primary/secondary/outline/ghost/destructive/accent) | New — not yet applied to `button.jsx` |
| `sketch-input` | Ink-line bordered field for input/textarea/select | New — not yet applied to `input.jsx`/`textarea.jsx`/`select.jsx` |
| `sketch-table` | Ledger-style table — horizontal dividers only, mono header, no zebra striping | New |
| `sketch-modal` | Popped-page modal surface — larger frame, heavier offset shadow, scrim | New |
| `sketch-nav-item` | Sidebar/nav row — mono label, line-art icon, divider-separated | New |
| `sketch-nav-active` | Active nav state — hand-drawn accent mark beside the label, not a filled pill | New |
| `sketch-texture` | Opt-in decorative grain overlay for large surfaces (heroes, modals, empty states) | New — heavier-but-subtle variant of the existing body grain |
| `label-sketch` | Mono "annotation" micro-label (eyebrows, captions, meta) | **Exists** — reuse as-is |
| `icon-sketch` | Loosens icon stroke-width to 1.5px for pen-line feel | **Exists** — apply globally to functional icons |
| `sketch-tilt-left` / `sketch-tilt-right` | ±0.6° rotation for decorative/poster accents | **Exists** — hero/empty-state/decorative use only |
