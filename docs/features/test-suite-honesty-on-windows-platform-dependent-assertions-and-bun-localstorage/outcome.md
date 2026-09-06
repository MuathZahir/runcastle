# Outcome — Test suite honesty on Windows: platform-dependent assertions and Bun localStorage

Make the test suite pass on this Windows/Bun machine: fix the POSIX-path open-project assertions, the Bun --localstorage-file SecurityError crashing three web test files, and audit the ~10 phantom server test failures.

- Shipped: 2026-09-06
- Lap: 1

## 1. Web tests: pin platform in open-project, shim Bun localStorage in setup

# Ticket 1 — web tests: platform pin + Bun localStorage shim

## What was done

`apps/web/test/open-project.test.tsx` now pins `navigator.platform` to `'Linux x86_64'` in its
`beforeEach` and drops the pin in `afterEach`; every path and assertion in the file is untouched, and
no product code was changed. `vitest.setup.ts` — the per-worker firewall that already strips
`RUNCASTLE_*` — now also probes `globalThis.localStorage` (property read plus a set/remove round
trip, in a try/catch) and, when that is unusable, defines an in-memory `Storage` over it with
`configurable: true, writable: true` so `projects.test.ts` can keep swapping the descriptor. The
in-place shim worked, so the `--localstorage-file` escape hatch was not needed and the root `test`
script is unchanged. Deviation from the ticket: instead of saving and restoring the platform
descriptor the way `projects.test.ts` does for localStorage, the restore is a plain `delete` of the
own property — happy-dom's `platform` is a prototype getter, so the descriptor branch was dead code.

## Surprises

This burn container is **Linux**, not the Windows host the feature is about, so neither bug
reproduces here by default. Both were reproduced deliberately instead: pinning `'Win32'` in the test
file gave exactly the 3 reported open-project failures, and a temporary throwing `localStorage`
getter injected at the top of `vitest.setup.ts` gave the 4 `beforeEach` crashes in `project-nav` and
`workspace-navigation`; both simulations went green with the fixes and were then removed. Root cause
confirmed for each: happy-dom derives `navigator.platform` from a user agent built out of
`process.platform`, so on Windows it reads `X11; Win32 x64` and `isWindowsLike` matches; and vitest
only copies a window global onto `globalThis` when the key is free, which is why Bun's placeholder
survives happy-dom setup. Also note the shim now installs on Linux too, where Bun defines no
`localStorage` global at all — that is deliberate, it makes the two hosts run the same conditions.

## Left undone

`bun run test` in this container ends with 8 server failures in `burn-slot-workspace.test.ts`
("fatal: repository /home/agent/cache/tmp/... does not exist" — its temp workspaces cannot be
created here) and `dev-pane.test.ts` ("kills the child process tree"). They are ticket 2's audit
territory; I confirmed they are not mine by re-running both files with the localStorage shim
disabled — same 8 failures. All 55 `apps/web/test` files pass, with and without the simulated Bun
placeholder. No drive-machinery change was needed: this ticket adds no service, env var, seed or
process, so nothing under `.runcastle/` was touched or run.

## 2. Server test audit: triage and fix or quarantine the ~10 Windows failures

# Ticket 2 — server test audit (triage and fix or quarantine)

## READ THIS FIRST: the audit could not be run on Windows

The ticket says "run `bun run test` on this Windows machine and collect the actual
red set". **The burner sandbox is Linux** (`process.platform === 'linux'`, WSL2
kernel, Bun 1.3.14) — there is no Windows host here, so the brief's ~10 Windows
failures could not be reproduced or observed. Everything below is therefore split
into two honest halves: what I *measured* (the Linux red set, fixed and verified)
and what I *proved by reading the product's own source and this repo's own written
records* (the Windows causes, fixed but **unverified on Windows**). Someone with
the Windows machine still has to run `bun run test` once to close criterion 6.

## What was done

Measured first. `env -u GIT_ASKPASS bun run test` on this sandbox: **177 files,
2797 tests, 8 failed** across two files — nothing like the prompt's stated baseline
of 118 files / 1768 passed / 0 failed, which was written for the Windows machine.
After this ticket: **1 failed**, and that one is a sandbox artifact (below).

Triage table — every failure I could see or prove, one class each:

| Test | Class | Action |
|---|---|---|
| `burn-slot-workspace` › "driven for real" (7 cases) | environmental | **Fixed.** Real test bug: two chained `replaceAll`s. Temp dirs come from `os.tmpdir()`, which inside a burn container is `/home/agent/cache/tmp` (`burnCacheEnv` sets `TMPDIR`), so the `BURN_CACHE_MOUNT` pass rewrote the prefix of the workspace path the `SANDBOX_WORKSPACE_PATH` pass had just inserted; the script then cloned from a directory that never existed. Now one pass. 33/33 green. |
| `dev-pane` › "kills the child process tree" | environmental (sandbox, **not** win32) | **Left failing, deliberately.** See below. |
| `pty` › native backend "delivers written keystrokes (write→echo INPUT path)" | platform-fundamental | **Quarantined** with `it.skipIf(isWin)` + a comment naming why. |
| `feature-create`, `projects`, and the other git-heavy server files | environmental | **Fixed** via a win32-only timeout budget. |
| `docs-watch`, `git`, `merge-conflict`, `project-session`, `feature-create` teardown/worktree removal | environmental | **Fixed** via a `rmTemp()` retry backstop. |

The three fixes:

1. **PTY native write path on win32 (class 2).** `packages/server/src/pty/pty.ts`
   states flatly that node-pty 1.1.0 drives ConPTY input through a `node:net`
   socket Bun cannot use, so `write()` throws `ERR_SOCKET_CLOSED` — which is
   precisely why `selectBackend()` routes Bun+win32 to the sidecar. `bun run test`
   runs vitest *under Bun*, so on Windows the suite sits on the broken side of that
   incompatibility while asserting a path the product never takes there. Targeted
   per-test `it.skipIf`; the sidecar case beside it still covers the shipped input
   path. Also corrected the file header, which claimed the vitest suite runs under
   node — it does not, and that stale claim is what made the failure look phantom.

2. **`rmTemp()` retry backstop (class 1).** `rmSync` defaults to `maxRetries: 0`.
   On POSIX an open handle never blocks an unlink; on Windows a directory a git
   child or an `fs.watch` handle touched moments ago fails with `EBUSY`/`EPERM`
   because the handle is released asynchronously — a red test whose assertions all
   passed and whose *teardown* threw. Two files already carried the retry options
   inline, so I extracted them as `rmTemp()` beside `tmpRepo()` and adopted it at
   the sites that can fail a case or leak a worktree. No assertion changed.

3. **win32-only timeout budget (class 1).** Each git-heavy server case spawns
   dozens of `git` children. Measured here: 600–1100ms against vitest's 5s default.
   On Windows every spawn pays process creation plus on-access AV scanning of a
   fresh temp tree, and `docs/features/ux-issues/test-notes.md:68` records
   `feature-create` and `projects` — two of the brief's seven — timing out at
   exactly 5s on that machine "with nothing wrong in them". `testTimeout`/
   `hookTimeout` widened to 30s **on win32 only**, so POSIX and CI keep the tight
   guard that catches a real hang.

Four slice commits, `ticket(2): …`. Typecheck clean across core/server/web/scripts.

## Surprises

- **The sandbox is Linux, so the ticket's premise is unrunnable here.** This is the
  headline. Fixes 1–3 are argued from the product source and this repo's own
  written records, not from a red Windows run. Fix 1 I consider proven (the source
  documents the incompatibility and says it was reproduced); 2 and 3 are
  well-evidenced but unverified on Windows.
- **The stated baseline in the burn prompt is wrong for this environment** — it
  promises 118 files / 0 failed, and the sandbox actually runs 177 files and was
  already 8-red before I touched anything.
- **The server suite is already far more Windows-aware than the brief implies.**
  `delete`, `dry-run-drive`, `drive-hooks`, `dev-script`, `dev-pane`, `fsbrowse`,
  `burn-attachments`, `git` all carry platform branches or targeted skips; every
  POSIX-shell spawn I found is win32-guarded; git identity and `core.autocrlf
  false` are set in every fixture repo. `vitest.setup.ts` already strips
  `RUNCASTLE_*`. So inherited env, git config and shell assumptions are all
  **ruled out** as causes — which is what left timeouts, handle-release races and
  the Bun/ConPTY incompatibility.
- **`dev-pane` › "kills the child process tree" fails in the burn container for a
  reason that is neither a product bug nor a Windows issue, and I deliberately did
  not touch it.** PID 1 in this container is `sleep`, not an init reaper, so killed
  children become zombies (`ps` shows several in state `Z` parented to PID 1). A
  zombie stays in its process group until reaped, so `process.kill(-pgid, 0)`
  still succeeds and `expect(pidAlive(-pgid)).toBe(false)` fails. The assertion is
  correct and valuable — it pins that the dev server is not orphaned holding its
  port — and there is no honest predicate for "container without a reaper" that
  would not also silence it on real Linux and CI. Quarantining it would have been
  the dishonest move, so it stays red here.
- No **genuinely-red-on-main product bug** turned up. Nothing needs parking as a
  draft feature (decision 1). The one real bug found was in test code
  (`burn-slot-workspace`) and was small enough to fix here.

## Left undone

- **Verification on Windows.** Someone must run `env -u GIT_ASKPASS bun run test`
  on the Windows machine. If failures remain, the two suspects I could not settle
  are listed next.
- **`docs-watch` › "debounces a write burst into a single event".** Unfixed and
  unverified: it writes 20 files and asserts `toHaveLength(1)`. If Windows'
  `ReadDirectoryChangesW` spreads delivery more than the 300ms
  `DOCS_WATCH_DEBOUNCE_MS` apart, a straggler arrives after the flush and a second
  event is emitted. I left it alone because the only fixes I could see either
  weaken the assertion (forbidden) or guess at a number I cannot measure.
- **`burn-attachments.test.ts:296-297` has the same chained-`replaceAll` shape** as
  the bug I fixed, with `SANDBOX_WORKSPACE_PATH` then `ISOLATED_REPO_PATH`. It does
  *not* fire today only because `/home/agent/repo` is not a prefix of the temp
  dirs. It is latent, and it is one constant away from the same failure.
- **59 other `rmSync(…recursive…)` call sites** in `packages/server/test` still
  lack the retry backstop. I adopted `rmTemp()` only where a failure could redden a
  case or leak a git worktree; a blanket sweep was more diff than the ticket asked
  for.

## Drive machinery

Checked, not run (the sandbox has no services). This ticket adds no service, no
required env var, no seed and no process, so no drive edit is triggered. Confirmed
`.runcastle/drive-setup.ts` and `.runcastle/drive-stop.ts` still exist and are
untouched by this diff. `bash -n` was not applicable — both are TypeScript run by
Bun, and they typecheck as part of `bun run typecheck`, which is clean.

## 3. Review: verify the suite is honestly green on Windows

Reviewed in Gates mode: read the branch diff along both axes; there was no UI surface to drive, and the verify commands could not be run against this lap.

This lap does not change anything you can see in the app. It is housekeeping on the test suite, aimed at one thing: making `bun run test` tell the truth on your Windows machine instead of standing permanently red for reasons that have nothing to do with the product. Three separate causes were addressed. The open-project screen's tests now pin the browser platform to a POSIX value, so the POSIX paths they type are no longer rejected by the screen's own deliberately Windows-aware path validation before the test can see what it came to see. The per-worker test setup now hands every worker a working in-memory `localStorage`, because running vitest under Bun leaves Bun's placeholder in place and that placeholder throws the moment anything touches it, crashing whole web test files before a line of app code runs. And on the server side, temp-directory teardown gained a retry backstop for Windows' habit of holding a handle open a moment too long, one genuinely broken test was fixed, one PTY case that cannot work under Bun on Windows was quarantined with a written reason, and the time budget for the git-heavy tests was widened on Windows only.

The Windows-aware path validation and the OpenProject screen are untouched, as the spec required — no product code changed at all, and there is exactly one new skip in the whole diff, a targeted one carrying a comment that names why. On the shape of it, this is a careful lap.

What you need to know is that nobody has ever run it on Windows. Both implementers worked in a Linux container and say so plainly in their own write-ups; they reproduced the two web bugs by simulation and argued the three server fixes from the source rather than from a red-to-green run. I could not close that gap either — your checkout is sitting on the flow-redesign branch, nearly a hundred files away from this lap, and I am not allowed to move it or build a copy. So the feature's entire acceptance bar, "green on this Windows machine", is still unverified. Running `bun run test` and `bun run typecheck` on this branch is the one thing left, and it is worth doing before you merge.

Two things to keep an eye on when you do. The Windows teardown backstop was applied to the seven files the original bug report named, and roughly fifty more teardown sites across the server tests still take the unretried path — if the Windows run comes back red on a teardown rather than an assertion, that is where to look. And the platform pin in the open-project tests covers `navigator.platform` but not `navigator.userAgent`, which the same check also reads; it works today only because happy-dom's user-agent string happens to say "Win32" rather than "Windows", so the host-dependence the ticket set out to remove is closer to one string change away than it looks.

Within the standards read, the worst issue is that duplication: a helper extracted with a rationale that applies everywhere, adopted in a seventh of the places it fits. Within the spec read, it is the Windows-only timeout widening, which is a real and well-argued fix but is a fourth kind of answer that the feature's own decision record does not contain, and it lifts the hang guard sixfold on the platform you dogfood from. Neither is a reason to hold the lap; both are reasons to read the Windows run carefully when it happens.

## 4. vitest.config.ts still describes the setup file as only stripping RUNCASTLE_*, which stopped being true this lap

# ticket(4) — vitest.config.ts comment now names both setup-file jobs

## What was done

`vitest.config.ts` had a one-line comment above `setupFiles: ['./vitest.setup.ts']`
saying only "Strips inherited RUNCASTLE_* state before anything imports core's
paths." That stopped being the whole truth when this lap gave `vitest.setup.ts` a
second job: installing an in-memory `localStorage` when Bun's throwing placeholder
is in the way. The comment now reads as a three-line note that opens with the same
phrase the setup file's own header uses ("Test-env firewall") and names both jobs —
the `RUNCASTLE_*` strip and the `localStorage` swap. That is the entire diff: one
file, three lines added, one removed. No code, no behaviour, nothing else touched.

I re-ran the ticket's repro step. The `git show <feature-branch>:...` form in the
ticket could not run verbatim — this burn clone does not carry the feature branch
ref, only my temp branch forked from it — so I ran the equivalent against `HEAD`.
The two descriptions of `vitest.setup.ts` now agree: both call it the test-env
firewall and both name the runcastle env and Bun's `localStorage`. The criterion
holds.

## Surprises

Two, both about the verify commands rather than about my change.

`bun run typecheck` is clean (exit 0, all four projects). `env -u GIT_ASKPASS bun
run test` came back with **one failure**, in `packages/server/test/dev-pane.test.ts`
at line 183: `expect(pidAlive(-pgid)).toBe(false)` — a POSIX process-group kill
assertion checking that a spawned shell and its backgrounded `sleep` were reaped.
It reproduces on a targeted single-file re-run, so it is not a flake, but it cannot
be mine: my diff is a comment, and the assertion is about process-group reaping in
this Linux container. It is unrelated to the setup file, to `localStorage`, and to
anything this lap did. I did not fix or quarantine it — that is outside this
ticket, and the feature's own decision record parks non-trivial real bugs rather
than absorbing them.

The prompt's stated baseline is also stale in shape: it predicts "118 files, 1768
passed, 10 skipped", while the suite as it stands is 177 files / 2797 tests
(175 passed files, 1 failed, 1 skipped). Worth knowing before someone reads a
future run's totals as a regression.

No drive-machinery change was needed or made — this ticket adds no service, no
required env var, no seed, and no process, so none of the `.runcastle/` triggers
fire. I did not run the drive scripts (correctly: there are no services here).

## Left undone

The `dev-pane.test.ts` process-group failure above, deliberately. Someone should
decide whether it is container-environmental (this sandbox's PID/process-group
handling) or genuinely red, and quarantine or fix it under the lap's own triage
rule. Separately, the ticket-3 review flagged two open items that remain open and
that I did not touch: the Windows temp-tree teardown retry helper is adopted in
7 of ~50 eligible sites, and the open-project platform pin covers
`navigator.platform` but not `navigator.userAgent`, which the same check reads.
