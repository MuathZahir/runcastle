# Persistent burn cache volume

## Problem

Every burn starts stone cold. The container is rebuilt per iteration (ADR-0008), the repo is cloned fresh, `pnpm install` runs for 75–240 s, and the agent's first typecheck and first test run pay the full cold price because `.tsbuildinfo`, the jest transform cache, the vitest results and the turbo cache all died with the previous container. A raw Claude Code session pays that once; runcastle pays it on every iteration of every ticket. The operator's decision (audit B2) is that the agent's verification habit is not to be budgeted or fought — so the cost has to be made cheap instead. ADR-0004 tried the obvious fix (bind-mount the pnpm store) and measured it as *slower* (751 s: pnpm cannot hardlink across a bind mount), and named the correct mechanism for later: a Docker named volume.

## Approach

From the operator's perspective: nothing changes in how they work. Burns on Docker or Podman simply get fast after the first one — setup drops to seconds and the agent's first typecheck and test run are warm. A new button on the AFK card shows the cache's size and clears it; a config knob (`burnCache: 'volume' | 'off'`, default `'volume'`, config-only like `burnWorkspace`) turns the whole thing off and restores today's behaviour byte for byte. `noSandbox` and any provider other than docker/podman behave as `'off'` automatically.

The shape (decisions 2–10):

**Not four redirected caches — persistent working folders.** Ideation established that the brief's "point each tool's cache at the volume" design is not feasible: pnpm and bun hardlink from their store only when `node_modules` shares a filesystem with it, and tsc and vitest have no env or CLI lever at all — their caches live inside the checkout and are keyed to a stable path. So the volume holds whole checkouts. One Docker named volume per project (`runcastle-<projectId>`; the project id is a valid volume name as-is) is mounted at a fixed path in every burn container. On it live:

- `slots/<n>/repo` — one persistent checkout per burn-concurrency slot, `n` in `1..burnConcurrency`, created lazily. This path replaces `/home/agent/repo` as the isolated hot path of ADR-0005, and it is the same path on every run, so relative paths inside `.tsbuildinfo`, jest's `rootDir`-keyed cache and Node's compile cache all stay valid.
- `store/<pm>` — the pnpm store, bun cache, npm cache, yarn global folder. Same filesystem as the slots, so hardlinks work and concurrent containers share downloads. The container is told where they are through the sandbox provider's `env` option (`npm_config_store_dir` + `pnpm_config_store_dir`, `BUN_INSTALL_CACHE_DIR`, `npm_config_cache`, `YARN_GLOBAL_FOLDER`), plus `TMPDIR` and `NODE_COMPILE_CACHE` on the volume so jest's default cache dir and Node's compile cache follow. With the cache on, ADR-0004's download-cache bind mounts are not attached; with it off they stay exactly as they are.
- `slots/<n>/.runcastle-stamp` — the toolchain the slot was last used with (sandbox image id, Node version, package manager name + major).

**Mounting it.** Sandcastle 0.12.0 refuses any mount whose `hostPath` is not an existing host directory, and its Docker options have no raw-argument escape hatch — but the `-v` flag it ultimately emits accepts `name:/path`. A bun `patchedDependencies` patch (precedent: `node-pty`) adds a way for a mount entry to name a volume and skips host-path resolution for it; the `0.12.0` pin stays exact. The upstream PR is a parked draft feature.

**Volume lifecycle (host side).** Before a burn's first container, runcastle ensures the volume exists: `docker|podman volume create`, then — because the burn container always runs as UID 1000 and a fresh volume is root-owned — a one-shot `run --rm --user root` of the sandbox image that chowns the mount point. This is idempotent and cheap on an existing volume. Clearing is `volume rm`, refused with a reason while any burn holds a slot. Size comes from the engine's disk-usage report.

**Slot lifecycle (decision 4).** A ticket claims the lowest free slot before its first iteration, holds it across every iteration, and releases it in the same `finally` that emits `ticket.timing` — every exit path frees it. The lock is an in-memory set in the burner: the server is the only spawner, and a restart kills the burns, so nothing about ownership is ever persisted and no "stuck slot" state can exist. Reviews run on the host and never take a slot. A `burnConcurrency` decrease leaves higher slots unused; an increase creates them lazily.

**Slot sync (the setup step, replacing today's clone).** A slot is never trusted clean, only made clean. Per iteration, inside the container's `onSandboxReady` hook, in order: remove stale `.git/*.lock` files; if the slot has no valid git dir, delete it and clone from the mounted workspace; otherwise `git fetch` the temp branch from the mounted workspace and `reset --hard` to it; `git clean -fd` (untracked but *not* ignored — `node_modules`, `dist`, `.turbo`, `node_modules/.vite` survive); compare the stamp and, on mismatch, remove `node_modules` and the ignored build outputs, then rewrite the stamp; install the post-commit push-back hook exactly as today; run the project's install command (already `--frozen-lockfile`; near no-op on a warm slot; lockfile changes are the package manager's own reconciliation — decision 5, no lockfile-hash wipe). The attachments copy, corepack shim and `core.hooksPath` re-pin carry over unchanged from the current isolated setup. The burn guard, codex-auth copy and prompt path all point at the slot path instead of `/home/agent/repo`.

**Telemetry (decision 9).** The setup hook is timed. `ticket.timing.byCategory` gains `setup`; `burn.setup` carries `slot`, `cold | warm` (cold = slot was created or wiped this iteration), and the sync and install durations.

**Proof (decision 7).** A repo script, `burn-cache:probe <repoPath>`, drives the real burner path — claim slot, ensure volume, run a container through sync + install + the project's verify commands — twice in a row, and prints a per-cache table: install cold vs warm; `.tsbuildinfo` files present after run 1 and hit on run 2 (typecheck time drop, files unchanged); jest / vitest / turbo cache directories populated and hit; pnpm/bun store entries hardlinked (link count > 1) rather than copied. It exits non-zero on any expected miss. Fixtures under the repo's test assets: a pnpm + `tsc -b` + vitest + turbo monorepo, and a small jest repo. The review ticket for this feature runs the probe on both and puts the table in its digest.

## Seams

1. **Sandbox options builder** (existing — the single function that turns config into the provider's `{ imageName, mounts, cpus }`): now also yields the volume mount entry and the `env` map when the cache is on, and yields exactly today's bind mounts when it is off. Pure; observe the returned object.
2. **Setup command builder** (existing — the function that renders the isolated-workspace setup script): renders the slot-sync script for a given slot, temp branch, package manager and install command. Pure string; observe the ordering of steps, the lock removal, the clean flags, the stamp check.
3. **Slot allocator** (new, in the burner): `claim() → n`, `release(n)`, `held(): n[]`; observe exhaustion at `burnConcurrency`, lowest-free ordering, release on every exit path via the burner's `finally`.
4. **Volume manager** (new, host side): `ensure(projectId)`, `remove(projectId)`, `size(projectId)`, refusing `remove` while slots are held; the engine CLI is injected so tests observe the exact commands issued.
5. **Config** (existing — `RuncastleConfig` + settings descriptors): `burnCache` parses, defaults to `'volume'`, resolves to `'off'` for non-docker/podman sandboxes.
6. **tRPC `system` router** (existing): `burnCache.size` query and `burnCache.clear` mutation; the AFK card renders them.
7. **`ticket.timing` / `burn.setup` events** (existing event shapes, extended): `setup` category present, `burn.setup` payload carries slot and cold/warm.
8. **Sandcastle patch** (new file under `patches/`): a mount entry naming a volume reaches `docker run` as `-v name:/path` without host-path validation; a plain host path behaves exactly as before.
9. **Probe script** (new — the end-to-end seam): its table and exit code are the acceptance evidence for the feature as a whole.

## Out of scope

- Agent behaviour, prompts, verification rules, budgets or any commentary in the agent's context (audit B2).
- The known-baseline mechanism (C1) and the post-commit hook feature (B1).
- The upstream sandcastle PR (parked draft `upstream-named-volume-mounts-to-sandcastle`).
- Vercel/Daytona providers: they get `'off'` behaviour; no attempt to emulate a volume there.
- Automatic pruning or size limits on the volume — size is shown, clearing is manual.
- A settings-UI control for `burnCache` (config-only, like `burnWorkspace`).

## Open questions

- Rootless Podman maps UID 1000 differently from Docker; the one-shot chown runs through the same provider so the mapping is consistent. The probe on a Podman host is the check; if it fails, the fix is confined to the volume manager.
- Whether `TMPDIR` on the volume changes any tool's behaviour beyond jest and Node (e.g. tools writing large temp files). If a fixture shows a problem, scope it down to a jest-specific `cacheDirectory` written to the slot's `$HOME` config instead.
