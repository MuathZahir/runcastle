# Outcome — Session process trees die with their session on Windows

Put every host process tree the server spawns into a Windows Job Object, and stop children inheriting the server's :4512 socket, so orphaned MCP servers can't keep the port bound or outlive their session.

- Shipped: 2026-09-29
- Laps run: 1

## What shipped

18 commits · 38 files

### Lap 1
- 5 tickets landed: #1 Terminal process trees live in a Windows Job Object that dies with the session or the server; #2 Hooks, doctor execs and host burns are contained too; a drive's setup job lives as long as the drive; #3 Terminals use the pty-host sidecar under Bun on every platform; Node 22+ required everywhere; #5 Win32 Job Object suites fail on Windows: fixture pid regex breaks on ConPTY output; #6 Win32 claude stub never creates a real orphan: libuv's own job kills the MCP stand-in with its parent
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: fdcbac6e432a0a9ba006d0dc3d9c651a6c018e4b
- Landed since: 2
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 32dee9caf2ac5b64722981d7162e9b6c68c6b075
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Terminal process trees live in a Windows Job Object that dies with the session or the server

# Ticket 1 — terminal process trees live in a Windows Job Object

## What was done
- New `packages/server/src/pty/job-object.ts`: `contain(pid)`, `createContainer(k32, log)`, and the `Containment` / `Kernel32` types, with the shape the ticket gave. `contain` is synchronous. It loads `bun:ffi` lazily through `createRequire`, and only under Bun on win32. The load result is cached, failure included. Off win32 or under node it returns null and logs one line. The job gets `LimitFlags = 0x2000` only (no breakaway flags). The process handle stays open until `kill()` finishes. `kill()` runs TerminateJobObject + CloseHandle, then polls `WaitForSingleObject(h, 0)` every 50ms (default timeout 3s, inside the registry's 5s deadline). It is idempotent and never rejects. Every log line starts with `[pty-teardown] job:`.
- Deviation: bun:ffi types are **not** imported, not even `import type`. `apps/web` typechecks server source without bun-types, so the file declares a small local `BunFfi` / `Kernel32Symbols` shape. `Handle` is a plain number.
- `pty-sidecar.ts`: on win32 the host pid is contained right after `spawn()` and before the first `spawn` frame. `killTree()` awaits `containment.kill()` and falls back to `killProcessTree` when there is no containment. The host's `exit` handler calls `void containment?.kill()`. Off win32 nothing changes: `containment` is null and the same `killProcessTree(pid)` runs.
- Tests: `test/job-object.test.ts` uses a fake Kernel32 and runs on every OS (12 tests). `test/job-object-win32.test.ts` is `skipIf(!(win32 && bun))` and runs Bun fixtures `fixtures/job-object-{session-end,crash,terminal}.ts` plus `fixtures/claude-stub.cjs`.
- Deviation: the stub gained a `nest` mode, a parent that runs the `exit` stub and stays alive. With plain `exit` mode the host exits on its own and releases the job, so `killTree` is skipped (`entry.exited`) and a crash test would pass without any crash handling. The session-end test covers both: self-exit (acceptance criterion 4) and nest + `killTree` (criterion 5). The crash test uses nest, so a real orphan is alive at the moment of the hard kill.

## Surprises
- **The win32 suites were SKIPPED in this sandbox** (Linux). They have never run. The review ticket must run them on the Windows host. The real FFI binding (`loadKernel32`) is also unexercised: both `createRequire(...)('bun:ffi')` and the `dlopen` argument types are untested on real Windows.
- I did smoke-test the fixture plumbing on Linux under Bun with `RUNCASTLE_PTY_BACKEND=sidecar`: pid parsing, READY, and the killTree path all ran. The pid lines need ANSI stripping, because node colours numbers on a TTY.
- `dev-pane.test.ts › kills the child process tree so the port-holder is not orphaned` fails in this sandbox with or without my change. I checked by reverting the sidecar edit. It is the native-backend POSIX path. This container has no init to reap zombies, so `kill -0 -pgid` keeps finding defunct group members. The full suite otherwise passed: 4257 tests, 1 failed (that one), 37 skipped. `bun run typecheck` is clean.

## Left undone
- The ticket 2 sites (drive hooks, doctor execs, host burn execs) and the ticket 3 `selectBackend` change were not touched.
- The drive machinery needed no change, because this ticket adds no service, env var, seed or process.

#### 2. Hooks, doctor execs and host burns are contained too; a drive's setup job lives as long as the drive

# Ticket 2 — hooks, doctor execs and host burns are contained too

## What was done
- **Kill registry** (`workflows/kill-registry.ts`): `KillRegistryDeps` has a new required `contain`. `registerHostPid` contains each pid and appends the job to a per-lane `containments` list. A newer exec never kills an older job. `release()` kills every job of the lane without waiting on it. A host kill awaits every job's `kill({ timeoutMs: deadline - now })` and is confirmed only if all of them resolved true. It also runs `killTree(pid)` when the newest pid has no job. With no jobs at all it is exactly today's path. A confirmed kill drops the lane's job list.
- **Drive hooks** (`services/drive-hooks.ts`): `runDriveHook` has new options `containFn` and `holdJob`. The hook is contained straight after spawn. On timeout it is killed through the job, or through `killProcessTree` when there is none. When the hook finishes the job is killed, unless `holdJob` is set; then it comes back as the new optional `DriveHookResult.containment`.
- **git.ts**: `runDriveHookStep` passes `holdJob: phase === 'setup'`. All three drive state variants gained `setupJob?: Containment`. `holdSetupJob()` stores the job on the drive. If the drive was stopped while its setup hook was still running, it kills the job instead. Each stop path (feature, dry run, project) runs `await setupJob?.kill()` right after its teardown step, with or without a teardown command. `__resetTestDriveState` kills it too. Those are the only places `testDriveState` is dropped. Merge stops a drive through these same stop paths.
- **Doctor** (`doctor/system-exec.ts`): `createSystemExec({ containFn })`. Each command is contained after spawn. The job is killed on `close`, on `error`, and on timeout; timeout falls back to `killProcessTree` when there is no job.
- **Deviation:** one new file, `util/contain-host.ts` → `containHostProcess(pid)`, which is `contain(pid)` on win32 and null everywhere else. All three sites use it as their default. Two reasons. First, ticket 1's `contain()` logs an "unavailable … falling back to taskkill" line on *every* call off win32, which would otherwise follow every hook, probe and burn exec on Linux and macOS. Ticket 1's own sidecar guards this the same way. Second, it gives the git.ts drive-flow test one module to `vi.mock`.

## Tests
- Extended `kill-registry.test.ts`, `drive-hooks.test.ts` and `doctor-system-exec.test.ts`.
- Added `drive-setup-job.test.ts`. It runs real feature, dry-run and project drives with real hooks, mocks `containHostProcess`, and checks the order of events: setup job held → teardown's job created and killed → setup job killed. It also covers a drive with no teardown command.
- Added `contain: () => null` to the deps objects in `waive-kill.test.ts` and `stop-before-terminal.test.ts`.
- `bun run typecheck` is clean. The full suite had 4290 passed and 1 failed. The failure is `dev-pane.test.ts › kills the child process tree…`, the same sandbox-only failure ticket 1 reported (no init to reap zombies). It doesn't touch these files.

## Surprises
- Fakes of `Containment.kill` must be idempotent, as the real one is. The timeout path and `finish` both call kill, and a non-idempotent fake that signals the pid throws ESRCH.

## Left undone
- There is no test for "a drive stopped while its setup hook is still running": `holdSetupJob` kills the job in that case, but nothing covers it.
- Every real-Windows behaviour is still unexercised here. It needs a test drive on the Windows host.
- The drive machinery needed no change: this ticket adds no service, env var, seed or process. I didn't run or check the `.runcastle/` scripts.

#### 7. Verify the fixes that landed

Gates verification pass — both fixes held; the Windows Job Object tests now really run and pass on this host

This pass checks the two fixes that landed after the lap-1 review (#4). The review found that the two real-Windows tests, which prove terminal process trees die with their session and with the server, could never pass on Windows. Both test-fixture fixes are now on the branch, and with both in place the tests run and pass on this Windows machine.

**#5 — pid regex vs ConPTY output: held.** `terminal-text.ts` now turns ConPTY's cursor-forward escapes (`ESC[<n>C`) back into spaces and drops OSC title sequences before the fixture looks for pids. `job-object-terminal.ts` uses it, and its regexes also accept `pid\s*`. The diff matches the finding exactly, and a small unit test pins the two outputs the reviewer saw.

**#6 — stub never created a real orphan: held.** In `exit` mode on win32, `claude-stub.cjs` now spawns the fake MCP with `detached: true`, so it leaves libuv's own job but stays in runcastle's no-breakaway job. The POSIX behaviour is unchanged: there, only `setsid` mode detaches. This is the change the reviewer proved in their scratch copy.

**Repro step.** I ran it in a detached scratch worktree at the branch tip (32dee9ca), with the RUNCASTLE_* asset env vars unset: `bunx vitest run packages/server/test/job-object-win32.test.ts` (plus `terminal-text.test.ts`). Result: 4 passed, 0 skipped, in 5.4s. Both tests ran for real: session end (a live orphan dies with its session) and crash (after a hard server kill the port rebinds and nothing survives).

**Gates** (run once each, in the same branch worktree):
- `bun run typecheck`: clean (core, server, web, scripts).
- `bun run test`: 4270 passed, 57 skipped, **3 failed**. The three are `project-drive.test.ts` (cmd leaves `%DB_NAME%` unexpanded), `review-directory-preparation.test.ts` (Windows `\` path separators), and `review-ticket.test.ts` (this review session's own `AGENT_BROWSER_SESSION` env var leaks into the assertion). The branch touches none of these files. I ran just those three files on the `main` checkout and all three fail there too, which matches what review #4 reported. So they are environmental failures on this Windows host inside a review session, not this lap's. The stated "fully green" baseline doesn't hold on this machine.

**Still yours to do** (unchanged from #4): the two real-Claude checks from the brief, on a build from this branch. First, end a session that started an expect-mcp server and confirm no descendants remain. Second, hard-kill the server, then confirm :4512 is free and `bun run install:local` passes.

**Housekeeping:** an empty, locked folder `scratch` is left in this review's directory. Git no longer tracks it (the worktree was pruned), so it is safe to delete once the lock is released.

REVIEW-MODE: gates
REVIEW-VERDICT: verified
REVIEW-REASON: both fixes held; the win32 Job Object suite passes on the Windows host; the 3 test-gate failures also fail on main (environmental)
