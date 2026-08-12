# Windows dev-pane teardown: kill the process the sidecar actually owns

## Problem

Stopping a test drive (or preparation dry run) on Windows is supposed to leave the machine clean: dev server dead, port free, file locks released, ready for the next drive. It still doesn't. The earlier taskkill fix targets `entry.pty.pid` — but under the sidecar PTY backend (the one production actually selects on Bun+win32) that pid starts life as the node host's pid and is silently swapped to node-pty's inner pid when the async `ready` frame arrives, so the server is guessing at a pid across a process boundary it doesn't own. The kill is also `execFileSync`, freezing the whole Bun event loop (1.5s UI polling, live terminal WebSockets) on every drive stop. And the regression test that would have caught this exercises only the native backend — vitest runs under node, production runs under Bun — behind a `skipIf` gate that turns a broken node-pty install into a silent green run. The result: a passing suite, and drives that still leak their dev server.

## Approach

From the user's perspective: stopping a drive reliably frees the dev server's port, immediately, without stalling the UI — and the tests that claim this actually test the code path production runs.

The shape of it:

- **`killTree()` joins the `PtySession` interface.** Each backend kills a process it actually owns, instead of `stopDevPane` guessing a pid:
  - **Sidecar:** taskkill `/T /F` on the host process's own `child.pid` — known synchronously at spawn, immune to the `ready`-frame race — sweeping host → cmd shim → dev server in one walk. (A `killtree` protocol frame was rejected: teardown must not depend on the host being alive and responsive over stdin.) Under the POSIX escape hatch (`RUNCASTLE_PTY_BACKEND=sidecar` off-win32) it degrades to the group signal so the override stays coherent.
  - **Native win32:** taskkill `/T /F` on node-pty's pid (the cmd shim), as today.
  - **Native POSIX:** the existing process-group signal (`process.kill(-pid)`), unchanged.
- **`killTree()` is async and awaited.** It returns a `Promise` (async `execFile` for taskkill; the POSIX signal wrapped in the same shape), guarded by a ~5s timeout after which teardown proceeds anyway. `stopDevPane` becomes async and preserves its sequencing: tree-kill first, then the registry kill (so attached sinks still receive their `ended` status frame), then removal. It stays idempotent and best-effort — unknown/dead panes and failed taskkills are swallowed as today.
- **Both drive-stop paths await the pane's death before the teardown hook runs**, preserving the existing guarantee that the port is free by the time the project's stop command goes looking for the things it must drop.
- **The sidecar backend becomes the tested path.** A second Windows grandchild-kill test forces the sidecar via the existing env overrides (`RUNCASTLE_PTY_BACKEND=sidecar`, node pinned to the vitest process's own executable), runs the same cmd-shim → node-grandchild scenario, and asserts both the grandchild and the sidecar host die. The native-backend test stays so that path never rots.
- **The availability gate fails loud on win32.** An ungated test asserts the PTY-availability probe succeeds on Windows — node-pty ships its win32 prebuild in the tarball, so an unavailable PTY there is a broken install worth failing on, not a skip. The POSIX `skipIf` stays (CI without Linux prebuilds is a legitimate, documented state).
- **Stale prose is corrected.** The dev-pane module's doc comments still describe the kill as taskkill-from-the-pane's-pid; they are rewritten to describe per-backend ownership.

## Seams

- **`stopDevPane` (existing, signature becomes async)** — the primary seam and the one the regression tests drive end-to-end: spawn a pane whose command starts a grandchild, stop it, observe grandchild death, host death (sidecar case), port/registry state, and idempotency on a second call.
- **`PtySession.killTree()` (new method on an existing interface)** — the per-backend ownership seam; observable per backend as "the process tree rooted at what this backend owns is gone." Exercised through `stopDevPane` rather than in isolation.
- **The PTY-availability probe in the dev-pane suite (existing helper, newly asserted)** — lets a test observe "this machine can run the teardown suite at all," turning the silent-skip failure mode into a visible red on win32.
- **Drive stop via the git service (existing, unchanged shape)** — the highest seam: a live dry-run drive start→stop under the Bun server, verified at review by observing the dev server's port actually freed (decision 6). Not vitest-automated; this is the manual acceptance check.

## Out of scope

- **Session terminals.** `endSession` / shutdown `killAll` keep plain `registry.kill()`. Adopting `killTree()` for session PTYs is a one-line follow-up to be decided on its own evidence — force-killing an agent's whole subprocess tree is a semantics change, not a bug fix.
- **POSIX behavior changes.** The process-group kill path is correct and stays byte-for-byte in behavior.
- **Broken-parent-chain trees.** `taskkill /T` walks live parent links; a dev command whose intermediate process exits early can still orphan a leaf. No dev command in use exhibits this; job-object containment would be the fix and is not attempted here.

## Open questions

None — all decisions locked in `decisions.md`; the only deferred items are recorded above as out of scope.
