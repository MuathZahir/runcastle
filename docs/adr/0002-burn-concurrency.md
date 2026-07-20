# ADR-0002: Burn concurrency via per-ticket temp branches + serialized landings

- **Status:** accepted (2026-07-20)
- **Deciders:** Muath + planning session
- **Spec delta:** `docs/SPEC.md` §8 ("concurrency = 1 (M1) but code shaped as a
  worker pool so M2 raises the constant") — this is that M2 change.

## Context

The M1 burner ran one ticket at a time (`CONCURRENCY = 1`) with sandcastle's
`branch` strategy pointed straight at `feature/<slug>`. The scheduler was
already a worker pool (ready-queue over `blockedBy`, in-flight map, failure
cascade), so raising the width looked like a one-line change — but it wasn't:

- Sandcastle keys its worktree on the **branch name**
  (`.sandcastle/worktrees/<branch>`, SANDCASTLE-NOTES §branch-strategy). Every
  ticket targeting `feature/<slug>` shares ONE worktree and ONE branch head —
  two concurrent agents would trample each other's working directory.
- Concurrent merges into the same branch race the ref/checkout.

The research workflow (ADR-0001 §7: "serial HITL, PARALLEL AFK") had already
solved this shape: per-run temp branches (`runcastle/research/...`) based on
the feature branch tip, landed by `mergeTempBranch`, swept at boot.

## Decision

1. **Per-ticket temp branches.** Each burn attempt runs on
   `runcastle/ticket/<slug>/<seq>-<unique>` (`baseBranch: feature/<slug>`).
   Distinct branch names give each concurrent agent its own sandcastle
   worktree. The unique suffix means a re-burned ticket never reuses a stale
   worktree or a conflict leftover.
2. **Serialized landings.** A per-run serial queue (`createSerialQueue`) lands
   temp branches on the feature branch one at a time via `mergeTempBranch`
   (shared with research; the old `mergeResearchBranch`, renamed).
3. **Done = merged.** A ticket reaches `done` only after its branch has landed.
   The scheduler readies dependents only on `done`, so a dependent's temp
   branch always forks a tip containing its blockers' commits.
4. **Conflict = failed + preserved.** When parallel independent tickets touch
   the same files, the later landing may conflict: the merge is aborted, the
   temp branch preserved for manual recovery, the ticket fails with
   `merge.conflict.needs-human`, and its dependents cascade-fail. No
   auto-rebase-retry in M2.
5. **Configurable width.** `burnConcurrency` (int 1–8, default 3) — global-only
   setting: config file, `RUNCASTLE_BURN_CONCURRENCY` env (locks the field),
   Settings UI. Each concurrent ticket is a full AFK agent (its own container
   under docker/podman), so the width is a cost knob as much as a speed knob.
6. **Boot sweep covers both prefixes.** `cleanupTempBranches` (the old
   `cleanupResearchBranches`, generalized) deletes fully-merged
   `runcastle/research/*` AND `runcastle/ticket/*` leftovers; unmerged branches
   (never-landed work or preserved conflicts) are always kept.

## Consequences

- Independent tickets burn in parallel up to the width; `blockedBy` chains
  remain strictly ordered.
- The feature branch only ever advances through the serial merge queue (or an
  HITL session committing docs) — never directly from an agent worktree.
- Parallel tickets that overlap on files trade speed for landing conflicts;
  ticket decomposition (disjoint seams) is what keeps the trade favorable.
- Abort now drains ALL in-flight agents (`Promise.allSettled`) before the run
  finalizes as cancelled, so no rejection goes unobserved.
- Follow-ups deliberately deferred: auto-rebase-retry of a conflicted ticket on
  the fresh tip; per-project `burnConcurrency` override.
