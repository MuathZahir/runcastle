# Outcome — Review arrival is legible

One design pass over the review page's arrival: predictable primary-action logic, observations demoted or dropped, the stale live session auto-ended at Iterate, no walkthrough placeholder, and far less text — so landing on review reads in one glance.

- Shipped: 2026-09-08
- Laps run: 1

## What shipped

19 commits · 50 files

### Lap 1
- 4 tickets landed: #1 Review agent prompt: outcome-anchored defect boundary and the one-liner lap account; #2 The bar states its reason; one-terminal refusals become end-and-proceed compounds; #3 The carry channel states the work to the next lap's session; #4 Review arrival layout: six bands, one disclosure, no terminal, no placeholder
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: d00a471d93922d186ac9c29f5d7e930e43da72b1
- Landed since: 0
- Outcome: done

- **The review-state matrix could not be staged in the isolated drive data** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 2. The bar states its reason; one-terminal refusals become end-and-proceed compounds

# Ticket 2 — the bar states its reason; one-terminal refusals become compounds

## What was done

The review next-step now emits a `counts` line (`CountLine`/`CountPill` on `NextStep`):
danger pills for defects, neutral for notes, a trailing "open", or one green
"Nothing open" pill when clear. It is set on *every* review branch (conflict,
drive-owns-bar, open work, pending burn, later laps, default), and `NextStepBar`
renders it outside the guidance gate — the whole point being that the primary
follows the count, so the count cannot be hideable. The open-work branch now
carries no `title` and no `desc` at all ("Answer what is still open" and its
paragraph are deleted), which meant making both fields optional on `NextStep`;
the bar renders each only when present. The unproven-drive caveat no longer
reaches the review bar (its `unverifiedWarning` helper is left intact in
`internal.ts` for ticket 4's state-line chip, currently with no caller).

One-terminal refusals became end-and-proceed compounds. In the derivation: with
a live session, Iterate is labelled "End session & iterate" and carries a new
`endSessionAndIterate` action kind — one kind for both roads, since the door it
opens is still picked from the counts after the end lands. The later-laps branch
no longer suppresses itself while a session is live; it flips as usual with
"End session & start lap N+1". In `Workspace`, one `endLiveSession()` helper
awaits `feature.endSession` (aborting on failure, exactly as
`use-resolve-conflict` documents) and is used by both the bar's compound and the
triage carry road. `triageExits` grew a `live` flag so the carry exit relabels in
all three of its shapes, and `TriageStep` swapped `iterateBlocked` for
`sessionLive`: its exits are never disabled and the warn line under the footer is
gone. `ONE_TERMINAL_ITERATE` had no caller left and was deleted.

Tests: count line, the primary flip, singular/plural pills, the count on every
bar, and every compound label at the pure derivation (`feature-ui.test.ts`); the
compound exits at `triageExits` and the never-disabled carry exit in
`triage-step.test.ts`; a new tier-1 `next-step-bar-counts.test.ts` pinning that
the count renders with guidance off while `desc` still does not.

## Surprises

- The prototype's "stale session" state shows the compound label with open work
  present, even though with open work the click only opens the triage dialog and
  needs no terminal. I followed the prototype: any live session compounds the
  bar's Iterate. The triage carry exit compounds independently, so the sequence
  is still correct if a session appears while the step is open.
- Sweeping "every ONE_TERMINAL refusal" turned up nothing beyond the two known
  sites: `ConflictCard` already ships the compound, and `ONE_TERMINAL_WARNING`
  (kept) explains a compound rather than gating one.
- Baseline check: `packages/server/test/dev-pane.test.ts` ("kills the child
  process tree") fails in this sandbox both before and after my change —
  confirmed on a targeted run. It is a process-group reaping fault of the
  container, not listed in the prompt's baseline, and my diff is web-only. The
  rest is green: typecheck 0 errors, 3334 tests passing.

## Left undone

- `driveFailure`'s `canFix` (`lib/feature-ui/drive.ts`) still *hides* the "Fix
  drive" button while a session is live. It hides rather than disables, and it is
  outside the ticket's stated sweep (it matches neither `ONE_TERMINAL` nor
  `iterateBlocked`), so I left it — but under decision 4's blanket rule it wants
  the same "End session & fix drive" treatment, in both the panel and the bar's
  drive-owns-bar primary.
- `WaypointCard` (grill) already does end-and-proceed but behind an inline
  confirm, which decision 4 says the label should replace. Another phase's page,
  so out of scope here.
- With a test drive running *and* a session live, Iterate is still disabled for
  the drive reason and its "Stop drive and iterate" escape does not end the
  session — decision 20's territory, and relabelling that escape would need new
  copy.
- Drive machinery: this ticket adds no service, env var, seed or process, so
  `.runcastle/` needed no edit; I checked nothing there was implicated rather
  than running the hooks (no services in this sandbox).

#### 3. The carry channel states the work to the next lap's session

# Ticket 3 — the carry channel states the work to the next lap's session

## What was done

A new read-only service, `packages/server/src/services/carried-work.ts`, answers one
question — what did the last lap hand this one — as a count of carried notes plus the
open defects' structured rows (title, location, detail, repro step, the same four
`buildFixTicket` serialises; the citation is left out, it points at the criterion the
review argued from rather than at the problem). Everything downstream reads it.

`lapKickoff(lap, carried?)` and the injected lap prompt (`renderRevisitPrompt`, threaded
through `renderSystemPrompt` and a new `WriteArtifactsInput.carried`) now lead with
"2 notes carried and 1 defect open from earlier laps — address them" and drop the
may-not-exist hedging for the notes file when carried work exists; with nothing carried
the hedge is honest and stays, byte-for-byte where it can be. `launchSession` computes
the carry once and feeds both `planKickoff` and the artifacts, so the re-entry door (a
lap whose terminal died) gets the same briefing as the Iterate click; the tRPC `rethink`
route passes it into its explicit line too.

Pointers are status-keyed everywhere: `renderTestNotes` now writes a leading
`## Carried, still open` section listing every note with status `carried` regardless of
lap, and both briefings point at that section rather than `## Lap N-1`. `get_feature_context`
stops marking `test-notes.md` withheld while any note is carried — the decision is a new
pure `withheldFeatureDocs(state)` in `@runcastle/core` so core stays IO-free, with the
server looking the state up — and gained an `openDefects` field, which is the single
channel the briefings point at for defects (no defect section was added to the doc).

## Deviations and surprises

- **The summary names no lap.** decisions.md #7 quotes "3 notes carried and 1 defect open
  from lap 1's review". That attribution is false in the exact case the ticket cares most
  about: a note carried into lap 2 and skipped there keeps `carriedLap: 2` while the
  feature moves to lap 3, so its source lap is not `lap - 1`. The copy is "…from earlier
  laps" instead; the counts and the instruction, which is what the decision locks, are
  intact.
- **`carried` is its own terminal status**, so "carried and not done" is one predicate:
  `toggleNote` refuses a carried note outright, and only `reopenNote` moves it back. No
  join with `done` was needed.
- **The router's explicit kickoff line is redundant** — after `rethink`, `lapInFlight` is
  always true, so `planKickoff` would derive the same line. Left as it was, fed the carry,
  rather than deleted.
- Two existing assertions pinned the old lap-numbered pointer (`rethink.test.ts`,
  `launch-artifacts.test.ts`); both were flipped to assert the status-keyed one and that
  the lap-numbered one is gone. Nothing else in the suite depended on the wording.
- **A pre-existing environmental failure**: `packages/server/test/dev-pane.test.ts >
  "kills the child process tree so the port-holder is not orphaned"` fails in this sandbox,
  in the full run and in isolation, on `pidAlive(-pgid)` — process-group reaping the
  container does not do. It is unrelated to this diff (no process/pty code touched) and is
  not in the prompt's stated baseline, which is itself stale (it lists 118 files / 1768
  tests; the suite is 230 files / 3342 tests). Everything else is green: `bun run typecheck`
  0 errors, `env -u GIT_ASKPASS bun run test` 3337 passed / 1 failed (that one) / 4 skipped.
- Drive machinery: this ticket adds no service, env var, seed or process, so `.runcastle/`
  needed no edit. Both scripts it names (`drive-setup.ts`, `drive-stop.ts`) are present; I
  did not run them, per the standing instruction.

## Left undone

- **`packages/skills/packs/runcastle/skills/revisit/SKILL.md` still points a lap session at
  "the previous lap's section of `test-notes.md`" and says "both may be absent".** That is
  now the one surviving lap-numbered pointer, and it contradicts the kickoff and system
  prompt this ticket rewrote. It is a skills-pack file the ticket did not name and did not
  scope, so I left it; whoever owns the skills pack should key it on
  `## Carried, still open` and mention `openDefects`.
- The burner's docs digest (`workflows/ticket-burner.ts` ~2907) still uses the flat
  `WITHHELD_FEATURE_DOCS` — a burner agent is told `test-notes.md` is already triaged even
  when notes were carried. Same untrue reason, different consumer; the ticket scoped the
  fix to the MCP payload seam, and `withheldFeatureDocs` is ready if that should follow.
- Nothing renders open defects into a doc. If a future lap wants them readable off disk
  rather than through MCP, `renderTestNotes` is where that section would go.

#### 4. Review arrival layout: six bands, one disclosure, no terminal, no placeholder

# Ticket 4 — review arrival: six bands, one disclosure, no terminal, no placeholder

## What was done

`ReviewBody` now composes the prototype's bands in the prototype's order: alerts
(conflict, lap abort, and a new one-line live-session alert), the evidence stage
only when there is a recording or a drive of this feature, the state line, the
lap account at one line, the attention list with the composer under it, and one
collapsed *Full account* disclosure. `SessionPanel` is gone from the page (its
dead `.review-session` rule went from `styles.css`, ratchet lowered to 632), and
`liveSessionLine` in `feature-ui/session.ts` derives the alert's text and the
phase its Open navigates to — null for a Q&A or drive-fix session, which no
other phase's view holds, so those lines offer End alone.

The stage lost its own drive entry point: `Open app ▶`, the dev-command hint,
the lead sentence and the explainer disclosure are deleted, and `testDriveLead`
/ `testDriveExplainer` deleted with them, so `EvidenceStage` no longer takes
`caps`, `starting` or `onStartDrive`. The entry point is a compact `Test drive`
control at the end of `StatusStrip`, which also folds in the unverified-drive
caveat as an amber chip (`statusChips` grew `unverifiedKeys` and a `detail` the
chip opens on, finally giving ticket 2's orphaned `unverifiedWarning` a caller).

The lap account is `lapAccountLine` — the digest's first line, alone, falling
back to `findingCountsLine`, which stopped naming observations. Observations
render only inside the disclosure, with no count on arrival. The rows split
once, in `partitionWork`, and render through one new `WorkList` component:
`OpenWork` is the attention half plus the composer, the disclosure holds the
settled half. Tests: a new `review-bands.test.ts` renders `ReviewBody` itself
across the prototype's four states, plus derivation tests for the first-line
split, the live-session line and the unverified chip.

## Surprises

- Gating the Test drive control on "the stage is mounted" quietly removed it
  from every feature that HAD a walkthrough — my own first cut. The prototype
  shows the same state line in all four states; it is the drive being up, not
  the stage being there, that retires the control. Fixed in its own commit.
- Decision 8 asks the disclosure to hold the carried/handled rows, which live
  entangled with `OpenWork`'s mutations. Rather than duplicate them I split the
  partition (pure) from the row rendering (`WorkList`), which is why `OpenWork`
  now takes `rows` instead of raw findings/notes and its tests changed shape.
- `packages/server/test/dev-pane.test.ts` ("kills the child process tree") fails
  in this sandbox — the same container process-group fault ticket 2 confirmed
  before and after its own change. My diff is `apps/web` only. Everything else
  is green: typecheck 0 errors, 3351 tests passing.
- Drive machinery: this ticket adds no service, env var, seed or process, so
  `.runcastle/` needed no edit. I checked the two scripts it names still exist;
  I did not run them (no services in this sandbox).

## Left undone

- `SessionPanel.pickPanelSession` still prefers the most recent session even
  when it has *ended*, so the other bodies (grill, tickets) can show a strip for
  a conversation that is over. Review no longer mounts the panel at all, so the
  bug is out of this ticket's reach — but it is still there for whoever owns
  those pages.
- The alert line's dot says `live` for a `launching` session too. That matches
  what `activeSession` means everywhere in the app, but a launching terminal is
  amber in `SessionStatusDot`'s own vocabulary.
- The stage's "Starting the test drive" copy covers the one beat between the
  click and the server's first non-idle poll. If that window ever stops
  existing, the branch is unreachable and can go.
