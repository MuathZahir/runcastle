# Outcome — Floating primitives via shadcn/Radix

Adopt shadcn's floating component family (Select, Combobox, Popover, DropdownMenu) restyled on runcastle tokens, replacing every clipping/overflowing dropdown in the app.

- Shipped: 2026-09-07
- Laps run: 1

## What shipped

21 commits · 38 files

### Lap 1
- 5 tickets landed: #1 Floating foundation: deps, Popover + DropdownMenu primitives, three action menus migrated; #2 Select primitive: model choosers and settings selects; #3 Combobox: branch pickers, BranchMenu deletion, legacy CSS retirement; #5 Project switcher renders at 11px instead of the app’s 14px menu scale; #6 Feature actions menu ignores its larger sans text treatment and renders at 11px
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: e1d1413fda5f50c432314e8ec686162f3fea65e5
- Landed since: 2
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 0cab9adf69c17305dd9c8d461f00274d92b41a69
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Floating foundation: deps, Popover + DropdownMenu primitives, three action menus migrated

# ticket(1) — floating foundation

## What was done

Installed all four of the feature's deps in `apps/web` at exact pinned versions
(`@radix-ui/react-select@2.3.7`, `@radix-ui/react-popover@1.1.23`,
`@radix-ui/react-dropdown-menu@2.1.24`, `cmdk@1.1.1`), so later tickets touch no
manifest. Added `apps/web/src/ui/` with three modules: `floating.ts` (the `cx()`
join helper and the one `FLOATING_SURFACE` class list every floating layer
wears), `popover.tsx`, and `dropdown-menu.tsx`. Both primitives always portal
their content, cap its height at Radix's measured available height with
`overflow-y-auto`, and sit at `z-[300]` — one band above `Dialog`'s `z-[200]`
backdrop, so a menu opened from inside settings floats over it. No
clsx/cva/tailwind-merge; variants are lookup maps.

DocsMenu, FeatureActionsMenu and ProjectSwitcher now render on `DropdownMenu`
with their exported names, props and call sites unchanged; their hand-rolled
open state, outside-click listeners, Escape handlers and option-ref keyboard
navigation are deleted (about 240 lines out, and DocsMenu's roles move from
listbox/option to menu/menuitem, with the current doc marked `aria-current`).
`ui.tsx` was not touched — the BranchMenu deletion belongs to the ticket that
reimplements it on Combobox.

Two deviations from the ticket text, both deliberate. (1) I exported only the
subcomponents something uses — no `PopoverAnchor`/`PopoverClose`/
`DropdownMenuGroup` — rather than mirroring shadcn's full surface; adding one
back is a line. (2) The ticket said menu content should be `font-mono text-xs`;
I made that the primitive's default (it is DocsMenu's and ModelMenu's look) and
had the two sans menus pass `font-sans text-sm` / `font-sans text-base`, so the
spec's "mono where the current menus are mono" still holds.

## Surprises

- **Radix opens a menu on `pointerdown`, not `click`.** Three existing test
  files drove the migrated menus with `fireEvent.click(trigger)` and went red
  the moment the internals swapped. They now share `test/floating.ts`'s
  `openMenu()`, which fires the pointer-down with the reason written down once.
- **`modal` is not free.** Radix's default modal menu `aria-hidden`s every
  sibling of its portal, locks body scroll and sets `pointer-events: none` — it
  would hide an open `Dialog` from a screen reader while a menu inside it is up,
  and it breaks role queries. The primitive defaults to `modal={false}`;
  dismissal does not depend on it.
- **Escape had to be stopped explicitly.** Radix listens on the document in the
  capture phase; `Dialog` listens on `window` in the bubble phase. Left alone,
  one press would have raced the focus restore against the dialog's
  "is the focus inside me" guard, so `DropdownMenuContent` stops propagation in
  `onEscapeKeyDown` — the same thing the hand-rolled DocsMenu did.
- **Radix's close-auto-focus fires a tick after the unmount**, which would pull
  focus off a dialog an action just opened (the Delete… flow). FeatureActionsMenu
  prevents it only when something other than `<body>` or the trigger already
  holds the focus.
- **`packages/server/test/dev-pane.test.ts > kills the child process tree` fails
  in this sandbox**, both in the full run and on its own. It is not in the
  prompt's baseline, but my diff touches no server code and that test spawns a
  PTY and kills a process group — an environment fault, not this ticket's. The
  full run is otherwise green: 3274 passed, 1 failed, 4 skipped;
  `bun run typecheck` is 0 errors; `bun run --filter '@runcastle/web' build`
  succeeds and the built CSS contains the new `data-highlighted:`, `z-[300]` and
  `max-h-(--radix-*-available-height)` rules.

## Left undone

- `apps/web/STYLE.md` still says "src/ui.tsx holds the shared primitives" and its
  catalogue does not mention `src/ui/`. Worth one paragraph once Select and
  Combobox land — a doc edit for the last ticket of this feature, not a
  half-written one now.
- No `styles.css` rules were deleted, so the ratchet constant is unchanged. The
  DraftBody base-branch select rules and the `select` slice of the theme.css
  base reset can only go once the raw `<select>`s do, which is a later ticket.
- Drive machinery needs no edit: this branch adds packages only, and
  `.runcastle/drive-setup.ts` already runs `bun install` and the SPA build
  (lines 112–113). I read the script and confirmed the paths it emits still
  exist; I did not run it (no services in this sandbox).

#### 2. Select primitive: model choosers and settings selects

# ticket(2) — Select primitive: model choosers and settings selects

## What was done

Added `apps/web/src/ui/select.tsx`: a compound Select on `@radix-ui/react-select`,
adapted the same way ticket 1 adapted Popover and DropdownMenu — `cx()` and the
shared `FLOATING_SURFACE`, always portalled, `position="popper"` so the height
cap is `max-h-(--radix-select-content-available-height)` and the viewport under
it scrolls, `z-[300]` so it floats over `Dialog`'s `z-[200]` backdrop, and Escape
stopped in `onEscapeKeyDown` so it cannot travel on to an enclosing dialog. Five
raw dropdowns now render it: `ModelMenu` (both consumers — per-ticket rows and
the ledger's bulk "Model for all pending"), and the four settings selects in
`ModelsPage`, `RosterTable`, `SettingRow` and `StepTable`. No raw `<select>` is
left in any of the five files; `BaseSelect` still has the last one in the app,
which is ticket 3's.

Two deviations. (1) **The primitive sets no type size.** The ticket asked for
`font-mono text-xs` on the menu; I kept `font-mono` and left the size to each
call site. Tailwind emits utilities in its own order, not the class attribute's,
and it emits `.text-xs` *last* of the whole size scale — so a `text-xs` default
here would have silently beaten the `text-sm` the four settings sites pass, and
the assumption that "a className passed in wins" would have been wrong in exactly
this direction. Verified against the built CSS. (2) **The trigger carries an
explicit `aria-label`.** Radix's trigger is `role="combobox"`, which takes no
accessible name from its content, so the model pill — whose only content is the
current value — would otherwise have read out as an unnamed control. The other
four sites were already named by a `<label for>` or an `aria-label` and are
unchanged.

## Surprises

- **Radix reads `''` as "nothing is selected".** Four of the five sites use the
  empty string to mean *unset* ("default (project model)", "Use global (…)",
  "Default (claude-opus-5)", "Runs on…") and each is a real, pickable row. A root
  whose value is `''` shows its placeholder instead and does not portal the
  selected row's text into the trigger. The primitive therefore translates at its
  own edge — `''` in and out, a NUL-prefixed sentinel in between — so every call
  site writes `value=""` exactly as it wrote `<option value="">`. `undefined`
  still means "no value yet, show the placeholder".
- **A Select opens on `click` in tests, unlike a DropdownMenu.** Radix's trigger
  only opens on the pointer down once it has seen `pointerType === 'mouse'`, and
  falls back to the click otherwise — so ticket 1's `openMenu()` helper does *not*
  work here. The new `pickOption()` beside it in `test/floating.ts` is what the
  select tests use.
- **Keyboard assertions have to be awaited.** Radix hands focus to a row only
  once the popper reports itself placed, and moves it between rows on a
  `setTimeout`, so a synchronous arrow-key assertion sees `body`. The test walks
  it with `waitFor`.
- **Radix will not fire `onValueChange` for the row that is already selected**
  (`useControllableState` guards on a change). One existing test picked a model
  and then re-picked the default on a component whose `value` prop never moved;
  it is now two tests, each starting from the other value.
- `packages/server/test/dev-pane.test.ts > kills the child process tree` fails in
  this sandbox — the same failure ticket 1 recorded. My diff touches only
  `apps/web/**`, and that test fails on a targeted run of its own file. The rest
  of the suite is green: 3285 passed, 1 failed, 4 skipped; `bun run typecheck` is
  0 errors; the web build succeeds.

## Left undone

- **`DropdownMenuContent`'s `text-xs` has the same trap.** `ProjectSwitcher`
  passes `font-sans text-base` over it, and `text-base` loses to `text-xs` in the
  built CSS, so that menu is rendering at 11px rather than the 14px it asks for.
  That is ticket 1's file, so I did not touch it; the fix is the same one I made
  here — drop the size from the primitive.
- **`SettingRow` still inlines its own copy of `ModelOptions`.** It is now
  JSX-identical to the one `RosterTable` exports and `StepTable` imports.
  Deduping it would make the generic settings-row module depend on a Models-page
  module, which is presumably why it was copied; I left it rather than add that
  coupling on a swap ticket.
- No `styles.css` rules were deleted and the ratchet constant is unchanged: the
  only legacy select rules left (`.nf-base-select`) belong to `BaseSelect`, and
  the `select` slice of `theme.css`'s base reset cannot go until that last raw
  `<select>` does. Both are ticket 3's, along with the `STYLE.md` paragraph about
  `src/ui/` that ticket 1 deferred to the feature's last ticket.
- Drive machinery needs no edit: this branch adds no service, no required env
  var, no seed and no process — only UI. I read `.runcastle/drive-setup.ts` and
  confirmed it already covers a UI change (it runs `bun install` and the SPA
  build); I did not run it, there being no services in this sandbox.

#### 3. Combobox: branch pickers, BranchMenu deletion, legacy CSS retirement

# ticket(3) — Combobox: branch pickers, BranchMenu deletion, legacy CSS retirement

## What was done

Added `apps/web/src/ui/combobox.tsx`: shadcn's Combobox recipe — a `Popover`
holding a `cmdk` command list — with its parts named and styled once
(`Combobox` / `ComboboxTrigger` / `ComboboxContent` / `ComboboxInput` /
`ComboboxList` / `ComboboxGroup` / `ComboboxEmpty` / `ComboboxItem`), on `cx()`
and the tokens, no clsx/cva/tailwind-merge. The panel is `PopoverContent`'s, so
it portals and caps at Radix's measured available height; the search row is
pinned and the list under it is the scroller (`max-h-64 overflow-y-auto`), which
is what keeps the input in place while a long branch list moves.

Both branch pickers now render it. `BranchMenu` in `ui.tsx` keeps its exported
props, its noise-branch filter and its "Detected main line" / "Other local
branches" headings, and its hand-rolled listbox — outside-click listener, capture
Escape handler, option ref map, arrow/Home/End walk, mousedown-before-click
commit, and `BranchMenuLabel` — is deleted (about 110 lines). `BaseSelect` keeps
`{id,label,branches,value,onPick,hint}` and its blocking empty-state, now with
local branches plain and remote ones under "Remote (creates a local branch)".

The CSS the swap orphaned went with it: `.nf-base`, `.nf-base-label`,
`.nf-base-select` (+`:focus`/`:disabled`) and `.size-hint` out of `styles.css`
with the ratchet lowered 653 → 633 in the same commit, and the `select` slice out
of `theme.css`'s base reset (the `button` slice untouched) once a grep confirmed
no raw `<select>` was left under `apps/web/src`.

Three deviations from the ticket text. (1) **`ComboboxItem` closes the picker
itself.** The root owns the open state and publishes a close through context, so
"picking a value dismisses the list" is single-select semantics rather than
something each of the two call sites re-derives; shadcn leaves it to the call
site. (2) **`.size-hint` was deleted too** — the ticket named only the
base-select rules, but `BaseSelect` was that class's last consumer, so it is dead
CSS the ratchet exists to remove. (3) **`STYLE.md` got the `src/ui/` paragraph**
tickets 1 and 2 each deferred to "the feature's last ticket". It also claimed the
reset covers `select`, which my change made false — a doc that lies about the
file it documents is worse than the extra diff.

## Surprises

- **`BaseSelect` has no consumers.** Nothing in `src/` imports it; `styles.css`
  even carried a comment saying "DraftBody remains BaseSelect's last consumer
  until ticket 5 migrates it", and that migration has evidently happened. It had
  no test either, so I wrote `test/base-select.test.tsx` — the blocking
  empty-state rule its header comment documents had zero coverage.
- **cmdk owns `aria-selected`.** It spends it on the row the keyboard is standing
  on, not the value the picker holds, and it sets it after spreading props so it
  cannot be overridden. The current row is marked with `aria-current` instead —
  the same choice ticket 1 made for DocsMenu — and the existing
  `getByRole('option', { selected: true })` assertions became `{ current: true }`.
- **The Tailwind ordering trap ticket 2 hit is real here too**, and the way
  around it was a variant rather than a plainer class: `aria-[current=true]:` and
  `data-[selected=true]:` outrank the base `text-text-2` on specificity, so the
  row's colours cannot depend on which utility Tailwind happens to emit last. I
  confirmed all three selectors in the built CSS.
- **`aria-label` on the trigger broke two unrelated tests.** Ticket 2 needed one
  on `SelectTrigger` because Radix makes it a `role="combobox"` with no
  content-derived name; a `ComboboxTrigger` is a plain button whose own words
  ("landing on main") are its name, and adding a label replaced them.
- **`packages/server/test/dev-pane.test.ts > kills the child process tree` fails
  in this sandbox** — the same failure tickets 1 and 2 both recorded, and it
  fails on a targeted run of its own file. My diff touches only `apps/web/**`.
  Everything else is green: `bun run typecheck` 0 errors, full run 3301 passed /
  1 failed / 4 skipped, and `bun run --filter '@runcastle/web' build` succeeds.
- Drive machinery needs no edit: no service, env var, seed or process is added —
  only UI. I read `.runcastle/drive-setup.ts` and confirmed it already covers a
  UI change (it runs `bun install` and the SPA build at lines 112–113); I did not
  run it, there being no services in this sandbox.

## Left undone

- **`DropdownMenuContent` still defaults to `text-xs`**, which ticket 2 flagged:
  `ProjectSwitcher` passes `font-sans text-base` over it and loses, so that menu
  renders at 11px. It is a one-line fix in ticket 1's file and the same one
  ticket 2 made in `select.tsx`; it is not this ticket's, so I left it.
- **`SettingRow` still inlines its own copy of `ModelOptions`**, as ticket 2
  recorded.
- **`ui.tsx` is still 900+ lines beside a `src/ui/` directory.** Folding it in is
  explicitly out of scope for this feature (spec, "Out of scope"), but the two
  `cx()` helpers are now literally duplicated — `ui.tsx`'s private one and
  `ui/floating.ts`'s export — and that is what the fold-in should collapse.
- **The Combobox list caps at `max-h-64` as well as the measured available
  height.** The spec's open question asked whether the collision-aware height
  alone is enough; I kept both because the panel's own cap governs the whole
  panel and the search row has to stay out of the scroller. If a very long roster
  ever wants more than 16rem, that number is the one line to change.

#### 7. Verify the fixes that landed

Drive verification pass

Toured the current feature build in Drive mode with one continuous recording saved at `walkthrough.webm`.

- Ticket #5 held: opening the project-name switcher showed all menu rows at a computed 14px in the intended sans family. The reported 11px regression did not reproduce.
- Ticket #6 held: opening the feature actions menu showed Copy link, Archive, and Delete at a computed 12px in the intended sans family. The reported 11px regression did not reproduce.
- No plainly broken behavior was observed on either touched surface during this bounded tour.

No verify commands are configured, so no gates were run; the pass was spent entirely on the Drive tour as required.

<promise>COMPLETE</promise>
