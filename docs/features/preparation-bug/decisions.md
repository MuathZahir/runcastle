# Decisions — preparation-bug

Fix for: `stopDevPane` hangs forever on Windows under Bun, blocking every test
drive stop and leaking the dev-server process tree, its port, and the per-drive
data dir. Full evidence: `C:\Users\user\AppData\Local\Temp\runcastle-stopdevpane-handoff.md`
(reproduced 4×; hang is at `git.ts:2062` → `dev-pane.ts:158-162`; the green
vitest test is misleading because it runs under node, production runs under Bun).

## 1. Defensive fix, not diagnose-first
**Decision:** One lap that makes teardown structurally immune to all three live
hypotheses (registry miss / `promisify(execFile)` never settling under Bun /
the 5 s bound's timer not firing), rather than a diagnose-then-fix ticket pair.
Light instrumentation lands alongside the fix so any recurrence is
self-locating.
**Why:** Even with the root cause pinned, the right fix is the same — never let
a child-process promise gate the stop path. Hypothesis 1 is already effectively
excluded (a registry miss returns fast; this hung for minutes), so a dedicated
diagnosis ticket would mostly re-buy evidence the handoff already collected.

## 2. Bun changelog check is diagnostic, not gating
**Decision:** The implementation agent checks Bun's changelog/issues for
`execFile` / `promisify` fixes between the installed 1.3.4 and current, as a
data point — but the defensive fix ships regardless of what that turns up.
**Why:** runcastle cannot control which Bun version users run (`engines
>=1.3.14` is unenforced); teardown must be robust on any of them.

## 3. Two-layer fix: owned settlement + a widened bound
**Decision:** (a) Rewrite `killProcessTree`'s win32 branch to drop
`promisify(execFile)` in favour of `spawn('taskkill', ...)` with explicit
`exit`/`close` listeners resolving a hand-rolled promise, plus an internal
timeout backstop. (b) Widen the 5 s `KILL_TREE_TIMEOUT_MS` bound to wrap all of
`tearDown` — including `entry.pty.kill()` — not just `killTreeBounded`. The
stop path stays awaited (NOT fire-and-forget): `stopDevPane`'s contract is that
the port is free before the drive's stop hook runs.
**Why:** Layer (a) removes the prime suspect — promise settlement becomes
IO-events we attach ourselves instead of Bun's promisify machinery; the by-hand
`taskkill` completed instantly, so a listener settles in ms. Layer (b) makes
the deadline the property of teardown as a whole, so no single step (present or
future) can hang the stop path.

## 4. Regression test runs the actual code under the actual runtime
**Decision:** New test that spawns a real `bun` child process on win32 which
calls the real `startDevPane` → `stopDevPane` — sidecar backend auto-selected
(Bun+win32), real `cmd.exe` shim, real grandchild holding a real port — and
asserts teardown returns < 5 s, the port is freed, and every pid in the tree is
gone. Gated `skipIf` off win32 / no `bun` on PATH. The implementation agent
must run it and record the evidence (timings, pids before/after, port state),
not just "tests green." The existing node-side test stays but gains a comment
stating it does NOT exercise the production runtime.
**Why:** The existing test passes while production is broken because it awaits
the taskkill promise under node while production awaits it under Bun. A fix is
only proven by the production runtime + production tree shape; the old test
already misled one investigation.

## 5. Shipped means the literal repro passes on the production install
**Decision:** After merge: cut a `next` prerelease, `bun add -g
runcastle@next`, restart the server, then run the handoff's exact repro —
`dry_run_drive` start → stop — from a talk session, and confirm
`testdrive.teardown_started` appears in the events table, the port is freed,
and zero processes are orphaned. Until that passes, the feature is not done.
Corollary: do NOT test-drive this feature in review before updating the
install — the drive stop runs in the currently-installed (broken) server and
will hang again.
**Why:** The in-lap test covers `dev-pane.ts` → `registry.ts` → `pty-sidecar.ts`
→ `kill-tree.ts` but enters below `git.ts` and the tRPC layer; only the repro
on the real install exercises the full production path end to end.
