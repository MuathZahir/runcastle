# The test suite is green again

## Problem

Three server tests fail on main on the human's Windows machine, and every feature since has had to explain them away in its outcome. A red suite that is always red tells nobody anything: a real regression looks the same as the known three.

CI cannot help: it runs on Ubuntu and was green on this same commit, so all three pass there.

## Approach

Fix the tests. All three failures were reproduced on main at `4f103ff2` and traced, and in each the server does what its contract says. No server source changes.

**The project drive test.** The setup hook's capture writes `%DB_NAME%`, which does not exist yet at setup. `cmd` leaves an unset variable as written; a POSIX shell prints nothing. The setup hook will capture the identity only, and the expected text stays as it is. No check is lost: the hook captures before it writes `drive.env`, in a fresh repo, so that part could never fail. The stop test still proves the value reaches stop.

**The size-limit test.** `get_feature_context` keeps its reply under the 60,000-character ceiling by moving docs out, then goals, then settled tickets' rows; the to-do never moves. The backlogged fixture carries 19 open findings, about 56,600 characters, which leaves room for one ticket row at most. With the test's temp path on Windows that row goes too, so `tickets` is empty. The reply is valid: it fits, and all 45 tickets are named in `ticketsNotInlined`. The test assumes a row survives. At 12 the fixture sits on the edge, and a longer path tips it over.

Lowering the fixture's extra findings from 12 to 10 moves it to the middle of the band: 22 rows stay, 23 move out, and every goal has moved. Every assertion stays as it is. The fixture records why that number, so the next header field does not quietly put it back on the edge.

**The review directory test.** `prepareReviewDirectory` builds sibling paths with `join`, as the project requires, so Windows gets backslashes. The test hard-coded forward slashes. Its expected sibling paths are built with `join` too. The third entry is the path the test passed in and stays verbatim.

**The waits under load.** With those three fixed, each full run failed something else, in files that pass alone: `vi.waitFor` and Testing Library waits stopped at their 1-second default, and `docs-watch` read its result after a fixed sleep. `vitest.setup.ts` gives both kinds of wait 10 seconds on Windows, the same allowance `vitest.config.ts` gives `testTimeout`. An explicit budget still wins, and other platforms keep the default. The `docs-watch` tests that expect an event now wait for it, then keep the old settle time, so a duplicate still fails them. The tests that expect no event keep their fixed sleep.

## Seams

All existing; none are new.

- **`project.testDrive` through the tRPC caller:** the identity the setup hook wrote, read back from its file.
- **`featureContext`:** the reply's rows, `ticketsNotInlined` and serialized length.
- **`prepareReviewDirectory` with an injected fs:** the paths it asks to remove.
- **The whole suite:** the brief's command and plain `bun run test` on Windows, which together are the feature's finish line. Both give the same result on main today: these 3 failed, 5,081 passed, 64 skipped.

## Out of scope

- **The server's behaviour when open defects alone cross the ceiling.** The to-do never moves, so about 20 full-size open findings at once would spill the reply. The real measured maximum is about 20,000 characters of findings, a third of the ceiling, so no one has hit this. It is noted, not fixed.
- **A Windows test run in any check.** The cheapest version is turning on the suite for Windows in the hand-run platform check. It is a separate decision.
- **New tests.** This feature repairs three; it adds no coverage.

## Open questions

None that block the work.
