# Outcome — Talk worktree self-heals when a stray worktree holds the feature branch

In `ensureTalkWorktree` (packages/server/src/services/git.ts:509), when the talk worktree is registered-but-detached and `checkoutInWorktree` fails, do not fall through to `addWorktree` (guaranteed `already exists` fatal on a path git still owns, masking the real cause). Instead: find which worktrees hold `feature/<slug>` via the existing `worktreesOnBranch` helper (git.ts:853, excludes the main checkout). If a non-main worktree holds it, `detachWorktree` it (non-destructive — files stay, same commit; safe because `assertSpawnable` guarantees no branch-claiming run is live at spawn time, so any non-main holder is stale) and retry `checkoutInWorktree` once. If the checkout still fails, or the holder is the main checkout itself (test drive in progress), throw an InvalidInputError naming the holding worktree path and the branch — e.g. `feature/x is checked out at <path>; end the test drive or remove that worktree` — never the misleading worktree-add fatal. Only reach `addWorktree` when the path is genuinely not a registered worktree. Add tests: (1) stale scratch worktree holds the branch + talk worktree detached -> launch self-heals, scratch worktree ends up detached, talk worktree back on the branch; (2) main checkout holds the branch -> clear error naming it, nothing detached; (3) unregistered-path case still reaches addWorktree as today.

- Shipped: 2026-09-19
- Laps run: 1

## What shipped

5 commits · 7 files

### Lap 1
- 3 tickets landed: #1 In `ensureTalkWorktree` (packages/server/src/services/git.ts:509), when…; #2 Prompt hygiene so session agents stop leaving branch-holding scratch…; #4 Prompt-hygiene ticket added server code despite its content-only constraint
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: e40d72a0af65da9fad0d5208d4e33a9f2bc80023
- Landed since: 1
- Outcome: done

### Lap 1 · verification

- Reviewed commit: acd8d36e8c9478ccf9c1fa42acc6070fe386eafb
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. In `ensureTalkWorktree` (packages/server/src/services/git.ts:509), when…

# ticket(1) — the talk worktree takes its branch back from a stray holder

## What was done

`ensureTalkWorktree` (packages/server/src/services/git.ts) no longer falls through to
`addWorktree` when the talk worktree is registered-but-detached and `checkoutInWorktree`
fails. It now calls a new private helper, `reclaimTalkBranch`, which asks the existing
`worktreesOnBranch` helper which non-main worktrees hold `feature/<slug>`, detaches every
one of them, and retries the checkout once. If there were no stray holders (so the main
checkout holds the branch — a live test drive) or the retry still fails, it throws
`InvalidInputError` reading `feature/x is checked out at <path>; end the test drive or
remove that worktree`. The `addWorktree` path is reached only when the path is genuinely
not a registered worktree, exactly as before. Three tests were added to the
`ensureTalkWorktree` describe in packages/server/test/git.test.ts: stray scratch worktree
self-heals (stray ends detached with its files intact, talk worktree back on the branch),
main checkout named with nothing detached, and a path whose `.git/worktrees/<id>` entry
was deleted still going through `addWorktree`'s reclaim. No deviation from the ticket's
described approach.

## Surprises

- The error message for the "no stray holders" case names `project.repoPath` on the
  ticket's reading that an empty `worktreesOnBranch` result means the main checkout holds
  the branch. That is right for the test-drive case the ticket describes; if
  `checkoutInWorktree` ever fails for some reason unrelated to branch ownership (its
  second attempt is `checkout --force`, so this is close to unreachable) the message
  would name the main checkout wrongly. Kept simple per the ticket rather than adding a
  second failure message.
- Baseline drift: the prompt's baseline says 118 files / 1768 tests, but
  `env -u GIT_ASKPASS bun run test` on this branch runs 251 files / 3697 tests.
- One failure that is NOT mine: `packages/server/test/dev-pane.test.ts` →
  "kills the child process tree so the port-holder is not orphaned" fails on
  `expect(pidAlive(-pgid)).toBe(false)`. Confirmed with a single targeted run of that one
  file; it is a process-group/PID-namespace artifact of this sandbox and touches nothing
  my diff changes. Everything else is green; `bun run typecheck` is clean.
- Drive machinery: checked, no edit needed — this ticket adds no service, env var, seed
  or process. I did not run `drive-setup`/`drive-stop` (no services in the sandbox).

## Left undone

`ensureProjectWorktree` (git.ts, around line 710) has the same registered-but-detached →
`checkoutInWorktree` → fall-through-to-`addWorktree` shape for `runcastle/project`, and
would produce the same misleading `already exists` fatal if something ever held that
branch. It was outside this ticket, so it is untouched; the new `reclaimTalkBranch` is
written against a plain `(g, repoPath, worktreePath, branch)` signature and would apply
there unchanged if someone wants to generalise it.

#### 4. Prompt-hygiene ticket added server code despite its content-only constraint

# ticket(4) — the prompt-hygiene change is prompt content and nothing else

## What was done

Deleted `packages/server/test/scratch-worktree-hygiene.test.ts`, the 45-line Vitest
file that ticket 2 added alongside its prompt edits. Ticket 2's brief was explicit —
"Content-only change to skill/prompt markdown … No server code changes in this
ticket" — so the executable test was out of bounds no matter how reasonable it read.
The prompt wording it pinned is untouched and still ships in all four files
(`packages/skills/burner/{implement-ticket,review-ticket,verify-fixes}.md` and
`packages/skills/packs/runcastle/skills/code-review/SKILL.md`). The diff for this
ticket is exactly one deletion; nothing was rewritten or relocated.

I re-ran the reviewer's repro step. The literal command could not run verbatim here:
this sandbox clone has neither a local `main` nor a local
`feature/talk-worktree-self-heals-…` ref (only `origin/main` and the ticket
branches), so `git diff main...feature/… -- <path>` fails with "unknown revision".
The equivalent against the refs that do exist,
`git diff origin/main...HEAD -- packages/server/test/scratch-worktree-hygiene.test.ts`,
now prints nothing, and the path does not exist in the tree. The finding no longer
reproduces.

## Surprises

- The deleted test had no references anywhere else (no suite manifest, no shared
  helper), so removing it needed no follow-up edit. The two helpers it imported,
  `burnerAssetPath` and `burnerTemplatePath`, predate ticket 2 and stay in use.
- The stated baseline in the prompt is stale: it claims 118 files / 1768 tests, but
  `bun run test` here runs 251 files / 3697 tests.
- One test fails, and it is not mine: `packages/server/test/dev-pane.test.ts:183`
  (`expect(pidAlive(-pgid)).toBe(false)`) — a process-group reaping assertion. That
  file is untouched by this whole branch, and the failure reproduces on a targeted
  run of just that file. It looks like a sandbox process-lifecycle difference.
  Everything else is green: `bun run typecheck` exits 0; the suite is
  1 failed / 3661 passed / 35 skipped.
- No drive-machinery change applies: this ticket adds no service, env var, seed, or
  process, so `.runcastle/` was correctly left alone (I checked the trigger list
  rather than running anything).

## Left undone

- The rule ticket 2 wrote into the prompts now has no automated guard. If the
  project wants one, it belongs in its own ticket — probably folded into the
  existing `packages/server/test/tickets-skill.test.ts`, which already pins skill
  content and is the pattern the deleted file was copying.
- The `dev-pane` process-group failure above is left for whoever owns that area.

#### 5. Verify the fixes that landed

Gates verification pass

The landed fix holds.

- Verified commit `acd8d36` against the reported scope defect. Its complete diff is a single deletion: `packages/server/test/scratch-worktree-hygiene.test.ts` (45 lines removed), with no other files changed.
- Confirmed the test exists in the fix commit's parent and is absent from the fixed feature-branch tree.
- Re-ran the listed repro command, `git diff main...feature/talk-worktree-self-heals-when-a-stray-worktree-holds-the-feature-branch -- packages/server/test/scratch-worktree-hygiene.test.ts`; it produces no output, so the out-of-scope executable server test no longer appears in the feature diff.
- No verify commands are configured for this project, so Gates mode had no automated gates to run.

No verification findings were found. No unrelated defects were investigated.
