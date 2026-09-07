# Outcome — Project chat branch collision

Clicking "New" to create a project chat session sometimes fails with: Branch with name runcastle/project already exists. A stale runcastle/project branch left by a previous project session is not cleaned up or reused when launching a new one. Find where the project-session launcher cuts its branch (packages/server — launcher/git services) and make launch resilient: reuse or delete-and-recut the stale branch (it is runcastle-owned, cut fresh from the base at every launch, so recreating it is safe as long as no live project session holds it). Add a regression test: launching a project session twice in a row, with the first one closed, succeeds.

- Shipped: 2026-09-07
- Laps run: 1

## What shipped

3 commits · 3 files

### Lap 1
- 1 tickets landed: #1 Clicking "New" to create a project chat session sometimes fails with:…
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 412966aef5b68f46c78b6b1ebb44af37fae2ce16
- Landed since: 0
- Outcome: done

- **Project chat can be relaunched after the prior session is closed** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Clicking "New" to create a project chat session sometimes fails with:…

# ticket(1) — project chat branch collision

## What was done

The project-session launcher cuts its branch in `ensureProjectWorktree`
(`packages/server/src/services/git.ts`). Once the branch had nothing ahead of the
base it ran `deleteBranchDetachingWorktrees(...)` and then an **unconditional**
`git branch runcastle/project <base>` — the delete's return value was thrown
away. So any delete git refused took the whole launch down with
`fatal: a branch named 'runcastle/project' already exists`, which is the error in
the report.

Extracted that recut into a private `recutProjectBranch` and made both halves
survive a branch that will not go: it now asks whether the branch is there at
all, and only then attempts the delete; if the delete is refused it runs
`git worktree prune` and tries once more; if the branch outlives both attempts it
is reused as it stands (it has nothing ahead of the base, so reuse loses no
work) instead of failing the launch. Two tests in
`packages/server/test/project-session.test.ts`: the ticket's literal
launch-close-launch regression, and the stale-pin case that actually reproduced
the bug.

## Surprises

- **The pin nothing could clear.** `deleteBranchDetachingWorktrees` detaches
  worktrees that hold the branch, but `detachWorktree` returns early when the
  worktree's directory is gone from disk — there is no checkout left to run
  `git checkout --detach` in. Git keeps pinning the branch to that dead
  registration (`Cannot delete branch ... checked out at <gone path>`), and
  `worktree prune` is the *only* thing that drops it. That is the reproducer, and
  it is the mirror image of the orphan case already covered in this file
  (registration gone, checkout survived) — the two failure modes are symmetric
  and only one was handled.
- **The ticket's own regression test does not catch the bug.** Launch → close →
  launch passes on the unfixed code: closing lands the work, landing deletes the
  branch, so the second launch finds nothing to collide with. I added it anyway
  (it is the acceptance criterion, and it pins the flow), but the stale-pin test
  is the one that went red.
- **`git branch --force` is not an escape hatch.** I checked: when a live
  checkout holds the branch, `-f` is refused exactly as `-D` is
  (`cannot force update the branch ... checked out at`). So the fallback had to
  be reuse, not a forced move.

## Left undone

- If the **human's own checkout** is sitting on `runcastle/project`,
  the branch is now reused rather than crashing the recut — but the launch still
  fails one step later at `addWorktree`, since git will not check the same branch
  out in two worktrees. The message there is accurate and names the repo, and the
  only "fix" would be moving the human's checkout, which the whole design forbids.
  Left alone deliberately.
- Two concurrent `ensureProjectWorktree` calls (double-clicking "New" while a
  fire-and-forget landing is still in flight) can still race on the branch. The
  new code is much more tolerant of it, but nothing serialises launches. I did
  not add a lock — out of scope and not what was reported.

## Verification

- `bun run typecheck` — clean (core, server, web, scripts).
- `env -u GIT_ASKPASS bun run test` — 224 files, 3268 passed, 4 skipped,
  **1 failed**: `packages/server/test/dev-pane.test.ts > kills the child process
  tree so the port-holder is not orphaned`. Not mine and not reachable from my
  diff — that test drives node-pty process-group reaping and imports nothing from
  `services/git.ts`; my change touches only `services/git.ts` and
  `project-session.test.ts`. Confirmed it fails the same way on its own targeted
  run. (Note the stated baseline's counts — 118 files / 1768 tests — no longer
  match this repo, which now has 224 files / 3273 tests.)
- Drive machinery: no edit needed. The change adds no service, no required env
  var, no seed and no extra process — the four triggers in the brief — so
  `.runcastle/drive-setup.ts` and `drive-stop.ts` are untouched. I did not run
  them (no services in this sandbox).
