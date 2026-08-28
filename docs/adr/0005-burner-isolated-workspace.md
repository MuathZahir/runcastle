# ADR-0005: Burner isolated workspace — keep the agent's hot path off the bind mount

- **Status:** accepted (2026-07-20)
- **Amended:** 2026-08-28 — post-commit hook is push-only; the mounted worktree
  is removed host-side after the run (feature post-commit-sync-once)
- **Extends:** ADR-0004 (which fixed the pnpm store mount but left the worktree
  bind mount — "an environment problem" — to the environment). This ADR brings
  that problem back into the code, because the environmental answer had the
  wrong user experience.

## Context

Sandcastle creates its worktree on the host (`.sandcastle/worktrees/<branch>`)
and bind-mounts it into the container at `/home/agent/workspace`. On a Windows
or macOS host that mount crosses Docker Desktop's filesystem translation layer,
and every small-file operation pays it: a real burn against a pnpm monorepo saw
a 751s dependency install and a test run with `sys` time *exceeding* `user`
time (`real 8m08 / user 4m16 / sys 5m29`) — the signature of a
filesystem-bound, not CPU-bound, workload.

A controlled A/B inside one container on a Windows host measured the tax
directly: 2000 small-file **writes took 4891ms on the bind mount vs 82ms on the
container's native filesystem (~60x)**; deletes ~74x; reads ~4x.

ADR-0004 pointed at WSL2 ("run runcastle and clone target repos inside the
Linux filesystem"). Designing that path made its cost visible: a first-run
bootstrap wizard (distro + bun + runcastle + Docker integration), a data-dir
migration (`repo_path` holds Windows paths), relocating every target repo into
WSL — and it breaks runcastle's core promise, *point it at your existing repo*,
while doing nothing for macOS users. The environment fix optimizes for one
power user; the product needs a fix that ships inside the burner.

## Decision

**Give the burn agent a working tree on the container's native filesystem and
sync commits back to the mounted worktree automatically.**

1. **New config `burnWorkspace: 'auto' | 'mounted' | 'isolated'`** (default
   `auto`): `isolated` on win32/darwin container hosts, `mounted` on Linux
   (native bind mounts are free there; isolation would only add clone
   overhead). `noSandbox` is always `mounted` — no container, nothing to
   isolate from. This platform branch is a *cost-profile* branch, not a
   behavior branch, so it does not violate ADR-0004's "no OS-conditional
   behavior" rule: the semantics (commits land on the temp branch) are
   identical everywhere.

2. **Isolation is wired in the `onSandboxReady` hook** (pure builder
   `buildIsolatedSetupCommand`), before the agent starts. Its precondition —
   `receive.denyCurrentBranch=ignore`, which lets the container push into the
   workspace's checked-out temp branch (ref-only) — is written **host-side,
   once per burn, before any ticket container starts**
   (`allowPushToCheckedOutBranches`). Two corrections from the first real
   Windows burn are baked in here:
   - The config write was originally step one of the in-sandbox command, but a
     worktree shares its parent repo's `.git/config`, so N concurrent
     sandboxes raced on the shared `config.lock` and killed setup ("could not
     lock config file").
   - The value was originally `updateInstead`, but push-to-checkout resolves
     the branch's checkout via the worktree path registered in the parent
     repo's metadata — the HOST path (`C:\...`), which does not exist inside
     the container — so every push was refused. `ignore` moves the ref only,
     which is all anything downstream reads.

   The hook's steps:
   - `git config --global --add safe.directory '*'` — bind-mounted paths are
     host-UID-owned, and a worktree's gitdir resolves into the parent `.git`
     mount that sandcastle ≤0.12.0 leaves outside its own `safe.directory`
     whitelist, so without this the clone dies with "dubious ownership".
     Container-local config; no shared state.
   - `git clone /home/agent/workspace /home/agent/repo` — one bulk transfer
     across the mount instead of a per-file tax on every later operation.
   - A `post-commit` hook in the clone pushes `HEAD:<tempBranch>` back to the
     workspace on **every commit**, and stops there. Sync requires zero agent
     discipline; if the agent commits, the host sees it. The hook unsets
     `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` first — git exports them to
     hook processes, and they would otherwise point the push at whatever repo
     the committing command was addressing. A failed push sleeps briefly and
     pushes once more; a second failure prints one stderr line
     (`runcastle: commit sync failed (will retry on your next commit); do not
     re-commit`) and exits 0. Git ignores a post-commit hook's status, so the
     commit is never at risk, and the next commit's push of `HEAD` carries
     everything not yet synced.

     The hook does **not** reset the mounted working tree. That reset stats
     every tracked file across the bind mount — 15–90s per commit, ~19–25
     minutes over a feature's 28–37 commits — for a working tree nothing
     reads: commit collection takes the ref, later iterations clone or fetch
     through refs, landing merges the ref, and `BLOCKED.md`/`DIGEST.md` are
     untracked files the agent copies in. The push stays synchronous because
     the hook runs inside a container sandcastle removes seconds after the
     agent exits; a backgrounded push would put the last commit at risk with
     nothing on the host to reconcile against.

     The mounted worktree is therefore always dirty at sandcastle's end-of-run
     check, so sandcastle **preserves** it and never attempts its own
     `worktree remove`. Runcastle removes it host-side with
     `cleanupBurnWorktree` on every exit path of a ticket attempt and of a
     resolver pass — after the `BLOCKED.md`/`DIGEST.md` harvest that reads out
     of the preserved path, and before landing. Removing a worktree never
     touches refs, so the temp branch (and with it attempt chaining and
     conflict resume) survives untouched.
   - The deps install runs **inside the clone**, where pnpm's hardlinks work
     (ADR-0004) and `node_modules` materializes on native FS.

3. **The prompt tells the agent where to work** (`{{WORKSPACE_NOTES}}`
   placeholder): work in `/home/agent/repo`, never edit the mounted mirror,
   and copy a `BLOCKED.md` to the workspace so the orchestrator sees it. The
   failure mode is graceful: an agent that ignores the redirect works in the
   mounted workspace — slow, but exactly as correct as before.

## Consequences

- The burn hot path (install, typecheck, tests) runs at native speed on every
  host OS with no user setup. WSL becomes an optional power-user choice, not a
  prerequisite; the bootstrap wizard and db migration are not built.
- Syncing a commit costs one pack push and nothing else, so ADR-0008's "commit
  every green slice" is cheap to obey — where before, agents visibly fought the
  hook (one wrapped every commit in `timeout`, another re-committed after a
  stall). Two side effects, both wanted: sandcastle's own `worktree remove` no
  longer runs on the happy path, so the Windows `Directory not empty` teardown
  flake does not arise there; and the preserved worktrees that used to
  accumulate under `.sandcastle/worktrees/` are now cleaned up.
- Uncommitted work in the clone is not synced back. That matches the product
  contract — commits are the deliverable (`interpretRunResult`), and the
  transcript, sandcastle log, and captured sessions cover debugging.
- Download-cache mounts (bun/yarn/npm, ADR-0004) are unchanged: tarball reads
  cross the mount in bulk and still save the network fetch. pnpm still
  re-downloads per cold container; if sandcastle grows named-volume mount
  support, a shared store volume is the follow-up ADR-0004 anticipated.
- `receive.denyCurrentBranch=ignore` persists in the target repo's config
  after a burn. It is scoped to receives into that repo (a no-op in normal
  use) and shared safely by concurrent tickets; deliberately not cleaned up,
  since concurrent burns would race an unset.
- Burn concurrency makes non-fast-forward landings the *normal* case (parallel
  tickets fork the same feature tip; the first landing moves it). When no
  checkout holds the feature branch (talk worktree detached or gone),
  `mergeTempBranch` now merges in a disposable worktree under the OS temp dir
  instead of failing with a rejected fast-forward fetch — the failure that
  cost ticket 1 of the first real burn its (perfectly mergeable) commit.
- For WSL users who point runcastle at `/mnt/<drive>` anyway, `openProject`
  emits a `project.slow-path` warning event — that path silently works while
  paying the same translation tax in reverse, which would otherwise read as
  "WSL didn't help".
