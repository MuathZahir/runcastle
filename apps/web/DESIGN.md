# apps/web design language

The visual and interaction contract for runcastle's UI. `STYLE.md` says *how* the
app is styled (Tailwind, primitives, tests, migration); this file says *what it
should look and feel like*. When the two disagree about a look, this file wins.

Reference implementation: the **Runcastle Design System** artifact
(https://claude.ai/artifact/JK4Nbts5BetjWU6bJsWPkn) — tokens, 17 component
cards, and two full-page showcases (FeaturePage, ProjectHome) that show the
target for a shipped feature and the project home.

## The feeling

A tool you keep open all day: a quiet workbench in the vein of Linear and Cursor.
Neutral chrome, generous space, one obvious next step, colour only where it tells
you something. If a screen looks busy, it is wrong — remove, collapse or demote
before adding.

## Principles

1. **One sidebar at a time.** The frame is `canvas` + one left sidebar + one
   content panel. A right-hand *aside* (chat, details, notes) is opened on demand,
   there is only ever **one** aside, and opening one closes another. Views of the
   same object switch with **Tabs**, not by adding columns.
2. **Facts are text, not boxes.** State is a `PropertyList` (label → glyph + words)
   or a `MetaLine` (a few inline facts). No outlined pills, no rows of chips, no
   bordered callout boxes, no tinted pill backgrounds.
3. **Shape before hue.** A phase is told by its `PhaseIcon` shape; a status by a
   word beside a `StatusDot`. Colour confirms; it never carries meaning alone.
4. **One primary per view.** The `primary` button (inverted neutral: light on dark,
   dark on light) appears at most once. Everything else is `secondary` (hairline) or,
   most often, `ghost`.
5. **Say it once.** Title, status, stepper and next step each appear once per page.
   If the stepper says Shipped, nothing else repeats "Shipped to main".
6. **Collapse what is read once.** Drive instructions, digests, raw logs, config
   tables live in a `Disclosure`, closed by default.
7. **Icons with words.** Every nav item, tab, menu item and primary/secondary button
   has a leading icon. Chrome actions (search, settings, toggles, "…") are
   `IconButton`s with a tooltip label. No emoji, no unicode glyphs (✓ ⎇ ⚙ · soup).

## Frame

```
┌ canvas ───────────────────────────────────────────────────────────────┐
│ Sidebar (248, resizable, collapsible)  ┌ content panel (surface) ─────┐ │
│  [mark] project ▾            [new]     │ topbar 44: crumbs · tabs · ⋯ │ │
│  [search           Ctrl K]             │──────────────────────────────│ │
│  Home · Chats · Activity               │                              │ │
│  Needs you 2                           │   page column (760 / 1040)   │ │
│   ◔ feature row             3/7        │   title-lg                   │ │
│  Shipped 104                           │   meta line                  │ │
│   ● feature row                        │   stepper · next step        │ │
│  …                                     │   sections, separated by air │ │
│  ─────                                 │                              │ │
│  ● server  docker   ☾  ⚙               └──────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
```

- **Canvas** holds the sidebar and the content panel. The content panel is
  `bg-surface`, `border border-border`, `rounded-lg`, inset 8px from the window's
  top/right/bottom. There is no global title bar and no bottom status bar: the
  project switcher + search live at the top of the sidebar; the status dots
  (server, live, docker), notifications, theme and settings live in its foot.
- **Content topbar** (44px, `border-b border-border-subtle`): left = glyph +
  breadcrumb (current item in `text`, parents in `text-tertiary`); right = view
  `Tabs`, then secondary actions, then `IconButton`s (more, aside toggle).
- **Page column**: centred, `max-w-(--content-max)` (760) for document-like pages,
  `max-w-(--content-wide)` (1040) for data-heavy ones (run lanes, review evidence).
  Padding 48 top / 32 sides / 64 bottom. Sections are separated by 32–40px of
  space and a `title` heading — not by cards.
- **Aside** (320–400px): slides in from the right inside the content panel, with
  its own 44px header (title + close). One at a time.

## Page anatomy (every page)

1. Topbar (above).
2. `title-lg` (22/28, 600) — once.
3. `MetaLine` — branch, age, counts. 2–4 facts.
4. For features: the `PhaseStepper`, then the **next step** row: one sentence in
   `text-secondary` on the left, the primary action (and at most two secondaries)
   on the right; a disabled action shows its reason as a `caption` beneath. No
   band, no border, no background.
5. Body sections: `title` heading (16/24, 600) + content. Facts as
   `PropertyList`, collections as `ListRow` lists, long text as prose (`body` 14/22)
   or collapsed in `Disclosure`.
6. Empty areas are an `EmptyState` (icon, title, hint, ≤1 action) — never a box.

## Colour

Tokens live in `src/theme.css` (both themes). Use them by utility:
`bg-canvas`, `bg-surface`, `bg-surface-raised`, `bg-surface-hover`,
`bg-surface-selected`, `bg-surface-inset`, `border-border`, `border-border-subtle`,
`border-border-strong`, `text-text`, `text-text-secondary`, `text-text-tertiary`,
`text-text-disabled`, `text-icon`, `bg-primary` / `text-on-primary`, `text-accent`,
`text-accent-text`, `bg-accent-subtle`, `text-success`, `text-warning`,
`text-danger`, `bg-danger-subtle`, `text-phase-*`.

- Grounds: `canvas` frame + sidebar; `surface` content; `surface-raised` for
  anything floating (menus, popovers, dialogs, toasts, palette); `surface-inset`
  for code, terminal, transcript and inputs. Hover `surface-hover`; current item
  `surface-selected`.
- Text: `text` primary, `text-secondary` descriptions, `text-tertiary` metadata.
  `text-disabled` is decorative only.
- Lines: `border` for the panel edge and section rules, `border-subtle` between
  rows and for dividers inside floating layers (it is translucent, so it reads
  on `surface-raised` too). Never border + fill on the same idle element.
- `accent` (blue) is spent only on focus, selection, links, *live* and the review
  phase. Never a button fill, never a gradient, never a glow. Violet is retired.
- `success` / `warning` / `danger` appear as 6px dots, 16px glyphs or short words.
- Dark is the default theme; light is a full peer (`<html data-theme="light">`).

## Type

Geist (UI) and Geist Mono (code), self-hosted via Fontsource.

| Utility | Size/line | Use |
|---|---|---|
| `text-xl font-semibold tracking-tight` | 22/28 | page title, once |
| `text-lg font-semibold` | 16/24 | section heading, dialog title |
| `text-base` | 14/22 | prose: specs, chat, markdown |
| `text-sm` | 13/20 | **the UI default**: rows, nav, inputs, menus, buttons |
| `text-xs` | 12/16 | metadata, captions, group labels (`font-medium`) |
| `font-mono text-xs` | 12/18 | branches, paths, commands, SHAs — only code-shaped strings |

Weights 400/500 in the interface; 600 for titles only. **Sentence case
everywhere** — no uppercase-tracked labels. Numbers that change use
`tabular-nums`.

## Space, size, shape

- 4px grid (Tailwind default spacing). Row gaps 8, row padding 12, section gap 32.
- Controls: `h-(--control-sm)` 24 · `h-(--control-h)` 28 · `h-(--control-lg)` 32.
  Sidebar rows `--row-h` 32; list rows 40.
- Radii: `rounded-sm` 4 (kbd, checkbox) · `rounded-md` 6 (controls, rows, items) ·
  `rounded-lg` 10 (panel, menus, dialogs) · `rounded-full` dots only. No pill buttons.
- Content is flat. `shadow-popover` / `shadow-dialog` for floating layers only.

## Components (in `src/ui.tsx`, `src/ui/`, `src/icons.tsx`)

| Primitive | Contract |
|---|---|
| `Button` | `variant` primary · secondary (default) · ghost · danger · danger-ghost (Stop / Cancel / End in a row of ghosts); `size` sm 24 · md 28 · lg 32; `icon` (leading), `kbd` hint. Icon-only ⇒ use `IconButton`. |
| `IconButton` | Square ghost button, one icon, required `label` (tooltip + aria-label). `href` makes it a link ("Open app"); `badge` a small neutral count. |
| Link (`LINK`) | `accent-text`, no underline at rest, underline on hover — one look for every link in text. |
| `Kbd` | One key; `text-tertiary`, hairline. Only in menus, search, beside the primary. |
| `Icon*` / `PhaseIcon` | 16px, 1.5 stroke, `currentColor`, default `text-icon`; `text-text` on hover/selected. PhaseIcon: draft dashed ring · ideation ring · spec ¼ · tickets ½ · implementation ¾ · review ring+dot · shipped filled check. |
| `StatusDot` | 6px dot; tone success · warning · danger · accent · live (breathing) · neutral. |
| `StatusLabel` | dot/glyph + word in `text-secondary` — what every former "chip" becomes. |
| `SectionLabel` | 12px medium sentence-case group heading + count + one trailing action. |
| `NavItem` | 32px sidebar row: icon/PhaseIcon, one-line truncated label, trailing meta; selected = `surface-selected` + `text`, nothing else. Row menu on hover "…" / right-click. |
| `ListRow` | 40px list row: glyph, one-line title (or wrapping prose), optional second line, trailing meta; hover actions float over the meta; a control (a model picker) sits beside the row's button, never inside it. |
| `PropertyList` | Two quiet columns: `text-tertiary` keys, `text` values with a leading glyph. |
| `MetaLine` | One line of small inline facts separated by space. |
| `PhaseStepper` | Inline: done = check glyph, current = its glyph in `text`, future = dashed ring; past step being viewed = `surface-selected`. |
| `Tabs` | Text tabs; selected = `surface-selected` fill. No underline, no box. |
| `TextField` / `Input` | `surface-inset`, hairline, focus → accent border + ring. |
| `Disclosure` | Chevron + title + aside; closed by default; animated open. `sm`: a compact 12px line for detail under something else. |
| `SegmentedControl` | Inset track, raised thumb that slides; for 2–4 values that should all be visible (Theme). |
| `Checkbox` / `Switch` | Hairline box / track on the inset ground; on = `primary` fill. Focus ring outside. |
| `EmptyState` | Tertiary icon, title, hint, ≤1 action; no frame. |
| `Menu` / `DropdownMenu` / `Select` / `Combobox` / `Popover` | `surface-raised`, `rounded-lg`, `shadow-popover`, 30px items with icons + kbd. |
| `Dialog` | `surface-raised`, `rounded-lg`, `shadow-dialog`; title `text-lg`, footer right-aligned with one primary. |
| `Tooltip` | Small `surface-raised` label after 400ms hover; for every IconButton. |
| `PageTopbar`, `Page`, `PageHeader`, `Section`, `Aside`, `AsideLayout` | The frame pieces above, so every surface lays out identically. `AsideLayout` floats the aside over the page when the panel is too narrow to share. |

## Motion

Motion is garnish that makes the app feel responsive and calm — never a
delay. Transform and opacity only; everything honours `prefers-reduced-motion`.

| Token | Value | Use |
|---|---|---|
| `--dur-1` | 120ms | hover, colour, press |
| `--dur-2` | 180ms | menus, popovers, tooltips, row enter, disclosure |
| `--dur-3` | 240ms | page body enter, dialog, aside slide |
| `--ease-out-app` | `cubic-bezier(0.16, 1, 0.3, 1)` | everything entering |
| `--ease-app` | `cubic-bezier(0.22, 0.61, 0.24, 1)` | state changes |

- Hover/selection: background and colour transitions at `--dur-1`. Buttons press
  to `translate-y-px`; no scaling, no glow.
- Menus/popovers/selects: `animate-pop-in` — opacity 0→1, scale .97→1 from the
  Radix transform-origin, 180ms. Tooltips fade in.
- Dialog: backdrop fades (`animate-backdrop-in`); panel `animate-dialog-in`
  (opacity + translateY 8px + scale .98), 240ms.
- Page change: the page column fades and rises 4px (`animate-rise-in`, 240ms),
  keyed on the route so it runs once per navigation — never on data refetch.
- Lists: newly arriving rows `animate-rise-in`; initial render may stagger the
  first ≤8 rows by 20ms (`[animation-delay:calc(var(--i)*20ms)]`). Never re-run on
  polling updates.
- Aside: slides 12px + fades from the right (`animate-slide-in-right`).
- Disclosure: height animates (`interpolate-size: allow-keywords` +
  `::details-content` transition), chevron rotates 90°.
- Live state: `StatusDot tone="live"` breathes (`animate-breathe`, 2s); spinners
  only beside a word that says the state.
- Phase advance: the PhaseIcon fill sweeps to its new fraction (240ms).
- Toasts slide in from the bottom-right, 240ms.

## Retired (remove when you meet it)

Uppercase tracked labels · the violet accent and violet selection glow ·
outlined status pills in rows · two-line sidebar rows with progress bars and
per-row check buttons · always-visible "…" · the global title bar and bottom
status bar · second header bands that restate the phase ("SHIPPED / Shipped to
main") · centred hero blocks that repeat the title · empty permanent right rails ·
"READ-ONLY" badges (the stepper shows what you view) · bordered cards around
every section · the two-tone mono wordmark · Inter / JetBrains Mono.
