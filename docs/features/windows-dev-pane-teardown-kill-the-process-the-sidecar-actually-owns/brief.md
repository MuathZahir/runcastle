## Why this feature exists

A preparation dry run on the author's Windows machine has now failed the same way **twice**. The first attempt produced a quick change (`dry-run-fallout-windows-teardown-typecheck-fixes`, merged) that added `killProcessTree` with `taskkill /T /F`. That fix is correctly written and is genuinely running in the installed build — and the leak is unchanged. Stop still times out, the dev server stays bound on 4599, the temp data dir stays fully intact, and the teardown hook never runs.

The quick change failed because its ticket assumed `stopDevPane` owns the process it is killing. On Windows it does not. That assumption is the thing this feature has to revisit, and it is a design question, not a patch — which is why this is a feature and not a third quick change.

## What is established (verified against source, do not re-litigate)

**The Windows production path is the sidecar, not native node-pty.** `packages/server/src/pty/pty-sidecar.ts:9-17` states it plainly: under Bun on win32, node-pty's ConPTY input pipe is a `net.Socket` that throws `ERR_SOCKET_CLOSED` and silently drops every keystroke, so the server hosts node-pty inside a real `node` child process and talks newline-JSON to it. Every Windows test drive therefore runs its dev command as a *grandchild of a grandchild*: server → node sidecar → `cmd.exe` shim (`devSpawnTarget`, `dev-pane.ts:61-66`) → the actual dev server. Observed live: `node 62320` (sidecar) → `cmd 62032` → `bun 24324`.

**The regression test has never executed on any machine.** `packages/server/test/dev-pane.test.ts:39-40`:
```
const AVAILABLE     = process.platform !== 'win32' && ptyAvailable()
const WIN_AVAILABLE  = process.platform === 'win32' && ptyAvailable()
```
`ptyAvailable()` (`:29-38`) probes `createNativePtySession` — the *native* backend, precisely the one that does not work on win32+Bun. So `WIN_AVAILABLE` is false on the machines that have the bug, and `platform === 'win32'` is false in the Linux container. The host reports 9 passed / 2 skipped; the Linux run skipped them too. The test is structurally incapable of running, which is why a merged "fix" reached a user's machine untested.

## The leading hypothesis (strong, but confirm before fixing)

`killProcessTree` (`dev-pane.ts:159-170`) calls `execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'])` — **synchronous**, blocking the event loop — inside a `try/catch` that swallows every failure.

If that call blocks, `stopDevPane` never reaches `reg.kill(paneId)`, the teardown hook never runs, and the temp tree is left untouched. That one mechanism explains all four observations simultaneously: nothing died (not even the sidecar), the hook never ran, the temp tree was intact down to its empty subdirs, and stop timed out. A merely *wrong* pid would make `taskkill` fail fast and get swallowed — which explains the surviving processes but NOT the hang or the intact temp tree. Start by instrumenting whether `execFileSync` returns at all.

**The pid question is real regardless.** `pty-sidecar.ts:93` seeds `pid` with the sidecar node child's pid, and `:130` overwrites it with node-pty's `proc.pid` only if a `ready` frame carries one. So what `entry.pty.pid` names depends on a race, and node-pty's ConPTY pid semantics are their own trap (it has historically reported a helper/conhost pid rather than the spawned command). `/T` on the sidecar pid would take the whole chain; `/T` on the shim would take cmd + bun. Neither happened, so establish empirically which pid arrives.

**The sidecar's own backstop cannot help.** `pty-sidecar.ts:235-243` falls back to `child.kill()`, which on Windows kills the sidecar and *orphans* its descendants rather than reaping them.

## The design questions to grill

1. **Where does teardown belong?** `stopDevPane` is reaching across a process boundary to kill something it did not spawn. The pty-host (`pty-host.cjs`) holds the real node-pty handle and already has a `kill` frame. Arguably the host should own tree-kill and the server should ask it, making the pid question internal. Weigh that against the host being an untyped `.cjs` file that must stay spawnable by system `node`.
2. **Which pid is authoritative, and how do you stop guessing?** Options include waiting for `ready` before considering a pane killable, having the host report the shim pid explicitly, or killing the sidecar's whole tree from the server (which is well-defined, since the server DID spawn it).
3. **Sync vs async, and what happens on timeout.** A blocking `execFileSync` in the stop path can hang the server. Decide on async + a bounded timeout, and what stop reports when the timeout is hit.
4. **Stop swallowing failures.** The current catch means a teardown that does nothing is indistinguishable from one that worked. The dry run had to be diagnosed by inspecting the process table by hand. Decide what surfaces to the drive UI and the event timeline.
5. **How does a Windows-only, sidecar-only path get tested so the test RUNS?** This is not optional polish — an unrunnable test is what let the first fix ship broken. Consider gating on the sidecar backend rather than the native addon, and making a skip on a win32 host a loud failure rather than a silent skip.

## What this feature must NOT swallow

- **The web typecheck fix (#2) and the test EPERM fix (#3)** — those went to a separate quick change. This feature is only the Windows PTY teardown path.
- **Redesigning the sidecar protocol at large.** Input handling, resize, scrollback and the WS layer are working; touch the protocol only where tree-kill requires it.
- **Making the dry run pass by loosening the verdict.** The drive keys are honestly unverified and must stay that way until a real start→stop cycle leaves no orphan. Do not weaken `dryRunVerdict` to get a green.

## Definition of done

A full preparation dry run on the author's Windows machine completes start→stop with: no process left from the chain, port 4599 free, the temp data dir removed by the teardown hook, and the drive keys legitimately marked verified. Plus a regression test that actually executes on that machine and fails if the leak returns.
