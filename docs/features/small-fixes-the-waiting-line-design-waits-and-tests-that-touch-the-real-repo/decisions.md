# Decisions

Planned without the human (a headless planning run, 2026-11-04). Decisions 1, 3, 5 and 10 restate what the brief already settled; the rest were decided here.

Check first: 2, 4, 8, 9, 12

## 1. The end-of-chat waiting line goes, everywhere
**Decision:** The main chat no longer ends with the "what's waiting" line (the need's words plus the header's button). It goes on the desktop and on the phone, with its tests. This reverses "The chat itself says what it waits for" (decision 4 of "You always know what's waiting"), on the human's own word.
**Why:** The human asked for it. The header status line, its button and the sidebar row already say the same thing, and questions no longer fold away.

## 2. The phone loses no action without the line
**Decision:** No replacement is added on the phone. Every need keeps a way to its action there: a plan through its Plan card and the "…" sheet's Plan view; a design through its design cards and the "…" sheet's Design view; a merge conflict through the standing row on the chat's notice strip; a permission prompt through the ask in the thread; an answer or a stop through the message box. "Start test drive" and "Merge & ship" did show in the line on the phone, but the phone has neither by design ("The phone has no Merge button, and drives stay off it", runcastle-on-your-phone decision 4).
**Why:** The phone's chat bar shows the need's words but no button, so the line was the phone's only button for some needs. Each of those needs has another way in, or is deliberately off the phone.
**Assumed.** Alternative: give the phone's chat bar the need's button, to keep one tap from the chat to the action.

## 3. "Design to approve" comes only from the design record
**Decision:** A feature reads "Design to approve" only while at least one design recorded with `show_design` (the tool that records a design page and posts its card) waits for the human. A lead's `wait_for_you` with kind "design" while no recorded design waits reads as an answer: "Needs your answer · <the lead's reason>", with Reply.
**Why:** The brief. A design wait for a README banner shown as a file showed "Design to approve" and an "Open design" button that led to a list with nothing to approve.

## 4. Approving the last waiting design clears the lead's design wait
**Decision:** When the human approves the last waiting design with its Approve button, a lead wait of kind "design" is cleared in the same step, so the feature waits on nobody while the lead hears about the approval. A design wait the human has not finished approving stays "Design to approve".
**Why:** Approving already sends the lead a runcastle message ("The human approved all designs…"), and that message does not clear a wait the way a human message does. Without this, the human clicks Approve and the feature then reads "Needs your answer · <reason>": the same confusion this feature removes.
**Assumed.** Alternative: leave the wait standing, so it reads as an answer under decision 3 until the human replies.

## 5. The skill and the tool say what the "design" kind is for
**Decision:** The feature skill and the `wait_for_you` tool's description say the "design" kind is only for designs recorded with `show_design`. Anything else shown for a yes (a file, a picture) is an answer.
**Why:** The brief. The kind was misused because nothing said this.

## 6. Git's repo-location variables are stripped once, in the shared test setup
**Decision:** The test setup that already strips inherited `RUNCASTLE_*` variables before every test file also strips git's repo-location variables (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR`, `GIT_OBJECT_DIRECTORY` and the rest of git's own list). Every git child a test, fixture or helper spawns inherits the cleaned environment, so a new test cannot forget. The once-per-run guard (decision 8) also strips them in the main test process before any worker starts, so the cleaning does not rest on one file.
**Why:** The brief asks for one place. Per-call cleaning (a shared env helper every spawn must use) can be forgotten, which is how the fixture went wrong.
**Assumed.** Alternative: a shared `gitEnv()` helper that every test and fixture passes to git, with a lint check for direct spawns.

## 7. The mechanism is confirmed: an inherited worktree `GIT_DIR` plus `git init`
**Decision:** The fix works from this cause. Reproduced in scratch repos on git 2.43: running `git init` in an empty folder with `GIT_DIR` set to a linked worktree's git dir re-initialises that worktree's repo and writes `core.bare = true` into the main repo's config. The same happens through vitest itself: a test that runs `git init` in a temp dir, in a vitest run started with that `GIT_DIR`, made a stand-in repo bare. With the new setup it did not.
The human's repo shows the move fixture ran inside it at 20:31:26 on 2026-11-02, from a detached HEAD. That run left a commit "first" by `t <t@t>` (the fixture's identity) on top of 086da9e8, the branches `feature/idle` and `feature/login` and the tag `v1` pointing at it, and the "keep me" stash. The fixture's `git remote add origin` then failed, because the real repo already has an origin, and the fixture stopped. The config file's 20:31:34 time is just its last write, so the stash coming "first" is no puzzle. Which process exported `GIT_DIR` into that test run was not found. The strip closes every source.
**Why:** The brief asked to confirm or correct the mechanism.

## 8. A guard fails the test run if the real repo's `[core]` config or stash changed
**Decision:** Once per test run, before any test starts, the suite records the `[core]` section of the real repo's git config (`core.bare`, `core.worktree` and the rest) and its stash list. "The real repo" is the git common dir of the checkout the tests run from, which is the human's main repo when tests run in a worktree. After the run, if either changed, the run fails with a message naming what changed and saying another session working in the same repo could also be the cause. It never repairs anything itself. The rest of the config file is not watched.
**Why:** `[core]` is where the damage that matters lands. Runcastle itself writes other parts of the shared config while tests run: a burn writes `receive.denyCurrentBranch` on the host, and branch setup can add `branch.*` entries. A guard over the whole file would fail healthy runs whenever a burn starts nearby, and people learn to ignore a guard like that. A failed run is impossible to miss; a repair would hide the damage.
**Assumed.** Alternative: compare the whole config file.
**Changed by the orchestrator:** narrowed from the whole config file to `[core]`, because runcastle's own burns and branch setup write the shared config during test runs.

## 9. The two failing move tests get a root cause, and the fix goes where the cause is
**Decision:** "puts the main checkout's uncommitted work back" and "moves again with --replace" are reproduced and traced before anything changes. If the cause is in `runcastle move` itself (the command that carries a runcastle install to another machine), the move is fixed; if it is in the test or its fixture, the test is fixed. They are never skipped or loosened to pass. A fix to the move is capped at bringing the uncommitted work back; anything larger becomes its own backlog feature.
The cause was in the move, and it lost real work. To read uncommitted changes without touching the source repo's index, the move copies the index and runs `git diff` against the copy. The copy got a fresh modification time. That defeats git's check for "racy" files, ones written in the same instant as the index. A same-size edit made in that instant then looked unchanged and was left out of the patch. The copy now keeps the original's time, minus a millisecond. With no `GIT_DIR` set, the test failed in 4 of 7 runs before the fix and passed in 10 of 10 after.
**Why:** Both tests assert that the main checkout's uncommitted file comes back after a move. If that really fails sometimes, a user loses work on a move, so "flaky" is not an answer.
**Assumed.** Alternative: fix only the test side and park any product bug in `runcastle move` as its own backlog feature.

## 10. The fixture's leftovers stay in the human's repo
**Decision:** Nothing in this feature touches what the 2026-11-02 run left in /home/muath/projects/runcastle: the "keep me" stash ("On (no branch)"), the commit "first" (b846b3fb, by `t <t@t>`), the branches `feature/idle` and `feature/login`, and the tag `v1`. The outcome names them so the human can delete them. None is on `main`.
**Why:** The brief said this for the stash. It is the human's repo, and the rest came from the same run.

## 11. The lead builds it; a review round closes it
**Decision:** The lead builds all three fixes in its own checkout, in one pass, then runs one review round. No implementation tickets.
**Why:** Each fix is a few files and they share no work a worker could run in parallel; a ticket would spend more on its container than on the change. The brief asks for the usual review round.
**Assumed.** Alternative: one worker ticket for the test-safety work (the strip, the guard, the move tests), which is the longest and least interactive part.

## 12. A design wait with no recorded design is an answer the orchestrator may hold
**Decision:** The answer that decision 3 makes of a design wait with no recorded design behaves like any answer. When an orchestrator thread holds the feature, it reads "With the orchestrator · Needs your answer · <reason>" for its first hour and the orchestrator may answer it. The skill (decision 5) tells a lead that wants the human's own eyes on something visual to record it with `show_design`, which is never held.
**Why:** It keeps one rule: only the design record makes a design need. Under the working agreement the orchestrator carries features to merge, and a README picture is the kind of yes it can give.
**Assumed.** Alternative: a design wait with no recorded design keeps the design need's never-held rule while still reading as an answer.

## 13. Only tests are cleaned; the product's own git calls stay as they are
**Decision:** The variable strip and the guard cover test runs only. The server and `runcastle move` keep running git with the environment they were started with.
**Why:** The damage came from a test. The server and the move are started by a person or a service, not from inside a git hook, so they do not inherit a stray `GIT_DIR` in practice.
**Assumed.** Alternative: strip the same variables wherever the product spawns git.
