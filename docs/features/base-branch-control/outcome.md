# Outcome — Base branch control

Let the human control which branch features cut from — a per-project default that detection stops clobbering, and a visible base-branch choice on the intake path — so "always main" becomes a deliberate default instead of a silent one.

- Shipped: 2026-08-27
- Lap: 1

## 1. Project-session landing branch: own setting, resolved stored-else-detected

# ticket(1) — project-session landing branch

## What was done

The project session's landing branch is now its own per-project setting rather than a read of
`project.mainBranch`. A nullable `session_branch` column (migration `0030_productive_marvex.sql`,
generated with `bun run db:generate`) backs a project-only `sessionBranch` settings field —
no config key, no env var, following the `devCommand` pattern — so only an explicit write through
`settings.update` ever fills it, and that write emits `settings.updated` like every other.

`git.resolveSessionBranch(project)` returns the stored pick if there is one, else
`detectMainBranch(repoPath)`; a stored branch missing from `branchLocal().all` throws a `GateError`
naming the branch and telling the human to pick where the chat's work should land. Nothing
re-detects into the column, ever.

Two deviations from the letter of the ticket, both to satisfy "thread the resolved string through
rather than re-resolving per message":

- `ensureProjectWorktree` now returns `{ worktreePath, base }` instead of a bare path. It is the
  launch's single resolution point, and the injected prompt has to name the same branch the
  worktree was actually cut from. Callers destructure; eight test call sites were updated.
- `landProjectBranch` takes the resolved `base` as a required argument and carries it back on
  `ProjectLandResult`. That lets all three `reportProjectLanding` messages name the branch from the
  result with no second resolve. The fourth message — the catch arm in `landProjectSession` — takes
  the branch as a nullable parameter, because the one case where it is absent is a *failed* resolve,
  and that `GateError` already names the branch itself.

`project.sessionBranch` (tRPC) returns `{ stored, effective, detected }` for the picker. It
deliberately does **not** throw on a vanished pick, unlike `resolveSessionBranch` — a picker that
500s on exactly the state it exists to let you fix would be useless.

Six new tests in `packages/server/test/project-session.test.ts` cover both resolution branches, the
loud launch failure, cutting and landing on a picked branch rather than main, a mid-session pick
applying only at the next launch, the tRPC triple, and the emitted events.

## Surprises

- **`projectRows` in `apps/web/src/lib/settings.ts` renders every project-scoped field**, and
  `metaFor` falls back to `{ label: key, help: '' }`. Registering the settings field therefore
  shipped a row literally labelled `sessionBranch` in the settings overlay. I added a `META` entry
  ("Project chat lands on") — two lines, no new UI. This is a judgement call at the ticket's edge:
  decision 5 says this setting belongs at the project-session surface, not buried in settings, and
  the dedicated picker is a later ticket. If that ticket wants it hidden from the generic overlay
  instead, delete the entry and filter the key out of `projectRows`.
- **`packages/server/tsconfig.json` includes only `src`** — test files are not typechecked. The
  `ensureProjectWorktree` return-type change typechecked clean while every test call site was
  broken; only running the suite caught it. Do not trust a green `bun run typecheck` as evidence
  that a signature change is complete.
- **`recordHuman` no-ops for non-prepared keys**, so the new field needed nothing there.
- **My first landing assertion was wrong, not the code**: after landing on `develop`, `CONTEXT.md`
  is not in the `main` checkout's working tree. The test now asserts against `develop`'s ref.

## Verification

`bun run typecheck` — 0 errors. `env -u GIT_ASKPASS bun run test` — 130 files / 2184 passed,
1 failure: `dev-pane.test.ts > kills the child process tree so the port-holder is not orphaned`.
That one is **not mine and not in the stated baseline**, so I confirmed it: it fails identically in
a scratch `git worktree` at the branch point `6312aff`, before any of my changes. It asserts
`kill -0 -pgid` throws after a tree-kill — process-group reaping, which this container does not do.

Drive machinery: checked, not edited, and correctly so. This branch adds no service, no required
env var, no seed, and no process — only a migration, which `runMigrations` picks up by scanning
`packages/server/drizzle/*.sql` (no registration list to update), and which the standing
instruction says the idempotent drive steps already cover. `.runcastle/drive-setup.ts` and
`drive-stop.ts` both exist and were left untouched; they are TypeScript, so `bash -n` does not
apply, and I did not run them (no services in this sandbox).

## Left undone

- `project.mainBranch` is untouched, as instructed — `features.ts`, `findings.ts`,
  `review-ticket.ts`, `listBranches`, `projects.ts` detection-at-open and the web components all
  still read it. The later deletion ticket will find `reportProjectLanding` still takes a `project`
  argument it now uses only for `project.id`.
- `resolveSessionBranch` checks `branchLocal().all` only, exactly as the ticket specified, so a
  stored `origin/develop`-style remote-only pick would be rejected as vanished. The picker ticket
  should either restrict its options to local branches or materialize a tracking branch the way
  `resolveBaseBranch` does.
- No UI picker — that is the separate ticket, which can consume `project.sessionBranch` as-is.

## 2. Feature paths read only the feature's recorded base

# ticket(2) — feature paths read only the feature's recorded base

## What was done

Migration `0031_backfill_feature_base_branch.sql` (generated with `drizzle-kit generate --custom`,
after ticket 1's `0030`) copies each non-draft feature's `base_branch` from its own project's
`main_branch`; drafts stay null. `runMigrations` picks it up by scanning `drizzle/*.sql`, so nothing
had to be registered.

In `git.ts`, `mergeTarget(project, feature)` became `featureBase(feature)` — renamed because it is
now read at three seams, not just the merge: `mergeFeature`, `reviewCommitCount`,
`featureBranchDelta`, and (new) the talk-worktree recut in `ensureTalkWorktree`. It throws a
`GateError` naming the feature when the base is null instead of reaching for `project.mainBranch`.
`createFeatureBranch`'s `base` is now required, with no default. A new exported
`currentCheckoutBranch(project)` returns `branchLocal().current` and throws `InvalidInputError` on a
detached checkout rather than handing back simple-git's sha pseudo-branch.

`features.ts` gained one private `requestedBase(project, picked)` used by all three creation paths
(`createFeature`, `startDraft`, `quickChange`): the named base if there is one, else
`currentCheckoutBranch`. In `createFeature` it is called inside the draft ternary, so a parked draft
never touches the checkout. `review-ticket.ts` passes `feature.baseBranch` as `BASE_BRANCH`.

## Deviations

- **`review-ticket.ts` gained a guard, and it runs first.** `feature.baseBranch` is
  `string | undefined`, so the value needed a type-level answer; substituting a main line was the
  bug being fixed, so a baseless feature now returns `couldNotReview` naming the branch. It is
  placed *before* the `agent-browser` PATH probe, which makes it deterministic to test in a sandbox
  that may or may not have the CLI.
- **`seedFeature` now defaults `baseBranch: 'main'`** (was `null`) and its `overrides` type accepts
  `baseBranch: string | null` so a test can still seed a baseless row. That preserved the behaviour
  of all ~290 existing call sites exactly (they were all measured against main via the project
  column) while making the fixture honest: a seeded feature is a cut one.

## Surprises

- **`createFeatureBranch` had ~55 two-argument call sites, all in tests, none typechecked** —
  `packages/server/tsconfig.json` includes only `src`. Making `base` required typechecked clean and
  produced 106 runtime `TypeError: Cannot read properties of undefined (reading 'trim')` failures.
  Ticket 1's digest warned about exactly this; it is worth repeating.
- **`featureBranchDelta` documented itself as "Never throws"** and now can, via `featureBase`. I
  narrowed the claim to "never throws over git" rather than swallowing a missing base, because a
  drive-fix session for a feature with no base has nothing to diff either.
- **`BASE_BRANCH`'s wiring is not directly observable.** `executeReviewTicket` hands the rendered
  prompt straight to sandcastle's `run()`, and this repo has no `vi.mock` anywhere — the file's own
  header says the executor is only exercised "where it can be observed without spawning an agent".
  So the new test covers the refusal half (no recorded base ⇒ no review, no main-line substitute)
  and the render half stays covered by the existing placeholder test. I judged extracting a
  `reviewPromptValues` seam to be more surface than the ticket asked for; a later ticket that wants
  the wiring pinned should extract it rather than reach for module mocking.
- **`0023` appears twice in the drizzle journal** (`0023_chilly_callisto` sits at `idx 25`), so
  journal order and filename order already disagree upstream. `0031` is unambiguous either way.

## Verification

`bun run typecheck` — 0 errors. `env -u GIT_ASKPASS bun run test` — 133 files, 2195 passed,
4 skipped, **1 failed**: `dev-pane.test.ts > kills the child process tree so the port-holder is not
orphaned`. That is the same failure ticket 1 confirmed against a scratch worktree at the branch
point `6312aff` — this container does not reap process groups. Nothing in my diff is near it.

Drive machinery: checked, not edited. This branch adds no service, no required env var, no seed and
no process — only a migration, which the standing instruction says the idempotent drive steps
already cover. `.runcastle/drive-setup.ts` and `drive-stop.ts` both exist and are TypeScript, so
`bash -n` does not apply; I did not run them (no services in this sandbox).

## Left undone

- `project.mainBranch` is still read by `projects.ts` (detection at open), `findings.ts` (staleness),
  `git.ts:2354` (dry-run verification stamp) and `listBranches`, plus the `RUNCASTLE_MAIN_BRANCH`
  config key and the settings entry — all project-level, all the deletion ticket's.
- `currentCheckoutBranch` throws on a detached HEAD. That is a backstop nobody reaches today, since
  every shipped surface states its base; if a caller ever *does* want the detached case handled, it
  should say so at the surface rather than by softening this.
- The `isNotImplemented` catch in `ensureFeatureBranch` is vestigial — `import * as git` resolves to
  the real module and no stub remains. Left alone; deleting it is not this ticket.

## 3. Intake states the base: project context grows branches, skill teaches the convention

# ticket(3) — Intake states the base

## What was done

`get_project_context` now returns a `baseBranches` object alongside the charter, ADR
index and feature index: `current` (the human checkout's branch), `currentIsSelectable`,
`selectable` (local non-`feature/*` plus remote-only `origin/<name>`), and `detectedMain`.
It is sourced from the existing `listBranches(project)` and `detectMainBranch(project.repoPath)`,
so the agent's vocabulary of bases is exactly the web base picker's. The tool became
`async` as a result — the one production call site and four test call sites were updated,
including two `expect(() => …).toThrow` refusal assertions that had to become `rejects`.
The registered tool description names the new fields. The project skill's §1c gained the
convention in its own voice (assume current, state it in the proposal, always pass
`baseBranch` explicitly, object when it looks wrong, ask — offering `detectedMain` — only
when the checkout is not a selectable base; drafts still pass none) and the tool bullet in
§"Your tools" was extended to match.

Deviation from the ticket's sketch: I added an explicit `currentIsSelectable` boolean
rather than leaving the agent to compare `current` against the list. See below for why the
comparison was not actually safe.

## Surprises

- **The ticket guessed wrong about detached HEAD.** It says `branchLocal().current` "can be
  empty/HEAD". Measured, simple-git reports a detached HEAD as a *pseudo-branch named for the
  short sha* — `current: "9a49f92"` and `"9a49f92"` present in `all`. So `selectable.includes(current)`
  was `true` on a detached checkout: the exact case acceptance criterion 2 exists to catch would
  have reported itself as fine, and the sha would have been offered as a forkable base. I fixed
  it at the source in `listBranches` (3 lines): a detached HEAD yields `current: ''` and its sha
  is dropped from `branches`. This is a small widening of the diff beyond the tool itself, but
  the criterion is not truthfully met without it, and it also fixes the same latent bug in the
  web base pickers, which use `branches.includes(current)` (`apps/web/src/lib/feature-ui.ts:27`).
- **The ticket points at the wrong test file.** `packages/server/test/project-session.test.ts`
  covers `renderProjectPrompt` (artifacts), not this tool. `toolGetProjectContext`'s tests live in
  `packages/server/test/project-mcp-tools.test.ts`; that is where I extended them (four new cases:
  the happy path, talk branches excluded, parked-on-`feature/*`, detached HEAD), plus one at the
  git-service seam for the `listBranches` contract I changed.
- **One pre-existing test failure, unrelated to this diff.** `packages/server/test/dev-pane.test.ts >
  "kills the child process tree so the port-holder is not orphaned"` fails on this sandbox — it
  asserts a PTY process group is reaped within a fixed 400ms window. It is not in the stated
  baseline, so I confirmed it on an isolated run of that one file before deciding it was not mine;
  it touches no code this ticket edits. Everything else is green: typecheck 0 errors, tests
  2182 passed / 4 skipped / 1 failed.

## Left undone

- `BranchList.mainBranch` is still returned by `listBranches` and still read by
  `feature-ui.ts:27`; decision 4 deletes both, and that belongs to the ticket that drops the
  column, not here.
- The web default-base helper (`feature-ui.ts:27`) now receives `current: ''` on a detached
  checkout and falls through to `mainBranch`. Whoever implements decision 8's
  "current-if-selectable, else empty and mandatory" helper gets the detached case handled for
  free by the `listBranches` fix — no extra sha special-casing needed there.
- Drive machinery (`.runcastle/drive-setup.ts` etc.) was checked against its four triggers and
  needs no edit: this ticket adds no service, no boot-required env var, no seed and no
  companion process. I did not run the drive scripts — the sandbox has no services, as instructed.

## 4. Web UI: every cutting surface shows a mandatory base; session-branch picker

# ticket(4) — web: every cutting surface shows a mandatory base; session-branch picker

## What was done

`defaultBaseBranch` lost its `mainBranch` fallback: it returns the current checkout when that
checkout is a selectable base, and `''` otherwise. Its parameter narrowed to
`Pick<BranchList, 'current' | 'branches'>`, so the server's `BranchList` shape is untouched and the
contract ticket can drop the field without touching this file.

Both cutting forms now render ONE shared component, `apps/web/src/components/BaseSelect.tsx`. Quick
change had no base control at all and cut silently; the draft body had a select of its own. The
component owns the empty-and-mandatory state: an empty option appears only while there is no base,
and the hint under it explains that the checkout is not something a feature can fork from. Quick
change's `ready` gate blocks submit on an empty base (replacing the `!branchesQ.isPending` check,
which an empty base now implies); park mode renders no base control, as before.

Two deviations from the letter of the ticket, both to keep a surface from lying:

- **`nextStep`'s `draftBaseUnresolved: boolean` became `draftBaseMissing: 'loading' | 'unpicked'`.**
  The old flag's one message was "Loading the branch list…", which is false in the new case — the
  list has arrived and the checkout simply offers no base. `unpicked` says "Pick the branch to fork
  from under Advanced below." `Workspace` computes the value once and hands it to both the bar and
  `DraftBody`, which uses it to force its `<details open>` and retitle the summary: a control the
  human MUST use cannot sit behind a summary reading "Advanced".
- **`DraftBody` stopped labelling an option `(default)`.** That marker read `branches.mainBranch`,
  the field decision 4 deletes; with it gone the default IS the current branch, which the `(current)`
  marker already says. This removes the last `BranchList.mainBranch` reader in the web app.

The session-branch picker lives in `ProjectWorkspace`'s chrome as `SessionLanding`, replacing the
`projectBranchNote(project.mainBranch)` line — it now renders that same consequence sentence over
the resolved landing branch, plus the picker. Presentation is a pure helper, `sessionBranchState` in
`lib/project-workspace.ts` (tested, no DOM, matching how everything else in `lib/` is tested): it
turns `project.sessionBranch`'s `{ stored, effective, detected }` into a value, an origin, a
two-word chip label and a note, and returns `null` until the query lands, because "detected" and
"your pick" read as opposites and there is no safe guess between them. Writes go through
`settings.update` with key `sessionBranch`; reading never writes.

## Surprises

- **`resolveSessionBranch` (ticket 1) validates a stored pick against LOCAL branches only**, as its
  digest warned. So this picker offers local branches only — no remote optgroup, unlike `BaseSelect`
  — since a remote-only pick would be rejected as vanished at the next launch.
- **A third origin fell out of that**: a stored pick whose branch has since been deleted. Ticket 1
  deliberately made `sessionBranchView` not throw on it so the picker could be the fix, but a picker
  that showed it as an ordinary pick would not be one. `origin: 'vanished'` says the next chat will
  refuse to launch, is coloured with `--danger`, and the vanished branch is prepended to the options
  so the select does not render blank on the exact state it exists to repair. This is one branch in
  a pure function and its own test; flag it if the reviewer reads it as scope.
- **`project.sessionBranch` was missing from the live-sync allowlist** in `lib/live.ts`. It has no
  polling interval of its own, and the settings overlay still carries a row for the same value
  (ticket 1's `META` entry), so without this a write from the overlay left the picker stale until a
  remount — the exact class of bug the surrounding comments in that function describe.
- **`<details open={mustPick}>` is safe against the workspace's polling.** React diffs against the
  previous virtual value, so a re-render with an unchanged `open={false}` does not slam shut a
  disclosure the human opened by hand.

## Verification

`bun run typecheck` — 0 errors (core, server, web, design-system, scripts). `env -u GIT_ASKPASS bun
run test` — 132 files, 2195 passed, 1 failed: `dev-pane.test.ts > kills the child process tree so
the port-holder is not orphaned`. That failure is NOT mine and not in the stated baseline; ticket 1
already confirmed it against a scratch worktree at the branch point `6312aff` (this container does
not reap process groups). My diff touches `apps/web` only, which is fully green (562 tests). Also
ran `bunx vite build` in `apps/web` — clean.

Drive machinery: checked, not edited, and correctly so. This is a web-only change — no service, no
required env var, no seed, no process — so the standing instruction's triggers do not fire.
`.runcastle/drive-setup.ts` and `drive-stop.ts` both exist and were left untouched; they are
TypeScript, so `bash -n` does not apply, and I did not run them (no services in this sandbox).

## Left undone

- **`project.mainBranch` still has six web readers** — `ProjectSwitcher`, `Titlebar`,
  `PortfolioHome`, `OpenProject`, `CommandPalette`, and the `mainBranch` entry in `lib/settings.ts`
  (`FIELD_ENV_VAR`, `GIT_DETECTED`, `META`) plus its two assertions in `test/settings.test.ts`.
  All read the *project row*, not `BranchList`, so they belong to the deletion ticket. `BranchList`'s
  own `mainBranch` now has no reader anywhere in the web app.
- **`sessionBranch` is still a row in the generic settings overlay**, labelled "Project chat lands
  on" (ticket 1 added the `META` entry to stop it rendering as a raw key). Decision 5 says the
  control belongs at the project-session surface, which it now is; whether the duplicate settings
  row should be filtered out of `projectRows` is a judgement I left alone rather than delete
  another ticket's line. Both write the same key and invalidate each other, so they cannot disagree.
- The quick-change footer still previews `feature/<slug> ← <base>` directly under the new select,
  stating the base twice. Harmless and consistent; left as-is to keep the diff to what the ticket
  asked for.

## 5. Contract: delete project.mainBranch everywhere

# ticket(5) — Contract: delete project.mainBranch everywhere

## What was done

The stored, detection-refreshed main branch is gone in one commit (`1f8632c`, landed by an
earlier iteration of this same ticket that was killed by infrastructure before it could report).
Removed: the `main_branch` column (migration `0032_gigantic_tempest.sql`, a plain
`ALTER TABLE ... DROP COLUMN` after ticket 2's backfill in `0031`), the `mainBranch` field on the
`Project` zod schema and drizzle table, the `mainBranch` config default and its
`RUNCASTLE_MAIN_BRANCH` env override, the `mainBranch` settings descriptor, and
`BranchList.mainBranch`. `openProject` no longer detects or stores anything branch-shaped —
`detectMainBranchTolerant` is deleted and the open events no longer name a branch.

The two consumers that genuinely need "the repo's main line" as a measuring stick now detect it on
demand: findings staleness calls `detectMainBranch` once per `listFindings` (hoisted out of the
per-row loop into a distinct-sha set, so it stays one detection plus one `rev-list` per sha), and
the dry-run verification stamp calls it inline. `detectMainBranch` itself survives — it also feeds
session-branch resolution and `get_project_context`.

This iteration verified rather than rebuilt: full typecheck (exit 0) and full suite, plus a
self-review of the whole diff, a repo-wide sweep, and a check that no removed CSS class had a
remaining user.

## Surprises

- **The suite has one failure, and it is not this ticket's.** `packages/server/test/dev-pane.test.ts
  > "kills the child process tree so the port-holder is not orphaned"` fails on `pidAlive(-pgid)`
  — the sandbox does not reap the process group the way the assertion expects. The test file and
  every source file it exercises are byte-identical to the merge-base with main, and this branch has
  no commit touching them; it fails identically when run alone. Environment fault, not a regression.
  Everything else is green: **2200 passed, 1 failed, 4 skipped across 133 files**.
- **The stated baseline is stale.** The brief promised 118 files / 1768 tests / 0 failed; tickets 1–4
  grew that to 133 / 2205. Worth knowing before someone reads the failure count as new breakage.
- **The new `detectMainBranch` call sites cannot throw**, which is why swapping a stored column for a
  git shell-out is safe here: every branch of that function is try/caught and it falls back to the
  literal `'main'`. A findings list on a project whose repo has vanished behaves as before.
- **`main_branch` still appears in four test files** (`base-branch-backfill`, `events-migration`,
  `drive-env-migration`, `feature-size-drop`) as raw SQL. That is correct, not a straggler: each
  builds a historical schema state, inserts, then applies the remaining migrations. The backfill test
  runs the *full* dir, so it now exercises `0032` against a populated database — which is what makes
  the "applies cleanly to an existing database" criterion actually tested rather than assumed.
- **Five decorative UI readers had no honest replacement.** The titlebar branch chip, switcher row,
  portfolio card line, command-palette project subtitle and open-project toast all displayed a branch
  the human never picked. They show nothing now, and their three dead CSS classes went with them
  (verified zero remaining users). Showing a freshly-detected branch there would have re-created the
  fiction the feature exists to remove.

## Left undone

- `apps/web/src/lib/feature-ui.ts:253` labels the shipped phase `'Merged to the main branch'`. Since
  ticket 2, a feature merges to its own recorded base, which may not be the main line — the copy is
  now imprecise. Left alone deliberately: it does not match the sweep grep and rewording user-facing
  status copy is outside this ticket.
- `docs/SPEC.md` still documents `mainBranch`. The acceptance criteria explicitly exempt spec/ADR/
  decision docs, so it stands as the build-era record; someone doing a docs pass may want it.
- **Drive machinery: no change needed, and checked.** This ticket removes an env var rather than
  adding a service, seed, or required variable, and `grep` over `.runcastle/` finds no reference to
  `RUNCASTLE_MAIN_BRANCH`. Per the standing instruction I checked rather than ran — the drive scripts
  themselves were not executed, since this sandbox has no services.

## 6. Review: base branch control lands end-to-end

This lap took the branch a feature forks from and turned it from something the app quietly decided into something you can see and change. The stored "main branch" that got re-detected and overwritten every time you opened a project is gone outright — column, config key, settings field and all — and with it the fiction that a value you could never correct was your choice. In its place, every surface that cuts a branch now shows the branch it will cut from. The Quick door's change mode gained a base select prefilled with whatever you are actually checked out on; the Start picker on a parked draft lost its silent fall back to main; and when the checkout is somewhere nothing can fork from — a feature branch mid test-drive, or a detached HEAD — both controls come up empty and refuse to submit until you pick, rather than guessing on your behalf.

Two things that were never really about branch choice got fixed on the way past. A feature's review now diffs against the branch it genuinely forked from, so a feature cut from develop is no longer measured against main and credited with every commit develop happens to be behind. And where the project chat's own work lands — the charter, the ADRs — became a picker sitting next to that chat, labelled for what it does, instead of a field called "main branch" that nobody would have guessed controlled it. It starts out showing a detected value so a fresh project needs no setup, and only writes something down when you deliberately choose.

The chat intake changed convention rather than machinery: it now tells you which branch it is about to cut from as part of proposing a feature, and you redirect it by saying so. It only asks outright when the current checkout is genuinely unusable as a base.

Two things deserve your attention. The landing-branch picker has a real hole in it: change the setting while a project chat is still open and that live session's work will land on the new branch, even though it was cut from the old one — the spec put exactly that out of scope, and the code's own comments describe the guarantee it fails to keep. Separately, opening a parked draft now makes a background query fail on a loop, because a draft has no base to measure commits against and nothing checks for that before asking. Both are written up as notes.

You should also know this pass was thinner than it should have been. A single stray untracked file, left behind by an unrelated feature, made the working tree dirty and the drive refused to start — so nothing here was confirmed by actually running the app, and neither test suite was executed. The code review covered the whole branch and the database migrations were checked for real against a populated database, but the base selects, the blocking empty state and the picker's persistence were read rather than driven. Clear that file and re-run the review if you want those confirmed before shipping.
