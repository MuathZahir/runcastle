# Decisions — Session process trees die with their session on Windows

## 1. Lap 1 is Job Objects only; the non-inheritable socket is deferred
**Decision:** Lap 1 puts every host process tree the server spawns into a Windows Job Object with kill-on-close, at every spawn site in scope, and delivers both acceptance tests. The second layer, making the :4512 listen socket non-inheritable (or spawning through a launcher that doesn't inherit handles), is parked in the spec's `## Later laps`. It is built only if the lap-1 test drive still finds :4512 bound after a hard server kill. If so, that lap starts by proving who holds the socket with `handle64 -a "\Device\Afd"`.
**Why:** If every descendant dies with its job, nothing is left to hold the port, so jobs alone should meet both acceptance criteria. The inheritance theory is still unproven, and reaching Bun's listen handle is speculative work. Building it only on evidence keeps lap 1 small and certain.

## 2. The server owns one job per spawned host tree
**Decision:** The server (Bun, via `bun:ffi` into kernel32) creates and holds one kill-on-close Job Object for each host tree it spawns: each terminal (its pty-host), each host burn exec, each drive hook, each doctor exec. Ending that unit closes its job handle, and Windows kills everything in the job, including descendants whose parent has already exited. When the server process dies, Windows closes all of its handles, so every job dies with it. No separate crash handler and no server-wide job are needed.
**Why:** Job membership follows descendants even after their parent exits, which is exactly what `taskkill /T` misses. Holding jobs in the server makes a crash self-cleaning. The node pty-host would need a native add-on to do this, and its own death would take jobs down in ways the server doesn't control.

## 3. No breakaway from a job
**Decision:** Jobs keep the Windows default: neither JOB_OBJECT_LIMIT_BREAKAWAY_OK nor SILENT_BREAKAWAY_OK is set, so nothing started inside a job can leave it. The accepted consequence: an app launched by hand from a runcastle terminal (for example `code .`, or a browser that wasn't already running) closes when that terminal closes.
**Why:** Allowing even opt-in breakaway reopens the hole this feature closes, and almost nothing asks for breakaway anyway, so there is little to gain. A runcastle terminal should clean up after itself; a regular terminal is still there for anything meant to outlive it.

## 4. Assign right after spawn; no suspended start, no wrapper
**Decision:** Terminals: the server assigns the pty-host to its job before sending the first `spawn` frame, so there is no gap. Direct spawns (drive hooks, doctor execs, host burn execs via sandcastle's `onChildSpawn`): the server assigns the process to its job synchronously, straight after `spawn()` returns its pid. There is no CREATE_SUSPENDED and no go-ahead wrapper.
**Why:** The pid exists as soon as `spawn()` returns, and assignment takes microseconds. A freshly created `cmd.exe` needs milliseconds to load before it can start anything, so the gap is theoretical. These processes are short-lived and already time out. A wrapper would close the gap completely, but it costs an extra process and start-up time on every hook and check.

## 5. A failed job setup never blocks a spawn; `taskkill /T` stays as fallback
**Decision:** If creating or assigning a job fails (OpenProcess denied, the FFI load fails, and so on), the process still starts. The server logs a warning, and that unit is torn down exactly as today, with `killProcessTree` → `taskkill /T /F`. When a unit that has a job is stopped, the server closes/terminates the job, then waits until the unit's root process has actually exited before reporting stopped. That keeps the "stopped means dead" contract from `stopping-a-headless-agent-actually-stops-it`. Units without a job use today's path unchanged.
**Why:** A missing job is no worse than today, but refusing to spawn would turn one bad Windows call into broken terminals. Waiting on the root preserves the settled contract that the UI never reports stopped early.

## 6. Windows-only, behind one platform seam; Linux and macOS unchanged
**Decision:** runcastle supports Linux, macOS and Windows. All job code lives behind a single platform seam. Off win32 it is a no-op that never loads `bun:ffi` or kernel32, and POSIX teardown (process-group signalling in `kill-tree.ts`) is unchanged. Windows-only tests are guarded with `describe.skipIf(process.platform !== 'win32')`, following `dev-pane.test.ts` / `dev-pane-stop-bun.test.ts`, so the suite stays green on every platform.
**Why:** The bug is Windows handle and parent-chain behaviour. The brief rules POSIX teardown out of scope, and the fix must not add risk or dependencies on the other two platforms.

## 7. Linux was verified in Docker: no port bug, POSIX teardown stays as is
**Decision:** A Docker probe (`prototypes/linux-probe/FINDINGS.md`) ran runcastle's real registry and kill path on Linux. Ordinary MCP trees die on session end and on a server `kill -9`, including when claude exits first, and :4512 is free right after a hard kill (sockets are close-on-exec). The only survivor is a process that deliberately detaches into its own session (`setsid`), the POSIX equivalent of breakaway. We accept that and change nothing in POSIX teardown. macOS was not testable in Docker and is assumed to match Linux here.
**Why:** The user didn't want the POSIX question parked, so it was checked now rather than deferred. The Windows bug has no Linux counterpart, and containing deliberate daemons on POSIX (cgroups, subreapers) is out of proportion to the risk. Detached processes don't hold the port.

## 8. Under Bun, every platform uses the pty-host sidecar; Node 22+ becomes required everywhere
**Decision:** The same probe found that native node-pty under Bun is broken on Linux. The PTY exits with SIGHUP about 14ms after its first output, on Bun 1.3.14, 1.4.0 and 1.4.2, with or without a TTY, while the sidecar and plain Node both work. So `selectBackend` (`pty/pty.ts:129`) routes to the sidecar whenever the runtime is Bun, on every platform. Native stays for a node runtime (vitest), and `RUNCASTLE_PTY_BACKEND` stays as the override. Node 22+ becomes a prerequisite on all platforms: update the README prerequisites table (which today says "Windows only… Not needed on macOS") and the doctor check to match. This is its own ticket in lap 1. macOS is switched too, unverified; `prototypes/linux-probe/pty-lifetime.ts` is the 5-second check to confirm it on a Mac.
**Why:** Linux terminals die immediately today. The reading side of node-pty that breaks is shared between Linux and macOS, so macOS is likely affected too. The sidecar is already proven on win32 and Linux, so using it everywhere is safe even if macOS happened to work. It also gives all platforms one terminal path, the same one the Windows job work hooks into. The cost is a Node prerequisite that everyone was already close to having.

## 9. Testing: pure unit tests, Windows-guarded integration, a POSIX terminal-lifetime test
**Decision:** Three layers.
1. **Unit (all platforms):** the job bookkeeping. This covers the unit → job mapping, the `taskkill` fallback when setup failed, and "stopped only after the root has exited". Kernel32 is behind an injected seam and faked.
2. **Windows-only integration** (`describe.skipIf(!win32)`, modelled on `dev-pane-stop-bun.test.ts`, since vitest runs under node):
   - *Session end:* a real registry terminal running a stub that starts a long-lived child and then exits. After the session ends, no descendant survives.
   - *Crash:* a Bun fixture server on a random free port (never 4512) opens such a terminal and is killed hard. The port rebinds within a few seconds and no descendant survives.
3. **POSIX terminal lifetime** (skipped on win32): under Bun, a terminal keeps producing output after its first line and exits normally. This is `prototypes/linux-probe/pty-lifetime.ts` turned into a test.

The brief's real-Claude acceptance checks (expect-mcp session end; hard kill then `bun run install:local`) stay manual test-drive steps.
**Why:** The logic is testable everywhere. The OS behaviour needs real processes and can only be proven on its own platform. A random port keeps the crash test from colliding with a live runcastle on :4512.
