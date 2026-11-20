# Stopping a session kills its process

## Problem

When runcastle stops an agent session, the processes keep running. Every idle stop, model change, edit-a-message fork and stall kill leaves the old adapter (`bun`, 110–170 MB) and its `claude` (300–400 MB) behind. A 36-hour autopilot run ended with 66 `claude` and 67 `bun` processes holding about 12 GB, swap full and builds killed for memory. Two `claude` processes held the same resume id at once. A stall-killed agent may keep spending tokens.

The audit's cause holds in today's source, on Linux and macOS. The adapter is the small program that sits between runcastle and Claude Code or Codex and speaks ACP (the agent protocol runcastle talks to it over). It is spawned with node's `spawn` and no `detached`, so it shares the server's process group. The stop calls the tree-kill helper, which on POSIX sends one `SIGTERM` to the negative pid, a group that does not exist. The helper swallows the `ESRCH`, still logs "settled", and never escalates, waits or checks.

The survey found a second cause that holds on every platform. Detaching a thread removes it from the host's map before the kill, and the kill does not wait for exit. The next prompt therefore starts a fresh adapter that resumes the same conversation beside the old one. Closing the connection also never closes the adapter's stdin. The adapter does exit on stdin EOF, so an idle adapter lives until the server itself exits.

On Windows the tree kill is `taskkill /T /F`, which does walk the tree, so the group bug is POSIX-only. Windows still has the overlap and no check that the process is gone.

## Approach

From the user's side nothing changes on screen (decision 2). A stopped session's processes are gone within a few seconds, a conversation never runs in two processes (decision 4), and a server start clears what earlier runs leaked (decisions 5–6).

**One way to stop a process tree.** The tree-kill helper becomes a stop that reports what happened. It takes the pid and whether the pid leads its own group. On POSIX it sends `SIGTERM` to the group, waits up to about 5 seconds for the group to empty, sends `SIGKILL`, then checks again. It resolves with whether the tree is gone and logs any survivor by pid. If the group does not exist (a process that never got one), it falls back to the single pid. It never throws.

On Windows it keeps `taskkill /T /F` with no polite wait, since the tree walk needs the root still alive; it then confirms the pid is gone and logs if not. The polite step on Windows is the adapter's stdin closing (below). Where the caller already holds a Job Object (a Windows container that ends every process in it at once), closing the job stays the force step. The PTY paths (terminals, dev panes, the design server) and the drive hooks keep the old helper unchanged: they already lead their own groups and already kill correctly.

**Spawn so the group exists.** The adapter spawn sets `detached: true` off Windows, so the adapter leads a group that holds `claude`/`codex`, their MCP servers, hooks and tool shells. On Windows `detached` would open a console, so it is left off. The drive-hook spawn already sets `detached` this way and is the precedent. The same goes for the Codex usage read's `codex app-server`, the short-command runner behind naming runs, the agent list and doctor checks, and the image build (decision 7).

A detached child no longer gets the terminal's Ctrl-C. The server's shutdown stop and the adapter's own exit on stdin EOF cover that. If the server dies hard, its pipes close and the adapters exit on EOF. Anything left after that is a leftover for the start-up clean.

**Polite first (decision 3).** The adapter's stop first ends its stdin. The adapter treats EOF as shutdown, and the Claude Agent SDK then closes `claude` with its own `SIGTERM`→`SIGKILL`. Then the stop runs the tree stop above. Server shutdown keeps its 5-second budget and stops all threads in parallel, with a 3-second polite wait so the force lands inside the budget.

**One process per conversation (decision 4).** The host keeps a map from thread to "stopping" (the old process's exit promise). Starting or connecting a thread awaits any entry for that thread before spawning, so a resume or fork never overlaps its predecessor. The kill's own deadline bounds the wait. The entry is removed when the exit settles. Model change, edit-a-message fork, stall kill and idle stop all go through this one path.

**Start-up clean (decisions 5–6).** A new start-up step runs once the server is listening. It is not awaited, so boot never waits on it; it cannot hit a session the new server starts meanwhile, because it skips everything descended from the server. It lists processes and picks those that carry this runcastle's mark:

- **Linux:** read each pid's environment from `/proc/<pid>/environ`. The mark is `RUNCASTLE_SESSION_ID` set together with `RUNCASTLE_SERVER_URL` equal to this server's own URL.
- **macOS:** read the same two variables from `ps -E -ww` for same-user processes. A process whose `ps` line shows no session id falls back to the Windows match below.
- **Windows:** another process's environment is not readable, so list command lines with `Get-CimInstance Win32_Process`. Match `claude` on its `--settings` path under this data folder's `sessions/`, and the adapter on being the parent of such a process.

It skips the server itself, anything descended from it, and every process it runs under (a server restarted from a runcastle terminal carries the mark too). It never signals the server's own process group, and signals a whole group only when the leftover leads one; 1.7.4's leftovers sit in the dead server's group, so only their own pid is signalled. It then stops each picked tree with the tree stop above and logs one line with the count. A failure to list processes logs and moves on, and never blocks boot. Since only one server can hold the port, any marked process alive at this point belongs to a dead earlier run.

## Seams

- **The tree stop helper** (existing; new contract). Observe: a real process tree (a `bun` fixture that spawns a nested child, like the existing claude stub's `nest` mode) is gone after the call. Also observe the result and the log line, including a child that ignores `SIGTERM` and must be forced.
- **The agent host's spawn and stop** (existing). Accept test 1: drive the real adapter spawn path with a fake adapter script that spawns a child, stop the thread, and assert the adapter pid and its child no longer exist. Accept test 2: a fake adapter whose child carries `--resume=<id>`. Resume the same thread five times (stop, then prompt) and assert exactly one live process holds that resume id.
- **The start-up clean** (new). Observe: given spawned marked processes (this server's URL), an unmarked one and one marked with another URL, only the first are gone. On Linux this runs for real in CI. The macOS and Windows listing parsers are tested on recorded output.
- **The Codex usage read and the short-command runner** (existing). Observe: after the call the spawned fixture is gone. Today the image-build test leaks a 60-second process; it asserts the death instead.

## Out of scope

- The false "this orchestrator session has ended" lock-out. The feature "The orchestrator is never locked out" waits on this one and handles it. This feature only removes the overlap that may cause it.
- Worker containers and anything run inside them (`docker exec`, `pkill` inside the box). The image-build fix touches only the host-side build command.
- The stalled-worker status and the usage-limit wake, which have their own features.
- An hourly orphan sweep (decision 5).
- A pid file per session (decision 6, alternative).

## Open questions

- Whether a Windows server's adapters die with it already. libuv puts non-detached children in a job that ends them when the parent closes. If Bun keeps that, Windows leftovers are rare and the command-line match is a backstop. This has not been checked on a Windows machine.
- Whether `ps -E` shows the environment on every macOS version under SIP (System Integrity Protection, Apple's lock on system processes). If not, macOS falls back to the Windows-style command-line match.
- Whether Claude Code starts background processes that call `setsid` and so escape the group. The survey did not check. The start-up clean catches any such process that keeps the mark.
