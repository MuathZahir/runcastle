# server-brain-wire — tRPC wire, db layer, util, boot config

Scope: `packages/server/src/trpc/**`, `src/db/**`, `src/util/resolve-executable.ts`,
`src/config.ts`, `src/index.ts`, `src/errors.ts`. Audited directly by the SERVER-BRAIN
orchestrator (the leaf assigned this scope died on an API session limit; the concurrent
subagent cap prevented a respawn, so the orchestrator covered it in-line). Test-suite
assessment is in `server-brain-tests.md`.

## A. Flow map

```
src/bin/runcastle.ts  (sole entrypoint — index.ts deliberately has NO import.meta.main guard,
                       index.ts:138-145)
  └─ startServer()                              index.ts:73
       ├─ loadConfig()                          config.ts:13 → re-export of @runcastle/core/config-load
       ├─ ensureDataDir()                       config.ts:21  (mkdir data/logs/sessions/worktrees)
       ├─ createDb(dbPath())                    db/client.ts:15  (bun:sqlite; WAL + foreign_keys ON)
       ├─ runMigrations(db)                     db/migrate.ts:29 (per-file txn, __migrations ledger)
       ├─ ctx: AppCtx = { db, config }          db/types.ts:26
       ├─ buildApp(ctx)                         index.ts:26
       │    ├─ setRuntimeCtx(ctx)               launcher/runtime  [BOUNDARY → sibling scope]
       │    ├─ GET /health
       │    ├─ /api/trpc/*  charset shim + trpcServer({ router: appRouter, createContext: () => ctx })
       │    ├─ /api/hooks   routes/hooks        [BOUNDARY]
       │    ├─ /api/stream  routes/stream (SSE) [BOUNDARY]
       │    ├─ /mcp         mcp/server          [BOUNDARY]
       │    └─ mountWebAppIfBuilt(app)          routes/web [BOUNDARY]
       ├─ reconcileStaleSessions(ctx)           launcher/reconcile [BOUNDARY]
       ├─ await reconcileStaleRuns(ctx)         workflows/reconcile-runs [BOUNDARY]
       ├─ Bun.serve({ port, fetch: tryUpgradeTerminal ?? app.fetch, websocket })  index.ts:105
       └─ SIGINT/SIGTERM → ptyRegistry().killAll(); server.stop(); process.exit(0)   index.ts:128
```

Request flow:

```
HTTP POST /api/trpc/<router>.<proc>
  └─ Hono charset middleware                    index.ts:46-51
      └─ @hono/trpc-server → createContext = () => ctx   (the SAME singleton AppCtx; no per-request ctx)
          └─ publicProcedure                    trpc/context.ts:29
               ├─ errorMapping middleware       trpc/context.ts:19-26  → toTRPCError(cause ?? error)
               ├─ .input(zod)                   (present on every procedure that takes input)
               └─ resolver → service fn(ctx, …) → drizzle → [emit(...) inside the service]
```

59 procedures across 10 mounted routers (`trpc/router.ts:17`): docs 1, events 2, feature 21,
project 13, run 3, settings 2, setup 5, system 2, notes 6, ticket 4.

## B. Dead code

**`dead-code:not-implemented-error`** — kind: violation — confidence: high — effort S, risk low.
`NotImplementedError` is **constructed nowhere in the repository**. Verified:
`grep -rn "new NotImplementedError" packages apps scripts --include=*.ts --include=*.tsx`
(excluding node_modules/dist) returns **zero hits**; the only occurrences of the identifier are
its own declaration and the five sites that *catch* it.

```
errors.ts:15   export class NotImplementedError extends Error {   // never instantiated
errors.ts:48   export function isNotImplemented(e: unknown): e is NotImplementedError {
errors.ts:60     if (e instanceof NotImplementedError)             // unreachable branch in toTRPCError
```

Consequently every `isNotImplemented(e)` guard is an unreachable branch:
`launcher/launcher.ts:339`, `mcp/server.ts:344` (both sibling scope — flagged for the tree),
`services/features.ts:311`, `services/projects.ts:173`, `services/projects.ts:185`.

**`doc-drift:wave-b-comments`** — kind: violation — confidence: high — effort S.
Comments still describe the vanished stubs as live behaviour:

```
trpc/context.ts:10   * `publicProcedure` carries an error-mapping middleware … `NotImplementedError` → INTERNAL_SERVER_ERROR
trpc/routers/feature.ts:55    // B1 behavior — the stub throws NotImplementedError('B1').
trpc/routers/feature.ts:168   // B2 behavior — the git stub throws NotImplementedError('B2').
trpc/routers/feature.ts:192   // B2 behavior — the git stub throws; the success path (set phase shipped) is
                              // wired now so B2 only fills in `mergeFeature`.
```

`mergeFeature` has been filled in for a long time; the comment reads as if the merge path were
still a placeholder, which actively misleads anyone auditing the router's inline logic (see D1).

**`over-export:util-resolve-executable`** — kind: violation — confidence: high — effort S.
`BIN_OVERRIDE_ENV` (`util/resolve-executable.ts:56`) and `ResolveExecutableOptions` (line 16)
have zero references outside their own file (verified repo-wide, tests included). Not dead —
used internally at lines 113 and 180 — but the `export` keyword is unearned. Same class of
finding as the other over-exports collected in H4.

## C. Redundancy & repeated logic

**`redundant:router-entity-lookup`** — kind: judgement call — confidence: high — effort M, risk low.
The "resolve an id to a row, throw if absent" preamble is re-typed in the routers rather than
living in a tRPC middleware or a reusable procedure builder:

```
trpc/routers/docs.ts:10       const feature = getFeatureRow(ctx, input.featureId)
trpc/routers/feature.ts:172   const feature = getFeatureRow(ctx, input.featureId)
trpc/routers/feature.ts:188   const feature = getFeatureRow(ctx, input.featureId)
trpc/routers/feature.ts:197   const feature = getFeatureRow(ctx, input.featureId)
trpc/routers/project.ts:38    git.listBranches(requireProjectById(ctx, input.projectId))
trpc/routers/project.ts:105   prepView(ctx, requireProjectById(ctx, input.projectId))
trpc/routers/project.ts:116   git.dryRunDrive(ctx, requireProjectById(ctx, input.projectId), 'stop')
```

Plus the `getFeatureRow` → `projectForFeature` pair repeated three times
(`feature.ts:172-173`, `188-189`, `197-198`). Suggested module: a `featureProcedure` /
`projectProcedure` built on `publicProcedure.use(...)` that parses `{ featureId }` /
`{ projectId }` and puts the resolved row on the context. Two-plus callers each → real seam.

**`redundant:id-input-schema`** — kind: judgement call — confidence: high — effort S, risk low.
`z.object({ featureId: z.string() })` is spelled out ~14 times, `{ projectId: z.string() }`
~9 times, `{ ticketId: z.string() }` 4 times, `{ sessionId: z.string() }` 2 times, across
`feature.ts`, `project.ts`, `docs.ts`, `events.ts`, `run.ts`, `ticket.ts`, `test-notes.ts`.
Core already owns the schema vocabulary (`ProjectName` is imported from `@runcastle/core` at
`project.ts:2`), so the natural home is core: `FeatureId`, `ProjectId`, `TicketId` schemas.
See E1 — the duplication and the missing `.min(1)` are the same defect.

## D. Inconsistencies & structural smells

**D1. `misplaced-logic:trpc-router`** — kind: violation — confidence: high — effort M, risk medium.
The house shape is "a resolver is a one-liner over a service call" (`trpc/context.ts:6-7` says so
explicitly). **Three procedures break it and hold real orchestration**, and they are the three
most consequential ones on the wire:

`feature.merge` — `trpc/routers/feature.ts:194-220`:
```ts
const feature = getFeatureRow(ctx, input.featureId)
const project = projectForFeature(ctx, feature)
if (git.activeTestDriveFeatureId() === feature.id) {
  await git.testDrive(ctx, project, feature, 'stop')
}
const res = await git.mergeFeature(project, feature)
if (res.ok) {
  setPhase(ctx, input.featureId, 'shipped', 'feature.shipped', `merged to ${res.target}`)
  setFeatureStatus(ctx, input.featureId, 'shipped')
} else {
  emit(ctx, input.featureId, { type: 'merge.conflict', … })
}
```
This is the ship transaction — stop the drive, merge, flip phase, flip status, emit — and it
exists **only** behind HTTP. There is no `features.shipFeature()`, so the MCP server, the burner
workflow, and any future caller cannot ship a feature; only the browser can. It is also the one
place in the wire layer that emits an event directly (`emit` imported at `feature.ts:11`),
against the house rule that services emit.

`ticket.stop` — `trpc/routers/ticket.ts:34-46`: branches over `stopTicketRun` → `getTicket` →
`hasActiveRun` → `sweepOrphanedBurning` and synthesises a `{ stopped, swept }` result.

`setup.startTerminal` — `trpc/routers/setup.ts:57-85`: eight statements of orchestration
(resolve runtime → resolve image → resolve sandcastle bin → build spec → mint id → scaffold the
sandbox build context → resolve the spawn target → create the PTY).

Three instances is a pattern, not an accident. Extraction target in G1.

**D2. `latent-bug:merge-not-atomic`** — kind: violation — confidence: high — effort S, risk low.
`feature.ts:207-208` performs two independent writes with no transaction:
```ts
setPhase(ctx, input.featureId, 'shipped', 'feature.shipped', `merged to ${res.target}`)
setFeatureStatus(ctx, input.featureId, 'shipped')
```
A failure between them leaves `phase = 'shipped'` with a non-shipped `status` — after a real
`git merge` has already landed, so it is not re-runnable. The transaction affordance exists on
the `Db` type and is demonstrably usable (`db/migrate.ts:55` wraps each migration file), so this
is a discipline gap, not a driver limitation. See H1.

**D3. `inconsistent:input-validation-strictness`** — kind: violation — confidence: high — effort S.
Entity ids are validated as bare `z.string()` — the empty string passes and reaches the db —
while free-text fields in the *same object literal* get `.min(1)`:
```
feature.ts:131-133   { featureId: z.string(), gate: gateId, reason: z.string().min(1) }
feature.ts:165       { featureId: z.string(), model: z.string().min(1).optional() }
test-notes.ts:29     { featureId: z.string(), text: z.string().min(1) }
project.ts:41        { repoPath: z.string().min(1) }        ← path gets .min(1)
project.ts:45        { projectId: z.string() }              ← id does not
```
There is no principled reason for the split; it reads as whichever field the author was thinking
about. Same defect as C2 — fixed once by branded id schemas in core.

**D4. `inconsistent:core-schema-adoption`** — kind: judgement call — confidence: medium — effort S, risk low.
Some procedures reuse core's zod vocabulary, adjacent ones hand-roll the equivalent:
```
project.ts:49    name: ProjectName                              (core schema)
settings.ts:18   .input(SettingsUpdateInput)                    (core schema)
feature.ts:63    kind: SessionKind                              (core schema)
feature.ts:18    const gateId = z.enum(['G1','G2','G3','G4','G5'])   ← redeclared locally
feature.ts:25    title: z.string().min(1)                       ← no core FeatureTitle
```
`gateId` in particular duplicates a domain enum that core owns the pipeline for; a sixth gate
means editing `feature.ts` as well as core.

**D5. `stateful-singleton:active-test-drive`** — kind: judgement call — confidence: medium — effort M, risk medium.
`feature.driveInfo` (`feature.ts:179`) and the merge guard (`feature.ts:202`) read
`git.activeDriveInfo()` / `git.activeTestDriveFeatureId()` — module-global in-process state, not
db rows. Two consequences: only one test drive can exist server-wide, and a server restart
forgets a drive that is still holding the main checkout on a feature branch, so the merge guard
silently stops guarding. (`services/git.ts` is the git leaf's scope; flagged here because the
wire layer is where the state is read.)

**D6. `anemic-layer:repo-service`** — kind: judgement call — confidence: medium — effort M, risk medium.
`services/repo.ts` is a row-accessor grab-bag (18 exports, 2 emit sites) that routers import from
directly, bypassing the domain services: `getFeatureRow`, `projectForFeature`, `setPhase`,
`setFeatureStatus` (`feature.ts:15`), `requireProjectById` (`project.ts:9`), `hasActiveRun`
(`ticket.ts:3`), `getRunRow` (`run.ts:3`). `CLAUDE.md` assigns phase transitions to
`services/features.ts`, but the phase writer `setPhase` lives in `repo.ts` and is called from the
router — so the state machine's write path has no single owner.

**D7. `silent-noop:run-cancel`** — kind: judgement call — confidence: high — effort S, risk low.
```
run.ts:24-29   .mutation(({ input }) => { cancelRun(input.runId); return { ok: true } })
workflows/runner.ts:178   export function cancelRun(runId: string): void { controllers.get(runId)?.abort() }
```
`{ ok: true }` is returned unconditionally, including for an unknown or already-finished run id.
The UI cannot distinguish "cancelled" from "there was nothing to cancel", and no event is emitted
at the cancel point.

**D8. `doc-drift:spec-trpc-map`** — kind: violation — confidence: high — effort M (doc only), risk low.
`docs/SPEC.md §4` is headed "tRPC procedure map (pin — apps/web builds against exactly this)" and
`CLAUDE.md` says "names in the spec are law". It documents **18** procedures; the code exposes
**59**. Concretely:
- Documented but **absent from the code**: `project.get()`, `project.init({ repoPath })`.
  The code has `project.list`, `project.open`, `project.close`, `project.rename` instead.
- Signature drift: `feature.create` is specced as `{ title, oneLiner, size, baseBranch? }` but is
  `{ projectId, title, oneLiner, baseBranch? }` (`feature.ts:22-29`) — `size` is gone, `projectId`
  added. `feature.list()` is specced with no input but takes `{ projectId }` (`feature.ts:48`).
  `feature.burn` also takes `model` (`feature.ts:165`). `feature.merge` returns
  `{ ok, conflict, base, files }`, specced as `{ ok, conflict? }` (`feature.ts:219`).
- Undocumented entirely (41): the whole `notes` (6), `setup` (5), `system` (2) routers;
  `feature.quickChange / workWaypoint / converge / rethink / endSession / undoGateOverride /
  archive / unarchive / delete / driveInfo / commitCount`; `project.roots / browse / talkToPrep /
  prepSession / talkToProject / projectSession / dryRunStop`; `run.agentTranscript / run.cancel`;
  `events.listByProject`; the four `ticket.*`.

## E. Wrong-tool & weak typing

**E1. `weak-typing:db-client-cast`** — kind: violation — confidence: high — effort M, risk medium.
```
db/client.ts:19   return drizzle({ client: sqlite, schema }) as unknown as Db
```
A double cast (`as unknown as`) on the single most load-bearing seam in the server — it silences
whatever real mismatch exists between the bun-sqlite handle and the driver-agnostic `Db` alias.
`db/types.ts:5-14` explains why `Db` is driver-agnostic but never explains the cast, so the house
rule ("no `any` unless quarantined with a comment") is only half honoured. This is the **only**
unchecked cast in the entire audited service/wire/db scope — worth either fixing or documenting
precisely, because it is also the thing that lets production (bun:sqlite) and tests (sql.js)
diverge unnoticed.

**E2. `weak-typing:migration-row-cast`** — kind: violation — confidence: high — effort S, risk low.
```
db/migrate.ts:40   const appliedRows = db.all(sql.raw('SELECT name FROM __migrations')) as { name: string }[]
```
Raw SQL result asserted into a shape with no runtime check. Low blast radius (the table is ours),
but it is the pattern the house rule warns about.

**E3. `unguarded-boot:migrations`** — kind: judgement call — confidence: medium — effort S, risk low.
`runMigrations(db)` (`index.ts:80`) and `readdirSync(dir)` (`migrate.ts:43`) are unguarded: a
missing/unreadable migrations dir (the published package points `RUNCASTLE_MIGRATIONS_DIR` at a
vendored copy, `migrate.ts:20-25`) or a bad statement aborts boot with a raw stack trace rather
than the "your install is broken, run X" message this failure mode deserves.

**E4. `missing:global-error-handling`** — kind: judgement call — confidence: medium — effort S, risk low.
`index.ts` registers `SIGINT`/`SIGTERM` (lines 133-134) but no `unhandledRejection` /
`uncaughtException` handler, in a server whose whole job is supervising long-lived background
work (burn runs, PTYs, dry-run drives) via floating promises. A rejected background promise takes
the process down with no timeline event and no PTY cleanup.

**E5. `incomplete-shutdown`** — kind: judgement call — confidence: medium — effort S, risk low.
```
index.ts:128-132   const shutdown = (): void => { ptyRegistry().killAll(); server.stop(); process.exit(0) }
```
`process.exit(0)` fires immediately: in-flight requests are cut, and the sqlite handle is never
closed, so a WAL checkpoint is left to crash recovery. `server.stop()` is not awaited.

**E6. `resolve-executable:dir-vs-file`** — kind: judgement call — confidence: medium — effort S, risk low.
`util/resolve-executable.ts:220` accepts any `exists(candidate)` hit, and `existsSync` is true for
directories — a directory named `docker` (or `claude`) on PATH resolves as the executable. Cheap
fix (`statSync().isFile()`), and the injected `exists` predicate keeps it testable.

**E7. `env-passthrough:setup-terminal`** — kind: judgement call — confidence: low — effort S, risk low.
`trpc/routers/setup.ts:82` spawns the user-visible embedded terminal with `env: process.env` —
the whole server environment, which by design includes the OAuth token loaded from the data-dir
env file (credential type: Claude OAuth token; captured by `setup.afkToken`, `setup.ts:47`). For a
localhost dev tool this is probably intended, but it is an unannotated widening and worth an
explicit decision. No secret values are reproduced here.

## F. Shallow modules / deletion-test candidates

**F1. `shallow:config-module`** — kind: judgement call — confidence: medium — effort S, risk low.
```
config.ts:13   export { loadConfig }
config.ts:14   export type { RuncastleConfig }
```
Half of `src/config.ts` is a bare re-export of core. Deletion test on the re-export alone: remove
it and callers import `loadConfig` from `@runcastle/core/config-load` directly (as `config.ts`
itself does) — nothing reappears, so that half is a pass-through. `ensureDataDir` (lines 21-27)
genuinely earns its keep (it is the one side effect core deliberately refuses). The module is
worth keeping *for `ensureDataDir`*; the re-export is indirection that only makes "where does
config come from" a two-hop question.

**F2. `shallow:router-passthroughs`** — NOT a finding, recorded to stop a sibling re-raising it.
`events.ts`, `docs.ts`, `system.ts`, `settings.ts` are thin one-liner routers, but that is the
*correct* shape here — they are the transport adapter, and the deletion test fails (delete them
and the wire contract vanishes). Only D1's three fat procedures deviate.

## G. Deepening / extraction opportunities (ranked within this scope)

**G1. Extract the three router-resident use-cases into services.** (value high, confidence high,
effort M, blast radius: 3 routers + 2 services)
`feature.merge` → `services/features.shipFeature(ctx, featureId)`; `ticket.stop` →
`services/tickets.stopOrSweep(ctx, ticketId)`; `setup.startTerminal` →
`services/setup.startSetupTerminal(ctx, kind)`. Locality: the ship sequence (stop drive → merge →
phase → status → emit) becomes one readable transaction in one file instead of an HTTP handler.
Leverage: MCP tools and the burner workflow gain the ability to ship/stop, which they structurally
cannot have today; the merge's two writes get a transaction (D2) in the same move; the wire layer
returns to one shape.

**G2. A `featureProcedure` / `projectProcedure` middleware.** (value medium-high, confidence high,
effort M, blast radius: 7 routers)
Folds C1 (repeated lookup) and C2/D3 (repeated, inconsistently-strict id schemas) into one place:
parse the branded id, resolve the row, throw `NotFoundError` once, expose `ctx.feature` /
`ctx.project`. Seven call sites → a real seam by a wide margin.

**G3. Branded id schemas in `@runcastle/core`.** (value medium, confidence high, effort S, blast
radius: all routers + MCP input schemas)
`FeatureId`, `ProjectId`, `TicketId`, `RunId`, `SessionId` as `z.string().min(1).brand<…>()`.
Kills the empty-string hole (D3), stops `z.object({ featureId: z.string() })` being retyped 14
times, and makes `setPhase(ctx, featureId, …)`-style positional-string calls type-checkable.
Prerequisite for H2.

**G4. Move `gateId` into core.** (value low, confidence high, effort S, risk low)
`feature.ts:18` redeclares the gate enum that core's pipeline owns.

**G5. Wrap boot in a failure story.** (value medium, confidence medium, effort S)
try/catch around `runMigrations` + an `unhandledRejection` handler (E3, E4) — the difference
between "runcastle won't start" and "runcastle won't start *because* the vendored migrations dir
is missing; reinstall".

## Counter-example worth preserving

`util/resolve-executable.ts` is the model this scope should be measured against: one module owns
PATHEXT scanning, the `RUNCASTLE_*_BIN` override table, the well-known-install-dir recovery scan,
the `.cmd`/`.ps1` interpreter selection, and the human-readable failure explanation — each with a
comment recording the incident that motivated it (lines 35-43, 46-55, 61-75, 126-141, 165-174).
Three former copies of the `.cmd`/`.bat` branch collapsed into `spawnTargetFor`. The extractions
proposed in G1-G3 are asking for the same treatment of the wire layer.

## H. Cross-cutting candidates to pass UP

See the consolidated `server-brain.md` section H — this scope contributes
`missing:transaction-boundaries`, `stringly-typed:entity-ids`, `misplaced-logic:trpc-router`,
`dead-code:not-implemented-error`, `doc-drift:spec-vs-code`, and `over-export:server-modules`.
