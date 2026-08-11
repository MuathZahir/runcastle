# Decisions — Windows dev-pane teardown: kill the process the sidecar actually owns

## 1. Tree-kill lives on the `PtySession` interface as `killTree()`
**Decision:** Add a `killTree()` method to the `PtySession` interface, implemented per backend: the sidecar backend taskkills the **host process's own `child.pid`** (`/T /F` sweeps host → cmd shim → dev server in one walk); the native win32 backend keeps taskkill on `proc.pid`; POSIX keeps the process-group signal (`process.kill(-pid)`). `stopDevPane` calls `entry.pty.killTree()` instead of guessing a pid from `entry.pty.pid`.
**Why:** Fixes the pid ambiguity at the root — each backend kills a process it actually owns. The sidecar's `child.pid` is known synchronously at spawn (no `ready`-frame race, never the mutated inner pid). Rejected the alternative (a `{t:'killtree'}` protocol frame handled inside `pty-host.cjs`) because it makes teardown depend on the host being alive and responsive over stdin at exactly the moment teardown must be unconditional.

## 2. `killTree()` is async, awaited, with a bounded timeout
**Decision:** `killTree()` returns a `Promise` (async `execFile` for taskkill; POSIX signal send wrapped in the same promise shape). `stopDevPane` becomes async; both `git.ts` call sites (feature-drive stop, dry-run stop) `await` it before running the teardown hook, guarded by a short timeout (~5s) after which the stop proceeds anyway.
**Why:** `execFileSync` freezes the Bun event loop (1.5s UI polling, live terminal WebSockets) on every drive stop. The await preserves the existing ordering guarantee — pane dies first so its port is free when the teardown hook runs — while the timeout keeps a hung taskkill from wedging the drive-stop mutation. Teardown stays best-effort, matching the current swallow-all-errors semantics.

## 3. A sidecar-backend regression test joins the native one
**Decision:** Add a second Windows grandchild-kill test that forces the sidecar backend (`RUNCASTLE_PTY_BACKEND=sidecar`, `RUNCASTLE_NODE_BIN=process.execPath`, both set and restored around the spawn), runs the same cmd-shim → node-grandchild scenario, awaits the new async `stopDevPane`, and asserts both the grandchild and the sidecar host process (`child.pid`) are dead. The existing native-backend test stays alongside.
**Why:** Production on Bun+win32 selects the sidecar backend, but vitest runs under node so the existing test only ever exercised the native backend — the passing test was false confidence about the exact path that leaks. The sidecar is fully drivable under vitest via the two env overrides, so the production teardown path becomes the tested path.

## 4. On win32 the availability gate fails loud instead of skipping silent
**Decision:** Add a plain (ungated) test asserting `ptyAvailable()` is true on win32, so a Windows machine where node-pty cannot spawn fails the suite instead of silently skipping the teardown tests. The POSIX `skipIf` stays as-is.
**Why:** `describe.skipIf(!WIN_AVAILABLE)` is how "the regression test never ran on any machine" went unnoticed — a broken node-pty install on Windows looked green. node-pty ships its win32 prebuild in the tarball, so an unavailable PTY on Windows is a broken install worth failing on, whereas CI without Linux prebuilds is a legitimate, documented state.

## 5. Session terminals are out of scope
**Decision:** `killTree()` is wired into dev-pane teardown only. `endSession` / shutdown `killAll` keep plain `registry.kill()`; adopting tree-kill for session PTYs is a noted follow-up in the spec's out-of-scope section, not part of this feature.
**Why:** The observed leak is the dev pane poisoning subsequent drives. Session-end tree-kill changes semantics (force-killing an agent's whole subprocess tree) and widens the blast radius past the bug; once the interface method exists it is a one-line adoption later, decided on its own evidence.

## 6. Acceptance includes a live dry-run drive check, not just the suite
**Decision:** Beyond a green vitest suite and typecheck, the review phase verifies a real dry-run drive start→stop on this Windows machine under the Bun server (sidecar backend live), confirming the dev server's port is actually freed with no orphan process.
**Why:** The original taskkill fix also passed its tests while production kept leaking — the tests ran the native backend, production the sidecar. The freed port after a live drive stop is the observable this feature exists for.
