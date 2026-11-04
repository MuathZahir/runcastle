# Small fixes: the waiting line, design waits, and tests that touch the real repo

## Problem
Three separate annoyances, one of them dangerous.

- The main chat ends with a "what's waiting" line that repeats what the header status line, its button and the sidebar row already say. The human finds it pointless.
- A feature can read "Design to approve" with an "Open design" button when nothing waits in the Design tab. A lead used the "design" kind of `wait_for_you` for a picture shown as a file, and the human could not tell what was being asked.
- On 2026-11-02 a test run wrote `core.bare = true` into the human's real repo config, which broke every git command and blocked merges, and left a stray "keep me" stash in the real repo. Nothing stops it happening again, and nothing would notice. Two move round-trip tests also fail now and then on main, and were waved off as flaky.

## Approach

**1. The waiting line goes (decisions 1, 2).** The chat column's tail line (the waiting-line component in the feature chat, passed to the thread column as its `tail`) is deleted, with its test file. The props the feature page fed it only for that line go too: the need's button, the busy flag and the action dispatcher. Nothing replaces it on the phone. Each need still has a way to its action there (plan and design cards plus the "…" sheet, the conflict row on the notice strip, the ask in the thread, the message box), and Merge and drives are off the phone by design. The line's own decision in "You always know what's waiting" gets a one-line note in that feature's decisions saying the human reversed it here. A note is added there, never a rewrite.

**2. The design need comes from the design record (decisions 3, 4, 5, 12).** In core's need logic (`featureNeed`, the pure function that picks the one thing a feature waits on the human for), a lead wait of kind "design" counts as "design" only while `designsWaiting > 0`. Otherwise it is treated exactly as a wait of kind "answer": "Needs your answer · <reason>", Reply as its button, holdable by an orchestrator, and it pings like an answer. Shape of the change: where the candidates work out the wait's effective kind, `design` becomes `answer` when no recorded design waits. Everything downstream (the sidebar, the header, the palette, pings) already reads the need, so nothing else changes.

On the server, the Approve button's path (`approveDesign`) clears the feature's waiting reason when the approval empties the waiting designs and the feature's wait is of kind "design". It clears it with the existing waiting setter, so the clear emits as usual. A wait of any other kind is left alone. The lead's own `set_design_state` is unchanged.

Two texts change. The feature skill's "Say which kind of wait it is" bullet and its design reference say that "design" is only for designs recorded with `show_design`, and that a file or picture shown for a yes is an answer. Both live in the repo's skill pack (packages/skills). The `wait_for_you` tool description in the MCP server says the same thing.

**3. Tests cannot touch the real repo (decisions 6–10, 13).**

- *Mechanism (decision 7).* Reproduced in scratch: `git init` in an empty folder with `GIT_DIR` set to a linked worktree's git dir (`<repo>/.git/worktrees/<name>`) writes `core.bare = true` into the main repo's config (git 2.43). With `GIT_DIR` set to the main `.git`, it did not. The move fixture runs git with `{ ...process.env }`, starting with `git init`. The build pins down which run carried the variable (a git hook, a `rebase --exec`, or an agent shell inside a hook's child) and explains the order: the stash at 20:31:26, then the config at 20:31:34. The fixture inits before it stashes, so another test file in the same run may have done the init. If the evidence says otherwise, decision 7 gets corrected.
- *Strip once (decision 6).* The worker setup file that already deletes `RUNCASTLE_*` (the "test-env firewall") also deletes git's repo-location variables. Use git's own list, `git rev-parse --local-env-vars` (git 2.43): `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_CONFIG`, `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`, `GIT_OBJECT_DIRECTORY`, `GIT_DIR`, `GIT_WORK_TREE`, `GIT_IMPLICIT_WORK_TREE`, `GIT_GRAFT_FILE`, `GIT_INDEX_FILE`, `GIT_NO_REPLACE_OBJECTS`, `GIT_REPLACE_REF_BASE`, `GIT_PREFIX`, `GIT_SHALLOW_FILE`, `GIT_COMMON_DIR`. Hard-code the list with a comment naming that command, so test setup spawns nothing. Author, committer and editor variables are not on it and stay. The fixtures' own `{ ...process.env }` spreads then inherit a clean env. They stay as they are, so the strip has one home.
- *Guard (decision 8).* A vitest global setup, which runs once in the main process before workers start:
  - it strips the same variables from the main process's env;
  - it finds the real repo with `git rev-parse --git-common-dir` from the repo root, using the cleaned env; outside a git repo it does nothing;
  - it snapshots the common dir's `config` file bytes and `git stash list --format=%H %gs`.

  Its teardown compares both and throws if either changed. The error names the config lines that differ and the stash entries that appeared or vanished. It says the run may have damaged the repo the tests run from, or that another session working in the same repo changed it meanwhile. It repairs nothing. In a burn container or CI clone it guards that clone, which is harmless.
- *The two move tests (decision 9).* Reproduce "puts the main checkout's uncommitted work back" and "moves again with --replace" first. Run the move round-trip test repeatedly, alone and in the full suite, and with a `GIT_DIR` or `GIT_INDEX_FILE` set to see whether an inherited variable explains them. Both read the main checkout's `app.txt` after a move, which the move restores from a patch. Fix the cause where it lies. A fix in `runcastle move` is capped at bringing the uncommitted work back.
- *The stray stash (decision 10).* Not touched. The outcome names it ("keep me", "On (no branch)", in /home/muath/projects/runcastle) for the human to drop.

**Build (decision 11).** The lead builds all three in its own checkout, runs typecheck and the full test suite, then runs one review round.

## Seams
- **`featureNeed(facts, now)`**, existing, in core. Feed it NeedFacts with a "design" wait and `designsWaiting` 0 or 1, held or not. Observe the need's kind, words, `held`, and that it pings.
- **`approveDesign(ctx, id)`**, existing, on the server. Approve the last waiting design while a "design" wait stands, and while an "answer" wait stands. Observe the feature row's waiting reason and the emitted `feature.waiting` event.
- **The feature chat column**, existing (the feature chat on its real column, server faked by path, as today's waiting-line test does). Observe that a need renders no status line at the column's end. One assertion, in the existing chat test file, replaces the deleted file.
- **The test-run guard**, new: the global setup's two halves as plain functions. Snapshot a scratch repo, change its config or push a stash, and observe the teardown error and its words. Also observe that it passes when nothing changed, and does nothing outside a repo.
- **The worker setup**, existing: a test asserts no repo-location `GIT_*` variable is set in a test process.
- **The move round trip**, existing: the two named cases pass repeatedly.

## Out of scope
- The grey palette (sibling feature "Fewer, darker greys").
- Anything else from "You always know what's waiting": the header status line, the sidebar row, pings and the need order stay as they are.
- Stripping git variables in the product's own git calls (the server, `runcastle move`) (decision 13).
- Dropping the stray "keep me" stash (decision 10).
- A larger rework of `runcastle move`, if the move tests reveal one: its own backlog feature.

## Open questions
- Which run carried the `GIT_DIR`, and why the stash came before the config write. The build settles it and corrects decision 7 if needed.
- Whether the two move tests fail for the inherited-variable reason or for another one. The build settles it.
