# runcastle design system — build guide

A near-black **IDE-grammar** UI kit (VS Code, not a marketing site). Every design
you build with it should honor four rules — they *are* the system:

1. **Near-black surfaces layered by hairlines — never shadows.** No `box-shadow`,
   no elevation, no rounded "cards". A 1px hairline border does all separation.
2. **Exactly one solid violet button per view.** Everything else is a ghost
   `Button` or a `GhostLink`. A second solid accent per screen breaks the grammar.
3. **Mono for every identifier** — branches, paths, slugs, hashes, counts render
   in the mono family. Running prose is sans.
4. **Motion is two things only**: a `Spinner`, and a `pulse` (set the `pulse`
   prop on `Chip`/`StatusDot`, which toggles the `is-pulsing` class). Otherwise
   nothing animates beyond a hover colour.

## Setup — no provider, one stylesheet

There is **no provider or root wrapper**. Import the stylesheet once at your app
root and compose components directly:

```tsx
import '@runcastle/design-system/styles.css'
```

That stylesheet paints the page `--bg` (near-black `#0a0c0f`) and sets the base
text colour and font, so your app sits on the dark canvas automatically. Build
your own layout on that same canvas — if a region looks unstyled/white, you
rendered outside the DS surfaces; wrap it so its background is a DS token.

## Styling idiom — CSS custom properties, not utility classes

This is a **token system**. There are NO Tailwind-style utility classes.
Components style themselves; you style your own layout glue with the `var(--*)`
tokens defined in the `:root` block at the top of `styles.css`. Real names:

- **Surfaces**: `--bg` (canvas), `--panel` (raised bars), `--panel-2` (sunken rails)
- **Hairlines**: `--hairline` (1px borders/dividers), `--hairline-soft` (fainter)
- **Text ramp**: `--text` (primary), `--text-2` (labels), `--text-3` (dim/meta)
- **Accent**: `--accent` (violet solid), `--accent-hi` (hover/links/headings), `--accent-ink` (text on accent)
- **Phase palette** (the semantic colour spine): `--ph-ideation` `--ph-spec` `--ph-tickets` `--ph-implementation` `--ph-review` `--ph-shipped`
- **Status**: `--ok` (green), `--needs` (amber), `--danger` (red)
- **Type**: `--mono` (JetBrains Mono), `--sans` (system-ui)
- **Metrics**: `--radius`, `--radius-sm`, `--radius-pill`, `--control-h`

Glue example: `<div style={{ background: 'var(--panel-2)', border: '1px solid var(--hairline)', borderRadius: 'var(--radius)' }}>` — never a shadow.

## Components (15)

- **Actions**: `Button` (`variant` solid|ghost|danger, `size` md|xs), `GhostLink`
- **Inputs**: `Input` (`invalid`, `mono`), `Segmented`
- **Text**: `SectionTitle`, `DimLine` (the single empty-state style)
- **Status**: `Tag` (phase `tone`), `Chip` (`tone` + `pulse`), `StatusDot`, `Spinner`
- **Structure**: `Panel`, `Toolbar`, `Tabs`, `Stepper`, `Toast`

Read each `<Name>.d.ts` for the exact props and `<Name>.prompt.md` for usage.

## Screens (the composed app)

A second group, **Screens**, holds presentational, mock-data reconstructions of
runcastle's actual application — the thing to redesign, then re-wire your data
layer back into:

- `AppShell` — the whole IDE frame (title bar · features rail · typed tabs ·
  inspector · status bar). Pass `activeTab` to choose the center body.
- `Titlebar`, `Sidebar`, `Inspector`, `StatusBar` — the frame pieces on their own.
- `OverviewScreen`, `TicketsScreen`, `RunScreen`, `TerminalScreen` — the four tab bodies.

Each screen composes the primitives above plus the shell-layout classes
(`.shell`, `.sidebar`, `.center`, `.overview`, `.tickets`, `.run`,
`.terminal-tab`, `.inspector`, `.statusbar`). Every screen prop is optional with
realistic defaults, so `<AppShell />` renders the full populated app. These are
scaffolds for redesign, not the wired app — importing a redesign back means
reconnecting the real tRPC data and handlers to the new layout.

## An idiomatic screen

```tsx
import { Panel, Toolbar, Button, Chip, Tag, DimLine } from '@runcastle/design-system'

<div style={{ background: 'var(--bg)', minHeight: '100vh', padding: 24 }}>
  <Toolbar right={<Button variant="solid" size="xs">Burn all</Button>}>
    <span style={{ color: 'var(--text)', fontFamily: 'var(--sans)' }}>tickets</span>
    <Chip tone="active" pulse>burning</Chip>
  </Toolbar>
  <div style={{ marginTop: 12 }}>
    <Panel title="auth-flow" actions={<Tag tone="implementation">implementation</Tag>}>
      <DimLine>packages/server/src/services/git.ts</DimLine>
    </Panel>
  </div>
</div>
```
