# No Node

## Problem

Runcastle installs with Bun, and then its doctor demands Node.js 22+ and refuses to boot
without it. The agent setting up the VPS hit this as a surprise. Node is there for one
reason: the embedded terminal (dev-server panes, the design server's output, and the
Settings flows for sign-in, `setup-token` and the image build) runs node-pty inside a
Node helper process, because node-pty does not work in-process under Bun. Nobody should
have to fetch a second JavaScript runtime just to get terminals.

## Approach

**For the person using it.** `bun add -g runcastle` plus an agent installed with its own
standalone installer is everything. `runcastle doctor` has no Node line, and a machine
with no Node boots. Terminals look and behave as they do now.
Someone whose agent CLI is an npm install, on a machine with no Node, gets a plain
"not ready" naming the fix instead of an adapter crash. Node's README row and the
terminal troubleshooting that existed only for it, including the C++ toolchain and
Alpine build-from-source notes, go away.

**The terminal backend.** `createPtySession` stays the single seam everything above it
talks to, with the same `PtySession` interface, so the registry, the WebSocket transport
and `TerminalView` do not change. Behind it, one backend built on `Bun.spawn` with the
`terminal` option replaces both existing ones. Removed entirely: node-pty, `pty-sidecar.ts`,
`pty-host.cjs` (and its place in the published file list, the asset paths and the drive
setup), `install-check.ts`, the `RUNCASTLE_PTY_BACKEND`, `RUNCASTLE_NODE_BIN` and
`RUNCASTLE_PTY_HOST` overrides, and the `useConpty` option. `createPtySession` called
outside Bun fails with a clear error unless a test has installed a stand-in.

What the backend has to get right, each measured or learned from the probes:

- **Exit code.** Read it from `proc.exited`. The terminal's own `exit` callback only
  reports that the terminal stream closed. Call `terminal.close()` once the process has
  exited, and treat a write after close as a no-op, because it throws.
- **Windows command lines.** `Bun.spawn` escapes embedded quotes in a way `cmd.exe` does
  not read, so a dev command containing quotes breaks. Build the command line ourselves
  and pass `windowsVerbatimArguments: true`, as `hookSpawnTarget` already does for drive
  hooks. A command run through `cmd.exe /d /s /c` gets the same outer-quote shape the
  hooks use. Everything that reaches the PTY with cmd shims (`devSpawnTarget`,
  `resolveSpawnTarget`, `imageBuildTerminal`) must keep its current meaning.
- **Windows containment.** `contain(pid)` from the job-object module (the Windows
  mechanism that kills a whole process tree) takes the child's pid, straight after the
  spawn on the same tick. The child now starts before containment rather than after, a
  window of microseconds; the job kill was measured to end the tree and free the port.
  Pass `windowsHide: true`. `pid` is the real child from the start, so the sidecar's
  pid swap goes away with it.
- **POSIX tree kill.** The child leads its own process group, so the existing
  `killProcessTree` signal reaches its whole tree. Measured on Linux.
- **Ctrl-C on Windows** (decision 4). `write()` passes the bytes through. If they
  contain `\x03`, it starts a two-second timer and calls `killTree()` if the process is
  still alive when it fires. Output stays as bytes for the existing UTF-8 decoder.

**The doctor and readiness.** `nodeProbe` leaves the doctor. (`install-check.ts` goes too,
though nothing in the server calls it today.) A small helper decides whether a resolved
CLI needs a Node that is not there: on Windows a `.cmd` or `.ps1` shim that calls `node`,
on POSIX a `#!/usr/bin/env node` first line, either with no `node` on PATH. The doctor's
per-runtime binary probe and each runtime's `checkReady` both use it, and it reads the
file without running it. Codex's `installFix` and the upgrade advice in the version probe
move to the standalone installers (`https://chatgpt.com/codex/install.sh`, `install.ps1`).
The doctor's existing "at least one runtime" rule is unchanged.

**Documents.** README prerequisites, install and troubleshooting; `site/docs/index.html`;
`docs/RELEASE.md`; `packages/server/README.md`; `docs/UI-SPEC.md` §5 where it describes
the sidecar as current. A short new ADR records why the sidecar was retired. The Bun
requirement stays 1.3.14.

**Tests.** `bun run test` still runs vitest on Node. Node has no `Bun.spawn`, so suites
that only need a process to talk to (dev pane, design server, review wires, dry-run drive)
run against a test-only stand-in built on plain pipes, installed by the test setup behind
`createPtySession`. Real terminal behaviour moves to fixtures run in a real Bun child,
the pattern `pty-lifetime-bun` and `dev-pane-stop-bun` already use: keystrokes, resize,
exit codes, tree kill, Ctrl-C, Windows quoting. Fixtures that spawn `node` as a stand-in
for a child process stay, since contributors have Node.

**The smoke** (`scripts/platform-smoke/`, `.github/workflows/platform-smoke.yml`). Drops
the Node setup and the Node line from its Dockerfiles, asserts `node` is not on PATH,
replaces the binary-on-disk and sidecar steps with a real terminal opened through the
shipped package, sends Ctrl-C, and starts both adapters as far as they go with no login.
The smoke job runs on Bun 1.3.14 and the latest Bun. The `macos-tests` job keeps Node:
that is the contributor suite.

### What was measured

Probes on 2026-10-31, kept outside the repo.

| Check | Windows 11 | Linux (WSL Ubuntu) |
|---|---|---|
| Keystrokes into a prompt, 20,000 lines of output, exit code | pass, Bun 1.3.14, 1.4.0, 1.4.2 | pass, Bun 1.3.14, 1.4.2 |
| Long run with output and silences | pass, 88s, Bun 1.4.2 | pass, 80s, Bun 1.3.14, 1.4.2 |
| Resize seen by the child | pass | pass |
| UTF-8, and the last output arriving before exit | pass | not measured separately |
| Tree kill frees a held port | pass, both `taskkill /T` and the job object | process-group kill leaves nothing behind |
| Ctrl-C to a raw-mode program | pass | pass |
| Ctrl-C to a line-mode program | **fails**; node-pty passes | pass |
| `cmd.exe` line with embedded quotes | fails by default, passes with verbatim arguments | n/a |
| Claude adapter, full turn, Node hidden | pass | not measured |
| Codex adapter, full turn, native binary, Node hidden | pass | not measured |
| Codex adapter, npm-installed `codex`, Node hidden | **fails**: `'node' is not recognized` | not measured |

macOS is unmeasured. Nothing in the server, the skills, or sandcastle starts `node` or
`npx` on the host; the test-suite fixtures and smoke do, and the smoke changes here.

## Seams

- `createPtySession` and the `PtySession` interface (existing): the one place a terminal
  is created. Real-Bun fixtures observe output, input, resize, exit code, tree kill and
  Ctrl-C through it. The stand-in plugs in here for vitest on Node.
- `runDoctor` report (existing): shows the probes present and absent, and the fix text
  for a CLI that needs a missing Node.
- `AgentRuntimeAdapter.checkReady` (existing): shows a runtime as not ready, and why.
- The installed package under `scripts/platform-smoke/smoke.ts` (existing): the only seam
  that sees the shipped artifact on a machine with no Node.

## Out of scope

- How terminals look or behave beyond the Ctrl-C fallback. This swaps what hosts them.
- The install script, which is the "One-line install" feature waiting on this one.
- The burn image and anything inside it (decision 10; "Burns build their own image").
- Moving the vitest suite onto Bun (decision 7).
- Anything a project itself needs Node for (decision 9).
- A `node` stand-in on PATH for npm-installed agents (decision 1).

## Open questions

- macOS: every result above is Windows or Linux. The smoke settles it before ready, and a
  failure stops the work for the human (decision 8).
- Why Ctrl-C does not reach line-mode programs under Bun's ConPTY is unknown. If the
  cause turns out to be something the backend can set when it spawns, that replaces the
  fallback.
- `bun-types` in the repo is 1.3.14. If its `terminal` types are POSIX-only, the backend
  needs a small quarantined cast or a types bump.
