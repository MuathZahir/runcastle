# POSIX verification — breakage catalogue

Asset for [#21](https://github.com/MuathZahir/runcastle/issues/21) (map [#12](https://github.com/MuathZahir/runcastle/issues/12)).
Dated 2026-07-17, against `main` @ `2571888`.

Every claim below is tagged **[VERIFIED]** (observed by running it) or **[STATIC]**
(read from the source, not executed). Do not treat the two as equal when planning.

## Environments

| Env | What it is | Why |
|-----|-----------|-----|
| **WSL2 Ubuntu 24.04** (x86_64, kernel 6.6.87.2) | the developer's own box, no passwordless sudo | "does it run on Linux at all" |
| **`ubuntu:24.04` container** (Docker Desktop) | clean root POSIX env, provisioned from scratch | "what does a *fresh machine* need" |
| **macOS** | **not available — nothing was run** | see [Gap: macOS](#gap-macos) |

Toolchains: bun 1.3.14 (and 1.3.4 as a control), node 20.20.0 (WSL) / 22.23.1 (container),
`claude` 2.1.212, Docker 28.5.2.

## Headline

Runcastle's **core runs on Linux**. The server boots, `bun:sqlite` works, the embedded
terminal spawns a real PTY, and a noSandbox burn lands a commit. The port is not blocked
by the application — it is blocked by **install-time and entry-point** problems.

Three things bite, in descending order:

1. **`node-pty` has no Linux prebuild** → a stranger cannot `bun install` without a C++ toolchain.
2. **`bun run dev` starts only the server on Linux** → the documented entry point half-works.
3. **`wt.exe` in the test-drive path** → silently does nothing on POSIX.

---

## 1. `node-pty` has no Linux prebuild — `bun install` fails on a stock machine [VERIFIED]

`node-pty@1.1.0` ships prebuilt binaries for **`darwin-arm64`, `darwin-x64`,
`win32-arm64`, `win32-x64` — and no `linux-*` at all**:

```
node_modules/.bun/node-pty@1.1.0/node_modules/node-pty/prebuilds/
  darwin-arm64  darwin-x64  win32-arm64  win32-x64
```

Its install hook is `node scripts/prebuild.js || node-gyp rebuild` — `prebuild.js` exits 1
when `prebuilds/${process.platform}-${process.arch}` is absent, so **Linux always falls
through to compiling from source.** macOS and Windows never compile.

On stock WSL Ubuntu 24.04 (no `build-essential`, node 20) `bun install` **fails outright**:

```
gyp ERR! configure error
gyp ERR! stack TypeError: webidl.util.markAsUncloneable is not a function
     ...undici/lib/web/cache/cachestorage.js:20:17
error: install script from "node-pty" exited with 1
```

Two independent causes stack up:

- **No compiler.** Stock Ubuntu 24.04 has no `gcc`/`g++`/`make` (`ld` only).
- **node 20 + `node-gyp@latest`.** Bun invokes `bunx node-gyp@latest`; node-gyp 13's
  bundled undici calls `webidl.util.markAsUncloneable`, absent on node 20.20.0. This
  fails *before* compilation is even attempted — so **a toolchain alone is not enough**;
  node must be ≥22.

With `build-essential` + node 22 in a clean container, it builds cleanly: 392 packages,
`build/Release/pty.node` produced. **So this is an environment/packaging problem, not a
code defect.**

### Two consequences worth flagging

- **The failure is not contained.** node-pty's install hook failing aborts the *whole*
  `bun install` — hono, drizzle, and @trpc never land. Runcastle doesn't degrade to
  "everything but the terminal"; it installs nothing.
- **The retry lies.** A second `bun install` after the failure exits **0** with
  `Checked 204 installs across 321 packages (no changes)` while the tree is still
  incomplete. A user following "just run it again" gets a green checkmark and a broken
  tree. Any doctor/first-run check must verify `pty.node` exists, not trust the exit code.

This directly threatens the map's standing preference (*streamline setup as much as
possible*): as it stands, Linux install = "install a C++ toolchain and node ≥22 first".
→ ticketed separately.

### Resolution — the prebuild bridge (issue #39) [FIXED for linux-x64]

`patches/node-pty@1.1.0.patch` + `patchedDependencies` (root `package.json`) vendor a
linux-x64 `pty.node` into `prebuilds/linux-x64/`. Bun applies the patch *before*
node-pty's install hook, so `prebuild.js` finds the dir, exits 0, and **no compile is
attempted** — `bun install` succeeds on stock glibc Linux with no compiler and node 20.
(Linux needs only `pty.node`; `spawn-helper` is macOS-only.) See `patches/README.md`.

- **Completeness check.** `checkPtyInstall()` / `assertPtyInstalled()`
  (`packages/server/src/pty/install-check.ts`) verify `pty.node` exists **on disk** —
  catching the "retry lies" case above — and return remediation text for doctor / first-run.
- **musl / Alpine fallback.** A glibc prebuild will not load under musl, so the bridge
  does not help there. Install a toolchain and rebuild from source:
  `apk add build-base python3` then `bun install`. `checkPtyInstall()` detects musl
  (via `process.report`'s absent `glibcVersionRuntime`, or `/etc/alpine-release`) and
  points at exactly this.
- **linux-arm64** is not yet vendored (no arm64 build host) — it still compiles from
  source there; drop an arm64 `pty.node` in via the regen script to close it.
- **Retire at node-pty 1.2**, which is expected to ship `linux-*` prebuilds: delete the
  patch + `patchedDependencies` entry, confirm the binary still lands on stock glibc, and
  re-verify the Windows sidecar path.

## 2. `bun run dev` starts only the server on Linux [VERIFIED]

The documented entry point is `bun run dev` →
`bun run --filter '@runcastle/server' --filter '@runcastle/web' dev`.

On Linux **only `@runcastle/server` ever starts. Web never does** — nothing listens on
4513 (`curl` → connection refused) after 30s.

| Command | Linux | Windows |
|---|---|---|
| `bun run dev` (both filters) | server only, **no web** | **both start** |
| `--filter '@runcastle/web' dev` alone | vite starts, HTTP 200 | — |
| reversed filter order | server only | — |
| `--filter '*' dev` | server only | — |

Controlled for the obvious confounders:

- **Not the quoting.** The single quotes around the filter args are stripped by `sh`;
  unquoted behaves identically.
- **Not a bun version regression.** Windows runs bun **1.3.4**, Linux got **1.3.14**, so
  I re-ran Linux under a pinned **1.3.4** — *identical failure*. Both Linux versions fail;
  Windows 1.3.4 succeeds. The difference is the platform.
- **Not ordering.** Server wins regardless of filter order, and even under `--filter '*'`.

Consistent with bun running filtered scripts in dependency order on POSIX and blocking on
`@runcastle/server`'s `bun --hot`, which never exits. Web is queued behind a process that
never returns. **Vite itself is fine** — standalone it serves HTTP 200 in 136ms.

This is a bug to fix rather than a decision to make, so it isn't ticketed; but whoever owns
the install/run story ([#20](https://github.com/MuathZahir/runcastle/issues/20)) should know
the headline command in a README would not work on Linux today.

## 3. `wt.exe` / `cmd.exe` call sites [STATIC]

Two spawn sites remain, **neither guarded by a `process.platform` check**:

- **`packages/server/src/services/git.ts:579`** — the test-drive dev terminal:
  `spawn('wt.exe', ['-w','0','nt','-d',repoPath,'cmd','/k',devCommand], {detached:true, ...})`.
  **This is the default path**, not window-mode: `git.ts:570` calls it from `testDrive`
  whenever `project.devCommand` is set, regardless of `launchMode`. Worse, `git.ts:584`
  is `child.on('error', () => {})` — **ENOENT is swallowed**, so on POSIX the dev server
  silently never starts and nothing is reported. Subject of
  [#22](https://github.com/MuathZahir/runcastle/issues/22).
- **`packages/server/src/launcher/launcher.ts:689`** — `cmd.exe /s /c` window-mode spawn.
  Guarded by `launchMode === 'window'` (`launcher.ts:399`); fails loudly as
  `session.spawn_failed`.

Supporting Windows-only string builders (compiled in but only *rendered* in window mode):
`launcher.ts:179-180` (`wt.exe …` command string), `launcher.ts:173-176`
(`set VAR=x&& ` — cmd-only; POSIX wants `export VAR=x;`), `launcher.ts:122-130`
(`q()`/`quoteArg()`, Windows quoting).

**Docs and code disagree.** `CONTEXT.md:51` states the legacy `wt.exe` window mode is
*removed*. It is not: the config enum (`packages/core/src/config.ts:29`
`launchMode: z.enum(['embedded','window'])`), the env override
(`packages/core/src/config-load.ts:36` `RUNCASTLE_LAUNCH_MODE`), the builder, the spawn
site, and the tests all remain. The map's decision to **delete, not port** `window` mode
is therefore still unexecuted work.

---

## What already works on Linux [VERIFIED]

Nothing below needed any change — recorded so the port isn't re-litigated.

- **Server boots.** `bun src/index.ts` → `runcastle server listening on http://localhost:4512`.
  tRPC is mounted and answering (a bogus procedure returns a well-formed tRPC 404).
- **`bun:sqlite` + drizzle.** `~/.runcastle/` scaffolded on first boot — `runcastle.db`,
  WAL + shm, `logs/`, `sessions/`, `worktrees/`. No native-module issue; `bun:sqlite` is builtin.
- **Typecheck.** `@runcastle/core` and `@runcastle/server` both exit 0.
- **Test suite: 257/258 pass.** One failure, POSIX-only, and it's a *test* bug (below).
- **PTY backend selection.** Logs `[pty] backend=native (Bun off-win32)` — POSIX correctly
  takes the native path; the Bun+win32 ConPTY sidecar is never involved.
- **Embedded terminal.** A real PTY spawns, echoes, and exits:
  `PID: 4743 OUTPUT: "PTY_ALIVE_42"`. All **11** `pty.test.ts` tests **ran** (confirmed not
  skipped by `describe.skipIf(!AVAILABLE)`) and passed — including write→echo input and
  `kill()`, on *both* the native and sidecar backends.
- **noSandbox burn, end to end.** Real `@ai-hero/sandcastle` run via the burner's own
  `buildBurnAgent`: branch `feature/posix-burn` created off `main`, agent ran, commit
  `67ca0c5 ticket(1): add hello` landed, `hello.txt` = `POSIX_BURN_OK`. The win32
  model-dequote workaround (`ticket-burner.ts:572`) correctly **does not** engage on Linux.
- **`claude` CLI.** Installs via `curl -fsSL https://claude.ai/install.sh | bash` and was
  **already authenticated** in WSL without a separate login (headless `claude -p` → `AUTH_OK`).
  Note this box shares a Max subscription; a genuinely fresh machine will still need a login.
- **Docker** reachable from WSL (28.5.2, Docker Desktop backend).

## Smaller breakages

- **`launch-artifacts.test.ts:308` — hardcoded `\` separator** [VERIFIED, test-only]:
  ``expect(out.systemPromptPath).toBe(`${sessionDir(sess.id)}\\system-prompt.md`)``
  → expected `…sess_test_…\system-prompt.md`, received `…/system-prompt.md`. **The
  production path is correct**; only the assertion is Windows-shaped. This is the sole
  test failure on Linux.
- **Tests set only `USERPROFILE`, never `HOME`** [STATIC]: `homedir()` reads `HOME` on
  POSIX, so these do not redirect the data dir and will read/write the developer's **real
  `~/.runcastle`**: `test/git.test.ts:136,190,246,435`, `test/runner.test.ts:118`,
  `test/reconcile-runs.test.ts:142`. They passed here, which is exactly the danger — they
  passed *against live data*. (`scripts/smoke.ts:50` sets both and is correct.)
- **`scripts/smoke.ts:38` — hardcoded absolute path** [STATIC]:
  `C:/Users/user/AppData/Local/Temp/claude/…/scratchpad`, with a machine-specific UUID.
  Breaks on POSIX *and* on any other Windows machine. Should derive from `os.tmpdir()`.
- **`git.ts:65-73` `canon()` lowercases paths** [STATIC]: `abs.replace(/\\/g,'/').toLowerCase()`.
  On a **case-sensitive filesystem** `/home/u/Repo` and `/home/u/repo` are different
  directories that this folds into one key — used for worktree-registry membership
  (`:193`), worktree set building (`:232`), main-repo exclusion (`:247,249`). Also `\` is a
  **legal filename character** on POSIX, so the replace can corrupt exotic paths. Not
  observed failing; latent.
- **`realpathSync.native` + macOS symlinks** [STATIC]: `git.ts:68` — on macOS `/tmp` →
  `/private/tmp` and `/var` → `/private/var`. `canon()` falls back to the non-realpath'd
  form for paths that don't exist (`:69-71`), so comparing an existing path against a
  not-yet-created one can mismatch on macOS in a way it never does on Windows.

## Clean — no action needed [STATIC]

Verified as non-issues, to stop them being re-investigated: `node:path` discipline is
honored throughout `src/`; every existing `process.platform` branch is *correct*
(`pty.ts:126`, `pty-sidecar.ts:33`, `launcher.ts:193`, `ticket-burner.ts:572`) — the
problem is the two spawn sites with *no* check; `resolveClaudeExecutable`
(`launcher.ts:190-218`) already handles POSIX PATH/ext; no `fs.watch`/chokidar (UI polls);
no `taskkill`; signals (`SIGINT`/`SIGTERM`) and port binding are portable; the CP1252
charset workarounds (`index.ts:37-45`, `routes/hooks.ts:30`) are correctness fixes, keep
them; sandcastle's Windows-specific workarounds are inert on POSIX.

## Gap: macOS

**No macOS machine was available; nothing was run.** Everything above is Linux.

The strongest *inference* — not verification — is that **macOS is likely the easiest
target**: node-pty ships `darwin-arm64` and `darwin-x64` prebuilds, so breakage #1
(the biggest one) should not exist there at all, and it is a POSIX platform taking the
same native PTY path Linux passed. The macOS-specific unknowns are the `realpathSync`
symlink behavior above, and Gatekeeper/quarantine on any distributed binary.

This must be confirmed on real hardware before "macOS at publish" can be claimed.

## Reproducing

The clean-room container run is the useful one:

```bash
docker run --rm -v /path/to/runcastle:/src:ro ubuntu:24.04 bash -c '
  apt-get update -qq && apt-get install -y -qq curl unzip git build-essential python3 ca-certificates
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y -qq nodejs
  curl -fsSL https://bun.sh/install | bash && export PATH="$HOME/.bun/bin:$PATH"
  git config --global --add safe.directory "*"
  git clone -q /src /app && cd /app && bun install && bunx vitest run
'
```

Drop `build-essential` or use node 20 to reproduce breakage #1.
