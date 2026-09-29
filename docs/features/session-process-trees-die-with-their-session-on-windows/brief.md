# Session process trees die with their session on Windows

## What happened (observed 2026-09-26)

After runcastle is closed, `bun run install:local` refuses with "runcastle is running on :4512". `netstat -ano` shows :4512 LISTENING under a PID that no longer exists, and the port is released only once leftover session processes are killed. The holders were orphaned `npx --yes --package expect-cli@latest expect-mcp` trees (node.exe → bash.exe → bash.exe → sh.exe → node browser-mcp.js). Claude Code sessions that runcastle launched had started them as stdio MCP servers. Their parent claude.exe was gone, but they kept running for hours or days. `taskkill /PID <npx pid> /T /F` freed the port immediately.

The project session confirmed this on the owner's machine the same day. There were five expect-mcp trees from 2026-09-22..25 whose parent claude.exe processes were gone, and two more under `claude.exe.old.*` processes left by a Claude Code self-update. The five were killed by hand. The live server held :4512 at the time, so the stale-LISTENING row itself was not reproduced then.

## Root cause (two parts, fix both)

1. **Handle inheritance.** On Windows a child can receive copies of the parent's inheritable handles. The server's listening socket appears to reach every process spawned below it: the PTY sidecar (`packages/server/src/pty/pty-sidecar.ts:83` spawns node `pty-host.cjs` with a plain `spawn`), then claude.exe, then its MCP servers. Any one of them that outlives the server keeps :4512 bound. **Still unproven:** whether Bun's `Bun.serve` listen socket is created inheritable, and whether node `child_process.spawn` / node-pty (ConPTY, `bInheritHandles`) pass it on. Prove this on a live repro (Sysinternals `handle64.exe -a "\Device\Afd"`) before building on it. Use `npx ctx7@latest` for Bun and node-pty API shapes; don't rely on memory.
2. **Teardown misses orphans.** `killProcessTree` (`packages/server/src/pty/kill-tree.ts:66`) is `taskkill /T`, which walks the parent-PID chain. When claude.exe exits first, its MCP server trees lose their parent and `/T` can no longer reach them.

## Direction (settled in the project session; the how is for the grill)

- **A Windows Job Object is the backbone.** Each spawned host tree gets its own job with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, so the whole descendant tree dies with it, including when the server crashes. Job Objects alone should meet both acceptance criteria: if every descendant dies with its job, nothing is left holding the socket.
- **A non-inheritable listen socket is a second layer**, not the only fix. It is worth doing if Bun lets us reach the handle (for example SetHandleInformation clearing HANDLE_FLAG_INHERIT via bun:ffi). If it doesn't, the fallback is spawning the PTY host through a launcher that doesn't inherit handles.

## Open questions for the grill

- **Who owns and holds each job?** The server via `bun:ffi`, or the node pty-host? This decides what a server crash does, and whether the job survives a pty-host death.
- **Server crash vs live terminals.** PTYs are server-owned, so terminals already die with the server. Confirm that kill-on-close matches that, and doesn't make things worse, for example for burns.
- **Breakaway.** Can processes that detach (CREATE_BREAKAWAY_FROM_JOB, or daemons like agent-browser) escape the job? Should the job forbid breakaway?
- **Spawn-then-assign race.** A process assigned to a job after it starts can fork before assignment. Is CREATE_SUSPENDED needed, and is it reachable from node/Bun spawn?
- **Pure logic to unit-test** (session → job mapping and the like), and how to guard the Windows-only integration tests.

## Scope

In scope: every host-side process tree the server spawns, because they all inherit the socket the same way. Call sites:
- `pty/registry.ts` `killTree`
- `pty/pty-sidecar.ts:246`
- `pty/dev-pane.ts`
- `workflows/kill-registry.ts` (host burns)
- `services/drive-hooks.ts`
- `doctor/system-exec.ts`

## What it must NOT swallow

- **The review-recorder path sweep** from `orphaned-review-recorders-lock-the-review-dir`. It stays as the fallback that survives a server restart. A job may make it redundant for the common case; do not remove it here.
- **POSIX teardown.** Process-group signalling already works there; no change.
- **`install:local`'s running check.** It is correct; it was only reporting the problem.
- **Claude Code self-update leftovers** (`claude.exe.old.*` processes). Not ours.

## Already settled

- Stop/Cancel must kill the real process tree, and the UI must not report stopped until it is dead (`docs/features/stopping-a-headless-agent-actually-stops-it/decisions.md`). This feature extends that contract to orphans; it does not reopen it.
- `killTree()` is async and per-backend (`windows-dev-pane-teardown-kill-the-process-the-sidecar-actually-owns`). Under the sidecar the tree is rooted at the host pid the server spawned, never the inner node-pty pid.

## Acceptance

- Start runcastle, launch a session whose Claude Code config starts a stdio MCP server (expect-mcp or any `npx` MCP), and end the session: no descendant processes remain.
- Start runcastle with a live session, then kill the server process (not a clean shutdown): :4512 is free within a few seconds, and `bun run install:local` passes its running check.
- Tests for any pure logic added. Windows-only behaviour can be a guarded integration test.

## Diagnosis commands (PowerShell)

    netstat -ano | Select-String ":4512"
    Get-CimInstance Win32_Process | ? { $_.CommandLine -match 'expect-mcp|pty-host' } | select ProcessId,ParentProcessId,CreationDate,CommandLine
    # Sysinternals handle64.exe -a "\Device\Afd" lists which processes hold sockets
