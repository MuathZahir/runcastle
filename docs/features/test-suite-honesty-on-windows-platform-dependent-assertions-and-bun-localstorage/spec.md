# Test suite honesty on Windows: platform-dependent assertions and Bun localStorage

## Problem

`bun run test` is red on this Windows/Bun development machine even though every failing file is byte-identical to main. A permanently red suite makes real regressions invisible: nobody can tell a new failure from the standing noise. Three distinct causes were verified during the merge session that surfaced this (2026-09-04):

1. The open-project component tests feed POSIX paths into a flow whose client-side absolute-path validation is deliberately Windows-aware (findings F17.4), so on a Windows host the path is rejected before the stubbed server error appears and the assertions fail.
2. Running the vitest bin under the Bun runtime makes Bun's global `localStorage` throw `SecurityError: Cannot initialize local storage without a --localstorage-file path` in `beforeEach`, before any app code runs, crashing several web test files that touch `localStorage`.
3. Roughly ten server tests (`docs-watch`, `feature-create`, `git`, `merge-conflict`, `project-session`, `projects`, `pty`) fail for unaudited environmental reasons. The `RUNCASTLE_*` env firewall already exists in the per-worker setup file, so the likely causes are PTY-on-Windows and git configuration, not inherited env.

## Approach

Make the suite honestly green on this machine, without changing any product behaviour. Acceptance bar: `bun run test` fully green on this Windows machine, with every skip carrying a written reason (decision 4).

**Open-project tests (decision 2).** Pin `navigator.platform` to a POSIX value (e.g. `'Linux x86_64'`) in the open-project test file's setup and keep the existing POSIX paths and assertions untouched. The Windows-aware validation itself stays covered by the existing pure-function platform tests, which take `(platform, userAgent)` strings and run identically on any host. No change to `isAbsoluteRepoPath`/`OpenProject` semantics.

**Bun localStorage (decision 3).** Fix once, in the existing per-worker test-env firewall setup file (the same one that strips `RUNCASTLE_*`): when `globalThis.localStorage` is Bun's throwing placeholder, replace it with an in-memory `Storage` stub. This keeps the Bun-everywhere convention (no forcing vitest under node), avoids an on-disk state file shared across workers, and repairs every current and future test file in one place. The repo already has precedent for manipulating the `localStorage` global descriptor (the projects hook tests save/restore it). Escape hatch if Bun's global proves non-configurable: pass `--localstorage-file` at a scratch path in the root test script instead.

Note: the brief's list of localStorage-crashing files is a snapshot (one named file no longer exists). The implementer re-runs the suite first and works from the actual red set, not the brief's list.

**Server-test audit (decision 4).** Re-run the server suite on this machine and triage each failure into exactly one class:

- **Environmental** — the test or its setup assumes POSIX; fix it so it passes honestly on Windows.
- **Platform-fundamental** — the capability genuinely cannot run on win32 (e.g. PTY behaviour that does not exist here); quarantine with a targeted per-test `skipIf(process.platform === 'win32')` and a comment naming exactly why. Never a blanket `describe.skip`.
- **Genuinely red on main** — a real bug: small fixes land in this feature; non-trivial ones are parked as draft features rather than swallowed (decision 1).

## Seams

- **`bun run test` (existing)** — the whole-suite seam and the acceptance bar: fully green on this Windows machine, and still green on POSIX CI. Observes all three fixes at once.
- **Pure platform functions `(platform, userAgent) → result` (existing)** — where Windows-vs-POSIX validation behaviour is asserted; unchanged by this feature, relied on as coverage so the component tests can pin one platform.
- **Component-test boundary of the open-project screen (existing)** — render, type, press Open, read the alert; after the fix it observes the same behaviour deterministically on any host via the pinned `navigator.platform`.
- **Per-worker test setup file (existing, extended)** — already the test-env firewall for `RUNCASTLE_*`; extended to also guarantee a working `localStorage` global under Bun. Observable by any test touching `localStorage` under `bun run test`.
- **Skip annotations (new, minor)** — each quarantined server test is a documented fact: a targeted platform-conditional skip whose comment names the win32 limitation, greppable and visible in the vitest summary as skipped-with-reason rather than red.

## Out of scope

- Any behaviour change to `isAbsoluteRepoPath`/`isAbsolutePath` or `OpenProject` semantics — the Windows-aware validation is correct and deliberate (findings F17.4).
- Anything about the shell/navigation flow itself.
- CI configuration beyond what making the local suite honest requires.
- Fixing non-trivial genuinely-red-on-main bugs the audit uncovers — those get parked as draft features (decision 1).

## Open questions

- Which of the ~10 server failures fall into which triage class — deliberately deferred to the audit itself; the per-class rule (decision 4) resolves each without further human input, except a non-trivial real bug, which is parked.
- Whether Bun's `localStorage` global is configurable enough for the in-place stub — if not, the decided escape hatch (`--localstorage-file` at a scratch path in the root test script) applies without re-ideation.
