# Decisions — The test suite is green again

Planned with no human present. Every decision is assumed until the human confirms it.

## 1. The server is right in all three; only the tests change
**Decision:** No code under `packages/server/src` changes. Each failure was reproduced on main and traced: all three are test mistakes that show only on Windows, which is why Linux CI never saw them.
**Why:** The drive identity, the size-limit reply and the review directory all do what their contracts say. Nothing here pins retired behaviour (gates, required review), so no test is deleted.
**Assumed.** Alternative: change the size-limit code so a reply always keeps at least one ticket row.

## 2. The project-drive test's setup hook stops capturing `DB_NAME`
**Decision:** The setup hook records the drive identity only. The expected text and the rest of the test stay exactly as they are. Stop and the dev pane keep capturing `DB_NAME`, where it has a value.
**Why:** `DB_NAME` is unset at that point, and `cmd` leaves an unset variable as written where a POSIX shell prints nothing. This is no loss of checking: the hook captures before it writes `drive.env`, in a fresh repo, so that part could never fail. The stop test still proves the value reaches stop.
**Assumed.** Alternative: keep the capture and expect the literal `%DB_NAME%` on Windows, which adds a platform branch for a check that proves nothing.

## 3. The size-limit test's fixture moves off the edge
**Decision:** The oversized fixture's backlogged feature seeds 10 extra open findings, not 12, and the fixture says why that number. Measured with the test's own names, that keeps 22 ticket rows in the reply and moves 23 out, so both move-out steps still run with thousands of characters of room on either side.
**Why:** At 12 the to-do alone nearly fills the 60,000-character limit, leaving room for one ticket row at most. A longer temp folder path, with its backslashes escaped in JSON, pushes that last row out on Windows; the reply is still valid, but the test assumes a row survives. The failure comes from where the fixture sits, not from the reply.
**Assumed.** Alternative: keep 12 and loosen the assertion to allow an empty ticket list, which is the weakening the brief rules out.
**Challenged:** Moving the fixture away from the edge hides a real limit: open findings never move out, so about 20 full-size ones would still cross the ceiling and hide the reply, and no test now reaches the zero-rows case. It should be filed so it outlives this feature. The answer stands because the measured real maximum is about a third of the ceiling; the limit is recorded in the spec and shown in the preview.

## 4. The review-directory test builds its expected paths with `node:path`
**Decision:** The two expected stale-sibling paths are built with `join`, the way the code builds them. The code stays on `join`.
**Why:** `CLAUDE.md` requires `node:path` for paths, so `\reviews\ticket-7.stale-100` is the correct result on Windows. The test had hard-coded forward slashes.
**Assumed.** Alternative: make the code keep the slashes it was given, which breaks that same rule to suit a test.

## 5. Green means the whole suite on this Windows machine, with Linux CI still green
**Decision:** The feature is done when the suite passes in full on this Windows machine, both by the brief's command and by plain `bun run test`, and all three changes are neutral on Linux. The human's Windows machine is the bar because that is where the failures are.
**Why:** The earlier Windows test-honesty feature set the same bar. Agents run plain `bun run test`, and on main today it gives the same result as the brief's command: these 3 failed, 5,081 passed, 64 skipped. CI runs on Ubuntu, and was green on this same commit, so it cannot see this class of failure. The hand-run platform check runs the suite on macOS only.
**Assumed.** Alternative: hold the bar to the brief's command alone, which leaves agents free to see red after this ships.

## 6. The lead makes these changes itself, with no tickets and no review agent
**Decision:** The feature lead edits the two test files and the fixture in one sitting, runs the whole suite, and hands it over.
**Why:** It is a handful of lines in three files. Each ticket pays for a container and an install, and nothing here runs in parallel or needs a second reader beyond the human.
**Assumed.** Alternative: one ticket with a review pass, which costs more and sees nothing the suite does not.

## 7. The flaky `self-plan-launch` file stays out, and a failure of it is not explained away
**Decision:** It passed in both full runs on main, so there is nothing to fix yet. If it fails on the final run, the lead looks for a quick fix. If there is none, the lead names the failure in the hand-over and does not call the suite green.
**Why:** The brief keeps it out unless it is quick, and two clean runs give nothing to work from. Calling a flaky red "green" would bring back the habit this feature exists to end.
**Assumed.** Alternative: rerun until it passes and call that green.

## 8. Windows stays out of the automated checks for now
**Decision:** This feature adds no Windows test run anywhere. The cheapest later step is turning on the suite for Windows in the hand-run platform check, which costs nothing per push.
**Why:** The push CI is deliberately one job on one platform. Changing either check is a different decision from fixing these tests, and GitHub's Windows machines may fail for reasons of their own.
**Assumed.** Alternative: add the Windows suite to the hand-run check in this feature, so this kind of failure can be caught before a release.
