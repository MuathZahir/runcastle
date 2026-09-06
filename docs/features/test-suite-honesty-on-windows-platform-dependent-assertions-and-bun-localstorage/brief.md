Surfaced 2026-09-04 while resolving the merge of main (the onboarding-and-project-chooser flow) into feature/flow-redesign-project-shell-and-navigation. None of these are merge fallout — every failing file is byte-identical to one parent — but the suite is red on this machine, which makes real regressions invisible.

Three distinct problems, verified during the merge session:

1. **`apps/web/test/open-project.test.tsx` (3 failures)** feeds POSIX paths (`/tmp/notes`, `/home/you/repo`) into a flow whose client-side `isAbsolutePath` (in `apps/web/src/lib/platform.ts`) is deliberately Windows-aware — so on a Windows host the validation rejects the path before the stubbed server error is ever shown, and the tests assert on an alert that never appears. The tests should pin the platform (pass/mock a platform string) or use paths valid on the host, not depend on the machine they run on.

2. **Bun localStorage SecurityError (11 failures across `sidebar-resize`, `project-nav`, `workspace-navigation` web tests)**: `bun run test` executes the vitest bin under the Bun runtime, and Bun's global `localStorage` throws "Cannot initialize local storage without a `--localstorage-file` path" in `beforeEach` before any app code runs. Either the happy-dom environment should shadow the global properly, vitest should run under node, or the runner should pass Bun's flag. Decide once, in the root test script.

3. **~10 server test failures (`docs-watch`, `feature-create`, `git`, `merge-conflict`, `project-session`, `projects`, `pty`)** — all byte-identical to main; likely the known talk-session phantom-failure environment (inherited RUNCASTLE_* vars, PTY-on-Windows, git config). Audit which are environmental and which are genuinely red on main, and fix or quarantine accordingly.

Must NOT swallow: any behaviour change to `isAbsolutePath`/`OpenProject` semantics (the Windows-aware validation is correct and deliberate — findings F17.4); anything about the shell/navigation flow itself; CI configuration beyond what making the local suite honest requires.
