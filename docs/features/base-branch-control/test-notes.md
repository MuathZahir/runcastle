# Test notes

## Lap 1

- [ ] DRIVE COULD NOT START — the app was never booted, so no acceptance criterion was verified by driving.

What I did: called review_drive({action:"start"}) as the first step of the drive.
What happened: refused with `deniedReason: "Working tree has uncommitted changes — commit or stash first"`. `git status --porcelain` shows exactly one entry: `?? docs/features/codex-project-sessions-honour-permissionmode/test-notes.md` — an untracked file belonging to a DIFFERENT feature (codex-project-sessions-honour-permissionmode), not to this branch. `git stash list` is empty.
What I expected: the drive to switch the checkout to feature/base-branch-control, render the per-branch database and boot the dev server on 4512/4513.

I did not retry (refusals are final) and I did not clean or stash the file, because the review must not mutate the human's working tree. Consequence: no browser walkthrough, no walkthrough.webm, and the `bun test` runs the ticket asked for could not be executed against the integrated branch (the checkout is still parked on `main`). Everything I report about behaviour therefore comes from reading the branch diff, not from running it.

To unblock a re-review: commit or stash that one stray test-notes.md file, then re-run the review ticket.
- [ ] CODE REVIEW (spec/correctness, my own verification of the git-service seam) — opening a parked draft makes `feature.commitCount` throw every 5 seconds.

What I did: traced the removal of `mergeTarget` through its callers on feature/base-branch-control.

What happens:
- `packages/server/src/services/git.ts` replaces `mergeTarget(project, feature) => feature.baseBranch ?? project.mainBranch` with `featureBase(feature)`, which THROWS `GateError("feature <slug> has no recorded base branch — it has not been cut from one yet")` when `baseBranch` is null.
- `reviewCommitCount` calls `const base = featureBase(feature)` on the line BEFORE its `try {` block, so the throw escapes the function's own error handling (same shape in `featureBranchDelta`).
- `packages/server/src/trpc/routers/feature.ts:218-223` — the `commitCount` query has NO `features.requireNotDraft(feature)` guard, unlike `testDrive` twelve lines above it which does.
- `apps/web/src/components/Workspace.tsx:90` fires `trpc.feature.commitCount.useQuery({ featureId }, { refetchInterval: useLivePoll(5000) })` unconditionally — no `enabled` option — and the same component renders `DraftBody` for drafts (`isDraft` at :142, `<DraftBody>` at :584). By the feature's own design a draft's `baseBranch` is null until Start (migration 0031 deliberately excludes drafts).

So: open any parked draft in the workspace → `commitCount` errors on every 5s poll.

What I expected: the same clean degradation as before this branch — `mergeTarget` returned a branch, the `try` swallowed the failed `rev-list`, and the query resolved to `{ base, count: undefined }`, which the UI already knows how to paint ("commits unknown"). Now it is an errored query on a loop.

Note the neighbouring `branches` query at Workspace.tsx:138-142 is explicitly gated ("Only fetched for a draft"), so the `enabled`/guard idiom was in hand — this one was just missed.

Fix is one of: add `enabled: !isDraft` at Workspace.tsx:90, add `requireNotDraft` to the router, or move `featureBase()` inside the existing `try` so a baseless feature yields `count: undefined` as it used to. NOT verified by driving — the drive would not start (see the drive note); this is traced through the source only.
- [ ] CODE REVIEW — Standards axis — `docs/SPEC.md` still documents `project.mainBranch` as a live contract on ten lines; nothing in the 80-file diff touches it.

Citation (CLAUDE.md, "Conventions" preamble): "**Read `docs/SPEC.md` before implementing anything.** It pins every contract (schemas, tRPC map, gates, file ownership). **Names in the spec are law.**"

What I did: `git show feature/base-branch-control:docs/SPEC.md | grep -n "mainBranch\|MAIN_BRANCH"`.
What I found — every one of these now describes something the branch deleted:
- `:45` — `Project { id, name, repoPath, mainBranch, devCommand? }`
- `:46` — "`baseBranch` … (choosable; defaults to `mainBranch`)"
- `:74` — `RuncastleConfig` defaults include `mainBranch: 'main'`
- `:89` — `initProject(repoPath) [detects mainBranch]`
- `:117` — "`project.init` … stores mainBranch"
- `:118`, `:164` — `project.branches` / `listBranches` → `{ current, mainBranch, branches, remoteBranches }`
- `:120` — "resolve `baseBranch` (default `mainBranch`)"
- `:163` — `createFeatureBranch(project, slug, base?)` "(default `project.mainBranch`)"
- `:172` — "`mergeFeature`: target = `feature.baseBranch ?? mainBranch`"

What I expected: since CLAUDE.md points every implementing agent at SPEC.md first and calls its names law, the contract lines the branch invalidated would move with it — the branch-list payload shape and the merge-target rule in particular, because the next agent to read `:172` will build a `?? mainBranch` fallback that decision 4 exists to forbid.

**This is a judgement call, not a hard violation, and it was disclosed.** SPEC.md's own preamble says it "may describe states the code has since moved past. The code and README are authoritative for current behavior," and ticket 5's digest states it was left alone deliberately because "the acceptance criteria explicitly exempt spec/ADR/decision docs." So this is a docs-pass ticket for the human to schedule or decline, not a defect in the implementation. README and ADRs 0001–0010 are clean — I checked.
- [ ] CODE REVIEW — Standards axis — smell: **Duplicated Code**. The "is the current checkout a usable base?" rule is now written twice, in two shapes, in two packages.

Server — `packages/server/src/mcp/server.ts`, `readBaseBranches`:
```
const { current, branches, remoteBranches } = await git.listBranches(project)
const selectable = [...branches, ...remoteBranches]
return { current, currentIsSelectable: selectable.includes(current), selectable, ... }
```
Web — `apps/web/src/lib/feature-ui.ts:30-32`, `defaultBaseBranch`:
```
export function defaultBaseBranch(data: Pick<BranchList, 'current' | 'branches'>): string {
  return data.branches.includes(data.current) ? data.current : ''
}
```

Same question — is `current` selectable — answered against two different sets: locals-plus-remotes on the server, locals-only on the web. The server's own doc comment states the goal the duplication works against: "`listBranches` is the same vocabulary the web base pickers use … so a base the agent picks here and a base a human picks in the form are the same set of things."

**Accuracy caveat, because it matters for how you triage this:** the two sets cannot actually disagree today. `current` is the checkout's branch, which is always local, so adding `remoteBranches` to the server's set never changes the answer. The intake agent and the web forms will agree on every real repo. This is a maintenance smell — one rule, two homes, and only a comment tying them together — not a behavioural divergence, and I am not reporting it as a bug.

What I expected: one shared predicate (core is the natural home — it is the package both already depend on for wire types) that both the MCP payload and the form default call, so the "same set of things" promise is enforced by the code rather than restated in prose.
- [ ] CODE REVIEW — Spec axis — a session-branch pick made **while a project session is open** retargets that live session's landing, which the spec puts out of scope.

Spec, "Out of scope": *"No retargeting of a live project session when the session-branch pick changes; next launch only."* Decision 6 says the same and gives the reason: *"A pick made while a project session is open takes effect at the next session launch — the live session's branch was already cut."*

What I did: traced every `resolveSessionBranch` call site on the branch (`git grep -n resolveSessionBranch feature/base-branch-control -- packages/server/src`).

What I found — the value is resolved **twice, independently**, and nothing carries the first answer to the second:
- **At launch**, `packages/server/src/services/git.ts:652`, inside `ensureProjectWorktree`: `const base = await resolveSessionBranch(project)` — the worktree is cut from this.
- **At session end**, `packages/server/src/launcher/sessions.ts:803`, inside `landProjectSession`: `const landing = resolveSessionBranch(project).then((base) => landProjectBranch(project, base)...)` — resolved fresh against the project row as it is *now* (fetched at :787 via `getProjectById`).

So the reproduction is: open the project chat on a zero-config project (`sessionBranch` null → detected `main`); the `runcastle/project` worktree is cut from `main`. With the terminal still open, set the landing-branch picker to `develop`. End the session. The landing merges a branch that was cut from `main` onto `develop` — carrying every commit `main` has that `develop` does not, which is exactly the class of accident decision 6 was written to prevent.

What I expected: the base resolved at launch to be pinned for the life of the session (stamped on the session row, or threaded from `ensureProjectWorktree`, which already returns it — `launcher.ts:861` destructures `const { worktreePath, base } = await git.ensureProjectWorktree(...)` and then discards `base`), so the landing lands where the cut was made.

Why the existing test does not catch it: `packages/server/test/project-session.test.ts` has a case named for this behaviour ("applies a pick at the next launch, never under the session already running"), but its `runcastle/project` branch carries no commits, so `landProjectBranch` returns null and short-circuits before the base is used. A version of that test with one commit on the branch would fail.

NOT verified by driving — the drive would not start (see the drive note); traced through the source only.
- [ ] CODE REVIEW — Standards axis — smell: **Primitive Obsession**. `Feature.baseBranch` stays an optional string, so "a draft has no base, everything else must have one" is enforced by scattered runtime throws instead of by the type.

`packages/core/src/schemas.ts` keeps `baseBranch?: string` after this branch made it mandatory for every cut feature. The compensation is spread across three files:

`packages/server/src/services/git.ts`:
```
function featureBase(feature: Feature): string {
  if (!feature.baseBranch) {
    throw new GateError(`feature ${feature.slug} has no recorded base branch — it has not been cut from one yet`)
  }
  ...
}
```
`packages/server/src/workflows/review-ticket.ts` re-checks the same thing independently:
```
if (!feature.baseBranch) {
  return couldNotReview(ticket, `feature ${feature.slug} has no recorded base branch, so there is nothing to diff ...`)
}
```
and migration `0031` encodes the same rule a third time, in SQL: `WHERE base_branch IS NULL AND status != 'draft'`.

Draft-vs-cut is a real distinction the schema declines to make, so every consumer re-asks it and each answers differently — `featureBase` throws, `review-ticket` returns a soft outcome, the migration filters. That divergence is not hypothetical: it is exactly how the draft `commitCount` regression I filed separately got through, since the third consumer (`reviewCommitCount` via the tRPC router) simply forgot to ask.

What I expected: the distinction carried in the type — a discriminated union on `status`, or a narrowing helper such as `asCutFeature(feature)` that returns a `Feature & { baseBranch: string }` — so a caller that has not handled the draft case does not typecheck, rather than throwing at runtime on whichever screen happens to reach it.

Judgement call, not a hard violation — CLAUDE.md pins strict TypeScript and no `any`, both of which this diff honours; there is no documented rule requiring the union. Filing it because the smell has already produced one real bug on this branch.
- [ ] SUMMARY OF THIS REVIEW PASS — read this first.

**Scope of what actually ran.** The code review ran in full: 21 commits, 80 files, `main...feature/base-branch-control`, read along both axes. **The drive never started** — `review_drive` refused on a dirty tree caused by one untracked file belonging to a different feature (`docs/features/codex-project-sessions-honour-permissionmode/test-notes.md`). Refusals are final, and I would not clean the human's tree, so there is no browser walkthrough, no walkthrough.webm, and the `bun test` runs the ticket asked for did not happen. Every behavioural claim below is traced through source, not observed running. All five implementation tickets landed — this is a review of a complete feature, not a partial one.

**Standards axis — 2 findings, both judgement calls, no hard violations.** Worst within this axis: `docs/SPEC.md` still pins `project.mainBranch` as a live contract on ten lines, including `mergeFeature` "target = `feature.baseBranch ?? mainBranch`" (:172) — the exact fallback decision 4 exists to forbid, left in the file CLAUDE.md tells every implementing agent to read first and calls law. Ticket 5 disclosed this as deliberate. Also filed: Duplicated Code (the "is `current` selectable?" rule written twice, server and web) and Primitive Obsession (`baseBranch?: string` guarded by scattered runtime throws).

**Spec axis — 2 findings.** Worst within this axis: **a session-branch pick made while the project chat is open retargets that live session's landing**, which the spec explicitly puts out of scope. `resolveSessionBranch` is called twice — once at launch in `ensureProjectWorktree`, once again at session end in `landProjectSession` — so a worktree cut from `main` can be merged onto `develop`. Two pieces of the branch's own code state the invariant it breaks: `landProjectBranch`'s doc comment ("passed in rather than resolved here so one launch resolves once"), and the new `ProjectWorktree.base` field, documented as "the resolved session branch the worktree was cut from **and will land on**" — which `launcher.ts:861` destructures and then discards. Also filed: `feature.commitCount` throws on every draft (found independently by both my own trace and the spec axis).

**One sub-agent claim I refuted and did NOT file:** that `QuickForm`'s unstamped `basePick` state could survive a project switch. It cannot — `Shell.tsx:46` renders `<ProjectShell key={nav.currentProjectId}>`, so switching projects remounts the whole subtree and discards the pick.

**What I verified positively, by static means:**
- *Criterion 6, migrations — verified empirically.* I extracted the three SQL files to a temp dir outside the repo and applied them in journal order to a populated SQLite database. All three applied clean; the backfill is per-project (two projects, `develop` and `master`, each backfilled from its own row), drafts stayed null, a pre-existing `release/1.x` base was not clobbered, and `main_branch` was gone with `session_branch` present at the end. Journal idx 30/31/32 are in ascending order.
- *Criterion 6, sweep.* `git grep` over the branch finds no live code reading `project.mainBranch`. Survivors are `detectMainBranch` (kept on purpose), four test files building historical schema in raw SQL (correct), and `.design-sync/templates/app-redesign/AppRedesign.dc.html`, which still binds a `mainBranch` prop — correctly untouched per CLAUDE.md's fence around `.design-sync/`, but it now depicts a field that no longer exists, so the next design round-trip will carry it back in.
- *Criterion 5.* `mergeFeature`, `reviewCommitCount`, `featureBranchDelta` and talk-worktree recreation all read `featureBase(feature)` with no project fallback; `review-ticket.ts` passes `BASE_BRANCH: feature.baseBranch`.
- *Criterion 4.* `readBaseBranches` returns `{ current, currentIsSelectable, selectable, detectedMain }`, and the project SKILL.md carries the state-don't-ask convention with all three departures, the unselectable-checkout one included.

**What I could not verify at all:** criterion 1 (neither suite was run), criteria 2 and 3 as *behaviour* — the mandatory base select, the empty-and-blocking unselectable state, and the landing-branch picker's persistence were read in `BaseSelect.tsx`, `QuickForm.tsx`, `DraftBody.tsx` and `ProjectWorkspace.tsx` but never operated. Note also that ticket 5's own digest reports a pre-existing failure in `packages/server/test/dev-pane.test.ts` (`pidAlive(-pgid)`), which it argues is an environment fault rather than a regression — I could not confirm or refute that, since I ran no tests.

**Minor shape deviation, not filed as a finding.** `listBranches` now returns `current: ''` on a detached HEAD and filters the sha pseudo-branch out of `branches`, where the spec seam said `current` and `branches` would be "unchanged". The change is well-commented and is what makes decision 7's unselectable case work at all, so it reads as a necessary refinement rather than creep — recording it only so the wire-shape difference is not a surprise.

**To re-review properly:** commit or stash that one stray `test-notes.md`, then re-run this review ticket — the drive will start and criteria 1–3 can actually be exercised.
