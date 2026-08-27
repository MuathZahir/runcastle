# Outcome — Scaffold commit lands on the feature branch, not the checkout

Bug: createFeature (packages/server/src/services/features.ts ~205-213) and startDraft scaffold `docs/features/<slug>/brief.md` into the human's checkout at project.repoPath and then call `git.commitDocs(project.repoPath, 'runcastle: scaffold <slug> docs')` (packages/server/src/services/git.ts:1634). ensureFeatureBranch cuts `feature/<slug>` WITHOUT checking it out, so the commit lands on whatever branch the checkout is on — in practice `main`. Observed 2026-08-27 in the runcastle repo itself: `main` tip is `e22300c runcastle: scaffold review-findings-are-fixed-in-run docs`, while `feature/review-findings-are-fixed-in-run` tips at `25d5a99 runcastle: scaffold burn-concurrency-default-by-core-count docs` — the PREVIOUS feature's brief, and none of its own. Five features in a row show the same off-by-one (`feature/burn-guard-and-prompt-rules` tips at the known-baseline scaffold, etc.). Consequence: the grill session's docs-only worktree (cut from the branch) has no brief.md, and the ideation agent works from the one-line index and reinvents the design the intake session had already settled — the whole point of `create_feature({ brief })` is defeated. Fix: commit the scaffolded docs onto the FEATURE branch without touching the human's checkout — e.g. write and commit inside the feature's docs worktree (`git.ensureFeatureWorktree`, which talk sessions already use), or build the commit with plumbing (`git commit-tree` / a temporary index with GIT_INDEX_FILE against the branch ref) and update `refs/heads/feature/<slug>`; then the human's checkout must show no new commit and no untracked docs. Apply the same fix to the quick-change door (features.ts ~388-420, same commitDocs call) and to startDraft. Regression tests in packages/server/test: after createFeature with a brief, (a) `git show feature/<slug>:docs/features/<slug>/brief.md` equals the brief, (b) the checkout's current branch tip is unchanged, (c) `git status` in the checkout is clean. Do not add a migration for existing branches; the human repairs those by merging their base into the branch.

- Shipped: 2026-08-27
- Lap: 1

## 1. Bug: createFeature (packages/server/src/services/features.ts ~205-213)…

# Ticket 1 — scaffold commit lands on the feature branch, not the checkout

## What was done

All three feature-creation doors (`createFeature`, `startDraft`, `quickChange` in
`packages/server/src/services/features.ts`) shared the same three-line shape: scaffold
`docs/features/<slug>/` and then `git.commitDocs(project.repoPath, …)`. Since
`ensureFeatureBranch` cuts `feature/<slug>` without checking it out, that commit landed on
whatever branch the human's checkout was standing on. They now go through one private helper,
`scaffoldDocsOnFeatureBranch`, which ensures the feature's talk worktree first
(`git.ensureTalkWorktree`), scaffolds there, and commits there.

I took the worktree option the ticket named first rather than the `commit-tree` plumbing
option, because the plumbing route fixes the commit but breaks the read side: `featureDocsDir`
resolves docs to the talk worktree *if it exists on disk* and otherwise to the checkout, so
docs that exist only as a branch ref would vanish from the docs list, the gates and the burner
digest until some later session happened to cut a worktree — and a quick-change feature never
gets a session at all. Ensuring the worktree keeps one on-disk copy of the docs, on the branch
that owns them. It is also exactly the shape `promoteOutcomeDoc` in `services/outcome.ts`
already uses. Failure handling matches the surrounding best-effort convention: a worktree that
cannot be cut emits a new `docs.scaffold_failed` timeline event instead of failing creation,
and the `NotImplementedError` branch preserves the pre-B2 stub behaviour.

Regression tests are in `feature-create.test.ts` (the three criteria: the brief is on
`feature/<slug>` verbatim, the checkout's tip is unchanged, `git status` is clean),
`draft-features.test.ts` (Start), and `quick-change.test.ts` (the quick door).

## Surprises

- **Four test files were asserting the bug.** `feature-create`, `draft-features`,
  `quick-change` and `project-mcp-tools` all checked that the scaffolded brief was tracked in,
  or readable from, the human's checkout — the exact symptom. They now read it off the branch,
  or off `featureDocsDir` where the docs really live.
- **Creation now cuts a worktree, which lives under the data dir.** Test files that call
  `createFeature`/`quickChange`/`startDraft` and did *not* pin `RUNCASTLE_DATA_DIR` would have
  written worktrees into the developer's real `~/.runcastle`. `vitest.setup.ts` strips inherited
  `RUNCASTLE_*` vars but does not pin one, so I added `useDataDir` to the three unpinned files
  (`draft-features` already redirected `HOME`).
- **The stated baseline is stale.** The prompt says 118 files / 1768 passed / 0 failed. This
  container's actual baseline is 135 files / 2246 tests, and
  `dev-pane.test.ts > kills the child process tree so the port-holder is not orphaned` fails
  here. I confirmed it on a single targeted run: it fails in isolation, uses `seedProject` +
  `seedFeature` and a PTY spawning `sleep 300 &`, and asserts a process group is reaped within
  400ms. No feature creation, no docs, no git — it is a container process-reaping timing fault,
  not this change. Everything else is green (typecheck 0 errors; 2241 passed, 1 failed).

## Left undone

- **Existing branches are not repaired**, per the ticket. Five feature branches in this repo
  carry the previous feature's brief; the human fixes those by merging their base in.
- **`vitest.setup.ts` still only strips `RUNCASTLE_DATA_DIR` rather than pinning it** at a
  per-worker temp tree. That would make the whole suite structurally incapable of touching a
  real install and would have made three of my four test edits unnecessary, but it is a
  suite-wide change this ticket did not ask for.
- **No drive-machinery edit was needed.** This change adds no service, no required env var, no
  seed and no extra process — it only changes which git ref a commit lands on — so
  `.runcastle/drive-setup.ts` and `drive-stop.ts` are untouched and remain correct. I did not
  run them (the sandbox has no app or services), and I did not `bash -n` them either: they are
  Bun TypeScript, not shell.

## 2. Review the integrated change

This lap fixes the reason your feature briefs kept going missing. When you create a feature and dictate a brief — the reasoning you and the intake session just worked out — that brief was being written into your own checkout and committed to whatever branch you happened to be standing on, which in practice was always `main`. The feature's own branch never received it. So when you later opened a grill session, its worktree was cut from a branch that had no `brief.md` in it, and the ideation agent started from the one-line title and cheerfully re-invented a design you had already settled. The whole point of passing a brief was being quietly defeated, five features in a row.

All three doors that can create a feature — creating one outright, clicking Start on a parked draft, and the quick-change door — now write and commit the brief into the feature's own working copy, the one git keeps under `~/.runcastle` for that branch. Your checkout is left completely alone: it gains no commit and no stray untracked file. The branch you are reviewing is itself a casualty of the old behaviour, which makes for a tidy demonstration — its own scaffold commit sits on `main`, and asking git for `brief.md` on the feature branch still returns "path does not exist".

What this means for you day to day: new features from here on carry their brief on their own branch, so a grill session opens with the intake reasoning in front of it instead of a title. The five existing branches are deliberately not repaired — you fix those by merging their base back into each one, which was the agreed call rather than an oversight. One side effect worth knowing: every feature now keeps a working copy of its own branch on disk from the moment it is created, including quick changes that may never open a session. I measured it on this repo at roughly a third of a second and 22MB apiece, and nothing removes it until you delete the feature.

The thing that deserves your attention before you ship this is in the notes. The new helper handles a failure to cut that working copy by recording a timeline event and giving up — but it gives up before writing the brief anywhere at all, and on a plain create the brief is not stored in the database either. So in the one situation where things go wrong, the reasoning this whole feature exists to preserve is destroyed outright rather than merely left uncommitted. It is a narrow path and neither failure branch has a test, which is how it got through. Two smaller notes sit behind it, plus a disclosure that filing these notes left an untracked file in your checkout for reasons this fix does not cover on older features.

There was nothing to drive this lap — the change is server-side git plumbing and the interface is untouched — and exercising it through the app would have meant creating real features in your repo, which a review is not allowed to do. I ran the tests instead, in a throwaway clone so your checkout was never switched: 438 tests across the twenty-four files that touch this surface, all green, and the type checker clean.
