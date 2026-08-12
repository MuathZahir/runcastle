# Audit report — event plumbing + platform/config services

Leaf agent scope: `packages/server/src/services/{events,bus,agent-stream,projects,settings,setup,update-check,knowledge,feature-docs,fsbrowse}.ts`.
Supporting reads (contracts only, not audited): `db/schema.ts`, `errors.ts`, `trpc/routers/*`, `routes/stream.ts`, `packages/core/src/{schemas,db-schema}.ts`, `apps/web/src/lib/{live,events,notifications,use-notifications}.ts`, `packages/server/test/*`.

Verification method for every dead-code claim: repo-wide `grep` across `packages/**`, `apps/web/**`, `scripts/**`, `packages/server/test/**` (node_modules/dist excluded). Where the search is the whole evidence, the command is named in the finding.

---

## A. Flow map

### A.1 Write path — the event pipeline (the backbone every service hangs off)

```
any mutating service fn
  ├─ services/projects.ts:62,93,111,132,143      emitProject(ctx, projectId, …)
  ├─ services/settings.ts:431,454,470,522        emitProject(ctx, projectId | 'global', …)
  ├─ services/knowledge.ts:69                    emit(ctx, featureId, …)
  ├─ pty/dev-pane.ts:107,136 · services/git.ts:1865…1929   emitScoped(ctx, scope, …)
  └─ launcher/*.ts · routes/hooks.ts · mcp/server.ts       emitForSession(ctx, session, …)
        │
        ▼  (all four collapse here)
services/events.ts:75  emit()          → projectIdForFeature() [SELECT features.project_id]  ── throws NotFoundError
services/events.ts:80  emitProject()   ─┐
services/events.ts:92  emitScoped()    ─┼─→ events.ts:117 insertEvent()
services/events.ts:111 emitForSession()─┘        │
                                                 ├─ events.ts:130  lapForFeature() [2nd SELECT features.lap]
                                                 ├─ INSERT INTO events … RETURNING            (db-schema.ts:254)
                                                 ├─ events.ts:140  rowToEvent()  ← DROPS `lap`
                                                 └─ events.ts:144  publishLive({kind:'event', projectId, featureId, eventId})
                                                                        │
                                                                        ▼
                                                        services/bus.ts:55 publishLive → Set<Subscriber>
                                                                        │
                                                              (exactly ONE subscriber)
                                                                        ▼
                                                        routes/stream.ts:50 subscribeLive
                                                        → coalesce 120 ms (stream.ts:28,38)
                                                        → SSE `event: live` (stream.ts:84)
```

Parallel, non-DB write path:

```
workflows/ticket-burner.ts → services/agent-stream.ts:58/64/86
  beginTranscript / appendTranscript / endTranscript
      ├─ module-level Map<ticketId, Transcript>  (agent-stream.ts:55) — ephemeral, NOT in the db
      └─ publishLive({kind:'transcript', ticketId})  (agent-stream.ts:60,82,89)
                    │
                    ▼  same bus, same single subscriber
          routes/stream.ts (dedupeKey `transcript:<id>`, stream.ts:39)
```

### A.2 Read paths (three, all converging on the same UI)

```
1. POLL (durable)   apps/web/src/lib/events.ts:16   trpc.events.list
                    → trpc/routers/events.ts:9      listAfter(ctx, featureId, afterId)
                    → services/events.ts:154        SELECT … WHERE feature_id=? AND id>? ORDER BY id ASC

   apps/web/src/lib/use-notifications.ts:81         trpc.events.listByProject
                    → trpc/routers/events.ts:15     listByProject(ctx, projectId, afterId)
                    → services/events.ts:213        SELECT … WHERE project_id=? AND id>? ORDER BY id ASC

2. PUSH (hint only) apps/web/src/lib/live.ts:137    new EventSource('/api/stream')
                    → live.ts:148 'live' handler    → u.events.invalidate() + 8 more invalidations
                    (a signal NEVER carries data — it re-triggers path 1)

3. TRANSCRIPT       apps/web/src/components/AgentTranscript.tsx:100  trpc.run.agentTranscript (1 s poll)
                    → services/agent-stream.ts:93   readTranscript(ticketId, after)  — in-memory only
```

Two further *derived* readers of the events table, outside the poll contract:

```
services/events.ts:172  latestEventTs(featureId, type)      ← mcp/server.ts:632  (`feature.shipped` date)
services/events.ts:192  latestTsByFeature(projectId)        ← services/features.ts:342 (sidebar activity stamp)
services/prep.ts:84     ad-hoc SELECT on events.type/data   ← preparedAt() — bypasses services/events.ts entirely
```

### A.3 Platform/config flows

```
project.open      trpc/routers/project.ts:42  → services/projects.ts:73 openProject
                     → fsbrowse.ts:78 expandPath → projects.ts:79 assertRepoTolerant (git.assertRepo)
                     → projects.ts:80 detectMainBranchTolerant → DB upsert → emitProject ×1–2

project.browse    trpc/routers/project.ts:32  → fsbrowse.ts:169 browseDir → readdirSync (NO event, NO root confinement)
project.roots     trpc/routers/project.ts:23  → fsbrowse.ts:104 listRoots (probes C:…Z: / `/`)

settings.get      trpc/routers/settings.ts:15 → settings.ts:372 getSettings → readRawConfig (JSON.parse) + projects row
settings.update   trpc/routers/settings.ts:19 → settings.ts:391 updateSettings
                     → project column UPDATE + findings.recordHuman + emitProject(project.id)
                     → OR writeGlobal (read-modify-write ~/.runcastle/config.json) + in-place ctx.config mutation
                       + emitProject('global')            ← sentinel project id, see D.2

setup.*           trpc/routers/setup.ts:29–85 → services/setup.ts (12 exports, ZERO emits)
                     gitIdentity → exec git config --global      (mutates the HOST, no event)
                     afkToken    → upsertEnvVar → ~/.runcastle/.env (writes a CREDENTIAL, no event)
                     startTerminal → prepareSandboxBuildContext → mkdir + copy files (no event)

system.checkUpdate trpc/routers/system.ts:12 → update-check.ts:115 getUpdateInfo (module-level memo)
                     → fetch https://registry.npmjs.org/runcastle/latest → compareSemver

docs.read         trpc/routers/docs.ts:11 → knowledge.ts:196 readDoc
                     → feature-docs.ts:16 featureDocsDir (worktree ?? repoPath) → traversal guard → readFileSync
```

---

## B. Dead code

### B.1 `dead:b2-tolerance` — kind: **violation** — confidence: **high**

`NotImplementedError` is **constructed nowhere in the repo**, so every `isNotImplemented(e)` branch is unreachable.

Verification (`grep -rn "new NotImplementedError" packages apps scripts --include=*.ts --include=*.tsx`, node_modules excluded) → **zero hits**. The only mentions of the constructor form are prose: `docs/SPEC.md:110` (`throw new NotImplementedError('B1')`) and comments at `trpc/routers/feature.ts:55,168`.

In my scope this kills the entire "B2 tolerance" section:

```ts
// projects.ts:166-179
// --- B2 tolerance -----------------------------------------------------------
async function assertRepoTolerant(ctx: AppCtx, repoPath: string): Promise<void> {
  void ctx                                   // ← no-op, the param is unused
  try { await git.assertRepo(repoPath) }
  catch (e) {
    if (!isNotImplemented(e)) throw e        // ← always true → always rethrows
    if (!existsSync(join(repoPath, '.git'))) { … }   // ← unreachable
  }
}
```

- `projects.ts:168-179` `assertRepoTolerant` — the whole try/catch degrades to `await git.assertRepo(repoPath)`; `ctx` is unused (`void ctx` at :169 exists only to silence that); the `.git` existSync fallback at :174-177 can never run.
- `projects.ts:181-188` `detectMainBranchTolerant` — degrades to `return await git.detectMainBranch(repoPath)`; the `ctx.config.mainBranch` fallback at :186 can never run.
- `projects.ts:1` `import { existsSync } from 'node:fs'` and `projects.ts:2` `join` are then imported solely for the unreachable branch.
- `projects.ts:8` `isNotImplemented` import becomes unused.

Blast radius beyond my scope (same root cause, sibling-owned — see H.1): `features.ts:311`, `launcher/launcher.ts:339`, `mcp/server.ts:344`, `errors.ts:48-50` + `errors.ts:60-61`.

### B.2 `dead-column:events-lap` — kind: **violation** — confidence: **high**

`events.lap` is written on every insert and **read by nothing**.

```ts
// events.ts:128-130
// Feature-scoped events carry their feature's lap; project-level ones
// (open/close/rename) have no feature and sit on lap 1.
lap: featureId ? lapForFeature(ctx, featureId) : 1,
```

Verification: `grep -rn "from(events)" packages/server/src` → 5 call sites (`events.ts:157,175,195,216`, `prep.ts:86`); **none selects `lap`**. `rowToEvent` (`events.ts:30-42`) does not copy it. `EventRow` in `packages/core/src/schemas.ts:462-473` has **no `lap` field**, so the column cannot cross the wire even if a caller wanted it. `apps/web` reads `feature.lap`, never an event's.

Cost: a second `SELECT` against `features` on **every event insert** (`events.ts:65-72`) purely to populate a column nobody reads. The stated purpose ("so the timeline can be grouped into laps without a join", `db-schema.ts:263-268`) is unimplemented — the UI groups nothing by event lap.

Note: `packages/server/test/lap-stamping.test.ts` (230 lines) exercises this write-only column, which is why it does not read as dead to a reader of the tests.

### B.3 `unreachable:lap-fallback` — kind: **violation** — confidence: **high**

The `?? 1` fallback in `lapForFeature` cannot fire, and its 10-line justifying comment is wrong.

```ts
// events.ts:55-72
 * Deliberately total: `insertEvent` runs on paths where a throw is not a failed
 * request but a server that will not start … A missing feature row there means
 * the lap is unknowable, not that the event should be lost …
function lapForFeature(ctx: AppCtx, featureId: string): number {
  …
  return row?.lap ?? 1
}
```

`insertEvent` is only ever reached with a non-null `featureId` via `emit()` (`events.ts:75-77`), which calls `projectIdForFeature()` **first** — and that already throws `NotFoundError` for a missing feature (`events.ts:51`). Both queries are synchronous bun-sqlite/sql.js calls on one connection, so no row can vanish between them. The "drops rather than throws" posture the comment claims for this path is therefore only true of `emitForSession` (`events.ts:114`), not of `emit`. The doc comment actively misleads a reader into believing feature-scoped emits are throw-safe during boot reconciliation — they are not.

### B.4 `over-export:knowledge-constants` — kind: **violation** — confidence: **high** — effort S / risk low

Zero references outside `knowledge.ts` (repo-wide grep, incl. tests and `apps/web`):

- `knowledge.ts:121` `export const CHARTER_FILE = 'CONTEXT.md'` — used only at `:141`.
- `knowledge.ts:124` `export const ADR_DIR_REL = 'docs/adr'` — used only at `:165,178`.
- `knowledge.ts:130` `export const SUPERSEDED_RE = /superseded by ADR-\d+/i` — used only at `:177`.

### B.5 `over-export:update-check-constants` — kind: **violation** — confidence: **high** — effort S / risk low

- `update-check.ts:15` `export const PACKAGE_NAME = 'runcastle'` — used only at `:16,93`.
- `update-check.ts:16` `export const UPDATE_COMMAND` — used only at `:74,102`.

The one thing that *should* be shared — the update command string the UI shows — travels over the wire in `UpdateInfo.command` instead, so neither export has an out-of-file consumer.

### B.6 `over-export:TranscriptRead` — kind: **judgement call** (NOT a finding) — confidence: **high**

`agent-stream.ts:32` `export interface TranscriptRead` has zero out-of-file references, but it is the declared return type of the exported `readTranscript` (`agent-stream.ts:93`). Exporting a public function's return type is required for declaration emit and is correct. **Recommend no action** — flagging it here so the parent does not double-count it against B.4/B.5.

---

## C. Redundancy & repeated logic

### C.1 `redundant:feature-row-lookup-per-emit` — kind: **violation** — confidence: **high** — effort S / risk low

Every feature-scoped emit runs **two** single-column `SELECT`s against the same `features` row:

```ts
// events.ts:45-53
function projectIdForFeature(ctx, featureId) {
  const row = ctx.db.select({ projectId: features.projectId }).from(features).where(eq(features.id, featureId)).get()
// events.ts:65-72
function lapForFeature(ctx, featureId) {
  const row = ctx.db.select({ lap: features.lap }).from(features).where(eq(features.id, featureId)).get()
```

One `select({ projectId, lap })` gives both. Since B.2 shows `lap` is unread, the honest fix is to delete the second query entirely; the intermediate fix is to merge them. Doubles the query count of the single hottest write path in the server (94+ event types, several per user action).

### C.2 `redundant:config-read-modify-write` — kind: **violation** — confidence: **high** — effort S / risk low

`settings.ts` implements the same non-atomic read-merge-mkdir-write twice:

```ts
// settings.ts:479-484
function writeGlobal(configFile, configKey, value) {
  const raw = readRawConfig(configFile); raw[configKey] = value
  mkdirSync(dirname(configFile), { recursive: true })
  writeFileSync(configFile, `${JSON.stringify(raw, null, 2)}\n`)
}
// settings.ts:531-539
function writeStepModel(configFile, step, value) {
  const raw = readRawConfig(configFile); const stepModels = { ...rawStepModels(raw) }
  … raw.stepModels = stepModels
  mkdirSync(dirname(configFile), { recursive: true })
  writeFileSync(configFile, `${JSON.stringify(raw, null, 2)}\n`)
}
```

Suggested single module: `mutateConfigFile(configFile, (raw) => void)` — one place for the read, the mkdir, the serialize, and (see E.4) the atomic temp-file + rename that neither currently has.

### C.3 `redundant:settings-project-write` — kind: **judgement call** — confidence: **high** — effort S / risk low

`updateSettings` writes a project override twice, in two near-identical 14-line blocks that differ only in the value:

- `settings.ts:420-437` (clear: `set({[col]: null})` → `recordHuman(…, null)` → `emitProject` → `return field(...)`)
- `settings.ts:445-460` (set: `set({[col]: String(value)})` → `recordHuman(…, String(value))` → `emitProject` → `return field(...)`)

One `writeProjectOverride(ctx, project, desc, value: string | null)` collapses both; the message string is the only genuine difference.

### C.4 `redundant:map-sections` — kind: **violation** — confidence: **high** — effort S / risk low

The four `map.md` headings are declared twice, in two packages, with a comment that admits it:

```ts
// packages/server/src/services/knowledge.ts:78-83
export const MAP_SECTIONS = ['Destination','Notes','Not yet specified','Out of scope'] as const
// apps/web/src/components/bodies/GrillBody.tsx:173-177
 * sync with the server's `MAP_SECTIONS` scaffold; duplicated here rather than
const MAP_SECTIONS = ['Destination', 'Notes', 'Not yet specified', 'Out of scope'] as const
```

The repo already has the right home for this: `@runcastle/core` is the IO-free contract package both sides import. `MAP_SECTIONS` is pure data (`docs/SPEC.md §13.4` / ADR-0001 calls it a contract), so keeping two copies is a doc-drift trap by construction — a renamed heading silently desyncs the web parser at `GrillBody.tsx:263` from the server scaffold at `knowledge.ts:110`.

### C.5 `redundant:path-existence-probe` — kind: **judgement call** — confidence: **medium** — effort S / risk low

Three independent "does this look like a git repo / does this path exist" probes in my scope alone:

- `fsbrowse.ts:88-95` `looksLikeRepo` → `existsSync(join(dir,'.git'))` (try/catch-wrapped)
- `projects.ts:174` `existsSync(join(repoPath, '.git'))` (the now-dead B.1 fallback — same predicate, no try/catch)
- `feature-docs.ts:19` `existsSync(worktree) ? worktree : project.repoPath`

`looksLikeRepo` already is the shared module; `projects.ts` should have called it. (Moot once B.1 is deleted — noting it because the parent will likely see the same predicate re-implemented in `services/git.ts`.)

---

## D. Inconsistencies & structural smells

### D.1 `overlapping:event-delivery` — kind: **judgement call** — confidence: **high** — effort M / risk medium

**Three delivery mechanisms, precisely named, with their subscribers:**

| # | Mechanism | Storage | Publisher | Subscriber(s) |
|---|---|---|---|---|
| 1 | Durable event table | sqlite `events` | `events.ts:123` `insertEvent` | `apps/web/src/lib/events.ts:16` (`useEventLog`, per-feature cursor), `apps/web/src/lib/use-notifications.ts:81` (per-project cursor), `mcp/server.ts:632`, `features.ts:342`, `prep.ts:86` |
| 2 | In-process live bus | `Set<Subscriber>` (`bus.ts:40`) | `events.ts:144` + `agent-stream.ts:60,82,89` | **exactly one**: `routes/stream.ts:50` |
| 3 | In-memory agent transcript | `Map<ticketId,…>` (`agent-stream.ts:55`) | `workflows/ticket-burner.ts` | `trpc run.agentTranscript` → `AgentTranscript.tsx:100` (1 s poll) |

**Verdict: the pipeline IS coherent, and the overlap is deliberate and documented.** `bus.ts:14-18` states signals are hints not data; `live.ts:16-19` states the same from the client side; `insertEvent` calling `publishLive` (`events.ts:144`) is the single fan-out point that makes "every mutation is live" true without any caller opting in. That is good design — one write, one signal, one re-read.

The genuine smells in it:

**(a) `bus.ts` has one subscriber, ever.** `subscribeLive` (`bus.ts:43`) is called once in `src/` (`stream.ts:50`) and three times in `test/live-stream.test.ts`. `LiveSignal`'s two variants are both consumed by the same `switch` at `stream.ts:39` and mirrored by hand in the client (`live.ts:23-25`). One adapter = a hypothetical seam by the briefing's own rule. It is still worth keeping (it decouples services from Hono, and `bus.ts` is 69 lines), but the parent should know the fan-out abstraction currently buys exactly one indirection.

**(b) The push path carries an event id it then throws away.** `publishLive` sends `eventId` (`events.ts:148`), `stream.ts:39` collapses **all** event signals onto the single dedupe key `'event'`, and `live.ts:160` ignores the payload entirely and calls `invalidateDbBacked()`. The `projectId`/`featureId`/`eventId` fields of `LiveSignal` (`bus.ts:26-30`) are therefore transported and never read — a hair short of dead, kept alive only by tests (`live-stream.test.ts:76`) and the "useful for debugging/ordering" comment at `bus.ts:29`.

**(c) Transcripts are a fourth data plane the durable path also duplicates.** The burner emits *both* the unthrottled in-memory chunks (`agent-stream.ts`) *and* coarse `burn.text` / `burn.tool` rows into the events table. Two representations of the same agent output with different retention (memory ring vs forever), different cursors (`i` vs `events.id`), different transports (poll vs poll), and no cross-check. Documented at `agent-stream.ts:1-17`, so not a violation — but it is the most likely place a reader will get "which one is the truth?" wrong.

### D.2 `orphan-events:global-settings` — kind: **violation** — confidence: **high** — effort S / risk low

Global settings writes emit into a **sentinel project id that no UI query ever asks for**, so they are write-only rows.

```ts
// settings.ts:42
const GLOBAL_EVENT_KEY = 'global'
// settings.ts:470-474  (and identically at :522-526)
emitProject(ctx, GLOBAL_EVENT_KEY, {
  type: 'settings.updated',
  message: `${desc.key} set to ${String(value)}`,
```

Verification: `grep -rn "'global'" packages/server/src apps/web/src` → the only consumer of the sentinel anywhere is the **test** (`packages/server/test/settings.test.ts:254`: `listByProject(ctx, 'global', 0)`). `apps/web` only ever calls `events.listByProject` with a real `projectId` (`use-notifications.ts:82`) and `events.list` with a `featureId` (`events.ts:17`). No feature list, no timeline, no notification path can ever surface a `projectId === 'global'` row.

Consequences: (i) the SPEC §12 rule is satisfied on paper while the user sees nothing when a machine-wide model/sandbox/concurrency change lands mid-session; (ii) `events.project_id` is `text NOT NULL` with **no foreign key** (`packages/core/src/db-schema.ts:259`), which is the only reason a non-existent project id inserts at all; (iii) the rows accumulate forever with no reader (compounds D.4). The test asserting the emit *exists* is exactly the test that hides that nothing reads it.

### D.3 `inconsistent:event-emission` — kind: **violation** (against the stated house rule) — confidence: **high**

House rule (`CLAUDE.md`, `docs/SPEC.md §12`, restated at `events.ts:9`): *"Every mutating service function emits an event."* Mutations in my scope with **no** emit:

| Mutation | file:line | What it changes | Event? |
|---|---|---|---|
| `writeGitIdentity` | `setup.ts:35-47` | `git config --global user.name/user.email` — **mutates the host machine** | none |
| `saveAfkToken` | `setup.ts:85-91` | writes an OAuth credential to `~/.runcastle/.env` | none |
| `scaffoldSandcastleConfig` | `setup.ts:252-260` | `mkdirSync` + copies template files into `<dataDir>/.sandcastle/` | none |
| `prepareSandboxBuildContext` | `setup.ts:269-274` | `mkdirSync` the sandbox build dir | none |
| `fileAfkTokenIo().write` | `setup.ts:336-339` | `writeFileSync` the env file | none |
| `scaffoldMapDoc` | `knowledge.ts:97-102` | writes `map.md` to the repo | none (sibling `scaffoldDocs` at `:69` **does** emit) |
| `updateSettings` global branch | `settings.ts:466-474` | writes `~/.runcastle/config.json` **and mutates `ctx.config` in place** | emits, but orphaned — see D.2 |

Counts: `setup.ts` = 12 exports / **0** emits (does not even import `events`). `feature-docs.ts` = 2 exports / 0 emits (pure path computation — correctly exempt). `fsbrowse.ts` = 8 exports / 0 emits (**read-only — correctly exempt**). `agent-stream.ts` = 6 exports / 0 emits (deliberate, `agent-stream.ts:8-13` — its own plane). `projects.ts` = 5 exports, 0 `emit` but 5 `emitProject` (**compliant**). `update-check.ts` = 5 exports / 0 emits (read-only + a process-local memo — correctly exempt).

The sharp one is `knowledge.ts`: `scaffoldDocs` emits `docs.scaffolded` (`:69-75`) but `scaffoldMapDoc` — called *independently* from `features.ts:773` on escalation — writes a file to the user's repo silently. Same module, same kind of write, opposite behaviour, no stated reason.

The second sharp one is `setup.ts`: it is the module that touches the **most consequential** state in the product (the host's global git identity, and a long-lived OAuth credential) and is the only service with zero timeline presence. When AFK later fails, the timeline cannot say when the token was last written.

### D.4 `unbounded:events-table` — kind: **violation** — confidence: **high** — effort M / risk low

The events table has **no retention policy and no index**.

- Pruning: `grep -rn "delete(events)" packages/server/src` → `features.ts:914` (feature deletion cascade) and `dev/state.ts:125,149` (a **dev-only** reset helper). `closeProject` (`projects.ts:124-137`) deliberately keeps rows. Nothing ages anything out. A burn emits `burn.text`/`burn.tool` per agent step, so the table grows at agent speed, forever.
- Indexes: `grep -rn "CREATE INDEX" packages/server/drizzle/*.sql` → **zero hits across all 10 migrations**. `db-schema.ts:254-273` declares no index either.

So every `listAfter` (`events.ts:154-161`) and `listByProject` (`events.ts:213-221`) is a **full table scan filtered in SQLite**, and `latestTsByFeature` (`events.ts:192-206`) is a full scan + group-by run on **every `feature.list`** (`features.ts:342`) — which the UI polls at 1.5 s whenever the SSE stream is down (`live.ts:66,89`). Minimum viable fix: `CREATE INDEX ON events(feature_id, id)` and `ON events(project_id, id)`; the cursor predicates are exactly those two prefixes.

**Cursor correctness itself is sound** and I could not break it: `id` is `AUTOINCREMENT` (`db-schema.ts:256`), inserts are synchronous on a single bun-sqlite connection, both list queries use `id > afterId ORDER BY id ASC`, and the client re-sorts and dedupes by id anyway (`apps/web/src/lib/events.ts:29-32`). No missed-event window between polls.

The **cursor divergence** the brief asks about is real but benign-by-design: `useEventLog` (per-feature, `events.ts:15`) and `useDesktopNotifications` (per-project, `use-notifications.ts:74,100`) hold independent cursors over the same id space, and every mounted `useEventLog` holds its *own* (documented at `apps/web/src/lib/events.ts:18-21`). The cost is N independent queries, which `useLivePoll` already mitigates by backing the timers off to 30 s while push is live (`live.ts:63,89`).

### D.5 `primitive-obsession:event-type` — kind: **judgement call** — confidence: **high** — effort M / risk medium

`type` is a bare `z.string()` (`packages/core/src/schemas.ts:469`) and `data` is `z.unknown()` (`:471`), against **94+ distinct string literals** emitted server-side (`grep -rhoE "type: '[a-z][a-zA-Z0-9._-]+'" packages/server/src | sort -u | wc -l` → 94, and that *undercounts* — phase-transition types like `burn.started` are passed positionally through `setPhase` at `features.ts:496,498` and never appear as a `type:` literal).

**Blast radius (what the missing union actually costs):**

1. **The compiler cannot connect producer to consumer.** `apps/web/src/lib/feature-ui.ts:529,533,580,600,750-752` and `components/bodies/ShippedBody.tsx:22-23` and `components/Workspace.tsx:667` compare `e.type` against hand-typed literals. A server-side rename is a **silent** UI regression: the string stops matching, the branch stops firing, `tsc` says nothing, and no test outside `apps/web/test/feature-ui.test.ts` (which uses its *own* hand-typed literals at `:630,655,663,753`) would catch it. This is textbook shotgun surgery with no compiler backstop.
2. **Near-miss families already exist in the emitted set**, which is what an unconstrained string always produces: `research.error` (`workflows/research.ts:95`) vs `research.failed` (`:125`); `ticket.retry` vs `ticket.retrying`; `ticket.stopped` vs `ticket.cancelled`; four `merge.conflict*` variants; `session.*` with 14 members. Nothing forces a new emitter to pick from the existing vocabulary, so the vocabulary grows sideways.
3. **`data: unknown` is re-narrowed by hand at every consumer**, each inventing its own guard: `prep.ts:97` `(end.data as { sessionId?: string } | null)?.sessionId`; `apps/web/src/lib/notifications.ts:74-79` `runFinishedData()`; `apps/web/test/feature-ui.test.ts:655` `{ from: 'review' }`. Three different shapes of guard for one field.
4. **The naming convention is unenforced**: `git.ts` emits bare `'branch'`, `'command'`, `'file'`, `'http'`, `'text'` alongside 89 dotted `namespace.verb` names. No schema, no lint, no test asserts the convention, so it is already broken.

Cheapest real fix that keeps the open set: keep the column `text`, but declare `export const EVENT_TYPES = [...] as const; export type EventType = typeof EVENT_TYPES[number]` in `@runcastle/core` and type `EmitInput.type` / `EventRow.type` as `EventType`. Producers and both consumers then share one list, and the 94 literals become compiler-checked on both sides of the wire at zero runtime cost. (This is the single highest-value change in my scope — see G.1.)

### D.6 `divergent-change:settings` — kind: **judgement call** — confidence: **medium** — effort M / risk medium

`settings.ts` (546 lines) is edited for at least five unrelated reasons: adding a field to `DESCRIPTORS` (:74-244), the legacy `smokeModel` fold (:260-270), the parallel `stepModels.*` code path (:285-295, :401-403, :495-528), the project-override column list (:45-56, :298-327 — a **third** hand-maintained copy of the same 10 column names, after `ProjectColumn` and the `DESCRIPTORS` `projectColumn` fields), and the findings/provenance coupling (:430, :453). The `stepModels.` prefix check at `:401` is an explicit admission that one field family does not fit the descriptor table — `updateStepModel` re-implements validate/write/refresh-in-place/emit/return in 34 lines that mirror `updateSettings`' own.

### D.7 `inconsistent:error-taxonomy` — kind: **judgement call** — confidence: **high** — effort S / risk low

Same condition, two error classes, two HTTP codes, across two files in this scope:

- `fsbrowse.ts:176` — `throw new InvalidInputError('path does not exist: …')` → HTTP 400 (`errors.ts:66`)
- `knowledge.ts:208` — `throw new NotFoundError('doc not found: …')` → HTTP 404 (`errors.ts:62`)

"The thing you named is not there" is a 404 in one service and a 400 in the other. `fsbrowse.ts:184,191` compound it: an `EACCES` on `readdirSync` is also reported as `InvalidInputError` (400 — "you sent bad input") when the input was fine and the *server* lacked permission.

---

## E. Wrong-tool & weak-typing findings

### E.1 `unvalidated-json:settings-config` — kind: **violation** — confidence: **high** — effort S / risk low

`readRawConfig` parses the config file with **no schema**, then hands the result out as `Record<string, unknown>`:

```ts
// settings.ts:261-270
const parsed: unknown = JSON.parse(readFileSync(configFile, 'utf8'))
if (typeof parsed !== 'object' || parsed === null) return {}
return foldLegacyModelConfig(parsed) as Record<string, unknown>
```

`RuncastleConfigSchema` exists and is imported in the same file (`settings.ts:12`, used at `:246` for defaults) — it is simply not applied to the file read. The consequence is real, not theoretical: `resolveField` at `settings.ts:358-360` returns `layers.fileRaw[desc.configKey]` **verbatim** as the field's value, so a hand-edited `config.json` containing `"burnConcurrency": "lots"` is served to the UI as a `SettingField` whose `value` violates the field's own `valueSchema`. The `catch { return {} }` at `:267` also swallows the difference between "no config" and "corrupt config" — a typo in the JSON silently reverts every global setting to defaults with no event and no log line.

### E.2 `unvalidated-json:sandcastle-manifest` — kind: **violation** — confidence: **high** — effort S / risk low

```ts
// setup.ts:177-180
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
  name?: string
  bin?: Record<string, string>
}
```

Unchecked cast on a `JSON.parse`. Mitigated by the `manifest.name === '@ai-hero/sandcastle' && manifest.bin?.sandcastle` guard at `:181` and the outer `catch { return null }` at `:190`, so severity is low — but a 3-line `z.object({name: z.string().optional(), bin: z.record(z.string()).optional()}).safeParse` is the house tool and is not used.

### E.3 `unsafe-cast:ctx-config-mutation` — kind: **violation** — confidence: **high** — effort S / risk medium

The shared, in-flight config object is mutated through a cast that erases its type:

```ts
// settings.ts:469
;(ctx.config as Record<string, unknown>)[desc.configKey] = value
// settings.ts:517-520
const stepModels = (ctx.config.stepModels ?? {}) as Record<string, string>
if (value === null) delete stepModels[modelStep]; else stepModels[modelStep] = value
;(ctx.config as Record<string, unknown>).stepModels = stepModels
```

Three casts on the object every session launch reads. `RuncastleConfig` is a zod-inferred type; the cast means a wrong `configKey`→`value` pairing (e.g. a string into `serverPort`) is a runtime problem only. Worse, `:517` takes a **live reference** to the nested `stepModels` object and mutates it in place before reassigning — a launch that captured `ctx.config` earlier (the "in-flight work keeps its snapshot" guarantee at `settings.ts:29-33`, tested at `settings.test.ts:130`) keeps its *top-level* snapshot but shares this nested object, so a `stepModels` write leaks into in-flight work. That guarantee holds for flat fields and silently does not hold for `stepModels`. There is no test for the nested case.

Related, lower severity: `settings.ts:422` and `:446` `input.projectId as string` — `toProject` (`:418`) already proves it is defined; a local `const projectId = input.projectId; if (projectId !== undefined && …)` removes both casts.

### E.4 `nonatomic-write:config-file` — kind: **violation** (latent bug) — confidence: **high** — effort S / risk low

```ts
// settings.ts:483 (and :538)
writeFileSync(configFile, `${JSON.stringify(raw, null, 2)}\n`)
```

Read-modify-write straight onto the live path, with no temp-file + `rename`, no lock, no fsync. Two failure modes:

1. **Lost update.** `updateSettings` is a synchronous tRPC mutation, but two settings writes from two browser tabs are two HTTP requests; a `readRawConfig` interleaved between another request's read and write loses the earlier key. Bun's request handling makes this narrow, not impossible — and the same file is also read fresh by `loadConfig()` on every run.
2. **Truncation.** A crash or full disk mid-`writeFileSync` leaves a partial JSON file; `readRawConfig`'s `catch { return {} }` (`settings.ts:267`) then reports **every global setting as its schema default** rather than surfacing the corruption. The user's machine-wide config silently evaporates and the UI shows a plausible-looking "default" for everything.

### E.5 `bespoke:semver` — kind: **judgement call** — confidence: **medium** — effort S / risk low

`update-check.ts:29-68` hand-rolls semver parse + precedence (~40 lines) including the prerelease rules. The comment at `:38-42` concedes it matches the spec "closely enough". It is well-tested (`test/update-check.test.ts:12-26`) and correctly handles the `0.2 < 0.10` trap, so this is defensible for a one-call-site "is there a newer stable?" check — flagged only because the taxonomy names hand-rolled date/version logic and the parent may find a second copy elsewhere (see H.5).

### E.6 `bespoke:dotenv-writer` — kind: **judgement call** — confidence: **medium** — effort S / risk low

`setup.ts:55-70` `upsertEnvVar` hand-parses dotenv with `content.replace(/\n$/,'').split('\n')` and `new RegExp('^(export\\s+)?' + key + '=')`. It handles the `export ` prefix but not quoted values, `\r\n` line endings (**relevant: this is a Windows-first product**, and a `.env` written by another tool with CRLF leaves `\r` on every preserved line), or comments. `saveAfkToken` guards the *value* against newlines (`setup.ts:88`) but nothing guards the file it merges into. Well-tested for the cases it handles (`test/setup.test.ts:71-93`).

### E.7 `unguarded:fetch-timeout` — kind: **violation** (latent bug) — confidence: **high** — effort S / risk low

```ts
// update-check.ts:93
const res = await fetchImpl(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`)
```

No `AbortSignal.timeout()`, no `signal`. The module doc promises *"a boot-time call can't wedge the server on a flaky network"* (`update-check.ts:79-81`) — `try/catch` delivers that for a *rejecting* fetch but not for a **hanging** one. A registry that accepts the connection and never responds leaves the `system.checkUpdate` query pending indefinitely; the memo at `:112-119` does not dedupe *in-flight* calls (only completed ones), so every page load and every tab starts another hung request. `AbortSignal.timeout(3000)` closes it in one line.

### E.8 `weak-typing:emit-data` — kind: **judgement call** — confidence: **high** — effort M / risk medium

`EmitInput.data?: unknown` (`events.ts:25`) / `EventRow.data: z.unknown()` (`schemas.ts:471`). Covered in D.5 point 3; listed here so the parent can key it as a typing finding as well as a structural one.

---

## F. Shallow modules / deletion-test candidates

### F.1 `shallow:feature-docs` — kind: **judgement call** — confidence: **medium** — effort S / risk low

`feature-docs.ts` is 26 lines, two functions, one of which is `join(featureDocsDir(...), fileName)`.

```ts
// feature-docs.ts:24-26
export function featureDocPath(project, feature, fileName) {
  return join(featureDocsDir(project, feature), fileName)
}
```

**Deletion test on `featureDocPath`: it fails** — inlining `join(featureDocsDir(…), name)` at its call sites is no worse. **Deletion test on `featureDocsDir`: it passes** — it hides the one non-obvious rule in the whole area (*prefer the talk worktree if it exists on disk, else the main checkout*), and that rule has 4+ callers across `knowledge.ts`, `gates.ts`, and `features.ts`. So the module earns its keep on one function out of two.

The real problem is that the rule it encapsulates is **stateful and re-evaluated per call**:

```ts
// feature-docs.ts:19-20
const base = existsSync(worktree) ? worktree : project.repoPath
```

`scaffoldDocs` (`knowledge.ts:38-45`) can write `brief.md` into `project.repoPath` *before* a session exists; the launcher then creates the worktree; every subsequent `listDocs`/`readDoc`/gate check resolves to the **worktree**, where that brief is absent unless git carried it. The interface advertises "where the docs live" while actually answering "where they live *right now*", and no caller can tell the two apart. That is an interface-honesty defect, not just shallowness — it belongs on the parent's latent-bug list (see H.4).

### F.2 `shallow:emitScoped` — kind: **judgement call** — confidence: **medium** — effort S / risk low

**The four-emitter question, judged.**

```ts
emit(ctx, featureId, e)                → insertEvent(ctx, projectIdForFeature(ctx, featureId), featureId, e)   // :75
emitProject(ctx, projectId, e)         → insertEvent(ctx, projectId, null, e)                                   // :80
emitScoped(ctx, scope, e)              → 'featureId' in scope ? emit(…) : emitProject(…)                        // :92
emitForSession(ctx, session, e)        → session.featureId ? emit(…) : session.projectId ? emitProject(…) : null // :111
```

Verdict: **two of the four are real depth, two are a leak.**

- `emit` and `emitProject` are the genuine primitives — they are the two shapes the table supports (feature-scoped vs project-level), and `emit`'s depth is real: it derives `projectId` from the feature so no caller has to know events carry one.
- `emitForSession` (`:111`) is **real depth and well-placed**. `SessionRow` has both columns nullable; 12 call sites across 6 files (`launcher.ts` ×4, `sessions.ts` ×3, `hooks.ts` ×2, `mcp/server.ts`, `end-session.ts`, `reconcile.ts`) would each grow the same two-branch check. Two adapters = a real seam, and it has six. The `return null` drop-don't-throw posture at `:114` concentrates a genuinely tricky decision in one place. Keep.
- `emitScoped` (`:92`) is a **one-line dispatcher on a two-variant union that its callers construct themselves**. Its 8 call sites live in exactly **two** files — `pty/dev-pane.ts:107,136` and `services/git.ts:1865,1873,1910,1921,1929` — and both already hold an `EmitScope` they built, so they could equally hold a pre-bound emitter. The `EmitScope` type is the useful export; the function is `'featureId' in scope ? a : b`. Deletion test: borderline — complexity reappears as 8 ternaries, so it is not free, but it adds no knowledge a caller does not already have.

**Where the interface genuinely leaks scope handling to callers:** the scope decision is made **four different ways in four different vocabularies** — a bare `featureId` string, a bare `projectId` string, a discriminated union, and a `SessionRow`. A caller must know which of the four it is entitled to use, and `settings.ts` shows the failure mode: it has no scope at all, so it invents a **fake** one (`GLOBAL_EVENT_KEY = 'global'`, D.2) rather than the API admitting a third scope exists. A three-variant `EmitScope` (`{featureId} | {projectId} | {global: true}`) with a single `emit(ctx, scope, e)` would have made that inexpressible instead of silently orphaning rows.

### F.3 `shallow:bus` — kind: **judgement call** — confidence: **medium** — effort S / risk low

`bus.ts` (69 lines) is `Set.add` / `Set.delete` / `for..of` + try/catch, with exactly one production subscriber (D.1a). Deletion test: `stream.ts` could hold the `Set` itself and services could import `publishLive` from it — complexity does not reappear, it *moves*, and it would drag Hono into `services/events.ts`'s import graph. **Verdict: keep.** The 69 lines buy a clean dependency direction (services never import routes) and the never-throw isolation at `:59-62`, which is load-bearing (a subscriber that throws must not roll back a mutation). Listing it so the parent does not mistake its single subscriber for dead weight.

---

## G. Deepening / consolidation / extraction opportunities (ranked)

**G.1 — `EventType` union in `@runcastle/core`.** *(value: high · confidence: high · effort M · blast radius: wide but mechanical)*
Extract the 94+ literals into `export const EVENT_TYPES = [...] as const` + `export type EventType` in `packages/core/src/schemas.ts` beside `EventRow`; type `EmitInput.type` (`events.ts:21`) and `EventRow.type` (`schemas.ts:469`) as `EventType`. **Locality:** the vocabulary becomes one list instead of 94 scattered literals plus ~10 hand-typed mirrors in `apps/web`. **Leverage:** every consumer switch (`feature-ui.ts:529-533,580,600,750-752`, `ShippedBody.tsx:22`, `Workspace.tsx:667`, `notifications.ts`) becomes exhaustiveness-checkable, a rename becomes a compile error instead of a silent UI regression, and the near-miss families (D.5.2) become visible in one place. **Blast radius:** one added export in core, one type change each in `events.ts` and `schemas.ts`, then `tsc` names every site that must be reconciled — no runtime behaviour changes. Two adapters exist (server emitters, web matchers), so this is a real seam, not a speculative one.

**G.2 — Retention + indexes for the events table.** *(value: high · confidence: high · effort M · blast radius: narrow)*
Add `CREATE INDEX ON events(feature_id, id)` and `ON events(project_id, id)` (a migration; `events.ts` unchanged) and a `pruneEvents(ctx, {keepDays})` in `services/events.ts` called from boot beside `reconcileStaleRuns` (`index.ts:96`). **Locality:** retention policy lives with the table, not in `dev/state.ts` (`:125,149`) where the only existing delete lives. **Leverage:** bounds the one table that grows at agent speed forever and removes a full scan from the 1.5 s fallback poll path. Prerequisite decision: what "forever" should mean for shipped features (`latestEventTs(feature.shipped)` at `mcp/server.ts:632` reads arbitrarily old rows, so a naive age-based prune would break the work record — prune must be type-aware or feature-status-aware). Flagging that as the design question, not a blocker.

**G.3 — Collapse the two `features` lookups per emit; delete `events.lap`.** *(value: medium · confidence: high · effort S · blast radius: narrow)*
Merge `projectIdForFeature` + `lapForFeature` (C.1) into one `select({projectId, lap})`, or — given B.2 — drop the lap column, `lapForFeature`, and the unreachable `?? 1` (B.3) outright. **Locality:** removes a write-only column, a redundant query, and 20 lines of doc comment that describes behaviour the code does not have. **Blast radius:** a drop-column migration plus `test/lap-stamping.test.ts` (230 lines, the only reader). If the lap-grouped timeline is still wanted, the honest fix is the opposite: add `lap` to `EventRow` (`schemas.ts:462`) and `rowToEvent` (`events.ts:30`) and use it. **The finding is that it is currently neither.**

**G.4 — `mutateConfigFile()` — one atomic config read-modify-write.** *(value: medium · confidence: high · effort S · blast radius: narrow)*
Fold `writeGlobal` (`settings.ts:479`) and `writeStepModel` (`:531`) into one helper doing read → mutate → `writeFileSync(tmp)` → `renameSync(tmp, configFile)`, and validate the read with `RuncastleConfigSchema.partial()` (E.1). **Locality:** one place that knows the config file's on-disk shape, its mkdir, and its atomicity. **Leverage:** closes E.4's truncation window and E.1's silent-default-revert in the same change. Two callers today = a real seam.

**G.5 — Move `MAP_SECTIONS` into `@runcastle/core`.** *(value: medium · confidence: high · effort S · blast radius: 2 files)*
`knowledge.ts:78` and `GrillBody.tsx:177` (C.4). The duplication is already acknowledged in a comment; core is the package both sides import; the value is pure data. Two adapters = real seam.

**G.6 — Three-variant `EmitScope` (`{featureId} | {projectId} | {global}`) with one `emit`.** *(value: medium · confidence: medium · effort M · blast radius: wide)*
Collapses the four emitters (F.2) to one entry point and makes `settings.ts`'s fake `'global'` project id (D.2) expressible as a real scope the reader path can then serve. **Speculative on the global variant** — it requires first deciding *where* a machine-wide event should surface in the UI (a global timeline? the current project's stream?). Do G.1 first; this is the follow-on.

**G.7 — Emit for `setup.ts`'s host mutations.** *(value: medium · confidence: high · effort S · blast radius: narrow)*
`setup.gitIdentity` and `setup.afkToken` change the machine and leave no trace (D.3). They are project-less, so they hit the same missing-scope problem as D.2 — which makes them the second caller that justifies G.6 rather than another sentinel. Sequence: G.6, then G.7.

---

## H. Cross-cutting candidates to pass UP

Ordered by how likely a sibling agent saw the same thing.

**H.1 — `dead:not-implemented-error` (repo-wide).** `NotImplementedError` is constructed **nowhere** (`grep -rn "new NotImplementedError" packages apps scripts` → 0 hits). Every `isNotImplemented(e)` guard in the repo is dead, in **four** files beyond mine: `services/features.ts:311` (`if (isNotImplemented(e)) return { branchReady: false, … }`), `launcher/launcher.ts:339`, `mcp/server.ts:344`, plus the class + helper + `toTRPCError` arm (`errors.ts:15-22,48-50,60-61`). Mine is `projects.ts:166-190` (B.1). This is the wave-A/wave-B build scaffolding that outlived wave B — the SPEC still documents it as live (`docs/SPEC.md:97,110,212`), which is also **doc drift**. Whoever owns `errors.ts` should make the call once for the whole repo. Sibling agents auditing `features.ts`, `launcher/`, and `mcp/` will each report a fragment of this.

**H.2 — `primitive-obsession:event-type` (repo-wide).** 94+ stringly-typed event types (`packages/core/src/schemas.ts:469` `type: z.string()`) produced across ~15 server files and matched by raw string comparison in ~6 web files. **Every** agent touching a service that emits, and every agent touching `apps/web/src/lib/feature-ui.ts`, will hit a facet of this. Suspected shared module: **`EventType` union + `EVENT_TYPES` const in `@runcastle/core`** (G.1). The companion half is **`data: z.unknown()`** re-narrowed by hand at `prep.ts:97`, `apps/web/src/lib/notifications.ts:74`, and `feature-ui.ts` — suggesting a per-type `data` schema map. Promote to a repo-wide finding; it is the single highest-leverage change I found.

**H.3 — `inconsistent:event-emission` (repo-wide).** The house rule *"every mutating service function emits an event"* (`CLAUDE.md`, `SPEC §12`, `events.ts:9`) is unenforced and unevenly followed. In my scope: `setup.ts` 12 exports / 0 emits (including a host `git config --global` write and an OAuth-credential write), `knowledge.ts` `scaffoldMapDoc` silent while its sibling `scaffoldDocs` emits. Siblings should check the same rule in `git.ts`, `findings.ts`, `test-notes.ts`, `waypoints.ts`, `pty/`. Ask the parent to decide whether the rule means *"every state change"* or *"every state change the UI shows"* — the honest answer changes which of these are findings.

**H.4 — `stale-path:worktree-vs-checkout`.** `feature-docs.ts:19` `const base = existsSync(worktree) ? worktree : project.repoPath` is re-evaluated on **every** doc read/write, so the same feature's docs resolve to different directories before and after a session launches. Reachable from `knowledge.ts` (scaffold/list/read), `services/gates.ts` (decisions.md / spec.md checks — the **gate** path, so a mis-resolve blocks or wrongly passes a phase promotion), and `mcp/server.ts:546,550`. I flag the seam; the gate consequence is a sibling's scope. Suspected shared module: a resolved-once **`FeatureDocsLocation`** carried with the feature rather than probed per call.

**H.5 — `bespoke:network-and-parsing-helpers`.** In my scope: hand-rolled semver (`update-check.ts:29-68`), hand-rolled dotenv upsert (`setup.ts:55-70`), a `fetch` with no timeout (`update-check.ts:93`, E.7), and unvalidated `JSON.parse` at `settings.ts:264` and `setup.ts:177`. Siblings almost certainly have their own retry/timeout/parse helpers (the burner and `git.ts` are the likely sites). Suspected shared modules: **`fetchWithTimeout`** and **`parseJsonFile(path, schema)`**. Promote if a second agent names either.

**H.6 — `no-auth:local-server` (security surface, sibling-owned file, my scope supplies the exposed surface).** `packages/server/src/index.ts:105-112` calls `Bun.serve({ port, fetch, websocket })` with **no `hostname`**, so it binds `0.0.0.0` (all interfaces), and `trpc/context.ts:29` has a single `publicProcedure` with **no auth middleware** — `grep` finds no `protectedProcedure` anywhere. What that exposes from my scope alone, to anyone on the same LAN/coffee-shop Wi-Fi, unauthenticated: `project.browse`/`project.roots` → **arbitrary directory listing of the whole filesystem** (`fsbrowse.ts:169`, no root confinement — by design for the picker, but the picker assumed localhost); `docs.read` → arbitrary file read under any feature's docs dir; `settings.update` → write `~/.runcastle/config.json` and change the model/sandbox any future agent runs under; `setup.gitIdentity` → rewrite the host's global git identity; `setup.afkToken` → **overwrite the stored OAuth credential**; `setup.startTerminal` → spawn a process. Note `packages/server/src/services/setup.ts:19` names the credential key and `:299,327` reference its file location — **credential type only: a Claude Code OAuth token at `~/.runcastle/.env`; no value is reproduced here and I did not read that file.** Mitigation is one line (`hostname: '127.0.0.1'`). Flagging UP because the fix lives in a sibling's file but the blast radius is mostly mine. Confidence **high** on the binding and the missing auth; **medium** that no reverse-proxy/firewall assumption is documented elsewhere (I checked `CONTEXT.md` vocabulary and `SPEC §12` and found no auth decision).

**H.7 — `orphan-events:sentinel-ids`.** `settings.ts:42` invents `GLOBAL_EVENT_KEY = 'global'` as a project id, and `events.project_id` has **no foreign key** (`packages/core/src/db-schema.ts:259`) so nothing rejects it. Worth asking siblings whether other services invented their own sentinels into FK-less columns — the schema has no foreign keys at all, which is the enabling condition.

---

## Test quality / coverage gaps (assessed, not run)

Overall the tests in this scope are unusually good — behavioural, well-named, injecting IO seams rather than mocking (`SettingsIO` at `settings.ts:248`, `AfkTokenIo` at `setup.ts:73`, `fetchImpl` at `update-check.ts:84`, `platform` at `projects.ts:54`, `home` at `fsbrowse.ts:78`). The gaps are specific:

- **`latestEventTs` and `latestTsByFeature` have zero direct tests.** `grep -rn "latestEventTs\|latestTsByFeature" packages/server/test` → no hits. `latestTsByFeature` feeds the sidebar's activity stamp on every `feature.list`; `latestEventTs` dates the shipped record. Both have non-obvious semantics the docs call out (absent = normal; project-level rows skipped at `events.ts:203`) and neither is pinned.
- **`settings.test.ts:252-256` asserts the global event exists by hard-coding the sentinel** (`listByProject(ctx, 'global', 0)`). It proves the emit happened and, by needing the magic string, proves no ordinary reader can reach it (D.2). A test that asserted "the user can see this" would have failed.
- **No test for the `stepModels` in-place nested mutation** (E.3). `settings.test.ts:130` pins the snapshot guarantee for flat fields only; the nested case silently violates it.
- **No test for a corrupt/invalid `config.json`** — E.1's silent revert-to-defaults path (`settings.ts:267`) is untested.
- **No test for a hanging `fetch`** in `update-check.test.ts` — it covers reject, non-ok, and garbage (`:66,89`), not the timeout case that E.7 says is unhandled.
- **`events.test.ts` (105 lines) does not cover cursor behaviour under interleaved feature/project emits**, nor the `NotFoundError` from `projectIdForFeature` (`events.ts:51`).
- **`live-stream.test.ts` is strong** — it covers subscriber leak on disconnect (`:147`) and burst coalescing (`:165`), which are the two things most likely to break. No gap worth naming.
- **`fsbrowse.test.ts` covers `expandPath`, symlinks, hidden files, dedupe** — but nothing asserts a confinement boundary, because there isn't one (H.6).
