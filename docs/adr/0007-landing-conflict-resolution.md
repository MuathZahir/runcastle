# ADR-0007: Landing conflicts are resolved in-loop by an agent, not handed to the human

- **Status:** accepted (2026-07-26)
- **Extends:** ADR-0002 (burn concurrency), which creates these conflicts, and
  ADR-0006 (attempt chaining), whose `attempt_branch` pointer this reuses as the
  preserved-work mechanism.

## Context

Under burn concurrency, tickets fork the feature tip at start and land serially
at finish. When two tickets touch the same files, the second one's landing
conflicts. This is not an exceptional case — it is the normal shape of parallel
work — but the burner treated it as a terminal ticket failure and told the human
to fix it by hand:

```
ticket 3 committed to runcastle/ticket/improve-user-sto/3-lWsg1vxs but landing
on feature/improve-user-story hit a conflict: CONFLICTS: …
```

Everything about that message was a dead end:

1. **No recovery path in the UI.** The `merge.conflict.needs-human` event was
   consumed by nothing — the review phase had a conflict card with "Resolve with
   agent" (CONTEXT decision #9), but that was for the feature→base merge only. A
   ticket-landing conflict rendered as one red line in the event stream.
2. **The visible buttons could not work.** Retry re-ran the *implementer* with
   `buildRetryNotes`, which claims a transient infrastructure error killed the
   previous attempt. That is false here: the ticket is finished. The agent would
   inspect the branch, find nothing to do, commit nothing, and land into the same
   conflict — a deterministic loop. "Retry fresh" discarded the work and, with
   the feature tip unchanged, usually reproduced the same conflict.
3. **The chain was not preserved.** Every other failure path recorded
   `attempt_branch`; the conflict path did not, leaving retry to rediscover the
   branch by prefix scan.
4. **The conflicting paths existed only inside a git error string.**
   `mergeTempBranch` never captured them, unlike `mergeFeature`, which
   deliberately reads them before aborting.

## Decision

**A landing conflict is a step in the landing, not a ticket outcome.** The
burner resolves it with a second agent that has the full context of what was
being built, and only escalates to the human when that agent cannot finish.

1. **Structured conflict state.** `mergeTempBranch` captures
   `git diff --name-only --diff-filter=U` *before* `merge --abort` clears the
   unmerged index and returns it as `files`. A ticket that fails to land stores
   `attempt_branch` (the tip holding the work) plus `conflict_files` (new
   nullable column). Present `conflict_files` means: implemented, not landed.
2. **In-loop resolution, in the opposite direction** (`landWithResolve`). On
   conflict the burner does not touch the feature branch — it runs a resolver
   agent on the ticket's branch which merges the feature branch *IN* and resolves
   there. The next merge is then a fast-forward. The loop repeats only if the
   feature tip moved again mid-resolve, bounded by `burnConflictAttempts`
   (default 2, `0` disables). The resolver runs OUTSIDE the serial merge queue:
   it takes agent-minutes, and holding the queue would stall every other lane
   behind one conflicted ticket.
3. **The resolver gets the implementer's context**, which is the whole point —
   resolving by intent is impossible from conflict markers alone. Its prompt
   (`packages/skills/burner/resolve-conflict.md`) carries the same ticket JSON,
   feature brief and feature-docs digest the implementer had, plus the
   conflicting paths and one-line summaries of the sibling commits it is
   reconciling against (`commitSummaries`).
4. **Success is verified against git, not against the agent's word**: the
   feature branch must be fully contained in the resulting branch. An agent that
   declares victory without completing the merge fails the pass. A failed pass
   still carries forward whichever branch holds the most work, so no resolution
   attempt can lose commits.
5. **The stored state drives every re-entry.** Because a conflicted ticket
   carries `conflict_files`, the *next* burn of it — per-ticket Retry, or a
   whole-feature re-burn — skips implementation entirely and re-enters the
   landing loop. Retry therefore means "resolve", with no new plumbing and no way
   for the two verbs to drift apart. "Retry fresh" clears both pointers and
   re-implements from the current tip.
6. **Two human escape hatches in the run lane**, mirroring the review card:
   "Resolve with agent" (the AFK path, for a user who never touches git) and
   "Resolve in terminal" (a revisit session briefed with the ticket, its branch,
   and the conflicting files — offered only when no run holds the feature
   branch). A human who resolves and merges by hand can then click Retry: the
   landing loop finds nothing left to land and records the ticket as done.

## Consequences

- The common case (two tickets, overlapping files) now costs one extra agent
  run instead of a stuck feature. Cost is bounded per landing by
  `burnConflictAttempts`.
- A resolver merge commit lands on the feature branch alongside the ticket's
  work, so feature history shows the reconciliation explicitly.
- Semantic conflicts remain the resolver's hardest case: git reports only
  textually conflicting files, and a clean merge can still be broken by the other
  side's rename or signature change. The prompt calls this out and requires a
  typecheck + scoped test run before committing, but this is the failure mode
  most likely to reach the human.
- Contradictory intent is deliberately NOT auto-resolved: a resolver that finds
  the two sides irreconcilable writes `BLOCKED.md` and stops, which surfaces as
  a conflict for the human with the reasoning attached.
- Conflicts are still *possible* rather than prevented. Ticket `seams` are known
  up front, so a scheduler that declines to run overlapping tickets concurrently
  would remove a class of them; that is left for a later ADR, since it trades
  parallelism for a conflict rate we can now absorb.
