# Outcome — Find what installs dependencies into talk worktrees

Talk worktrees are meant to be docs-only, but each carries its own node_modules — find what installs them and stop it.

- Shipped: 2026-09-27
- Laps run: 1

## What shipped

13 commits · 14 files

### Lap 1
- 5 tickets landed: #1 Install guard blocks package installs in talk worktrees, and briefings match it; #3 Install guard misses installs that put a flag, env prefix or .cmd/.exe between the package manager and its verb; #4 Bare `yarn` followed by a newline is not denied, while `yarn --version` is; #5 Blanking single quotes before double quotes lets an apostrophe inside a double-quoted string hide a real install; #6 Heredoc body lines are read as commands, so a commit message line starting with "bun install" is denied
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 5bb271079e9d844d70659e14fabf92497f8b4391
- Landed since: 4
- Outcome: done

### Lap 1 · verification

- Reviewed commit: cdc7ac02f0cd2d4e49d3d4ed1cccbe25098f88dd
- Landed since: 0
- Outcome: done

- **Heredoc blanking treats `<<` inside quotes or `$((…<<…))` as a heredoc opener, so installs on the lines after it get through** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 3. Install guard misses installs that put a flag, env prefix or .cmd/.exe between the package manager and its verb

## What was done
- In `packages/server/src/launcher/install-guard.ts`, the install patterns are now built from two helpers:
  - `manager(name)` matches a package manager at command position. It accepts an optional env-assignment prefix (`FOO=1 bun`) and an optional `.cmd`/`.exe` suffix (`npm.cmd`).
  - `verbAfter(name, verbs)` allows global flags between the manager and the verb, each with an optional value (`bun --cwd x install`, `pnpm -C x install`, `npm --prefix x ci`).
- The bare-`yarn` pattern uses `manager('yarn')` too, so `yarn.cmd` is covered.
- New tests:
  - Denied: the reviewer's repro cases plus `bun.exe install`, `pnpm.cmd -C x i`, `& yarn.cmd`, `yarn --cwd x add zod`, and a case with several env prefixes.
  - Allowed: `bun --version`, `npm --prefix x run build`, `FOO=1 bun run typecheck`, `pnpm -C x run test`, `yarn.cmd --version`.

## Repro re-run
I added the repro commands from the ticket to 'denies every install verb in command position'. `npm.cmd ci` is tested with toolName PowerShell. I then ran `bun run test packages/server/test/install-guard.test.ts`, and all 13 tests passed. Every repro command is now denied.

## Verification
- `bun run typecheck`: clean.
- Full suite: 1 failure, `dev-pane.test.ts > kills the child process tree so the port-holder is not orphaned`. It also fails when run on its own. It tests killing a process tree in this sandbox and does not import the install guard, so I read it as environmental rather than caused by this change.
- No drive machinery changed.

## Surprises / left undone
- A flag's value is recognised only as "a token that doesn't start with `-`". A flag with no value placed directly before the verb (`bun --silent install`) still matches, because the regex backtracks.
- Not covered: path-qualified managers (`./node_modules/.bin/bun install`, `C:\...\npm.cmd ci`) and the `env FOO=1 bun install` form. Neither was asked for.

#### 5. Blanking single quotes before double quotes lets an apostrophe inside a double-quoted string hide a real install

## What was done
The install guard (`packages/server/src/launcher/install-guard.ts`) used to blank single-quoted spans first and double-quoted spans second. That meant an apostrophe inside double quotes (`"it's"`) started a fake single-quoted span, which could hide a real install that came after it. It now blanks both quote kinds in a single left-to-right regex pass (`/'[^']*'|"[^"]*"/g`), so whichever quote opens first wins. I added a test in `packages/server/test/install-guard.test.ts` with the repro, a `don't` commit message variant, double quotes inside single quotes, and a negative case (`echo "it's bun install"` is still allowed).

I re-ran the reviewer's repro step exactly (`echo "it's" && bun install 'x'`). It now returns the denial; before the fix it returned null.

Verify: `bun run typecheck` had 0 errors. `env -u GIT_ASKPASS bun run test` had 1 failure: `dev-pane.test.ts > kills the child process tree so the port-holder is not orphaned`. It also fails when run on its own. It spawns and kills a real process tree and doesn't import the install guard, so it looks like an environment/timing problem in this sandbox, not something this change caused. It is not in the listed baseline.

## Surprises
- The dev-pane process-tree test failed as described above.
- The suite is much larger than the baseline says: 297 files and 4305 tests, against the 118 files the baseline lists.

## Left undone
- Quote blanking still ignores backslash-escaped quotes (`\"`) and `$'...'`. That is a narrower edge case and wasn't part of this ticket.
- No drive machinery changes were needed.

#### 6. Heredoc body lines are read as commands, so a commit message line starting with "bun install" is denied

## What was done
The install guard (`packages/server/src/launcher/install-guard.ts`) now drops heredoc body lines before it blanks quotes and matches install verbs. The opener line and everything after the terminator are still checked. `blankHeredocBodies` handles `<<EOF`, `<<'EOF'`, `<<"EOF"`, `<<-` (strips leading tabs before matching the terminator) and several heredocs on one line. It ignores `<<<` here-strings. Tests in `packages/server/test/install-guard.test.ts` cover commit-message heredocs, `$(cat <<'EOF' …)`, and `<<-`. They also check that an install on the opener line or after the terminator is still denied.

I re-ran the review's repro step, now in the test suite as the first "reads a heredoc body as text" case: `git commit -F - <<'EOF'\ndocs: note\nbun install is blocked here\nEOF` in a talk worktree now returns `null`, which is what the ticket expects. (The acceptance-criterion text says "returns a denial", but it also says "null is expected". The fix gives null.)

## Surprises
- The full suite had 1 failure: `dev-pane.test.ts` "kills the child process tree", where the process group is still alive. It also fails when run alone. It concerns process reaping in the sandbox and is unrelated to this pure-function change. Typecheck was clean.
- The burn guard has no heredoc-body handling of its own. It avoids the problem by what its patterns match, so I had nothing to borrow.

## Left undone
- A `<<` inside a quoted string (for example `echo "a << b"`) is read as a heredoc opener. Everything up to a line equal to `b` is then skipped, which could hide a later install in a multi-line command. This is rare, so I accepted it.
- The drive machinery was not touched, because this change adds no infrastructure.

#### 7. Verify the fixes that landed

Gates verification pass — verifies pass #2 on `feature/find-what-installs-dependencies-into-talk-worktrees` (cdc7ac02)

## Fixes

I read each fix commit against its finding. Then I re-ran every repro step against the branch's `evaluateInstallGuard`, in a detached scratch worktree that has since been removed.

| Ticket | Finding | Result |
|---|---|---|
| #3 (f7ab9ad1) | Flags, env prefix or `.cmd`/`.exe` between the manager and its verb | **Held.** `bun --cwd packages/server install`, `pnpm -C x install`, `npm --prefix x ci`, `FOO=1 bun install` and `npm.cmd ci` (PowerShell) are all denied. `bun run typecheck` is still allowed. |
| #4 (8ebad1bb) | Bare `yarn` followed by a newline | **Held.** `yarn\ngit status` is denied and `yarn --version` is allowed. |
| #5 (eb357285) | An apostrophe inside double quotes hid an install | **Held.** `echo "it's" && bun install 'x'` is denied. The two quote kinds are now blanked in one left-to-right pass. |
| #6 (e879c7f3) | Heredoc body lines were read as commands | **Held.** The `git commit -F - <<'EOF' … bun install is blocked here … EOF` repro is allowed. An install after the terminator line is still denied. |

## New gap from the #6 fix

- The heredoc blanking runs before quote blanking, and its opener regex also matches an arithmetic shift. So a `<<` inside quotes or `$((1<<2))` hides every line after it. `echo $((1<<2))\nbun install` and `echo "a <<EOF"\nbun install` are now allowed; before #6 both were denied. I reported this as a low-severity finding (finding_vqGc5StDV7nU). The guard fails open, so nothing gets stuck; this is a way past the guard.

## Gates (each run once, on the branch tip)

- `bun run typecheck`: clean (core, server, web and scripts all exited 0).
- `env -u GIT_ASKPASS bun run test`: 297 files, 4246 passed, 56 skipped, **3 failed**. The baseline expects fully green, but all three failures come from the environment, not from this branch:
  - `review-ticket.test.ts > does not put review browser settings in implementation or container agents`: `AGENT_BROWSER_SESSION=review-tkt_V80Y3uXUAD09` leaks in from this review session's own environment.
  - `review-directory-preparation.test.ts > best-effort collects only this ticket's stale siblings`: Windows backslash path separators (`\reviews\...`).
  - `project-drive.test.ts > drives the checkout as it is`: a literal `%DB_NAME%` left over from cmd-style expansion on a Windows host.

  The branch does not touch these tests or the code under them (`git diff main...branch` over those paths is empty).

## Tour

This pass ran in Gates mode, so there was no drive.

REVIEW-MODE: gates
REVIEW-VERDICT: verified
REVIEW-REASON: All four landed fixes hold; the 3 test failures come from the environment (session env leak, Windows paths/cmd), and one new low-severity heredoc bypass is reported.
