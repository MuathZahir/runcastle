# Find what installs dependencies into talk worktrees

## Problem

Charter decision 6 promises docs-only talk worktrees with no dependency install. In practice feature worktrees accumulated their own `node_modules` (~0.58 GB each for runcastle); on 2026-09-25, 129 worktrees took 19.4 GB and the full disk crashed Docker mid-burn.

Diagnosis (decisions §0): **no runcastle code installs into a talk worktree.** Worktree creation is git-only, the launcher runs nothing before the terminal, `setupCommand` runs only in the burn sandbox, and test drive / project drive / prepare / drive-fix all run in the main checkout. The installs are **agents running `bun install` through Bash**, almost always in conflict-resolve sessions that wanted to typecheck or test their merge — once invited by the ticket-conflict kickoff ("Run the tests over the touched code"), otherwise on their own initiative. Nothing stops them: the edit guard covers file-write tools, not shells.

## Approach

From the user's side: a talk session that tries to install dependencies is refused on the spot, with a message saying the worktree is docs-only and where real verification happens. Conflict-resolve sessions are briefed to check their merge without dependencies and to hand the human the test drive for a real run. Worktrees stay small; the charter stays true; no ADR amendment.

**1. The install guard** — a new pure evaluator in the launcher, beside the edit guard and shaped like it, wired into the same `PreToolUse` path (`POST /api/hooks/pre-tool` → `handlePreToolUse`). It denies when all hold:

- the tool is a shell tool: Claude Code's `Bash` or `PowerShell`, or Codex's shell tool (verify Codex's exact tool name against its docs; the burn guard's notes record that Codex's hook payload is Claude-shaped);
- the session's working directory is a **feature talk worktree** — `worktreeDir(projectId, feature.slug)` — not the `__project` worktree and not the project's main checkout (decisions §5). Kind `project` is exempt outright; `prepare` and drive-fix sessions, whose cwd is the main checkout, are therefore unaffected;
- the command contains a package-manager install verb **in command position** anywhere in it, including after `&&`, `;`, `|`, `(`: `bun install|i|add`, `npm install|i|ci|add`, `pnpm install|i|add`, bare `yarn`, `yarn install|add`. Matching borrows the burn guard's discipline — command-position anchoring and blanking quoted spans — so `grep -rn "bun install" docs/` is not denied. PowerShell separators (`;`, pipelines) must be covered too.

There is **no** `resolve-conflict` / merge-in-progress exemption (decisions §4) — resolve sessions are the main offenders. Not blocked: `bunx`/`npx`, `bun pm ls` and other read-only commands. `bun add` under a prototype waypoint's `prototypes/` dir is blocked like anywhere else.

The deny reason names the alternative: this worktree is docs-only (charter decision 6); verification with dependencies happens in the burn sandbox, the review lap, or a test drive of the branch (main checkout).

**2. Registration** — `renderSettings` (Claude Code) and `renderCodexHooks` (Codex) register the `pre-tool` hook for the shell tools as well as the edit tools, for every kind that gets the edit guard. The location test is made at evaluation time from the session row, not at render time.

**3. Briefings match the guard** (decisions §7, §8):

- `mergeConflictKickoff` and `ticketConflictKickoff` (web) drop "run the tests" and instead ask for dependency-free checks: `git diff --check` plus a grep for leftover conflict markers; re-read each resolved hunk against both sides; confirm every import/symbol the merged code uses exists on the merged side. They say installs are blocked here and end by telling the human they can test-drive the branch before Retry / Merge & ship.
- `conflictResolutionRule` states the same verification rule and that installs are blocked.
- `noCodeRule` gains one line: package installs are blocked in this worktree.

## Seams

- **Install-guard evaluator** (new, pure) — input `{ kind, toolName, command, worktreePath, talkWorktreePath }` (or equivalent), output a denial or `null`. Unit-test the verb matrix, command-position/quoting false positives, PowerShell forms, the `project`/main-checkout/`__project` exemptions, and that a resolve-conflict session mid-merge is still denied.
- **`POST /api/hooks/pre-tool`** (existing) — a shell-tool payload from a talk-worktree session returns the deny shape; the same from a prepare session in the main checkout returns `{}`; edit-tool behavior is unchanged.
- **`renderSettings` / `renderCodexHooks`** (existing) — the rendered `PreToolUse` matcher includes the shell tools for guarded kinds and nothing for `project`.
- **Kickoff and rule strings** (existing) — `mergeConflictKickoff`, `ticketConflictKickoff`, `conflictResolutionRule`, `noCodeRule`: no instruction to run tests; mention of blocked installs and test drive.

## Out of scope

- Removing worktrees on ship/archive, and the boot sweep (sibling feature "Feature worktrees are removed on ship and archive").
- Test-suite data-dir isolation (sibling feature "Test suite cannot touch the real data dir").
- Cleaning up existing `node_modules` — none exists in any talk worktree today.
- Sharing one install across worktrees (junctions/links) — rejected, decisions §1.
- The `__project` worktree's install — allowed and bounded.
- A kill switch — not requested; the guard's scope is narrow.

## Open questions

- Codex's shell tool name in `PreToolUse` payloads — verify, don't guess.
- The auto-memory note "tests in talk sessions read stale migrations" still describes running tests in talk sessions; the human updates it (this session's edit guard blocks writing there).

## Later laps

None planned — single lap.
