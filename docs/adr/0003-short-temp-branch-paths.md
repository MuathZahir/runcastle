# ADR-0003: Truncate the slug in temp branch names (Windows MAX_PATH)

- **Status:** accepted (2026-07-20)
- **Amends:** ADR-0002 decision 1 (branch-name format detail only; the
  concurrency model is unchanged).

## Context

Sandcastle keys its worktree directory on the branch name
(`.sandcastle/worktrees/<branch>`), so every character of a temp branch name
lands in the path of every checked-out file. With the ADR-0002 format
`runcastle/ticket/<slug>/<seq>-<unique>`, a long feature slug (observed: 62
chars → a 90+-char branch name) pushed deep repo trees past Windows'
260-char `MAX_PATH`. `git worktree add` then fails mid-checkout with
`fatal: ... Filename too long`, and every burn attempt for that feature dies
before the agent even starts.

Requiring users to set `core.longpaths=true` (plus the Windows
`LongPathsEnabled` registry key for non-git tooling) was rejected: runcastle
should work on a stock Windows setup.

A second, compounding problem: the failure event showed only the FIRST line of
git's stderr — `Preparing worktree (new branch '...')`, which is progress
noise, not the cause — making the failure look like nonsense.

## Decision

1. **Truncated slug segment.** Temp branch names become
   `runcastle/{research,ticket}/<slug-segment>/<seq>-<unique>` where
   `<slug-segment>` is the feature slug truncated to 16 chars (trailing dashes
   trimmed) — `tempBranchSlugSegment` in `services/git.ts`. Uniqueness was
   always carried by `<unique>` (nanoid); the slug is only there so humans and
   the boot sweep can map a leftover branch to its feature.
2. **Sweep matches by truncation.** `cleanupTempBranches` resolves a branch's
   slug segment against every local `feature/*` branch whose slug either equals
   the segment (pre-ADR-0003 leftovers) or truncates to it. Truncation can make
   two features share a segment, so all candidates are checked and the branch
   is deleted when fully merged into ANY of them (unmerged branches are still
   always kept).
3. **Error headlines.** Failure events surface the LAST `fatal:`/`error:` line
   of a multi-line error instead of the first line (`errorHeadline` in the
   burner and research workflows). The full error is still stored on the
   ticket/event data.

## Consequences

- The branch-name path contribution drops from unbounded (slug length) to a
  ~45-char ceiling, keeping worktree checkouts of deep repos under `MAX_PATH`
  on stock Windows.
- Branch names are less self-describing for long slugs; the seq + feature
  branch remain in run events and ticket errors for disambiguation.
- Old-format leftover branches (full slug) are still swept via the
  exact-match fallback.
