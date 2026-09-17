# Outcome — Review retry deadlocks on its own minted fix tickets

A failed review ticket can never be retried once it has minted fix tickets — the scheduler deadlocks or defers forever. Observed on four-states-and-two-hard-rules: review #4 failed (agent crashed after reporting 3 findings), fix tickets #5-#7 exist with blockedBy [4], all failed. Retrying #4 alone: reviewGate() in packages/server/src/workflows/ticket-burner.ts sees #5-#7 as failed implementation tickets and returns 'defer' — the run ends in ~1s with 'review deferred until the failed ticket(s) are retried or cancelled' and nothing ran. Retrying #5 (which resets its failed blocker #4 too): #5 waits on #4 (blocker not done), #4's reviewGate waits on #5 settling (implementationsSettled() sees it pending) — nothing ready, nothing in flight, and the defensive fallback fails everything with 'unresolvable dependencies'. Ten one-second failed runs in the log confirm both paths. No order of Retry clicks escapes; today's only workaround is waiving every minted fix ticket by hand before retrying the review. Fix the circular wait: fix tickets whose blockedBy includes the review ticket itself (the tickets that review minted) must not count in reviewGate's implementationsSettled()/failedImplementations() — they structurally cannot settle before the review they are blocked on, so treating them as implementations that must settle first is the deadlock. With that exclusion, retrying the failed review runs it; its minted children then unblock or get superseded normally. Consider also whether retryTicket in packages/server/src/services/features.ts should stop resetting a failed REVIEW blocker when retrying a fix ticket, since the deadlock run that follows is what overwrote #4's real error ('review agent died: claude-code exited with code 1') with 'unresolvable dependencies', destroying the diagnostic. Add scheduler tests for: retry of a failed review with failed minted children (must run the review), and retry of a fix ticket alongside its pending review blocker (must not fail with unresolvable dependencies).

- Shipped: 2026-09-16
- Laps run: 1

## What shipped

8 commits · 7 files

### Lap 1
- 2 tickets landed: #1 A failed review ticket can never be retried once it has minted fix…; #3 Retried reviews leave their failed minted fix tickets stale and duplicate them
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 830f1fb496adc8698ff2237510a9b3fdd09a21d4
- Landed since: 1
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 10e5d551f4aeebf11f0342d359f8caae5e09701a
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. A failed review ticket can never be retried once it has minted fix…

# ticket(1) — review retry deadlocks on its own minted fix tickets

## What was done

The circular wait in `burnTickets`' review gate is gone. A new
`gatedImplementations(reviewSeq)` helper in
`packages/server/src/workflows/ticket-burner.ts` is now the single place the
gate derives its ticket set from: every non-review ticket in the run EXCEPT the
ones whose `blockedBy` names that review — the fix tickets it minted.
`implementationsSettled`, `failedImplementations` and `reviewGate` all take the
review's `seq` and read through it, and `readyState` passes `t.seq` when it
reaches the gate. The collapse check (`landed`) reads the same excluded set, so
a run whose only non-review tickets are the review's own children is "a review
of what earlier runs landed", not a collapse.

Two scheduler tests in `packages/server/test/review-ticket.test.ts` drive both
deadlock paths through `burnRun`; both were red before the change (`started`
was `[]` in each). On the `retryTicket` question the brief asked me to
consider: I left it resetting a failed REVIEW blocker. The reason the brief
gave for changing it — the deadlock run overwriting the review's real error
with "unresolvable dependencies" — is dissolved by the gate fix, since the
review now actually runs and writes its own outcome; refusing to reset it would
instead cascade the retried fix ticket straight back to failed. That judgement
is pinned by a test in `burn-robustness.test.ts` and a comment at the closure
in `services/features.ts`.

## Surprises

- The exclusion had to cover `reviewGate`'s `landed`/collapse check too, not
  just `implementationsSettled`/`failedImplementations` as the brief named. A
  lap whose run holds only the review and its failed children would otherwise
  have flipped from deadlock to being cancelled outright with "nothing landed".
- The prompt's baseline ("118 files, 1768 passed, 0 failed") does not match this
  checkout: `bun run test` reports 257 files / 3770 tests, and **10 fail on this
  container** — 9 web tests (`apps/web/test/first-run-wizard.test.tsx` and
  `settings-burns.test.tsx`, all dying on
  `trpc.setup.imageBuildTarget.useQuery` being undefined in
  `EnableAfkCard.tsx`) and one environment-dependent process-group test
  (`packages/server/test/dev-pane.test.ts`, "kills the child process tree").
  My diff touches four files, none of them in `apps/web` or on any path those
  tests import, so none of the ten are mine. `bun run typecheck` is 0 errors.
- Nothing in the codebase supersedes or dedupes fix tickets, so re-running a
  retried review will mint fresh fix tickets that duplicate the failed ones
  still sitting there. The brief's "get superseded normally" has no mechanism
  behind it today.

## Drive machinery

Not touched, and not needed: the change adds no service, no required env var,
no seed and no process — `.runcastle/drive-setup.ts` / `drive-stop.ts` are
unaffected. I did not run them (no services in this sandbox).

## Left undone

- The duplicate-fix-ticket problem above: a retried review that re-reports the
  same defects has no way to close out or supersede the fix tickets its earlier
  attempt minted. That is a real follow-up, deliberately out of this ticket.
- `retryTicket` still offers no up-front refusal (or warning) when the ticket
  being retried is a fix ticket whose review blocker failed; today it silently
  pulls the review along. If that turns out to surprise operators, a GateError
  naming the review would be the smaller fix.

#### 3. Retried reviews leave their failed minted fix tickets stale and duplicate them

# ticket 3 — Retried reviews leave their failed minted fix tickets stale and duplicate them

## What was done

The review-retry fix now finishes the promise the brief made: after a retried
review lands, its minted children unblock or get superseded rather than sitting
stale. Two halves, one on each side named in the ticket.

In `packages/server/src/workflows/ticket-burner.ts`, the set ticket 1 excluded
from the review gate got a name of its own — `mintedByReview` — and
`gatedImplementations` is now its complement, so the partition is derived once.
A new `readmitMintedChildren(reviewSeq)` runs at the moment a review lane goes
`done` (right beside `admitNewTickets`): every fix ticket that review minted and
that is still `failed` is written back to `pending`, its error cleared, and put
into the scheduler's pending set, so it burns in the run that produced the
review — exactly as a first-time review's fresh children do. A `cancelled` child
is left alone, because waiving each fix by hand was the operator's workaround
for the deadlock and reviving one would overturn that decision. A review that
fails again revives nothing.

In `packages/server/src/services/review-findings.ts`, `reportFinding` now looks
for a defect the same review ticket already reported on the same lap — matched
on trimmed, lower-cased title + location, since the agent rewrites detail and
repro wording on every attempt — and, when that finding's fix ticket is still
`pending` or `failed`, rebuilds the finding and the ticket from the fresh report
instead of minting a second one. The ticket comes back `pending` with refreshed
title/goal/context/criteria, so the fix agent reads what the review just saw.
Settled work is never touched: a `done` fix ticket answered the defect, and a
`cancelled` ticket or a dismissed/carried finding is a human's decision.

I re-ran the reviewer's repro step exactly, as a test over the real store
(`a retried review over the real store`, in `review-ticket.test.ts`): done
implementation ticket, a review whose dead attempt reported one defect and left
its child `failed`, the review retried to `pending`, then `burnTickets` driven
through the review's successful completion with the review re-reporting the same
defect. It no longer reproduces — the run ends with ONE fix ticket (the original
one), `done`, burned on the re-reported wording, one finding, and the
verification pass the landed fix is owed. Before the change the same scenario
left the child `failed` and minted a second ticket beside it.

## Surprises

- Two of ticket 1's tests asserted the behaviour this ticket changes (a failed
  minted child staying failed after the review lands). One of them would have
  hung rather than failed, because its gated executor never releases a ticket it
  did not expect to start. Both were extended to the new outcome; what they were
  pinning — the review runs, and a retried fix waits behind its retried review —
  is unchanged.
- The end-to-end test needed a `WorkflowCtx` wired to real services by hand;
  there is no shared helper for that, so it mirrors `runner.ts`'s wiring.
- A literal NUL byte I wrote into the `defectKey` separator made git treat
  `review-findings.ts` as binary for one commit. It is printable text now, but
  commit `a8f0c6d` still shows that file as `Bin` in its own diff.
- `bun run test` is not green here and was not before this ticket: 10 failures
  in `apps/web/test/settings-burns.test.tsx`, `apps/web/test/first-run-wizard.test.tsx`
  (both `EnableAfkCard.tsx` reading `useQuery` off an undefined trpc key) and
  `packages/server/test/dev-pane.test.ts` (a process-group kill that this
  container does not reap). I confirmed all ten fail identically at `c57ef60`,
  the commit before this feature branch's work, using a scratch `git worktree`
  with the installed `node_modules` symlinked in. The prompt's baseline block is
  stale in any case — it claims 118 files / 1768 tests, and the suite is 257
  files / 3779 tests. `bun run typecheck` is 0 errors.
- Drive machinery: nothing to update. This change adds no service, no required
  env var, no seed and no process — only scheduler and service logic — so
  `.runcastle/drive-setup.ts` and `drive-stop.ts` are untouched and unread.

## Left undone

- A child whose defect the retried review does NOT re-report is readmitted and
  re-burned on its old, possibly stale context. Superseding it instead (cancel
  it, leave the finding open for the human) would need the scheduler to know
  which findings the review just reported, which is a seam that does not exist
  today. Readmitting is the smaller reading of "unblock or get superseded".
- The match key is per review ticket. A LATER lap's review reporting the same
  defect still mints a fresh finding and ticket, which is today's behaviour and
  is probably right (each lap owns its findings), but nobody has decided it.
- `reportFinding` rewrites the fix ticket's content on every re-report, even
  when the wording is identical, so an unchanged re-report still emits a
  `ticket.edited`. Harmless, and cheaper than diffing four fields.
