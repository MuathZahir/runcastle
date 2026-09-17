# Outcome — Codex interactive sessions: SessionEnd and resume lifecycle is borrowed from Claude Code and wrong

Interactive Codex sessions (ideation etc.) appear to close suddenly — the "Resume session" button appears while the terminal is often still running — and Resume then fails to reopen the conversation most of the time. Make runcastle's alive/ended bookkeeping and resume path match what Codex's TUI actually emits, without touching kickoff delivery.

- Shipped: 2026-09-16
- Laps run: 1

## What shipped

8 commits · 16 files

### Lap 1
- 3 tickets landed: #1 Codex SessionEnd is a note; PTY exit is the sole teardown; #2 Announce unresumable resumes; suppress the update modal in session homes; #4 Committed live-verification harness hard-codes one operator's node-pty install
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 063edc556953379ef9003428d5b1ef4a22c0ade9
- Landed since: 1
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 6da8d351938fa85a0838290ddab8cfbb882acfaf
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 4. Committed live-verification harness hard-codes one operator's node-pty install

# ticket(4) — live-verification harness no longer hard-codes one operator's node-pty

## What was done

The retained live-verification harness
(`docs/features/codex-interactive-sessions-.../prototypes/drive.ts`) loaded node-pty
from the literal absolute path `C:/Users/user/.bun/install/global/node_modules/node-pty`,
so it only ever ran on the machine it was written on. It now computes the repo root from
`import.meta.url` with `node:path` `resolve`/`join` (no hand-concatenation, per SPEC §12)
and `createRequire`s node-pty anchored on `packages/server/package.json` — the package
that declares the dependency, i.e. literally the launcher's own copy, which the file's
header comment already claimed it used. One file, nine lines added, three removed; no
behaviour of the harness itself changed.

The reviewer's repro step was re-run verbatim, before and after. Before:
`error: Cannot find module 'C:/Users/user/.bun/...'`. After: execution reaches the
harness's own `usage:` guard, i.e. the module loaded. As a stronger check I also ran it
with a real spike dir: it loaded node-pty, opened a real PTY, and failed only on
`execvp(3) failed` for `codex.cmd`, which is the harness being Windows-targeted, not a
module-resolution failure.

## Surprises

- The stated baseline in the burn prompt ("118 files, 1768 passed, 0 failed") does not
  match this branch: the suite is 252 files / 3712 tests, and one test fails —
  `packages/server/test/dev-pane.test.ts:183` ("process group must be gone",
  `pidAlive(-pgid)` returns true). It fails deterministically on a single targeted rerun
  too. It cannot be caused by this ticket: the entire diff is one file under `docs/`
  that nothing imports (verified by grep), and it is a real-process-group-reaping
  assertion — an environment fault in this sandbox. Left untouched.
- `bun run typecheck` does not cover `docs/`, so the harness is unchecked by CI either
  way; the verification that matters is running it, which I did.
- node-pty is not hoisted to the repo root in this checkout (it lives in
  `packages/server/node_modules/node-pty`), so a bare `require('node-pty')` anchored on
  the harness's own URL would *not* resolve. Anchoring on the server package is what
  makes it work, not incidental.

## Left undone

- `drive.ts` still spawns `codex.cmd` and the harness is Windows-only in that respect.
  That is outside this ticket (the finding was the node-pty path) and arguably correct —
  the live verification it documents was done on the operator's Windows host.
- Drive machinery: this change adds no service, env var, seed, or process, so
  `.runcastle/drive-setup.ts` / `drive-stop.ts` needed no edit. I did not run them
  (no services in this sandbox); I confirmed only that the change introduces no new
  requirement for them.
