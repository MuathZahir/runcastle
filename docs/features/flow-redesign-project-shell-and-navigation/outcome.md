# Outcome — Flow redesign: project shell and navigation

Redesign the in-project chrome and navigation end to end — titlebar, sidebar rail and lanes, ⌘K palette, inspector, status bar, update banner, and the view-state machine behind refresh/back — walked and confirmed with the human before design.

- Shipped: 2026-09-04
- Lap: 1

## 1. Routes and landing: URL projection of the nav state machine, shell assembly seams

# Ticket 1 — routes, landing rule, shell assembly seams

## What was done

The app now has real, history-backed URLs with no router library. Three new/changed
pure seams plus one hook:

- `apps/web/src/lib/routes.ts` (new, pure) — `AppLocation`, `pathFor`, `parsePath`,
  `projectIdOf`, `insideProject`, `locationFor`. `insideProject` was not in the ticket;
  I added it because both the initial-landing branch and the popstate branch needed the
  same "is this address inside *my* project, and is it deeper than a bare `/p/<id>`"
  question, and the inline nested ternary was unreadable.
- `apps/web/src/lib/use-history-sync.ts` (new) — the only place in the app that touches
  `history`. `currentPath` / `pushPath` / `replacePath` helpers plus `useHistorySync`.
- `landingFeature` in `lib/feature-ui/sidebar.ts` (new, pure), beside `triageOf`.
- `launchView` in `lib/projects.ts` (new, pure) — URL > localStorage > `restoredView`.
- `use-project-nav.ts` owns the *project* half of the URL; `ProjectShell.tsx` owns the
  deeper half (feature / chat / prepare), because it is the only place that can resolve
  a slug to an id. The two never fight: the outer hook writes only when the project
  changes, and a project change remounts the keyed `ProjectShell`, whose first write is
  a replace.
- `ProjectShell.tsx`: the `list.data[0]` auto-select effect is gone, replaced by a
  once-only landing that reads URL → stored selection → `landingFeature`. The shell
  grid moved to Tailwind (`grid-rows-[44px_1fr_28px]`,
  `grid-cols-[var(--sidebar-w)_1fr[_var(--inspector-w)]]`), the inspector *column* is
  dropped on non-feature views, and `view: WorkspaceView` is passed to Titlebar and
  StatusBar.
- `styles.css` shell-frame rules deleted (4287 → 4273 lines); ratchet lowered to 4273.

Deviation worth naming: **`view` is declared and documented on `Titlebar`/`StatusBar`
but not yet read by either.** The AC asked only that ProjectShell pass it; consuming it
(breadcrumb, hidden inspector toggle, view-dependent branch segment) is decisions 5, 8
and 11, which belong to tickets 2–4. Tickets 2 and 4: the prop is already there, just
destructure it.

## Surprises

- **The baseline in the prompt does not match this checkout.** The prompt said
  "118 files, 1768 passed, 0 failed" and promised fully green. Actual:
  **153 files, 2553 tests, 8 failed** — `packages/server/test/burn-slot-workspace.test.ts`
  (7) and `packages/server/test/dev-pane.test.ts` (1). Both are sandbox-environment
  faults: the first `git clone`s a temp repo under `/home/agent/cache/tmp/rc-slot-vol-*`
  that does not exist by the time the command runs; the second asserts a process group
  is dead after a tree-kill. My diff touches **zero** files outside `apps/web`, and the
  same 8 failed before and after. All 31 `apps/web` test files (678 tests) pass, and
  `bun run typecheck` is clean.
- **The prompt's gotcha about preserving `newChatRequest` and `SettingsLocation` does
  not apply here.** This branch was cut *before* the chat-and-creation-doors and settings
  flows merged, so neither seam exists in this tree — `ProjectShell` still has the plain
  `newChat = () => { selectProject(); talk.start() }` and `setSettings(boolean)`. Nothing
  to preserve, but whoever merges this branch into a `main` that has them should expect a
  conflict in `ProjectShell.tsx`'s prop wiring (not in the routing logic, which is
  additive).
- **The Quick overlay is not a pure overlay.** `startQuickChange()` clears
  `projectSelected` and `preparing`, so opening Quick from the chat or preparation view
  genuinely moves the location and would have pushed a history entry — breaking
  "overlays never enter history". Fixed by giving `useHistorySync` a rule: a `null`
  location means "not mine to state", and the next write after a `null` is a *replace*.
  ProjectShell passes `null` while `ws.creating`. Side effect: creating a feature *from*
  the Quick door replaces rather than pushes, so Back skips the chat you opened it from.
  Judged acceptable; noted here in case it reads wrong in review.
- A bare `/` deliberately does **not** count as "the URL has an opinion" — otherwise
  localStorage would never be consulted again, contradicting decision 1's "localStorage
  keeps one job: where a bare `/` launch lands".
- Vite needs no change: no `appType` override, so the default SPA history fallback
  already serves `index.html` for `/p/...`. Production is covered too —
  `packages/server/src/routes/web.ts` already falls back to `index.html` for any
  unmatched non-`/api` path.

## Drive machinery

Checked, not run (no services in this sandbox): my change adds no service, no required
env var, no seed and no extra process, so `.runcastle/drive-setup.ts` and
`drive-stop.ts` need no edit and were left untouched. I did not execute them.

## Left undone

- `packages/server/src/routes/web.ts`'s doc comment still says "The app is a single-screen
  workspace with no client routes" — now false, and it is the justification for the SPA
  fallback my routes depend on. Left alone because server files are out of this feature's
  scope; worth a one-line fix in a later ticket.
- The `view` prop consumption in Titlebar and StatusBar (see above) — tickets 2 and 4.
- `showsInspector(view, collapsed)` was left with its existing signature. Decision 5 says
  it "widens to *column exists at all*" — as written it already returns exactly that
  boolean, so I used it for the grid rather than changing it. If ticket 3 wants the
  collapse toggle and the column-exists question separated, that split is still open.
- The read-only phase pin stays out of the URL (`?phase=` is explicitly a later lap).

## 2. Sidebar redesign: roomy rows, resizable rail, styles migration

# Ticket 2 — sidebar redesign: roomy rows, resizable rail, styles migration

## What was done

The features rail is rebuilt on Tailwind utilities and is now roomy and resizable.
Rows are two-liners: line 1 is the phase dot (or the parked draft glyph), the title
with `line-clamp-2`, and the one `rowChip`; line 2 is the six-segment mini-map plus
`ticketProgress` when there is any. The slug is gone from the row — the kebab gains a
**Copy link** action for every status (`window.location.origin + pathFor(...)` from
ticket 1's codec, copied through the existing `copy-text.ts` toast pattern), placed
above the unchanged Archive / Unarchive / Delete. The rail widens to 300px and gains a
6px drag handle on its right edge: `lib/sidebar-width.ts` is the new seam (clamp
240–420, one global localStorage key `runcastle.sidebar.w`, `useSidebarWidth`), the
handle lives in `Sidebar.tsx`, and `ProjectShell` applies the width as an inline
`--sidebar-w` on the shell grid root — the variable ticket 1's grid already reads.
Lanes, the Shipped cap and expander, the archived toggle, the pinned project row, the
prep foot row and the two doors keep their behaviour exactly. Both doors are ghost.

Migration: the whole `SIDEBAR — triage rail` section plus the `.prep-nudge*` foot rules
are deleted, 4273 → 3896 lines, ratchet lowered in the same commit. Tests: tier-1 static
markup for the row (`test/sidebar-row.test.ts`), tier-2 happy-dom for the drag
(`test/sidebar-resize.test.tsx`).

**Deviations.** Two rules were kept rather than deleted, both deliberately.
`.feature-dot` and `.phase-bg-*` survive with a note: `CommandPalette.tsx` still builds
its dot class by interpolation (`phase-bg-${f.phase}`) and would lose its dots. They
belong to the palette's flow (ticket 3) now. And `.spin-ring` stays as the shared
spinner it always was — it is a global rule with four callers, not the rail's to retire;
the rail's two size/colour overrides of it are gone, so the "Working" chip's spinner is
the standard 12px orange one.

## Surprises

- **The prompt's baseline is wrong for this checkout, exactly as ticket 1 reported.**
  Actual: 155 files, 2565 tests, **8 failing** before and after my diff —
  `packages/server/test/burn-slot-workspace.test.ts` (7, it clones a temp repo that does
  not exist) and `dev-pane.test.ts` (1, asserts a process group is dead). On my final
  full run a ninth appeared, `packages/server/test/pty-teardown.test.ts`; it **passes on
  its own**, so it is load-flakiness in the same process-teardown family. My diff touches
  only `apps/web`. All 33 `apps/web` test files (690 tests) pass, typecheck is clean, and
  `bun run build` succeeds.

- **`apps/web` has no Tailwind preflight, and this bites harder than STYLE.md's note
  suggests.** A bare `<button>` keeps the UA's grey `ButtonFace`, its 2px outset border
  and `cursor: default` — every legacy rule I deleted had been resetting those by hand.
  Worse, `styles.css` line ~98 carries an **unlayered** `button { color: inherit;
  font-family: inherit }`, and unlayered CSS beats the `@layer utilities` output whatever
  the specificity — so a `text-*` utility written on a `<button>` silently does nothing.
  Every button in the rail and in `FeatureActionsMenu` therefore carries `group` and puts
  its colour on a span inside, switching on `group-hover`. **This is not confined to my
  surface**: `ui.tsx`'s `Button` puts `text-accent-ink` on the solid variant and
  `text-danger` on the danger variant directly on the `<button>`, so both are currently
  overridden app-wide. I did not touch `ui.tsx` — out of this ticket — but somebody
  should.

- **Two Tailwind utilities for the same property on one element are a coin flip** here,
  because the repo deliberately has no `tailwind-merge`. `bg-transparent` in a shared
  base string plus a conditional `bg-accent-soft` is undefined behaviour, not a
  cascade you can reason about. So `BUTTON_RESET` is just `cursor-pointer`; every button
  states its own background and border once.

- The mini-map's `upcoming` segment renders with a border, and `styles.css` sets
  `* { box-sizing: border-box }`, so it stays the same 10×4 box as the others. Also
  `.mini-seg.is-skipped` was dead: `StepState` has only done / current / upcoming.

- `ProjectShell` sets `--sidebar-w` inline, which shadows the theme value, so
  `theme.css`'s `--sidebar-w: 252px` was stale-but-harmless. I moved it to 300px so the
  documented default matches decision 10 rather than contradicting it.

## Drive machinery

Checked, not run. My change adds no service, no required env var, no seed and no extra
process, so `.runcastle/drive-setup.ts` and `drive-stop.ts` need no edit and were left
untouched. I did not execute them (no services in this sandbox).

## Left undone

- **`ui.tsx`'s `Button` colour bug** described above — `solid` and `danger` variants'
  text colours are dead under the unlayered `button { color: inherit }`. Fixing it means
  either the `group`/span idiom used here, or deleting that base rule, which is a
  whole-app change and not the rail's call.
- `.feature-dot` / `.phase-bg-*` are the palette's to delete (ticket 3). When it
  migrates, it will want a `Record<Phase, string>` lookup — `PHASE_DOT_BG` in
  `Sidebar.tsx` is exactly that and could move to `ui.tsx` beside `PHASE_FG` rather than
  being written twice.
- The drag handle is mouse-only, as the ticket scoped it. It carries
  `role="separator"` + `aria-orientation` but no keyboard resize and no `tabindex`.
- `Sidebar.tsx` is ~615 lines now and holds four concerns (the rail, the handle, the
  project row, the feature row). Splitting it was not in the ticket; it is the obvious
  next code-quality move if a later flow touches this file.
- The prototype omits line 2 entirely on draft rows; I kept the mini-map on every row,
  which is decision 10's literal text and the existing behaviour. If the human wants the
  prototype's reading, it is a one-line change.

## 3. Titlebar, status bar and palette: breadcrumb, single health, labeled groups

# Ticket 3 — titlebar, status bar and palette

## What was done

The titlebar now reads as a three-level breadcrumb (brand / project switcher /
current thing). The third level names the selected feature's title, "Chat" or
"Preparation", and clicking it calls up to the project home; on `create` and
`empty` views there is no third level at all. Its health dot is deleted, and the
runs pill counts runs in *other* projects — `aggregateRuns(stats)` in
`lib/projects.ts` became `runsElsewhere(stats, currentProjectId)`, taking entries
tagged with a `projectId`. The inspector toggle is now gated on `view ===
'feature'` (ticket 1 passed the view but did not gate it).

The status bar's branch segment renders only when the view is a feature — the
derivation is `view === 'feature' ? find(...) : undefined`, so the copy handler
cannot fire on a stale branch either. The per-project "N runs" segment is gone.
Sandbox, driving + stop, notify, live dot and the server-ok chip all stay; the
notify offer moved to `NOTIFY_OFFER` in `lib/vocabulary.ts` and reads "Notify me
when agents finish a run".

The palette always draws its three group labels, renames "Switch project" to
"Projects", and lists all five actions on an empty query. Keyboarding is
untouched.

All four surfaces are migrated off `styles.css` — the titlebar block, STATUS BAR,
COMMAND PALETTE, the multi-project switcher block, and the phase-dot block that
was only being kept alive for the palette. The ratchet went 3896 → 3567.

**Where it deviated from the ticket.** Three places, each deliberate:

- The ticket's gotcha about `openSettings(SettingsLocation)` does not apply on
  this branch. `SettingsLocation` does not exist here — the settings flow landed
  on `main` after this feature's branch was cut — so the shell still opens
  settings with a boolean, and I followed what landed rather than inventing the
  contract.
- The runs pill's tooltip is not "unchanged". It said "Runs in flight across all
  projects"; with the count now excluding this project that sentence would be
  false, so it says "in other projects", which is what the approved prototype
  says.
- Palette feature rows no longer print the slug. The ticket did not ask for this
  either way, but the approved prototype's rows do not carry it (decision 14
  makes the prototype the visual reference) and it is what buys the title its
  room. The slug is still a *match* term, so searching by it still works.

Two small things outside the four named files. `PortfolioHome.tsx` was using
`.tb-home` / `.tb-logo` / `.tb-spacer`, which are titlebar rules this ticket had
to delete — those three spans are inline utilities now. And the phase dot became
a `PhaseDot` primitive in `ui.tsx` (documented in `STYLE.md`) rather than a third
copy of the same six-entry colour map; `Sidebar.tsx` reads it too.

## Surprises

- **`matchesPreparation('')` was already `true`** — every string contains `''`,
  so "all five actions on an empty query" was accidentally satisfied by
  `TERMS.includes(q)`. That is a coincidence, not a rule, and the next person to
  swap the needle and haystack would have silently broken discoverability. The
  rule is now stated: `matchesTerms` is `q === '' || terms.includes(q)`.
- **`.wordmark*` could not be deleted with the rest of the titlebar.** Those
  rules belong to `LogoWordmark` in `icons.tsx`, which the portfolio home renders
  too. They are left behind under their own section header, for the portfolio
  flow to take.
- **No preflight bites buttons twice, not once.** The documented trap is
  `button { color: inherit }` beating a `text-*` utility. The one that actually
  broke my first pass is that a `<button>` (and an `<input>`) also keeps the
  UA's *font size* — 13.33px Arial — unless the surface names a step on the ramp.
  Every button content span here does now.
- **Two server tests fail in this sandbox and are not mine.**
  `packages/server/test/burn-slot-workspace.test.ts` (7 tests) and
  `packages/server/test/dev-pane.test.ts` (1 test) fail with
  `fatal: repository '/home/agent/cache/tmp/rc-slot-...' does not exist` and a
  process group that survives its kill. They fail identically on a targeted run,
  and `git diff 8190967..HEAD` touches nothing outside `apps/web`. Everything
  else is green: typecheck clean across all four packages, and all 716 tests in
  `apps/web` (35 files) pass.

## Left undone

- The palette is still a hand-rolled overlay rather than running through
  `Dialog`, which `STYLE.md` says every overlay should. I left it: its Escape
  handling is deliberately custom (`stopPropagation`, so it does not close the
  Settings dialog underneath), the ticket says keyboarding is unchanged, and a
  landed test pins that behaviour. Whoever converts it has to preserve that.
- `ui.tsx` now has two phase colour maps — `PHASE_FG` (text) and `PHASE_DOT_BG`
  (background). They could be one map of tokens with two renderers; not worth a
  diff inside this ticket.
- The drive machinery needed no edit: this ticket adds no service, env var, seed
  or process. I confirmed the two scripts the drive commands name
  (`.runcastle/drive-setup.ts`, `.runcastle/drive-stop.ts`) exist, and did not
  run them — the sandbox has no app to boot. Neither is a shell script, so
  `bash -n` did not apply.

## 4. Inspector rework: feature-only column, read-only gate card, product-language activity

# Ticket 4 — Inspector rework

## What was done

`Inspector.tsx` (421 lines) is gone, split into `components/inspector/` the way
`components/workspace/` is a folder: `Inspector.tsx` (rail frame, tabs, the one
event feed both tabs read), `GateCard.tsx`, `Knowledge.tsx`, `Activity.tsx`. No
barrel — `ProjectShell` imports `./inspector/Inspector`, matching how
`components/workspace/` is imported. The public `<Inspector featureId>` signature
is unchanged.

The gate card is read-only. The plain name leads, the code follows it as dim
mono, then the requirement and the ready/blocked line. Deleted: the "Override
with reason…" link, the reason form, the consequence line, the undo banner, and
both mutations. `packages/server` is untouched — the whole diff is inside
`apps/web`. `undoableOverride` in `lib/feature-ui/gates.ts` lost its only caller
and went with its private `phaseTransition` helper and its seven tests; nothing
else imported either.

The standing "Gates are the human approval points…" sentence is now an ⓘ on the
Current gate caption. `GATE_EXPLAINER` is unmoved in `lib/vocabulary.ts`; only
its rendering changed.

`activityLine` gained two layers so no event type slug is ever a summary:
`feature.created` writes its sentence from its `data` payload ("Feature created
on branch feature/x, from main"), and anything else whose message leads with its
own type gets the slug read back as words ("Feature created — branch pending").
The empty-message and empty-tool-call fallbacks now humanize the type instead of
printing it. The dim `type · time` subline is untouched.

The INSPECTOR RAIL section is deleted from `styles.css` and rebuilt on utilities
against the approved prototype; the ratchet went 3567 → 3349.

**Where it deviated from the ticket.** Three places:

- **DOC PEEK stays in `styles.css`.** The ticket assigns it to this ticket, but
  `.peek` / `.peek-head` / `.peek-body` / `.peek-close` / `.peek-backdrop` are
  what four other overlays render through — `SettingsOverlay`, `DeleteFeature`,
  `AddressNotes`, `DirectoryPicker` — and `STYLE.md` names that arrangement
  explicitly as how those five keep their look until their own flow lands.
  Deleting the section breaks four surfaces this flow does not own; migrating
  only `DocPeek.tsx` onto utilities would leave every rule in place and shrink
  nothing. Its peek classes did not block anything, which is the ticket's own
  condition, so `DocPeek.tsx` is unchanged.
- **`.override-input` survived the deletion.** `workspace/NextStepBar.tsx`
  renders it for its own reason prompts. The rule (and its `:focus`) moved into
  the NEXT-STEP BAR section with a note; that flow migrates it.
- **`eventTone` was replaced by `eventLevel`, not moved.** The row's dot colour
  was a second, cruder copy of `lib/activity.ts`'s `eventLevel` — the one that
  reads a `run.finished` payload rather than keyword-matching the type, which is
  the bug that painted failed burns green. Carrying the duplicate into the new
  file would have been a review finding, so the row reads the real derivation and
  a failed run in the feed is now red.

## Surprises

- **`ProjectShell` already did criterion 1.** Ticket 1 dropped the grid column
  and ticket 3 gated the titlebar toggle on `view === 'feature'`, both with
  tests (`project-workspace.test.ts` `showsInspector`, `chrome-bars.test.ts`
  "titlebar inspector toggle"). There was one remnant to delete — the
  `.inspector` rule itself — and nothing else. No new test was needed here and
  none was added.
- **The old row clamped its summary to two lines in CSS, on top of the 140-char
  truncation `activityLine` already does.** The new row does not. A message
  under 140 chars can wrap to three lines in a 300px rail and gets no expander,
  so a CSS clamp would silently cut text with no way to see the rest — the exact
  F10.5/F18 complaint. Rows are as tall as their sentence now.
- **The ⓘ tooltip has to open downward.** The prototype opens it upward, but the
  rail's pane is `overflow-y-auto`, which computes `overflow-x` to `auto` too, so
  a popover leaving the pane in any direction is clipped. It is anchored to the
  caption row (not the mark) and opens down, where 230px fits inside the pane's
  268px of content width.
- **The full suite has 9 failures, none in `apps/web`.** Eight are the
  environment faults ticket 3 already recorded (`burn-slot-workspace.test.ts` 7,
  `dev-pane.test.ts` 1). The ninth,
  `merge-conflict.test.ts > lets a recorded conflict be retried`, asserts one
  event's `ts` is ≥ another's and saw them go backwards under parallel load; it
  passes on a targeted re-run, so it is a flake in that timing assertion rather
  than a real ordering bug. `apps/web` is 36 files / 725 tests green, and
  `bun run typecheck` is clean across all four packages.

## Left undone

- `DocPeek` and the `.peek*` family (see above) — whoever owns the last of those
  five overlays gets to delete the section.
- The two `phase.advanced`-shaped emit sites in `packages/server` that write
  `feature.created (…)` as their message are still writing slugs; the web app
  now reads them correctly, but fixing them at the source would let the
  `deslug` fallback retire. Out of scope — this is a web-app feature.
- The palette is still a hand-rolled overlay rather than a `Dialog` (ticket 3's
  observation, unchanged).
- **Drive machinery:** no edit needed. This ticket adds no service, env var,
  seed or process — it deletes UI and moves CSS. I confirmed both scripts the
  drive commands name (`.runcastle/drive-setup.ts`, `.runcastle/drive-stop.ts`)
  exist and did not run them; the sandbox has no app to boot, and neither is a
  shell script so `bash -n` did not apply.

## 5. Review: drive the redesigned shell end to end

Reviewed in Drive mode: walked the app against the acceptance criteria.

This lap gave the app a real address bar. Every place you can stand now has a URL — the portfolio, a project, a feature, the project chat, preparation — so a refresh puts you back where you were, browser Back and Forward walk your actual path instead of dumping you out of the app, and you can send someone a link to a feature. The rail's kebab gained a Copy link that hands you exactly that URL. Overlays deliberately stay out of it: opening the palette, Settings or the Quick sheet adds nothing to your history, so Back never degrades into "close the popup".

The chrome around that got quieter and roomier. The sidebar starts at 300px instead of 252 and you can now drag its edge to anywhere between 240 and 420, and it remembers the width across reloads — which matters, because feature titles now wrap to two lines instead of truncating, so five features whose names all start "Flow redesign:" are finally telling apart at a glance. Rows kept the six-segment pipeline mini-map and dropped the slug. The titlebar reads as a breadcrumb — runcastle / project / the thing you are looking at — and the third level clicks back up to the project home. The duplicated health dot is gone; server health now lives once, in the status bar, with the API address in its tooltip. The status bar stopped showing you the previous feature's branch on screens that have no feature, and stopped carrying a run count the rail already itemises by name.

The Inspector is honestly feature-scoped now: on the chat and preparation screens the whole column disappears rather than sitting there blank, and the toggle for it disappears with it. The gate card lost the override form that was never used and the standing "Gates are the human approval points…" sentence that repeated on every feature forever — that explanation is now behind an ⓘ you press when you want it. The palette shows its whole hand on an empty query, all five actions under three labelled groups, so Preparation and Settings are findable without guessing the word.

What is worth your attention: the New chat door is broken on this branch. With a conversation already running, clicking New quietly drops you into that existing chat instead of offering you the choice between opening it and ending it to start fresh — the exact complaint you raised going in, and the notice that was supposed to have fixed it is not here. Settings is likewise the old flat scrolling dialog rather than the page-addressed one. Both look like the same cause: this branch was cut before the chat-and-doors and settings flows landed on main, and the shell rewrote the very files that carry their seams, so the merge back deserves a careful look rather than a fast-forward. Smaller, the gate explainer popover opens on top of the gate name it is explaining.

Four things I could not check. The drive boots an empty database, so I built state by hand — onboarding, this repo as a project, one parked draft — and that got me most of the way, but landing on the top triage feature needs a feature past draft, and every route to one cuts a real git branch in your checkout, so I left it. The runs pill, the update banner and the DocPeek overlay likewise had no state to render against. Everything else in the walk held up, and the recording shows the whole pass.

## 6. New chat door silently reopens the live chat — the "Open it / End it and start new" notice never appears

What was done
Restored the shell’s `newChatRequest` plumbing for both the project-home and rail-head New doors.
With a live project chat, New now renders the inline “Open it” / “End it and start new” notice.
“Open it” returns to the mounted live session; replacement ends that session and launches with `fresh: true`.
Added a DOM regression test that renders the notice and exercises both choices.
Re-ran the reported interaction at its rendered seam: both labels appeared and both actions fired once; the old silent-open result did not occur.

Surprises
The branch retained the talk hook’s launch guard but had lost both the request signal and `talk.replace` from the later chat-flow baseline.
The full suite reached 2,585 passing tests but had 12 unrelated environment-sensitive server failures involving inherited git/auth variables, temporary repositories, and process teardown; typecheck and focused tests passed.

Left undone
No project-chat visual redesign was attempted; this ticket only restored the promised shell seam.
No drive scripts were run or changed because the fix introduces no service, boot variable, seed, or companion process.

## 7. Gate explainer popover covers the gate name and requirement it is explaining

What was done

The Current gate explainer was moved out of absolute positioning and into its own in-flow row beneath the caption controls.
Opening the help now increases the caption area's height and moves the read-only gate card down, leaving its name, code, requirement, and status readable.
Hover and keyboard-focus disclosure, the accessible name "What a gate is", and the approved explainer copy were preserved.
A rendered Inspector regression test now pins the in-flow placement and rejects absolute positioning.
The reported repro was re-run at the rendered component seam: revealing the explainer no longer places it over the following gate card.

Surprises

The full test command reached 2,585 passing tests but failed 12 unrelated server tests in burn-slot workspace, dev-pane process cleanup, and host credential handling; the changed Inspector test and the full typecheck are green.

Left undone

No adjacent Inspector behavior or styling was changed, and no drive machinery update was needed because this ticket adds no service, environment variable, seed, or process.
