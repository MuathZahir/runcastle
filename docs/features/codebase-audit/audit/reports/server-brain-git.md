# Audit report — server brain: git / test-drive machinery

Scope (read in full): `packages/server/src/services/git.ts` (2117), `repo.ts` (218),
`prep.ts` (136), `drive-env.ts` (155), `drive-hooks.ts` (198), `test-notes.ts` (259).
Contract-only reads: `events.ts`, `db/schema.ts`, `errors.ts`, `trpc/routers/*`,
`services/features.ts`, `services/feature-docs.ts`, `services/knowledge.ts`,
`launcher/sessions.ts`, `mcp/server.ts`. Tests assessed, not run.

Leaf agent — no subagents spawned. Analysis only; no source edited.

---

## A. Flow map

### A1. Test drive (the human's checkout-switch gate)

```
apps/web  →  feature.testDrive({featureId, action})
  trpc/routers/feature.ts:169-175   testDrive procedure
    ├─ repo.ts:96   getFeatureRow(ctx,id)
    ├─ repo.ts:142  projectForFeature(ctx,feature)
    └─ git.ts:1410  testDrive(ctx, project, feature, action)
         ── action 'start' ──────────────────────────────────────
         git.ts:1484  g.raw(['status','--porcelain'])      → DENY_DIRTY
         git.ts:1486  if (testDriveState)                  → DENY_ACTIVE / DENY_DRY_RUN_ACTIVE
         git.ts:1492  repo.ts:173 hasActiveRun(ctx,id)     → DENY_ACTIVE_RUN
         git.ts:1502  worktreesOnBranch → listWorktrees (git worktree list --porcelain, :490)
         git.ts:1503  detachWorktree(holder)  (git checkout --detach, :563)
         git.ts:1507  g.revparse(['--abbrev-ref','HEAD'])  → previousBranch
         git.ts:1508  g.checkout(branch)                   ← MUTATION
         git.ts:1509  testDriveState = {...}               ← module singleton
         git.ts:1518  emit 'testdrive.started'             → events.ts:74 emit
         git.ts:1529  driveEnvFor → drive-env.ts:105 parseDriveEnv → :143 driveProcessEnv
                        emits 'testdrive.env' / 'testdrive.env_unknown_placeholder' (git.ts:1865/1873, emitScoped)
         git.ts:1530  runDriveHookStep('setup') → drive-hooks.ts:116 runDriveHook → node:child_process.spawn
                        emits testdrive.setup_started / _ok / _failed (git.ts:1910/1921/1929)
         git.ts:1545  pty/dev-pane.ts startDevPane(...)    ← BOUNDARY (sibling: pty/launcher)
                        onUrl → git.ts:1394 recordDriveUrl → emit 'testdrive.url' (:1398)
         → TestDriveResult { ok, branch, hookFailure? }

         ── action 'stop' ───────────────────────────────────────
         git.ts:1421  !testDriveState → DENY_NONE_ACTIVE ; kind!=='feature' → DENY_DRY_RUN_ACTIVE
         git.ts:1430  pty/dev-pane.ts stopDevPane(devPaneId)   ← BOUNDARY
         git.ts:1438  runDriveHookStep('teardown')  (BEFORE the switch back — deliberate, :1433-1437)
         git.ts:1452  dirtyPaths(g) (:1953)                → carriedChanges
         git.ts:1454  g.checkout(previousBranch)            ← MUTATION
         git.ts:1457  reattachWorktree(detachedWorktree, branch) (:573, best-effort)
         git.ts:1458  testDriveState = undefined
         git.ts:1459  emit 'testdrive.stopped'  [+ :1466 'testdrive.carried_changes']
         git.ts:1473  detectDbDrift (:1983) → diffPaths(:803) → migrationPaths(:134)
                        → emit 'testdrive.db_drift' (:2001)
         → TestDriveResult { ok, branch, carriedChanges?, dbDrift?, hookFailure? }
```

UI read path: `feature.driveInfo` (`trpc/routers/feature.ts:179`) → `git.ts:1376
activeDriveInfo()` — a *synchronous read of the module singleton*, polled at 1.5s.

### A2. Merge / ship

```
apps/web  →  feature.merge({featureId})
  trpc/routers/feature.ts:194-220
    ├─ git.ts:1371 activeTestDriveFeatureId() === feature.id → git.ts:1410 testDrive(...,'stop')
    ├─ git.ts:2037 mergeFeature(project, feature)      ← NO ctx, EMITS NOTHING
    │    :2040 if (testDriveState) throw GateError
    │    :2045 status --porcelain → GateError (dirty)
    │    :2050 branchLocal, target must exist → GateError
    │    :2055 revparse HEAD → previous
    │    :2057 g.checkout(target)                       ← MUTATION
    │    :2060 g.merge(['--no-ff', branch])             ← MUTATION
    │    :2061 restoreBranch(g, previous, target) (:2085, best-effort)
    │    on throw → mergeInProgress(:2110) → conflictedFiles(:2100) → merge --abort → restoreBranch
    ├─ ok  → repo.ts:187 setPhase('shipped') [emits] ; repo.ts:204 setFeatureStatus [emits]
    └─ !ok → events.ts emit 'merge.conflict' AT THE ROUTER (feature.ts:213)
```

### A3. AFK temp-branch landing (burner / research / project session)

```
workflows/ticket-burner.ts  ← BOUNDARY (sibling orchestrator owns it)
  git.ts:939  allowPushToCheckedOutBranches (git config receive.denyCurrentBranch=ignore)
  git.ts:638  ticketBranchName / :625 researchBranchName → :615 tempBranchSlugSegment (ADR-0003 truncation)
  git.ts:980  mergeTempBranch(repoPath, featureBranch, tempBranch)
      :999  listWorktrees → holder?
        holder → gw.merge([temp]) ; on conflict: conflictedFiles → merge --abort → {conflict, files}
        none   → g.raw(['fetch','.', 'temp:feature'])  (ref-only FF)
                 on refusal → :1040 mergeInDisposableWorktree (mkdtempSync(tmpdir(),'rc-land-'))
      :1028 deleteBranchDetachingWorktrees (:1088)
  git.ts:669  cleanupBurnWorktree(repoPath, branch) → :650 burnWorktreePath
  git.ts:895  findPreservedTicketBranch → :861 listTicketAttemptBranches → :714 branchCommitsAhead

launcher/sessions.ts:702  landProjectBranch(project) (git.ts:1129)
  → git.ts:980 mergeTempBranch(repoPath, mainBranch, PROJECT_BRANCH)
  → the CALLER emits project.landed / project.land_conflict / project.land_failed (sessions.ts:695-736)
launcher/launcher.ts → git.ts:408 ensureProjectWorktree (lands leftovers, recuts PROJECT_BRANCH)
```

### A4. Preparation dry-run drive (same singleton slot)

```
mcp/server.ts (dry_run_drive tool)  and  trpc/routers/project.ts:116 (dryRunStop)
  → git.ts:1624 dryRunDrive(ctx, project, 'start'|'status'|'stop')
      start → :1645 startDryRun: revparse HEAD (no checkout!), driveEnvFor, runDriveHookStep('setup'),
              startDevPane, emitProject 'prep.dryrun.started' (:1658)
      status→ :1635 liveFields(state) (:1827) — pure read
      stop  → :1719 stopDryRun: stopDevPane, teardown hook, emitProject 'prep.dryrun.stopped' (:1740),
              dryRunVerdict (:1789) → findings.ts markVerified → emitProject 'prep.dryrun.verified' (:1750)

trpc/routers/project.ts:105 prep → prep.ts:127 prepView → git.ts:1376 activeDriveInfo()
```

### A5. Test notes (review-phase capture)

```
trpc/routers/test-notes.ts → test-notes.ts
  :80  addNote     → insert → emit 'note.added'     → renderTestNotes (:246)
  :111 editNote    → update → emit 'note.edited'    → renderTestNotes
  :132 deleteNote  → delete → emit 'note.deleted'   → renderTestNotes
  :150 toggleNote  → update → emit 'note.toggled'   → renderTestNotes
  :207 promoteNote → tickets.ts storeTickets → update → emit 'note.promoted' → renderTestNotes
  renderTestNotes → feature-docs.ts featureDocPath → mkdirSync/writeFileSync docs/features/<slug>/test-notes.md
```

`test-notes.ts` is the **only** file in this scope that obeys the house rule
without exception: five mutators, five emits, one render. It is the reference
implementation the rest of the scope should be measured against.

### A6. Feature create / delete (crosses into `features.ts`)

```
features.ts:136 createFeature
  :306 git.ts:310 resolveBaseBranch  ← MUTATES (git branch --track), no emit anywhere
  :306 git.ts:238 createFeatureBranch ← MUTATES, no emit in git.ts (caller emits feature.created :159)
  :167 knowledge.scaffoldDocs (writes into project.repoPath — worktree does not exist yet)
  :175 git.ts:1290 commitDocs(project.repoPath, ...) ← MUTATES (a real commit), no emit, see D4
features.ts:872 deleteFeature
  :873 git.testDrive(...,'stop')  :878 git.ts:1219 removeTalkWorktree  :882 git.ts:1254 deleteFeatureBranches
```

---

## B. Dead code

Nothing in this scope is unreachable. What exists is a cluster of **over-exports**:
symbols whose bodies are live (called from inside their own module) but whose
`export` keyword has zero consumers anywhere in `packages/`, `apps/` or `scripts/`,
tests included. Verification method for every item below: repo-wide
`grep -rn '\b<symbol>\b' --include=*.ts --include=*.tsx packages apps scripts`,
excluding the defining file — count 0.

| `file:line` | symbol | internal use | external refs | confidence |
|---|---|---|---|---|
| `git.ts:134` | `export function migrationPaths` | `detectDbDrift` (:1992) | 0 | high |
| `git.ts:591` | `export const RESEARCH_BRANCH_PREFIX` | `researchBranchName` (:626), `TEMP_BRANCH_PREFIXES` (:602) | 0 | high |
| `git.ts:592` | `export const TICKET_BRANCH_PREFIX` | `ticketBranchName` (:639), `ticketBranchPrefix` (:857) | 0 | high |
| `git.ts:615` | `export function tempBranchSlugSegment` | :626, :639, :857, :1181, :1263 | 0 | high |
| `git.ts:766` | `export async function headSha` | `stopDryRun` (:1748) | 0 | high |
| `git.ts:803` | `export async function diffPaths` | `detectDbDrift` (:1992) | 0 | high |
| `drive-hooks.ts:77` | `export function hookSpawnTarget` | `runDriveHook` (:124) | 0 | high |

> `git.ts:134` — `/** The migration-looking subset of a diff's paths. Pure. */ export function migrationPaths(...)`
> `drive-hooks.ts:77` — `export function hookSpawnTarget(command: string): { file: string; args: string[]; verbatim: boolean }`

**Canonical key:** `dead-code:git-over-exports` · **Kind:** violation ·
**Confidence:** high · **Effort:** S · **Risk:** low.

Two adjacent, *weaker* cases (test-only exports — legitimate if the repo accepts
testing through exported internals, but worth naming since they widen the module
interface for no production caller):

- `git.ts:650 burnWorktreePath` — only external refs are 3 lines in
  `test/git.test.ts`; production use is internal (`cleanupBurnWorktree`, :674).
- `drive-hooks.ts:54 tailLines`, `:24 DRIVE_HOOK_TIMEOUT_MS`,
  `drive-env.ts:46 identifierSafe`, `:59 driveVars` — external refs are
  `test/drive-hooks.test.ts` / `test/drive-env.test.ts` only.
- `git.ts:1362 __resetTestDriveState` — explicitly documented as test-only
  (`/** Test-only: clear the in-memory test-drive state (not called by any router). */`);
  the `__` prefix makes this the honest form. **Not a finding** — it is the pattern
  the others should adopt if they stay exported.

**Canonical key:** `test-only-export:git-drive` · **Kind:** judgement call ·
**Confidence:** high (the reference counts) / medium (that it's worth changing) ·
**Effort:** S · **Risk:** low.

---

## C. Redundancy & repeated logic

### C1. `git worktree remove --force → rmSync fallback → worktree prune`, three times

Three near-identical Windows-lock-tolerant worktree teardown blocks:

- `git.ts:669-700` `cleanupBurnWorktree` — retry loop (3× / 750ms) + `rmSync` + `prune`, returns `!existsSync`.
- `git.ts:1219-1243` `removeTalkWorktree` — single attempt + `rmSync` + `prune`, **throws** if the dir survives.
- `git.ts:1068-1079` `mergeInDisposableWorktree`'s `finally` — `worktree remove --force` + `rmSync(dir)`, swallows.

```ts
// git.ts:681      await g.raw(['worktree', 'remove', '--force', path])
// git.ts:1222     await g.raw(['worktree', 'remove', '--force', worktreePath])
// git.ts:1070     await g.raw(['worktree', 'remove', '--force', wt])
```

Three callers = a **real seam** (≥2). The differences are policy (retry count,
throw-vs-swallow), not mechanism, and are exactly what a single
`removeWorktree(g, path, { attempts, onFailure: 'throw' | 'report' })` should
parameterize. Today the Windows retry+delay knowledge lives in only ONE of the
three: `removeTalkWorktree` — the one that *throws* on a locked file — has no
retry at all, so the delete path the user hits most is the least robust one.

**Canonical key:** `redundant:worktree-teardown` · **Kind:** judgement call ·
**Confidence:** high · **Effort:** M · **Risk:** medium (three distinct failure
policies must be preserved).

### C2. `stdout → non-empty trimmed lines`, six times

```ts
git.ts:722   .split('\n').map((l) => l.trim()).filter(Boolean)      // branchCommitsAhead
git.ts:806   out ? out.split('\n').map((s) => s.trim()).filter(Boolean) : []   // diffPaths
git.ts:834   .split('\n').map((l) => l.trim()).filter(Boolean)      // commitSummaries
git.ts:1296  .split('\n').map((s) => s.trim()).filter(Boolean)      // commitDocs staged
git.ts:1958  .split('\n') …                                          // dirtyPaths
git.ts:2103  out ? out.split('\n').map((s) => s.trim()).filter(Boolean) : []   // conflictedFiles
```

Six sites, five of them byte-identical. A `function gitLines(out: string): string[]`
next to `errMsg` (:160) removes them all. Small, but this is precisely the kind of
munging where a `\r\n` bug hides on Windows — and none of the six normalizes CRLF,
whereas `drive-hooks.ts:55 tailLines` explicitly does
(`text.replace(/\r\n/g, '\n')`). The inconsistency is the point: the same repo
knows the rule in one file and forgets it in six places in another.

**Canonical key:** `redundant:git-line-parsing` · **Kind:** judgement call ·
**Confidence:** high · **Effort:** S · **Risk:** low.

### C3. `try { … } catch { return <empty> }` — 51 catch blocks in one file

`git.ts` contains 51 `catch` clauses; the overwhelming majority are the same
best-effort shape: swallow, return `[]` / `undefined` / `false`. Individually each
is well-argued in a comment. Collectively they mean **`git.ts` cannot distinguish
"git said no" from "git is not installed" from "repoPath was deleted"** anywhere
except the four `InvalidInputError` / `GateError` sites. There is no
`gitTry(fn, fallback)` and no single place where a swallowed git failure is
observed, so a repo that has gone bad degrades into a UI that silently reports
"0 commits / no worktrees / no branches" instead of an error.

**Canonical key:** `swallowed-errors:git` · **Kind:** judgement call ·
**Confidence:** high (the count) / medium (that consolidation is the right fix) ·
**Effort:** M · **Risk:** medium.

### C4. Drive start/stop is written twice — feature drive and dry run

`testDrive` (:1410) and `dryRunDrive`/`startDryRun`/`stopDryRun` (:1624/:1645/:1719)
share: singleton-slot check, `driveEnvFor`, `runDriveHookStep('setup')`,
`startDevPane` + URL sniffing, `stopDevPane`, `runDriveHookStep('teardown')`,
slot release. They differ in exactly two things: the branch switch, and the
event scope (`emit` vs `emitProject`). The shared parts are *already* factored
(`driveEnvFor`, `runDriveHookStep`, `EmitScope`) — but the two *lifecycles* are
still transcribed twice, which is why the URL recorders are also duplicated:

```ts
// git.ts:1394 recordDriveUrl      — kind !== 'feature' → return; emit(ctx, featureId, 'testdrive.url')
// git.ts:1773 recordDryRunUrl     — kind !== 'dryRun'  → return; emitProject(ctx, projectId, 'prep.dryrun.url')
```

Two adapters exist (feature, dryRun) → real seam. A `DriveKind` strategy over one
`startDrive`/`stopDrive` would concentrate the ordering invariants (teardown
before switch-back; pane dies before the stop hook) that are currently asserted by
comment in two places.

**Canonical key:** `redundant:drive-lifecycle` · **Kind:** judgement call ·
**Confidence:** medium-high · **Effort:** L · **Risk:** medium-high (this is the
most load-bearing code in the scope; the dry-run verdict is all-or-nothing).

### C5. `hookSpawnTarget` vs `devSpawnTarget` — deliberate, NOT a finding

`drive-hooks.ts:60-90` explains at length why the shell CHOICE is mirrored from
`pty/dev-pane.ts devSpawnTarget` but the QUOTING cannot be shared
(`windowsVerbatimArguments` vs node-pty). Documented decision — recording it here
so a sibling agent does not re-file it as duplication.

---

## D. Inconsistencies & structural smells

### D1. The house rule "every mutating service function emits an event" — 13 silent mutators

Verified counts: `git.ts` has **42 value exports** and **5 bare `emit(` call-sites**
(`:1398`, `:1459`, `:1466`, `:1518`, `:2001`) — confirming the parent's figure —
plus 4 `emitProject(` (`:1658`, `:1740`, `:1750`, `:1777`) and 5 `emitScoped(`
(`:1865`, `:1873`, `:1910`, `:1921`, `:1929`), 14 in total. All 14 sit inside the
drive machinery (`recordDriveUrl`, `testDrive`, the dry-run trio, `driveEnvFor`,
`runDriveHookStep`, `detectDbDrift`); **the other ~1300 lines of `git.ts` emit
nothing at all**. `repo.ts` has 18
exports and 2 emits (both correct — every mutator there emits).
`prep.ts`, `drive-env.ts`, `drive-hooks.ts` import no emitter at all — correct for
all three: `prep.ts` is read-only, `drive-env.ts` is pure, and `drive-hooks.ts`
deliberately returns a `DriveHookResult` its *caller* (`runDriveHookStep`, :1910)
narrates. **Those three are not findings.**

The file header itself concedes the gap (`git.ts:31-36`):

> "Event note: only `testDrive` receives an `AppCtx`, so it is the only function
> here that emits timeline events directly. … we do not widen the pinned
> signatures to inject `ctx`."

Exhaustive list of **mutating** git.ts exports that emit nothing, and what the UI
therefore misses (events poll at 1.5s, so "no event" = "invisible until reload"):

| `file:line` | function | repo mutation | caller emits? | UI blind spot |
|---|---|---|---|---|
| `git.ts:238` | `createFeatureBranch` | `git branch <b> <base>` (:251) | yes — `features.ts:159 feature.created` | none |
| `git.ts:310` | `resolveBaseBranch` | **`git branch --track <name> <base>`** (:322) | no | a *new local branch* materialized from a remote pick is never announced |
| `git.ts:337` | `ensureTalkWorktree` | `branch` + `worktree add` (:345,:359) | no | worktree creation/repair is invisible; a `prune`+retry heal (:378-386) leaves no trace |
| `git.ts:408` | `ensureProjectWorktree` | lands leftovers (`mergeTempBranch`), **deletes and recuts `runcastle/project`** (:422-423), `worktree add` | no | a *silent landing of a previous session's commits* at launch, and a branch delete, with no timeline row at all |
| `git.ts:553` | `detachWorktree` | `git checkout --detach` | no | — (mechanically invisible by design) |
| `git.ts:573` | `reattachWorktree` | `git checkout <branch>` | no | a *failed* reattach (silently swallowed, :576-579) leaves the talk worktree detached with nothing said |
| `git.ts:669` | `cleanupBurnWorktree` | `worktree remove --force`, `rmSync`, `prune` | no | a worktree that could NOT be removed returns `false` and nobody reports it |
| `git.ts:847` | `deleteTempBranch` | `branch -D` | no (`features.ts:690` calls it in a loop, best-effort) | discarded attempt branches never named |
| `git.ts:939` | `allowPushToCheckedOutBranches` | **writes `.git/config`** | no | a persistent config change to the user's repo, never disclosed |
| `git.ts:980` | `mergeTempBranch` | merge / `fetch . t:f` / disposable worktree / `branch -D` | partly — burner narrates; `ensureProjectWorktree` (:415) does **not** | see `ensureProjectWorktree` row |
| `git.ts:1159` | `cleanupTempBranches` | `branch -D` over the whole repo at boot | caller-dependent | a boot sweep deleting branches with (at best) one summary line |
| `git.ts:1219` | `removeTalkWorktree` | `worktree remove --force` / `rmSync` | `features.ts` delete path | ok-ish |
| `git.ts:1254` | `deleteFeatureBranches` | `branch -D` × N | `features.ts` delete path | the `kept` list (branches git refused to delete) is returned but not evidently surfaced |
| `git.ts:1290` | `commitDocs` | **`git add` + `git commit`** | no | **a commit is created in the user's repo with no timeline event** |
| `git.ts:2037` | `mergeFeature` | `checkout target`, `merge --no-ff`, `merge --abort`, `checkout previous` | router emits only on the **failure** path (`feature.ts:213 merge.conflict`); success goes through `setPhase`/`setFeatureStatus` | the merge itself — the single most consequential repo mutation in the product — has **no `merge.ok`/`feature.merged` event**; the timeline shows a phase change, not a merge, and never names the base branch on success |

The two most defensible-to-fix are the two that create durable artifacts with
nothing said: `commitDocs` (a commit) and `allowPushToCheckedOutBranches` (a
`.git/config` write). The most *user-visible* is `mergeFeature`.

**Canonical key:** `inconsistent:event-emission` · **Kind:** violation (the house
rule is stated in `CLAUDE.md` and `events.ts:8-9`) · **Confidence:** high ·
**Effort:** M (needs `ctx`/`EmitScope` threaded into pinned signatures — the exact
thing `git.ts:35` declines to do) · **Risk:** low-medium.

### D2. Two raw `throw new Error` in an otherwise typed error layer — CONFIRMED

`grep -rn "throw new Error(" packages/server/src/services/*.ts` returns **exactly two
lines, both in `git.ts`**:

```ts
git.ts:249    throw new Error(`base branch "${from}" does not exist in ${project.repoPath}`)
git.ts:326  throw new Error(`base branch "${base}" does not exist in ${project.repoPath}`)
```

Every other failure in the service layer uses `InvalidInputError` / `NotFoundError`
/ `GateError` (git.ts itself uses `InvalidInputError` at :186, :193, :195, :388,
:1238 and `GateError` at :2041, :2047, :2052). Both raw throws are on the *same
condition* ("base branch does not exist") reached from the *same caller*
(`features.ts:305-306 ensureFeatureBranch`) — so `createFeature` maps a
user-correctable input error onto a 500-shaped generic error instead of the
tRPC `BAD_REQUEST` the domain classes produce. Worse, `ensureFeatureBranch`
(`features.ts:299-317`) only special-cases `isNotImplemented(e)` and rethrows
everything else, so the message reaches the UI as an untyped crash.

There is a third, subtler case: `git.ts:2074`
`throw e instanceof Error ? e : new Error(errMsg(e))` — a re-wrap in `mergeFeature`'s
non-conflict path, which produces the same untyped shape for "merge failed for an
unknown reason".

**Canonical key:** `inconsistent:error-types` · **Kind:** violation ·
**Confidence:** high · **Effort:** S · **Risk:** low.

### D3. `git.ts` is at least six modules (2117 lines, 42 exports)

Concrete seams, each labelled with **caller count outside its own section** —
2+ = real seam, 1 = speculative:

| Seam | Lines | Exports | External callers | Verdict |
|---|---|---|---|---|
| **worktree lifecycle** (`listWorktrees`, `registeredWorktrees`, `worktreesOnBranch`, `worktreeIsValid`, `addWorktree`, `checkoutInWorktree`, `detach/reattach`, `removeTalkWorktree`, `cleanupBurnWorktree`, `burnWorktreePath`) | 329-580, 642-705, 1209-1243 | 8 | `features.ts`, `launcher/*`, `workflows/ticket-burner.ts`, `dev/state.ts`, `mcp/server.ts` | **real seam** — this is the single biggest and most independently-testable cluster |
| **temp-branch naming** (`RESEARCH_/TICKET_BRANCH_PREFIX`, `PROJECT_BRANCH`, `tempBranchSlugSegment`, `researchBranchName`, `ticketBranchName`, `ticketBranchPrefix`, `tempBranchPrefix`) | 582-640, 855-858, 1147-1150 | 6 | `ticket-burner.ts`, `research` workflow, `sessions.ts` | **real seam**, and it is IO-free — it belongs in `@runcastle/core` (see G1) |
| **merge & landing** (`mergeTempBranch`, `mergeInDisposableWorktree`, `deleteBranchDetachingWorktrees`, `landProjectBranch`, `mergeFeature`, `restoreBranch`, `conflictedFiles`, `mergeInProgress`) | 943-1140, 2015-2117 | 4 | `ticket-burner.ts`, `sessions.ts`, `trpc/routers/feature.ts` | **real seam** |
| **read-only git queries** (`branchCommitsAhead`, `reviewCommitCount`, `headSha`, `commitsSince`, `diffPaths`, `commitSummaries`, `listTicketAttemptBranches`, `findPreservedTicketBranch`, `listBranches`, `detectMainBranch`, `assertRepo`) | 182-225, 255-327, 707-919 | 6 | `findings.ts`, `projects.ts`, `features.ts`, `ticket-burner.ts`, routers | **real seam** |
| **drive machinery** (`DriveState`, `testDrive`, `dryRunDrive` + 12 helpers, `driveEnvFor`, `runDriveHookStep`, `detectDbDrift`, `dirtyPaths`, `migrationPaths`) | 1306-2013 | 8 | routers, `mcp/server.ts`, `prep.ts`, `features.ts` | **real seam** — ~700 lines, its own module, and the only part holding mutable state |
| **guards** (`DENY_*` constants, the three deny checks) | 138-144, 1420-1492, 2040-2053 | 0 | in-file only | **speculative** — one caller each; the constants are the interface, not a module |
| **process spawn** | — | — | already extracted to `drive-hooks.ts` / `pty/dev-pane.ts` | done |

**Canonical key:** `god-module:git-service` · **Kind:** judgement call ·
**Confidence:** high (that it is several modules) / medium (on the exact cut
lines) · **Effort:** L · **Risk:** medium — the file has no cyclic imports and the
sections barely reference each other (the drive section calls `diffPaths` and
`worktreesOnBranch`; the merge section calls `deleteBranchDetachingWorktrees`),
so this is mostly mechanical.

### D4. `commitDocs` commits to whichever branch a *path's* HEAD happens to be on

`commitDocs(worktreePath, message)` (`git.ts:1290`) takes a path and commits — it
never asserts, or even reads, which branch that path is on. Two callers pass
different kinds of path:

```ts
mcp/server.ts:340       await git.commitDocs(session.worktreePath, message)   // the talk worktree, on feature/<slug> ✓
features.ts:175, :285   await git.commitDocs(project.repoPath, `runcastle: scaffold ${slug} docs`)  // the HUMAN's checkout
```

In `createFeature` the sequence is: `ensureFeatureBranch` cuts `feature/<slug>`
from `baseBranch` (`features.ts:306`) → `scaffoldDocs` writes into
`project.repoPath` (the talk worktree does not exist yet, `feature-docs.ts:19-20`
falls back to `repoPath`) → `commitDocs(project.repoPath)` commits **on whatever
branch the main checkout currently has HEAD on**, which is neither guaranteed to
be `baseBranch` nor ever `feature/<slug>` (the branch was cut *before* the commit).

Consequences:

1. **A runcastle commit lands on the human's current branch**, unasked. If they
   are sitting on `main` while creating a `develop`-based feature, `main` gets
   `runcastle: scaffold <slug> docs`.
2. **`brief.md` is not on the feature branch.** The repo's own test asserts this:
   `test/feature-create.test.ts:85` — *"The feature branch tip is develop's tip
   (before its own doc commit)."* So once `ensureTalkWorktree` checks
   `feature/<slug>` out, the talk worktree does not contain
   `docs/features/<slug>/brief.md` — while `launcher/artifacts.ts:131` tells the
   agent, in its system prompt, to read exactly that path:
   `` `- \`${docs}/brief.md\` — the seed brief (title + one-liner).` ``
   `scaffoldDocs` is called only from `features.ts:167` and `:257` (creation), so
   nothing re-materializes it later.
3. A subsequent test drive of that feature `git checkout`s the feature branch in
   the main checkout, at which point `docs/features/<slug>/` **disappears** from
   the working tree.

Effect (2) is the one to verify first — it is a doc/prompt contract drift with a
runtime consequence for every talk session.

**Canonical key:** `latent-bug:docs-commit-branch` · **Kind:** violation
(prompt promises a file the worktree does not have) · **Confidence:** high on the
mechanism (traced end to end, and pinned by the repo's own test assertion);
medium on the user-visible severity (an agent may recover via the MCP context tools) ·
**Effort:** M · **Risk:** medium (changing where the scaffold commit lands touches
the ship gates' dirty-tree assumption, which is why it was written this way).

### D5. `repo.ts` — a clean module with one shape drift

`repo.ts` is the counter-example: 4 row→wire mappers, 11 pure reads, 2 mutators,
both emitting (`:196`, `:211`). One inconsistency worth naming: the reads split
three ways with no stated rule —

```ts
repo.ts:91   tryGetFeature      → Feature | null
repo.ts:96   getFeatureRow      → Feature   (throws NotFoundError)
repo.ts:103  getProjectById     → Project | null
repo.ts:135  requireProjectById → Project   (throws)
repo.ts:148  getRunRow          → Run       (throws)   ← named `get*` but throws, unlike getProjectById
```

`getFeatureRow`/`getRunRow` throw while `getProjectById` returns null; the
throwing variants are named `get*` in two cases and `require*` in one. Three
prefixes (`try`/`get`/`require`) for two behaviors.

**Canonical key:** `inconsistent:getter-naming` · **Kind:** judgement call ·
**Confidence:** high · **Effort:** S · **Risk:** low (rename + call-site sweep).

### D6. Data clump / primitive obsession: `(repoPath, branch)` and `(project, feature)`

`(repoPath: string, branch: string)` is threaded through 9 exported signatures
(`branchCommitsAhead`, `deleteTempBranch`, `cleanupBurnWorktree`,
`burnWorktreePath`, `mergeTempBranch`, `commitsSince`, `diffPaths`,
`commitSummaries`, `findPreservedTicketBranch`), each re-deriving
`const g = git(repoPath)` (`git.ts:156-158`) as its first statement — 20+ times in
the file. Meanwhile the *other half* of the module takes `(project: Project, …)`
and derives `project.repoPath`. Two conventions for "which repo", chosen per
function with no rule. A `RepoHandle { path, git }` value (or simply passing the
`SimpleGit` the way the private helpers already do — `addWorktree(g, …)`,
`worktreesOnBranch(g, …)`, `deleteBranchDetachingWorktrees(g, repoPath, …)` —
note that last one takes **both**) would collapse it.

`git.ts:1088 deleteBranchDetachingWorktrees(g, repoPath, branch)` taking both a
`SimpleGit` *and* the path it was built from is the clearest tell.

**Canonical key:** `data-clump:repo-handle` · **Kind:** judgement call ·
**Confidence:** high · **Effort:** M · **Risk:** low.

### D7. Repeated switch on drive kind

`testDriveState.kind` is switched on at `:1372`, `:1379`, `:1424`, `:1396`,
`:1489`, `:1631`, `:1650`, `:1774` — eight sites across `activeTestDriveFeatureId`,
`activeDriveInfo`, `testDrive`, `recordDriveUrl`, `dryRunDrive`, `startDryRun`,
`recordDryRunUrl`. Classic repeated-switch-on-a-tagged-union; the payload of C4.

**Canonical key:** `repeated-switch:drive-kind` · **Kind:** judgement call ·
**Confidence:** high · **Effort:** M (folds into C4) · **Risk:** medium.

---

## E. Wrong-tool & weak-typing findings

The scope is genuinely strict: **no `any`, no `as any`, no `@ts-ignore`, no `!`
non-null assertions** in any of the six files. What follows is thinner than
usual, by the code's own merit.

### E1. Regex parsing of git porcelain output instead of `-z` machine formats

```ts
git.ts:499-508   const w = line.match(/^worktree\s+(.+)$/)   // worktree list --porcelain
                 const b = line.match(/^branch\s+refs\/heads\/(.+)$/)
git.ts:1955-1964 out.split('\n').map((line) => line.slice(3).trim())   // status --porcelain
                   .map((p) => (p.includes(' -> ') ? (p.split(' -> ').at(-1) ?? p) : p))
                   .map((p) => p.replace(/^"|"$/g, ''))
```

`dirtyPaths` (`:1953`) strips surrounding quotes but does **not** decode git's
C-style escapes. With `core.quotepath` at its default (`true`), any path with a
non-ASCII byte comes back as `"docs/f\303\251ature.md"` — the quotes are stripped
and the octal escapes are handed to the user verbatim in the
`testdrive.carried_changes` event message (`git.ts:1466-1470`), and into
`TestDriveResult.carriedChanges` that the UI renders. `git status --porcelain -z`
(or `-c core.quotepath=false`) is the tool for this. The same applies to
`conflictedFiles` (`:2100`) and `diffPaths` (`:803`), whose outputs are fed to the
conflict-resolver agent as file paths.

`test/encoding.test.ts` (128 lines) covers MCP/HTTP/sqlite UTF-8 round-tripping
and explicitly targets the em-dash mojibake finding — but it never touches a git
path. So the one non-ASCII surface that is *still* lossy is the one the encoding
regression suite does not reach.

**Canonical key:** `wrong-tool:git-porcelain-parsing` · **Kind:** violation
(wrong tool for a documented-lossy format) · **Confidence:** medium-high (behavior
inferred from git's documented default, not observed) · **Effort:** S ·
**Risk:** low.

### E2. Stringly-typed event `type` built by interpolation

```ts
git.ts:1911   type: `testdrive.${phase}_started`,
git.ts:1922   type: `testdrive.${phase}_ok`,
git.ts:1930   type: `testdrive.${phase}_failed`,
```

`EmitInput.type` is `string` (`events.ts:21`), so six event types in this scope
exist only as template-literal fragments — ungreppable from the UI side, which
must match `'testdrive.setup_failed'` etc. as literals. Not a type error; a
findability and drift hazard. (Sibling scopes almost certainly share the
stringly-typed `EmitInput.type` — see H.)

**Canonical key:** `stringly-typed:event-type` · **Kind:** judgement call ·
**Confidence:** high · **Effort:** M (repo-wide union) · **Risk:** low.

### E3. `NodeJS.ProcessEnv` as the drive-env carrier

`drive-env.ts:143 driveProcessEnv` returns `NodeJS.ProcessEnv`
(`Record<string, string | undefined>`) built from a `Record<string, string>`. The
`undefined`-tolerant type then travels through `DriveState.env` (`git.ts:1339`),
`RunDriveHookOptions.env` (`drive-hooks.ts:99`) and `startDevPane`. The precise
type is already known at the source; widening it at the boundary is the small
weak-typing move here.

**Canonical key:** `weak-typing:drive-env` · **Kind:** judgement call ·
**Confidence:** medium · **Effort:** S · **Risk:** low.

### E4. Manual `KEY=VALUE` parsing where the repo's tool is zod

`drive-env.ts:105-128 parseDriveEnv` hand-rolls dotenv (comment stripping,
`export ` prefix, quote stripping via `:131 unquote`). The header argues for
leniency, and I accept that — a zod schema would reject where this must not.
**Not a finding**, recorded so a sibling does not file it. The genuine gap is that
`\n` / `\t` escape sequences inside a quoted value are *not* interpreted, which a
`.env` reader would do — a `driveEnv` line copied from a working `.env` can
therefore behave differently under a drive than outside one. Low severity, no test
covers it (`test/drive-env.test.ts:82-` tests blank/comment/quote handling only).

---

## F. Shallow modules / deletion-test candidates

### F1. `prep.ts` `prepView` is a four-field aggregator, but it earns its keep

`prep.ts:127-136 prepView` is a 9-line pass-through composing `keysToPrepare`,
`listFindings`, `isPrepared`, `preparedAt`, `activeDriveInfo`. Deletion test:
inlining it into `trpc/routers/project.ts:105` would push five service calls and
the `drive?.dryRun ? drive : null` rule into the router — and that rule
(`prep.ts:134`) is a real invariant (a *feature* drive holding the slot must not
be reported as a dry run). **Passes** the deletion test. Not a finding.

`prep.ts:32 keysToPrepare` is thinner — `unsetPreparedKeys(project).filter(isOverwritable)`
— but it has two callers (`:48 isPrepared`, `:130 prepView`) and names a domain
rule. Passes.

### F2. `git.ts:156 git(repoPath)` — a one-line alias

```ts
function git(repoPath: string): SimpleGit { return simpleGit(repoPath) }
```

Interface ≡ implementation. Deletion test: removing it costs one import rename
across ~20 sites and loses nothing — *unless* it becomes the seam where the
`RepoHandle` of D6 lands, or where a `gitTry` wrapper (C3) hooks in. Today: shallow.
Tomorrow: the obvious place to put the depth the module lacks.

**Canonical key:** `shallow:git-alias` · **Kind:** judgement call ·
**Confidence:** medium · **Effort:** S · **Risk:** low. (Recommend *deepening*
rather than deleting — see G2.)

### F3. `git.ts:147 featureBranch(slug)` and `:152 mergeTarget(project, feature)`

`featureBranch` is `` `feature/${slug}` `` — but it is used at 6 sites in `git.ts`
and the same literal is *re-hand-built* elsewhere: `features.ts:134`
`const branch = \`feature/${slug}\``, `git.ts:280` `.startsWith('feature/')`,
`git.ts:292`, `git.ts:1178-1181` `b.slice('feature/'.length)`. So the concept has a
name in one file and a literal in five places — the opposite of shallow: it is
under-used, not thin. `mergeTarget` (2 in-file callers) genuinely earns its keep;
it is the invariant that `reviewCommitCount` and `mergeFeature` agree on the base
(`git.ts:736-738`).

**Canonical key:** `primitive-obsession:branch-names` · **Kind:** judgement call ·
**Confidence:** high · **Effort:** S · **Risk:** low.

### F4. `git.ts:1371 activeTestDriveFeatureId()`

`testDriveState?.kind === 'feature' ? testDriveState.featureId : undefined` — a
one-line read with one production caller (`trpc/routers/feature.ts:202`) plus
`features.ts:559`/`:872`. Three callers, and it hides the singleton's shape from
them. Passes the deletion test *because* `activeDriveInfo()` already exists and
returning the whole `DriveInfo` would leak the dry-run case to a merge guard.
Not a finding.

---

## G. Deepening / consolidation / extraction opportunities (ranked)

Ranked by (value × confidence) ÷ effort.

**G1. Move temp-branch naming into `@runcastle/core`** — *real seam, 3+ external callers*
- Extract: `RESEARCH_BRANCH_PREFIX`, `TICKET_BRANCH_PREFIX`, `PROJECT_BRANCH`,
  `TEMP_BRANCH_PREFIXES`, `tempBranchSlugSegment`, `researchBranchName`,
  `ticketBranchName`, `ticketBranchPrefix`, `tempBranchPrefix`, plus
  `featureBranch` (`git.ts:147`) — `git.ts:582-640, 855-858, 1147-1150`.
- Rationale (locality): these are **pure string functions with zero IO** sitting in
  the one file that shells out to git. They encode ADR-0003's Windows MAX_PATH
  truncation rule, which is a *contract* between the burner, sandcastle's worktree
  naming and the boot sweep — exactly the kind of thing `@runcastle/core` exists for
  (`CLAUDE.md`: "IO-free contracts"). Leverage: `ticket-burner.ts`, the research
  workflow, `sessions.ts` and `features.ts` stop importing the git service to
  compute a string, and `features.ts:134`'s hand-built `` `feature/${slug}` ``
  gets a name.
- Effort **S**. Blast radius: import lines only; no behavior change. Highest
  value-per-effort item in the scope.

**G2. Extract a `worktrees` module (and give it the retry policy)** — *real seam, 5 external callers*
- Extract: `git.ts:329-580` + `642-705` + `1209-1243` →
  `services/git/worktrees.ts`: `listWorktrees`, `registeredWorktrees`,
  `worktreesOnBranch`, `worktreeIsValid`, `addWorktree`, `checkoutInWorktree`,
  `detachWorktree`, `reattachWorktree`, `ensureTalkWorktree`,
  `ensureProjectWorktree`, `removeTalkWorktree`, `cleanupBurnWorktree`,
  `burnWorktreePath`, `canon`.
- Rationale: this is where *all* the Windows-specific knowledge lives — `canon()`'s
  8.3/case folding (`:172-180`), the `Directory not empty` retry (`:661-667`), the
  `prune`-then-retry heal (`:378-386`), MAX_PATH avoidance via `tmpdir()`
  (`:1047`). Concentrating it makes the platform rules testable as one surface and
  lets C1's three teardown blocks collapse into one `removeWorktree(path, policy)`
  that *all three* callers get the retry loop from — closing the gap where
  `removeTalkWorktree` (the user-facing delete) is the least robust of the three.
- Effort **M**. Blast radius: `features.ts`, `launcher/*`, `ticket-burner.ts`,
  `dev/state.ts`, `mcp/server.ts` import sites; no behavior change except the
  intentional retry unification.

**G3. Thread `EmitScope` through the mutating git functions** — closes D1
- Change: give `commitDocs`, `mergeFeature`, `ensureProjectWorktree`,
  `cleanupTempBranches`, `allowPushToCheckedOutBranches`, `resolveBaseBranch` an
  optional `(ctx, scope)` and emit. `EmitScope` + `emitScoped` (`events.ts`,
  already used at `git.ts:1865/1873/1910/1921/1929`) is the mechanism — it exists
  precisely so a function can emit without knowing whether it is feature- or
  project-scoped, which is the objection `git.ts:31-36` raises.
- Rationale (leverage): the UI polls `events.list` at 1.5s and has no other live
  channel. Every silent mutation is a state change the user cannot see. The
  highest-value single event is `feature.merged` on `mergeFeature`'s success path
  (today only `phase.changed`, which never names the base branch).
- Effort **M**, Risk **low-medium** (the signatures are "pinned" by SPEC §7 —
  adding an *optional* trailing arg preserves them).

**G4. Unify the two drive lifecycles behind one state machine** — closes C4 + D7
- Extract `git.ts:1306-2013` → `services/drive.ts` with one `startDrive(kind)` /
  `stopDrive()` over the `DriveState` union, the branch switch as the feature
  kind's only extra step, and `EmitScope` selecting the event vocabulary.
- Rationale: the ordering invariants (pane dies before the stop hook; teardown
  runs before the switch-back; slot released before the verdict) are currently
  asserted by prose comments in two places (`:1433-1437`, `:1725-1726`). One
  state machine makes them structural. Also removes the 8-site `kind` switch.
- Effort **L**, Risk **medium-high** — this is the most load-bearing code here,
  and `dry-run-drive.test.ts` (389 lines, 17 cases) + `git.test.ts`'s drive block
  are a good but not exhaustive net (no concurrency cases — see H4).
- Do G2 and G3 first; this is only worth it once `git.ts` is already split.

**G5. `gitLines()` + `gitTry()` helpers** — closes C2, dents C3
- Two ~5-line helpers next to `errMsg` (`git.ts:160`): `gitLines(out)` (6 callers,
  and the place to normalize CRLF + decode quotepath escapes for E1) and
  `gitTry(fn, fallback, label)` (up to 51 callers) which returns the fallback *and*
  records the swallowed error somewhere observable.
- Effort **S** for `gitLines`, **M** for `gitTry` (the audit trail is the design
  question). Risk low.
- Speculative half: `gitTry`'s "where does the swallowed error go" has no second
  caller design yet — flag as needing a decision, not just a refactor.

**G6. `RepoHandle`** — closes D6. Effort **M**, Risk low, value moderate. Do it
*during* G2, not as its own pass; on its own it is churn.

---

## H. Cross-cutting candidates to pass UP

Ordered by how likely a sibling agent is to have hit the same thing.

**H1. `inconsistent:event-emission` — the house rule is unevenly applied, and the
reason is structural, not accidental.**
In this scope: 13 mutating exports emit nothing (D1 table). The *stated* reason
(`git.ts:31-36`) is that the functions were pinned without `ctx`. That argument
applies to every service that was specified before `AppCtx` threading existed —
so I expect the launcher, PTY, MCP and workflow scopes to show the same shape.
`emitScoped` + `EmitScope` (`events.ts`) is the repo's existing answer and is used
in only one file (`git.ts`). **Parent action:** if ≥2 leaves report silent
mutators, this is one repo-wide finding — "adopt `emitScoped` across services" —
not N local ones. Suggested single owner: a sweep that lists every exported
service function that writes (db, fs, or git) and has no emit.

**H2. `swallowed-errors:git` / `swallowed-errors:services` — best-effort catch as
the default posture.**
51 `catch` blocks in `git.ts` alone, nearly all returning an empty value with an
explanatory comment. Each is defensible; the aggregate is a system that cannot
tell "nothing there" from "broken". `drive-hooks.ts:181-184` and
`launcher/sessions.ts:726-736` show the *good* form (the failure becomes an event).
**Parent action:** confirm whether other scopes (launcher, workflows, doctor) use
the same swallow-and-return-empty idiom, and whether any has a shared helper. If
two or more do, the repo wants one `bestEffort(fn, { fallback, report })`.

**H3. `redundant:process-spawn-teardown` — killing a child is done three ways.**
- `drive-hooks.ts:163` `child.kill()` — kills the **shell only**. On Windows the
  spawn target is `cmd.exe /d /s /c "<command>"` (`:82-88`); killing cmd does not
  kill its children, so a timed-out `docker compose up` or `bunx prisma migrate`
  is **orphaned**, keeps its ports, and holds the pipe open — which is precisely
  why the 2s `KILL_GRACE_MS` escape hatch at `:169` had to exist. The comment at
  `:164-168` names the symptom ("a grandchild that survived the kill … can hold
  [stdio] open forever") without treating the cause.
- `pty/dev-pane.ts:177 stopDevPane` — does it properly:
  `if (entry && !entry.exited) killProcessTree(entry.pty.pid)` (`:180`). But
  `killProcessTree` is a **private** function (`pty/dev-pane.ts:159`, not
  exported), so `drive-hooks.ts` could not reuse it even if it wanted to. The repo
  therefore *has* the correct primitive and the hook runner *cannot reach it* —
  the fix is to export/relocate one helper, not to write new logic.
- `mergeInDisposableWorktree`'s `finally` (`git.ts:1068-1079`) — no process, but
  the same best-effort-cleanup shape.
So the *same repo* has tree-kill knowledge in the PTY module and not in the hook
runner, for two spawns that `drive-hooks.ts:60-75` explicitly says must behave
alike. **Parent action:** this is a genuine leaked-process bug, and I expect the
launcher/PTY leaf to hold the other half of it. Merge into one finding:
"one `killTree()` used by every spawn site".
**Canonical key:** `latent-bug:hook-process-leak` · **Kind:** violation ·
**Confidence:** high (Windows) / medium (POSIX — `child.kill()` on `/bin/sh -c`
also leaves the process group behind unless `detached` + `-pid` is used, and
neither is set) · **Effort:** M · **Risk:** medium.

**H4. `latent-bug:singleton-toctou` — check-then-act on module-global state.**
`testDriveState` (`git.ts:1344`) is a module-level singleton guarded by
check-then-act across `await` points. Three concrete windows:
```ts
git.ts:1486   if (testDriveState) { return DENY_ACTIVE }     // check
git.ts:1502   for (const holder of await worktreesOnBranch(...))   // ── await
git.ts:1507   const previousBranch = (await g.revparse(...)).trim() // ── await
git.ts:1508   await g.checkout(branch)                              // ── await, MUTATES
git.ts:1509   testDriveState = { kind: 'feature', ... }             // set
```
Two concurrent `feature.testDrive({action:'start'})` calls (two browser tabs, or a
double-click — the UI polls at 1.5s and has no client-side in-flight lock I can
see from here) both pass the `:1486` guard and both run `git checkout`; the second
overwrites `testDriveState`, so the first drive's `previousBranch` and
`detachedWorktree` are **lost** and `stop` returns the user to the wrong branch,
leaving a worktree permanently detached. Identical shape in `startDryRun`
(`:1646` check → `:1655` await → `:1673` set).
A fourth window is cross-function: `mergeFeature`'s guard (`:2040`) reads the
singleton once, then does 4 awaits before `g.checkout(target)` (`:2057`) — and
`testDrive('start')` does **not** check for an in-flight merge at all, so a drive
started mid-merge can `checkout` the feature branch out from under
`merge --no-ff`.
Every one of these is a *single-process, single-repo* race — the same shape any
sibling holding module-global state (PTY registry, run registry, session
registry) will have. **Parent action:** ask whether the repo has *any* async mutex
primitive; if not, this is one repo-wide finding ("serialize repo-mutating
operations behind one lock"), because these operations all contend for the same
resource: the user's single working copy.
**Kind:** violation · **Confidence:** high on the mechanism (read directly);
medium on real-world frequency (needs two near-simultaneous clicks) ·
**Effort:** M · **Risk:** medium.

**H5. `dead-code:over-exports` — exported-but-unimported symbols.**
7 confirmed in this scope (B), 6 in `git.ts` + 1 in `drive-hooks.ts`, all with 0
external references and all still called internally. Plus 6 test-only exports.
No lint step exists to catch this (`BRIEFING.md`), so I expect every scope to
carry a few. **Parent action:** if ≥2 leaves report the same, propose one
mechanical sweep (e.g. `knip`/`ts-prune` in CI) rather than N one-line diffs.

**H6. `inconsistent:error-types` — raw `throw new Error` outside the domain classes.**
Confirmed: exactly 2 in the whole service layer, both `git.ts` (`:249`, `:326`),
plus one re-wrap at `:2074`. Terse for this scope, but the *reverse* question
belongs to the parent: do the launcher / workflows / MCP layers use
`InvalidInputError`/`GateError`/`NotFoundError` consistently, and does anything
outside `services/` throw raw? A 2-line fix here is only worth doing as part of a
repo-wide "one error taxonomy" pass.

**H7. `stringly-typed:event-type` — `EmitInput.type` is `string`.**
`events.ts:21 type: string`, and this scope builds 6 of its types by template
interpolation (`git.ts:1911/1922/1930`). The UI must match them as literals. Every
scope that emits shares this. **Parent action:** one union type in
`@runcastle/core` would serve the whole repo; count how many distinct `type:`
literals exist across leaves before deciding.

**H8. `wrong-tool:git-porcelain-parsing` — non-ASCII paths.**
`dirtyPaths`/`conflictedFiles`/`diffPaths`/`listWorktrees` parse git's
quote-escaped text output. `test/encoding.test.ts` exists *specifically* because
this repo has been bitten by encoding before — but it covers MCP/HTTP/sqlite, not
git. If a sibling scope also shells out and parses text output (doctor, scripts),
this is one finding: "`-z` / `core.quotepath=false` at every git text boundary".

---

## Test quality & coverage notes (assessment only — tests not run)

Strong: `git.test.ts` (1372 lines) covers branch creation, remote-pick
materialization, worktree reattach/prune-retry, the full drive deny matrix, hook
success/failure ordering, `driveEnv` rendering per branch, the four
`mergeTempBranch` topologies (holder / no-holder FF / no-holder non-FF /
conflict), `cleanupTempBranches` slug-truncation mapping, and `mergeFeature`
base-branch + restore-branch behavior. `dry-run-drive.test.ts` (389 lines, 17
cases) covers the all-or-nothing verdict thoroughly, including "stamps nothing"
for each observable. `drive-hooks.test.ts` covers the quoting case that motivates
`windowsVerbatimArguments`. This is above-average test writing.

Gaps I would name, in order:

1. **No concurrency test anywhere in the scope.** Every drive test is sequential.
   The closest case, `git.test.ts:538`, `await`s the first start to completion
   before the second begins:
   ```ts
   const first = await testDrive(ctx, project, feature, 'start')
   expect(first.ok).toBe(true)
   const second = await testDrive(ctx, project, feature, 'start')
   expect(second.ok).toBe(false)
   ```
   — which is exactly the ordering H4 says is *not* the problem. Nothing
   exercises two overlapping (un-awaited) `testDrive('start')` promises, or a
   drive starting during a merge. A `Promise.all([start, start])` case would fail
   today, on my reading.
2. **`ensureProjectWorktree` (`git.ts:408`) has no test** — despite being the
   function that silently *lands commits and deletes a branch* at every project-
   session launch. Same for `landProjectBranch` (`:1129`, only `sessions.ts`
   exercises it) and `allowPushToCheckedOutBranches` (`:939`).
3. **`detectDbDrift` / `migrationPaths` / `dirtyPaths` untested.** No test name in
   `git.test.ts` mentions drift or carried changes; the `MIGRATION_DIR_RE` /
   `DRIZZLE_SQL_RE` heuristics (`:130-131`), which decide whether a user gets a
   database-drift warning, have no cases at all — and `migrationPaths` is pure,
   so this is the cheapest test in the scope to add.
4. **No non-ASCII git path anywhere** (E1/H8) — `encoding.test.ts` does not reach
   git; `git.test.ts` uses ASCII fixtures throughout.
5. **`drive-hooks.test.ts:108`** ("kills a hook that overruns its timeout and says
   so") asserts the *reported* outcome, not that the child's children died — the
   H3 leak is invisible to it by construction.
6. `test-notes.test.ts` (202 lines) is proportionate and covers the frozen-promoted
   invariant; `renderTestNotes`'s idempotence-and-totality claim (`test-notes.ts:20-22`,
   called a *contract*) is worth an explicit round-trip case if one is missing.
