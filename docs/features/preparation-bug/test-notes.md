# Test notes

## Lap 1

- [ ] The bun-child regression test's "every pid in the tree died" assertion is effectively vacuous — the fixture's process-table capture fails silently.

WHAT I DID: on feature/preparation-bug (Bun 1.3.4, win32) I ran the new test five times — `bun run test packages/server/test/dev-pane-stop-bun.test.ts` and the fixture directly (`bun packages/server/test/fixtures/dev-pane-stop-bun.ts`).

WHAT HAPPENED: every run reported `treePidsBefore` containing exactly ONE pid — the sidecar host. Example run: `hostPid:162736, ptyPid:168348, treePidsBefore:[162736], aliveAfter:[]`. The pane's own `ptyPid` never appears in the list, even though the fixture reads it one line before the walk. With a PowerShell probe polling alongside a run I caught the port-holding grandchild live: `142656 bun.exe ppid=174616`, and 174616 was that run's `ptyPid` — so the cmd.exe shim and the bun grandchild are real members of the pane's tree that the walk missed.

ROOT CAUSE I CONFIRMED: `listProcesses()` shells out through `shellCapture()`, and that command fails outright. Replicating the exact spawn under bun —
  spawn(ComSpec, ['/d','/s','/c', 'powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Csv -NoTypeInformation" > "C:\...\proclist.txt"'])
— exits 1 with `The filename, directory name, or volume label syntax is incorrect.` and writes no file. `cmd /s` strips the first and last quote of the whole command string; the last character here is the closing quote of the redirect target, so the path is left unbalanced. `shellCapture`'s readFileSync then throws, resolves '', `listProcesses` returns [], and `treePids` degenerates to `[root]`. A second probe that watched for `%TEMP%\rc-stopbun-*\proclist.txt` for 60s never saw the file appear.

WHAT I EXPECTED: `treePidsBefore` listing the host, the cmd.exe shim and the bun grandchild, so that `aliveAfter: []` means what decision 4 and the test's own docblock claim.

IMPACT: the fix itself is still demonstrated — `portFreed: true` is genuine and is what actually proves the grandchild died — but the pid half of the evidence proves only that the sidecar host pid died. A future regression that killed the host while orphaning the shim, or left a grandchild alive that had released its port, would sail past the `aliveAfter` assertion. This is a hole in the proof the review ticket asks the human to rely on, not a product bug.
- [ ] The new teardown instrumentation names a pid that is NOT the pid handed to the kill, on exactly the backend production uses.

WHAT I DID: ran the fixture directly under bun and read the stderr breadcrumbs next to the evidence line from the same run.

WHAT HAPPENED:
  [pty] backend=sidecar (Bun+win32: node-pty ConPTY input pipe (node:net socket) unusable under Bun)
  [pty-teardown] drive:stopbun-fixture: start exited=false pid=143788 t=1786966744164
  [pty-teardown] drive:stopbun-fixture: killTree settled after 703ms
  [pty-teardown] drive:stopbun-fixture: done after 704ms deadline=no
and the evidence line for that same run read `hostPid:154344, ptyPid:143788`. So the logged pid is the inner node-pty pid, not the host.

Reading the source confirms it: `tearDownEntry` logs `entry.pty.pid` (registry.ts:95-97), while the sidecar's `killTree()` deliberately roots the tree at `child.pid` on win32 — "its pid is known synchronously here, so it is never the inner node-pty pid the async `ready` frame swaps into `pid`" — and the `get pid()` accessor returns exactly that swapped-in value. The two numbers differed on all four fixture runs I did.

WHAT I EXPECTED: the spec's instrumentation rider asks for "the pid handed to the kill". Someone self-locating a future recurrence from these breadcrumbs would inspect or taskkill the wrong process, see a tree that looks untouched, and reasonably conclude the tree-kill targeted the wrong root.

Not applied (review only): logging the root the backend actually kills — or both pids — would close it. Everything else asked for in the rider is there and legible: pane id, exited flag, start timestamp, killTree settle time, total elapsed, and an explicit `deadline=no|FIRED` verdict.
- [ ] The documented EPERM flake reproduced in the full parallel run, is green in isolation, and leaks a temp dir every time it fires.

WHAT I DID: `bun run typecheck`, then the full suite with `GIT_ASKPASS` and all six inherited `RUNCASTLE_*` asset vars unset, then re-ran the one failing file on its own.

WHAT HAPPENED: typecheck exit 0 across all four packages plus the scripts project. Full suite: 1 failed | 1774 passed | 10 skipped over 120 files in 96s. The single failure is the known one —
  FAIL packages/server/test/dev-pane.test.ts > stopDevPane on Windows > kills the sidecar host and its grandchild — the backend production runs
  Error: EPERM, Permission denied: \\?\C:\Users\user\AppData\Local\Temp\rc-devpane-t0szs9  (dev-pane.test.ts:209, in afterEach)
The handoff records this at :198; the new annotation added 11 lines above it, so :209 is the same afterEach `rmSync`. Re-run in isolation: 11 passed | 2 skipped, green. So it is the documented Windows parallel-run temp-dir race, not a regression from this branch.

WORTH KNOWING: because the `rmSync` throws, the scratch dir survives the run. Afterwards `%TEMP%` held `rc-devpane-t0szs9` (created 15:39, by my run) and `rc-devpane-LLPNTq` (14:08, pre-existing, not mine). Each full-suite run that trips this flake leaves one of these behind. I removed only the one my run created; the older one is untouched.

The spec puts this race out of scope, so I am not proposing a fix — flagging it because "modulo the documented flake" now also means "modulo one leaked temp dir per full run".
- [ ] SUMMARY — review pass on feature/preparation-bug (test-suite review; no browser, no test drive).

FIRST, WHY I DID NOT START A REVIEW DRIVE. Decision 5's corollary says not to test-drive this feature before the install is updated, because the drive's stop runs in the *installed* server. I checked rather than assumed: the global install is runcastle 1.2.6, and its bundled `index.js` still contains the old `killProcessTree` built on `promisify(execFile)`. So `review_drive start` → `stop` would have re-run the exact bug, hung the stop, leaked a tree and held the drive slot. I skipped the drive and worked the ticket directly, which cost nothing — every acceptance criterion here is a test-suite criterion. I switched the checkout to feature/preparation-bug by hand and put it back on main afterwards. No repo files were created, edited or committed.

PROVEN IN-LAP:
1. The bun-child regression test runs for real under the production runtime — not skipped. Evidence line reports `isBun:true, bun:"1.3.4", platform:"win32", ptyBackendOverride:null`, i.e. the sidecar backend was auto-selected exactly as production selects it.
2. Teardown is fast and complete. Five runs (2 via vitest, 3 driving the fixture directly): stopMs = 694, 704, 705, 667, 743 — all an order of magnitude inside the 5000ms deadline, `stopWithinDeadline:true`, `portFreed:true`, `registryCleared:true`, exit 0 every time. This is the same path that previously hung for minutes.
3. Not flaky. Five consecutive runs, all green, each taking a fresh ephemeral port (61711, 55213, 51874, 56709, 59974). Afterwards: no `holder.mjs` process, no `rc-stopbun-*` scratch dir, no bun/node process left from any run, and none of those ports still bound. The only live pty-hosts on the box are the three parented to the user's own server (pid 181724, port 4512), which were there before I started.
4. Typecheck exit 0. Full suite 1774 passed / 10 skipped / 1 failed, the single failure being the documented EPERM parallel-run race, green on isolated retest — see its own note.
5. Instrumentation is legible and self-locating: `[pty-teardown] <paneId>: start exited=false pid=… t=…` / `killTree settled after Nms` / `done after Nms deadline=no|FIRED`, plus registry-miss lines on the miss paths. One defect in it — the pid it names is not the pid killed — has its own note.
6. The old node-side test carries the annotation, and it is a good one: an eleven-line block above `describe('stopDevPane on Windows')` telling the reader outright that a green run there is evidence about node only, and pointing at `dev-pane-stop-bun.test.ts` for the production runtime.

WHAT I FOUND: two findings, neither of them a product bug, both about the proof rather than the fix. (a) The regression test's `treePidsBefore` is always a single pid because the fixture's process-table capture fails silently, so `aliveAfter: []` proves only that the sidecar host died — `portFreed` is carrying the whole tree claim. (b) The teardown log names the inner node-pty pid, not the pid actually handed to the tree-kill. Details and repro in the two notes above.

MY READ: the fix is real. Under Bun 1.3.4 on win32 — the precise combination that hung four times — the stop now returns in ~0.7s with the port freed, repeatedly. The evidence artifact is weaker than it looks, but the strongest single line in it (`portFreed:true`, on a port a live grandchild was genuinely serving) is sound.

THE SHIP GATE STILL AHEAD — nothing below is done, and decision 5 says the feature is not done until it passes:
  1. Merge, then cut a `next` prerelease.
  2. `bun add -g runcastle@next`.
  3. Restart the server.
  4. From a talk session, run the literal repro: `dry_run_drive` start → stop.
  5. Expect: the stop returns cleanly, `testdrive.teardown_started` appears in the events table, the port is freed, and zero processes are orphaned.
WARNING, the same one I acted on above: do NOT run a review-phase test drive before step 2 lands. The stop path executes inside the currently-installed server, which still has the broken `promisify(execFile)` code — it will hang again and leak the tree, the port and the per-drive data dir, and you will be hunting pids by hand. Update the install first, then drive.
