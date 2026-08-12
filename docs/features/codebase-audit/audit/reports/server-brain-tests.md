# Audit report — `packages/server/test/**` (server test suite)

Scope: the 79 test files + 2 helpers under `packages/server/test/` (~17.2k lines
incl. helpers), assessed as a **test suite** for the server's service/data layer
(`src/services/*.ts`, `src/trpc/**`, `src/db/**`, `src/util/resolve-executable.ts`,
`src/config.ts`, `src/index.ts`). Analysis only; nothing edited. Section I omitted.

> **Headline.** By the usual failure modes this suite is unusually *good*:
> **zero `vi.mock` calls across 79 files**, two `vi.spyOn` sites, zero snapshots,
> four `toBeDefined()` assertions, one `toHaveBeenCalledTimes`. Tests exercise real
> services against a real (in-memory) SQLite and, in 16 files, a real git repo. So
> the findings below are *not* mock theatre. They are:
> 1. **fixture duplication at industrial scale** (the same 40-line git/tmp/home
>    scaffold hand-rolled in 16 files),
> 2. a **driver divergence** the suite structurally cannot see (`sql.js` vs
>    `bun:sqlite`) plus **zero transaction-rollback coverage** at either of the two
>    `db.transaction(` sites,
> 3. **silent platform skips** that make the suite green-but-empty on the
>    maintainer's own OS (Windows),
> 4. a set of **untested seams that exist because the seam is untestable** —
>    `buildApp`, `db/client.ts`, `errors.ts#toTRPCError`, `trpc/routers/settings.ts`,
> 5. **test-driven export widening** — 24 of 62 exports on `ticket-burner.ts` and
>    22 service symbols exist only so a test can reach them.

---

## A. Flow map — how a typical server test wires the app

There are exactly **four wiring shapes** in this suite. Every file is one of them.

```
SHAPE 1 — service-level (the default; ~47 files)
  test/*.test.ts
    └─ makeTestCtx()                         test/helpers/db.ts:15
         ├─ initSqlJs() → new SQL.Database()      (WASM, :memory:)
         ├─ drizzle(sqlite,{schema}) as unknown as Db   helpers/db.ts:18
         ├─ runMigrations(db)                     src/db/migrate.ts:29
         │     └─ reads packages/server/drizzle/*.sql via resolveAsset(RUNCASTLE_MIGRATIONS_DIR)
         └─ { db, config: RuncastleConfig.parse({}) }   → AppCtx
    └─ seedProject(ctx, repoPath?)           test/helpers/fixtures.ts:16
         └─ raw INSERT into `projects` (bypasses openProject's git validation)
         └─ repoPath defaults to tmpRepo() → mkdtempSync(tmpdir(),'runcastle-test-')
    └─ seedFeature(ctx, projectId, overrides) fixtures.ts:26 → raw INSERT into `features`
    └─ CALL THE SERVICE DIRECTLY:  storeTickets(ctx, …) / checkGate(ctx, …) / emit(ctx, …)
    └─ ASSERT on the return value AND on listAfter(ctx, featureId, 0)  (event feed)

SHAPE 2 — tRPC caller (12 files)
  … shape 1 …
    └─ createCallerFactory(appRouter)(ctx)   src/trpc/context.ts:30, src/trpc/router.ts:17
    └─ await caller.feature.merge({featureId})  → router → service → db
  cited: merge-conflict.test.ts:66, projects.test.ts:191, rethink.test.ts:17-18,
         quick-change.test.ts:13-14, orphaned-burning.test.ts:10-11, +7 more

SHAPE 3 — hand-mounted Hono sub-app (6 files) — NEVER buildApp
  const app = new Hono(); app.route('/api/hooks', hooksApp)   hooks-route.test.ts:14-18
  setRuntimeCtx(ctx)  src/launcher/runtime.ts   ← the DI seam the sub-apps read
  await app.request('/api/hooks/session-start', {…})
  cited: hooks-route.test.ts:15, live-stream.test.ts:23, encoding.test.ts:51,
         mapped-smoke.test.ts:56, mcp-tools.test.ts:348, web-serve.test.ts:24

SHAPE 4 — pure unit, injected IO, no db at all (~14 files)
  resolveExecutable('claude', {platform, pathEnv, exists})   resolve-executable.test.ts:12
  checkForUpdate({current, fetchImpl})                        update-check.test.ts:40
  writeGitIdentity(gitExec(), {...})                          setup.test.ts:49
  parseDriveEnv(text, identity)                               drive-env.test.ts:89
  ← this is the best-tested code in the package, and not by accident: these are
    the only modules whose IO is a parameter.
```

**The gap in the flow map, stated plainly:** `src/index.ts#buildApp` — the
documented "pure function of the DI context so tests can mount the full app
without binding a port" (`src/index.ts:20-24`) — **is imported by no test**. Only
`scripts/smoke.ts:66` uses it. Every HTTP test re-implements a slice of `buildApp`
by hand (Shape 3). `live-stream.test.ts:18-21` states the reason in a comment:

```
 * Mount the sub-app the way `buildApp` does. Importing `src/index` directly
 * would drag in `bun:sqlite`, which vitest's node runtime cannot load — same
 * reason `hooks-route.test.ts` mounts its sub-app by hand.
```

So `buildApp`'s own wiring — `setRuntimeCtx` at boot (`index.ts:35`), the
`/health` route (`:41`), the **UTF-8 charset middleware on `/api/trpc/*`**
(`:46-51`), the trpc mount, `mountWebAppIfBuilt` — has no test at all.

---

## B. Dead code

The suite itself contains almost no dead code. What it *causes* is a widened
production export surface (see D3). Two genuinely dead items surfaced:

**B1. `src/services/update-check.ts:123` — `resetUpdateCache` is a test-only affordance**
- Key: `test-only-export:update-check` · Kind: **violation** · Confidence: high · Effort S / risk low
- ```ts
  export function resetUpdateCache(): void {
  ```
- Verified: `grep -rn "resetUpdateCache" src/` returns **only the declaration**;
  the sole caller anywhere is `test/system-router.test.ts:22`. It exists purely to
  reset a module-global memo between tests.

**B2. `src/services/bus.ts:67` (`liveSubscriberCount`) and `src/services/agent-stream.ts:105` (`clearAllTranscripts`) — same shape**
- Key: `test-only-export:bus`, `test-only-export:agent-stream` · Kind: **violation** · Confidence: high · Effort S / risk low
- Verified: each symbol appears in exactly one `src/` file (its own declaration).
  Callers: `live-stream.test.ts:73,105,109,115`, `agent-stream.test.ts:5,11`.
- These are *reasonable* test seams for module-global state — but they are
  undeclared as such (no `__` prefix like `git.ts:1362 __resetTestDriveState`), so
  they read as public API. Inconsistency, see D4.

**Not dead (checked and cleared):** `crumbsFor`/`parentOf`/`looksLikeRepo`
(`fsbrowse.ts`), `identifierSafe`/`driveVars` (`drive-env.ts`),
`isTranslatedWindowsMount` (`projects.ts`), `upsertEnvVar` (`setup.ts`),
`preparedAt`/`isPrepared` (`prep.ts`), `burnWorktreePath`/`recordDriveUrl`
(`git.ts`), `isPreparedKey`/`preparedValue` (`findings.ts`), `tailLines`
(`drive-hooks.ts`) — all are used *inside their own module* and exported only so a
test can reach them. Live code, widened interface. See D3.

---

## C. Redundancy & repeated logic

### C1. The real-git fixture, hand-rolled 16 times
- Key: `redundant:test-git-fixture` · Kind: **judgement call** · Confidence: high · Effort **M** / risk low

The identical `initRepo` / `gitRepo` function — `git init -b main`, three
`addConfig` calls (`user.email`, `user.name`, `core.autocrlf false`), a README
write, `add`, `commit` — appears verbatim in **16 files**. `core.autocrlf` is
configured 19 times across the suite.

Four citations of the same block:
```ts
// test/git.test.ts:54-64
async function initRepo(dir: string): Promise<SimpleGit> {
  const g = simpleGit(dir)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  await g.addConfig('core.autocrlf', 'false')
  writeFileSync(join(dir, 'README.md'), 'base\n'); await g.add(['README.md'])
  await g.commit('initial commit'); return g }
```
```ts
// test/merge-conflict.test.ts:32-42   — byte-identical to the above
```
```ts
// test/projects.test.ts:37-48        — same body, named gitRepo(), returns the dir
```
```ts
// test/lap-guards.test.ts:34-43      — same body, returns void
// test/session-lifecycle.test.ts:57-64 — same body but `commit --allow-empty` instead of README
```
Full list: `burn-robustness`, `converge`, `delete`, `dry-run-drive`,
`feature-create`, `git`, `lap-guards`, `merge-conflict`, `project-mcp-tools`,
`projects`, `quick-change`, `reconcile-runs`, `review-commit-count`, `runner`,
`session-lifecycle`, `waypoint-work`.

**Suggested shared module: `test/helpers/git.ts`** exporting
`gitRepo(): Promise<{dir, git}>` (init + identity + autocrlf + seed commit),
`commitOn(git, branch, file, text)`, and `withConflict(project, git, slug)`
(currently only in `merge-conflict.test.ts:45-55`, but `git.test.ts` re-derives
the same conflict setup). Five adapters exist — this is well past "two = real seam".

### C2. Temp-dir create-and-track-and-rm, hand-rolled ~10 times
- Key: `redundant:test-tmpdir` · Kind: **judgement call** · Confidence: high · Effort S / risk low

```ts
// test/git.test.ts:45-51 ; identical in merge-conflict.test.ts:24-30,
// lap-guards.test.ts:26-32, delete.test.ts (same shape), burn-robustness, …
const tmpDirs: string[] = []
function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix)); tmpDirs.push(dir); return dir }
```
plus the matching `afterEach` teardown loop with its `try/catch { /* best-effort
— a lingering handle on Windows is non-fatal */ }` (`git.test.ts:109-121`,
`merge-conflict.test.ts:72-84`, `delete.test.ts:175-193`, `lap-guards.test.ts:68-74`).

`mkdtempSync(join(tmpdir(), …))` appears **46 times across 31 files**, while
`test/helpers/fixtures.ts:11 tmpRepo()` — which exists for exactly this — is used
by only 11.

**Suggested shared module: `test/helpers/tmp.ts`** — `tempDir(prefix)` registering
into a suite-level registry with an auto-`afterAll` cleanup.

### C3. `$HOME` / `$USERPROFILE` swap, hand-rolled 8 times
- Key: `redundant:test-temp-home` · Kind: **judgement call** · Confidence: high · Effort S / risk low

Because talk worktrees live under `~/.runcastle`, eight files save-swap-restore
the home env vars:
```ts
// test/lap-guards.test.ts:55-58 / afterEach :70-71
prevHome = process.env.HOME; prevUserProfile = process.env.USERPROFILE
process.env.HOME = home; process.env.USERPROFILE = home
```
Identical at `delete.test.ts:163-166/176-177`, `git.test.ts:290-291/302-303`
(and repeated *four more times inside the same file* at `:360,:416,:781`),
`prepare-session.test.ts:382-383`, `project-session.test.ts:189-190,278-279`,
`reconcile-runs.test.ts`, `runner.test.ts`, `resolve-executable.test.ts`.

**Suggested shared module: `test/helpers/home.ts` → `withTempHome()`.**

### C4. The "migrations dir before file N" helper, hand-rolled 3 times under 3 names
- Key: `redundant:test-migration-fixture` · Kind: **judgement call** · Confidence: high · Effort S / risk low

```ts
// test/events-migration.test.ts:22-34
const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')
function preFourDir(): string { … if (f.endsWith('.sql') && f < '0004') copyFileSync(…) }
async function freshDb(): Promise<Db> {
  const SQL = await initSqlJs(); return drizzle(new SQL.Database(), { schema }) as unknown as Db }
```
```ts
// test/feature-size-drop.test.ts:22-36   — same three declarations, `preDropDir`, cutoff '0008'
// test/lap-stamping.test.ts:32-46        — same three declarations, `preLapsDir`, cutoff '0014'
```
`freshDb()` is a copy of `makeTestCtx` minus the `runMigrations` call, including
the `as unknown as Db` cast, three times.

**Suggested shared module: `test/helpers/migrations.ts`** → `unmigratedDb()` +
`migrationsBefore('0014')`. Three adapters.

### C5. The caller-factory line, 16 occurrences
- Key: `redundant:test-trpc-caller` · Kind: **judgement call** · Confidence: high · Effort S / risk low

`createCallerFactory(appRouter)(ctx)` appears 16 times across 12 files, always
with the same two imports and the same unwieldy type annotation:
```ts
// test/merge-conflict.test.ts:59
let caller: ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>
```
**Suggested: `test/helpers/caller.ts` → `callerFor(ctx)` with an exported `Caller` type.**

### C6. Combined: the single missing harness
- Key: `redundant:test-harness` · Kind: **judgement call** · Confidence: high · Effort **M** / risk low

C1–C5 are one finding wearing five hats. Today `test/helpers/` is 72 lines
(`db.ts` 21, `fixtures.ts` 51) against ~17k lines of tests. The harness the
duplication points at:

```
test/helpers/
  db.ts          (exists)  makeTestCtx
  fixtures.ts    (exists)  seedProject / seedFeature / tmpRepo
  git.ts         (new)     gitRepo, commitOn, withConflict, remoteOnlyBranch†
  tmp.ts         (new)     tempDir + auto-cleanup registry
  home.ts        (new)     withTempHome
  caller.ts      (new)     callerFor(ctx) + Caller type
  migrations.ts  (new)     unmigratedDb, migrationsBefore
  scenario.ts    (new)     featureAt(ctx, phase, {tickets, waypoints, docs})  ‡
```
† `addRemoteOnlyBranch` currently lives only at `git.test.ts:90-103` but the same
setup is re-derived in `feature-create.test.ts:104`.
‡ the "seed a project + feature + advance to phase X + store N tickets" preamble
is written out longhand in `gates.test.ts:63-69`, `lap-guards.test.ts:164-167`,
`orphaned-burning.test.ts`, `quick-change.test.ts`, `rethink.test.ts` — five
adapters for a `featureAt()` scenario builder.

---

## D. Inconsistencies & structural smells

### D1. Silent platform skips make the suite green-but-empty on Windows
- Key: `fragile:platform-skips` · Kind: **violation** · Confidence: high · Effort S / risk low

This repo's stated dev platform is Windows (CLAUDE.md: *"Windows paths: always
`node:path`"*), and the audit host is Windows 11. Yet:

```ts
// test/dry-run-drive.test.ts:64-76 — ptyAvailable() hardcodes /bin/sh
function ptyAvailable(): boolean {
  try { const p = createNativePtySession('/bin/sh', ['-c','true'], {…}); p.kill(); return true }
  catch { return false } }
const PTY = process.platform !== 'win32' && ptyAvailable()
```
`dry-run-drive.test.ts:255` and `:341` are `it.runIf(PTY)` — **both skip on
Windows**, and those are the two tests that prove the dev-server drive loop
actually boots and sniffs a localhost URL.

```ts
// test/dev-pane.test.ts:39   const AVAILABLE = process.platform !== 'win32' && ptyAvailable()
// test/dev-pane.test.ts:106  describe.skipIf(!AVAILABLE)('startDevPane / stopDevPane', …)
```

Worse than `skipIf`, five sites **early-return inside `it()`**, so vitest reports
them as *passed*:
```ts
// test/canon.test.ts:8 and :15  — the ENTIRE 19-line file is a no-op on Windows
it('keeps case-distinct paths distinct on a case-sensitive filesystem', () => {
  if (process.platform === 'win32') return
```
```ts
// test/dev-pane.test.ts:94   if (process.platform === 'win32') return
// test/dev-pane.test.ts:99   if (process.platform !== 'win32') return
// test/fsbrowse.test.ts:127,141  catch { return }  // symlink denied → passes silently
```
`fsbrowse.test.ts:123` ("follows a symlink … and tags it") and `:136` ("hides
junctions … findings F17.3") are *specifically Windows-junction regressions* and
they silently pass without asserting anything on an unprivileged Windows box.

**Fix shape:** replace `if (…) return` with `it.skipIf(…)` so skips are visible,
and make `ptyAvailable()` platform-aware (`cmd.exe /c exit` on win32) rather than
`/bin/sh`.

### D2. No test-env isolation — the documented phantom-failure mode has no guard
- Key: `fragile:test-env-isolation` · Kind: **violation** · Confidence: high · Effort S / risk low

`vitest.config.ts` (repo root) is four lines: `include` only. No `setupFiles`, no
`env`, no `restoreMocks`, no `testTimeout`.

`src/db/migrate.ts:22-25` resolves the migrations dir **at module load** through
`resolveAsset(ASSET_ENV.migrations, …)`, i.e. `process.env.RUNCASTLE_MIGRATIONS_DIR`
wins if set. `makeTestCtx()` calls `runMigrations(db)` on every one of ~47 files.
So a developer (or an agent session) with `RUNCASTLE_*` exported sees the whole
suite migrate against a *vendored* schema.

Exactly one file defends itself, and only in `afterEach` — so its **first** test is
still exposed:
```ts
// test/asset-paths.test.ts:20-24
const ALL_ENV = Object.values(ASSET_ENV)
afterEach(() => { for (const v of ALL_ENV) delete process.env[v] })
…
// :27-29 the first test, which the inherited var breaks:
it('returns the fallback untouched when the override is unset', () => {
  expect(resolveAsset(ASSET_ENV.migrations, '/workspace/drizzle')).toBe('/workspace/drizzle') })
```
**Fix shape:** a `test/setup.ts` registered as `setupFiles` that deletes every
`ASSET_ENV` value (and `RUNCASTLE_MODEL`, `RUNCASTLE_SANDBOX`,
`RUNCASTLE_BURN_CONCURRENCY`, `RUNCASTLE_PTY_BACKEND`, `RUNCASTLE_DATA_DIR`)
before any module loads.

### D3. Test-driven export widening (tests reaching for private helpers)
- Key: `coupled-to-impl:test-only-exports` · Kind: **judgement call** · Confidence: high · Effort **L** / risk medium

`src/workflows/ticket-burner.ts` (2245 lines) has **62 exports; 24 of them have no
importer in `src/` other than their own file** — they are exported solely for
`test/ticket-burner-units.test.ts` (952 lines, the largest test file):

```
buildConflictFilesBlock  buildIsolatedSetupCommand  buildOtherSideBlock
buildSandboxOptions      buildTicketJson            buildVerifyNotes
buildWorkspaceNotes      cacheMountFor              classifyTicketRunError
classifyToolCall         createToolTimer            formatTimingSummary
createSerialQueue        detectCycle                detectPackageManager
indexBySeq               interpretRunResult         isMergeConflictError
landWithResolve          renderTicketPrompt         resolveBurnWorkspaceMode
resolveMergeCommand      resolveSetupCommand        selectSandbox
```
(verified per-symbol: `grep -rl <sym> src/` returns only `ticket-burner.ts`)

The same pattern, smaller, across the service layer — 22 symbols whose only
non-self reference is a test:
`agent-stream.clearAllTranscripts`, `bus.liveSubscriberCount`,
`drive-env.{identifierSafe,driveVars}`, `drive-hooks.tailLines`,
`findings.{isPreparedKey,preparedValue}`,
`fsbrowse.{looksLikeRepo,crumbsFor,parentOf}`,
`git.{burnWorktreePath,recordDriveUrl,__resetTestDriveState}`,
`prep.{isPrepared,preparedAt}`, `projects.isTranslatedWindowsMount`,
`setup.{upsertEnvVar,sandcastleTemplateDir,scaffoldSandcastleConfig,createTokenVerifier}`,
`update-check.{resetUpdateCache}`, `resolve-executable.{wellKnownBinDirs,resolveExecutable}`.

**Two readings, and the report should hold both.** For the small pure ones
(`identifierSafe`, `compareSemver`, `parseDriveEnv`, `resolveExecutable`) exporting
is *right* — they are genuine sub-modules with their own contract, and the tests
that use them (`drive-env.test.ts`, `resolve-executable.test.ts`) are the best in
the suite. For `ticket-burner.ts`, 24 exports is the module telling you it should
be **four modules** — `burner/prompt.ts` (the `build*`/`render*` block builders),
`burner/sandbox.ts` (`selectSandbox`, `buildSandboxOptions`, `cacheMountFor`,
`detectPackageManager`, `resolveSetupCommand`), `burner/stream.ts`
(`createStreamThrottle`, `classifyToolCall`, `createToolTimer`,
`formatTimingSummary`), `burner/land.ts` (`landWithResolve`, `isMergeConflictError`,
`resolveMergeCommand`, `createSerialQueue`) — at which point each export is public
API of a small module rather than a private of a giant one. That refactor is
scored in G1.

### D4. Two conventions for "this export exists for tests"
- Key: `inconsistent:test-seam-naming` · Kind: **judgement call** · Confidence: high · Effort S / risk low

`src/services/git.ts:1362` marks its reset hook with the `__` prefix:
```ts
export function __resetTestDriveState(): void {
```
The three sibling module-global resets do not: `agent-stream.ts:105
clearAllTranscripts`, `bus.ts:67 liveSubscriberCount`, `update-check.ts:123
resetUpdateCache`. Same job, same reason, one marked, three indistinguishable from
product API.

### D5. Repeated switch on the same seed shape — `insertRun` written per file
- Key: `redundant:test-seed-run` · Kind: **judgement call** · Confidence: high · Effort S / risk low

`seedProject`/`seedFeature` were extracted; the sibling **`runs`** and **`sessions`**
seeds were not, so each file writes its own raw insert:
```ts
// test/projects.test.ts:50-65      function seedRunningRun(ctx, featureId)
// test/git.test.ts:66-79           function insertRun(ctx, featureId, status)
// test/session-lifecycle.test.ts:66-73  function seedRunningRun(ctx, featureId, workflow='research')
// test/delete.test.ts:~135-145     (same shape, inside seedAllRows)
```
Three near-identical helpers with three names and slightly different signatures.
Extend `test/helpers/fixtures.ts` with `seedRun(ctx, featureId, over?)` and
`seedSession(ctx, over?)`.

### D6. Assertions pinned to exact prose
- Key: `coupled-to-impl:prose-assertions` · Kind: **judgement call** · Confidence: medium · Effort S / risk low

The suite has no snapshots, but 13 sites assert an exact message/reason string:
```ts
// test/gates.test.ts:113-115
expect(checkGate(ctx, 'all-waypoints-terminal', feature).reason).toBe(
  '3 waypoints not yet terminal (2 open, 1 claimed)')
// test/gates.test.ts:124, :138 — same, for the singular and the ticket variant
```
```ts
// test/burn-from-review.test.ts:89  expect(ev?.message).toBe('burn from review — iterating')
// test/rethink.test.ts:72           expect(started?.message).toBe('rethink — lap 2')
```
These are *pluralisation/format* tests, so pinning the string is defensible for
`gates.test.ts` (the pluralisation IS the behaviour). The event-message ones are
not: `burn-from-review.test.ts:89` and `rethink.test.ts:72` would fail on a pure
copy edit while proving nothing the event `type` assertion beside them doesn't.

Two larger prose-equality assertions are on **rendered product documents**, which I
read as legitimate (the markdown *is* the deliverable), and flag only so the parent
can see them:
```ts
// test/test-notes.test.ts:174-189 — full test-notes.md body equality
// test/test-notes.test.ts:194,197,200 — three more full-body equalities
```

### D7. Sleep/poll-based waits with no fake clock (flake surface)
- Key: `fragile:test-timing` · Kind: **judgement call** · Confidence: medium · Effort S / risk low

Most timing-sensitive tests do it right — `kickoff.test.ts` uses
`vi.useFakeTimers()` throughout (`:38`, `:56-115`, `:200-488`), `test-notes.test.ts:33`
drives `setSystemTime`, `update-check.test.ts` injects `now`. But six sites busy-wait
against a wall clock:
```ts
// test/burn-from-review.test.ts:48-53
async function waitFor(fn: () => boolean, tries = 100): Promise<void> {
  … await new Promise((r) => setTimeout(r, 5)) …   // 500ms budget
  throw new Error('waitFor timed out') }
```
```ts
// test/project-session.test.ts:79-96  waitForProjectEvent — 25ms poll loop
// test/live-stream.test.ts:46,160     5000ms deadline + 50ms poll
// test/ticket-burner.test.ts:303      await new Promise(r => setTimeout(r, 10))
// test/ticket-burner-units.test.ts:765 setTimeout inside a serial-queue ordering test
// test/dev-pane.test.ts:26 / dry-run-drive.test.ts:78  delay(ms)
```
`ticket-burner-units.test.ts:755-780` asserts strict serial ordering using a 20ms
vs 1ms race — correct today, but it is a timing assertion on a machine under load.
`vitest.config.ts` sets no `testTimeout`, so the default 5s applies to
`live-stream.test.ts`'s own 5s deadlines — the two are the same number.

### D8. Zero coverage of the tRPC error-mapping contract
- Key: `gap:trpc-error-mapping` · Kind: **violation** · Confidence: high · Effort S / risk low

`src/errors.ts:58-71` maps `NotFoundError → NOT_FOUND`, `GateError →
PRECONDITION_FAILED`, `InvalidInputError → BAD_REQUEST`, everything else →
`INTERNAL_SERVER_ERROR`; `src/trpc/context.ts:19-26` installs it as middleware on
every procedure. **No test anywhere asserts a resulting tRPC `code`** — `grep -rn
"toTRPCError|TRPCError|\.code).toBe" test/` returns only unrelated exec-code
assertions (`doctor-system-exec.test.ts:10`, `pty.test.ts:106`). Router-level tests
assert only `rejects.toThrow(/message/)` (`merge-conflict.test.ts:135`,
`projects.test.ts:195-197`). The web UI branches on those codes; the mapping table
is a wire contract with no test and there is no `test/errors.test.ts`.

---

## E. Wrong-tool & weak-typing findings (in the tests)

The suite is close to clean here — 3 non-null `!` assertions, 0 `@ts-ignore`,
0 `@ts-expect-error`. What exists:

**E1. `test/delete.test.ts:147-153` — `as any` + a lint pragma for a linter that does not exist**
- Key: `weak-typing:test-rowcount` · Kind: **violation** · Confidence: high · Effort S / risk low
```ts
function rowCount(ctx: AppCtx, table: unknown, featureId: string): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = table as any
  const key = t === features ? t.id : t.featureId
```
Two problems: `any` without the quarantine comment CLAUDE.md requires, and an
`eslint-disable` in a repo the briefing confirms has **no lint step** — dead
pragma, and doc drift about the toolchain. A generic constrained on
`SQLiteTable & { featureId: … }` types this fine.

**E2. `test/hooks-route.test.ts:20` — `any` on the shared response helper**
- Key: `weak-typing:test-http-helper` · Kind: **violation** · Confidence: high · Effort S / risk low
```ts
async function post(app: Hono, event: string, body: unknown): Promise<{ status: number; json: any }> {
```
Every one of the file's ~30 assertions reads through this `any`
(`json.hookSpecificOutput.additionalContext` at `:64` etc.), so a rename of the
hook response shape breaks nothing at typecheck. `mapped-smoke.test.ts:72,84`
repeats the pattern (`data: any`).

**E3. `as unknown as Db` repeated in the three migration files**
- Key: `weak-typing:test-db-cast` · Kind: **judgement call** · Confidence: high · Effort S / risk low
- `events-migration.test.ts:33`, `feature-size-drop.test.ts:35`, `lap-stamping.test.ts:45`
  each repeat `drizzle(new SQL.Database(), { schema }) as unknown as Db`, copying the
  cast that `helpers/db.ts:18` already quarantines with a docblock. Folding C4 fixes
  this too — one cast, one comment.

**E4. `as unknown as` fakes standing in for real interfaces (5 files)**
- Key: `weak-typing:test-fakes` · Kind: **judgement call** · Confidence: medium · Effort S / risk low
```ts
// test/kickoff.test.ts:209
const entry = { exited: false, pty: { write: (d: string) => written.push(d) } } as unknown as PtyEntry
// test/session-lifecycle.test.ts:456 — same
// test/drive-hooks.test.ts:101 — as unknown as typeof import('node:child_process').spawn
// test/update-check.test.ts:35,57,65,79,88 — five `as unknown as typeof fetch`
```
The `fetch` ones are unavoidable (`fetchImpl` is typed `typeof fetch`); the
`PtyEntry` ones say the production type is bigger than the seam needs — a
`PtyWriter = Pick<PtyEntry,'exited'|'pty'>` parameter type would delete the cast.

---

## F. Shallow modules / deletion-test candidates (in the test helpers)

**F1. `test/helpers/db.ts` is *not* shallow — it earns its keep and should grow.**
21 lines behind `makeTestCtx()`; deleting it reappears as ~8 lines × 47 files plus
the driver cast. Keep. The finding is that it is the *only* helper of its kind
(see C6): a 72-line helper directory serving 17k lines of tests is under-built, not
over-built. The shallow-module smell here runs the other way — **absence**.

**F2. `test/helpers/fixtures.ts:11 tmpRepo()` — a one-line pass-through with a hole**
- Key: `shallow:tmpRepo` · Kind: **judgement call** · Confidence: high · Effort S / risk low
```ts
export function tmpRepo(): string { return mkdtempSync(join(tmpdir(), 'runcastle-test-')) }
```
Deletion test: the body is one call, so as a *wrapper* it is pass-through — 31
files bypass it and inline `mkdtempSync(join(tmpdir(), …))` anyway. What would make
it deep is the thing it is missing: **cleanup**. It never registers the directory
for removal, and `seedProject(ctx)` (`fixtures.ts:16`) calls it *by default*, so
every one of the 41 files using `seedProject` leaks a temp dir per test. Several of
those then write real files into the leak — `test-notes.test.ts:47-52` renders
`docs/features/<slug>/test-notes.md` into it, `gates.test.ts:16-20` writes
`decisions.md`/`spec.md`. Adding the registry + `afterAll` turns a pass-through
into a real module (this is C2's other half).

---

## G. Deepening / consolidation / extraction opportunities (ranked)

**G1. Split `src/workflows/ticket-burner.ts` along the lines its own test file already draws** — highest value, highest effort
- Key: `extract:ticket-burner-submodules` · Kind: **judgement call** · Confidence: high · Effort **L** / blast radius **medium** (one importer: `workflows/registry.ts`; plus `ticket-burner-units.test.ts` import block)
- The 24 test-only exports (D3) cluster cleanly into four groups, and
  `ticket-burner-units.test.ts`'s own `describe` blocks are already grouped that
  way (`:115 renderTicketPrompt`, `:193 createStreamThrottle`, `:329 selectSandbox`,
  `:368 classifyToolCall`, `:526 setup-command detection`, `:795 landWithResolve`).
  Extracting `burner/prompt.ts`, `burner/sandbox.ts`, `burner/stream.ts`,
  `burner/land.ts` turns 24 leaked privates into 4 module interfaces and lets the
  952-line test split into four files that each own one contract.

**G2. Build the shared test harness (C1–C5 collapsed)** — highest value per unit effort
- Key: `extract:test-harness` · Kind: **judgement call** · Confidence: high · Effort **M** / blast radius **low** (test-only; nothing in `src/` moves)
- `test/helpers/{git,tmp,home,caller,migrations,scenario}.ts` per C6. Removes ~16
  copies of `initRepo`, ~10 of `mkTmp`+teardown, 8 of the home swap, 3 of the
  migration fixture, 16 of the caller line. Every one of those has ≥3 adapters
  today, so none is speculative. Also fixes F2's leak in one place.

**G3. A `setupFiles` env firewall** — smallest change, removes a whole class of phantom failure
- Key: `extract:test-env-firewall` · Kind: **judgement call** · Confidence: high · Effort **S** / blast radius **low**
- Per D2. One new file, one line in `vitest.config.ts`. Also the right home for a
  `testTimeout` bump for the real-git files and for `restoreMocks: true`.

**G4. Make `buildApp` reachable from tests by moving the `bun:sqlite` import off the boot path**
- Key: `extract:app-factory-seam` · Kind: **judgement call** · Confidence: high · Effort **M** / blast radius **medium**
- `src/index.ts:5` (`import { createDb } from './db/client'`) is the single reason
  `buildApp` cannot be imported under vitest — `buildApp` itself never touches
  `createDb`; only `startServer` (`:79`) does. Splitting `src/app.ts` (`buildApp`,
  pure) from `src/index.ts` (`startServer`, the bun-only boot) makes the app
  factory testable, replaces 6 hand-mounted Hono apps (Shape 3) with one real
  mount, and brings the untested `/health` route and the `/api/trpc/*` UTF-8
  charset middleware (`index.ts:46-51` — an encoding fix with no regression test)
  under coverage. Two adapters already exist (`scripts/smoke.ts:66` and the six
  hand-mounts), so this is a real seam, not a hypothetical one.

**G5. Thread the settings IO seam through the router so `settings.get/update` become testable**
- Key: `extract:settings-io-seam` · Kind: **judgement call** · Confidence: high · Effort **S** / blast radius **low**
- `src/trpc/routers/settings.ts:15,19` call `getSettings(ctx, input?.projectId)` /
  `updateSettings(ctx, input)` — dropping the third `io` parameter that
  `settings.test.ts:43` relies on (`io = (env) => ({ env, configFile })`). The
  result: `settings.test.ts` covers the service exhaustively (264 lines) while the
  router has **zero** tests, because calling it would write to the real
  `~/.runcastle/config.json`. Put the io on `AppCtx` (or default it from `ctx`) and
  the router becomes ordinary Shape-2 testable.

**G6. Cover the `toTRPCError` mapping table** — trivial, currently zero
- Key: `extract:error-mapping-test` · Kind: **judgement call** · Confidence: high · Effort **S** / blast radius **none**
- Per D8. A ~30-line `test/errors.test.ts` pinning all six branches of
  `errors.ts:58-71`, plus one router-level assertion that a `GateError` from a
  service arrives as `PRECONDITION_FAILED` through the middleware
  (`trpc/context.ts:19-26`).

---

## H. Cross-cutting candidates to pass UP

These are the ones I expect siblings (server-src, web, core) to have hit too.

**H1. `fragile:test-env-isolation` — no `setupFiles`, `RUNCASTLE_*` leaks into every suite**
Root cause is repo-wide (`vitest.config.ts` at the repo root covers
`packages/*/test` **and** `apps/*/test`), so `packages/core` and `apps/web` share
the exposure. Any agent auditing `apps/web/test` or `packages/core/test` should be
asked whether they also found env-dependent module-load-time resolution. Evidence:
`vitest.config.ts`, `src/db/migrate.ts:22-25`, `src/launcher/asset-paths.ts:40-48`,
`test/asset-paths.test.ts:22-24`.

**H2. `redundant:test-harness` — every package's tests re-derive their own fixtures**
Named here as `test/helpers/{git,tmp,home,caller,migrations,scenario}.ts` with 16 /
10 / 8 / 16 / 3 / 5 adapters respectively. If `apps/web/test` or
`packages/core/test` also hand-roll a ctx/fixture preamble, the right shape is a
`@runcastle/test-fixtures` workspace package rather than six files under
`packages/server/test/helpers/`. Parent should merge on this key before deciding
the location.

**H3. `coupled-to-impl:test-only-exports` — modules widened so tests can reach privates**
24/62 exports on `workflows/ticket-burner.ts`, 22 across `services/*` +
`util/resolve-executable.ts` (enumerated in D3, verified per-symbol). This is a
**module-depth signal, not a test bug** — a module whose tests need 24 private
handles is announcing it is four modules. A sibling auditing `src/services/*.ts`
for shallow/deep modules should be handed this list: it is independent evidence for
the same seams they will be proposing. Cross-check especially `git.ts` (2117 lines,
53 exports) and `features.ts` (950 lines, 21 exports).

**H4. `fragile:platform-skips` — Windows-targeted regressions that skip on Windows**
`test/canon.test.ts` (whole file), `dev-pane.test.ts:94,99,106,173`,
`dry-run-drive.test.ts:76,255,341`, `fsbrowse.test.ts:127,141`. Several of these
guard *findings-numbered Windows bugs* (F17.3 junction noise) and prove nothing on
the platform they were written for. The `ptyAvailable()` probe hardcoding `/bin/sh`
(`dry-run-drive.test.ts:66`) is a concrete bug in the harness. Any sibling auditing
PTY/launcher source should be told the PTY tests do not run on Windows, so
`src/pty/**` behaviour there is source-reviewed only.

**H5. `gap:driver-divergence` — tests run sql.js, production runs bun:sqlite**
`test/helpers/db.ts:16-18` vs `src/db/client.ts:15-19`. What the suite therefore
**cannot** catch, in decreasing order of risk:
- **Transaction rollback.** `db.transaction(` exists at exactly two sites —
  `src/db/migrate.ts:55` (per-migration-file atomicity) and
  `src/services/findings.ts:119` (*"Write a prepared value AND its provenance in
  one transaction — the two must never diverge"*). **Neither has a rollback test.**
  `grep -rniE "rollback" test/` returns nothing; the four places the tests say
  "transactional" (`lap-guards.test.ts:21,157`, `waypoints.test.ts:127`,
  `waypoint-work.test.ts:29`) are testing **hand-rolled compensating writes**
  (`rethinkAndLaunch`, `burn`'s loop-back), not `db.transaction`. So the one
  invariant `findings.ts` documents as load-bearing — value and provenance never
  diverge — is asserted only on the happy path (`findings.test.ts:113-142`).
- **WAL and concurrency.** `client.ts:17` (`PRAGMA journal_mode = WAL`) is never
  executed under test; `db/client.ts` has **zero test importers by design**
  (`client.ts:9-11` says so). No test runs two writers, so lock contention,
  `SQLITE_BUSY`, and the burn-concurrency=3 path against one db handle are
  unexercised. `waypoints.test.ts:148 'fails a double-claim'` is *sequential*, not
  concurrent — the transactional claim's actual race is untested.
- **`PRAGMA foreign_keys = ON` (`client.ts:18`) — verified NOT a divergence risk.**
  I checked all 19 files in `packages/server/drizzle/*.sql`: `grep -c REFERENCES`
  matches **nothing**. There are no FK constraints in the schema, so the pragma is
  inert and sql.js's default-off costs the tests nothing today. It *would* start
  costing the moment a migration adds a `REFERENCES` clause — and the tests already
  insert orphan rows that a real FK would reject (`lap-stamping.test.ts:65-68`
  inserts `features.project_id = 'proj_1'` with no such project row). Flag for the
  db/source agent: **the pragma is currently a no-op, and adding an FK later will
  break these tests silently in the other direction.**

**H6. `gap:trpc-router-coverage` — 5 of 11 routers have no caller-level test**
Untested through the wire: `docs`, `events`, `run`, `settings`, `setup`. Tested:
`system` (`system-router.test.ts`), `notes` (`test-notes-router.test.ts`); partially
tested: `feature` (6 of 21 procedures), `project` (2), `ticket` (1). The web agent
should be asked which of these procedures `apps/web` actually calls — a procedure
the UI polls every 1.5s (`events.list`, `feature.driveInfo`) with no wire test is a
different risk from one nothing calls. Evidence: `grep -rhoE "caller\.[a-z]+\.[a-zA-Z]+"
test/` yields 17 distinct procedures against `router.ts:17-28`'s 11 routers.

---

## Appendix — per-module coverage matrix (task item 1)

| Module | Owning test file | How direct |
|---|---|---|
| `services/agent-stream.ts` | `agent-stream.test.ts` (86 L) | **direct**, pure unit incl. byte-cap trim |
| `services/bus.ts` | *(none)* — `live-stream.test.ts:61-117` | **direct-in-another-file**; sub/pub/count + throwing subscriber |
| `services/drive-env.ts` | `drive-env.test.ts` (145 L) | **direct**, pure unit — exemplary |
| `services/drive-hooks.ts` | `drive-hooks.test.ts` (138 L) | **direct**, injected `spawn` |
| `services/events.ts` | `events.test.ts` (105 L) + 38 files | **direct** + used as the assertion surface everywhere |
| `services/feature-docs.ts` | **NONE** | only `featureDocsDir` borrowed as a path helper (`gates.test.ts:8`, `encoding`, `rethink`) |
| `services/features.ts` (950 L) | **no owning file** | covered across `feature-create`, `feature-list`, `delete`, `archive`, `quick-change`, `lap-guards`, `rethink`, `burn-*`, `projects` |
| `services/findings.ts` | `findings.test.ts` (312 L) | **direct** — but no rollback test for its `transaction` (H5) |
| `services/fsbrowse.ts` | `fsbrowse.test.ts` (205 L) | **direct**; two Windows cases silently no-op (D1) |
| `services/gates.ts` | `gates.test.ts` (189 L) | **direct** |
| `services/git.ts` (2117 L) | `git.test.ts` (1372 L) + `merge-conflict` + 16 files | **direct**, real git. **merge-conflict path IS covered** (`merge-conflict.test.ts:86-103`) |
| `services/knowledge.ts` | **NONE** | indirect via `encoding`, `mapped-feature`, `project-resolution`, `quick-change` |
| `services/prep.ts` | **no owning file** | direct calls inside `findings.test.ts:72-111,271-282`, `prepare-session`, `dry-run-drive` |
| `services/projects.ts` | `projects.test.ts` (238 L) | **direct** |
| `services/repo.ts` (217 L) | **NONE** | used as a read helper in 15 files (`getFeatureRow`, `rowToFeature`); its own mapping/`setPhase` semantics never asserted |
| `services/settings.ts` | `settings.test.ts` (264 L) + `step-models` | **direct** via the injected `io` seam |
| `services/setup.ts` | `setup.test.ts` (273 L) + `sandcastle-scaffold` | **direct**, injected `ExecFn` |
| `services/test-notes.ts` | `test-notes.test.ts` (202 L) + `test-notes-router` | **direct** |
| `services/tickets.ts` | `tickets.test.ts` (115 L) + 14 files | **direct** |
| `services/update-check.ts` | `update-check.test.ts` (93 L) | **direct**, injected `fetchImpl` |
| `services/waypoints.ts` | `waypoints.test.ts` (222 L) | **direct** |
| `trpc/context.ts` | *(none)* | `createCallerFactory` used by 12 files; the **error middleware is never asserted** (D8) |
| `trpc/router.ts` | — | imported by 12 files |
| `trpc/routers/feature.ts` | partial | only `burn`, `merge`, `quickChange`, `get`, `commitCount`, `rethink` (6/21) |
| `trpc/routers/project.ts` | partial | only `rename`, `dryRunStop` |
| `trpc/routers/ticket.ts` | partial | only `stop` |
| `trpc/routers/test-notes.ts` | `test-notes-router.test.ts` | **direct** |
| `trpc/routers/system.ts` | `system-router.test.ts` | **direct** |
| `trpc/routers/docs.ts` | **NONE** | |
| `trpc/routers/events.ts` | **NONE** | the 1.5s-polled procedure has no wire test |
| `trpc/routers/run.ts` | **NONE** | |
| `trpc/routers/settings.ts` | **NONE** | structurally untestable — drops the io seam (G5) |
| `trpc/routers/setup.ts` | **NONE** | |
| `db/schema.ts` | — | exercised by every test |
| `db/migrate.ts` | `events-migration`, `feature-size-drop`, `lap-stamping` | **direct** incl. idempotence (`lap-stamping.test.ts:97-118`); **no rollback test** |
| `db/client.ts` | **NONE — by design** | `client.ts:9-11`: "never imported by services or tests". WAL + pragmas unexercised |
| `db/types.ts` | — | types only |
| `util/resolve-executable.ts` | `resolve-executable.test.ts` (293 L) | **direct**, fully injected — best-tested module in the package |
| `config.ts` | **NONE** | `ensureDataDir()` (`config.ts:21-27`) untested — it `mkdir`s the real `~/.runcastle/` |
| `index.ts` | **NONE** | `buildApp` used only by `scripts/smoke.ts:66`; `startServer` untested (A, G4) |
| `errors.ts` | **NONE** | the `toTRPCError` wire contract, zero tests (D8) |

**Untested behaviour classes, named:** transaction rollback (both sites);
concurrent writers / `SQLITE_BUSY` / WAL; concurrent waypoint claim (only the
sequential double-claim at `waypoints.test.ts:148`); the tRPC error-code mapping;
`buildApp`'s boot wiring incl. the UTF-8 charset middleware; `ensureDataDir`;
Windows PTY + dev-pane + `canon` (skipped on Windows, D1); `settings`/`setup`/`docs`/
`events`/`run` routers.
