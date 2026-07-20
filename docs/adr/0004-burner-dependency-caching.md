# ADR-0004: Burner dependency caching — mount download caches, never the pnpm store

- **Status:** accepted (2026-07-20)
- **Amends:** the cache-mount half of the pre-install work (`selectSandbox`
  mounts, `PM_CACHE_SANDBOX_PATHS`). The `onSandboxReady` install hook and
  `maxIterations` are unchanged.

## Context

The burner pre-installs dependencies in a sandbox-side `onSandboxReady` hook so
agents don't spend iterations bootstrapping `node_modules`. To make the
per-ticket install cheap, a persistent host dir (`~/.runcastle/cache/<pm>`) was
bind-mounted at each package manager's cache path — pnpm included, at
`~/.local/share/pnpm/store`.

Measuring a real burn against a pnpm monorepo (project-helix, docker sandbox on
a Windows host) showed the install taking **751s**, and a subsequent backend
test run inside the same container reporting `real 8m08 / user 4m16 / sys
5m29` — more time in the kernel than in userspace, with all Jest workers
together achieving only ~1.2x single-core throughput. Both are the signature of
a filesystem-bound workload, not a CPU-bound one.

Two distinct causes were identified:

1. **The worktree bind mount.** Sandcastle creates its worktree on the host
   (`.sandcastle/worktrees/<branch>`) and bind-mounts it to
   `/home/agent/workspace`. On a Windows host that crosses a filesystem
   translation layer, and small-file-heavy tools (pnpm, tsc, jest) pay it per
   file. This is an environment problem, addressed by running runcastle from
   inside a Linux filesystem (WSL2 on Windows) — no code change; see
   Consequences.
2. **The pnpm store mount, which is a design error on every OS.** pnpm's store
   is not a download cache. It is a content-addressed store whose purpose is to
   **hardlink** packages into `node_modules`. A bind mount is always a different
   filesystem from the container's overlayfs — on Linux and macOS hosts too, not
   just Windows — and hardlinks cannot cross filesystems. pnpm therefore falls
   back to *copying* every file of every package out of the mounted store. The
   mount converts pnpm's fastest path into its slowest one and buys only the
   avoided download.

npm's `~/.npm` and yarn classic's `~/.cache/yarn` hold tarballs that are always
extracted into `node_modules`, never linked, so a cross-filesystem mount costs
them nothing and saves the fetch. bun's `~/.bun/install/cache` may lose a link
fallback but still saves fetch-and-extract.

## Decision

1. **`PM_CACHE_SANDBOX_PATHS` becomes a partial map** covering bun, yarn and npm
   only. `cacheMountFor` returns `CacheMount | undefined`, and the burner pushes
   a mount only when one is returned — so a pnpm repo gets the install hook with
   no cache mount, letting pnpm build its store inside the container where
   linking works.
2. **The rationale lives at the constant**, not in commit history: the next
   contributor's instinct will be "pnpm is missing, add it".
3. **No OS-conditional behavior.** The decision is identical on Linux, macOS and
   Windows, because the hardlink constraint is identical. runcastle stays
   OS-agnostic; nothing here keys on `process.platform`.

## Consequences

- pnpm repos pay a real download on each ticket's cold container, but their
  install links rather than copies, and their `node_modules` materializes on the
  container's native filesystem.
- `burnCacheDir` (core `paths.ts`) is retained and still used by bun/yarn/npm.
  `~/.runcastle/cache/pnpm` is no longer created; an existing one from before
  this ADR is inert and safe to delete.
- The larger win is environmental and out of scope for the code: on Windows,
  run runcastle and clone target repos **inside the WSL2 distro's own
  filesystem**, not under `/mnt/c`. All platform-specific branches in the
  codebase are `process.platform`-guarded, so under WSL runcastle simply takes
  its Linux paths — including node-pty's vendored linux prebuild bridge, which
  the root `postinstall` applies (verify with `runcastle doctor` after a fresh
  `bun install`).
- If a future host makes a mounted store viable (same-filesystem overlay, or a
  Docker named volume rather than a bind mount), re-adding pnpm is a one-line
  change to the map — but a *named volume* is the correct mechanism there, not a
  bind mount.
