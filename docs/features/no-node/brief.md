## Purpose

The human wants setup streamlined: nobody should have to fetch extra things by hand. Runcastle installs with Bun, then doctor demands Node 22+. The VPS setup agent hit this as a surprise. Remove the requirement.

## Understood

- Node exists for one reason: the embedded terminal runs `node-pty` in a node-hosted sidecar, because node-pty does not work in-process under Bun (`packages/server/src/pty/pty.ts`, `pty-sidecar.ts`; README lines 78 and 463; doctor's node probe).
- Since ADR-0015, chats no longer run in terminals. PTYs remain only for program output: dev-server panes, the design server's output, and the Settings flows (`setup-token`, sign-in, image build).
- Bun's docs now list a built-in terminal, `Bun.spawn` with a `terminal` option / `Bun.Terminal`, on Linux and macOS (openpty) and Windows (ConPTY). The backend in `pty.ts` was written to be swappable.

## Open

- Confirm this before anything else: do the ACP adapters (`@agentclientprotocol/claude-agent-acp`, `codex-acp`) need Node on PATH? I could not confirm it. If they do, this feature is not "no Node" as described and the human should hear that plainly.
- Prove Bun's terminal on Windows, not just from the docs. The old failures were Windows input and Linux hang-ups after first output, so test keystrokes into a Settings flow and long-running dev-pane output on both.
- Whether the minimum Bun version must rise to get this, and what that means for the doctor's Bun check.
- Whether anything else in the tree still calls `node` or `npx`, including the vitest suite's use of the native backend.

## Must not swallow

- Rebuilding how terminals look or behave. This swaps what hosts them.
- The install script, which is its own feature.

## Ordering

Runs alongside "Burns work for any Linux user". The One-line install waits on this one. Update the README and doctor here, since this removes a prerequisite.

## Working agreement

Checkpoints the human named, for this whole cut (Burns work for any Linux user, Move runcastle to another machine, No Node, Burns build their own image, One-line install):
1. After "Burns work for any Linux user": the human runs a real burn on the VPS.
2. Before the move: it handles the human's real data.
This feature has no checkpoint of its own: it is carried through to merged without stopping. Publishing a release needs the human's yes.
