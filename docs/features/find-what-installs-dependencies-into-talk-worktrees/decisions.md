# Decisions — Find what installs dependencies into talk worktrees

## 0. Diagnosis (evidence)
**Finding:** No runcastle code path installs into a talk worktree. `ensureTalkWorktree` (git.ts ~609) is git-only; the launcher spawns the PTY with nothing before it; `setupCommand` runs only in the burn sandbox; test drive, project drive, prepare and drive-fix all run in `project.repoPath`; there are no git hooks. The installs are **agent-issued Bash commands** (`bun install && bun run typecheck` and similar) — found in 8 surviving runcastle talk-worktree transcripts, almost all "Merging main" conflict-resolve sessions (plus one ideate session building the web app). The ticket-conflict kickoff (`apps/web/src/lib/feature-ui/gates.ts` ~44) explicitly says "Run the tests over the touched code" in the talk worktree; nothing stops it because the edit guard (`edit-guard.ts` ~47) matches only Edit/Write/NotebookEdit/apply_patch, not Bash. One install ≈ 0.58 GB, so 19.4 GB ≈ 33 installs — consistent, given transcript retention drops older sessions.

## 1. Block installs; do not share one
**Decision:** Talk worktrees stay docs-only, as charter decision 6 says. Package-manager installs issued from Bash in talk-worktree sessions are denied by a guard (sibling to the edit guard), with a deny message that explains why and where verification happens instead. We do not link worktrees to the main checkout's `node_modules`, and we do not accept-and-rely-on-removal.
**Why:** Sharing via a junction is wrong: the checkout's deps may not match the feature branch's lockfile, and an agent running `bun install` through the junction would mutate the main checkout's `node_modules`. Blocking keeps decision 6 intact, so no ADR amendment.

## 2. Resolve sessions don't verify in the talk worktree
**Decision:** The conflict-resolve kickoffs stop asking for (or implying) tests in the talk worktree and point at dependency-free checks instead; deeper verification is the pipeline's job — the burn sandbox's conflict resolver already typechecks and tests, and the review lap follows.
**Why:** The kickoff text is what invited the installs; removing the invitation plus the guard closes both the prompt and the habit.

## 3. One lap
**Decision:** Small and settled — spec the whole thing as lap 1; no map.
**Why:** The diagnosis is done and the fix is two narrow changes.

## 4. Guard scope: every kind but `project`, no resolve exemption
**Decision:** The install guard applies to the same kinds as the edit guard (every `SessionKind` except `project`). Unlike the edit guard, it has **no** `resolve-conflict` / merge-in-progress exemption — resolve sessions are the main offenders. Sessions whose cwd is the main checkout (prepare, drive-fix) are unaffected in practice.
**Why:** `project` has one `__project` worktree per project (decision 18, whole-repo writes), so its install is bounded (~0.6 GB) and reused, and it plausibly needs to typecheck its own code. Talk worktrees are one per feature, which is where the multiplication happens.

## 5. Correction to 4: the line is the talk worktree, not the kind alone
**Decision:** The guard denies only when the session's cwd is a feature talk worktree (`worktreeDir(projectId, slug)`) — never `__project`, never the main checkout. Kind `project` is exempt as in 4; a `prepare` or drive-fix session (cwd = `project.repoPath`) must keep installing freely, since the prepare skill tells it to.
**Why:** `prepare` is a non-`project` kind, so a pure kind rule copied from the edit guard would wrongly block it. The cost being fixed is one install per feature worktree; the rule should name that place.

## 6. Mechanism: a PreToolUse hook over every shell tool, matching install verbs
**Decision:** A `PreToolUse` hook (same shape as the edit guard, shared across runtimes) registered for Claude Code's `Bash` and `PowerShell` and Codex's shell tool (exact tool name to be verified against Codex docs). It denies when the command text contains a package-manager install verb anywhere — including chained commands: `bun install|i|add`, `npm install|i|ci|add`, `pnpm install|i|add`, bare `yarn`, `yarn install|add`. The deny message says the worktree is docs-only and that verification happens in the burn sandbox / review lap. Not blocked: `bunx`/`npx` (global cache, no `node_modules`) and read-only commands. `bun add` inside a prototype waypoint's `prototypes/` dir IS blocked — spikes use `bunx` or a throwaway dir outside the worktree.
**Why:** `permissions.deny` rules can't reach Codex, can't explain themselves, and PowerShell slips past them; a hook is one enforced layer for every runtime.

## 7. Resolve briefings: dependency-free checks, then point at test drive
**Decision:** `mergeConflictKickoff`, `ticketConflictKickoff` (apps/web `gates.ts`) and `conflictResolutionRule` (launcher `artifacts.ts`) drop "run the tests" and instead tell the agent to verify without dependencies: `git diff --check` and a grep for leftover conflict markers, re-read each resolved hunk against both sides, and confirm every import/symbol the merged code uses exists on the merged side. They state that installs are blocked in this worktree, and they end by telling the human they can test-drive the branch (main checkout, deps installed) before Retry / Merge & ship.
**Why:** After a "Merging main" resolve nothing re-verifies before ship, so the trade-off is named rather than hidden: cheap static checks in the session, a real run via test drive, which already exists and already installs where it should.

## 8. Briefing matches the guard; no cleanup
**Decision:** `noCodeRule` gains one line saying package installs are blocked in this worktree. No cleanup of existing `node_modules` ships with this feature — none exists in any talk worktree today, and removal is the sibling feature's.
**Why:** Same precedent as `conflictResolutionRule`: the briefing states the truth the guard enforces, so the agent doesn't discover it by denial.
