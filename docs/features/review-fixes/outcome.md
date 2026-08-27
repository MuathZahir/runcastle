# Outcome — Review fixes

Review drive refuses on runcastle's own artifact: 3 of 4 browser walks were refused with "Working tree has uncommitted changes — commit or stash first", the sole dirty entry being a staged `docs/features/<slug>/brief.md` that runcastle's own pipeline created. Find where the brief is written/staged without being committed on the feature branch (draft-features / create_feature / lap paths in packages/server/src/services) and make sure the feature branch is clean of runcastle-owned artifacts before a review ticket is dispatched — commit the brief with a `runcastle:` message, or exclude runcastle-owned docs from the drive's dirty check (the drive guard lives in packages/server/src/services/git.ts). Prefer committing: docs are meant to be versioned (charter decision 5). Regression test: a feature whose brief.md is staged-but-uncommitted can start a review drive.

- Shipped: 2026-08-27
- Lap: 1

## 1. Review drive refuses on runcastle's own artifact: 3 of 4 browser walks…

# Ticket 1 — a drive is no longer refused over runcastle's own brief

## What was done

The drive guard in `packages/server/src/services/git.ts` now lands runcastle's own
docs before it reads the working tree. A new module-private `commitPipelineDocs`
wraps the existing `commitDocs` with a `runcastle:` subject and swallows failure,
and `testDrive`'s `start` path calls it immediately before the `git status
--porcelain` dirty check. Committing was chosen over excluding `docs/features/**`
from the check, as the ticket preferred: those docs are meant to be versioned
(CONTEXT.md decision 5).

The regression test lives in `packages/server/test/review-wires.test.ts` — the
review-drive seam, next to the existing "still denies a dirty tree" case. It
stages a `docs/features/reviewed/brief.md`, starts a review drive through the
`review_drive` MCP tool, and asserts the drive starts, the tree ends clean, and
the commit that made it clean carries a `runcastle:` subject.

## Surprises

- The root cause is not a missing commit — `createFeature`, `startDraft` and
  `quickChange` already call `commitDocs` best-effort. It is that `commitDocs`
  runs `git add docs/features` *before* the commit that can fail (unset git
  identity, a refusing hook), so a swallowed failure leaves the brief **staged**.
  That is exactly the "staged, not untracked" symptom in the bug report.
- Those creation paths commit to whatever branch the **main checkout** is on —
  the base, not `feature/<slug>`, because `createFeatureBranch` cuts the branch
  without checking it out. Real briefs in this repo's own history sit on `main`
  (`6f7b993 runcastle: scaffold burn-guard-and-prompt-rules docs`). The fix
  deliberately keeps that behaviour rather than inventing a second convention.
- The fix applies to human drives as well as review ones. `testDrive` has a
  single dirty check, and branching it by `purpose` would have been asymmetry
  with no reason behind it — the human is refused by the same staged brief.
- The stated baseline in the burn prompt is stale: this branch has 135 test
  files / 2247 tests, not 118 / 1768.

## Verification

`bun run typecheck` — clean. `env -u GIT_ASKPASS bun run test` — 1 failure,
`dev-pane.test.ts > kills the child process tree`, which reproduces on a targeted
run of that one file and is a sandbox process-group-reaping property with no git
involvement; it is not listed in the stale baseline but is not mine. Everything
else passes. No `.runcastle/` drive-machinery edit was needed — the change adds
no service, env var, seed or process — so nothing there was checked or run.

## Left undone

- `commitDocs` itself still leaves the index staged when its commit throws. A
  narrower root fix would be to `git reset -- docs/features` on failure, but the
  brief would then be *untracked* and still dirty, so it would not have fixed
  this bug; the drive-guard commit is the one that does.
- The doctor already warns about an unset git identity (`doctor.ts`, ~line 428),
  which is the most likely reason the original commit failed. Nobody surfaces
  that warning at drive time, where it would explain a denial best.

## 2. Review prompt: when the drive is refused or unavailable, forbid the…

# Ticket 2 — a refused review drive is not an invitation to build one

**What was done.** The review agent's prompt now closes the hole that let one review
improvise its own environment when `review_drive` would not start. Three places in
`packages/skills/burner/review-ticket.md` say it: the drive step gains a bolded
"Never build your own environment to drive in" paragraph — no worktree, no dependency
install, no build, codegen or migration — carrying the evidence for why (that
improvisation cost more than any other single act in any review and still left four of
six criteria unverifiable), and telling the agent what it *does* have instead: the diff
it already read plus the repo's own verify commands as the manifest defines them, with
every drive-only criterion marked unverified in the summary note. The digest step and
the hard-rules list repeat the contract, and all three pin the exact words
`could not drive: <reason>` so the phrasing is one string, not three paraphrases.

I deviated from the ticket in one place worth naming. The ticket points at
`packages/server/src/workflows/review-ticket.ts` "and its prompt asset", but that module
holds no prompt text — it renders the asset — so the rule itself could only go in the
markdown. What the module *did* hold was a stale claim: its header docblock listed
"a drive it could not get" among the review's failure modes, which the template has not
agreed with since a refused drive became a note plus a digest line. I corrected it to the
failure that is actually in the code (no base branch to diff against) and recorded the
new contract beside it. Comment-only; no behaviour changed anywhere in this ticket.

**Surprises.** Two. First, the baseline in my brief is stale: it promises 118 test files
and 1768 passing, while this branch actually runs 135 files and 2247 tests. Second, one
test fails in this sandbox and it is not mine —
`packages/server/test/dev-pane.test.ts > kills the child process tree so the port-holder
is not orphaned` asserts a killed process group is gone (`pidAlive(-pgid)` false) and
gets true. It fails identically on an isolated re-run, and my branch touches only a
markdown file, a test file and a comment, so this is the container's process reaping, not
the code. Everything else is green: `bun run typecheck` clean across all five projects,
2242 passed.

**Left undone.** Deliberately not touched: the review path still *hard-fails* the whole
ticket before spawning anything when `agent-browser` is missing from PATH
(`executeReviewTicket`), even though the template now insists a drive that cannot happen
is a note rather than a failed review. Those two rules disagree, and reconciling them is
a behaviour change this ticket did not ask for — but a reviewer that could have read the
diff never gets to, purely because a browser CLI is absent. Also left: the review prompt
tells the agent to run "the repo's verify commands" without being handed them, while
`config.verifyCommands` already exists and the implementation prompt does get them via
`buildVerifyNotes`. Plumbing a `VERIFY_NOTES`-style placeholder into the review template
would make the instruction actionable instead of a search.

**Drive machinery.** No change needed and none made: this ticket adds no service, no
required env var, no seed and no process, so `.runcastle/drive-setup.ts` and
`drive-stop.ts` are untouched. I did not run them — correctly, per the standing rule.

## 3. Review prompt: scope each review to drive OR gates, not both. The two…

_no digest captured_

## 4. Emit `ticket.timing` for review tickets. Today the only emit is in…

# Ticket 4 — `ticket.timing` for review tickets, and a lane duration that means something

## What was done

`ticket.timing` is now emitted by both execution kinds, from one shared helper.
`executeReviewTicket` became a thin wrapper that starts a wall clock and a
`createToolTimer`, delegates to a new private `reviewTicketOutcome` (the old body,
verbatim, plus one `timer.onEvent` line), and emits in a `finally` — so all four
exit paths are covered, including the two refusals (no recorded base branch, no
`agent-browser` on PATH) that end the ticket before an agent exists.

The payload gained wall clock. `TicketTiming extends ToolTimingSummary` with
`startedAt` / `endedAt` / `wallMs`; `buildTicketTiming`, `formatTicketTiming` and
`emitTicketTiming` are exported from `ticket-burner.ts` and used by both paths, so
the shape does not depend on which kind produced the event. Two deviations from
the ticket's description, both deliberate:

- The implementation path's emit was guarded by `if (timing.calls > 0)`. That guard
  is gone. ADR-0008 says timing is emitted on *every* exit path, and with a wall
  clock in the payload there is always something true to say — a lane with no
  timing event is a lane that falls back to guessing.
- The message formatter reuses `fmtClock` from `@runcastle/core` rather than
  growing a server-local duration formatter. `core/format.ts` already exists for
  exactly this ("both ends render the SAME fact and a human compares them").

On the UI side, `ticketDurations` moved out of `RunBody.tsx` into
`apps/web/src/lib/feature-ui.ts` — where the rest of the event-derived UI lives,
and where it is reachable from `apps/web/test/feature-ui.test.ts` — and now takes
the last `ticket.timing` event's `wallMs` per ticket, falling back to the
first→last event spread only when there is no timing event (a lane still burning,
or a run from before this change). Ten unit tests across the two suites, including
the regression: a ticket created two hours before it burned reports 5m 35s.

## Surprises

- Nothing in the codebase ever read a duration off a log file. The 5.2-hour figure
  came from a human or an agent reading `review-<feature>-<seq>.log` by hand; the
  UI was already event-derived. So the UI half of this ticket was not a bug fix
  but an accuracy fix — the event spread starts at whatever the run first said
  about a ticket, which for a ticket that waited on a blocker is minutes before
  its agent existed. That distinction is now written into the doc comments so the
  next reader does not have to re-derive it.
- `packages/server/test/dev-pane.test.ts > "kills the child process tree so the
  port-holder is not orphaned"` fails in this sandbox, both in the full suite and
  targeted. It asserts `kill -0 -<pgid>` throws after a teardown — pure OS/container
  process-reaping behaviour, with no import path to anything in this diff. It is
  not in the prompt's stated baseline, and the stated baseline itself no longer
  matches this branch (118 files / 1768 tests stated; 135 files / 2257 tests
  actual), so the baseline note is stale. I am calling this an environment fault
  rather than fixing it. Everything else is green: `bun run typecheck` clean across
  all four packages plus `scripts/`, and 2252 of 2253 non-skipped tests pass.

## Left undone

- ADR-0008 §Decision 1 still describes the timing telemetry as a property of "the
  burn". It is now true of reviews too, and the payload has grown a wall clock.
  Someone should reconcile the ADR text; I did not, because the ticket asked for
  no doc change and an ADR is a decision record, not an API doc.
- `apps/web/src/lib/format.ts:fmtDuration` and `core/format.ts:fmtClock` are two
  spellings of "how long was that". Now that the server renders a duration too,
  promoting one of them into core and deleting the other is a real (small) cleanup.
- Nothing in `.runcastle/` needed a change: this ticket adds no service, no
  required env var, no seed, and no process. I confirmed `drive-setup.ts` and
  `drive-stop.ts` are present and untouched; I did not run them (no services in
  this sandbox, per the standing instruction).

## 5. Review the integrated change

This lap was housekeeping on the review step itself — four small repairs to the part of runcastle that reviews your work, aimed at the ways it had been wasting its own time.

The biggest change is that a review now commits to one approach before it starts, instead of trying to do everything. It either walks your running app in a browser against the things the ticket asked it to check, or it runs your project's verify commands and reads the branch's diff — never both. That choice is made in the first breath of the review, and the reviewer is told up front whether driving the app is even possible on this machine, so it no longer spends a tool call and a checkout switch discovering that for itself. A missing browser used to fail the whole review outright; now it just settles the question and the other mode runs. There is also a flat prohibition, written into the reviewer's instructions in some detail, against building itself an environment when it cannot get one — no scratch worktrees, no dependency installs, no code generation. That one exists because a previous review did precisely that, at more cost than any other single act on record, and still could not check four of its six boxes.

The second change is about time. Reviews were not reporting how long they took, so the interface had been guessing from log files that get appended to across every retry — which is how a five-and-a-half-minute review once showed up as five hours. Reviews now report their own duration on every path out, including the ones where they refuse before starting, and the run lanes read that figure instead of guessing.

The third is meant to stop a review being turned away at the door. Three of four recent drives were refused because runcastle's own scaffolding had left a file half-committed in your checkout, and the drive's cleanliness guard could not tell that from your own unfinished work. Starting a drive now commits those documents first.

That last one is where I would look before merging. It commits every uncommitted file under the feature-docs folder, not just the ones runcastle wrote, and it does so on whichever branch you happen to be standing on rather than the feature branch — so your own half-finished notes can be swept into a commit with runcastle's name on it, on your main line, without being mentioned. It also fires when you click Test drive yourself, not only when a review does. Separately, the new gates mode reads verify commands from machine-wide settings while every other part of the system reads them from the project, and on this machine the project has them and the global settings do not — so as it stands the mode that was supposed to run your gates will be told there are none to run. Both are small, well-localised fixes; the notes have the file and line for each.

I could not drive the app this lap. The drive was refused over an untracked notes file left in the checkout — the same class of problem this lap set out to fix, and still live because the running server is the pre-fix code. So everything above was confirmed by reading the branch rather than by watching it work, and the one visible piece, the duration shown in a run lane, has good unit tests behind it but was never seen on screen.
