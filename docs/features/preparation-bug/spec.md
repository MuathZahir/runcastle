# Preparation Bug — stopDevPane hangs on Windows under Bun

## Problem

Stopping a test drive on Windows never completes. The server hangs awaiting
`stopDevPane(...)` and never reaches the drive's stop hook, so the dev server,
its `cmd.exe` shim, and the PTY sidecar host are all left running, the port
stays bound, and the per-drive data dir is never deleted. Reproduced four
times. The user cannot finish a single drive cycle; every stop attempt leaks a
process tree they must hunt down and `taskkill` by hand.

The trap that stalled earlier investigation: an existing regression test for
exactly this path is green, because it awaits the `taskkill` promise under
**node** (vitest) while production awaits it under **Bun** — the runtime, not
the backend, is the difference. Evidence, ruled-out theories, and the exact
code path are preserved in
`C:\Users\user\AppData\Local\Temp\runcastle-stopdevpane-handoff.md`; decisions
and rationale in `decisions.md` beside this spec.

## Approach

From the user's perspective: stopping a drive (dry-run or feature drive)
returns promptly — tree dead, port free, data dir removed — or, in the worst
imaginable case, within the 5-second teardown deadline, after which the stop
proceeds anyway. Never an indefinite hang.

Two structural layers, per decision 3:

1. **Owned promise settlement in the tree-kill.** The win32 branch of the
   process-tree kill stops using `promisify(execFile)` — the prime suspect for
   never settling under Bun — and instead spawns `taskkill /pid <pid> /T /F`
   directly, resolving a hand-rolled promise from `exit`/`close` listeners the
   code attaches itself, with an internal timeout backstop so even a lost
   event cannot leave the promise pending. Semantics otherwise unchanged:
   best-effort, never rejects, POSIX branch untouched.

2. **The teardown deadline covers all of teardown.** The registry's 5-second
   bound (`KILL_TREE_TIMEOUT_MS`) currently races only the tree-kill; the
   follow-up `pty.kill()` backstop sits outside it. Restructure so the bound
   wraps the entire per-entry teardown — the deadline becomes a property of
   teardown as a whole, and no single step, present or future, can hang a
   caller. The stop path stays awaited: `stopDevPane`'s contract — port free
   before the drive's stop hook runs — is unchanged.

Plus two riders:

- **Instrumentation.** Concise, always-on stderr logging in the teardown path
  (pane id, registry hit/miss, exited flag, pid handed to the kill, timestamps
  either side of the kill await, whether the deadline fired). Drive stops are
  rare; the cost is nil and any recurrence becomes self-locating.
- **Bun changelog check (diagnostic only).** The implementing agent checks
  Bun's changelog/issues between the installed 1.3.4 and current for
  `execFile`/`promisify` fixes, and records what it finds. Per decision 2 this
  informs the work record, never the shape of the fix.

Both drive-stop orchestrations (dry-run and feature drive) call the same
`stopDevPane`, and server shutdown's kill-all path shares the same per-entry
teardown, so all inherit the fix.

### Proof — two stages (decisions 4 and 5)

**Stage 1, in-lap:** a new regression test spawns a real `bun` child process
on win32 that drives the real dev-pane lifecycle — `startDevPane` with a
command that produces the production tree shape (sidecar node host →
`cmd.exe` shim → grandchild holding a port; sidecar backend auto-selected
because Bun+win32), then `stopDevPane` — and asserts: returns in under 5
seconds, port freed, every pid in the tree gone. Skipped off win32 or when no
`bun` is on PATH. The agent runs it and records the evidence (timings, pids
before/after, port state) in its work record — "tests green" alone is not
acceptance. The existing node-side sidecar test stays, annotated that it does
NOT exercise the production runtime.

**Stage 2, post-merge ship gate:** cut a `next` prerelease, update the
production install (`bun add -g runcastle@next`), restart the server, and run
the literal repro from a talk session: `dry_run_drive` start → stop. Shipped
means: stop returns cleanly, `testdrive.teardown_started` appears in the
events table, port freed, zero orphans. **Do not test-drive this feature in
review before updating the install** — the stop path runs in the installed
server, and the old one will hang and leak again.

## Seams

- **`stopDevPane` / `startDevPane` (dev-pane service) — existing, primary.**
  The highest seam below the drive orchestration, and exactly where production
  hangs. Observes the whole implicated stack (registry teardown → sidecar
  backend → tree kill) as one behavior: return-within-deadline, port freed,
  tree dead. Stage 1 tests here, inside a Bun process.
- **`killProcessTree(pid)` (kill-tree module) — existing.** Unit seam for
  layer 1: promise settles promptly under Bun even for a nonexistent pid /
  already-dead tree; never rejects.
- **Registry `killTree(sessionId)` — existing.** Seam for layer 2: teardown of
  a wedged entry returns within the deadline; already-exited entries are
  skipped (pid-reuse guard preserved).
- **`dry_run_drive` MCP → events table — existing.** The Stage 2 ship gate:
  `testdrive.teardown_started` following a stop is the observable proof the
  server-side stop path completed end to end on the production install.

No new product seams. The only new surface is the test fixture the bun-child
regression test runs.

## Out of scope

- The `cmd.exe /d /s /c` interposition in `devSpawnTarget` (the structural
  reason a tree-kill is needed at all). Deliberate — `.cmd`/`.bat` shims must
  work — and not implicated.
- The sidecar `kill()` 500 ms backstop timer and the host stdio protocol.
- POSIX branch of the tree kill (process-group signal): untouched.
- The prep drive scripts (`.runcastle/drive-setup.ts` / `drive-stop.ts`) —
  verified working, committed to main during ideation (`75c486c`), not
  implicated.
- Enforcing the `engines >=1.3.14` Bun floor, or requiring a Bun upgrade.
- The dev-pane test file's unrelated intermittent `EPERM` temp-dir race in
  full parallel runs (known, Windows-only, passes in isolation).

## Open questions

- Does Bun's changelog between 1.3.4 and current name a fixed
  `execFile`/`promisify` bug? Diagnostic color for the work record either way;
  the fix ships regardless.
