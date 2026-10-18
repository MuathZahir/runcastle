runcastle is a tool you keep open all day. The interface should feel like a quiet workbench: cool slate chrome, generous space, one clear next step, and colour only where it tells you something — most of all along the pipeline.

## Principles

1. **One sidebar at a time.** The shell is `canvas` + one sidebar (`sidebar-w`) + one content panel (`surface`, `border`, `radius-lg`). A right panel (`inspector-w`) opens on demand and *replaces* nothing permanent — never sidebar + rail + notes rail at once. Switch views with `Tabs`, not with more columns.
2. **Facts are text, not boxes.** State is a `PropertyList` or a `MetaLine`: a glyph, a word, a sub-note. No outlined pills, no rows of chips, no bordered callouts.
3. **Shape before hue.** A phase is told by its `PhaseIcon` shape; status by a word next to a `StatusDot`. Colour confirms, it never carries meaning alone.
4. **One primary per view.** The `primary` button is inverted neutral (`primary` / `on-primary`). Everything else is `secondary` or, most often, `ghost`.
5. **Say it once.** A title, a status and a stepper each appear once per page. If the header says "Shipped", the body doesn't repeat "Shipped to main".
6. **Collapse what is read once.** Drive instructions, digests, raw logs go in a `Disclosure`, closed by default.

## Content

- Sentence case everywhere: "Test drive", "New chat", "Shipped". No uppercase-tracked labels (`FEATURES`, `SHIPPED 104`).
- Buttons start with a verb. Status is a past participle or an adjective: "Passed", "2 of 3 passed", "Not run".
- Write counts as words where there's room ("2 of 3 passed"), as fractions in tight rows (`3/7`).
- Titles are human. Strip pasted markup (`<pasted_content …>`, `<local-command-stdout>`) from list titles; show "Untitled chat" in `text-tertiary`.
- No emoji, no ✓ or · glyph soup inside chips. One middle-dot separator at most per line.
- Mono (`code` style) only for strings the user could paste into a terminal: branches, paths, commands, SHAs.

## Colour

- Neutrals: a faint cool slate (hue ≈225°, low chroma), not pure grey, so the chrome reads as a material. New greys stay on that ramp.
- Grounds: `canvas` for the frame and sidebar, `surface` for the content panel, `surface-raised` for anything floating, `surface-inset` for code and inputs. Hover is `surface-hover`, the current item `surface-selected`.
- Text: `text` for primary, `text-secondary` for descriptions, `text-tertiary` for metadata. All three meet 4.5:1 on every ground in both themes. `text-disabled` is decorative only.
- Lines: `border` for the panel edge and section rules, `border-subtle` between rows. Never draw a border and a fill on the same idle element.
- Accent: `accent` is spent on focus, selection, links, "live" and the review phase — nothing else. It is never a button fill and never a gradient. The old violet is retired.
- Status: `success`, `warning`, `danger` appear as 6px dots, 16px glyphs or short words — never as tinted pill backgrounds. `danger-subtle` and `accent-subtle` are the only tinted grounds, for inline notices.
- Phases: each wears a hue, in pipeline order — ideation pink, spec teal, tickets amber, implementation orange, review blue, shipped green; draft stays `text-disabled`. The hue goes on the `PhaseIcon`, and on the stepper's current step as a 14% wash behind it. Never on words, rows or the selected item, which stays `surface-selected`.
- Themes: dark is primary; light is a full peer. Every token has both values.

## Type

- Family: Geist for UI (`--font-sans`), Geist Mono for code (`--font-mono`), both from Google Fonts. Inter and JetBrains Mono are retired.
- `ui` 13/20 is the interface default — rows, nav, menus, inputs. `body` 14/22 is for prose. `title-lg` 22/28 once per page; `title` 16/24 for sections. `caption` and `label` 12/16 for metadata and group headings.
- Weights: 400 and 500 in the interface; 600 only for titles.

## Space & shape

- 4px base: `space-1` 4 · `space-2` 8 · `space-3` 12 · `space-4` 16 · `space-6` 24 · `space-8` 32 · `space-12` 48 · `space-16` 64.
- Pages read at `content-max` (760px), centred, with `space-12` above the title and `space-8` sides. Sections are separated by `space-6`–`space-10` of air, not by boxes.
- Rows are `row-h` 32 (sidebar) or 40 (lists); controls `control-sm` 24 · `control-md` 28 · `control-lg` 32.
- Radii: `radius-md` 6 for controls and rows, `radius-lg` 10 for the panel, menus and dialogs, `radius-sm` 4 for Kbd. `radius-full` for dots only — no pill buttons.
- Content is flat. `shadow-popover` and `shadow-dialog` are for floating layers only.

## Iconography

- The runcastle icon set (Icons group, `Icon` component): 16px, 1.5px round stroke, `currentColor`, default colour `icon`, `text` on hover/selected.
- Every nav item, tab, menu item and primary/secondary button gets an icon. Chrome actions (search, settings, panel toggles, "…") are `IconButton`s with a `label`, not text buttons.
- Phases use `PhaseIcon` progress glyphs, not coloured text or pills.
- No emoji or unicode glyphs as icons.

## Motion & focus

- Transitions are 120ms colour/background changes; enter animations at most 190ms opacity + 4px translate. Respect `prefers-reduced-motion`.
- Focus: a 2px solid `focus-ring` outline at 2px offset on every interactive element — at least 3:1 on every ground.

## Retire from the current app

- The uppercase tracked section labels and the mono "shipped" tag before titles.
- Two-line sidebar rows with progress bars, per-row check buttons, and always-visible "…".
- Outlined status pills in rows ("Reviewed ✓ · this build", "never test-driven", "succeeded").
- The second header band ("SHIPPED / Shipped to main") and the centred hero repeating it.
- The permanent right rail ("What still needs attention") when it's empty; the bottom status bar (its dots move to the sidebar foot).
- The "READ-ONLY" badge and "Back to shipped →" link — the stepper shows which step you're viewing.
- Bordered cards around every section; violet solid buttons and violet selection glow.
