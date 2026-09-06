# Outcome — Flow redesign styling regressions

Native element reset: Tailwind preflight is deliberately NOT loaded (apps/web/src/theme.css:18-19 imports only theme+utilities; see the comment there explaining why), and the compensating global rule at apps/web/src/styles.css:98 only sets font-family and color on button — no background/border/appearance — and there is no select reset at all. Result: every raw <button>/<select> without an explicit bg class renders with browser-default white chrome. Extend the global reset: button gets background:none, border:none (or 0), appearance:none, padding:0 as appropriate; add an equivalent themed select reset. Respect theme.css's stated reason for excluding preflight — do not import preflight wholesale. Verify the three known-broken surfaces render themed afterwards: project-page conversation list rows (raw <button> in apps/web/src/components/project/ConversationList.tsx:46), the pipeline-stepper phase pills on the feature header, and the 'landing on main' / 'from main' branch pickers. Sweep for other raw button/select usages that were relying on this reset and check none regress (buttons that WANTED default padding, etc.).

- Shipped: 2026-09-06
- Laps run: 1

## What shipped

18 commits · 18 files

### Lap 1
- 5 tickets landed: #1 Native element reset: Tailwind preflight is deliberately NOT loaded…; #2 Feature header clipping: on the draft feature view the header is…; #3 Shipped view empty-walkthrough placeholder: when no walkthrough was…; #4 Settings overlay scrolling is inconsistent per tab: the 'This project'…; #5 Sidebar selected-feature styling: remove the purple left-border accent…
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 032a599605b1ef216abb55e056005b5f3b7983e0
- Landed since: 0
- Outcome: done

- **Feature-state surfaces could not be exercised in the clean drive database** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Native element reset: Tailwind preflight is deliberately NOT loaded…

# ticket(1) — native element reset

## What was done

`apps/web/src/theme.css` now hand-writes the slice of Tailwind's preflight the
app cannot go without: a `@layer base` block resetting `button`
(`appearance: none; background: none; border: 0; padding: 0`) and giving
`select` a themed control instead of the platform's white listbox
(`background-color: var(--color-panel-inset)`, a hairline border, `radius-sm`,
`color: inherit`, `font-family: inherit`, `padding: 0 8px`). Preflight itself is
still not imported.

Two deviations from the ticket's wording, both deliberate:

- **The reset went into `theme.css`, not `styles.css`.** `styles.css` sits
  exactly on its ratchet baseline (653 lines, `test/styles-ratchet.test.ts`) and
  STYLE.md forbids adding to it, so a single new line there fails CI. The
  existing `button { font-family: inherit; color: inherit }` at styles.css:98 was
  left alone — it is *unlayered*, so it beats a `text-*`/`font-*` utility on a
  raw button, and moving it into `@layer base` would silently repaint every raw
  button in the app to whatever colour and font it had asked for and never got.
  That is a real latent bug but a much wider blast radius than this ticket.
- **`select` does not get `appearance: none`.** All five selects in the app draw
  their own chrome already; stripping `appearance` would take the disclosure
  arrow off every one of them and leave what reads as a text input. "Themed"
  rather than "stripped" is what the select reset does.

`@layer base` is the load-bearing choice: unlayered `styles.css` beats every
layer (so `.btn`, `.nf-base-select`, `.settings-clear` keep every pixel they
declare) and the utilities layer beats base (so `bg-panel` on a raw button still
wins). Only an element that named nothing changes.

New test `apps/web/test/native-reset.test.ts` (tier 1, reads the stylesheet the
way `styles-ratchet.test.ts` does) asserts: preflight is not imported, the layer
statement puts `base` before `utilities`, the button and select declarations are
present, and the base layer contains *nothing but* those two selectors — widening
it to `ol, ul` is precisely what the no-preflight decision exists to prevent.
`apps/web/STYLE.md`'s "No preflight" bullet was corrected: it still told the next
agent to assume nothing is reset.

## Verification

- `bun run typecheck` — 0 errors.
- `env -u GIT_ASKPASS bun run test` — 223 files, 3255 passed, 4 skipped, **1
  failed**: `packages/server/test/dev-pane.test.ts > kills the child process tree`
  (`expect(pidAlive(-pgid)).toBe(false)`). Confirmed on a single targeted re-run
  of that one file. It is a sandbox process-group reaping artifact, in
  `packages/server`, and this diff touches only `apps/web` CSS, a markdown doc,
  and a new test file. Note the baseline in the burn prompt ("118 files, 1768
  passed") is stale for this branch — the suite is 223 files here.
- `vite build` of `apps/web`, then read the emitted CSS: the block survives
  minification verbatim inside `@layer base`, the layer order is
  `properties → theme → base → utilities`, and `.btn` / `.nf-base-select` /
  `button { color: inherit; font-family: inherit }` are all emitted *unlayered*,
  so the precedence the reset depends on is real and not just reasoned about.
- The three named surfaces were checked by reading their class lists: the
  conversation row (`ConversationList.tsx:46`), the stepper pill
  (`PipelineStepper.tsx:38`) and the branch-picker trigger + menu rows
  (`BRANCH_TRIGGER` / `item()` in `ui.tsx`, used by NextStepBar's "from",
  NewChatCard's "landing on" and QuickChangeMode) each state a border and/or a
  colour but no background, which is exactly the case the reset now covers.
- Drive machinery: nothing to update. This ticket adds no service, no required
  env var, no seed and no extra process — a CSS rule and a test. `.runcastle/`
  was not touched and was not run (no services in the sandbox).

## Surprises

- The regression sweep found no button that wanted the user agent's padding.
  Every one of the ~90 raw `<button>`/`<select>` sites either states `px-*`/`p-*`,
  is a fixed `size-*` box, already says `p-0`, or carries an unlayered legacy
  class that sets its own padding. Likewise every button that names a border
  *colour* also names `border`/`border-b-2`, so `border: 0` takes nothing away.
  I checked this by scripting a dump of every `<button`/`<select` opening tag and
  resolving the shared class constants (`DOOR_CLASS`, `TB_BUTTON`, `FACE_BUTTON`,
  `BARE_BUTTON`, `PLAIN_BUTTON`, `CHIP`, `NAV`, …) by hand; the script was a
  throwaway and is not in the diff.
- The app had already grown *five* independent hand-written copies of this reset
  — `BARE_BUTTON` in `ui.tsx`, `PLAIN_BUTTON`/`BARE_BUTTON` in
  `components/settings/button.ts`, `BUTTON_RESET` in `Sidebar.tsx`,
  `FACE_BUTTON` in `ProjectCard.tsx`, and inline `border-0 bg-transparent p-0` in
  roughly a dozen more components — each with its own comment explaining that
  there is no preflight. The bug this ticket fixes is the same bug those were
  written for; the ones that never got written are the three broken surfaces.

## Left undone

- **Those five copies are now redundant and their comments are now wrong.**
  Deleting `BARE_BUTTON`/`PLAIN_BUTTON`/`BUTTON_RESET` and the inline
  `border-0 bg-transparent p-0` runs, and folding their explanations into the one
  comment in `theme.css`, is a clean follow-up of maybe 20 files. It is not this
  ticket (which says to check nothing regresses, not to refactor), and it is a
  much bigger diff than the fix, so it was left alone deliberately. Note that
  `BARE_BUTTON`'s `border-0` still has one real job today: `settings/button.ts`
  documents that `border-0` sorts *after* `border` in the generated sheet, which
  matters for surfaces that toggle a border on hover.
- **`styles.css:98`'s `button { font-family: inherit; color: inherit }` is
  unlayered and beats utilities.** Every `text-*` and `font-mono` on a raw
  `<button>` in this app is therefore dead — `DocsMenu`, `MapRail`,
  `ArtifactPane`, `ModelMenu` and others ask for mono or a dim grey and render
  neither. `FeatureActionsMenu.tsx:53` has a comment saying it hit this and
  worked around it by moving the colour onto a child `<span>`. Whoever retires
  the last of `styles.css` should move those two declarations into the
  `@layer base` block beside the rest of the reset — at which point a lot of raw
  buttons will change colour, all of them toward what their author wrote.
- The five `<select>`s all set `text-sm`/`h-(--control-h)` but not all set a
  font-family, so a couple render in the browser's default face rather than
  Inter. The reset's `font-family: inherit` fixes that; no `font-size: inherit`
  was added, since that would move sizes on selects that never asked.

#### 3. Shipped view empty-walkthrough placeholder: when no walkthrough was…

# Ticket 3 — shipped view empty-walkthrough placeholder

## What was done

The shipped feature view no longer renders the full-height evidence stage when no
walkthrough exists. `ShippedBody` now mounts `EvidenceStage` only when
`recordings` is non-empty (that list is already filtered to artifacts with
`hasVideo && videoUrl`, so "non-empty" is exactly "there is media to play");
otherwise it renders a single `DimLine` with the same sentence the stage used to
show. Everything below — the status strip, the Q&A history — moves up into the
space the empty 16:9 box used to hold.

The change deviated from the ticket's wording in one small way: the sentence
itself lives in `EvidenceStage.tsx`, not in `ShippedBody.tsx`, so it is now an
exported constant (`NO_WALKTHROUGH_RECORDED`) used by both files rather than a
string copied into a second component.

Covered by two new tier-1 cases in `apps/web/test/shipped-body.test.ts`: with no
artifacts the markup carries the sentence and neither `aspect-video` nor the
`evidence-stage` id; with artifacts the stage still renders.

## Surprises

- The stage's read-only "No walkthrough was recorded…" branch is **not** dead
  after this change. `Workspace` can render `ReviewBody` with `readonly`, so a
  read-only *review* view with no recording still reaches it. That is why the
  copy was hoisted to a shared constant instead of being moved out of
  `EvidenceStage` entirely, and why the collapse was scoped to the shipped body
  rather than pushed down into the stage.
- `packages/server/test/dev-pane.test.ts` > "kills the child process tree so the
  port-holder is not orphaned" fails, both in the full suite and on its own. It
  asserts a process group is reaped after `stopDevPane`; this sandbox does not
  reap it. It is unrelated to this web-only diff and was not listed in the
  prompt's baseline — the baseline's counts (118 files / 1768 tests) also no
  longer match this repo (222 files / 3257 tests), so that listing is stale.
  Everything else is green and `bun run typecheck` is clean.

## Left undone

- The drive machinery under `.runcastle/` was not touched: this change adds no
  service, env var, seed or process, so none of the four triggers applies. I did
  not run those scripts (no services in this sandbox) and did not need to read
  them.
- The `ShippedBody` doc comment still describes the evidence band as "the final
  walkthrough on a read-only stage" without mentioning the collapsed case. Left
  alone rather than adding comment-only churn to the diff.
- Not looked at: whether the *review* page's own empty stage (non-read-only, no
  recording yet) should collapse too. It should not — there the box becomes the
  drive surface — but a read-only review view has the same dead-space problem the
  shipped view had, and nobody has asked for that yet.

#### 4. Settings overlay scrolling is inconsistent per tab: the 'This project'…

# Ticket 4 — settings overlay scrolling

## What was done

The settings dialog already had the shared scroll container the ticket asks for —
one `overflow-y-auto` body beside the rail, wrapping whichever page is selected,
with `pb-7` under it. It just never worked, and the cause was one missing class
rather than anything per-tab. The page `<section>` (`SettingsDialog.tsx`) is a
grid item of the fixed-height frame (`h-[min(700px,80vh)]`) and had no `min-h-0`.
A grid item's automatic minimum size is its content, and its `minmax(0,1fr)` body
row under an indefinite height resolves to that item's max-content contribution,
so the section's *minimum* was the whole page's height. The frame's row grew to
match, the body was handed exactly the height its content asked for and therefore
never scrolled, and the panel's `overflow-hidden` clipped everything past 700px —
the last control on every long page unreachable. Adding `min-h-0` to that section
closes the chain; the existing `pb-7` is now actually reachable, so I left the
padding alone rather than bumping a number that was never the problem.

Deviation from the ticket's framing: it describes this as missing bottom
padding/inset and as four different per-tab behaviours. It is one broken height
chain, and the diff is correspondingly small — one class plus the comment that
explains it, and a test.

The test is in the existing tier-2 `apps/web/test/settings-dialog.test.tsx`
(happy-dom, all four pages already mocked there). It clicks through General,
Models, Burns and This project and asserts: exactly one `overflow-y-auto` under
the panel on each, that it is the *same* DOM node throughout, that it carries
bottom padding, and that every element between it and the fixed-height frame
carries `min-h-0`. It failed on `SECTION may not shrink` before the fix.

## Surprises

- Nothing in this repo can measure a scroll — happy-dom lays nothing out, and
  tier 1 is a string. So "does it scroll at a short window height" is not
  directly assertable; the test pins the CSS *chain* that decides it instead,
  which is viewport-independent because the frame is `min(700px,80vh)`. I could
  not open a browser here, so no tab was visually verified at a short height —
  the claim rests on the chain being unbroken, not on my having watched it.
- The ticket's per-tab split ("This project scrolls, the others don't") does not
  correspond to anything in the code: all four pages share one container and one
  frame. The likeliest reading is that page length differed — the short pages
  simply fit inside 700px and had nothing to cut off. Worth knowing if someone
  re-drives this and sees a difference I have explained away.
- The stated baseline ("118 files, 1768 passed") does not match this repo: the
  full suite is 222 files / 3258 tests. One failure,
  `packages/server/test/dev-pane.test.ts` ("the process group must be gone"),
  fails identically on a targeted run and touches no web code — it is process-
  group reaping in this sandbox, not mine. Everything else is green, typecheck
  included.

## Left undone

- `SettingRow`'s help tooltip is `position: absolute` inside the scroll
  container, so on the last row of a page it extends into (and past) the bottom
  padding and gets clipped. That is a real "not fully reachable" edge, but it
  affects the tooltip rather than the control, it predates this ticket, and
  fixing it properly means portalling the tooltip out. Left alone deliberately.
- The rail (`SettingsRail`) does not scroll and would clip below roughly a 320px
  panel height. The ticket scopes the fix to the panel *body*, so I did not touch
  it; it only bites at window heights well under 400px.
- Drive machinery: no edit needed and none made — this change adds no service, no
  required env var, no seed and no process. I confirmed `.runcastle/drive-setup.ts`
  and `.runcastle/drive-stop.ts` are both present and unmodified. I did not run
  them (no services in this sandbox), and did not parse-check them beyond that.

#### 5. Sidebar selected-feature styling: remove the purple left-border accent…

# Ticket 5 — sidebar selected-feature styling

## What was done

The violet left-hand bar on the selected feature card
(`shadow-[inset_2px_0_0_var(--color-accent)]` in `FeatureRow`, `apps/web/src/components/Sidebar.tsx`)
is gone. Selected is now `bg-accent-soft inset-ring-1 inset-ring-accent-line` — the tint every
other selected surface in the app already wears (the pinned project row directly above it in the
same rail, `SettingsRail`'s current tab, `RunPicker`'s current run), plus a violet hairline. I used
`inset-ring` rather than a real `border` deliberately: a border would have forced a
`border-transparent` counterpart on every unselected row to stop selection shifting the card by a
pixel, and the ring costs no layout at all. That bar was the only inset accent bar in the whole
app — a grep for `shadow-[inset` now returns nothing.

The polish pass, all of it grounded in an idiom that already existed somewhere else rather than
invented: the status chip states `ui.tsx`'s `h-5` instead of deriving a height from `py-0.5`; its
needs-dot went `size-[7px]` → `size-2`, the size every other status dot in the app uses
(`PhaseDot`, `SessionStatusDot`, `CheckLine`, the stepper); the checkmark went 10px → 11px, the
chip's own `text-xs` step; `CHIP_FG`'s two tinted borders moved to `/40`, matching the chip family
in `ui.tsx` (`shipped` is now literally `TicketStatusChip`'s `done`) instead of spreading 30/35/40
across one idea. The progress-dash row lost its off-scale `gap-[3px]` for `gap-0.5`, and the card
gutter went `mb-0.5` → `mb-1`.

Two new tests in `apps/web/test/sidebar-row.test.ts` pin the selected state both ways (tinted and
ringed when active, neither when not). The file's docstring used to say it pins anatomy "not its
colours"; I narrowed that rather than silently contradicting it, since the selected state's whole
point *is* which colour treatment it wears.

## Surprises

The `upcoming` pipeline segment turned out to have a real defect, not just an inconsistency. It was
`border border-hairline-soft bg-panel-3` — and `bg-panel-3` is the row's *own hover colour*, so
hovering a feature row dissolved the upcoming half of its pipeline map into a bare outline. At
`h-1` (4px) that outline is two hairlines around a 2px interior. It is now a flat `bg-hairline`,
which is both more visible than the old treatment on a hovered row *and* on a selected one, and
makes all six dashes one shape that differs only in colour. This required updating the existing
six-segment test's `bg-panel-3` expectation to `bg-hairline`; the anatomy it asserts (6 segments,
2 done / 1 current / 3 upcoming) is unchanged.

I went looking for a second defect and did not find one: I assumed the bordered `upcoming` segment
was rendering 6×12px against the others' 4×10px, because this app deliberately ships no Tailwind
preflight. It is not — `styles.css:73` has an unlayered global `* { box-sizing: border-box }` that
predates the migration and covers it. Worth knowing before anyone else reasons from "no preflight"
to "no border-box".

I verified the new utilities emit real CSS rather than trusting that they resolve, by running
`vite build` and grepping the output: `inset-ring-1` emits
`inset 0 0 0 1px var(--tw-inset-ring-color)`, and `inset-ring-accent-line`, `bg-hairline`,
`gap-0.5`, `border-ok/40` and `border-needs/40` all emit. That matters here because Tailwind's
`inset-ring` depends on `@property` registrations, and it was not obvious those survive an
import that skips preflight. They do.

**The baseline in the prompt is stale.** It says `bun run test` is "118 files, 1768 passed". This
repo now runs **223 files, 3264 tests**. Don't calibrate against that number.

**One test fails and it is not mine:** `packages/server/test/dev-pane.test.ts` >
"kills the child process tree so the port-holder is not orphaned" — it kills a process group and
asserts `kill -0 -pgid` then throws. It fails identically on a targeted isolated run, and my whole
diff is two files under `apps/web` (a CSS class and its test), which cannot reach the server's
process-management code. It reads like a container fault: without a proper init reaping children,
a killed-but-unwaited process group still answers `kill -0`. Typecheck is fully green (0 errors,
all four projects). Every `apps/web` test passes.

## Left undone

- **The rail's other 7px dot.** The preparation row at the rail's foot still uses `size-[7px]` for
  its status dot. I changed only the chip's, because the ticket scoped the polish to "the rail
  cards" and the prep row is not one — but that leaves two dot sizes in one file, and whoever owns
  the prep surface should take it to `size-2`.
- **Lane-caption alignment.** Lane headers sit at `px-2` while row content starts at `px-3`, so the
  caption is indented 4px short of the glyph below it. Visible once you look for it. Left alone as
  sidebar layout, which the ticket explicitly told me not to restructure.
- **The chip is a near-copy of `ui.tsx`'s `CHIP_BASE`.** After this pass the rail's chip and
  `CHIP_BASE` differ only in `font-mono` and `mt-px`. Folding the rail's into the primitive is the
  obvious next move and is a refactor, not a polish, so I did not do it.
- **Drive machinery: nothing to update, and I did not run it.** The standing instruction triggers
  on a new service, a required env var, a seed, or a process. This ticket adds a CSS class to one
  React component and touches no dependency, migration, config or boot path, so none of the four
  fire and `.runcastle/drive-setup.ts` needs no edit. I did not execute the drive scripts — the
  sandbox has no services — and I did not need to inspect them either, since nothing in the diff
  could change what they must do.
