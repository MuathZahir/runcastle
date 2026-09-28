# Linux probe — findings (2026-09-28)

Ran in Docker (`sandcastle:runcastle`: Debian 12, Bun 1.4.2, Node 22.23.3) against
this branch's HEAD, using runcastle's real `pty/registry.ts` + `kill-tree.ts`.
A stand-in for claude (`claude-stub.cjs`) starts a stdio "MCP server" child the way
the MCP SDK does (plain spawn, piped stdio). Modes: `stay` (claude alive at session
end), `exit` (claude exits first, orphaning the MCP; this is the Windows failure
shape), `setsid` (the MCP detaches into its own session, like a daemon).
Reproduce: `run.sh` (see the header for the docker invocation used in the talk session).

## 1. Native node-pty under Bun is broken on Linux (separate bug)
With the default backend on Linux (`native (Bun off-win32)`), the PTY reports
exit `{exitCode:0, signal:1}` (SIGHUP) about 14ms after its first output, so every
terminal dies at once. The same script works under the pty-host sidecar
(`RUNCASTLE_PTY_BACKEND=sidecar`) and under plain Node with the native backend.
It is the same Bun + node-pty incompatibility that made win32 route to the sidecar.
macOS is untested.

## 2. Orphan / port behaviour on Linux (sidecar backend)
| Case | Session end (`killTree`) | Server `kill -9` |
|---|---|---|
| MCP, claude alive (`stay`) | clean | clean; the pty-host and tree die |
| MCP, claude exited first (`exit`) | clean. The MCP already died when claude exited (SIGHUP to the PTY's process group) | clean |
| MCP that detaches itself (`setsid`) | **survives** | **survives** |
| :4512 after `kill -9` | — | free in every case; a new `Bun.serve` binds, and no survivor holds a :4512 socket inode |

So the Windows bug (a leftover keeps :4512 bound) does not occur on Linux:
sockets are close-on-exec, and ordinary MCP trees die with the process group.
The only survivors are processes that deliberately detach into their own session,
the POSIX equivalent of breakaway.
