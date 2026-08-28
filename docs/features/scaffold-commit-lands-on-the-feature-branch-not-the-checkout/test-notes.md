# Test notes

## Lap 1

- [ ] [Code review — Standards axis] The human's brief is silently destroyed when the talk worktree cannot be cut.

File: packages/server/src/services/features.ts — the new `scaffoldDocsOnFeatureBranch` helper (~lines 505-535 on the branch).

What the code does: when `git.ensureTalkWorktree` throws anything that is NOT a `NotImplementedError`, the helper emits a `docs.scaffold_failed` event and `return`s — it never calls `scaffoldDocs`. Before this change, `scaffoldDocs(ctx, feature, { brief })` ran unconditionally and only the *commit* was best-effort, so the brief always reached disk.

Why that loses data: in `createFeature` the row is inserted with `brief: input.draft ? (input.brief ?? null) : null` (features.ts ~line 157). On a live (non-draft) create the brief is NOT stored in the DB column, so `input.brief` is the only copy in existence. If the worktree cannot be cut, that copy is dropped on the floor — no file, no column, no recovery. This is exactly the `create_feature({ brief })` flow the ticket exists to protect: "without it that reasoning evaporates when the intake terminal closes" (the `brief?` field's own doc comment, features.ts ~line 120).

Citation — it contradicts two things the diff itself asserts:
1. The helper's own docstring: "Best-effort throughout, like every other docs checkpoint: neither a worktree that cannot be created nor a commit hiccup may cost the human their feature." A vanished brief costs them the feature's whole reason for existing.
2. The rewritten comment in packages/server/src/services/feature-docs.ts, which now claims the checkout fallback "covers what has no worktree — a feature whose worktree could not be cut". After this diff, nothing is ever written to the checkout on that path, so `featureDocsDir`'s fallback documents a branch that can no longer be reached from creation.

Note the sibling precedent gets this right in spirit: `promoteOutcomeDoc` (services/outcome.ts:110-129) composes the doc *content* inside the try, so there is nothing to lose — the new helper has content in hand and discards it.

Expected: on a worktree failure, still write the brief somewhere durable (the `featureDocsDir` checkout fallback, or the `brief` column) before emitting `docs.scaffold_failed`, so the failure costs the human a commit and not their intake reasoning. `startDraft` is unaffected (the brief stays in the column); `quickChange` is recoverable (the prose is stored on the tickets). `createFeature` is the irrecoverable one.

Not covered by tests: neither the `docs.scaffold_failed` branch nor the `isNotImplemented` branch has a test, which is how this got through.
- [ ] [Code review — Standards axis] A failed docs commit now leaves no trace at all — the same silence the ticket exists to end.

File: packages/server/src/services/features.ts, tail of `scaffoldDocsOnFeatureBranch`:

```
  scaffoldDocs(ctx, feature, opts)
  try {
    await git.commitDocs(worktreePath, `runcastle: scaffold ${feature.slug} docs`)
  } catch {
    // best-effort — the docs sit in the worktree; only the auto-commit is skipped
  }
```

Citation — Divergent Change / inconsistent handling against the module this helper is explicitly modelled on. `promoteOutcomeDoc` (packages/server/src/services/outcome.ts:115-129) wraps ensure-worktree AND `commitDocs` in one try and turns any failure into a `docs.outcome_failed` timeline event. The new helper emits an event for the worktree failure but swallows the commit failure into a bare `catch {}` with no event.

Why it matters more than it used to: before this diff a swallowed commit failure left the brief as an untracked file in the human's own checkout, where `git status` showed it to them immediately. Now it leaves the brief inside a talk worktree under ~/.runcastle that the human never looks at, with `feature/<slug>` carrying no brief.md — which is precisely the observable symptom this ticket was filed to fix, reachable again through a path that emits nothing.

Also relevant: CLAUDE.md, Conventions — "Every service function that mutates emits an event — events are the UI's lifeblood ... a missed emit costs the UI half a minute of staleness". Here the miss is permanent, not 30 seconds.

Expected: fold the `commitDocs` failure into the same `docs.scaffold_failed` emit, so a briefless feature branch always has a timeline entry naming why.

Judgement call, not a hard violation — the pre-existing code swallowed commit failures too. What changed is the consequence.
- [ ] [Code review — Standards axis] The new data-dir pinning in project-mcp-tools.test.ts leaks a temp tree — including a full git worktree — on every test.

File: packages/server/test/project-mcp-tools.test.ts, the beforeEach/afterEach added by this diff:

```
  beforeEach(async () => {
    restoreDataDir = useDataDir(tmpRepo())
    ...
  afterEach(() => {
    clearRuntimeCtx()
    restoreDataDir()
  })
```

`tmpRepo()` (test/helpers/fixtures.ts:11) is `mkdtempSync(join(tmpdir(), 'runcastle-test-'))`, and `useDataDir` (test/helpers/data-dir.ts) only saves/restores env vars — it deletes nothing. The path is not even captured in a variable here, so it cannot be cleaned up afterwards. Because creation now cuts the feature's talk worktree under the data dir, each `create_feature` test leaves a complete checkout of the repo behind in %TEMP%, per test, per run.

Citation — Duplicated Code, and inconsistency with the two sibling files this same diff wrote. feature-create.test.ts and quick-change.test.ts both do the full three-step version:

```
  home = tmpRepo()
  restoreDataDir = useDataDir(home)
  ...
  afterEach(() => { restoreDataDir(); rmSync(home, { recursive: true, force: true }) })
```

The third copy dropped the `rmSync`. Three hand-rolled copies of the same tmpRepo + useDataDir + rmSync sequence is the smell; the divergent third copy is the bug it produced.

Expected: one shared helper (e.g. `withTempDataDir()` alongside `useDataDir`) that all three files call, so the cleanup cannot be forgotten a fourth time.

I did not observe the leak by running it — this is read off the diff and the two helper files, both of which I opened and confirmed.
- [ ] [Review summary — lap 1, scaffold-commit-lands-on-the-feature-branch-not-the-checkout]

WHAT I DID. Code review of `git diff main...feature/scaffold-commit-lands-on-the-feature-branch-not-the-checkout` (4 commits, 6 files, +175/-80) on both axes. No app drive — see below. I ran the tests in a throwaway `git clone --local` of the repo at %TEMP%, checked out to the feature branch, so your checkout was never switched, never written to, and never held a drive slot.

STANDARDS AXIS — 3 findings, all filed as separate notes.
Worst within this axis: `scaffoldDocsOnFeatureBranch` (features.ts ~505-535) skips `scaffoldDocs` entirely when `ensureTalkWorktree` throws, and on a live `createFeature` the brief exists nowhere else (the row stores `brief: … : null`), so the human's intake reasoning is destroyed with no recovery. The other two: a `commitDocs` failure is swallowed with no timeline event (diverges from `promoteOutcomeDoc`, which emits `docs.outcome_failed`); and the new data-dir pinning in `project-mcp-tools.test.ts` omits the `rmSync` its two sibling files have, leaking a temp tree with a full worktree in it per test.

SPEC AXIS — 0 unique findings filed. Every named requirement landed. All three regression assertions exist in `feature-create.test.ts` and pass: (a) `git show feature/cleanly:docs/features/cleanly/brief.md` equals the brief verbatim, (b) the checkout's HEAD equals `tipBefore` and is still `main`, (c) `git status --porcelain` is empty. "Apply the same fix to the quick-change door and to startDraft" is done — all three doors now route through the one helper, with matching assertions in `quick-change.test.ts` and `draft-features.test.ts`. No migration was added, per "Do not add a migration for existing branches". Worst within this axis: the axis independently reached the same defect as the Standards note above, citing "the whole point of `create_feature({ brief })` is defeated" — it is one bug and one fix, already filed once, not two tickets.

WHAT I VERIFIED BY RUNNING IT. The 4 touched test files: 69 passed. 20 further test files that touch the changed surface (gates, git, outcome, delete, docs-watch, mapped, mcp-tools, project-session, rethink, lap-*, launch-artifacts, merge-conflict, encoding, converge, waypoint-work, projects, project-resolution, review-ticket, mapped-smoke): 369 passed, 4 skipped, 0 failed. `tsc --noEmit` in packages/server: exit 0.

AND THE BUG IS VISIBLY REAL IN THIS REPO. `git branch --contains 7246aeb` — this feature's own "runcastle: scaffold scaffold-commit-lands-on-the-feature-branch-not-the-checkout docs" commit — returns `main` only, and `git show feature/scaffold-commit-…:docs/features/scaffold-commit-…/brief.md` is `fatal: path does not exist`. The branch under review has no brief of its own, because it was created by the code it fixes.

WHAT I COULD NOT REACH. No drive. The change is server-internal git plumbing — nothing in apps/web changed — and the only way to exercise it through the UI would be to create features in your real checkout, which would cut branches and worktrees in it. That is a repo mutation this review is forbidden to make, so the code review plus the test run stands alone. I also deliberately did not run the full server suite: `dev-pane` and other PTY/port-binding tests would contend with the runcastle server running on this host. That means the implementer's claim of a pre-existing `dev-pane.test.ts` failure is unverified by me either way.

TWO SUB-AGENT CLAIMS I CHECKED AND DROPPED, so you don't chase them: (1) "the new `docs.scaffold_failed` event has no renderer" — false; `Inspector.tsx` renders any type generically via `humanType`, and `eventTone` already gives anything containing "failed" the danger tone, exactly as it does for the existing `docs.outcome_failed`. (2) "a third docs checkpoint repeats the same shape" — there is no third; only `scaffoldDocsOnFeatureBranch` and `promoteOutcomeDoc` share it, which is thin ground for an extraction.

ONE ADJACENT NOTE, not filed as a finding. Every feature now cuts a full talk worktree at creation, including quick changes that may never open a talk session. The ticket sanctioned this route explicitly, and I measured the cost on this repo: ~0.36s and ~22MB per feature. Nothing removes that worktree until the feature is deleted — pre-existing lifecycle, not this diff's doing, but it now applies to more features than before.

All implementation tickets in this burn succeeded; this is a review of a fully built feature.
- [ ] [Observed during this review — disclosure, and a residual edge] Filing my notes left an untracked file in your checkout.

What I did: called `add_test_note` four times during this review. What happened: `docs/features/scaffold-commit-lands-on-the-feature-branch-not-the-checkout/test-notes.md` now exists, untracked, in your working tree at C:\Users\user\Projects\_Active_\runcastle (mtime 11:30:58, matching my last note). `git status --porcelain` at the start of this session was empty; it now reads `?? docs/features/scaffold-commit-…/test-notes.md`.

Why: the notes writer resolves its path through `featureDocsDir` (packages/server/src/services/feature-docs.ts), which returns the talk worktree only `if (existsSync(worktree))` and otherwise falls back to `project.repoPath`. This feature was born through the quick-change door under the OLD code, so it never got a worktree — the fallback fires and the notes land in your checkout.

Citation, against the ticket's own criterion: "then the human's checkout must show no new commit and no untracked docs." That criterion is met for the *scaffold* writer, which is what the ticket asked to fix and which the regression tests pin. It is not met for the *notes* writer, on any feature that has no worktree on disk.

Scope, honestly stated: after this change every new feature cuts its worktree at creation, so `featureDocsDir` resolves to the worktree and notes go to the right place. The residue is confined to features created before this fix — the same set the ticket explicitly declines to migrate ("Do not add a migration for existing branches; the human repairs those by merging their base into the branch"). So this is expected fallout of a deliberate decision, not a defect in the diff.

Expected / what you may want: nothing in the diff needs to change. But you have a stray untracked file to `git rm`/ignore before your next test-drive or merge, since both gates refuse on a dirty tree — and the same will happen on each of the five legacy feature branches the moment anything writes docs for them. I did not delete it myself; this review is not permitted to modify your repo.
