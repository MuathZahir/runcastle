## Purpose
A batch of three small fixes the human agreed to on 2026-11-04. Each paragraph is its own change, and addresses are starting points.

## 1. Remove the end-of-chat waiting line
"You always know what's waiting" (decision 4) added a line at the end of the main chat while the feature needs the human: the need's words plus the header's button (`WaitingLine` in apps/web/src/components/workspace/FeatureChat.tsx, passed as the ThreadColumn `tail`). The human: "What's the point of that 'what's waiting' line.. I don't think we need it anyway." Since then, questions no longer fold away, and the header status line, its button and the sidebar row all say the same thing. The plan and design cards give the phone its way in. Remove the line and its tests, and record that decision 4 is reversed by the human. Check the phone still has a way to every need's action. If one would be lost (e.g. Merge or Start test drive on the phone), say so in the decisions rather than keeping the line.

## 2. "Design to approve" only when a design really waits
The "Ready to publish" lead called `wait_for_you({ why: "banner to approve · then the review round", kind: "design" })` for a README banner shown as a file, not recorded with `show_design`. Every recorded design was already approved. The app still showed "Design to approve" with an "Open design" button that opened a Design list with nothing to approve, and the human couldn't tell what it was for. Want: the design need comes only from the design record (a design in state waiting). A lead wait with kind "design" while no recorded design waits reads as an answer: "Needs your answer · <reason>", with Reply. Also fix the feature skill so the "design" kind is only for designs recorded with `show_design`, and anything else shown for a yes (a file, a picture) is an answer. See `featureNeed` in packages/core/src/feature-need.ts.

## 3. Tests must never touch the human's real repo
On 2026-11-02 the human's checkout (/home/muath/projects/runcastle) was found with `core.bare = true` in .git/config, which broke every git command and blocked merges. The orchestrator set it back. Evidence: a stray stash "keep me" ("On (no branch)") appeared in the real repo 8 seconds before the config change (stash 20:31:26, config written 20:31:34). The test fixture packages/server/test/fixtures/move/roundtrip.ts creates exactly that stash (`sh(repo, 'stash', 'push', '-q', '-m', 'keep me')`) and runs git with `{ ...process.env }`. The likely mechanism: the test ran with git's repo-location variables (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_COMMON_DIR…) inherited from a git step in a ticket worktree. Its `git init` then re-initialised the real repo (a re-init with GIT_DIR set and no work tree marks it bare), and its stash went into the shared refs/stash. The exact run wasn't pinned down. Confirm or correct the mechanism.
Want:
- Every test, fixture and helper that spawns git does so with those variables stripped, ideally once, in shared test setup, so a new test can't forget.
- A guard that fails loudly if a test run changes the real repo's config or stash (or anything outside its scratch dirs), so this can never happen silently again.
- The two failing tests in packages/server/test/move-roundtrip.test.ts ("puts the main checkout's uncommitted work back", "moves again with --replace") were seen failing on main and called flaky by later runs. Find out why and fix them.
- Don't drop the stray "keep me" stash from the human's real repo. Mention it in the outcome so the human can drop it.

## Must not swallow
The grey palette (sibling feature "Fewer, darker greys"). Anything else from "You always know what's waiting" beyond the waiting line and the design need.

## Working agreement (2026-11-04)
Autonomous: the orchestrator carries this to merged, merge included. No design needed. End with a review round as usual.
