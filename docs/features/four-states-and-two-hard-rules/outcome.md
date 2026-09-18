# Outcome — Four states and two hard rules

Collapse the six-phase pipeline to Planning, Building, Review, Shipped; keep only git safety and one-burn-at-a-time as hard refusals; Merge reachable from any state; a lap is a burn-plus-review cycle stamped automatically at Burn.

- Shipped: 2026-09-18
- Laps run: 2

## What shipped

43 commits · 145 files

### Lap 1
- 8 tickets landed: #1 Collapse the state model: four states, two movers, one-way migration; #2 Burn warnings service and wire-compatible complete_phase; #3 Web surface: four next-step resolvers, Burn dialog with warnings, Merge everywhere; #8 Merge now hard-refuses from Review whenever the feature is being test-driven — the auto-stop was deleted; #9 The lap is stamped after the work it names, so iterate-lap tickets carry the previous lap and a crash-restart invents a lap; #10 Decision 5's earlier-lap-defects burn warning can never fire in production; only a hand-faked lap makes its test pass; #11 Live session prompts still route the operator to Rethink and to gates this lap deleted — packages/skills was never touched; #12 complete_phase returns no warnings to the one session that could still act on them — the iterate session at Review
- 3 waived: #5 Merge now refuses while test-driving the feature — the review bar's own primary button is dead during a drive; #6 Burn stamps the lap after the tickets are stamped, so every lap-2+ batch carries the previous lap's number; #7 Decision 5's earlier-lap-defects warning can never fire — its lap predicate is false at every moment the warning is read
- 0 failed

### Lap 2
- 1 tickets landed: #15 Delete the web gate-vocabulary museum: GateCard, GateState, GATE_EXPLAINER
- 1 waived: #14 Delete the web gate-vocabulary museum: GateCard, GateState, GATE_EXPLAINER
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 4a60a094bf475c060f4534905843719ce27eb5d4
- Landed since: 6
- Outcome: done

### Lap 1 · verification

- Reviewed commit: cbcefa848ed82645d07eaa69112fa612f6b7f85d
- Landed since: 1
- Outcome: done

### Lap 2 · review

- Reviewed commit: 36329ba462d2ee23b8400c9ab03fb15fadc546b1
- Landed since: 0
- Outcome: done

- **Fresh apps/web typecheck and test results were unavailable in this review configuration** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 2. Burn warnings service and wire-compatible complete_phase

# Ticket 2 — burn warnings service and wire-compatible `complete_phase`

## What was done

Three ex-refusals are now one server-computed list. `services/burn-warnings.ts`
exports `burnWarnings(ctx, featureId): string[]` — no `kind: "review"` ticket
among the *pending* tickets, earlier-lap open defects still un-dispositioned
(reusing `undispositionedDefects`), and no `spec.md` on disk, in that order.
It is reached two ways: `feature.burnWarnings` (a tRPC query in the `mergeDelta`
shape, for the Burn dialog ticket 3 will build) and `complete_phase("tickets")`,
which returns it as `warnings` instead of the old G3 refusal.

`complete_phase` keeps its name and its `ideation | spec | tickets` argument and
transitions nothing: it stamps the timeline, then answers `{ ok: true,
nextPhase }` (the state the feature is *still* in) plus `nextStep` — the first
planning artifact still missing, derived through core's `nextPlanningStep` over
a new `services/planning.ts` (`planningFacts`, `hasPlanningDoc`,
`planningStepReported`). It can no longer return `ok: false`.

Two deviations from the ticket's letter, both small:

- The "next hint" is a typed `nextStep?: PlanningStep` field rather than a
  reworked `nextPhase`. `nextPhase` had to stay truthful *and* wire-compatible,
  so the hint got its own name.
- I added `isPendingTicket` / `pendingTickets` to `services/tickets.ts` and
  pointed `features.burn` at the former, because the burn, the planning-progress
  model and the warnings were about to hold three copies of the same predicate.

## Surprises

The "already-done step" note could not be derived from artifacts, which is what
the ticket's phrasing suggests. A step's artifact is on disk *by definition* when
the session reports it, so artifact presence reads every first call as a repeat.
The honest record of a report is the timeline stamp, so repeats are read off the
event log — which needed a new `listByTypeThisLap` in `services/events.ts`,
because `EventRow` does not carry the `lap` column and `listAfter` therefore
cannot answer "on this lap". Lateness (the human burned while the session was
closing out) is separate and comes from `isPastPhase(feature, 'planning')`.

`planningFacts.hasTickets` counts tickets a burn would still *run*, not any row
ever stored: on lap 2 the previous lap's tickets are all terminal, so "any
ticket" would report the step done for a lap that has emitted nothing.

## Verification

`bun run typecheck` — 0 errors. `env -u GIT_ASKPASS bun run test` — 3527 passed,
63 skipped, **1 failed**: `dev-pane.test.ts > kills the child process tree`,
which asserts a process group is reaped after `stopDevPane`. It fails the same
way in isolation, it is not listed in the prompt's baseline, and my diff touches
no pty or dev-pane code — this sandbox does not reap the group. Treat it as
environmental, not as this ticket's.

No drive-machinery change was needed: this ticket adds no service, no required
env var, no seed and no process, so `.runcastle/drive-setup.ts` and friends are
untouched (checked by reading, not run — the sandbox has no app).

## Left undone

- The skill packs still tell agents "if the gate returns `ok: false`, fix what
  it names and retry" (`skills/spec`, `tickets`, `ideate`, `revisit`). That path
  is now unreachable. Decision 2 says the skills need zero rework, so the advice
  is merely dead rather than wrong, and `packages/skills` is not this ticket's.
- `launcher/artifacts.ts` and `launcher/sessions.ts` still carry six-phase prose
  from before ticket 1 — "the feature sits at ideation", "crosses the remaining
  gates". I corrected only the one sentence my own change falsified (the revisit
  lap briefing promising that un-dispositioned defects would stop
  `complete_phase("tickets")` from passing). The rest is ticket 1's vocabulary.
- `docs/SPEC.md` §4/§6 still describe `feature.advance`, G3 and the old
  `complete_phase` contract. It is a declared build-era document; nobody has
  amended it for the collapse.
- Nothing invalidates `feature.burnWarnings` on the live stream yet
  (`apps/web/src/lib/live.ts`); the Burn dialog that consumes it is ticket 3's.

#### 3. Web surface: four next-step resolvers, Burn dialog with warnings, Merge everywhere

# Ticket 3 — the web surface of four states

## What was done

`next-step/` is four resolvers plus draft. `planning.ts` replaces ideation.ts and
tickets.ts (spec.ts was already gone) and derives its hint through core's
`nextPlanningStep` over the artifacts the server exposes on `FeatureFull`:
decisions.md → ideation done, spec.md → spec done, a *pending* ticket → tickets
emitted. Burn is offered only when something pending exists.
`implementation.ts` → `building.ts`. Both new resolvers carry `Merge & ship` as a
secondary in every branch, never as the primary (review-arrival decision 3);
`review.ts` already offered it everywhere and is untouched.

`BurnFeatureDialog.tsx` mirrors `MergeFeatureDialog` line for line: figures
(what burns, the lap the click stamps, the models), the `border-warn/40 bg-warn/7`
bullet box fed verbatim by ticket 2's `feature.burnWarnings`, an enabled primary.
`burnSummary`/`burnLap` live beside `mergeSummary` in `feature-ui/summary.ts`;
`mergeSummary` gained decision 7's live-burn warning. Every `burn` click in the
workspace now goes through the dialog. `live.ts` invalidates `burnWarnings` on
the SSE feed.

Deviations worth naming, all small:

- **`advance` is gone from the UI too.** Ticket 1 deleted the mutation and left
  the dispatcher case decayed to `invalidate()`, so "Continue to review" was a
  button that refreshed the page. The action kind, the affordance and the case
  went; the runner's auto-advance is the only road building → review.
- **"Finish converging" is derived rather than dropped.** The old `spec` phase
  owned it; a mapped feature with decisions.md and no spec.md IS a converge
  session that stopped short, so the ladder answers it. Without this
  `resumeConverge` was an action kind nothing emitted, and a stranded converge's
  only road was a fresh grill that would not have resumed it.
- **A refused burn keeps its dialog open** (toast only), where a refused merge
  closes on the rejection. A burn refusal is the one hard rule left at that door
  and there is nothing else on screen to act on.

## Surprises

The derived ladder is *not* simply core's `nextPlanningStep`. A quick change
(`features.ts`) is born at planning with its tickets and no decisions.md it will
ever have, so a strict first-missing-artifact ladder sends that human back to a
conversation about an idea already broken down. Pending tickets therefore outrank
the ladder in the UI — `facts.hasTickets ? null : nextPlanningStep(facts)` — where
on the server the same facts are only a hint for `complete_phase`.

Merging two resolvers merged two orderings. `ideation.ts` opened with "lap > 1 and
a session is live → LAP LIVE", and the old dispatcher skipped that whole file
whenever any ticket row existed, so the lap-live branch was unreachable for a lap
whose tickets had landed. The order that survives is spelled out in the file:
tickets still settling → tickets ready to burn → the lap road → the map → a live
session's status line → the artifact ladder.

Six tests failed on one full-suite run and one on the next; each passes in
isolation. They are git- and process-heavy server suites plus one DOM test,
failing under full concurrency. The one stable failure is
`dev-pane.test.ts > kills the child process tree`, which ticket 2 already
identified as this sandbox not reaping process groups; nothing in this diff is
near it. `bun run typecheck`, `apps/web` tests (1465 passed) and
`bun run --filter '@runcastle/web' build` are all green.

No drive-machinery change was needed — this ticket adds no service, env var, seed
or process, only web code over tRPC procedures that already existed. I read
`.runcastle/drive-setup.ts` and `drive-stop.ts` rather than running them (the
sandbox has no app); they are TypeScript, so there was no `bash -n` to run.

## Left undone

- Four `describe.skip` blocks ticket 1 parked remain skipped: `draft derivations`,
  `rowChip`, `turn-aware feature states`, `landingFeature`. All four are *sidebar*
  derivations (`needsMe`, `sortForSidebar`, `rowChip`) rather than next-step
  resolvers, so they belong to the files ticket 1 owned. I restored the four that
  were about resolvers.
- `resolveShipped` and `resolveDraft` were left exactly as they were; neither
  offers Merge, which is right for shipped and out of scope for draft (a draft has
  no branch to merge).
- The Burn dialog says "Still checking for warnings…" while the query is in
  flight. The query is enabled in every non-shipped state, so in practice the box
  is populated before the dialog opens; the line exists for a cold load.
- Nothing invalidates `settings.get` faster than the existing SSE sweep already
  does, so a model changed in another tab reaches the dialog on the same push as
  everything else.

#### 8. Merge now hard-refuses from Review whenever the feature is being test-driven — the auto-stop was deleted

# ticket(8) — Merge no longer dead-ends on a drive of the feature it is shipping

## What was done

Restored the four lines the lap deleted from the `merge` mutation in
`packages/server/src/trpc/routers/feature.ts`: when `git.activeTestDriveFeatureId()`
matches the feature being merged, the handler stops that drive (which restores the
main checkout) before computing the delta and merging. The comment came back with
them, verbatim from the pre-lap file, because `packages/server/src/services/git.ts`
still tells the next reader that the handler does exactly this.

Pinned it at the tRPC seam in `packages/server/test/merge-conflict.test.ts`, beside
the existing "another feature is being test-driven" guard test: a feature at Review
with a live drive of itself merges to `shipped`, and `activeTestDriveFeatureId()` is
undefined afterwards. The two tests now read as a pair — a drive of *this* feature is
cleared for you, a drive of *another* feature still refuses.

No other file was touched; the git service's absolute `testDriveState` refusal is
deliberately left as-is, since it is one of the two sanctioned hard rules.

## Re-running the repro

The repro step is a browser click, and this sandbox has no app or services, so I ran
it at the seam the click goes through instead. Before the fix, the new test fails with
exactly the cited message — `TRPCError: Cannot merge while a test drive is active —
stop it first` (I removed the restored lines, ran the single test to see it red, then
restored them from the commit). After the fix it passes: `ok: true`, phase `shipped`,
drive slot cleared. So the repro no longer reproduces.

## Surprises

- `bun run test` has one failure that is not mine and not in the prompt's baseline:
  `packages/server/test/dev-pane.test.ts > kills the child process tree so the
  port-holder is not orphaned` — `expect(pidAlive(-pgid)).toBe(false)` gets `true`.
  It fails the same way on a targeted run of that one file, and my diff is two files
  neither of which touches process spawning or killing, so this is the container not
  reaping a process group, not a regression. Everything else is green: 246 files,
  3576 passed, 35 skipped. `bun run typecheck` is 0 errors.
- The prompt's baseline numbers (118 files / 1768 passed) are stale — the suite is
  246 files / 3612 tests on this branch.

## Drive machinery

Nothing to update: this change adds no service, env var, seed, or process. I did not
run `drive-setup`/`drive-stop` (no services here) and made no edits under `.runcastle/`.

## Left undone

- Ticket 4's review flagged stale comments and gate vocabulary in the web inspector as
  deferred. This fix happens to make one of those comments true again — the
  `mergeFeature` doc-comment in `git.ts:2827-2831` — but I left the rest alone.
- The lap-stamping-at-Burn problem and the dead earlier-lap-defects warning that the
  reviewer described are still open; they are nobody's ticket in this run.

#### 10. Decision 5's earlier-lap-defects burn warning can never fire in production; only a hand-faked lap makes its test pass

# ticket(10) — the earlier-lap defect warning now fires

## What was done

`undispositionedDefects` (packages/server/src/services/review-findings.ts) no longer reads the
feature's stored lap. It takes the lap being burned as a third argument, and `burnWarnings`
passes `feature.lap + 1` — the lap the click is about to stamp. That was the whole bug: the
stamp moved inside `burn()` this lap, so at the moment the dialog (and `complete_phase("tickets")`)
asks for warnings the feature still reads lap N, the review's defects are also lap N, and
`finding.lap < lap` excluded every one of them. Nothing else about the filter changed —
"answered for" is still `defectState`'s business, so a defect with a live fix ticket, or carried,
dismissed or fixed, still never reaches it.

I took the "scope the comparison" branch of the ticket's two options rather than re-stamping the
lap before warnings are computed: re-stamping would mean writing the lap on a read, and it would
collide with the separate defect the reviewer filed about `burn()` stamping the lap at the wrong
moment (which is not this ticket's).

In packages/server/test/burn-warnings.test.ts the `set({ lap: 2 })` fixture is gone. The helper
now leaves the feature where the flow actually leaves it — phase `review`, lap 1 — and split in
two: `defectFromLapOne` reports the defect with its fix ticket still live, and
`openDefectFromLapOne` fails that ticket on top. The split bought one new test: a defect whose
fix ticket is still live produces no warning, which is the boundary my change moved (the lap
filter used to hide those for free; now only `defectState` does).

## Re-running the repro

I re-ran the reviewer's repro exactly, as the (now honest) test `warns about the open defect the
burn is about to leave behind`: a feature at phase `review` on lap 1, one open un-dispositioned
`defect` stamped lap 1, then `burnWarnings(ctx, featureId)`. It returns the earlier-lap-defect
line naming the defect, and it is the only warning in the list. Before the change the same seed
returned `[]` — that part is arithmetic rather than an executed run (`1 < 1`), since the old
code is not on disk anywhere I could run it without a second checkout.

## Surprises

- The stated baseline in the prompt ("118 files, 1768 passed") no longer matches this repo: the
  suite is 246 files / 3612 tests. Two failed on the full run. `apps/web/test/settings-dialog.test.tsx
  > reaches every page from every other` is a 5s-timeout that passes in isolation — load, not logic.
  `packages/server/test/dev-pane.test.ts > kills the child process tree` fails in isolation too and
  is a process-group/kill sandbox fault; neither file shares a module with this diff. `bun run
  typecheck` is clean.
- `undispositionedDefects` had exactly one caller left (`burnWarnings`), so changing its signature
  cost nothing. Its old doc comment still described the `complete_phase` *gate* that this lap deleted.

## Left undone

- The warning sentence still opens "N defects from an earlier lap" — true relative to the lap
  being burned, but the operator reading it at Review is looking at the lap those defects came
  from. Rewording is prose the ticket did not ask for.
- The reviewer's underlying finding — `burn()` stamps the lap at the click, after the fix tickets
  for that lap were already written, and a restart re-stamps a lap for work that has not moved —
  is untouched. This ticket only stops the warning from depending on that timing.
- No `.runcastle/` drive change was needed: the diff adds no service, env var, seed or process,
  so the drive steps are already covered. I did not run them (no services in this sandbox).

#### 12. complete_phase returns no warnings to the one session that could still act on them — the iterate session at Review

# ticket(12) — complete_phase reaches the iterate session at Review

## What was done

`toolCompletePhase` (`packages/server/src/mcp/server.ts`) returned early for
every feature past Planning. That guard was written for one case — the human
clicked Burn while a planning session was still closing out — but with `rethink`
deleted it also swallowed the iterate road, which is now the main way a second
lap begins: a feature that reaches Review stays at Review while the iterate
session writes lap N+1's fix tickets. It now computes
`iterating = phase === 'review' && pendingTickets(...).length > 0` and skips the
early return in that case, so the call falls through to the
`{ waitingOn: 'human burn', warnings }` payload (and to `markTicketsReady`).
A feature at `building` or `shipped` is still closed out, pending tickets or not.
No deviation from the approach the ticket described.

Two tests in `packages/server/test/planning-steps.test.ts`: the repro itself, and
the `shipped`-with-pending-tickets case that pins which half of the old condition
still refuses.

**I re-ran the reviewer's repro step.** Seeded at `review` with one pending fix
ticket, `complete_phase({ phase: 'tickets' })` now returns no `note`,
`nextPhase: 'review'`, `waitingOn: 'human burn'`, and the two warnings
`burnWarnings` computes for that state (no review ticket in the batch, no
spec.md). I also confirmed it goes red without the fix by neutering the
`iterating` term and watching the test fail on `'planning is already closed out'`.

## Surprises

- `burn` in `services/features.ts:648` already had the identical condition, under
  the same name (`iterating`). I left it duplicated rather than extract a shared
  predicate — `burn` has the pending list in hand already and rewiring its gate is
  another ticket's territory — but the two now have to stay in step, and the
  comment here is the only thing saying so.
- The full suite has one failure that is not mine and not in the stated baseline:
  `packages/server/test/dev-pane.test.ts > kills the child process tree so the
  port-holder is not orphaned` (`expected true to be false` on `pidAlive(-pgid)`).
  It fails identically on a targeted run, it is a process-group reaping assertion
  in a container, and my diff touches only `mcp/server.ts` and one test file.
  Everything else is green: 244 files / 3579 passed; `bun run typecheck` 0 errors.
  Note the stated baseline (118 files, 1768 tests) is stale for this branch.
- `planningStepReported` is lap-scoped, so on an iterate lap at Review the feature
  is still on lap N and the lap-N planning session's own `tickets` stamp makes the
  iterate session's call read as `repeated`. It still gets the full answer
  (warnings included — the suite already pins "a repeat is not a brush-off"), but
  the note it also carries says "already reported complete on lap N" for genuinely
  fresh work. Only visible on a real second lap, not in the seeded repro.

## Left undone

- The `repeated` mis-read above: the honest fix is lap-boundary reasoning, not a
  scope this ticket owns.
- `lapInFlight` (`launcher/sessions.ts`) still requires `phase === 'planning'`,
  which no lap > 1 can now reach — its doc comment still describes Rethink
  flipping the phase back. Dead as written.
- The skills pack still tells sessions `complete_phase` can return `ok: false` and
  refuse (`skills/spec`, `skills/tickets`, `skills/revisit`). Already reported as a
  review finding; untouched here.
- Drive machinery: checked, no edit needed — this change adds no service, env var,
  seed or process. `.runcastle/drive-setup.ts` and `drive-stop.ts` are both present
  and unreferenced by the diff. I did not run them (no services in this sandbox).

#### 13. Verify the fixes that landed

Gates verification pass

No verification commands are configured for this project, so there were no gates to run; the pass was spent entirely on the landed fix diffs as instructed.

All five fixes held against their original findings:

- #8 restores the merge handler's self-drive cleanup before the git merge guard runs, and adds a paired regression test proving a drive of this feature is stopped while a drive of another feature still refuses.
- #9 no longer derives laps from run count: a Building restart retains the stored lap, while Burn from Review opens the next lap and re-stamps only the current lap's pending tickets. The two cited repro states are pinned in `burn-from-review.test.ts`.
- #10 evaluates undispositioned defects against the lap Burn is about to start (`feature.lap + 1`). Its production-shaped lap-1 Review fixture now produces the warning without hand-editing the feature to lap 2, while a defect with a live fix ticket remains excluded.
- #11 rewrites the live routing and planning instructions to Iterate followed by Burn from Review and to the warnings contract. The requested grep has no operative Rethink or deleted pipeline-gate instructions; remaining `gate` hits describe Gates review mode, dependency gates, generic gating, comments, or substring noise.
- #12 lets a Review feature with pending tickets reach the normal `complete_phase("tickets")` warnings payload while Building and Shipped still take the closed-out return. Both sides of that distinction are covered in `planning-steps.test.ts`.

No fix failed verification, and nothing plainly broken was found within these landed diffs. No verification finding was reported.
