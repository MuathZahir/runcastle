# Outcome — Review as a lap trail

The review page shows every lap as a trail; a review pass that produced no evidence lands as "unverified" and arrives loudly without blocking; an Agentic review button beside Test drive mints and burns a fresh review ticket; verification mode reads the recorded mode, not a webm file.

- Shipped: 2026-09-19
- Laps run: 1

## What shipped

29 commits · 50 files

### Lap 1
- 9 tickets landed: #1 Record what the review actually did: declaration block, verdict columns, recorded mode, honest drive probe; #2 The loud surfaces read the verdict: artifacts feed, templated headline, succeeded-unverified, next-lap context; #3 Agentic review mints and burns a fresh pass; ticket retry narrows back to failed-only; #4 The review page shows the lap trail, arrives loudly, and grows the Agentic review button; #6 verify-fixes prompt now tells verification reviewers their defects mint fix tickets — the code says they never do; #7 Agentic review burns every pending fix ticket too, and lands them on the current lap instead of a new one; #8 The reason Drive was withheld is never recorded on the pass, only put in the prompt; #9 Trail entry's "N tickets burned" counts pending and failed tickets as burned; #10 Two solid "Agentic review" buttons can render at once on the review page
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: f46d73923ec7769edd0203ad0efc2c444fde8289
- Landed since: 5
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 47884364001dbd7cda4916a7512d0cbb4b95ee45
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 2. The loud surfaces read the verdict: artifacts feed, templated headline, succeeded-unverified, next-lap context

# ticket(2) — the loud surfaces read the verdict

## What was done

Every surface that speaks for a review pass now reads the verdict columns ticket 1 persisted.

The per-pass artifacts feed (`packages/server/src/routes/reviews.ts`) grew `reviewMode`,
`reviewVerdict` and `reviewVerdictReason` on `ReviewTicketArtifacts` and on the rows it
synthesises; pre-feature passes pass their nulls straight through. The web mirror of that
interface (`apps/web/src/lib/reviews.ts`) grew the same three fields, which forced null
values into five existing web fixtures — those are the one-line-each test diffs.

The templated headline is composed by a new pure `composeReviewDigest(lap, resolution,
agentDigest)` in `workflows/review-ticket.ts`, applied in `reviewTicketOutcome` where the
digest is finalised — so the ticket row, the run aggregate and the review page's account
(which lifts the first line via `lapAccount`) all see it. An unverified pass reads
`Lap 3 · drive mode · DRIVE FAILED · nothing verified — <declared reason>` with the agent's
prose intact one line below. A verified pass's digest is returned untouched.

Run level: `HarvestedDigest` carries the review verdict, and `composeRunDigest` titles an
aggregate whose review verified nothing `# succeeded-unverified`. On the web side
`runHeadline` returns `Succeeded-unverified · nothing verified` ahead of the all-green
branch, which is the line that used to be wrong — the review lane is `done`, so every
count read clean. `RunHeader` was not restyled; it renders the headline it is given.

Next-lap context: `ReviewEvidence` (`services/carried-work.ts`) carries the three fields, so
all three injection channels report them — the system prompt's evidence section
(`launcher/artifacts.ts`) gains a `**Nothing verified:** <reason>` bullet, the lap-kickoff
sentence gains `; nothing verified: <reason>`, and the MCP `get_feature_context` tool
returns the fields on its evidence rows.

Deviation from the ticket's sketch: it offered "a machine-readable flag **or** the templated
headline" for the run aggregate. I took the headline in the digest column (the aggregate is
prose) and read the verdict off the ticket rows for the header, since those rows already ride
along with the run over tRPC — no new flag needed anywhere.

## Surprises

- The previous attempt of this ticket had already landed most of the above in commit
  `33cb4b0`; I verified it end to end rather than redoing it, and fixed one thing it got
  wrong: when the declaration block is missing or unparseable there is no mode to name, and
  the headline was filling `review mode · REVIEW FAILED` — inventing a mode for the exact
  case that recorded none. It now reads `mode unrecorded · NO DECLARATION`, which is the
  post-mortem's own case, with tests for it and for the verified-pass passthrough.
- `packages/server/test/dev-pane.test.ts > kills the child process tree` fails in this
  sandbox: after `stopDevPane`, `kill -0 -pgid` still succeeds, so the group was not reaped.
  It is **not** mine — I confirmed it fails identically at the base commit `1a1f545`, before
  any of this ticket's commits, and nothing on that test's import graph (`src/pty/*`,
  `services/events`) is touched by this diff. It is a container process-reaping fault.
- The prompt's stated baseline (118 files / 1768 tests) is stale for this branch, which runs
  251 files / 3704 tests. Everything else is green: `bun run typecheck` exits 0.

## Left undone

- The `ticket.done` event still reads `ticket 3 done — 0 commit(s)` for an unverified review
  pass, so the timeline is the one surface still speaking cleanly over a pass that verified
  nothing. No acceptance criterion covers it and adding an event is scope this ticket did not
  ask for, so I left it — but it is a genuine loud-surface gap for whoever wants it.
- The arrival banner's "nothing verified this lap" top line and the trail band itself are
  ticket 4/5 territory; this ticket only made the feed they render from honest.
- Drive machinery: this change adds no service, env var, seed or process, so nothing under
  `.runcastle/` needed editing. I did not run those scripts (no app or services in this
  sandbox) and made no change that would require it.

#### 4. The review page shows the lap trail, arrives loudly, and grows the Agentic review button

# ticket(4) — the review page as a lap trail

## What was done

The review page grew three things and lost one. A new full-width **lap trail** band
(`apps/web/src/components/review/ReviewTrail.tsx`) renders one entry per lap, newest first,
no disclosure: lap number, when it was reviewed, an outcome chip from the latest completed
pass (`Verified · drive/gates` / `Unverified` / `Could not run`, and no chip at all for a
pre-feature pass), the burned-ticket count as a button into the run view, one compact row per
pass (`#9 · verification · gates mode · verified`) with a Recording button where a recording
exists, and the lap's defect counts plus its test-note count. It renders from the per-pass
artifacts feed ticket 2 extended, through a new pure `lapTrail()` in
`lib/feature-ui/review.ts`; that derivation also backs `unverifiedLap()`, which the arrival
banner and the next-step bar both read, so the two cannot disagree.

The **arrival banner** (`NothingVerifiedAlert.tsx`) leads the page when the CURRENT lap's
latest completed pass verified nothing: "Nothing verified this lap", runcastle's templated
line, the declared reason, and Agentic review as its action. The **Agentic review button**
sits beside Test drive in the status strip, present in every state of the live page and
disabled with `a burn is running` while a run is live; the denied-drive banner keeps its
notice and dirty-file list but its button is now that same mint (its `ticket.retry` wiring
and the `reviewTicketId` prop are gone). The stage's "Earlier recordings" popover is deleted:
`picked` is lifted to `ReviewBody`, the trail sets it, and picking scrolls the stage into view
the way a note's timestamp already does.

Two deviations worth naming. **The bar's primary**: the ticket said "Merge is not the primary
action" and pointed at `feature-ui/review.ts`, but the primary lives in
`next-step/review.ts`. Rather than mint a new `ActionKind` (which would have pulled
`Workspace.tsx`'s action switch in), the unverified branch returns **no primary at all** —
Merge, Test drive and Iterate are all secondaries — which also keeps STYLE.md's one-solid-
button-per-view rule intact, since the banner's Agentic review is that solid. **The trail's
inputs**: the feed carries verdict/mode/reason but not ticket status or the digest, so the
trail joins the tickets already on the page for "could not run" and for the templated line.
The "fixed" count repeats the server's fix-ticket join (`defectState`) for the same reason —
a count that read the finding row alone would disagree with the strip above it.

## Surprises

- `EvidenceStage` is shared with `ShippedBody`, so deleting the popover costs the shipped
  record its recording picker; the trail is the review page's band only. The stage identity
  line now names the lap (decision 4's "identified by lap"), which is what the shipped page
  keeps instead. Its test now asserts that.
- Every tRPC stub that mounts `ReviewBody` had to learn `feature.agenticReview` —
  `review-bands` and `stage-expand` both failed with `Cannot read properties of undefined`
  until they did. Worth knowing for the next band that adds a mutation.
- The last line of `lib/feature-ui/review.ts` is an orphaned doc comment (`/** How much of a
  note or finding its one-line headline may carry. */`) whose function moved to `summary.ts`.
  I appended above it rather than adopting it; it is still there.
- `packages/server/test/dev-pane.test.ts > kills the child process tree` fails in this
  sandbox. It is not mine — my diff is web-only — and ticket 2 confirmed it failing at the
  base commit. A first full run also showed 8 further server/web failures that all passed on
  a targeted re-run and were green on the second full run: load flakiness, not regressions.
  Final state: `bun run typecheck` exits 0; `bun run test` is 3703 passed / 1 failed
  (dev-pane) / 35 skipped.
- Drive machinery: this change adds no service, env var, seed or process, so nothing under
  `.runcastle/` needed editing. I checked that trigger list only — I did not run
  `drive-setup`/`drive-stop` (no app or services in this sandbox).

## Left undone

- The shipped record shows no trail and can no longer reach earlier recordings. Mounting a
  readonly trail on `ShippedBody` is the obvious follow-up and is outside this ticket.
- `ANSWERED_BY` in `lib/feature-ui/drive.ts` still lists `ticket.retry` as something that
  clears the denial banner. Harmless — the mint's own `burn.started` clears it — but the
  event that now answers that banner is `review.agentic-minted`.
- The strip's and the banner's refusals go to a toast (the page's existing idiom for
  `testDrive`); only the denied-drive banner holds its refusal inline, where the file list
  it names has to stay put.

#### 7. Agentic review burns every pending fix ticket too, and lands them on the current lap instead of a new one

# Ticket 7 — Agentic review burns only the pass it mints

## What was done

`agenticReview` now scopes its burn to the review ticket it just minted. The
scope is a new `StartRunOptions.ticketIds` in `packages/server/src/workflows/runner.ts`,
forwarded from a new `burn(..., { onlyTicketIds })` option in
`packages/server/src/services/features.ts`.

Scoping the run's opening snapshot (`ctx.tickets`) alone was not enough, and this
is the one place the implementation goes past what the ticket described: the
burner re-reads the store whenever a review ticket settles (`admitNewTickets`,
`ticket-burner.ts:3044`, via `ctx.listTickets`), so the pending fix queue would
have been folded into the run a moment after the review landed. The runner
therefore also narrows `listTickets`, by hiding exactly the rows that existed at
run start and were left out of the scope. Tickets minted *during* the run — a
review's own fix tickets, and the verification pass — are never in that hidden
set, so they still join the run exactly as before.

The lap counter is deliberately left alone. Decision 7 says the mint is *for the
current lap*, and decision 5 says a lap holds several review passes, so an extra
review pass on the current lap is the designed shape; `lapTrail` already renders
passes as rows under a lap.

## Re-running the reviewer's repro

Re-ran it verbatim as a test (`packages/server/test/burn-robustness.test.ts`,
"burns the minted pass alone, leaving pending fix tickets and the lap where they
were"): a feature at `review` with one pending fix ticket, `agenticReview` called
without clicking Burn first. Before the fix it failed with three ticket ids
handed to the burner; after it, the run opens on the minted ticket alone, a
mid-run re-read returns that ticket alone, the fix ticket is still `pending`, and
`feature.lap` is still 1.

## Surprises

- The stated baseline in the prompt ("118 files, 1768 passed") is stale; the
  suite is now 253 files / 3740 tests.
- `bun run test` has one failure that is not mine and not in the listed baseline:
  `packages/server/test/dev-pane.test.ts` > "kills the child process tree so the
  port-holder is not orphaned". It asserts a PTY process group is reaped after
  `stopDevPane`; nothing it imports is in my diff. Confirmed on a single targeted
  run of that file alone. Everything else is green (3704 passed), and
  `bun run typecheck` is clean.

## Drive machinery

No edit needed and none made: this change adds no service, no required env var,
no seed and no extra process — only an optional argument on two existing
functions. `.runcastle/drive-setup.ts` and `drive-stop.ts` were not run (no
services in the sandbox) and did not need to be.

## Left undone

- `lapTrail`'s `burned` count (`apps/web/src/lib/feature-ui/review.ts:607`) counts
  every non-review, non-cancelled ticket on a lap regardless of status, so fix
  tickets still sitting `pending` read as "burned" in the trail entry. That is
  ticket 4's territory and unrelated to this defect, so it was left alone.
- `burn()`'s `onlyTicketIds` has exactly one caller. It was not generalised into
  the tRPC surface, and nothing else was given a way to set it.

#### 9. Trail entry's "N tickets burned" counts pending and failed tickets as burned

# ticket(9) — "N tickets burned" counted tickets that had not burned

## What was done

`lapTrail()` in `apps/web/src/lib/feature-ui/review.ts` built its `burned` figure from
every non-review ticket in the lap that was not `cancelled`, which swept in `pending`,
`burning` and `failed` rows. The filter now counts only `status === 'done'` — the
terminal-and-landed reading the ticket offered — so a lap holding one landed
implementation ticket and one freshly minted, still-pending fix ticket reads
"1 ticket burned". The `TrailEntry.burned` doc comment says "burned and landed" now,
and the filter carries a comment naming why pending and failed rows are excluded.
No change to `ReviewTrail.tsx`: it already renders the figure and its singular/plural
form straight off `entry.burned`, and the run-view button label follows along.

A tier-1 test was added beside the existing burn-count test in
`apps/web/test/review-trail.test.ts`, rendering the band over the real derivation with
a done, a pending, a burning and a failed implementation row, asserting "1 ticket burned".
It was red before the fix ("4 tickets burned") and green after.

## Re-ran the reviewer's repro

Yes — exactly as written, against `lapTrail` directly:
`lapTrail({ passes:[completed pass on lap 1], tickets:[{lap:1,status:'done'},{lap:1,status:'pending'}],
findings:[], notes:[], currentLap:1 })[0].burned` now returns **1** (it returned 2 before).
Run from a scratch script outside the repo, so nothing was committed for it.

## Surprises

- The prompt's stated baseline (118 files / 1768 passed) is stale: the suite is now
  253 files / 3740 tests. One test fails and it is not mine —
  `packages/server/test/dev-pane.test.ts > kills the child process tree so the
  port-holder is not orphaned` (`expect(pidAlive(-pgid)).toBe(false)`). Confirmed on a
  single targeted run of that one file: it fails identically in isolation, on server
  process-group reaping in this sandbox, with nothing from this ticket in reach of it.
  `bun run typecheck` is clean (exit 0, all four projects).
- The old `!== 'cancelled'` filter's own test case (a cancelled implementation ticket
  expecting 2) still passes unchanged, since `done` already excludes cancelled.

## Left undone

- `ReviewTrail`'s "N tickets burned" button navigates to the run view, which lists the
  lap's lanes including the pending and failed ones. The figure is now honest, but the
  label and the destination still count different things; naming the button for the lap
  rather than the figure would close that, and is beyond this ticket.
- No drive-machinery change was needed: this ticket adds no service, env var, seed or
  process, so `.runcastle/` was left alone and nothing there was run.

#### 11. Verify the fixes that landed

Gates verification pass

All five landed fixes hold under direct review of `feature/review-as-a-lap-trail` against their reported findings.

- #6: `verify-fixes.md` now accurately says verification findings never mint fix tickets, while retaining the carry/link/close clause. Its focused prompt assertion rejects the old wording.
- #7: Agentic review passes `onlyTicketIds: [ticket.id]`; the runner scopes both the opening snapshot and later ticket-store reads, so pre-existing pending fix tickets stay out of the run and remain pending. The pass stays on the current lap as designed.
- #8: the browser/ffmpeg/dev-command probe now produces one explicit withheld-drive reason, passes it into declaration resolution, and returns it as `reviewVerdictReason` when a Gates/verified declaration leaves `REVIEW-REASON` empty. The absent-ffmpeg case uses an explicit `undefined` probe and no longer defaults to the browser path.
- #9: the trail's burned count now includes only non-review tickets whose status is `done`, excluding pending, burning, failed, and cancelled rows.
- #10: when the dirty-drive denial and unverified-lap notices coexist, the unverified notice keeps the solid Agentic review action and the denial notice renders its identical action as ghost; denial-only state remains solid.

No verification findings were found. This project configures no verify commands, so there were no gates to run.

REVIEW-MODE: gates
REVIEW-VERDICT: verified
REVIEW-REASON:
