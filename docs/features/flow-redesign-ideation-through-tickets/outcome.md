# Outcome — Flow redesign: ideation through tickets

Redesign the feature's first half end to end — grill session and map/waypoint rail, spec doc, ticket ledger and in-place editing, gates and overrides, the pipeline stepper and next-step bar through ideation→spec→tickets — walked and confirmed with the human before design.

- Shipped: 2026-09-06
- Lap: 1

## 1. Next-step bar: one door per state, Work next, lap-scoped counts, no gate-skipping verbs

What was done
Reworked the ideation, spec, and tickets next-step resolvers into one-door state tables.
Added lowest-sequence ready-waypoint targeting, research waiting, mapped convergence recovery, and lap-first ideation behavior.
Scoped ticket counts to the current lap and replaced Revisit with the hinted Ask for changes action.
Removed gate-skipping action kinds, the reason prompt, and duplicate fog/warning fields.
Rebuilt NextStepBar markup with Tailwind utilities and a single dim note line.
Wired Work next and Resume converge through Workspace mutations.
Made session lap available on the wire and shared the server gate's lap-worked query with doc gates.
Added resolver, static markup, and mapped G1 gate coverage.

Surprises
The required full suite inherited pager, OAuth-token, and TMPDIR values from the burner environment; 11 unrelated tests recovered when those values were sanitized.
One unrelated dev-pane process-group teardown assertion still fails in this container; all 343 touched seam tests pass and typecheck is green.

Left undone
No drive machinery changed because this ticket introduced no service, required boot environment variable, seed, or companion process.

## 2. Grill body split: artifact pane (decisions / spec) beside the terminal, session strip, Details panel default

What was done
Split the ideation/spec body into GrillBody, ArtifactPane, MapRail, and WaypointCard modules.
Added pure artifact selection and decision counting with tier-1 coverage.
Added a live-polled 380px decisions/spec pane with markdown rendering, empty states, collapse persistence, and a reusable keyboard-accessible docs menu.
Added SessionStrip with plain kind names, elapsed/ended status, done summaries, and no duplicate resume or work-next action.
Removed the spec card, converge recovery body action, ended-session resume action, and legacy grill/terminal/strip hooks from the redesigned surface.
Made the Details default phase-aware while preserving an explicit preference globally, including the first-toggle edge case.

Surprises
Session rows expose createdAt rather than dedicated startedAt/endedAt fields, so elapsed and ended age use that available wire timestamp.
The exact full test command inherited TMPDIR, GIT_PAGER, and an OAuth token from the burner; after sanitizing TMPDIR/token, four unrelated server tests remained red from GIT_PAGER and the known dev-pane teardown assertion.
Typecheck and all 56 web test files (925 tests) passed.

Left undone
The app was not opened because no dev server was available; no drive machinery changed because this ticket added no boot dependency.
MapRail and WaypointCard visuals intentionally retain their existing behavior and legacy styling for ticket 3.

## 3. Map rail as a progress checklist

What was done
Redesigned the mapped-ideation rail as a Tailwind progress checklist with done/total progress in both expanded and collapsed states.
Renamed the derived display groups to Ready, Working, Waiting, and Done and added state words, blocker naming, read-only expansion, and map progress.
Reworked waypoint cards so state leads, type is visually secondary, ready work/resume behavior remains intact, and read-only records expose summaries without actions.
Added the waypoint explainer, map document menu with DocPeek wiring, and an explicit ideation-only rail condition.
Added tier-1 derivation coverage and static live/read-only/collapsed rail markup coverage.

Surprises
Core owns the map document headings but does not export their names, so the existing local list remains with an explanatory comment.
The exact full suite ran 2,819 tests but had 12 unrelated environment-sensitive server failures from inherited GIT_PAGER, OAuth, temp-path rewriting, and the known dev-pane teardown assertion.
Typecheck and all 57 web test files passed: 931 tests green.

Left undone
Legacy map selectors remain in styles.css as ticket 6 explicitly owns their deletion and ratchet update.
No drive machinery changed because this ticket introduced no service, required environment variable, seed, or companion process.

## 4. Ticket ledger: row model menu, model for all pending, cancel ticket, collapsible session strip

# Ticket 4 — ticket ledger: model menus, cancel, collapsible strip

## What was done

`TicketsBody.tsx` is split into `components/bodies/tickets/` — `TicketsBody` (query, session
strip, wire calls), `TicketLedger` (header, lap grouping, rows), `TicketRow` (head, expanded
detail, actions), `TicketEditor` (title/goal/context/acceptance only) and a `ModelMenu` shared
by the row and the bulk control. `Workspace` imports the new path at both call sites. Pending and
failed rows carry the model menu in the head and save through the existing model-only partial
`ticket.edit`; other statuses keep the static chip. The ledger header carries `Model for all
pending`, which edits every pending ticket of the current lap in sequence and toasts the count,
plus the docs menu and the sandbox / default-model chips, with counts scoped to the current lap.
The expanded row offers `Edit ticket` and `Cancel ticket` with the inline confirm wired to
`ticket.cancel`; both are hidden when `readonly`, so ticket 5 can render the ledger as a frozen
record. The session strip is open at full height while the session is still emitting and folds to
one line once tickets exist, remembered per session in `sessionStorage`; the `.tickets-session`
class and its `100dvh − 420px` guess are gone from this surface, as are the `.ledger*`, `.lg-*`,
`.td-*`, `.body-*` names and the two `as SettingsView` casts. `styles.css` is untouched (ticket 6).

The one deviation from the ticket text: the split had closed the editor the moment Save was
clicked, so a rejected save silently dropped the human's text. The row now awaits the mutation,
shows `Saving…` while it is in flight and closes only on success — restoring what the pre-split
body did — which made `onEdit` return a promise through the ledger.

## Surprises

Four commits from an earlier interrupted attempt were already on the branch and covered most of
the ticket; the work here was auditing them, closing the editor/cancel-on-failure regression and
adding the missing tier-2 coverage (editor fields, the quiet ended-session line). `DocsMenu`
(ticket 2) hardcodes `ml-auto` for the artifact pane's header, which collided with the ledger
header's own spacer and floated the menu into the middle — a wrapper in the ledger absorbs it
rather than changing a component another body depends on.

The full suite is NOT green here, and was not before this ticket: 8 failures in
`packages/server/test/burn-slot-workspace.test.ts` (7) and `dev-pane.test.ts` (1). I confirmed
them identical at commit 65f0c70 (ticket 2's head, before any of this ticket's work) in a scratch
worktree — they are sandbox faults, temp-dir git clones and process-group kills, unrelated to this
web-only diff. `bun run typecheck` is 0 errors and all 58 `apps/web` test files pass. The stated
baseline of "118 files, 1768 passed" is stale — the suite is 180 files now.

No drive machinery change was needed: this ticket adds no service, env var, seed or process, so
`.runcastle/` is untouched and unchecked by design.

## Left undone

`ReviewBody.tsx` still carries an `as SettingsView` cast and `RunBody.tsx` still uses the
`.tickets-session` class — both are flow 7's files, left alone deliberately. `LapSections` in
`ui.tsx` keeps its `lap-group` hook class; it is shared chrome, so dropping the hook belongs with
the stylesheet cut in ticket 6. The strip's remembered state is keyed by session id (session-
scoped), which is what the spec asked to start with — worth revisiting if it surprises the human.

## 5. Pinned phases as a frozen record; stepper tooltips teach the pipeline

# Ticket 5 — pinned phases as a frozen record; stepper tooltips

## What was done

`lib/feature-ui/phase-summary.ts` is a new pure module: `phaseSummary` returns
`Ideation · 2d · 3 sessions · 12 decisions` / `Spec · written 2d ago` /
`Tickets · 11 emitted, 11 done` (per lap from lap 2, via `groupByLap`), null for
the other phases; `phaseFacts` returns the same line without the phase title, so
the banner can render the title bold and the facts dim without saying the word
twice. `phaseWindow` and `phaseSessions` come with it. Phase boundaries are read
off the `{ from, to }` payload every `setPhase` writes rather than off the event
*type*, because the burn crosses into implementation as `burn.started` and
Iterate loops back as `lap.started` — matching only `phase.advanced` (as the
ticket suggested) would never have found the tickets→build boundary.

`components/workspace/ReadonlyBanner.tsx` replaces the inline `readonly-bar`
block (utilities only, no `.readonly-*` names). `components/bodies/PinnedBody.tsx`
is dispatched from `PhaseBody` when the pin is on ideation/spec/tickets: ideation
gets the read-only map rail (mapped only) beside a new **static** `ArtifactPane`
rendering `decisions.md` plus a `Sessions · N` list; spec gets the static pane on
`spec.md` full width; tickets gets `TicketLedger readonly` with lap headers and
no header menus. `GrillBody` and `TicketsBody` no longer take or branch on
`readonly`. `PHASE_TIP` was rewritten and `PHASE_UNLOCK` added;
`pipelineSteps(feature, effective, summaries?)` now derives a per-step tip.

Two deviations worth naming. (1) Durations use `relTime`, so the banner reads
`2d`, not the decisions doc's prose `2 days` — the ticket said to reuse
`lib/format.ts` rather than add a formatter, and `fmtDuration` would have printed
`48h 00m`. (2) `sessionKindName` was moved *into* `lib/feature-ui/session.ts` and
`SessionStrip` now imports it, rather than exported from `SessionStrip.tsx` as
the ticket phrased it — a pure tier-1 module importing a `.tsx` component would
have inverted the layering and dragged React into the derivation's tests.

## Surprises

`DocSummary` really does carry no timestamp, so `Spec · written …` is dated from
the docs watcher's `docs.changed` event and says only `Spec` when the feed
carries none. `TicketLedger`/`TicketRow` needed their mutation handlers made
optional so a frozen ledger can pass none — commit shas render as static text
instead of copy buttons there. `PinnedBody` renders through happy-dom rather than
`renderToStaticMarkup`: the artifact pane reaches `useLivePoll` →
`useSyncExternalStore`, which has no server snapshot and throws under SSR.

The full suite is not green here and was not before this ticket: the same 8
failures ticket 4 recorded (7 in `packages/server/test/burn-slot-workspace.test.ts`,
1 in `dev-pane.test.ts` — temp-dir git clones and process-group kills, sandbox
faults unrelated to a web-only diff). `bun run typecheck` is 0 errors and all 61
`apps/web` test files (966 tests) pass. No drive-machinery change was needed —
this ticket adds no service, env var, seed or process — so `.runcastle/` is
untouched and, by design, unchecked.

## Left undone

Pinned **implementation** with no run still falls through to the live
`TicketsBody`, which is now always editable: removing `readonly` from that body
was an explicit acceptance criterion, and the implementation dispatch is flow 7's.
It is a narrow state (a feature at review/shipped that never had a run), but a
pending ticket there would now show an editable model menu. The `styles.css`
`.readonly-*` rules are dead but left in place for ticket 6, as instructed.
`SectionTitle` still carries its legacy `section-title` hook class — shared
chrome in `ui.tsx`, also ticket 6's.

## 6. Contract: delete this surface's legacy CSS, retire the vocabulary, lower the ratchet

# Ticket 6 — contract: delete the legacy CSS, retire the vocabulary, lower the ratchet

## What was done

`styles.css` went from 3337 to **2639** lines and `STYLES_CSS_LINE_BASELINE` moved with it.
Gone: the stepper (`.pipeline`, `.pstep*`, `.pconn`, `.pipeline-lap`), the whole next-step bar
block, the read-only and lap banners, `.ws-branch`, the body split (`.ws-body:has(.grill)`,
`.grill`, `.termpane`, `.body-hint`), the map rail (`.maprail`, `.mr-*`), every `.wp*` and
`.wp-confirm*`, `.mapdoc*`, `.map-section*`, `.map-waypoints > .dim-line`, `.converge-resume*`,
the doc card, `.spec-doc/-meta/-body`, `.grill-empty`, `.sess-end`, `.session-ended-card*`,
`.strip-done`/`.done-check`/`.done-txt`/`.strip-work-next`, the briefing and check-in notices,
the ledger's `.lg-seq/-block/-meta/-commits`, `.td-*` (bar the two the run body uses), `.seam`,
`.ledger .lap-group*`, plus `.gate-hint` and `.is-skipped` on `.pstep` and `.mini-seg`.

Four files had to be migrated before their rules could go: `LapBannerRow` (now a full-bleed row
matching the bar above it), `SessionPanel`'s briefing and check-in notices (the resend button
became the `Button` primitive while I was in that element — a small call beyond the listed
selectors), `PipelineStepper` (utilities plus a local `cx`, the current dot keeping the
`dotGlow` keyframe through `animate-[…]`), and `LapSections`, whose `lap-group`/`lap-group-head`
hooks are replaced by a `headClassName` the ticket ledger passes — the placement now comes from
the surface that knows where the header sits. `STYLE.md`'s hook table records that.

`GRILL_EXPLAINER` was the only vocabulary export with no caller; it and its two test cases are
gone. `apps/web/test/vocabulary-retired.test.tsx` renders the bar in all **fourteen**
ideation/spec/tickets states, the grill/tickets/pinned bodies, the map rail (open, collapsed,
pinned) and the session strip, and reads them for `/\bgrill|frontier|\bfog\b|promote|approve\b/i`,
`GRILL LIVE` and a `Revisit` button label. Each state and surface also asserts a marker, so a
fixture that stopped resolving cannot pass the sweep by rendering nothing. `listItem`/`full`/`wp`
moved out of `feature-ui.test.ts` into `test/fixtures.ts` so the sweep builds the same features.

**Deviation:** the ticket confined `Workspace.tsx` to the header. Deleting `.ws-body:has(.grill)`
forced one more edit — tickets 1–5 had already dropped `.grill` from their TSX, so the two-pane
bodies were relying on a rule nothing matched any more. `Workspace` now picks utilities over
`.ws-body`/`.ws-body-inner` for ideation, spec and tickets, which is that rule in Tailwind form.

## Surprises

**The 700-line target lands two short: the file shrank 698 lines.** The reason is that four
files outside this flow still consume rules the ticket expected to be free, so they were kept
per the ticket's own method: `PreparationWorkspace` holds `.grill-panel/-strip/-kind/-sid/-term/
-strip-spacer/-live-label`; `RunBody` holds `.ledger`, `.ledger-row`, `.ledger-head`,
`.ledger-detail`, `.lg-caret`, `.lg-title`, `.td-section`, `.td-body`, `.commit-sha`,
`.tickets-session`, `.body-title`, `.surface`; `ReviewBody` holds `.body-meta` and
`.review-session`; and `.ws-head`/`.ws-title*` could not go because `PreparationWorkspace` and
`FeaturePanes` render them too — so migrating only `Workspace`'s header would have bought a
divergent third header and no deleted lines. That is ~55 lines of keeps; releasing any of them
means editing a flow-7 or shell file, which the method forbids.

The stepper *was* migrated even though the spec calls its chrome shell-owned: the ticket lists
its selectors under WHAT TO DELETE, and `.pstep.is-skipped` had to go regardless (`StepState`
has no `skipped` member — that variant has been dead for a while). If the shell flow also
touches `PipelineStepper.tsx`, that file is the likely conflict.

The full suite is **not** green here and was not before: the same 8 failures tickets 4 and 5 both
recorded — 7 in `packages/server/test/burn-slot-workspace.test.ts`, 1 in `dev-pane.test.ts`,
temp-dir git clones and process-group kills, sandbox faults unrelated to a web-only diff.
`bun run typecheck` is 0 errors, all 62 `apps/web` test files (972 tests) pass, and
`bun run --filter '@runcastle/web' build` succeeds — I checked the emitted CSS to confirm
`h-6.5`, `bg-warn/8`, `animate-[dotGlow…]`, the arbitrary shadow and `[&>*+*]:border-t` all
generate. **There is no lint script**: the root `package.json` has none and neither does any
workspace, so typecheck + the suite is the whole gate. No drive-machinery change was needed
(no service, env var, seed or process added), so `.runcastle/` is untouched and unchecked.

## Left undone

`.talk-door` (13 lines) and `.pw-frame-list` (12) are dead but belong to the project-workspace
and preparation surfaces, so they wait for their flow. `WaypointCard` still carries
`btn btn-xs btn-ghost`/`btn-danger` — the shared `.btn*` block is not this flow's to delete, but
those call sites are ours and want the `Button` primitive when it is. `SessionPanel` has an
orphan doc comment about "the strip's done label", left over from when that moved to
`SessionStrip`. And the fixture module's `listItem` whitelists its overrides rather than
spreading them, so `mapped` and `lap` silently do not pass through — the new test works around
it with a local `feat()` helper; fixing `listItem` itself would touch 342 existing assertions.

## 7. Review: drive the redesigned ideation → spec → tickets flow

Reviewed in Drive mode: walked the app against the acceptance criteria.

This lap rebuilt the first half of the feature flow so that every screen from a fresh idea to the Burn click offers exactly one obvious thing to do next. The next-step bar is now the only place a session starts, resumes or converges, and it says in plain words why you are being asked — "Shape the idea with the agent", "Work the map", "Finish converging", "Review the tickets, then burn". The duplicate doors are gone: the ended-session card is a quiet one-line status, the old in-body converge-recovery bar has become a bar state, and the gate-skipping verbs (Promote, Approve, Override & converge) no longer exist anywhere. Every phase now shows the document beside the conversation — decisions accruing as the agent settles them, the spec rendering as it is written, the map as a progress checklist headed "MAP · 2/6 done" with plain-word cards that name the blocker instead of internal state names. The insider words are gone with them; grill, frontier, fog, promote and approve turned up nowhere in the whole walk.

The two things you asked for are both there. You can now choose the model per ticket straight from the ledger row instead of digging into the editor, and set every pending ticket at once from "Model for all pending" — I changed one row and then all four, and both stuck. Cancel ticket is wired up at last, with the confirm wording you specified, and a cancelled ticket stays in the ledger while the bar honestly recounts to "Burn 3 tickets". Pinned phases are real frozen records now: click a finished step on a shipped feature and you get the decisions, the spec or the lap-headed ledger inline, with no terminal and no buttons that would let you touch the past.

What is worth your attention is the layout, and it is the one thing that would spoil the first impression. The two-pane body never stretches to fill the window: at 1440×900 with the Details panel hidden the terminal comes out 368px wide beside the decisions pane and only 258px beside the map rail, with four hundred to six hundred pixels of empty space to the right of it. That is narrower than the roughly 400px that decision 15 called unacceptable, and it is the reason that panel is hidden by default in the first place — when I resumed a real session the agent's output was wrapping at about fifty columns. The tickets body has the same fault in a milder form, and "Show terminal" there opens the terminal to about half the body rather than full height. Nothing clips and the page never scrolls sideways; the space is simply unclaimed, so it should be a contained fix.

Three smaller honesty problems came out of the walk. A feature at spec whose spec.md exists still gets a bar reading "No spec yet" while the pane beside it renders the whole document. The pinned ideation view reports "0 sessions" on a feature with four of them and never shows the sessions list that was specified, and the same wrong count appears in the stepper tooltip. And the ended-session strip's "ended 17m ago" is really the session's start time wearing an end-time label — there is no end timestamp recorded anywhere, so it cannot currently be right. The pinned spec banner is also the only one of the three missing its summary line.

Everything else I could reach behaved. I could not use your real data for any of this, so I built a scratch project outside your checkout and seeded eight features across the states the ticket asked for; the two live-session screens sit on seeded sessions with no agent behind them, so their terminals read "session stream ended" — the surrounding chrome is what I measured there. The drive shut itself down just as I finished the last criterion, which is why the recording tails off on a loading screen; it tore down cleanly and your checkout is back on main and untouched.

## 8. The phase body's two-pane split never stretches: the terminal is 258–368px wide at 1440×900, not the ≥600px the criterion requires

# ticket(8) — the phase body now fills the workspace

## What was done

The two-pane body row that `Workspace` lays ideation, spec and tickets out in is a
flex row spanning the workspace, but every phase-body root sat in it at the default
`flex: 0 1 auto`, so each was sized to its content and left the rest of the row
unclaimed. Each root now carries `min-w-0 flex-1`: `GrillBody`, all three
`PinnedBody` roots (ideation, spec, tickets) and `TicketsBody`. Nothing else
changed — no wrapper, no pane width, no height. The panes' own widths were already
right (380px artifact pane, 300px map rail, both `flex-none`), so with the root at
the workspace's 1188px the terminal comes out at 1188 − 380 − 16 = 792px unmapped
and 1188 − 300 − 16 = 872px mapped, against the criterion's ≥600px.

`apps/web/test/phase-body-fill.test.tsx` renders all seven body states and asserts
each root grows into the row, with a per-body content marker so a body that quietly
rendered nothing cannot pass. I proved it red by reverting the `GrillBody` class
alone before committing, then restored it.

## Surprises

- **I could not re-run the reviewer's repro literally.** It is a browser measurement
  (`getBoundingClientRect` at 1440×900) and this sandbox has no browser, no chromium
  and no running app, and happy-dom/jsdom perform no layout — every box they report
  is 0×0. What I did instead: traced the whole CSS chain from `section.workspace`
  (`display:flex; flex-direction:column`, styles.css:734) through the two-pane
  wrappers (`Workspace.tsx:655-657`, the inner one `flex-1` inside a row, so 1188px)
  down to each body root, confirmed the pane width tokens (`--maprail-w: 300px`,
  `--artifact-w: 380px` in theme.css) and the `flex-none` on both panes, and did the
  arithmetic above. Someone with a browser should confirm the two numbers; the
  reviewer's own console snippet needs one edit to run now, since it matches
  `e.className === 'flex h-full min-h-0 gap-4'` exactly and that string is now
  `'flex h-full min-h-0 min-w-0 flex-1 gap-4'`.
- **The stated baseline is stale.** The suite is 185 files / 2861 tests, not the 118
  / 1768 in the prompt, and it is not fully green: 8 failures in
  `packages/server/test/burn-slot-workspace.test.ts` (7) and
  `packages/server/test/dev-pane.test.ts` (1). They are environmental — the burn-slot
  ones die on `fatal: repository '/home/agent/cache/tmp/rc-slot-…' does not exist`,
  the dev-pane one on a process-group kill — they fail identically on a targeted run,
  neither file imports anything from `apps/web`, and my diff is web-only. Typecheck is
  0 errors and all 63 web test files (973 tests) pass.
- The pinned and tickets bodies had the same defect (the reviewer noted the tickets
  one "in a milder form"), so fixing only the ideation root would have left the same
  container broken two clicks away. All five roots are fixed; the tickets ledger is
  now full-width rather than shrink-to-fit.

## Left undone

- The other faults the review reported are other tickets' and untouched here: at
  tickets, "Show terminal" opens the terminal to about half the body rather than full
  height (decision 6); the spec bar reading "No spec yet" beside a rendered spec; the
  pinned ideation "0 sessions" count; the session strip's "ended" timestamp really
  being the start time.
- No drive-machinery change was needed: this ticket adds no service, env var, seed or
  process, so `.runcastle/drive-setup.ts` and friends are untouched and unrun (running
  them here would only fail for want of an app).
- Nothing pins the wrapper side of this contract: a future edit that made
  `Workspace`'s two-pane wrapper a column would break the fill again without failing
  a test. Testing that needs a real layout engine, which the repo does not have.

## 9. At spec with spec.md present the bar still says "No spec yet" while the pane beside it renders the whole spec

# Ticket 9 — the spec bar no longer denies a spec that is on screen

## What was done

The spec-phase next-step resolver (`apps/web/src/lib/feature-ui/next-step/spec.ts`) already
computed `hasSpec` from the feature's docs, but used it for one thing only: gating the mapped
converge-stranded branch. Every other idle path fell through to the no-spec copy regardless of
what was on disk, so a feature at `spec` with a written `spec.md` got "Write the spec / No spec
yet — resume the session to draft it." directly above a pane rendering the whole document. Added
the missing branch: with `spec.md` present the bar reads **"Break the spec into tickets"** — "The
spec is written — it is on the left. Resume the session / Start a session: the agent reads it
back, emits a ticket per slice of work, and moves the feature on to tickets itself." The solid
action is unchanged (Resume/Start session), as the ticket said it should be: decision 8 removed
the approve verb, so the session is still the only door. Two tier-1 rows in
`feature-ui.test.ts` cover it (never-started and resumable-conversation), and the vocabulary
sweep in `vocabulary-retired.test.tsx` — which claims to render *every* state these three
resolvers return — gained a `spec · spec written` case and its marker.

## Re-running the reviewer's repro step

I cannot drive the app here (this sandbox has no services and no seeded project), so I re-ran the
repro at the level it is observed: a scratch test that built the exact payload — phase `spec`,
`docs` carrying `spec.md`, an ended resumable session — and rendered the real `NextStepBar` and
the real `GrillBody` from it together, exactly as the screen stacks them. Before the fix the bar
read "Write the spec / No spec yet …"; after it, the bar reads "NEXT STEP · Break the spec into
tickets · The spec is written — it is on the left. …· [Resume session]" while the pane beside it
renders Problem / Approach / Seams / Out of scope and no `View ›` peek card. The two now agree.
The scratch test was deleted after reading its output; the two permanent tests cover the same
assertion.

## Surprises

- The pane and the bar read the *same* `full.docs` list, so this was never a data problem —
  purely a branch the resolver never grew. That also means the fix cannot drift from the pane.
- The lap wrinkle I expected does not arise: `rethink` sends a feature back to `ideation`, whose
  G1 is already lap-scoped, so you cannot reach `spec` on lap 2 on lap 1's artifacts. No
  lap-specific copy was needed here.
- `bun run test` is **not** fully green in this sandbox, contrary to the stated baseline: 8
  failures across `packages/server/test/burn-slot-workspace.test.ts` (7) and
  `packages/server/test/dev-pane.test.ts` (1). They are environment faults — the burn-slot ones
  all die on `fatal: repository '/home/agent/cache/tmp/rc-slot-vol-…' does not exist` while
  shelling out to real `git clone`, and the dev-pane one asserts a killed process group is
  reaped. I confirmed them on one targeted run of just those two files; my diff is three files,
  all under `apps/web`, and every apps/web test passes. `bun run typecheck` is clean (0 errors).

## Left undone

- The reviewer's three other honesty findings from the same walk are other tickets and were not
  touched: the pinned-ideation "0 sessions" count and its stepper tooltip, the ended-strip's
  "ended Nm ago" that is really the start time, and the missing pinned-spec banner summary.
- The two-pane width problem (terminal at 368px / 258px) is untouched — it is the reviewer's
  headline finding and not this ticket.
- Drive machinery needed no edit: this change adds no service, no required env var, no seed and
  no process, so `.runcastle/drive-setup.ts` and `drive-stop.ts` are already covered by their
  idempotent steps. I did not run them (no services here) and did not need to.

## 10. At tickets, "Show terminal" opens the terminal to about half the body (334px of 627px), not full height

# ticket(10) — "Show terminal" now opens the tickets terminal at full body height

## What was done

The open session panel was `flex-1` sitting beside a ledger at its natural height, so the
two split the body: the panel grew into whatever the ledger did not use (334px of 627px).
The fix makes the open panel occupy the body outright and lets the ledger overflow beneath
it, which is what the column's `overflow-y-auto` was always there for.

Doing that meant moving the open/collapsed choice out of `TicketsTerminal` and into
`TicketsBody`, because the choice decides how the body's height is shared between *two*
children — the panel and the ledger — and only the body renders both. It is now a
`useTerminalStrip` hook read above the loading guards (hooks must be unconditional), so
the panel wrapper gets `h-full shrink-0` and the ledger wrapper `shrink-0` while open, and
the ledger keeps its old shrink-to-fit-and-scroll-internally behaviour while collapsed.
`TicketsTerminal` is now presentational, takes `open`/`onToggle`, and is no longer exported.

One behavioural consequence of the move: the hook mounts before the session id is known, so
the stored choice is read in an effect keyed on the session rather than in the `useState`
initializer. The effect is now the single reconciler (stored value wins; absent one, open
iff this lap has no tickets) instead of the previous "fold once" special case.

The two strip tests moved with the behaviour, from `tickets-ledger.test.tsx` (which rendered
`TicketsTerminal` directly) to `tickets-body.test.tsx`, where the body is the seam. They now
also assert the sizing contract on the classes, plus a third test that the ledger stays
shrinkable while collapsed. happy-dom computes no layout, so classes are the only proxy
available in-suite — see below for the real measurement.

## The repro step, re-run

I could not literally re-run the reviewer's repro: this sandbox has no services and no app,
so there is no running runcastle to seed "Echo tickets pending" into. Instead I measured the
geometry directly. I built `apps/web` to get the app's own generated stylesheet, installed a
headless Chromium (playwright-core plus the missing shared libraries, extracted from Debian
packages into a local sysroot — no root needed), and rendered a harness reproducing the exact
ancestor chain from `.workspace` down through `Workspace.tsx`'s two-pane wrappers into
`TicketsBody`'s column, at 1440x900 with the header block sized so the column comes out at
627px and the ledger at 281px — the reviewer's two numbers.

    BEFORE  627, 627, [334, 281]     <- reproduces the reported defect exactly
    AFTER   627, 920, [627, 281]     <- panel at full body height, column now scrolls

That is the criterion's "Expected" line: the session panel at ~627 with the ledger scrolling
beneath it (`scrollHeight > clientHeight`). The test also pins the column's className to the
exact string the repro's selector matches, so the repro keeps finding the element it measures.

## Surprises

- The stated baseline in the prompt is stale: it says 118 files / 1768 tests fully green, but
  the suite on this branch is 184 files / 2861 tests. Two server files fail here in isolation
  and are unrelated to a web-only diff — `burn-slot-workspace.test.ts` (8 failures: it shells
  out to `git clone` against a scratch volume under `/home/agent/cache/tmp` that does not
  survive, "fatal: repository ... does not exist") and `dev-pane.test.ts` (1: it kills a real
  process tree). Four more files (`git`, `delete`, `burn-robustness`, `feature-create`) failed
  on the full run with 5s test timeouts and then passed cleanly when re-run on their own —
  load flakiness, not breakage. Every web test passes. `bun run typecheck` is 0 errors.
- `TicketsTerminal` *was* under test after all — in `tickets-ledger.test.tsx`, not the file
  its name suggests. Only typecheck caught it; a grep of `src/` did not.
- The house `cx` helper is module-private inside `ui.tsx`, so a conditional class outside that
  file has to be a template string. I matched `SessionPanel`'s existing style.

## Left undone

- The width half of the same review finding is untouched, and it is the bigger one: the
  reviewer measured the terminal at 368px beside the decisions pane and 258px beside the map
  rail because `TicketsBody`'s column (and the grill body's) never claims the row's full width
  — its root has `min-h-0` but no `flex-1`, so it sizes to content inside
  `div.flex.min-h-0.min-w-0.flex-1`. That is a different ticket and a shared-surface change; I
  left it alone.
- The "remembered per feature vs per session" open question in the spec is still open — the
  key remains session-scoped (`runcastle.tickets.term:{sessionId}`), as decided.
- Drive machinery: unchanged and not needed. This ticket adds no service, env var, seed or
  process, so `.runcastle/drive-setup.ts` and `drive-stop.ts` have nothing to learn from it. I
  did not run them (correctly — there is nothing here to run them against).

## 11. The tickets body's vertical stack is 680px wide inside a 1188px workspace, squeezing the ledger it was meant to give full width

# ticket(11) — the tickets stack now fills the workspace

**What was done.** The tickets body's root stack (`apps/web/src/components/bodies/tickets/TicketsBody.tsx`) was a plain flex item — `flex min-h-0 flex-col gap-3 overflow-y-auto` — inside the workspace's two-pane wrapper, which lays its body out in a **row**. With no grow factor it resolved to `flex: 0 1 auto` and was sized to its content (680px of an 1188px parent), so the ledger's titles, dependency chips, model menus and status were read in a little over half the window. The fix is one class change on that stack: `min-w-0 flex-1`, with a comment naming why (decision 6 chose a vertical stack precisely to avoid that squeeze). A tier-2 test in `apps/web/test/tickets-body.test.tsx` now asserts the stack grows; it was written first and observed failing on the old class string. No other file changed — the fix is entirely contained in this flow's own component, so nothing in `Workspace.tsx` or the grill body was touched.

**Re-running the reviewer's repro.** I re-ran it as far as this sandbox allows, and it is worth being precise about what that means: the container has no browser and no running app, so I could not take a live `getBoundingClientRect()` measurement. Two things also make the reviewer's snippet non-runnable verbatim now: it locates the stack by *exact* className equality (`e.className === 'flex min-h-0 flex-col gap-3 overflow-y-auto'`), and that string has changed, so the `find` returns `undefined` and the script throws before measuring. The equivalent selector after this change is `e.className === 'flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto'` (or, more durably, `ws.querySelector('.flex-col.gap-3.overflow-y-auto')`). What I verified instead, offline: the built stylesheet emits `.flex-1{flex:1}` and `.min-w-0{min-width:0}`, and the chain from `section.workspace` down is `column → stretch (1188) → column → stretch (1188) → row`, with the stack as that row's only item — so a `flex: 1 1 0%` item resolves to the full 1188px and `getComputedStyle(col).flex` now reads `1 1 0%` rather than `0 1 auto`. Someone with the app up should confirm the measurement; the derivation is unambiguous but it is a derivation, not a screenshot.

**Surprises.** The stated baseline in the brief is stale — the suite is now 184 files / 2863 tests, not 118 / 1768. Eight tests fail on this branch and none are mine: `packages/server/test/burn-slot-workspace.test.ts` (7, all `fatal: repository '/home/agent/cache/tmp/rc-slot-…' does not exist` — the temp source repo the test drives never materialises in this container) and `packages/server/test/dev-pane.test.ts` (1, a process group that is not reaped). Both are server-side and environment-shaped; my diff is two `apps/web` files that no server test imports. `bun run typecheck` is clean and the web build succeeds.

**Left undone.** `PinnedTickets` in `apps/web/src/components/bodies/PinnedBody.tsx:93` has the identical fault — `flex min-h-0 flex-col overflow-y-auto` in the same row wrapper — so a *pinned* ticket ledger is still laid out at content width. It is another surface (decision 10's frozen record) and outside this ticket's repro, so I left it; it is a one-class fix if someone wants it. The grill body's two-pane split (`GrillBody.tsx:19`, and the pinned ideation/spec bodies at `PinnedBody.tsx:34,40`) share the same non-stretching-root cause and were reported separately — a root-cause fix in the `Workspace.tsx` wrapper would subsume all of them, and would remain compatible with what I did here. Also unaddressed, from the same review paragraph: at tickets, "Show terminal" opens the terminal to about half the body height rather than full height. No drive machinery changed (no new service, env var, seed or process), so `.runcastle/` needed no edit.

## 12. The ended session strip's "ended N ago" is derived from when the session started, not when it ended — a session ended seconds ago reads "ended 17m ago"

# ticket(12) — the ended session strip's "ended N ago"

## What was done

The strip's "ended N ago" was the session row's *insert* time wearing an end-time label, because the `sessions` table recorded no ending at all. So the fix is in three parts.

Server: `sessions` gains a nullable `ended_at` column (migration `0034_hard_killraven.sql`, generated with `bun run db:generate`), carried on the wire as `SessionRow.endedAt`. It is stamped in exactly one place — `markSessionEnded`, the funnel every end path (PTY exit, the Stop hook, boot reconciliation, the End session button) already goes through — and only when the row does not already have one, so a second end path firing on the same row cannot walk the timestamp forward. Rows that ended before the column existed stay null rather than being backfilled from `created_at`: that substitution is the bug.

Web: the strip reads its age from `endedAt` alone and says a bare `ended` when there is none, so an unrecorded ending never gets a fabricated age. A new `relAgo` beside `relTime` in `lib/format.ts` supplies the phrase, including `just now` — the old code would have rendered the ungrammatical "ended now ago" for a session closed seconds earlier, so the criterion's expected string was unreachable even with a correct timestamp.

The second half of the ticket — the strip showing an *older* session than the one just ended — was `pickPanelSession` preferring the newest **resumable** ended session (one with a `ccSessionId`) over the newest one. End a terminal that never got past its trust prompt, as the reviewer did, and it has no `ccSessionId`, so the strip silently spoke for the conversation before it. That preference existed only because the card used to carry its own Resume button; decision 3 moved every resume into the next-step bar, so the panel now simply takes the most recent session.

Tests: three in `session-lifecycle.test.ts` (the ending is stamped at the ending, a running session has none, a second end keeps the first), one migration test in the shape of `ticket-model-migration.test.ts` (the column lands on a populated `sessions` table and leaves old rows null), two new strip cases and one new `session-panel.test.ts` case, plus `relAgo` in `format.test.ts`.

## Re-running the repro

I could not drive the real app — this sandbox has no services, no project checkout for runcastle to open and no agent runtime, so steps 2–3 of the repro (launch a Claude Code terminal, click End session) are not performable here. What I did run:

- The ticket's stated confirmation query, against a database built through the real boot migration path (`runMigrations`): `select sql from sqlite_master where name='sessions'` now ends `..., 'runtime' text, 'ended_at' integer)`. The named underlying cause is closed.
- The repro's behaviour at the two seams it crosses, as tests. Server side: a session created at 10:00 and ended at 12:00 reports `endedAt` = 12:00 while `createdAt` stays 10:00. Web side: a panel handed the reviewer's exact situation — an older ended session with a `ccSessionId` (17 minutes old) plus the one just ended without one — renders `Ideation session · ended just now`, and contains neither `Converge session` nor `17m`.

Taken together those are the repro's two failure modes, both now failing to reproduce. I have not seen it in the running app.

## Surprises

- `relTime` returns the bare word `now` under five seconds, so the expected copy "ended just now" was not reachable by fixing the timestamp alone — the call site was building `${relTime(...)} ago`. There was already a one-off `text === 'now' ? 'just now' : ...` in `lib/feature-ui/sidebar.ts`; I left it alone (the sidebar belongs to the shell flow) rather than widen the diff, so `relAgo` currently has one caller and one near-duplicate.
- `lib/feature-ui/phase-summary.ts` already derives a session's end independently, by scanning the events feed for `session.ended` / `session.auto_ended` (`sessionEnd()`). Now that the row carries the fact, those two derivations could converge — but the events scan still covers every historical row, which `ended_at` never will, so it is not a straight swap.
- The full suite is no longer the 118 files / 1768 tests the prompt's baseline claims; it is 187 files / 2872 tests, and eight of them fail for environment reasons unrelated to this diff. Seven are `burn-slot-workspace.test.ts`, which fails only because this container's `TMPDIR` (`/home/agent/cache/tmp`) sits inside the burn cache mount the test builds paths against — re-running that file with `TMPDIR=/tmp` passes all of it. The eighth is `dev-pane.test.ts` > "kills the child process tree so the port-holder is not orphaned", a process-group kill this container does not reap; it fails with `TMPDIR=/tmp` too. Neither file imports anything this ticket touched.

## Left undone

- `SessionPanel.tsx` carries two orphaned doc comments left by an earlier extraction: one describing "the strip's done label" that now sits directly above `pickPanelSession`'s own comment, and one at the very end of the file describing a `resumable`-style helper that no longer exists. Both are pre-existing and unrelated to the defect, so I left them; they are two deletions for whoever next opens the file.
- Nothing in the drive machinery needed changing. The change adds a migration and no service, env var, seed or extra process, which `.runcastle/`'s idempotent steps already cover. I checked that `.runcastle/drive-setup.ts` and `drive-stop.ts` are both present and that the former parses; I did not run either, per the standing instruction.

## 13. Pinned ideation reports "0 sessions" and renders no sessions list, on a feature with four ended sessions

# ticket(13) — pinned ideation reported "0 sessions" and rendered no sessions list

## What was done

The pinned ideation record selected its sessions through the *derived phase
window* — `[feature.started ?? feature.createdAt, first transition to spec]` —
and required each session's `createdAt` to fall inside it. `sessions.created_at`
is nullable (no default, deliberately never backfilled), and an undated row
fails that test outright, so every such session vanished from both the banner
count and the body list. That is the single root cause the reviewer suspected:
the pinned view really was reading no sessions at all.

`ideationSessions` now selects on kind alone — `ideation`, `waypoint`,
`converge` — which is the session's own statement of what it was opened to do
and holds on every lap. The phase window still dates the phase's span, which is
the one thing it can honestly say. An undated session is now listed without a
start time rather than hidden; `PhaseSessionRow` already made `startedAt`
optional and `SessionList` already rendered it conditionally, so the body list
appears as soon as the derivation stops returning `[]`. Nothing else changed:
the same fix covers the banner, the body list and the stepper's done-step
tooltip, because all three read `phase-summary.ts`.

Deviation from the ticket's framing: it treated the missing count and the
missing list as possibly two problems. They were one, so this is a four-line
behaviour change plus tests, not a new component.

## The repro, re-run

I re-ran it as far as this sandbox allows, and it does not reproduce — but I
could not boot the app: there is no drive, no seeded database and no
"Foxtrot shipped lap2", and the drive commands are Windows-shaped. So I closed
the chain in two halves instead, and say plainly that no browser was involved.

- **Data half, read not run:** `rowToSession` maps `created_at` NULL to
  `createdAt: undefined` (`packages/server/src/services/repo.ts:96`), and
  `listSessionsByFeature` returns every session row for the feature unfiltered.
  So the wire shape a directly-seeded feature produces is exactly undated rows.
- **UI half, run:** a new DOM test feeds `PinnedBody` that exact shape — a
  shipped lap-2 feature with three undated ended sessions (ideation, waypoint,
  converge) and an events feed with no phase transitions, which is why the
  reviewer's banner showed no duration either. Before the change the body had no
  list; now it renders `Sessions · 3` with all three named, and the frozen-record
  prohibition still holds (no terminal, no End/Work/Edit/Cancel). A tier-1 test
  asserts the banner facts go from `0 sessions` to a real count.

Drive machinery: unchanged and correctly so — this adds no service, env var,
seed or process. `.runcastle/drive-setup.ts` and `drive-stop.ts` are both
present and untouched.

## Surprises

- The old behaviour was not an oversight; it was documented intent ("cannot be
  placed in the window and is left out rather than dated wrongly") with a test
  pinning it. I inverted both. Being undated is not a reason to deny a session
  happened — it is a reason to show it without a date.
- The reviewer's own clue was in the banner they quoted: it carried no duration,
  which means the feed had no `→ spec` transition, which means the window's `to`
  was open. That narrowed the cause to the `from`/undated side before I read any
  seed.
- Two server test files fail in this sandbox and are not in the stated baseline:
  `packages/server/test/burn-slot-workspace.test.ts` (7 tests, all
  `fatal: repository '/home/agent/cache/tmp/rc-slot-ws-…' does not exist`) and
  `packages/server/test/dev-pane.test.ts` (1 test, a process-group kill that
  leaves the group alive). Both are environment faults — they drive real git
  clones and real process trees — and my diff is entirely inside `apps/web`, so
  it cannot reach them. Confirmed consistent on one targeted re-run. Every one
  of the 185 files' remaining tests passes, `apps/web` included, and typecheck
  is clean.

## Left undone

- **`revisit` is still not counted as an ideation session.** The reviewer's
  feature has four sessions and this fix lists three: the lap-2 session is a
  `revisit`, and `revisit` is also the tickets phase's "Ask for changes" and
  implementation's "Revisit", so its phase cannot be read off its kind. Counting
  all of them would file an implementation-phase revisit under ideation — a new
  wrong attribution in exchange for a right one. Placing it properly needs a
  per-lap phase window, which the feed can only give for lap 1 today
  (`firstTransitionTo` finds the first transition, not each lap's). Worth a
  ticket if the human wants the record complete on later laps.
- **No session ever gets a duration.** The reviewer's separate finding stands:
  `sessions` has no `ended_at` column, so `phaseSessions` can only compute one
  when a `session.ended` event happens to still be in the feed. On an old or
  seeded feature every row is dateless *and* durationless. Adding the column is
  the real fix and is outside this ticket.
- Undated sessions sort to the front (`createdAt ?? 0`), which is right for rows
  that predate the column and arbitrary for seeded ones. Left alone.

## 14. The pinned spec view's read-only banner carries no summary, while pinned ideation and pinned tickets both do

# ticket(14) — the pinned spec banner's missing summary

## What was done

The pinned spec view's read-only banner now carries a summary, like pinned ideation and
pinned tickets do. The cause was that the spec's one fact — when it was written — was
derived *only* from a `docs.changed` event in the feature's feed, and a feature whose docs
were written before the docs watcher ran (or whose feed has since been trimmed, which is
what the reviewer's seeded "Foxtrot shipped lap2" looked like) has no such event, so
`specFacts` returned nothing and the banner rendered `READ-ONLY · Spec · Back to shipped →`.

The data really is on disk, so the docs listing now carries it: `listDocs` adds an optional
`updatedAt` (the file's mtime, omitted if it cannot be stat'd) to each `DocSummary`, and it
rides along on `feature.get`, which the workspace already loads — no extra fetch. The web's
`specFacts` prefers the `docs.changed` event and falls back to the spec doc's own timestamp.
The feed deliberately wins where both exist: a git checkout restamps every mtime, where the
watcher's event is real history.

This is a server-side change, which the spec otherwise confines to decisions 7 and 9. I took
it because the acceptance criterion cannot be met from the client alone on the data the
reviewer walked — nothing on the wire dated a doc — and because the ticket's own detail
("the data to build it exists — `spec.md` is on disk") points at the file. It is additive and
optional, so no existing reader changes.

Tests: a tier-1 case in `apps/web/test/phase-summary.test.ts` (file-dated spec, feed
outranking the file, and a docs list with a brief but no spec still saying nothing), and a new
`packages/server/test/knowledge-docs.test.ts` for the listing's timestamp. One strict
`toEqual` on a `DocSummary` in `encoding.test.ts` became `toMatchObject` — that test is about
byte-exact UTF-8 titles, and it still asserts both fields and the array length.

**I re-ran the reviewer's repro step.** I could not drive the real app (no services in this
sandbox, and the reviewer's seeded project lives outside the checkout), so I reproduced it one
level down with a scratch script, deleted afterwards and never committed: seed a shipped lap-2
feature, write a real `spec.md` two days old into its docs dir, put **no** events in the feed,
call the real `getFeatureFull`, and render `ReadonlyBanner` with exactly the
`phaseFacts({ phase, full, events })` expression `Workspace.tsx:582` uses. Before the change it
printed `READ-ONLY spec Back to shipped →`; after it prints `READ-ONLY spec · written 2d ago
Back to shipped →`. Re-run against the final commit, same result.

## Surprises

- The verify baseline in the burn prompt is stale: it expects 118 files / 1768 tests fully
  green, but this branch now runs 186 files / 2867 tests (thirteen tickets have landed since).
  **8 tests fail, and none of them are mine**: the 7 `buildSlotSetupCommand` cases in
  `packages/server/test/burn-slot-workspace.test.ts` (they shell out to `git clone` against a
  temp repo the sandbox does not give them — `fatal: repository ... does not exist`) and
  `dev-pane.test.ts > kills the child process tree` (a process-group kill that does not take in
  this container). I confirmed they pre-date my work by checking out the HEAD~1 copies of my two
  source files and re-running those two files: the same 8 failed. Typecheck is 0 errors.
- Two positional args now, but `specFacts` is the only fact helper that needs both the docs and
  the feed; the others take one or the other.

## Left undone

- **Pinned tickets on a lap-2 feature with no lap-2 tickets shows no summary at all.**
  `ticketFacts` groups by lap from lap 2 and returns an empty list when a lap has no rows, so
  the banner falls back to a bare `Tickets`. I hit this while building the repro fixture. It is
  the same class of bug as the one I fixed but in a different function, and the ticket named the
  spec banner only, so I left it.
- The reviewer's other two honesty findings on this screen are still open and are not mine:
  pinned ideation reports "0 sessions" on a feature that had four (the window filter drops
  sessions the feed cannot place), and the ended-session strip's "ended Nm ago" is really the
  session's *start* time — there is no end timestamp recorded anywhere.
- `readDoc` still returns content with no timestamp. If a later surface wants "this doc was
  written at", the same `writtenAt` helper is one line away from being reused there.
- Drive machinery: no change needed and none made. This ticket adds no service, no required env
  var, no seed and no process — only a field on an existing response — so the `.runcastle/`
  scripts are untouched. I did not run them (this sandbox has no app), and I did not need to
  read them either, since none of the four triggers fired.
