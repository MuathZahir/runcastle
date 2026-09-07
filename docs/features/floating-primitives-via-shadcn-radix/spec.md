# Floating primitives via shadcn/Radix

## Problem

Every dropdown in the app misbehaves the same way, because the web-ui-foundation
built Dialog/Field/Card primitives but no floating primitive. Concretely, as
reported 2026-09-06:

- The "lands on" branch picker renders every branch in normal flow with no
  max-height — the human scrolls the whole page to find a branch.
- The per-ticket model chooser renders inside the ticket card's overflow
  container, turning the card scrollable and clipping the menu.
- Every other picker is either a raw `<select>` (native light-chrome listbox in
  a near-black app) or a hand-rolled absolute-positioned menu, each with its own
  keyboard and dismissal quirks.

The user-facing outcome: pickers that float above everything, never clip, cap
their height with internal scroll, and behave identically everywhere.

## Approach

Targeted adoption of shadcn's floating family — not a wholesale migration.
Exactly four components, chosen because each maps to a verified broken or
homegrown site (decision 2):

- **Select** — grouped single-select. Replaces the model choosers (per-ticket
  and bulk) and every raw `<select>` in settings.
- **Combobox** — searchable single-select built on Popover + `cmdk`. Replaces
  both branch pickers (the "lands on" BranchMenu and the base-branch
  BaseSelect): branch lists are long, search is the requirement.
- **DropdownMenu** — action menus. Replaces DocsMenu, FeatureActionsMenu and
  ProjectSwitcher internals.
- **Popover** — the Combobox's foundation, exposed as a primitive in its own
  right.

Tooltip is out (decision 2).

**Two layers (decision 6).** A new `apps/web/src/ui/` directory holds the
generic compound primitives, one file per component, shadcn-style subcomponent
exports (decision 4). The existing domain components — BaseSelect, ModelMenu,
DocsMenu, FeatureActionsMenu, ProjectSwitcher — keep their names, props and
call sites and swap only their internals onto the primitives. Consumer diffs
stay near zero; domain knowledge (BaseSelect's blocking empty-option rule, the
model roster grouping) stays where it lives. The homegrown BranchMenu listbox
in ui.tsx is reimplemented on Combobox and its old implementation deleted;
ui.tsx is otherwise untouched — no barrel, no fold-in (that is a later
cleanup for another feature).

**Dependencies (decision 3, amending foundation decision 5).** Allowed in:
the per-primitive Radix packages (`@radix-ui/react-select`,
`@radix-ui/react-popover`, `@radix-ui/react-dropdown-menu`) and `cmdk`. The
ban on `clsx`/`cva`/`tailwind-merge` stands: copied shadcn markup is rewritten
onto the local `cx()` helper, lookup-map variants, and the theme.css tokens.
Pin exact versions at install time (`bun add`); consult ctx7 for current API
shapes rather than training data.

**Styling.** Restyled to read as the same design system as the rebuilt
primitives, per apps/web/STYLE.md: tokens only, utilities inline in TSX, menu
surfaces on `bg-panel-3` + `border-hairline` + `shadow-menu` like today's
hand-rolled menus, mono where the current menus are mono. The global
`:focus-visible` ring rule applies — do not restyle focus in the components.

**Behavior requirements dictated by the symptoms:**

- Content is **portaled** (Radix Portal) — never clipped by an ancestor
  overflow container.
- **Max-height capped with internal scroll**, using Radix's available-height
  collision awareness rather than a fixed pixel cap where possible.
- **Works inside Dialog** — settings selects live inside the portaled
  SettingsDialog, so floating content must layer above the dialog overlay
  (z-index tokens/order chosen deliberately, not ad hoc).
- Escape must not leak: when a Radix layer handles Escape to close itself, the
  underlying Dialog must not also close (Dialog's own rule — Escape only
  answers when focus is inside it — must keep holding).
- Keyboard behavior at least what the hand-rolled menus had: arrows, Home/End,
  Escape-restores-trigger-focus, typeahead where Radix gives it free.

**Cleanups riding the sweep:**

- Delete the homegrown BranchMenu implementation from ui.tsx.
- Delete the now-dead legacy rules for replaced selects (e.g. the DraftBody
  base-branch select rules) from styles.css and lower the ratchet constant in
  the same commit.
- Once no raw `<select>` remains, retire the hand-written `select` slice of
  the base reset in theme.css (verify no raw `<select>` is left first; the
  `button` slice stays).

## Seams

- **Domain component props (existing, unchanged).** `BaseSelect`, `ModelMenu`,
  `DocsMenu`, `FeatureActionsMenu`, `ProjectSwitcher` keep their exact prop
  contracts. Observable: their consumers compile and behave unchanged; tier-1
  static-markup tests where the closed state is plain markup.
- **The compound primitive exports (new).** The public exports of each
  `src/ui/` module — trigger/content/item subcomponents and their props. This
  is the seam future pickers build on. Observable: tier-2 (happy-dom +
  testing-library) tests per primitive — open/close, portaled content lands
  outside the ancestor container, selection fires the change handler, Escape
  closes the floating layer without closing an enclosing Dialog, focus returns
  to the trigger.
- **The styles ratchet (existing).** `test/styles-ratchet.test.ts` — deleted
  legacy rules must lower the constant; growth fails CI.

## Out of scope

- No rebuilding of non-floating primitives (Button, Dialog, Card, Field…).
- No general restyling or spacing polish of the forms/pages touched — a
  separate quick change covers the known spacing regressions.
- No re-mapping of theme.css onto shadcn's CSS-variable scheme; shadcn code is
  restyled to our tokens, not the reverse. No `components.json`/shadcn CLI
  workflow is adopted.
- No Tooltip.
- No multi-select variant anywhere (decision 5).
- No fold-in of ui.tsx into the new ui/ directory.

## Open questions

- Whether Radix Select's collision-aware positioning fully replaces the need
  for an explicit max-height token, or a cap is still wanted for very long
  model rosters — decide in the burn by testing with a long list; either
  satisfies the "capped with internal scroll" requirement.
