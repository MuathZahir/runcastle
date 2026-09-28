# Session process trees die with their session on Windows

## Problem

On Windows, closing a runcastle session, or runcastle itself, leaves processes behind. The ones seen so far are stdio MCP servers (`npx … expect-mcp` trees) that a Claude Code session started. When claude.exe exits first, those trees lose their parent. The current teardown, `taskkill /T`, walks the parent chain, so it can no longer reach them, and they run on for days. Some of them keep the server's :4512 socket open, so after runcastle quits, `bun run install:local` refuses with "runcastle is running on :4512" until someone finds and kills the leftovers by hand. A server crash is worse: nothing tears anything down.

Checking the POSIX side of this turned up a second, worse problem. On Linux, every runcastle terminal dies about 14ms after its first output under Bun (the PTY exits with SIGHUP), so sessions don't work at all. See `prototypes/linux-probe/FINDINGS.md`.

## Approach

**What the user sees.** On Windows, ending a session kills everything that session started, including MCP servers whose claude.exe already exited. Killing the runcastle server any way at all, crash included, kills every process tree it started, so :4512 is free within seconds and `install:local` passes its running check. On Linux (and, assumed, macOS) terminals work. Every platform runs its terminals the same way, and Node 22+ is a stated prerequisite everywhere.

**Windows: one Job Object per spawned host unit** (decisions 1–5). A new platform module in the server wraps kernel32 through `bun:ffi` and gives callers a single operation: *contain this pid*. It creates a Job Object with kill-on-close and the default no-breakaway limits (neither BREAKAWAY_OK nor SILENT_BREAKAWAY_OK), assigns the pid, and returns a **containment** handle the server holds. The handle's teardown terminates and closes the job, and Windows kills every process in it, orphans included. Job membership follows descendants, and a job dies when its last handle closes, so the server's own death (clean or not) takes every job with it. No crash handler is needed.

Where containment happens:
- **Terminals (sidecar).** The sidecar contains the pty-host pid *before* it writes the first `spawn` frame, so the host has not started anything yet and there is no gap. The containment lives with the sidecar session, and its `killTree` tears the job down in place of `taskkill /T`.
- **Direct spawns:** drive hooks, doctor execs, and host burn execs (reported through sandcastle's `onChildSpawn(pid)` into the burn kill-registry). Each is contained synchronously, straight after the spawn returns its pid. No suspended start and no wrapper (decision 4). The containment is stored next to the pid wherever that site already keeps its handle (the kill-registry's host handle, the hook's and doctor's timeout paths), and those kill paths tear down the job instead of calling `taskkill /T`.

**Stopped still means dead.** Tearing down a containment ends the job. The caller still waits for the unit's root process to exit, through the same exit signal it already awaits, before it reports stopped. That keeps the contract from `stopping-a-headless-agent-actually-stops-it`, and the registry's and kill-registry's existing deadlines still bound the wait.

**Failure never blocks a spawn** (decision 5). If creating or assigning the job fails (the FFI load, OpenProcess, AssignProcessToJobObject), contain returns no containment and logs a `[pty-teardown]`-style warning, and the unit falls back to today's `killProcessTree` → `taskkill /T /F`. A unit is never refused because of this feature.

**One platform seam** (decision 6). Off win32 the module is a no-op that never imports `bun:ffi` or touches kernel32, and POSIX teardown (process-group signalling) is unchanged. The kernel32 calls sit behind an injectable interface so the bookkeeping is unit-testable on any OS.

**Terminal backend: the sidecar under Bun on every platform** (decision 8). `selectBackend` routes to the pty-host sidecar whenever the runtime is Bun, not only on win32. The native backend stays for a node runtime (vitest), and `RUNCASTLE_PTY_BACKEND` stays as the override. The sidecar's off-win32 `killTree` already signals the process group node-pty's pid leads, and the Linux probe showed that tears down cleanly. Node 22+ becomes a prerequisite on all platforms: the README prerequisites row and the doctor's Node probe wording stop saying "Windows only". The backend log line's reason must say why Bun gets the sidecar off win32.

## Seams

- **Containment module: `contain(pid)` → containment | none, and `containment.kill()`** — *new*, the one seam for the Windows work. It lets you observe whether a pid got a job, the fallback when setup fails, and that teardown ends everything in the job. Unit-tested with a fake kernel32 (no FFI) on every platform. Integration-tested for real on win32 only.
- **PTY registry: `create` / `killTree` / `killAllTrees`** — *existing*. The Windows integration tests drive it end to end: a real terminal whose program starts a long-lived child and then exits, and after the session ends, no descendant survives.
- **Bun fixture server process** — *existing pattern* (`dev-pane-stop-bun.test.ts` spawns a real `bun` child, because vitest runs under node). A fixture listens on a **random free port, never 4512**, opens a registry terminal as above, and is killed hard. You can see whether the port rebinds within a few seconds and whether any descendant survives.
- **`createPtySession` under Bun** — *existing*. The POSIX lifetime test (skipped on win32): a Bun child opens a terminal that prints, sleeps and prints again. You can see that output keeps arriving after the first line and that the exit is a clean exit, not SIGHUP. It is `prototypes/linux-probe/pty-lifetime.ts` promoted to a test.
- **Burn kill-registry `killAndWait`** — *existing*. The host handle carries its containment. You can see that a host burn's teardown uses the job when there is one and `killProcessTree` when there isn't.

## Out of scope

- A non-inheritable :4512 listen socket, or a launcher that spawns without inheriting handles. Deferred (decision 1; see Later laps).
- Any change to POSIX teardown, including containing processes that deliberately detach (`setsid`) on Linux or macOS. Accepted as the POSIX equivalent of breakaway (decision 7).
- Letting anything break away from a job on Windows. Apps launched by hand from a runcastle terminal close with it (decision 3).
- The review-recorder path sweep from `orphaned-review-recorders-lock-the-review-dir`. It stays as the restart-surviving fallback.
- `install:local`'s running check. It is correct as it is.
- Claude Code self-update leftovers (`claude.exe.old.*`).
- Reopening the Stop/Cancel contract or `killTree()`'s async, per-backend shape. This feature extends them.

## Open questions

- **macOS terminal backend is unverified.** The Linux failure sits in node-pty's reading side, which Linux and macOS share, so macOS is switched to the sidecar too. Running `prototypes/linux-probe/pty-lifetime.ts` on a Mac would confirm it. The switch is safe either way.
- **The real-Claude acceptance checks are manual.** An expect-mcp session end leaves no descendants, and a hard server kill leaves :4512 free with `bun run install:local` passing. Both need a logged-in Claude on Windows, so they are test-drive steps, not automated tests.

## Later laps

- **Non-inheritable listen socket (only on evidence).** Build it only if the lap-1 test drive still finds :4512 bound after a hard server kill with jobs in place. Such a lap starts by proving who holds the socket (`handle64 -a "\Device\Afd"`). Then it clears HANDLE_FLAG_INHERIT on Bun's listen handle via `bun:ffi` if the handle can be reached, or spawns the pty-host through a launcher that doesn't inherit handles.
