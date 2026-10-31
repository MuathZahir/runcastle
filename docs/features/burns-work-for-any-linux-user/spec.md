# Burns work for any Linux user

## Problem

Runcastle is moving onto a VPS so work continues with the owner's PC off. The VPS user `muath` has UID 1001, because `ubuntu` holds 1000. The first trial burn there failed after 11 seconds. The agent could not write to its cache volume, the ticket error showed a truncated `mkdir … burn-guard.sh` command instead of the `Permission denied` further down the log, and the doctor had passed.

Anyone whose UID is not 1000 hits this, on Linux and on macOS. Windows does not, because it has no UID and falls back to 1000, which is the value hardcoded for the volume.

## Approach

**For the user.** The first burn works on any normal Linux account, with no hand-fixing. If the cache volume is wrong, runcastle repairs it by itself and says so on the timeline. If a burn still fails in setup, the first line of the ticket error is the real cause. The doctor notices an image built for another UID, a cache volume the burn cannot write to, duplicate token lines, root, and rootless Docker. `runcastle doctor` run by hand also tests that the token really authenticates.

**The burn user.** A new pure resolver answers "who do burns run as" (decisions 1, 2):

```ts
type BurnUser = { uid: number; gid: number; gidSource: 'account' | 'process' | 'default' }
resolveBurnUser(engine: 'docker' | 'podman', host: HostIdentity): BurnUser
```

For Docker it returns the host UID and the account's primary GID, from `id -g <user>`, falling back to `process.getgid()`. With no `getuid` (Windows) it returns `1000:1000`. For Podman it always returns `1000:1000`. `HostIdentity` is injected so every branch is testable on Windows.

Four callers use it. `stockBuildArgs` bakes it into the image. `buildSandboxOptions` passes it to `docker()` as `containerUid` and `containerGid`, so sandcastle's own `process.getuid()` default is no longer what decides; podman's options are untouched. The volume chown replaces `CONTAINER_USER`. The doctor compares against it.

**The cache volume** (decisions 3, 4, 10). `ensureBurnCacheVolume` takes the burn user and, for Docker, does this at the start of each run:

1. Inspect the label, as now. `missing` or `stale` goes to create.
2. For `current`, run the new access check: a one-shot `run --rm --user <burn user> --entrypoint sh` over the volume, testing write access on the mount point and its direct children, and printing the first unwritable path and its owner.
3. A clear "not writable" drops the volume and recreates it, and emits a timeline event with the owner found and the user expected. Any other outcome (timeout, engine error, unclear output) proceeds without deleting.

Creation becomes `volume create`, then one root one-shot that chowns the mount to the burn user and leaves a marker file, so the volume is never empty and Docker's copy-up from the image cannot reset its owner. The label comment changes to say it vouches for the layout only. `BURN_CACHE_VOLUME_VERSION` stays 1. Podman keeps today's create-and-chown-once path, at 1000:1000, with no access check.

The result of the check is one exported function, `checkBurnCacheAccess`, with three answers (`writable`, `unwritable` with the path and owner, `unknown`). The burner and the doctor both call it.

**The failure message** (decision 5). `errorHeadline` learns the `Command failed (exit N): <command>` shape: it skips that line and takes the last line in the output that names a failure, otherwise the last line of output. A new step at the point the burner records a setup failure rewrites the stored error as that cause, then a blank line, then the original text. The web already renders `ticket.error.split('\n')[0]`, so no screen changes. A `Permission denied` naming the cache mount becomes a plain sentence with the volume and burn user, and classifies as run-fatal. Care needed: the existing `ACCOUNT_PERMISSION_DENIED` pattern reads `permission denied` near a credential, so a cache failure must not be classified as an auth problem.

**The image** (decision 6). `inspectBuiltImage` also reads `.Config.User`. `imageFreshness` gains the `user` reason on a UID mismatch, which makes the doctor's image row stale and arms the existing Rebuild, chain included. A name or empty `USER` is not judged. A GID-only mismatch adds a note to the row's detail, and so does a burn user whose `gidSource` is not `account`. A run-level check before the first ticket halts the run on a UID mismatch, wording the fix for a managed or a custom image, and sandcastle's `UID mismatch` text is translated if it is still reached.

**The doctor** (decisions 7, 8, 9, 12). New or changed rows:

- **Cache volume:** in the app, the project's volume, only when a project is passed to the query. In the CLI run by hand, every volume from `volume ls --filter label=io.runcastle.burn-cache`; never in the `--gate` boot check, which must not start a container per volume. Skipped when the runtime is down, the cache is off, the engine is podman or the image is absent. A bad volume is `stale` at `info`.
- **Image:** the UID, GID and fallback handling above.
- **AFK token:** duplicate key lines are reported, offline, in both surfaces. An injected `checkToken` runs only in `runCli` in `diagnostic` mode. It runs one `claude -p` turn with the token in the environment and reports `rejected`, `ok` or `unreachable`.
- **Burn user:** an error row when the host runs as UID 0. A Claude Code burn also stops on this before any container starts.
- **Container runtime:** reads rootless and `userns` from `docker info` security options and reports an error row saying burns are not supported there.

**Getting it onto the VPS** (decision 14). The lead pushes the branch. The human runs, in a clone on the VPS with runcastle stopped:

```sh
git fetch origin
bun install
bun run install:local feature/burns-work-for-any-linux-user
runcastle --version   # shows -local.<sha>
```

Then the drive, in order:

1. `runcastle doctor`, expecting the token check, plus the GID note if the image was built under `sg docker`.
2. Stop runcastle and remove the hand-fixed volume with `docker volume rm runcastle-<projectId>`, then burn. A fresh volume is created and the burn works.
3. Set the volume's owner back to `0:0` with a root one-shot, then burn again. The timeline shows the repair and what it found.

## Seams

- **`resolveBurnUser` (new):** pure. Given injected host identities, observe the UID, GID and `gidSource` for each engine, including `sg docker`, a failed lookup, and Windows.
- **`ensureBurnCacheVolume` (existing), through its injected `ExecFn`:** observe the exact engine argv for create, check, repair and the "unknown changes nothing" path. Existing tests in the burn cache suite pin this seam.
- **`checkBurnCacheAccess` (new), through `ExecFn`:** observe the three answers from canned output.
- **`errorHeadline` and the setup-failure rewrite (existing and new):** pure. A real captured message goes in; the first line comes out.
- **`classifyTicketRunError` (existing):** a cache `Permission denied` is run-fatal and not mistaken for auth.
- **`imageFreshness` and `inspectBuiltImage` (existing):** the UID reason, name and empty `USER`, and a GID-only mismatch staying fresh.
- **`runDoctor` (existing), through `ExecFn` and injected `checkToken`:** each new row.
- **`buildSandboxOptions` (existing):** the UID and GID reach the docker options and not podman's.
- **Real containers (no automated seam):** a scratch volume with a fake UID of 1001, WSL for the Linux-only pieces, and the human's VPS burn.

## Out of scope

- Moving the cache design itself: ADR-0004, ADR-0005 and ADR-0011 stand. The sandcastle patch is not extended.
- A settings field for the cache, or any CLI for starting burns.
- Auto-building a missing image (`burns-build-their-own-image`) and the one-line install.
- Supporting rootless Docker or `userns-remap`, which the doctor names but does not support.
- Running burns as root.
- Rootful podman, or an access check under podman.
- Several Linux users sharing one Docker engine.
- A live token check in the app, or for Codex.
- Any screen change.

## Open questions

- **The `0:0`.** Its original cause is still not proven. The code has several routes to it (decisions.md, 3), and the plan closes them without knowing which one happened. The timeline's `burn.cache_repaired` event gives the evidence if it recurs.
- **A warm cache as a non-1000 user.** The VPS burns both started cold in a repo with no dependencies, so reusing a populated cache is untested at UID 1001. The cold-to-warm path passed at UID 1000 on Windows.

Proved on the VPS, on real Ubuntu as UID 1001 with build `1.6.0-local.00eda3fd`:

- `runcastle doctor` passes, under `sg docker` too.
- A burn on a fresh volume passed: runcastle created it as `1001:1001` with no hand fix.
- A burn on a volume forced to `0:0` passed: runcastle replaced the volume, and the timeline named the owner it found.

Settled while building:

- **`os.userInfo()` on Bun** returns the process's group, so `sg docker` moves it. Measured as a UID-1001 user in WSL. `id -g <user>` does not move.
- **Docker's copy-up** is real: an empty chowned volume mounted over a root-owned image folder goes to `0:0`, and the marker file stops it. Measured on a real engine. The stock image has none of the mounted toolchain folders, so this route needs a project image.
- **The existing token verifier** (`createCredentialVerifier`) only runs `--version`, so it never tests the token. The app keeps it as it is, and the live check is a separate step in `runcastle doctor`.
