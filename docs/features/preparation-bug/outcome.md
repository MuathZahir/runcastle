# Outcome — Preparation Bug

Read C:\Users\user\AppData\Local\Temp\runcastle-stopdevpane-handoff.md

- Shipped: 2026-08-18
- Lap: 1

## 1. Bun-proof dev-pane teardown: owned taskkill settlement + a bound that covers all of tearDown

# Ticket 1 — Bun-proof dev-pane teardown

## What was done

Both layers landed as specified. `killProcessTree`'s win32 branch no longer uses
`promisify(execFile)`: it spawns `taskkill /pid <pid> /T /F` with `stdio: 'ignore'`
and resolves a hand-rolled promise from `exit`/`close`/`error` listeners it attaches
itself, plus an unref'd 3s timer backstop. The POSIX process-group branch is byte-for-byte
unchanged. In `registry.ts`, the 5s bound now wraps the whole per-entry teardown via a
`withDeadline(body, ms)` helper — the `pty.kill()` backstop used to sit outside it — and
the private `tearDown` method became an exported `tearDownEntry(entry)` so the deadline
could be unit-tested with a backend whose `killTree()` never settles (no real PTY can be
asked to hang on demand). `KILL_TREE_TIMEOUT_MS` was renamed `TEARDOWN_TIMEOUT_MS` to keep
the name true. Always-on `[pty-teardown]` stderr breadcrumbs cover pane id, registry
hit/miss, exited flag, pid, timings either side of the kill, and whether the deadline fired.

Six unit tests in a new `pty-teardown.test.ts`; the one that actually discriminates old
from new asserts that when `killTree()` never settles, the call record is `['killTree']`
alone — proving the deadline abandons the body rather than running `pty.kill()` afterwards
unbounded. The existing 'stopDevPane on Windows' block now carries a comment saying plainly
it runs under node, does not exercise the production Bun runtime, and was green while
production hung.

Two deviations, both deliberate. The regression fixture writes its port-holder to a temp
file and runs `bun holder.mjs` rather than the ticket's inline `bun -e "..."`, because
nested quotes through `cmd /d /s /c` are a trap and the existing Windows test already
establishes the temp-dir pattern. And the fixture's process-tree walk is cross-platform
(`ps` on POSIX, `Get-CimInstance` on win32) rather than win32-only — that is what let me
execute and verify the harness at all here. The vitest gate stays win32-only as specified.

## Surprises

**I could not run the regression test.** The ticket assumed the Windows host; this sandbox
is Linux, so the test skips cleanly (verified) and acceptance criterion 7 — "the regression
test has been RUN on this machine and its JSON evidence recorded in the commit message" —
is **not met**. I did not fabricate evidence. Worse, this sandbox could not have run it even
adapted: a PTY child here cannot `exec` any external binary. `echo` (a shell builtin) works,
but `node -v`, `bun --version`, and `bun holder.mjs` all kill the shell instantly with no
output. So the fixture reaches its report path and emits valid JSON, but always with
`"failure":"grandchild never bound the port"`. **This test still needs one run on the Windows
host before the ticket's proof obligation is discharged.**

What I did verify: typecheck green; the fixture executes under Bun end-to-end through its
report path (imports, port picking, `devSpawnTarget` + `ptyRegistry().create`, watchdog, JSON
emission); its process-table parse and descendant BFS against real `ps` output, a synthetic
Windows CSV, and a UTF-16LE-degraded sample; and both `bun` resolution paths (`BUN_INSTALL`
and the PATH scan).

**The stated baseline does not hold in this sandbox.** `dev-pane.test.ts > kills the child
process tree so the port-holder is not orphaned` fails here — same root cause, the PTY child
cannot exec `sleep`. I confirmed it is pre-existing rather than mine by running the full suite
in a `git worktree` at `HEAD~1`: identical single failure, and my delta is exactly +2 files,
+6 passed, +1 skipped. Full suite: 1780 passed, 4 skipped, that 1 environmental failure.

**The Bun research paid off.** oven-sh/bun#35150 (merged to main 2026-07-23, after 1.3.14, so
in no stable release) names the mechanism exactly: a failed `uv_read_start` on the child's
stdout/stderr **pipe** parks the event loop forever with no error surfaced. `execFile` always
pipes. That independently explains why `stdio: 'ignore'` fixes it, and it is why the fixture
never pipes a child either — it redirects to a file and reads that. Details in commit `f4f05ed`.

## Left undone

The fixture kills the pane synchronously on its failure paths, which on win32 reaps the
sidecar host but may leave the port-holding grandchild alive; the pids are in the evidence, so
it is recoverable, but a bailing fixture on Windows could still need a manual `taskkill`.

`killProcessTree` does not guard `pid <= 1`; on POSIX `process.kill(-1, ...)` would signal
everything. Pre-existing, no caller can currently reach it, and out of scope here.

Stage 2 of the spec's proof — cut a `next` prerelease, `bun add -g runcastle@next`, restart,
and run the literal `dry_run_drive` start→stop repro — is post-merge and untouched. Note the
spec's warning: do **not** test-drive this feature in review before updating the install, or
the stop runs in the old broken server and hangs again.

## 2. Review: prove the teardown fix under Bun and write the ship-gate notes

# Review digest — preparation-bug (ticket 2)

This was a test-suite review, not a browser walkthrough, and it deliberately ran without a
test drive. Decision 5 warns that a drive stop executes inside the *installed* server, not the
checkout; I verified that warning rather than assuming it — the global install is runcastle
1.2.6 and its bundled `index.js` still carries the old `promisify(execFile)` tree-kill. Starting
a review drive would have re-run the exact bug under review, hung the stop, leaked a process
tree and held the machine-wide drive slot. Nothing in this ticket needed the app running, so I
switched the checkout to `feature/preparation-bug` by hand, ran everything, and put it back on
`main`. No repo file was created, edited or committed.

The fix holds up. The new bun-child regression test really does run under the production
runtime — Bun 1.3.4 on win32, sidecar backend auto-selected, no env override — and across five
runs (two through vitest, three driving the fixture directly) the stop returned in 694, 704,
705, 667 and 743 ms against a 5000 ms deadline, with the port freed and the registry cleared
every time. That is the same path that previously hung for minutes across four reproductions.
`bun run typecheck` is clean, and the full suite is 1774 passed / 10 skipped with one failure:
the documented Windows parallel-run EPERM race in `dev-pane.test.ts`, which is green when the
file is run in isolation. The old node-side test now carries a blunt eleven-line annotation
saying a green run there is evidence about node only. No process, port or scratch dir from any
of my runs survived; the one temp dir the EPERM flake stranded was mine and I removed it.

Two findings, both about the proof rather than the fix, each with its own note. First, the
regression test's claim that "every pid in the tree is gone" is close to vacuous: the fixture's
process-table capture fails silently — the `cmd /d /s /c` redirect it uses loses its closing
quote and exits 1 without writing a file — so `treePidsBefore` is always just the root pid and
`aliveAfter: []` proves only that the sidecar host died. The tree claim is really carried by
`portFreed`, which is sound. Second, the new teardown instrumentation logs `entry.pty.pid`,
which under the sidecar is the inner node-pty pid, not the host pid actually handed to the
tree-kill — so the breadcrumb points a future investigator at the wrong process.

What I could not verify is the whole of stage 2: the post-merge ship gate is untouched. Cutting
a `next` prerelease, `bun add -g runcastle@next`, restarting the server, and running the literal
`dry_run_drive` start → stop repro until `testdrive.teardown_started` appears in the events table
all remain ahead, and per decision 5 the feature is not done until that passes. The in-lap test
enters below `git.ts` and the tRPC layer, so nothing here speaks to the full production path.

## 3. Make the teardown proof honest: real tree-pid capture in the fixture, true kill-root in the logs

_no digest captured_
