# Decisions — test-suite-honesty-on-windows

## 1. One lap, whole spec; park non-trivial real bugs
**Decision:** Spec the whole feature in one lap — no map, no walking skeleton. If the phantom-failure audit finds a test that is genuinely red on main and non-trivial to fix, park it as a draft feature instead of fixing it here.
**Why:** Three well-bounded fixes with no product-design uncertainty; the only open-ended part (the audit) is bounded by fix-or-quarantine. The parking rule keeps a surprise real bug from swelling a test-honesty feature into a behaviour-change feature.

## 2. Open-project tests: pin navigator to POSIX, keep POSIX paths
**Decision:** In `apps/web/test/open-project.test.tsx`, pin `navigator.platform` to a POSIX value (e.g. `'Linux x86_64'`) in the file's setup and keep the existing POSIX paths and assertions untouched. Do not switch to host-valid paths.
**Why:** Minimal diff, deterministic on every host. Windows-path validation is already covered where it belongs — `platform.test.ts` unit-tests the pure `(platform, userAgent)` functions. Host-valid paths would keep the machine-dependence in spirit and force per-host assertion variants.

## 3. Bun localStorage: shim in vitest.setup.ts, not a runner flag
**Decision:** Fix the Bun `--localstorage-file` SecurityError in `vitest.setup.ts` (the existing per-worker test-env firewall): if `globalThis.localStorage` is Bun's throwing placeholder, replace it with an in-memory `Storage` stub. Escape hatch if Bun's global proves non-configurable: pass `--localstorage-file` at a scratch path in the root test script.
**Why:** Keeps Bun-everywhere (no forcing vitest under node), avoids a real on-disk file shared across workers and a Bun-version-specific flag in the script, and fixes every current and future test file in one designated place. `projects.test.ts` already manipulates the `localStorage` global descriptor, so the approach has repo precedent.

## 4. Server-test audit: triage rule and acceptance bar
**Decision:** Triage each phantom failure into one of three classes: (a) environmental — fix the test/setup so it passes honestly on Windows; (b) platform-fundamental — quarantine with a targeted `it.skipIf(process.platform === 'win32')` plus a comment naming exactly why, never a blanket `describe.skip`; (c) genuinely red on main — small fixes land here, non-trivial ones get parked as draft features (decision 1). Acceptance bar for the whole feature: `bun run test` fully green on this Windows machine, every skip carrying a written reason.
**Why:** `vitest.setup.ts` already strips `RUNCASTLE_*`, so causes are likely PTY-on-Windows or git config — a per-class rule lets the burner act without stalling on judgment calls, and targeted skips keep quarantine a documented fact rather than a silenced failure.
