# ADR-0016: Terminals run on Bun's own PTY, and Node is no longer a prerequisite

**Status:** Accepted
**Date:** 2026-10-31

## Context

The embedded terminal ran node-pty in a sidecar process under system `node`, because
node-pty does not work in-process under Bun: its Windows input pipe breaks, and on Linux
the terminal hangs up after its first output. That made Node 22+ a prerequisite on every
platform, the only reason Runcastle needed anything beyond Bun. It also meant a native
addon, with a C++ toolchain and a source build on musl wherever no prebuild fit.

Since ADR-0015 chats no longer run in terminals. PTYs host only program output: dev-server
panes, the design server, and the Settings flows (sign-in, `setup-token`, the image build).

## Decision

Terminals run on `Bun.spawn` with its `terminal` option, the only backend behind
`createPtySession`. node-pty, the sidecar, its host file and the install check are gone,
with no fallback. Nothing in Runcastle starts `node` on the host. Both ACP adapters already
run under Bun.

The minimum Bun stays 1.3.14, which was measured on Windows and Linux, and the platform
smoke holds that claim on every OS with Node hidden, on the floor and on the latest Bun.

An agent CLI installed through npm or `bun add -g` is a Node script, so it still needs
Node. Runcastle reports that as the runtime not being ready and points at the agent's
standalone installer, rather than giving agents a `node` on PATH that is really Bun.

## Consequences

- A clean machine needs Bun, git and an agent. The doctor no longer gates on Node.
- No native addon means no toolchain, no source build and no musl special case.
- **Ctrl-C on Windows.** Bun's ConPTY delivers `\x03` to a raw-mode program as a key but
  does not raise the console interrupt a line-mode program waits for. The backend passes
  the key on and, if the program is still running two seconds later, ends its tree. Every
  program in these terminals exits on Ctrl-C, so one rule covers them.
- **Windows job containment** now happens just after the program starts rather than
  before, because Bun's spawn has no suspended step. The window is the one tick between
  the two. The job still ends the tree, orphans included.
- **Windows command lines.** `Bun.spawn` escapes an embedded `"` in a way `cmd.exe` does
  not read, so the backend builds the line itself (`windows-command-line.ts`) and spawns
  verbatim. Dev commands that quote things now work there.
- **Tests.** vitest runs on node, which has no `Bun.spawn`. Suites that only need a
  process use a stand-in on pipes; real terminal behaviour is tested from a real Bun child
  (`pty-bun.test.ts`). Working on Runcastle itself still needs Node for that reason.
- **Bun is now a single point of failure for terminals.** A new Bun can break them with no
  Runcastle release involved. There is no pin; the smoke runs on the latest Bun before each
  release, and the README says how to go back to an older one.
- A project whose own commands need Node now has to have it installed for itself, where
  Runcastle's requirement used to put it there by accident.
