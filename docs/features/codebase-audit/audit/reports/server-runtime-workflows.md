# Audit report — `packages/server/src/workflows/*` (server runtime workflows)

Leaf scope (read in full):

| File | Lines |
|---|---|
| `packages/server/src/workflows/ticket-burner.ts` | 2245 |
| `packages/server/src/workflows/research.ts` | 372 |
| `packages/server/src/workflows/runner.ts` | 249 |
| `packages/server/src/workflows/burn-guard.ts` | 189 |
| `packages/server/src/workflows/reconcile-runs.ts` | 101 |
| `packages/server/src/workflows/registry.ts` | 19 |

Read for cross-reference only (siblings own them): `services/git.ts`, `services/features.ts`,
`services/tickets.ts`, `trpc/routers/*`, `packages/core/src/config.ts`, `docs/SPEC.md §7/§8`,
`packages/skills/burner/*`.

---

## A. Flow map

### A.1 The burn flow, end to end

```
[human clicks Burn]  apps/web  →  tRPC feature.burn
  trpc/routers/feature.ts:162-166   .mutation(… features.burn(ctx, input.featureId, {modelOverride}))
        │   (BOUNDARY — sibling scope: trpc/)
        ▼
  services/features.ts:425 burn()               ← G3 gate, the ONLY legitimate G3 crossing
    :431  hasActiveRun guard
    :437  lapTickets = tickets of the current lap (SPEC §15.1)
    :443  restarting = phase==='implementation' && !running
    :444  iterating   = phase==='review' && !running && pending>=1
    :468  sweepOrphanedBurning(...)  ← fails tickets a dead run left `burning`
    :477-483  failed → pending (error cleared)      [re-burn retry path]
    :496/498  setPhase(implementation)
    :501  startRun(ctx, featureId, 'ticket-burner', { modelOverride })
    :511  on throw, `iterating` flips the phase back to review (findings F5)
        ▼
  workflows/runner.ts:84 startRun()
    :92   getWorkflow(workflowId)  ─────────────► workflows/registry.ts:17 getWorkflow
    :97-109  INSERT runs row (status 'running')
    :114-122 optional claimWaypoint (research path only)
    :124  emit 'run.started'
    :131-132 AbortController → `controllers` map (module-level, in-process)
    :142-145 talkDetached = workflowClaimsFeatureBranch(id) ? detachWorktree(talkWorktree) : false
                                     └─ runner.ts:42 BRANCH_CLAIMING = new Set(['ticket-burner'])
    :147-169 build WorkflowCtx { project, feature, tickets, emitEvent, updateTicket,
                                 input, modelOverride, resolveWaypoint, signal }
    :171  executeRun(... def.run(wctx) ...)      ← returns { runId, done } immediately (AFK)
        ▼
  workflows/ticket-burner.ts:2242 ticketBurner.run
    :2209 resolveBurnDeps(ctx)
        :2210 loadConfig()
        :2211 readTokenFromEnvFile(envPath())          [~/.runcastle/.env]
        :2212 resolveModel('implement', config, project, ctx.modelOverride)
        :2213 land = createSerialQueue()               ← ONE merge queue per run
        :2216-2218 memoized allowPushToCheckedOutBranches(repoPath)  (isolated mode only)
        ▼
    :1410 burnRun(ctx, deps)
        :1418 burnable = tickets.filter(status !== 'cancelled')
        :1424 auth precheck  (sandbox !== 'noSandbox' && !hasAuthToken → fail fast, 'auth.missing')
        :1432 detectCycle(burnable)  → 'burn.cycle' event + fail run          [tb:124 DFS/3-colour]
        :1443 burnTickets(ctx, tickets, deps.executeTicketRun, deps.concurrency)
            ▼
        :1265 burnTickets()  — worker pool, width = max(1, config.burnConcurrency)
            :1281 readyState(seq)   — blockedBy over GLOBAL seq (CORRECTIONS C1)
            :1279 satisfied = 'done' || 'cancelled'
            :1332 loop: signal.throwIfAborted()
            :1336-1354 cascade: pending with failed/missing blocker → failTicket + 'ticket.blocked'
            :1357-1365 fill pool with ready tickets → runOne()
            :1367-1376 await Promise.race(inFlight); on throw → allSettled drain → rethrow
            :1377-1392 defensive: no in-flight + still pending → 'unresolvable dependencies'
            :1300 runOne → ctx.updateTicket(status 'burning') + 'ticket.burning' → execute(...)
                  → 'ticket.done' (commits) | failTicket + 'ticket.failed'
                    ▼
              :1631 realExecuteTicketRun(ctx, ticket, config, token, model, land, ensureIsolatedPushTarget)
                :1645 resolveBurnWorkspaceMode(config)      (ADR-0005; auto → isolated on win32/darwin)
                :1650 isolated → await ensureIsolatedPushTarget()   [git.ts allowPushToCheckedOutBranches]
                :1655-1668 PROMPT ASSEMBLY: buildTicketJson / buildFeatureBrief /
                           readDocsDigestFromDisk(talk worktree) / buildWorkspaceNotes /
                           resolvePreparedSettings → buildVerifyNotes
                :1670 renderTicketPrompt(readFileSync(burnerTemplatePath()))
                           └─ :1459 burnerTemplatePath → :1468 burnerAssetPath →
                              launcher/skills-root.resolveSkillsRoot → packages/skills/burner/implement-ticket.md
                :1687-1697 readRepoToolchain → detectPackageManager → resolveSetupCommand →
                           cacheMountFor → mkdirSync(hostPath) → mounts[]
                :1704-1707 withGuard(): buildGuardInstallCommand()  ─► workflows/burn-guard.ts:178
                           (container sandboxes only, `config.burnGuard`)
                :1709-1710 mkdirSync(logsDir()); logFilePath = burn-<featureId>-<seq>.log
                :1711-1736 THREE stream consumers: createStreamThrottle (DB events),
                           createToolTimer (timing), services/agent-stream transcript (live UI)
                :1740-1742 ticketAbort → activeTicketAborts.set(ticket.id, …);
                           signal = AbortSignal.any([ctx.signal, ticketAbort.signal])
                :1756 conflictResume = conflictFiles !== undefined && !!attemptBranch
                :1764-1779 cross-run attempt resume (branchCommitsAhead → baseBranch, buildRetryNotes,
                           'ticket.resuming')
                :1966  try {
                :1969-1990   CONFLICT RESUME → landChain(branch, pending), skipping the implementer
                :1995-2152   ATTEMPT LOOP (1..config.burnAttempts):
                    :1998  tempBranch = ticketBranchName(slug, seq, newId('b').slice(2,8))
                    :2003  hookCommand = withGuard(isolated ? buildIsolatedSetupCommand(...) : setupCommand)
                    :2019-2056 RunOptions → sandcastle run():
                              agent buildBurnAgent(config, token, model)   [:1523]
                              sandbox selectSandbox(config, mounts)        [:1567 docker|podman|noSandbox]
                              cwd project.repoPath
                              branchStrategy { branch: tempBranch, baseBranch }
                              maxIterations config.burnMaxIterations
                              hooks.sandbox.onSandboxReady [{ command, timeoutMs: 15min }]
                              logging { file, onAgentStreamEvent }
                    :2059  result = await run(runOptions)   ← SANDBOX LIFECYCLE OWNED BY SANDCASTLE
                    :2061-2151 catch ladder:
                              run aborted → rethrow (runner marks cancelled)
                              branchCommitsAhead → salvaged; salvaged>0 → baseBranch = tempBranch
                              ticketAbort → 'ticket.stopped' + preserveChain
                              isWorktreeTeardownError → cleanupBurnWorktree + landChain(salvaged)
                              isMergeConflictError → 'merge.conflict.needs-human'
                              classifyTicketRunError==='retryable' && attempt<max →
                                  buildRetryNotes + 'ticket.retrying' + delayUnlessAborted(retryDelayMs)
                              else → preserveChain + failed
                :2162-2171 RESULT PARSING: readBlockedFile([result.preservedWorktreePath, project.repoPath])
                           + branchCommitsAhead(chain) → interpretRunResult
                :2182  landChain(tempBranch, outcome.commits)
                       ▼
                  :1926 landChain → :1196 landWithResolve(branch, landDeps)
                     landDeps.merge  = land(async …)      ← the RUN's serial queue (tb:2213)
                         :1908 branchCommitsAhead snapshot → :1909 mergeTempBranch (git.ts)
                     landDeps.resolve = runResolver [:1800]  ← runs OUTSIDE the queue, by design
                         :1806 resolveBranch = ticketBranchName(slug, seq, newId('r'))
                         :1807 commitSummaries(repo, branch, featureBranch) → {{OTHER_SIDE}}
                         :1808 renderTemplate(resolverTemplatePath())  ← packages/skills/burner/resolve-conflict.md
                         :1817 resolveMergeCommand(workspaceMode, featureBranch)
                         :1838-1857 second sandcastle run(), same agent/sandbox/hooks/stream
                         :1887-1894 SUCCESS VERIFIED AGAINST GIT (branchCommitsAhead must be empty),
                                    not against what the agent claims
                     :1206 bounded by deps.maxResolveAttempts = max(0, config.burnConflictAttempts)
                  :1928-1932 landed → clear attemptBranch + conflictFiles → { done, landedCommits }
                  :1935-1956 conflict → preserveChain + set conflictFiles + 'merge.conflict.needs-human'
                :2183-2198 finally { activeTicketAborts.delete; throttle.flush; endTranscript;
                                     emit 'ticket.timing' }
        ▼
  runner.ts:182 executeRun (finalizer)
    :193-205 await runPromise → status/summary; on throw: aborted ? 'cancelled' : 'failed' + 'run.error'
    :206-208 finally { controllers.delete(runId) }
    :210     UPDATE runs SET status, endedAt, summary
    :213     releaseForSession(ctx, runId)        (research waypoints; no-op for burns)
    :220-222 workflowClaimsFeatureBranch → sweepOrphanedBurning(featureId, 'orphaned — the run ended…')
    :223-228 emit 'run.finished'
    :230     succeeded → maybeAutoAdvance → G4 'all-tickets-terminal' → setPhase('review')
    :232-238 cleanup() → reattachWorktree(talkWorktree, feature.branch)  [best-effort, swallowed]
```

### A.2 Server-restart reconciliation

```
packages/server/src/index.ts:17 → reconcile-runs.ts:35 reconcileStaleRuns(ctx)
  :36-41 SELECT runs WHERE status='running'
  :45    isRunActive(run.id) → skip (bun --hot: still driven in-process)   [runner.ts:54]
  :47-51 UPDATE → failed, summary 'orphaned by server restart'
  :52    releaseForSession(ctx, run.id)
  :56-58 branch-claiming → sweepOrphanedBurning(featureId, 'orphaned by server restart — retry…')
  :63-73 branch-claiming → reattachWorktree(worktreeDir(project.id, slug), feature.branch)  [swallowed]
  :75-85 emit ONE 'run.reconciled'
  :92-98 for every project: cleanupTempBranches(project.repoPath)  [MERGED-ONLY, swallowed]
```

### A.3 The research workflow (sibling, same runner)

```
mcp / trpc waypoint.work  →  runner.startRun(featureId, 'research', { input: waypoint, claimWaypointId })
  runner.ts:42 NOT in BRANCH_CLAIMING → talk worktree stays attached, HITL runs in parallel (ADR-0001 §7)
  research.ts:369 research.run → :344 resolveResearchDeps → :89 researchRun
    :93   waypoint = ctx.input as Waypoint   ← unchecked cast, hand-rolled shape check at :94
    :100  auth precheck  (config.sandbox === 'docker' && !hasAuthToken)   ← see D.1
    :111  deps.executeResearchRun → :242 realExecuteResearchRun
        :253 tempBranch = researchBranchName(slug, seq, newId('b'))
        :255-261 renderResearchPrompt(readFileSync(researchTemplatePath()))  ← research-waypoint.md
        :267-281 RunOptions: buildBurnAgent (shared with the burner),
                 sandbox = docker(...) | noSandbox()   ← NOT selectSandbox(); see D.1
                 branchStrategy { branch: tempBranch, baseBranch: feature.branch }
        :287  run() → :296 isWorktreeTeardownError salvage path (mirrors the burner)
        :319  mergeTempBranch → conflict → 'merge.conflict.needs-human' (NO resolver agent; see D.2)
    :112-121 done → ctx.resolveWaypoint(id,'resolved',summary) + 'research.done'
    :124-129 failed → 'research.failed', waypoint left claimed → runner auto-releases
```

### A.4 The burn guard (in-sandbox, not a precondition)

`burn-guard.ts` is **not** a burn precondition — it is a Claude Code `PreToolUse` deny hook
generated on the host and installed inside each container by the same `onSandboxReady` hook that
installs deps (`ticket-burner.ts:1704-1707` → `burn-guard.ts:178 buildGuardInstallCommand`).
Container sandboxes only (`ticket-burner.ts:1705`: `config.burnGuard && config.sandbox !== 'noSandbox'`).
`evaluateGuard` (`burn-guard.ts:86`) is the host-side mirror used only by tests.
The real burn preconditions live in `services/features.ts:425-460` (sibling scope).

### A.5 Boundaries with sibling scopes

- **git** — every ref/worktree operation goes through `services/git.ts` (`branchCommitsAhead`,
  `mergeTempBranch`, `cleanupBurnWorktree`, `ticketBranchName`, `researchBranchName`,
  `commitSummaries`, `allowPushToCheckedOutBranches`, `detachWorktree`, `reattachWorktree`,
  `cleanupTempBranches`). No `simple-git` / raw git in my scope. Clean seam.
- **events** — my scope never touches the DB directly; it emits through
  `WorkflowCtx.emitEvent` (wired at `runner.ts:151-159`). `reconcile-runs.ts` and `runner.ts` do
  call `services/events.emit` and drizzle directly.
- **prompts** — `packages/skills/burner/*.md` (sibling scope) is read at runtime via
  `launcher/skills-root.resolveSkillsRoot`.
- **sandcastle** — `@ai-hero/sandcastle` `run()` owns container + worktree lifecycle; my scope
  only supplies options and reacts to its throws.

---

## B. Dead code

**B.1 — `readTokenFromEnvFile` is exported with zero importers**
`packages/server/src/workflows/ticket-burner.ts:2229`

```ts
/** Read CLAUDE_CODE_OAUTH_TOKEN from the .env file, falling back to process env. */
export function readTokenFromEnvFile(path: string): string | undefined {
```
Verification: repo-wide `grep -rn "readTokenFromEnvFile" --include=*.ts .` returns exactly four
hits — the definition and its one internal call at `ticket-burner.ts:2211`, and the *private copy*
plus its call in `research.ts:356 / :346`. No file imports it. The `export` keyword is dead
surface, and it is also the reason the duplication in C.1 is invisible: the copy in `research.ts`
could have imported it, and the export exists, but it does not.
· key `dead:token-reader-export` · **violation** · confidence high · effort S · risk low

**B.2 — unused `Feature` type import**
`packages/server/src/workflows/research.ts:4`

```ts
import type { Feature, RuncastleConfig, Waypoint, WorkflowCtx, WorkflowDef } from '@runcastle/core'
```
`Feature` appears nowhere else in the file (the only "Feature" tokens are `buildFeatureBrief` at
:23/:258, a value import). `noUnusedLocals` is set only in `packages/design-system/tsconfig.json:14`,
not for `packages/server`, so tsc does not catch it — this is not a "tooling enforces it" skip.
· key `dead:unused-import` · **violation** · confidence high · effort S · risk low

**B.3 — `registry.ts` passes the deletion test; `workflowRegistry` is production-unused**
`packages/server/src/workflows/registry.ts:12-19`

```ts
export const workflowRegistry = new Map<string, WorkflowDef>([
  [ticketBurner.id, ticketBurner],
  [research.id, research],
])
export function getWorkflow(id: string): WorkflowDef | undefined {
  return workflowRegistry.get(id)
}
```
Deletion test: `getWorkflow` has one production caller (`runner.ts:92`), but deleting the file
would force `runner.ts` to import both workflow modules and hand-roll the id→def switch, and the
`NotFoundError` at `runner.ts:93` proves the lookup is a real (fallible) interface, not a
pass-through. **Keep.** However `workflowRegistry` itself has **no `src/` importer** — verified by
`grep -rn "workflowRegistry" packages/server/src apps/web/src packages/core/src`, which returns only
registry.ts. Its seven importers are all test files (`test/burn-from-review.test.ts:9`,
`burn-robustness.test.ts:23`, `burn-retry.test.ts:8`, `lap-guards.test.ts:14`,
`orphaned-burning.test.ts:13`, `reconcile-runs.test.ts:20`, `research.test.ts:19`,
`runner.test.ts:11`, `rethink.test.ts:19`, `waypoint-work.test.ts:24`). Not dead — a documented
test seam — but worth knowing the Map is exported for tests only.
· key `shallow:workflow-registry` · **judgement call** · confidence high · effort S · risk low

No other dead code found. Every other export in `ticket-burner.ts` (61 of them) has either an
internal call site or a test importer; I checked the ones with no obvious internal use
(`TOOL_CATEGORIES`, `PM_CACHE_SANDBOX_PATHS`, `SANDBOX_WORKSPACE_PATH`, `ISOLATED_REPO_PATH`) and
all are consumed internally (`:757`, `:446`, `:533/565/567/569`, `:530/533/545/547/565`).

---

## C. Redundancy & repeated logic

`ticket-burner.ts` and `research.ts` are **parallel implementations of the same workflow shape**
(auth precheck → prompt render → sandcastle run on a temp branch → salvage teardown flake →
merge back → emit). `research.ts:19-27` already imports six symbols from `ticket-burner`, so the
seam exists and is in use — but four more units were copy-pasted across it instead.

**C.1 — `readTokenFromEnvFile` duplicated VERBATIM (3rd variant elsewhere)**
`ticket-burner.ts:2229-2240` and `research.ts:356-367` — character-identical bodies:

```ts
  let fromFile: string | undefined
  if (existsSync(path)) {
    try { fromFile = parseEnvFile(readFileSync(path, 'utf8')).CLAUDE_CODE_OAUTH_TOKEN } catch { fromFile = undefined }
  }
  const token = fromFile && fromFile.length > 0 ? fromFile : process.env.CLAUDE_CODE_OAUTH_TOKEN
  return token && token.length > 0 ? token : undefined
```
`research.ts:26` already imports `parseEnvFile` from `ticket-burner` — it shared the *parser* and
copy-pasted the *wrapper*. A third variant lives at `packages/server/src/doctor/cli.ts:22-29`
(merges into an env map rather than returning a token) and also imports `parseEnvFile`
(`doctor/cli.ts:5`). Three callers = a real seam.
**Suggested module:** `services/auth-token.ts` (or `packages/core/src/env-file.ts`) exporting
`parseEnvFile` + `readTokenFromEnvFile` + `readEnvFileInto`.
· key `redundant:oauth-token-read` · **violation** · confidence high · effort S · risk low

**C.2 — `errorHeadline` duplicated VERBATIM**
`ticket-burner.ts:1247-1254` and `research.ts:137-144`:

```ts
function errorHeadline(s: string): string {
  const lines = s.split('\n').map((l) => l.trim()).filter(Boolean)
  const causes = lines.filter((l) => /^(fatal|error):/i.test(l))
  return causes.at(-1) ?? lines[0] ?? ''
}
```
Identical bodies; even the doc comments say the same thing about git burying `fatal:` under
"Preparing worktree (...)". Neither is exported, so nothing forced the copy but the missing export.
· key `redundant:error-headline` · **violation** · confidence high · effort S · risk low

**C.3 — `readDocsDigestFromDisk` duplicated VERBATIM**
`ticket-burner.ts:1474-1484` and `research.ts:223-233`:

```ts
  const worktree = worktreeDir(projectId, slug)
  if (!existsSync(worktree)) return '_No talk worktree on disk — docs digest skipped._'
  const docsDir = join(worktree, ...featureDocsRel(slug).split('/'))
  …
  return buildDocsDigest(files)
```
Same skip strings, same sort, same filter. `research.ts:22` already imports `buildDocsDigest` from
`ticket-burner` — it took the formatter and copied the reader.
· key `redundant:docs-digest-read` · **violation** · confidence high · effort S · risk low

**C.4 — auth-missing constants duplicated VERBATIM**
`ticket-burner.ts:77-79` and `research.ts:51-53`:

```ts
const AUTH_MISSING_EVENT = 'auth.missing'
const AUTH_MISSING_MESSAGE =
  'run `claude setup-token` and put CLAUDE_CODE_OAUTH_TOKEN in ~/.runcastle/.env'
```
A user-facing string with two copies: changing the remediation instruction means editing two files
(shotgun surgery on a one-line message).
· key `redundant:auth-missing-message` · **violation** · confidence high · effort S · risk low

**C.5 — `renderResearchPrompt` reimplements `renderTemplate`**
`research.ts:166-179` vs `ticket-burner.ts:185-191`:

```ts
// research.ts:170
export function renderResearchPrompt(template: string, values: Record<PlaceholderKey, string>): string {
  let out = template
  for (const key of PLACEHOLDERS) { out = out.split(`{{${key}}}`).join(values[key]) }
  return out
}
// ticket-burner.ts:185 — the generic version, already exported
export function renderTemplate(template: string, values: Record<string, string>): string {
  let out = template
  for (const [key, value] of Object.entries(values)) { out = out.split(`{{${key}}}`).join(value) }
  return out
}
```
`ticket-burner.ts:194 renderTicketPrompt` is the *correct* pattern — a thin typed alias over
`renderTemplate`. `research.ts` re-derived the loop instead. The two differ subtly: the burner's
version leaves unknown `{{KEYS}}` alone by construction, the research one iterates a fixed key list
— same net effect, different code.
· key `redundant:template-render` · **judgement call** · confidence high · effort S · risk low

**C.6 — skills-asset path resolution written twice**
`ticket-burner.ts:1468-1471` (`burnerAssetPath`, parameterised over the filename, used by
`burnerTemplatePath` and `resolverTemplatePath`) vs `research.ts:217-220`:

```ts
export function researchTemplatePath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(resolveSkillsRoot(here), 'burner', 'research-waypoint.md')
}
```
Same three lines, and `import.meta.url` resolves to the same directory in both files.
**Suggested module:** `burnerAssetPath(file)` exported once (it is already the right shape).
· key `redundant:skills-asset-path` · **judgement call** · confidence high · effort S · risk low

**C.7 — teardown-flake salvage sequence written twice**
`ticket-burner.ts:2087-2101` and `research.ts:296-306`. Both do: `isWorktreeTeardownError(err)` →
`branchCommitsAhead(repo, featureBranch, tempBranch)` → `cleanupBurnWorktree(repo, tempBranch)` →
emit `burn.worktree.teardown-failed` with the same message template
(`"agent finished but sandcastle could not remove its worktree (…)… — cleaned up / — left on disk; landing the N commit(s) anyway"`).
`isWorktreeTeardownError` is shared (`research.ts:25`), the *procedure around it* is not. Note the
research copy emits the event typed `burn.worktree.teardown-failed` (`research.ts:302`) — a
`burn.*` event on a research timeline, which is exactly what `createResearchStreamThrottle`
(`research.ts:152-160`) was written to prevent.
· key `redundant:teardown-salvage` · **judgement call** · confidence high · effort M · risk low

**C.8 — `mkdirSync(logsDir()) + join(logsDir(), '<kind>-<featureId>-<seq>.log')`**
`ticket-burner.ts:1709-1710` and `research.ts:263-264`. Trivial, but it is the fourth copy of "set
up this run's log file", and both hard-code the filename convention independently.
· key `redundant:run-log-path` · **judgement call** · confidence high · effort S · risk low

---

## D. Inconsistencies & structural smells vs sibling features

### D.1 — LATENT BUG: `research` silently downgrades a `podman` sandbox to **no sandbox at all**

`research.ts:270-273`:
```ts
    sandbox:
      config.sandbox === 'docker'
        ? docker({ imageName: resolveSandboxImage(config) })
        : noSandbox(),
```
`config.sandbox` is `z.enum(['docker', 'podman', 'noSandbox'])`
(`packages/core/src/config.ts:106`). The burner routes this through
`selectSandbox` (`ticket-burner.ts:1567-1577`), which has a `case 'podman': return podman(imageOpts)`.
Research does not. A user configured for **podman** therefore gets an AFK research agent executing
`claude --print` **directly on the host**, with `bypassPermissions`
(`ticket-burner.ts:1531`, applied because `buildBurnAgent` computes `onHost = config.sandbox === 'noSandbox'`
— which is *false* here, so the agent doesn't even get the host-mode permission fix and may make
zero commits, but it still runs unsandboxed).

The same bug is doubled in the auth precheck — `research.ts:100`:
```ts
  if (deps.config.sandbox === 'docker' && !deps.hasAuthToken) {
```
vs `ticket-burner.ts:1424`:
```ts
  if (deps.config.sandbox !== 'noSandbox' && !deps.hasAuthToken) {
```
So a podman user with no token also skips the fail-fast and discovers it inside the run.
Fix is one line each: call `selectSandbox(config)` and invert the precheck to `!== 'noSandbox'`.
· key `inconsistent:sandbox-selection` · **violation** (latent bug + sandbox-escape) · confidence high · effort S · risk low

### D.2 — Concrete burner/research divergences (parallel implementations)

Both workflows run "one AFK agent on a temp branch, merge back". Everything below is present in
`ticket-burner.ts` and **absent** from `research.ts`, with no documented reason:

| Capability | ticket-burner | research |
|---|---|---|
| Sandbox provider selection | `selectSandbox` incl. podman, `mounts`, `cpus` (`:1567`, `:1585`) | docker-or-nothing (`research.ts:270`); no cache mounts, no `burnCpus` |
| Auth precheck scope | `!== 'noSandbox'` (`:1424`) | `=== 'docker'` (`research.ts:100`) |
| Attempt chaining / transient retry | `classifyTicketRunError` + `buildRetryNotes` + `retryDelayMs` + `config.burnAttempts` (`:2121-2147`) | none — one `run()`, any transient throw fails the run (`research.ts:287-306`) |
| Landing-conflict resolver agent | `landWithResolve` + `resolve-conflict.md`, bounded by `burnConflictAttempts` (`:1196`, `:1800`) | none — conflict emits "merge it manually" and fails (`research.ts:319-333`) |
| Deps install before agent start | `resolveSetupCommand` → `onSandboxReady` (`:1689`, `:2046-2054`) | no `hooks` at all — the research agent bootstraps itself |
| Burn guard (`PreToolUse` deny) | installed (`:1704-1707`) | never installed — the research agent can `git stash`, heredoc-edit, serialise tests |
| `maxIterations` | `config.burnMaxIterations` (`:2045`) | not passed — sandcastle's default applies |
| Live transcript for the UI | `beginTranscript`/`appendTranscript`/`endTranscript` (`:1717`, `:1728`, `:2186`) | none — no live agent view for research runs |
| Tool-timing telemetry | `createToolTimer` → `ticket.timing` (`:1723`, `:2191`) | none |
| Per-unit stop | `stopTicketRun` + `activeTicketAborts` (`:1098`, `:1106`) | none — only whole-run cancel |
| Isolated workspace (ADR-0005) | `resolveBurnWorkspaceMode` + `buildIsolatedSetupCommand` (`:1645`, `:525`) | always the mounted worktree — pays Docker Desktop's per-file tax on win32/darwin |

Some of these are defensible (a research agent writes one markdown file, so isolation/deps buy
less), but the **sandbox selection, auth precheck, burn guard and transient retry** are not
research-specific and their absence is unexplained. Each is a place where "we improved the burner"
did not reach the sibling — classic *divergent change*.
· key `inconsistent:workflow-capabilities` · **judgement call** · confidence high · effort M · risk medium

### D.3 — LATENT BUG: `activeTicketAborts` / transcript / timing leak on a pre-`try` throw

`ticket-burner.ts:1740-1742` registers the per-ticket abort controller, `:1717` opens the
transcript, `:1723` starts the timer — but the `try` that owns the cleanup `finally` does not start
until `:1966`:

```ts
1740  const ticketAbort = new AbortController()
1741  activeTicketAborts.set(ticket.id, ticketAbort)
…
1765    const preserved = await branchCommitsAhead(project.repoPath, feature.branch, ticket.attemptBranch)
…
1966  try {
…
2183  } finally {
2184    activeTicketAborts.delete(ticket.id)
2185    throttle.flush()
2186    endTranscript(ticket.id)
```
Anything that throws between :1717 and :1966 — `readFileSync(burnerTemplatePath())` at :1670 on a
broken skills root, `mkdirSync(mount.hostPath)` at :1694 on a permissions error,
`await ensureIsolatedPushTarget()` at :1650, or `await branchCommitsAhead(...)` at :1765 on a git
failure — skips the `finally` entirely. Consequences: the `AbortController` stays in the
module-level `activeTicketAborts` map **forever** (so a later `stopTicketRun(ticketId)` from the UI
returns `true` while aborting a dead controller — the UI reports a stop that did nothing), the
transcript is never ended, and the timing event is never emitted. Fix: move the `try` up to just
after :1717, or register the controller inside the `try`.
· key `latent:ticket-cleanup-scope` · **violation** · confidence high · effort S · risk low

### D.4 — LATENT BUG: `stopTicketRun` is a no-op during the pre-registration window

Same region, opposite direction. `realExecuteTicketRun` awaits `ensureIsolatedPushTarget()`
(`:1650`) and `branchCommitsAhead` (`:1765`) — both real IO — while the ticket is already `burning`
in the DB (set at `:1303-1309`, before `execute` is called). `activeTicketAborts.set` does not
happen until `:1741`. A user clicking "Stop ticket" in that window gets
`stopTicketRun` → `:1107 if (!controller) return false` and (per `trpc/routers/ticket.ts:5`) a
"nothing to stop" answer for a ticket the UI is showing as burning.
· key `latent:stop-ticket-window` · **judgement call** · confidence medium · effort S · risk low

### D.5 — LATENT BUG: `BLOCKED.md` is read from the **shared project repo root** under concurrency

`ticket-burner.ts:1487-1500`:
```ts
function readBlockedFile(dirs: (string | undefined)[]): string | undefined {
  for (const dir of dirs) {
    …const p = join(dir, 'BLOCKED.md'); if (existsSync(p)) { … return readFileSync(p, 'utf8') }
```
Called with `[result.preservedWorktreePath, project.repoPath]` at `:2162` and `:1879`.
`project.repoPath` is **shared by every concurrently burning ticket** (`config.burnConcurrency`
defaults to **3**, `packages/core/src/config.ts:152`). Nothing in my scope ever deletes a
`BLOCKED.md`. So: one agent that writes `BLOCKED.md` into the repo root (which
`buildWorkspaceNotes` at `:569` explicitly instructs isolated-mode agents to do, to a
container path that maps to a *different* dir — but a mounted-mode agent writes the real one) makes
**every subsequent zero-commit ticket in that run, and every later run**, report
`agent reported BLOCKED: <someone else's text>`. The `chain.length > 0` check at `:2167` masks it
whenever the agent committed, which is why this is latent rather than constant.
· key `latent:blocked-file-crosstalk` · **judgement call** · confidence medium · effort M · risk medium

### D.6 — LATENT BUG: `isMergeConflictError` matches the bare word "conflict"

`ticket-burner.ts:991-996`:
```ts
export function isMergeConflictError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return (/conflict/i.test(msg) || /git branch -D/i.test(msg) || /automatic merge failed/i.test(msg))
}
```
It is checked at `:2102`, **before** `classifyTicketRunError` at `:2121`. Any sandcastle throw whose
message happens to contain "conflict" — an npm/pnpm `ERESOLVE ... peer dependency conflict` from
the `onSandboxReady` install hook is the obvious one, and that hook's output is exactly what ends up
in the throw — is misrouted to `merge.conflict.needs-human`, skipping the transient-retry path and
telling the human to resolve a merge conflict that does not exist. The doc comment concedes
"Heuristic"; the ordering is what makes it costly.
· key `latent:conflict-detection-heuristic` · **judgement call** · confidence medium · effort S · risk medium

### D.7 — LATENT BUG: nothing ever sweeps abandoned `.sandcastle/worktrees/` in the target repo

Confirms E2E finding **F19** from the code side. The worktree path is
`services/git.ts:651`:
```ts
  return join(repoPath, '.sandcastle', 'worktrees', branch.replace(/\//g, '-'))
```
i.e. **inside the user's own project repo** (`cwd: project.repoPath` at `ticket-burner.ts:2022`,
`:1842` and `research.ts:274`). Two code-side confirmations:

1. **Never gitignored in the target repo.** `grep -rn "gitignore" --include=*.ts packages/server/src`
   returns **zero hits** — no code path adds `.sandcastle/` to the target project's `.gitignore`.
   (This repo's own `.gitignore` *does* list `.sandcastle/worktrees/` — which is why the problem is
   invisible when dogfooding runcastle on runcastle, and visible on every other project.)
   `services/setup.ts:253` scaffolds `.sandcastle/` into the target dir and likewise writes no ignore rule.
2. **Never swept after a crash.** `cleanupBurnWorktree` (`git.ts:669`) is called only on the
   teardown-flake paths (`ticket-burner.ts:2088`, `:1876`, `research.ts:300`). Boot reconciliation
   (`reconcile-runs.ts:92-98`) sweeps **branches** only, and only *merged* ones:
   ```ts
   for (const project of allProjects(ctx)) { try { await cleanupTempBranches(project.repoPath) } catch { /* best-effort */ } }
   ```
   `cleanupTempBranches` (`git.ts:1159-1204`) *detaches* worktrees pinning a deletable branch; it
   never removes the directories, and it skips unmerged branches entirely. So a server crash or a
   hard cancel mid-burn leaves `<project>/.sandcastle/worktrees/runcastle-ticket-*/` (each with a
   full `node_modules` in mounted mode) on disk and in the user's `git status`, permanently.
· key `latent:orphaned-burn-worktrees` · **violation** · confidence high · effort M · risk medium

### D.8 — Doc drift vs `docs/SPEC.md §8`

`docs/SPEC.md:179`:
> `sandcastle.run()` with: claudeCode(config.model), sandbox from config (`docker()` | `noSandbox()`),
> repo = project.repoPath, **work on branch `feature/<slug>`** (per sandcastle's branch strategy;
> commits must land on the feature branch)

and `docs/SPEC.md:178`:
> Process queue with `concurrency = 1` (M1) but code shaped as a worker pool so M2 raises the constant.

Three drifts against the code:
1. Tickets have **not** worked on `feature/<slug>` since M2 — each runs on its own
   `runcastle/ticket/<slug>/<seq>-<uniq>` temp branch (`ticket-burner.ts:67-74`, `:1998`), landed
   through the serial queue. SPEC:180 (ADR-0007) describes the landing correctly, so SPEC:179
   contradicts SPEC:180 within the same section.
2. `podman` is a first-class sandbox (`selectSandbox` `:1567`, `config.ts:106`) and is unmentioned.
3. `concurrency = 1` is stale — `config.burnConcurrency` defaults to **3** (`config.ts:152`).
   (Flagged as drift, not a bug: the "(M1)" marker dates it.)
· key `drift:spec-section-8` · **violation** (doc) · confidence high · effort S · risk low

### D.9 — `BRANCH_CLAIMING` is a stringly-typed set duplicating a `WorkflowDef` property

`runner.ts:42-47`:
```ts
const BRANCH_CLAIMING = new Set(['ticket-burner'])
export function workflowClaimsFeatureBranch(workflowId: string): boolean {
  return BRANCH_CLAIMING.has(workflowId)
}
```
Its own comment admits it: *"This flag arguably belongs on `WorkflowDef` itself (core-owned
`workflow.ts`); kept as a server-side map until core can change."* It is a repeated switch on
workflow-id-as-string with four consumers (`runner.ts:143`, `:220`, `reconcile-runs.ts:56`, `:63`,
plus `launcher/launcher.ts:32`), and the id string `'ticket-burner'` is separately hard-coded in
`services/features.ts:501`. Adding a third workflow means remembering to edit this set — the
knowledge lives away from the thing it describes. Documented deliberate deferral, so a judgement
call, but it is the clearest *primitive obsession* in the scope.
· key `primitive-obsession:workflow-id` · **judgement call** · confidence high · effort S · risk low

### D.10 — `research.ts` reads its own input with a hand-rolled cast, not zod

`research.ts:93-97`:
```ts
  const waypoint = ctx.input as Waypoint | undefined
  if (!waypoint || typeof waypoint.id !== 'string') {
```
`ctx.input` is `unknown` by contract (`StartRunOptions.input`, `runner.ts:70`), and `Waypoint` has a
zod schema in core (it is a core-owned contract type). This is manual validation of one field
standing in for a schema parse, on the boundary where the burner has no equivalent (it reads
`ctx.tickets`, already typed). The rest of the object — `seq`, `title`, `type`, `question` — is
consumed unchecked at `:107`, `:182-187`.
· key `wrong-tool:manual-validation` · **judgement call** · confidence high · effort S · risk low

### D.11 — Windows path handling is clean (checked, no finding)

Every host path in the scope goes through `node:path` (`join`/`dirname`) or a core `paths.ts`
helper: `ticket-burner.ts:1470`, `:1490`, `:1647`, `:1661-1664`, `:1710`; `research.ts:219`, `:227`,
`:231`, `:264`. Host paths are never hand-concatenated and never interpolated into a shell command —
the only interpolated paths (`ISOLATED_REPO_PATH`, `SANDBOX_WORKSPACE_PATH`, `GUARD_SCRIPT_PATH`)
are container-side POSIX literals, and the guard script quotes them
(`burn-guard.ts:184-187`). Recorded so the parent does not chase it.

### D.12 — LATENT BUG (small window): the talk worktree is reattached *after* the run is finalized

`runner.ts:210-238`:
```ts
  ctx.db.update(runs).set({ status, endedAt: Date.now(), summary }).where(eq(runs.id, runId)).run()
  …
  emit(ctx, featureId, { type: 'run.finished', … })
  if (status === 'succeeded') maybeAutoAdvance(ctx, featureId)
  if (cleanup) { try { await cleanup() } catch { /* best-effort … */ } }
```
`cleanup` is the `reattachWorktree(talkWorktree, feature.branch)` closure built at `:171-173`. The
run row flips to a terminal status (so `hasActiveRun` → false) and `run.finished` is emitted
*before* the reattach. The UI polls at 1.5s and the launcher's "refuse HITL while a branch-claiming
run is live" guard keys on the run row — so a human who clicks "open terminal" the instant the run
finishes can land in a worktree still on a detached HEAD. Moving `cleanup()` above the status
update (or before the emit) closes it, at no user-visible cost.
· key `latent:reattach-after-finalize` · **judgement call** · confidence medium · effort S · risk low

---

## E. Wrong-tool & weak-typing findings

The scope is unusually clean here — `grep -n "as any|: any|@ts-ignore|@ts-expect-error"` across all
six files returns **zero** hits, and there are no `!` non-null assertions. What is left:

**E.1 — unchecked cast standing in for a control-flow invariant**
`ticket-burner.ts:1970`
```ts
      const branch = ticket.attemptBranch as string
```
Sound only because `conflictResume` (`:1756`) collapsed `!!ticket.attemptBranch` into a *boolean*,
which TS cannot use to narrow the property later. Fixable without a cast by hoisting
`const attemptBranch = ticket.attemptBranch` and branching on it.
· key `weak-typing:attempt-branch-cast` · **judgement call** · confidence high · effort S · risk low

**E.2 — `as Waypoint` on the `ctx.input` boundary, with a one-field manual check**
`research.ts:93-97` — see **D.10**. `ctx.input` is `unknown` by contract (`runner.ts:70`); a zod
`parse` belongs here, not `typeof waypoint.id !== 'string'`.
· key `wrong-tool:manual-validation` · **judgement call** · confidence high · effort S · risk low

**E.3 — exported function with no declared return type**
`ticket-burner.ts:1567`
```ts
export function selectSandbox(config: RuncastleConfig, mounts: readonly CacheMount[] = []) {
```
Its return type is the inferred union of sandcastle's `docker()`/`podman()`/`noSandbox()` returns —
an inferred third-party type on an exported API surface, so a sandcastle minor version can silently
change this module's public contract. Every neighbouring export (`buildSandboxOptions:1585`,
`buildBurnAgent:1523`) *is* annotated, so this is an outlier, not house style.
· key `weak-typing:missing-return-type` · **violation** · confidence high · effort S · risk low

**E.4 — `pinned as PackageManager` after a non-narrowing `.includes`**
`ticket-burner.ts:333-334`
```ts
  if (pinned && (PACKAGE_MANAGERS as readonly string[]).includes(pinned)) {
    return pinned as PackageManager
```
Two casts to work around `readonly string[]`'s non-narrowing `includes`. A one-line type predicate
removes both. Cosmetic; noted for completeness.
· key `weak-typing:package-manager-cast` · **judgement call** · confidence high · effort S · risk low

**E.5 — `JSON.parse` without a schema (acceptable — recorded to prevent a false positive)**
`ticket-burner.ts:651`
```ts
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { packageManager?: unknown }
```
This is the *correct* shape of the pattern: cast to `unknown`-valued fields, `typeof` guard at
`:652`, `catch` degrading to lockfile detection at `:653`. **Not a finding.** It is the only
`JSON.parse` in the scope.

**E.6 — swallowed errors: all seven are deliberate and documented (no finding)**
`reconcile-runs.ts:69` (`// best-effort — a detached worktree is still readable; never fail boot`),
`reconcile-runs.ts:95`, `runner.ts:235`, `research.ts:361`, `ticket-burner.ts:653`, `:1494`, `:2234`.
Each carries an explanatory comment and degrades to a defined fallback. The *idiom* itself is a
cross-cutting candidate — see **H.6**.

---

## F. Shallow modules / deletion-test candidates

**F.1 — `renderTicketPrompt` is a pure alias — but the asymmetry it reveals is the real finding**
`ticket-burner.ts:194-199`
```ts
export function renderTicketPrompt(template: string, values: Record<PlaceholderKey, string>): string {
  return renderTemplate(template, values)
}
```
Deletion test: remove it and the one caller (`:1670`) calls `renderTemplate` directly; nothing
reappears at the call site. It buys exactly one thing — the compiler checking that all six
`PlaceholderKey`s are supplied, which is real (a missing `{{VERIFY_NOTES}}` would otherwise ship a
literal placeholder into an agent prompt). So it **passes**, narrowly. But the resolver prompt at
`:1808` calls the *untyped* `renderTemplate` with nine keys, so `resolve-conflict.md` has **no**
such check: renaming a placeholder there ships `{{OTHER_SIDE}}` verbatim to the resolver agent with
no compile error and no runtime error. (Verified the nine keys currently match:
`packages/skills/burner/resolve-conflict.md` uses `WORKSPACE_NOTES`, `FEATURE_BRANCH` ×2,
`CONFLICT_FILES`, `OTHER_SIDE`, `TICKET_JSON`, `FEATURE_BRIEF`, `DOCS_DIGEST`, `MERGE_COMMAND`,
`VERIFY_NOTES` — all supplied at `:1809-1817`.)
· key `latent:unchecked-resolver-placeholders` · **judgement call** · confidence high · effort S · risk low

**F.2 — `workflowClaimsFeatureBranch` / `isRunActive`**
`runner.ts:45-47` and `:54-56` are one-line reads of module-level state
(`BRANCH_CLAIMING.has(id)`, `controllers.has(runId)`). Both **pass** the deletion test: the state is
module-private, so these are the only legal access path and deleting them would force the state to
be exported. Keep. (`BRANCH_CLAIMING`'s *content* is the problem — D.9.)

**F.3 — `getWorkflow`** — see **B.3**. Passes.

**F.4 — `indexBySeq`** (`ticket-burner.ts:110-112`) — two internal callers (`detectCycle:125`,
`burnTickets:1272`) plus a test; it names the `seq`-space invariant (CORRECTIONS C1) that
`blockedBy` references. Passes, marginally.

No true pass-throughs found. The scope's problem is the opposite of shallowness: one 2245-line file
and one 568-line function (see G).

---

## G. Deepening / consolidation / extraction opportunities (ranked)

`ticket-burner.ts` is **2245 lines** holding ~10 unrelated concerns behind no internal boundaries.
It is not one deep module — it is a package that never got split. Its own file comment (`:50-75`)
enumerates the units ("the pure units … are exported and unit-tested"), and it exports **61
symbols**, which is what an over-broad interface looks like.

Structural map, for the parent:

| Lines | Concern |
|---|---|
| 86-162 | outcome/deps types, seq index, cycle detection |
| 164-275 | prompt assembly (ticket/feature/docs/conflict blocks) |
| 277-307 | `.env` parsing |
| 309-448 | package-manager detection, setup command, cache mounts |
| 450-571 | workspace mode (ADR-0005) + isolated setup command + workspace notes |
| 573-667 | verify notes + repo-toolchain IO |
| 669-733 | stream throttle |
| 735-926 | tool-timing telemetry (categories, classifier, timer, formatter) |
| 928-1051 | result interpretation + error classification + backoff |
| 1053-1111 | retry notes, abortable delay, per-ticket stop registry |
| 1113-1233 | serial queue + landing loop |
| 1235-1398 | scheduler / worker pool |
| 1400-1448 | `burnRun` workflow entry |
| 1450-1594 | sandcastle boundary: template paths, agent builder, sandbox selection |
| 1596-2199 | **`realExecuteTicketRun` — one 568-line function** |
| 2201-2245 | deps resolution + token read + `WorkflowDef` |

**G.1 — `workflows/sandbox.ts`: agent + sandbox provider + workspace mode**  ★ highest value
Move `SANDBOX_WORKSPACE_PATH`/`ISOLATED_REPO_PATH`/`BurnWorkspaceMode`/`resolveBurnWorkspaceMode`/
`buildIsolatedSetupCommand` (`:454-550`), `buildBurnAgent` (`:1523-1547`), `selectSandbox` +
`buildSandboxOptions` (`:1567-1594`), `CacheMount` (`:434`). ~190 lines.
**Second caller exists** — `research.ts:24` already imports `buildBurnAgent`, and `research.ts:270`
hand-rolls a *broken subset* of `selectSandbox` (**D.1**). Extraction is what makes the podman bug
impossible to reintroduce: one module owns "how a runcastle AFK agent gets a sandbox", both
workflows call it. **Locality**: the provider choice, image tag, cpu bound, cache mounts and the
`bypassPermissions` / win32-quoting workarounds are one subject; today they sit 1000 lines apart in
one file and half-copied in another. **Leverage**: a workflow says `selectSandbox(config, mounts)`
and stops knowing providers exist.
· effort S–M · blast radius: 2 workflow files + `test/ticket-burner-units.test.ts` · **real seam**

**G.2 — `workflows/run-errors.ts`: error classification, headline, backoff**
Move `isWorktreeTeardownError` (`:984`), `isMergeConflictError` (`:991`),
`FATAL_ERROR_PATTERNS`/`RETRYABLE_ERROR_PATTERNS`/`classifyTicketRunError` (`:1002-1046`),
`retryDelayMs` (`:1049`), `delayUnlessAborted` (`:1076`), `errorHeadline` (`:1247`). ~130 lines.
**Second caller exists** — `research.ts:25` imports `isWorktreeTeardownError` and **copies**
`errorHeadline` (C.2). Also gives the D.6 heuristic one place to be tightened and tested.
**Leverage**: "is this throw the agent's fault, the infrastructure's, or git's?" becomes one named
question instead of three regex banks read inline inside a 568-line function.
· effort S · blast radius: 2 workflow files + tests · **real seam** · kills C.2

**G.3 — `services/auth-token.ts` (or `core/env-file.ts`): `.env` parsing + token read**
Move `parseEnvFile` (`:286-307`) and `readTokenFromEnvFile` (`:2229-2240`). ~40 lines.
**Three callers already** — `doctor/cli.ts:5,22-29`, `research.ts:26,346,356`,
`ticket-burner.ts:2211`. Also fixes the layering smell: a generic utility lives inside a 2245-line
workflow file, so `doctor/cli.ts` — a CLI with no burn involvement — imports from
`workflows/ticket-burner`.
· effort S · blast radius: 3 files + tests · **real seam** · kills C.1

**G.4 — `workflows/burn-prompt.ts`: all prompt assembly**
Move `PLACEHOLDERS`/`renderTemplate`/`renderTicketPrompt`/`buildTicketJson`/`buildFeatureBrief`/
`buildDocsDigest` (`:168-235`), `buildConflictFilesBlock`/`buildOtherSideBlock`/
`resolveMergeCommand` (`:237-275`), `buildWorkspaceNotes` (`:560`), `buildVerifyNotes` (`:602`),
`buildRetryNotes` (`:1058`), `readDocsDigestFromDisk` (`:1474`), `burnerAssetPath`/
`burnerTemplatePath`/`resolverTemplatePath` (`:1459-1471`). ~300 lines.
**Second caller exists** — `research.ts:21-23` imports `buildDocsDigest` + `buildFeatureBrief` and
**copies** `readDocsDigestFromDisk` (C.3), the render loop (C.5) and the asset-path resolution (C.6).
**Locality**: every "what does the agent get told?" question answered in one file, beside the
templates' placeholder contract. Would also let `renderTicketPrompt`'s typed-key check cover the
resolver template (F.1).
· effort M · blast radius: 2 workflow files + `test/ticket-burner-units.test.ts` +
`test/skills-root.test.ts` · **real seam** · kills C.3/C.5/C.6

**G.5 — `workflows/agent-telemetry.ts`: stream throttle + tool timing**
Move `ThrottledEvent`/`StreamThrottle`/`createStreamThrottle` (`:673-733`) and the whole timing
block `TOOL_CATEGORIES`…`formatTimingSummary` (`:735-926`). ~250 lines — **11% of the file**, and it
mentions tickets, burns or branches exactly zero times.
**Half-real seam**: `research.ts:152-160 createResearchStreamThrottle` is a second caller of the
throttle; the *timer* has one caller today, but D.2 shows research is the missing second consumer
(a research run currently produces no timing at all). Extracting makes adding it a one-line change.
· effort S–M · blast radius: 2 workflow files + tests · **real seam (throttle) / adjacent (timer)**

**G.6 — `workflows/repo-toolchain.ts`: package-manager detection + setup command + cache mounts**
Move `PACKAGE_MANAGERS`…`cacheMountFor` (`:313-448`) and `readRepoToolchain` (`:645-667`). ~150 lines.
**Single caller — speculative.** Verified:
`grep -rn "detectPackageManager|readRepoToolchain|resolveSetupCommand"` outside `workflows/` returns
nothing, so `services/prep.ts` does *not* reuse it today. It is nonetheless the most self-contained
block in the file (pure + one IO reader, zero burn vocabulary), and "what package manager does this
repo use and how do I install it" is exactly what a preparation run needs — propose it as a *move
for locality*, not as a shared module, until a second caller appears.
· effort S · blast radius: 1 file + tests · **speculative**

**G.7 — split `realExecuteTicketRun` (`:1631-2199`, 568 lines)**
The largest complexity concentration in the scope. Its seams are already visible as inline closures
and comment banners:
- `:1640-1710` — **per-ticket setup**: workspace mode, prompt assembly, toolchain, guard, log path
- `:1711-1742` — **stream + abort wiring** (three stream consumers, `AbortSignal.any`)
- `:1756-1784` — **resume-state resolution** (`conflictResume` vs attempt-chain resume)
- `:1800-1896` — `runResolver` (96 lines) → belongs beside `landWithResolve`
- `:1905-1964` — `landDeps` + `landChain` (60 lines)
- `:1995-2152` — **the attempt loop** (158 lines, a seven-branch catch ladder)
- `:2158-2182` — result interpretation + land
- `:2183-2198` — the `finally`
Building a `TicketRunContext` once (`:1640-1742`) and passing it to `runAttemptChain(...)` /
`landChain(...)` would also **fix D.3 structurally** — the setup that must be undone and the
`finally` that undoes it would finally share a scope.
· effort M–L · blast radius: 1 file, no external API change · **judgement call** · confidence high

**G.8 / G.9 — `workflows/ticket-scheduler.ts`** (`indexBySeq`/`detectCycle`/`burnTickets`, ~180 lines)
and **`workflows/landing.ts`** (`createSerialQueue`/`landWithResolve`/`LandDeps`, ~110 lines).
Both are already fully dependency-injected and independently tested; both have exactly one caller.
**Speculative** as shared modules — propose only as part of G.7's file split, where they cost nothing.
· effort S each · **speculative**

**G.10 — `workflows/ticket-abort-registry.ts`** (`activeTicketAborts` + `stopTicketRun`, `:1098-1111`)
Process-global mutable state with an *external* consumer (`trpc/routers/ticket.ts:5`) buried at the
midpoint of a 2245-line file. Single caller, so speculative on reuse grounds — but D.3 and D.4 are
both consequences of its placement (registration and teardown are 440 lines apart, in different
`try` scopes). A 20-line module exposing `register(id): Disposable` / `stop(id)` makes the leak
un-writable.
· effort S · blast radius: 2 files · **speculative on reuse, bug-motivated**

---

## H. Cross-cutting candidates to pass UP

Ordered by how likely the parent is to find the same thing in a sibling scope.

**H.1 — `redundant:error-message-extraction`** — the strongest cross-cutting signal in my scope.
Two *different* private helpers for "turn an `unknown` throw into a string for a user-facing
message", each copy-pasted per file:
- `errorHeadline` — `workflows/ticket-burner.ts:1247` and `workflows/research.ts:137` (verbatim, C.2)
- `errMsg(e: unknown): string` — a **private duplicate in four sibling files**, verified by
  `grep -rn "function errMsg" packages/server/src`: `launcher/launcher.ts:873`,
  `services/features.ts:607`, `services/fsbrowse.ts:241`, `services/git.ts:160`

Six copies of two variants of one idea. Suggested home: `packages/server/src/errors.ts` (already
exists) gaining `errMsg(e)` + `errorHeadline(s)`.
· **violation** · confidence high · effort S · risk low

**H.2 — `redundant:oauth-token-read`** — `.env` parsing + `CLAUDE_CODE_OAUTH_TOKEN` resolution.
Three known callers (`workflows/ticket-burner.ts:2229`, `workflows/research.ts:356`,
`doctor/cli.ts:22-29`), with `parseEnvFile` already shared *out of a workflow file*. Ask sibling
scopes whether the PTY launcher (`launcher/artifacts.ts`, `launcher/launcher.ts`) and
`services/setup.ts` also read `~/.runcastle/.env` — if so this is a 4–5 caller seam.
Suggested module: `services/auth-token.ts` / `core/env-file.ts`. See G.3.
· **violation** · confidence high · effort S · risk low

**H.3 — `redundant:feature-docs-digest`** — reading `docs/features/<slug>/*.md` off the talk
worktree and formatting it for an agent. Verbatim twice in my scope (C.3), and `featureDocsRel` has
**seven** consumers repo-wide (`launcher/artifacts.ts`, `launcher/edit-guard.ts`, `mcp/server.ts`,
`services/feature-docs.ts`, `services/test-notes.ts`, plus my two). `services/feature-docs.ts`
exports only `featureDocsDir` (:16) and `featureDocPath` (:24) — **no reader** — so every consumer
rolls its own `readdirSync` + filter + sort + read. Strongly suspect the launcher's system-prompt
assembly does the same. Suggested module: `services/feature-docs.readFeatureDocs(project, feature)`.
· **violation** · confidence high · effort S–M · risk low

**H.4 — `redundant:prompt-template-render`** — `{{PLACEHOLDER}}` substitution into a markdown
prompt template. Two implementations inside my scope (`renderTemplate:185` vs
`renderResearchPrompt:170`, C.5). The launcher writes an injected `system-prompt.md`
(`launcher/artifacts.ts`, SPEC §5) and `services/features.ts:210` documents a `{{FEATURE_BRIEF}}`
placeholder — so a third implementation very likely exists in the launcher scope. Ask that leaf.
Suggested shape: one `renderTemplate(template, values)` plus per-template typed key sets.
· **judgement call** · confidence medium (high within my scope) · effort S · risk low

**H.5 — `redundant:skills-asset-path`** — `dirname(fileURLToPath(import.meta.url))` +
`resolveSkillsRoot(here)` + `join(root, 'burner', file)`. Twice in my scope (C.6); the pattern's home
is `launcher/skills-root.ts` / `launcher/asset-paths.ts` (sibling scope — `asset-paths.ts:62`
already resolves a `sandcastle-template` asset the same way). Likely 3+ callers repo-wide.
· **judgement call** · confidence medium · effort S · risk low

**H.6 — `inconsistent:best-effort-swallow`** — `try { … } catch { /* best-effort */ }` appears
**seven** times in my six files (`reconcile-runs.ts:69,95`, `runner.ts:235`, `research.ts:361`,
`ticket-burner.ts:653,1494,2234`). Every instance here is documented and correct, so it is not a
local finding — but "cleanup that must never fail the caller" is a *policy* with no shared
expression, and silent-catch counts in the git / launcher / services scopes are where it turns into
swallowed bugs. Worth counting repo-wide. Suggested shape: `bestEffort(label, fn)` that at minimum
debug-logs, so N silent catches become N traceable ones.
· **judgement call** · confidence medium · effort S · risk low

**H.7 — `primitive-obsession:workflow-id`** — `'ticket-burner'` / `'research'` as bare strings keyed
across `registry.ts:12-14`, `runner.ts:42` (`BRANCH_CLAIMING`), `runner.ts:92`,
`reconcile-runs.ts:56,63`, `services/features.ts:501`, `launcher/launcher.ts:32`. The
branch-claiming flag belongs on `WorkflowDef` in core — `runner.ts:38-41` says so itself. Expect the
parent to find the same shape for **session kinds** (ideation/spec/tickets/qa/revisit/waypoint/
project) and **phases** in the launcher and services scopes: the
repeated-switch-on-a-stringly-typed-discriminator family.
· **judgement call** · confidence high · effort S (workflow half) · risk low

**H.8 — `latent:orphaned-burn-worktrees` (confirms E2E finding F19 from the code side)** —
`.sandcastle/worktrees/<branch>` is created **inside the user's project repo**
(`services/git.ts:651`; `cwd: project.repoPath` at `ticket-burner.ts:2022`, `:1842`,
`research.ts:274`), is **never added to that repo's `.gitignore`** (zero `gitignore` writes anywhere
in `packages/server/src`; `services/setup.ts:253` scaffolds `.sandcastle/` and writes no ignore
rule), and is **never swept** after a crash or hard cancel — boot reconciliation cleans *merged
branches* only (`reconcile-runs.ts:92-98` → `git.ts:1159-1204`, which only *detaches* worktrees).
Note runcastle's own `.gitignore` **does** list `.sandcastle/worktrees/`, which is exactly why this
is invisible when dogfooding on itself and visible on every other project. Cross-cutting because the
fix spans three scopes: git service (a `sweepBurnWorktrees(repoPath)`), workflows (call it from
`reconcileStaleRuns`), and project init / `services/setup.ts` (write the ignore rule when
scaffolding). Pair with whatever the `services/git.ts` leaf found.
· **violation** · confidence high · effort M · risk medium

**H.9 — `inconsistent:sandbox-selection`** — `research.ts:270` bypasses `selectSandbox`, silently
running a **podman**-configured user's AFK agent unsandboxed on the host, and its auth precheck
(`research.ts:100`) is scoped to `docker` only. If any sibling scope constructs a sandcastle sandbox
or a `claude` agent outside `buildBurnAgent`/`selectSandbox` (check `services/setup.ts` build-image
and `doctor/`), the same class of drift applies. **This is the one finding in my scope I would fix
first.** See D.1.
· **violation** · confidence high · effort S · risk low

**H.10 — `drift:spec-section-8`** — `docs/SPEC.md:178-179` still says tickets burn *on*
`feature/<slug>` at `concurrency = 1` with `docker() | noSandbox()`, contradicting both the code and
SPEC:180 (ADR-0007) in the same section. Sibling leaves auditing `services/git.ts` (§7) and the
launcher (§5) should check their sections for the same M1-era residue — the pattern is "an ADR added
a paragraph; the original bullet was never edited".
· **violation** (doc) · confidence high · effort S · risk low

**H.11 — `redundant:teardown-salvage` / `redundant:run-log-path`** — the sandcastle teardown-flake
recovery procedure (C.7) and the per-run log-file convention (C.8) are each written twice. Both are
burn-local today, but if any other scope calls sandcastle `run()` (check `services/setup.ts`
`build-image`) they become repo-wide. Low priority; listed so the parent can match by key.
· **judgement call** · confidence high · effort S · risk low

---

### Safety note

No secret values are reproduced anywhere in this report. The only credential handled in the scope is
an **OAuth token** (`CLAUDE_CODE_OAUTH_TOKEN`), read at `ticket-burner.ts:2229` / `research.ts:356`
from `~/.runcastle/.env` and injected into the sandbox at `ticket-burner.ts:1530` as the **only**
env var (`{ CLAUDE_CODE_OAUTH_TOKEN: token }`) — so the `RUNCASTLE_*` env-leak hazard does **not**
apply to sandboxes. Confirmed clean, per the parent's ground truth.
