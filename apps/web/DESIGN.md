# Mandi Ledger — Insider design system

Insider is read by a procurement team on phones, often in a mandi yard, to answer one
question: what moved today, and where should we buy? The design direction is a
**calm, trustworthy trading ledger**: warm paper, ruled rows, tabular figures, and colour
used only when it means something.

The live style guide is the `/design` route. It shows every token and component in light
and dark side by side, with measured contrast for each colour role.

## Principles

1. **The price ledger is the hero.** Tables are ruled with hairlines and set in tabular
   figures, so columns of rupees line up like a ledger. Everything around them stays quiet.
2. **Colour carries meaning, never alone.** Rises are leaf green with ▲ and a `+` sign.
   Drops are clay red with ▼ and a `-` sign. Status badges always have a text label.
3. **One accent, spent on attention.** Turmeric marks what needs your eye: the selected
   review row, notable insights, accent badges. It is never decoration.
4. **Hairlines over shadows.** Surfaces are separated by 1px borders. Only overlays
   (dialog, sheet, toast) get the single overlay shadow.
5. **Bilingual by default.** Gujarati and English share one type system. Gujarati labels
   wrap between words and are never truncated mid-word.
6. **Empty is a real state.** Phase 1 has no data. Every empty state says what will
   appear and why it is not there yet.

## Tokens

All tokens live in `src/lib/ui/tokens.css`. Raw values are CSS custom properties; `@theme`
maps them to Tailwind utilities (`bg-surface`, `text-ink-muted`, `border-border`, ...).
The app opens in light: `app.html` ships `<html data-theme="light">`. Settings →
Appearance switches to dark (`data-theme="dark"`) or System (no attribute, so dark
applies under `prefers-color-scheme: dark`). Any element with `data-theme` forces that
theme for its subtree.

### Colour roles

| Role          | Utility                      | Light     | Dark      | Use                                             | Contrast (light / dark, on surface) |
| ------------- | ---------------------------- | --------- | --------- | ----------------------------------------------- | ----------------------------------- |
| bg            | `bg-bg`                      | `#F7F4EC` | `#0E1612` | Page (warm paper / deep green-black)            | —                                   |
| surface       | `bg-surface`                 | `#FFFFFF` | `#151F1A` | Cards, tables, bars                             | —                                   |
| surface-2     | `bg-surface-2`               | `#EFEADC` | `#1D2923` | Table headers, wells, hover                     | —                                   |
| border        | `border-border`              | `#D9D1BF` | `#2E3D35` | Hairline rules (decorative)                     | —                                   |
| border-strong | `border-border-strong`       | `#8A8371` | `#62756A` | Input, select and switch outlines               | 3.8 / 3.4 (≥3:1 UI)                 |
| ink           | `text-ink`                   | `#1F2A24` | `#E7EDE8` | Body text                                       | 14.8 / 14.2                         |
| ink-muted     | `text-ink-muted`             | `#566057` | `#A2B0A6` | Secondary text                                  | 6.6 / 7.5                           |
| primary       | `bg-primary`, `text-primary` | `#1F5C3F` | `#74C79A` | Field green: primary actions, links, active nav | 7.9 / 8.4                           |
| primary-ink   | `text-primary-ink`           | `#FFFFFF` | `#0B1A12` | Text on primary                                 | 7.9 / 8.9                           |
| accent        | `bg-accent`                  | `#D99A1E` | `#E6AE45` | Turmeric fills: selection, attention            | accent-ink on it: 6.1 / 9.2         |
| accent-text   | `text-accent-text`           | `#8A5A07` | `#E6AE45` | Accent as text                                  | 5.9 / 8.5                           |
| positive      | `text-positive`              | `#1D7342` | `#72D193` | Rises, confirmed, online                        | 5.9 / 9.1                           |
| negative      | `text-negative`              | `#B03A28` | `#F38E7C` | Drops, errors, alerts                           | 6.0 / 7.2                           |
| warning       | `text-warning`               | `#8A5A00` | `#EBC567` | Needs a look (paused, single source)            | 5.9 / 10.2                          |
| info          | `text-info`                  | `#285C88` | `#8EBDE8` | Neutral information                             | 7.1 / 8.5                           |
| focus         | `outline-focus`              | `#1F5C3F` | `#E6AE45` | 2px focus ring, 2px offset                      | 7.2 / — on bg                       |

Each status role has a `*-soft` background (`bg-positive-soft`, ...) for badges and
banners; text in the matching role on its soft background stays ≥4.9:1 in both themes.
Chart series use `--chart-1` … `--chart-6` and `--chart-grid`.

### Type

- **Inter** for Latin text and every numeral; **Noto Sans Gujarati** for Gujarati glyphs
  (browser falls back per glyph). Both load from Google Fonts in `src/app.html` with
  `display=swap`.
- Scale (size / line height): `text-xs` 12/16 · `text-sm` 14/20 · `text-base` 16/24 ·
  `text-lg` 20/28 · `text-xl` 24/32 · `text-2xl` 32/40.
- Weights: 400 body, 500 labels and controls, 600 headings, 700 brand only.
- Sentence case everywhere. No all-caps labels.

### Space, radius, elevation, motion

- **Space:** 4px grid (Tailwind step `--spacing: 0.25rem`; `p-1` = 4px, `p-4` = 16px).
- **Radius:** `rounded-sm` 6px (skeletons, segments) · `rounded-md` 8px (controls) ·
  `rounded-lg` 10px (cards, tables, dialogs). Pills only for badges and switches.
- **Elevation:** `shadow-overlay` only, for dialogs, sheets and toasts. One exception: chat
  bubbles and the date / greeting pills in Chats carry a 1px hairline shadow
  (`0 1px 0.5px var(--shadow-overlay-color)`), because the thread copies WhatsApp's
  layout so the team reads it the way they read their phones.
- **Motion:** `--duration-fast` 120ms, `--duration-base` 160ms, `--duration-slow` 200ms,
  ease-out (`--ease-standard`). Under `prefers-reduced-motion` all transitions and
  animations collapse to 1ms.
- **Touch:** interactive controls are at least 44px tall (`min-h-11`); small buttons 36px
  only in dense toolbars.

## Components (`src/lib/ui/`, exported from `index.ts`)

| Component            | Purpose                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `Button`             | `primary` / `secondary` / `ghost` / `danger`; `sm` / `md` / `lg`; `loading`; `icon`; renders `<a>` with `href`            |
| `IconButton`         | Icon-only button; `label` is required (aria-label + tooltip)                                                              |
| `Badge`              | `neutral` / `positive` / `negative` / `warning` / `info` / `accent`; optional dot or icon                                 |
| `Card`               | Bordered surface with optional title (heading level configurable) and actions                                             |
| `Stat`               | Label, value, optional ₹ delta                                                                                            |
| `PriceCell`          | ₹/quintal value, tabular and right-aligned; raw reported value and unit on hover (and for screen readers); optional delta |
| `Delta`              | Signed ₹ change with ▲/▼ glyph and colour, plus a spoken label                                                            |
| `DataTable`          | Sticky header, numeric columns right-aligned, loading skeleton rows, empty row, selected row, columns hidden on phones    |
| `Input`              | Labelled text input with hint, error (`aria-invalid`, `aria-describedby`) and leading icon                                |
| `Select`             | Labelled native select                                                                                                    |
| `Switch`             | `role="switch"` toggle with busy state                                                                                    |
| `SegmentedControl`   | Radio group with arrow-key navigation, for filters and ranges                                                             |
| `EmptyState`         | Icon, title, body explaining what will appear, optional action                                                            |
| `Skeleton`           | Loading placeholder (block or N lines)                                                                                    |
| `Banner`             | Inline alert: `info` / `positive` / `warning` / `negative`; `urgent` uses `role="alert"`                                  |
| `Toaster` + `toasts` | Minimal toast store; polite live region, auto-dismiss after 4s                                                            |
| `Dialog`             | Native `<dialog>` (focus trap, Escape); `variant="sheet"` docks to the bottom on phones                                   |
| `Icon`, `Spinner`    | One outline icon family (24px grid, 1.75 stroke) and the loading spinner                                                  |
| `theme`              | Theme preference (`light` default / `dark` / `system`) persisted in localStorage                                          |

App-level composites built from these live in `src/lib/components/` (navigation, collector
badge, page header, loading/error states, insight card, price trend chart).

- **Sidebar** (`sidebar.svelte.ts` + `AppNav collapsed`): the desktop sidebar collapses to a
  4.5rem icon rail; each icon keeps its `aria-label` and shows its name as a tooltip on hover
  and focus. The choice is remembered per browser. Phones use the bottom bar instead.
- **Chats** (`components/chats/`, route `/chats`, which `/feed` redirects to): WhatsApp's
  anatomy in Mandi Ledger colours. `ChatRow` (round avatar, name, time, preview, a labelled
  "N prices" pill, never a bare unread-style count), `ChatThread` (day pills, greetings folded
  into one line, newest at the bottom, older pages load on scroll), `MessageBubble` (tail on
  the first bubble of a sender's run, time inside the bubble, sender names in text roles that
  pass 4.5:1), `PriceQuote` (the prices read from a message, as a quoted-reply block that opens
  `PriceDetails`: a drawer when there is room, a sheet otherwise). Below 1024px it is one pane:
  the list, then the open chat full screen with the bottom bar hidden. Where WhatsApp has the
  message box, a bar says Insider only reads.

## Usage rules

- **Prices are always ₹/quintal**, through `PriceCell` (or `formatRupees`), tabular and
  right-aligned. When the reported value and unit are known, pass `raw` so hover shows it.
- **Rises and drops** go through `Delta` / `PriceCell delta`: glyph + sign + colour, never
  colour alone.
- **Numbers in tables** sit in `numeric: true` columns; DataTable applies the `.num` class
  (tabular, lining, right-aligned, no wrap).
- **Indian grouping** (₹1,23,456) and lakh/crore short forms (`formatRupeesShort`) from
  `src/lib/utils/format.ts`. Dates and times are always IST (`src/lib/utils/dates.ts`).
- **No raw hex colours in routes or app components.** Use the utilities above. Charts read
  token values at runtime with `getComputedStyle`.
- **Gujarati labels** are never truncated mid-word: no `truncate` on translated text;
  `:lang(gu)` sets `word-break: keep-all`. Let labels wrap instead.
- **One primary button per view.** Destructive actions use `danger` and sit apart from the
  primary action.
- **Every async view has four states:** loading (Skeleton / DataTable `loading`), error
  (`ErrorState`, with retry), empty (`EmptyState` that explains why), and data.
- **Icons** come from `src/lib/ui/icons.ts`. Icon-only controls use `IconButton` with a label.
- **Focus** is always visible: 2px `--focus` outline. Do not remove outlines.
