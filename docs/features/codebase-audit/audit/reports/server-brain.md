# SERVER-BRAIN — consolidated audit of the server's service/data layer

Scope: `packages/server/src/services/**` (21 modules), `src/trpc/**`, `src/db/**`,
`src/util/**`, `src/config.ts`, `src/index.ts`, plus a test-quality read of
`packages/server/test/**`. Launcher/PTY/MCP/routes/workflows/dev/doctor/bin/assets are a
sibling orchestrator's; where a service crosses into them the boundary is named and dropped.

Assembled from four leaf reports plus the orchestrator's own audit of the wire/db layer:

| Leaf report | Scope |
|---|---|
| `server-brain-pipeline.md` | features, gates, tickets, waypoints, findings |
| `server-brain-git.md` | git, repo, prep, drive-env, drive-hooks, test-notes |
| `server-brain-events.md` | events, bus, agent-stream, projects, settings, setup, update-check, knowledge, feature-docs, fsbrowse |
| `server-brain-wire.md` | trpc/**, db/**, util/**, config.ts, index.ts, errors.ts (audited by the orchestrator) |
| `server-brain-tests.md` | packages/server/test/** |

Claims the orchestrator re-verified against source before publishing are marked **[verified]**.

---

## A. Flow map

### Boot

```
src/bin/runcastle.ts → startServer()                         index.ts:73
  loadConfig()                        config.ts:13  (re-export of @runcastle/core/config-load)
  ensureDataDir()                     config.ts:21
  createDb(dbPath())                  db/client.ts:15   bun:sqlite, WAL + foreign_keys ON
  runMigrations(db)                   db/migrate.ts:29  per-file txn, __migrations ledger
  ctx: AppCtx = { db, config }        db/types.ts:26    one singleton, no per-request ctx
  buildApp(ctx)                       index.ts:26
    /api/trpc/*  → appRouter (10 routers, 59 procedures)  trpc/router.ts:17
    /api/hooks · /api/stream (SSE) · /mcp · SPA           [BOUNDARY → sibling scope]
  reconcileStaleSessions / reconcileStaleRuns             [BOUNDARY]
  Bun.serve({ port, fetch, websocket })                   index.ts:105  ← no `hostname` (H7)
```

### The canonical mutation flow

```
POST /api/trpc/<router>.<proc>
  → charset shim                      index.ts:46
  → publicProcedure                   trpc/context.ts:29
       errorMapping middleware        trpc/context.ts:19-26 → toTRPCError(cause ?? error)
       .input(zod)                    (present on every procedure taking input)
  → service fn(ctx, …)                services/*.ts
       drizzle write                  db/schema.ts
       emit(ctx, featureId, {…})      services/events.ts:75
         └ insertEvent                events.ts:117 → INSERT events + publishLive
              └ bus.publishLive       bus.ts:55
                   └ ONE subscriber   routes/stream.ts:50 → SSE
                        └ apps/web/src/lib/live.ts:148 → invalidate → re-read events.list
  → response
```

The push channel carries a *hint*, never data (`bus.ts:14-18`, `live.ts:16-19`); polling at
1.5s is the fallback. `agent-stream.ts` is a **fourth, in-memory data plane** publishing
`transcript` signals on the same bus while storing nothing in the db — it duplicates the
`burn.text`/`burn.tool` event types with different retention and a different cursor.

### The pipeline state machine

```
feature.create ──→ ideation ──G1──→ spec ──G2──→ tickets ──G3──→ implementation ──G4──→ review ──G5──→ shipped
                      ↑                                                                      │
                      └────────────── rethink / lap N+1 (features.ts:566) ───────────────────┘

writers:  features.setPhase-callers · gates.overrideGate (gates.ts:184) · gates.undoGateOverride (:234)
          · trpc/routers/feature.ts:207  ← the ship transition, in the ROUTER (D1)
gate reads: gates.checkGate ← docs on disk via feature-docs.ts:19 (H6)
```

### Test drive / ship

```
feature.testDrive → trpc/routers/feature.ts:171 → git.testDrive          git.ts:1486-1518
     module-global testDriveState (git.ts:1344)  ← check-then-act across awaits (H4)
feature.merge     → trpc/routers/feature.ts:194 → git.mergeFeature       git.ts:2037  (emits nothing)
     → setPhase + setFeatureStatus, two un-transacted writes             feature.ts:207-208 (H1)
```

---

## B. Dead code (all importer-verified)

| Item | Evidence | Conf |
|---|---|---|
| **`NotImplementedError` apparatus, repo-wide** | `new NotImplementedError` has **zero** occurrences in `packages/`, `apps/`, `scripts/` (excl. node_modules/dist) **[verified]**. Dead: the class `errors.ts:15`, `isNotImplemented` `errors.ts:48`, the `toTRPCError` arm `errors.ts:60`, and five unreachable guards — `features.ts:311`, `projects.ts:173`, `projects.ts:185`, `launcher/launcher.ts:339`, `mcp/server.ts:344`. | high |
| Everything downstream of the above | `branchReady === false` and its `'…(branch pending)'` messages (`features.ts:161-163, 173, 252-254, 283`); the whole "B2 tolerance" block `projects.ts:166-190` incl. the `void ctx` no-op at `:169` and both unreachable fallbacks (`.git` existsSync `:174-177`, `ctx.config.mainBranch` `:186`) | high |
| `events.lap` — a write-only column | Written on every insert (`events.ts:130`), costing a second `features` SELECT per emit (`lapForFeature` `:65`). Only 5 `from(events)` sites exist (`events.ts:157,175,195,216`, `prep.ts:86`) and none surface it; `rowToEvent` drops it (`:30-42`) and core's `EventRow` has no `lap` field (`schemas.ts:462`) **[verified]**. Pinned by `lap-stamping.test.ts` — a test holding a write-only column in place. | high |
| `lapForFeature`'s fallback | `events.ts:71 return row?.lap ?? 1` cannot fire: `emit` calls `projectIdForFeature` first, which throws `NotFoundError` on the same missing row (`:51`), both synchronous. The 10-line comment at `:55-64` justifying it misdescribes the path. | high |
| `loopBackPhase` / `rethinkPhase` | `core/src/pipeline.ts:122` / `:146` — no production caller (core tests + `docs/SPEC.md:374` only); `features.ts:444` / `:541` inline the predicate instead. Model/service drift, flagged for the core scope. | high |
| **Over-exports** (used internally, `export` unearned; not dead code, dead *surface*) | `gates.ts:92 notYetTerminal`; `git.ts:134 migrationPaths`, `:591 RESEARCH_BRANCH_PREFIX`, `:592 TICKET_BRANCH_PREFIX`, `:615 tempBranchSlugSegment`, `:766 headSha`, `:803 diffPaths`; `drive-hooks.ts:77 hookSpawnTarget`; `knowledge.ts:121 CHARTER_FILE`, `:124 ADR_DIR_REL`, `:130 SUPERSEDED_RE`; `update-check.ts:15 PACKAGE_NAME`, `:16 UPDATE_COMMAND`; `util/resolve-executable.ts:56 BIN_OVERRIDE_ENV`. All zero external references incl. tests **[verified by orchestrator scan]**. | high |
| Stale wave-B comments (doc drift) | `trpc/context.ts:10`, `trpc/routers/feature.ts:55`, `:168`, `:192-193` still describe stubs that throw `NotImplementedError`. `docs/SPEC.md:97,110,212` likewise. | high |

**Resolved disagreement.** An early orchestrator scan flagged ~15 further exported *types* as
unreferenced (`GateResult`, `MergeResult`, `BrowseResult`, `TranscriptRead`, `EmitInput`, …).
The events leaf correctly pushed back: these are the **return types of exported functions** and
their export is legitimate API surface. Withdrawn — only the functions/constants above stand.

---

## C. Redundancy & repeated logic

1. **`redundant:err-msg`** — `function errMsg(e: unknown)` defined verbatim 4× and inlined 4×
   more: `features.ts:607`, `launcher/launcher.ts:873`, `git.ts:160`, `fsbrowse.ts:241`,
   `dev/state.ts:200`, `launcher/sessions.ts:729`/`:731`, `mcp/server.ts:346`. One home:
   `src/errors.ts`.
2. **`redundant:worktree-teardown`** — `worktree remove --force → rmSync → prune` written three
   times (`git.ts:669-700`, `:1219-1243`, `:1068-1079`). The Windows retry+delay knowledge lives
   in exactly one of them, and `removeTalkWorktree` — the *user-facing delete that throws on a
   locked file* — is the copy **without** the retry.
3. **`redundant:git-line-parsing`** — 6 sites splitting git stdout, none CRLF-normalizing, while
   `drive-hooks.ts:55` does. Suggests `gitLines()`.
4. **`redundant:router-entity-lookup`** — the resolve-id-or-throw preamble re-typed across
   `docs.ts:10`, `feature.ts:172`, `:188`, `:197`, `project.ts:38`, `:105`, `:116`; plus the
   `getFeatureRow` → `projectForFeature` pair three times. Suggests a `featureProcedure` /
   `projectProcedure` middleware.
5. **`redundant:id-input-schema`** — `z.object({ featureId: z.string() })` spelled out ~14×,
   `{ projectId: … }` ~9×, `{ ticketId: … }` 4×, across 7 router files.
6. **`redundant:read-write-read`** — mutators do `get → UPDATE → get` instead of
   `UPDATE … .returning()`, which drizzle supports and this codebase already uses
   (`features.ts:156`, `events.ts:138`). In `waypoints.claim/release/resolve`,
   `tickets.editTicket/cancelTicket/updateTicket`. Extra queries *and* a forgone atomicity win.
7. **`redundant:identity-map`** — `findings.ts:43-52` `COLUMN_NAME` maps each `PreparedKey` to a
   string identical to the key itself, then uses it as `{ [COLUMN_NAME[key]]: value }`
   (`:121`) — `{ [key]: value }` is the same thing **[verified]**. A second parallel map
   (`VALUE_COLUMN`, `:31-40`) over the same union is legitimate (it holds drizzle columns).
8. **`redundant:map-sections`** — the same 4 map headings declared in `knowledge.ts:78` and
   `apps/web/.../GrillBody.tsx:177`; the web copy's own comment admits the duplication.
9. **`redundant:drive-lifecycle`** — the test drive and the prep dry-run drive are two
   implementations of one lifecycle (~8 switch sites on drive kind).

---

## D. Inconsistencies & structural smells

**D1. `layering:router-owns-transition` — business logic in the transport layer.** [verified]
Three procedures break the documented one-liner shape (`trpc/context.ts:6-7`):
- `feature.merge` (`trpc/routers/feature.ts:194-220`) — the **ship transaction**: stop drive →
  merge → `setPhase` → `setFeatureStatus` → `emit`. There is no `features.shipFeature()`, so
  MCP tools and the burner *structurally cannot ship a feature*; only the browser can.
- `ticket.stop` (`trpc/routers/ticket.ts:34-46`) — `stopTicketRun` → `getTicket` →
  `hasActiveRun` → `sweepOrphanedBurning`, synthesising `{ stopped, swept }`.
- `setup.startTerminal` (`trpc/routers/setup.ts:57-85`) — eight statements of orchestration.

**D2. `unvalidated:gate-override-id` — the gate argument is decorative.** [verified] `overrideGate`
records `gate` in the table (`gates.ts:175`) and in the event (`:177-181`), then advances with
`nextPhase(feature)` (`:183`) **without ever checking that `gate` guards that transition**.
`overrideGate(f, 'G5', …)` on an `ideation` feature writes a G5 override row and advances
ideation → spec. `undoGateOverride` (`:222-241`) is the mirror: `previousPhase(feature)` while
dropping the newest override *of the named gate*, unchecked. The wire enum (`feature.ts:18`)
constrains the id to G1-G5 but nothing ties it to the phase — a state-machine invariant
delegated to the client.

**D3. `latent-bug:phase-status-divergence`.** Phase and status are two columns with no single
writer. A G5 override sets `phase:'shipped'` but not `status` (`gates.ts:183`); only the router's
merge sets both (`feature.ts:207-208`). `deleteFeature` refuses on *status* (`features.ts:821`),
so a phase-shipped feature stays deletable, and archive→unarchive silently "repairs" status by
deriving it from phase (`:852`).

**D4. `latent-bug:live-session-predicate`.** "Is a terminal open?" is asked two ways:
`status === 'live'` (`features.ts:797`, `:866`, used by archive/delete) vs
`activeSessionsForFeature` = `['launching','live']` (`:372`, `:549`, everything else). A
`launching` PTY survives archive, and delete drops its session row from under it.

**D5. `missing-guard:waypoint-resolve`.** `waypoints.ts:270` has **no status precondition at
all**, while `claim` guards carefully and tickets have `assertMutable`. `resolve_waypoint` is
agent-callable, so a retry overwrites the summary and re-emits.

**D6. `latent-bug:singleton-toctou`.** `testDriveState` (`git.ts:1344`) is check-then-act across
awaits: guard `:1486` → three awaits → `git checkout` `:1508` → assignment `:1509`. Two
concurrent starts both pass; the second clobbers `previousBranch`/`detachedWorktree`, so `stop`
returns the user to the **wrong branch** and leaves a worktree detached. Same shape in
`startDryRun` (`:1646`→`:1673`) and `mergeFeature` (`:2040`→`:2057`); `testDrive('start')` never
checks for an in-flight merge. The state is also in-memory only, so a restart forgets a drive
still holding the main checkout on a feature branch — after which the merge guard
(`feature.ts:202`) silently stops guarding.

**D7. `latent-bug:docs-commit-branch`.** `commitDocs(path, msg)` (`git.ts:1290`) commits to
whatever branch that path's HEAD is on, with no assertion. `features.ts:175`/`:285` pass
`project.repoPath` (the human's checkout) while `mcp/server.ts:340` passes
`session.worktreePath`. Because the feature branch is cut *before* the commit, `brief.md` never
lands on `feature/<slug>` — pinned by the repo's own test (`feature-create.test.ts:85`) — yet
`launcher/artifacts.ts:131` tells the agent to read it from its worktree. It also puts an
unasked runcastle commit on the human's current branch.

**D8. `latent-bug:hook-process-leak` (Windows).** `drive-hooks.ts:163 child.kill()` kills only
`cmd.exe /d /s /c "…"` (`:82-88`), not its children; a timed-out `docker compose up` is orphaned
holding its ports (the 2s `KILL_GRACE_MS` at `:169` works around the symptom). The correct
primitive exists — `killProcessTree` in `pty/dev-pane.ts:159` — but is **unexported**, so the
hook runner cannot reach it, while `drive-hooks.ts:60-75` explicitly states the two spawns must
behave alike.

**D9. `inconsistent:error-taxonomy`.** `GateError` (412) doubles as the generic "invalid state"
error while `InvalidInputError` (400) covers the identical rule elsewhere: `waypoints.ts:178` vs
`tickets.ts:138` for "this row is terminal". Separately, the only two raw `throw new Error` in
the entire service layer are `git.ts:249` and `git.ts:326` **[verified]** — the same
user-correctable condition ("base branch does not exist"), from the same caller
(`features.ts:305-306`), reaching the UI untyped instead of `BAD_REQUEST`.

**D10. `inconsistent:input-validation-strictness`.** Entity ids are bare `z.string()` — the empty
string passes and reaches the db — while free-text fields in the *same object literal* get
`.min(1)`: `feature.ts:131-133`, `:165`, `test-notes.ts:29`, `project.ts:41` vs `:45`.

**D11. `inconsistent:core-schema-adoption`.** Some procedures reuse core's zod vocabulary
(`ProjectName` `project.ts:49`, `SettingsUpdateInput` `settings.ts:18`, `SessionKind`
`feature.ts:63`); adjacent ones hand-roll it (`gateId` redeclared at `feature.ts:18` duplicating
a domain enum core's pipeline owns; `title: z.string().min(1)` at `:25`).

**D12. `anemic-layer:repo-service`.** `services/repo.ts` is a row-accessor grab-bag (18 exports,
2 emit sites) imported *directly by routers*, bypassing the domain services — `setPhase`,
`setFeatureStatus`, `getFeatureRow`, `projectForFeature` (`feature.ts:15`), `requireProjectById`
(`project.ts:9`), `hasActiveRun` (`ticket.ts:3`). `CLAUDE.md` assigns phase transitions to
`services/features.ts`, but the phase writer lives in `repo.ts` and is called from the router:
the state machine's write path has no owner. Also `inconsistent:getter-naming` — three prefixes,
two behaviours (throw vs null).

**D13. `orphan-events:global-settings`.** `settings.ts:42 GLOBAL_EVENT_KEY = 'global'` — a fake
project id emitted at `:470`/`:522`. `events.project_id` has **no foreign key**
(`db-schema.ts:259`; the schema has none at all), so nothing rejects it; the only consumer
anywhere is `settings.test.ts:254`. Global settings changes are invisible in the UI and the rows
accumulate unread.

**D14. `unbounded:events-table`.** Zero pruning (`delete(events)` only in the `features.ts:914`
cascade and dev-only `dev/state.ts:125,149`) and **zero `CREATE INDEX` across all 10 migrations**.
Every `listAfter`/`listByProject` is a full scan, and `latestTsByFeature` full-scans and
group-bys on every `feature.list` — which the UI polls at 1.5s.

**D15. `silent-noop:run-cancel`.** `run.ts:24-29` returns `{ ok: true }` unconditionally;
`cancelRun` is `controllers.get(runId)?.abort()` (`workflows/runner.ts:178`). The UI cannot
distinguish "cancelled" from "nothing to cancel", and nothing is emitted.

**D16. `repeated-switch`** on the same types across files: phase (`features.ts`, `gates.ts`,
`repo.ts`, `feature.ts` router), drive kind (~8 sites), session kind, event type (94 literals).

**D17. `doc-drift:spec-trpc-map`.** [verified] `docs/SPEC.md §4` is headed "pin — apps/web builds
against exactly this" and `CLAUDE.md` says "names in the spec are law". It documents **18**
procedures; the code exposes **59**. `project.get()` and `project.init({repaPath})` are specced
but **absent**; `feature.create` lost `size` and gained `projectId`; `feature.list` gained a
`{projectId}` input it is specced not to have; `feature.merge` returns four fields, not two.
Undocumented entirely (41): all of `notes`/`setup`/`system`, eleven `feature.*`, seven
`project.*`, two `run.*`, `events.listByProject`, four `ticket.*`.

---

## E. Wrong-tool & weak typing

The layer is unusually clean here: **zero `any`, `as any`, `@ts-ignore`, or `@ts-expect-error`
anywhere in the audited `src/`** [verified], and exactly one unchecked cast. Findings are about
*missing* schema application, not sloppy types. (The one exception is in test code:
`delete.test.ts:149-150` carries an `as any` plus an `eslint-disable` pragma — in a repo with no
lint step, so the pragma suppresses nothing.)

| Key | Evidence | Conf |
|---|---|---|
| `weak-typing:db-client-cast` | `db/client.ts:19 return drizzle({ client: sqlite, schema }) as unknown as Db` — a double cast on the load-bearing seam. `db/types.ts:5-14` explains why `Db` is driver-agnostic but never explains the cast; it is also what lets prod (bun:sqlite) and tests (sql.js) diverge unnoticed. | high |
| `unvalidated-json:settings-config` | `settings.ts:264 JSON.parse` with no schema; `resolveField:358-360` returns `fileRaw[configKey]` verbatim, so a hand-edited `"burnConcurrency": "lots"` is served as a valid-looking field. `RuncastleConfigSchema` is *imported at `:12`* and simply not applied. | high |
| `nonatomic-write:config-file` | `settings.ts:483`/`:538` read-modify-`writeFileSync`, no temp+rename. A truncated file hits `catch { return {} }` (`:267`) → every global setting silently reports its schema default. | high |
| `unsafe-cast:ctx-config-mutation` | `settings.ts:517-520` takes a **live reference** to nested `stepModels` and mutates in place. The "in-flight work keeps its starting config" guarantee (`:29-33`, tested at `settings.test.ts:130`) holds for flat fields and silently does not for `stepModels`. Untested. | high |
| `unguarded:fetch-timeout` | `update-check.ts:93` — `fetch` with no `AbortSignal`. The module doc promises it "can't wedge the server" (`:79-81`): true for a rejecting fetch, false for a hanging one. The memo (`:112`) doesn't dedupe in-flight calls. | high |
| `wrong-tool:git-porcelain-parsing` | `dirtyPaths` (`git.ts:1953-1964`) strips quotes but never decodes git's C-style escapes, so with default `core.quotepath` a non-ASCII path surfaces to the user as `docs/f\303\251ature.md`. Same in `conflictedFiles`, `diffPaths`. Fix is `-z` / `core.quotepath=false` at every git text boundary. | med-high |
| `bespoke:semver-and-dotenv` | hand-rolled semver compare `update-check.ts:29-68`; hand-rolled dotenv upsert `setup.ts:55-70` with **no CRLF handling on a Windows-first product**; unvalidated `JSON.parse` `setup.ts:177`. | high |
| `weak-typing:migration-row-cast` | `db/migrate.ts:40 … as { name: string }[]` on a raw SQL result. | high |
| `missing:global-error-handling` | `index.ts` registers SIGINT/SIGTERM (`:133-134`) but no `unhandledRejection`/`uncaughtException`, in a server whose job is supervising floating background promises (burns, PTYs, drives). | med |
| `incomplete-shutdown` | `index.ts:128-132` — `process.exit(0)` immediately; `server.stop()` unawaited, sqlite handle never closed, WAL checkpoint left to crash recovery. | med |
| `unguarded-boot:migrations` | `runMigrations` (`index.ts:80`) and `readdirSync` (`migrate.ts:43`) unguarded — a missing vendored migrations dir aborts boot with a raw stack instead of an actionable message. | med |
| `resolve-executable:dir-vs-file` | `util/resolve-executable.ts:220` accepts any `existsSync` hit, which is true for directories — a directory named `claude` on PATH resolves as the executable. | med |
| `swallowed-errors:services` | 51 `catch` blocks in `git.ts` alone, nearly all returning empty with a comment. Each defensible; the aggregate cannot distinguish "nothing there" from "broken". Good form exists at `drive-hooks.ts:181-184`. | high |

---

## F. Shallow modules / deletion-test candidates

- **`shallow:config-module`** — `config.ts:13-14` is a bare re-export of core. Deletion test on
  that half: callers import from `@runcastle/core/config-load` directly (as `config.ts` itself
  does) and nothing reappears. `ensureDataDir` (`:21-27`) genuinely earns its keep.
- **`shallow:git-alias`** and **`data-clump:repo-handle`** — `git.ts:1088` takes both a
  `SimpleGit` handle *and* its path; the pair travels together everywhere. One `RepoHandle`.
- **`shallow:emitScoped`** — a one-line ternary (`events.ts:92`) whose 8 call sites live in only
  **two** files, both already holding the union they pass. By contrast `emitForSession`
  (`:111`) is genuine depth: 12 call sites in 6 files, and the drop-don't-throw decision is
  concentrated in one place. Verdict: `emit`/`emitProject`/`emitForSession` are depth;
  `emitScoped` is not — see G6.
- **Not findings** (recorded so nobody re-raises them): the thin one-liner routers
  (`events.ts`, `docs.ts`, `system.ts`, `settings.ts`) are the correct transport-adapter shape;
  `prep.ts` (read-only), `drive-env.ts` (pure) and `drive-hooks.ts` (caller narrates) importing
  no emitter is correct; `__resetTestDriveState` (`git.ts:1362`) is the honest form of a test
  hook; `agent-stream.ts:32 TranscriptRead` is a legitimate exported return type.

### The counter-example worth preserving

`util/resolve-executable.ts` is what this layer should be measured against: one module owns
PATHEXT scanning, the `RUNCASTLE_*_BIN` override table, the well-known-install-dir recovery
scan, `.cmd`/`.ps1` interpreter selection, and the human-readable failure explanation — each
with a comment recording the incident that motivated it (`:35-43`, `:46-55`, `:61-75`,
`:126-141`, `:165-174`). Three former copies of the `.cmd`/`.bat` branch collapsed into
`spawnTargetFor`. `test-notes.ts` is the services' equivalent: five mutators, five emits, zero
deviations. The extractions below ask for the same treatment elsewhere.

---

## G. Deepening / extraction opportunities — ranked across all leaves

Ranked by value × confidence ÷ effort.

**G1. `EventType` union + per-type data schemas in `@runcastle/core`.** (value high · conf high ·
effort M · blast radius wide but mechanical — `tsc` names every site)
`EmitInput.type` is `string` and `data` is `unknown` (`events.ts:20-26`; `schemas.ts:469`), yet
**94+ distinct literals** are produced across services, launcher, router, runner and hooks
**[verified]** — and that undercounts, because some are passed positionally through `setPhase`
(`features.ts:496`, `:498`) and six are built by template interpolation in `git.ts:1911/1922/1930`,
making them ungreppable. `apps/web` matches raw strings (`feature-ui.ts:529,533,580,600,750-752`,
`ShippedBody.tsx:22`, `Workspace.tsx:667`). Near-miss families already exist —
`research.error`/`research.failed`, `ticket.retry`/`ticket.retrying`. Today a server-side rename
is a silent UI regression no tool can see. Zod is the house schema lib and is simply not applied
at the app's most-crossed boundary.

**G2. `shipFeature` service + the transaction it needs.** (value high · conf high · effort M ·
radius: 2 routers, 2 services)
Move `feature.merge`'s body (`trpc/routers/feature.ts:194-220`) into
`services/features.shipFeature`, wrapping `setPhase` + `setFeatureStatus` in one
`ctx.db.transaction` and emitting a `feature.shipped` event *from the service* naming the base
branch. Fixes D1, D3 and the merge's non-atomicity in one move, and gives MCP/burner the ability
to ship. Second caller already exists (the MCP surface wants it), so this is a real seam.

**G3. Transaction boundaries + the missing unique index.** (value high · conf high · effort M)
`ctx.db.transaction(` appears **once** in all of `packages/server/src` (`findings.ts:119`) plus
`db/migrate.ts:55` **[verified]** — so the affordance demonstrably works and is simply unused.
Un-transacted multi-row writes: seq assignment + insert (`tickets.ts:85-112`,
`waypoints.ts:87-133`), phase + event (`repo.ts:195-200`), lap + phase (`features.ts:566-567`),
settings value + provenance (`settings.ts:424` + `findings.ts:162`), the seven-DELETE teardown
(`features.ts:910-918`), and the ship pair. Paired with **`missing-constraint:seq-uniqueness`**:
`core/src/db-schema.ts:185`/`:227` declare no unique index on `(feature_id, seq)` for tickets or
waypoints — and `blockedBy` stores *seqs*, so a collision makes every dependency edge ambiguous,
silently.

**G4. `crossGate(ctx, featureId, gate, …)` owning gate→transition correspondence.**
(value high · conf high · effort M · 4 call sites)
Validates that `gate` actually guards the feature's current transition (D2), owns the G3 rule
once, and makes `overrideGate`/`undoGateOverride`/`advance`/`burn` share one definition of a
legal move. Also the natural place to make phase and status a single write (D3).

**G5. Extract a `worktrees` module from `git.ts` and unify the retry policy.**
(value high · conf high · effort M)
`git.ts` is 2117 lines / 42 exports = six modules. **Real seams (2+ external callers):** worktree
lifecycle (8 exports, 5 caller files), temp-branch naming (6 exports, IO-free — cheapest, move to
core), merge & landing (4), read-only queries (6), drive machinery (~700 lines, 8).
**Speculative (1 caller):** the guards/`DENY_*` cluster. Extracting worktrees also collapses C2's
three teardown copies onto the one that knows about Windows file locks.

**G6. Branded id schemas + `featureProcedure`/`projectProcedure` middleware.**
(value medium-high · conf high · effort M · radius: 7 routers + MCP inputs)
`FeatureId`/`ProjectId`/`TicketId`/`RunId`/`SessionId` as `z.string().min(1).brand<…>()` in core,
plus a procedure builder that resolves the row once. Folds C4, C5, D10 together and closes the
empty-string hole. Prerequisite for making positional-string calls like
`setPhase(ctx, featureId, …)` type-checkable.

**G7. Events retention + indexes.** (value high · conf high · effort M · narrow)
Design question first: `latestEventTs('feature.shipped')` reads arbitrarily old rows, so pruning
must be type- or status-aware. Add indexes on `(feature_id, id)` and `(project_id, id)` regardless
— there are currently none at all (D14).

**G8. One `killTree()` for every spawn site.** (value medium-high · conf high on Windows · effort S)
Export `pty/dev-pane.ts:159 killProcessTree` and route `drive-hooks.ts:163` through it (D8).

**G9. `mutateConfigFile()` — one atomic read-modify-write.** (value medium · conf high · effort S)
Two callers (`settings.ts:483`, `:538`) = real seam; closes the truncation and the
unvalidated-parse findings together.

**G10. `bestEffort(fn, { fallback, report })`.** (value medium · conf medium · effort S)
51 swallowed catches in `git.ts` alone; the aggregate hides real breakage.

**G11. Split `src/app.ts` out of `src/index.ts`, plus a real test harness.**
(value medium-high · conf high · effort M · radius: test suite only)
`buildApp` is documented as the test seam and imported by no test, because `src/index.ts` drags
in `bun:sqlite`. Splitting the pure Hono factory into `src/app.ts` makes the documented seam
usable, covers `/health` and the charset middleware, and lets six files stop re-implementing
slices of boot. Pair with the `test/helpers/*` extraction (H13) and a `setupFiles` env firewall
(H14) — the firewall is effort S and retires a footgun the whole team currently works around by
hand. Also cheap and overdue: a `test/errors.test.ts` asserting tRPC error codes, which nothing
covers today.

**G12. Smaller, high-confidence wins.** `errMsg` → `src/errors.ts` (C1). `MAP_SECTIONS` → core
(C8). `gateId` → core (D11). `{ [key]: value }` for `COLUMN_NAME` (C7). Delete the
`NotImplementedError` apparatus (B). Delete or surface `events.lap` — the finding is that it is
currently neither (B). `fetchWithTimeout` + `parseJsonFile(path, schema)` (E). Bind
`hostname: '127.0.0.1'` (H7).

**Speculative, flagged as such:** collapsing the four emit variants into one three-scope
`EmitScope` needs a product decision on where machine-wide events surface (`settings.ts` invented
a fake project id rather than admit a third scope exists) — do G1 first. Extracting the git
guards cluster has one caller.

---

## H. Cross-cutting candidates to pass UP

Ordered by how much of the repo they touch. **Bold count** = how many of my five sub-scopes named
it independently; ≥2 is the promotion bar.

**H1. `inconsistent:event-emission` — named by 4/5.** The house rule ("every service function
that mutates emits an event") is unenforced and violated in four distinct shapes:
- *(a) mutation with no event at all* — `git.ts` has 42 exports and 14 emit calls, **all inside
  the drive machinery**; 13 mutating exports are silent, worst being `git.ts:1290 commitDocs`
  (creates a real commit), `git.ts:939 allowPushToCheckedOutBranches` (writes `.git/config`), and
  `git.ts:2037 mergeFeature` — the most consequential mutation in the product — which emits
  nothing on success, so the timeline never names the base branch. `setup.ts` is 12 exports / **0**
  emits, including `writeGitIdentity` (`:35`, mutates host `git config --global`) and
  `saveAfkToken` (`:85`, writes an OAuth credential). `knowledge.scaffoldDocs` emits (`:69`) but
  its sibling `scaffoldMapDoc` (`:97`) writes to the repo silently.
- *(b) the caller emits, not the mutator* — `findings.recordFinding`/`recordHuman` import no
  emitter; the events live at `mcp/server.ts:423` and `settings.ts:432`.
- *(c) one mutation → two events* — `tickets.ts:222-230`, plus N+1 emit storms at
  `features.ts:477-491` and `:713-741`.
- *(d) the router emits* — `trpc/routers/feature.ts:206-218`.

  **Orchestrator ruling on the disagreement between leaves.** Two leaves applied different
  standards to "the caller emits". The defensible line: emission by the caller is acceptable
  only where the mutator has a single entry point that emits a semantically equivalent event,
  and where the omission is *documented* — `findings.markVerified` does exactly this
  (`findings.ts:216-218`, "deliberately emits no event… the dry-run service owns the timeline
  entry") and per the briefing's "a documented choice is not a finding" it is **not** a
  violation. Likewise `prep.ts` (read-only), `drive-env.ts` (pure) and `drive-hooks.ts` (caller
  narrates) are correct. What *is* a violation is (a) — a state change the UI can never learn
  about — and (d). Category (b) is a fragility, not a bug: two callers each independently
  responsible for the event is how (a) is born. **The parent should rule once** on whether the
  rule means "every state change" or "every state change the UI shows"; that answer decides
  perhaps a third of the individual items. The root cause is structural and stated in the code:
  `git.ts:31-36` concedes "we do not widen the pinned signatures to inject `ctx`" — the functions
  were written before `AppCtx` threading, so *any* service specified in that era shares this.
  `EmitScope`/`emitScoped` is the repo's own answer and is used in one file.

**H2. `dead:not-implemented-scaffolding` — named by 4/5.** [verified repo-wide] The entire wave-B
stub apparatus is dead: `NotImplementedError` is constructed **nowhere**, leaving the class
(`errors.ts:15`), `isNotImplemented` (`:48`), a dead arm in `toTRPCError` (`:60`), five
unreachable guards (`features.ts:311`, `projects.ts:173`, `:185`, `launcher/launcher.ts:339`,
`mcp/server.ts:344`), the whole `projects.ts:166-190` "B2 tolerance" block, every
`branchReady === false` path, and four stale comments (`trpc/context.ts:10`,
`trpc/routers/feature.ts:55`, `:168`, `:192`) plus `docs/SPEC.md:97,110,212`. The launcher and MCP
scopes will each report a fragment — **decide once in `errors.ts`**, delete outward.

**H3. `primitive-obsession:event-type` — named by 4/5.** See G1. Suspected shared module:
`EVENT_TYPES` const + `EventType` union in `@runcastle/core`, typing both `EmitInput.type` and
`EventRow.type`; companion half is a per-type schema for `data`, which is re-narrowed by hand at
`prep.ts:97`, `notifications.ts:74` and throughout `feature-ui.ts`. **The web scope will report
the mirror image** (parsing `data` blind, matching type strings). Highest-leverage single change
found anywhere in this audit.

**H4. `non-atomic:multi-row-writes` + `missing-constraint:seq-uniqueness` — named by 2/5, verified
repo-wide by the orchestrator.** `ctx.db.transaction(` appears **once** in all of
`packages/server/src`. Sibling scopes (burner, launcher, sessions) almost certainly have their
own instances. Ask each: does any multi-row write survive a mid-sequence throw? Paired with the
missing `(feature_id, seq)` unique index, which turns a race into silent data corruption rather
than an error.

**H5. `latent-bug:singleton-toctou` — named by 2/5.** Module-global mutable state checked and then
acted on across `await`s: `git.ts:1344 testDriveState` (three windows), and by inspection the same
shape wherever a sibling holds a registry (PTY registry, run controller map, session registry).
**Question for the parent: does this repo have any async mutex primitive?** If not, this is one
repo-wide finding, because all these operations contend for the same physical resource — the
user's single working copy.

**H6. `stale-path:worktree-vs-checkout` — named by 2/5.** `feature-docs.ts:19`
`existsSync(worktree) ? worktree : project.repoPath` is re-evaluated per call, so a feature's docs
resolve to different directories before and after a session launches. `scaffoldDocs` can write
`brief.md` to the checkout and every later read resolves to the worktree. Reachable from
`knowledge.ts`, `mcp/server.ts:546,550`, and — the sharp end — **`services/gates.ts`**, whose
decisions.md/spec.md checks a mis-resolve would wrongly pass or block. Compounded by D7
(`commitDocs` committing to whichever branch the path's HEAD is on).

**H7. `no-auth:local-server` — named by 1/5 but orchestrator-verified and severe.**
`Bun.serve({ port, fetch, websocket })` (`index.ts:105-112`) specifies **no `hostname`**, so it
binds all interfaces; there is exactly one `publicProcedure` and **no** `protectedProcedure`, auth
middleware, or `hostname` anywhere in `packages/server/src` **[verified]**, and no auth decision
in `SPEC.md`/`CONTEXT.md`. Unauthenticated LAN reach from this scope alone: `project.browse`/
`roots` → whole-filesystem directory listing (`fsbrowse.ts:169`, unconfined by design for the
picker, which assumed localhost); `docs.read` → arbitrary read under any feature docs dir;
`settings.update` → rewrite `~/.runcastle/config.json` and the model/sandbox future agents run
under; `setup.gitIdentity` → rewrite host git identity; `setup.afkToken` → overwrite the stored
credential; `setup.startTerminal` → spawn a process. Credential type only: a Claude Code OAuth
token at `~/.runcastle/.env` (`setup.ts:19,299,327`); no value read or reproduced. Related:
`trpc/routers/setup.ts:82` hands `env: process.env` to a user-visible terminal. **Mitigation is
one line — `hostname: '127.0.0.1'`.** The PTY/WebSocket surface belongs to a sibling; this needs
a single repo-wide decision, not per-scope patches.

**H8. `dead-code:over-exports` — named by 3/5.** 14 confirmed in this scope (list in B), and no
lint step exists to catch them. If the tree confirms more, propose **one mechanical
`knip`/`ts-prune` sweep** rather than N one-line diffs. Note the vetting rule that saved a false
positive here: an exported *return type* of an exported function is legitimate surface.

**H9. `inconsistent:error-taxonomy` — named by 2/5.** `GateError` (412) vs `InvalidInputError`
(400) used interchangeably for "this row is terminal" (`waypoints.ts:178` vs `tickets.ts:138`);
two raw untyped `throw new Error` in `git.ts:249`/`:326`. Worth one repo-wide rule (`GateError` =
pipeline gate only) rather than piecemeal fixes. Ask the launcher/MCP/workflows scopes whether
they use the domain classes at all.

**H10. `redundant:err-msg` + `bespoke:small-helpers` — named by 2/5.** `errMsg` defined verbatim
4× and inlined 4× more across services, launcher, dev and mcp. Alongside it: hand-rolled semver
(`update-check.ts:29-68`), dotenv upsert with no CRLF handling on a Windows-first product
(`setup.ts:55-70`), timeout-less `fetch` (`:93`), unvalidated `JSON.parse`
(`settings.ts:264`, `setup.ts:177`). Suspected shared modules: **`errMsg` in `src/errors.ts`**,
**`fetchWithTimeout`**, **`parseJsonFile(path, schema)`**.

**H11. `doc-drift:spec-vs-code` — named by 3/5.** [verified] `docs/SPEC.md §4` documents 18 tRPC
procedures against 59 in code, two of them nonexistent (D17); `SPEC.md:374` documents
`loopBackPhase`/`rethinkPhase`, which nothing calls; `SPEC.md:97,110,212` documents
`NotImplementedError` as live. The SPEC calls itself a pin and `CLAUDE.md` calls its names law,
so the drift is load-bearing for anyone using it as the contract. Every sibling scope should
diff its own section.

**H12. `wrong-tool:git-porcelain-parsing` — named by 1/5, flagged for the tree.** Git text output
parsed without `-z`/`core.quotepath=false` at 6+ sites, so non-ASCII paths surface to users as
octal escapes. `encoding.test.ts` exists because this repo has been bitten by encoding before —
but it covers MCP/HTTP/sqlite and never git. **If any sibling scope (doctor, scripts) also shells
out and parses text output, this becomes one finding.**

**H13. `redundant:test-harness` — named by 1/5, but sited repo-wide.** `initRepo` verbatim in 16
files, `mkTmp`+teardown ×10, HOME/USERPROFILE swap ×8, the caller line ×16, against a 72-line
`test/helpers/`. The proposed shape is `test/helpers/{git,tmp,home,caller,migrations,scenario}.ts`
— **but site it only after the core and web leaves report.** If they also hand-roll a ctx/fixture
preamble, the right answer is a `@runcastle/test-fixtures` workspace package, not six files under
server. Merge on this key before deciding. Related and cheap: `fixtures.ts:11 tmpRepo` registers
no cleanup, so all 41 files leak a temp dir per test.

**H14. `fragile:test-env-isolation` — pass to core and web.** The root `vitest.config.ts` (4
lines, no `setupFiles`) covers `packages/*/test` **and** `apps/*/test`, so any module that
resolves env at import time is exposed suite-wide — `migrate.ts:22-25` is the server's instance,
hit by ~47 files. Ask the core and web leaves whether they have module-load-time env resolution
too; one `setupFiles` firewall fixes all of them and retires the known "unset `RUNCASTLE_*`
first" footgun.

**H15. `coupled-to-impl:test-only-exports` — a module-depth signal, not a test bug.** 24 of 62
exports on `workflows/ticket-burner.ts` (2245 lines) have no `src/` importer other than their own
file, plus 22 more across `services/*` — verified per symbol. This is **independent evidence for
the same seams** H8 and G5 identify from the source side: a module that must export two dozen
internals to be testable is telling you where its real sub-modules are. Hand the symbol list to
whoever audits `ticket-burner.ts` (sibling scope) and cross-check against `git.ts` (2117 lines) and
`features.ts` (950 lines).

**H16. `fragile:platform-skips` — pass to the PTY/launcher scope.** `src/pty/**` is effectively
source-reviewed only on Windows: `dry-run-drive.test.ts:66` hardcodes `/bin/sh` in its PTY probe,
so the PTY paths always skip on the product's primary platform, and `canon.test.ts:8` returns
early on win32 while reporting green. Any scope relying on "the tests pass on Windows" as
evidence should re-check what actually ran.

---

## Test quality (see `server-brain-tests.md` for the full assessment)

**Framing first, because two plausible hypotheses were checked and disproved.** The suite is
**not** over-mocked: **zero `vi.mock` across all 79 files**, two `vi.spyOn`, zero snapshots, four
`toBeDefined()` and one `toHaveBeenCalledTimes` in ~17.2k lines. Tests call real services against
real in-memory SQLite, and 16 files drive real git. And the merge-conflict path **is** tested
(`merge-conflict.test.ts:86-103` asserts the return value, the `merge.conflict` event, and that
no ship occurs). This is well above average work; the findings below are gaps, not sloppiness.

**The structural hole.** `src/index.ts:26 buildApp` is documented at `index.ts:20-24` as *the*
test seam — "a pure function of the DI context so tests can mount the full app" — and is imported
by **no test**. `live-stream.test.ts:18-21` records why: importing `src/index` drags in
`bun:sqlite`, which vitest's node runtime cannot load. So `/health`, the `/api/trpc/*` UTF-8
charset middleware (`index.ts:46-51`) and boot-time `setRuntimeCtx` are uncovered, and six files
hand-re-implement slices of `buildApp`. Splitting `src/app.ts` out of `src/index.ts` would make
the documented seam real — two adapters for it already exist.

Gaps concentrated exactly where the findings above are:

- **No concurrency test anywhere**, so every H5 TOCTOU window is unexercised. `git.test.ts:538`
  awaits the first drive start before the second; `waypoints.test.ts:148` "fails a double-claim"
  is sequential, so the transactional claim's actual race is untested.
- **No transaction/rollback test at all** — `grep -rniE rollback test/` returns nothing. The four
  tests that look transactional (`lap-guards.test.ts:21`, `:157`, `waypoints.test.ts:127`)
  exercise hand-rolled compensating writes, not `db.transaction`. `findings.ts:112-114` calls
  value/provenance divergence load-bearing and only the happy path is asserted. This is the
  direct reason H4 could rot unnoticed.
- **Driver divergence**: prod runs bun:sqlite, tests run sql.js (`db/client.ts` vs
  `test/helpers/db.ts`), so transaction semantics, WAL and concurrency are structurally invisible.
  Useful nuance: all 19 `drizzle/*.sql` files contain **zero `REFERENCES`**, so
  `client.ts:18`'s `PRAGMA foreign_keys = ON` is currently inert and sql.js's default-off costs
  nothing *today* — but `lap-stamping.test.ts:65-68` already inserts orphan rows, so the first
  migration that adds a real FK breaks these tests. (This also explains D13: nothing rejects the
  `'global'` sentinel because the schema has no foreign keys at all.)
- **Silent platform skips on a Windows-first product.** `canon.test.ts:8,15` — the whole 19-line
  file returns early on win32 and *reports as passed*. `dry-run-drive.test.ts:66` hardcodes
  `/bin/sh` in its `ptyAvailable()` probe, so `PTY=false` always on Windows and `:255`/`:341`
  skip. Also `dev-pane.test.ts:39,94,99,106,173`, and `fsbrowse.test.ts:127,141` `catch { return }`
  on the two Windows-junction regressions. Coverage on Windows is materially lower than the green
  run suggests.
- **No test asserts a tRPC error `code`** anywhere, so `errors.ts:58-71` + `trpc/context.ts:19-26`
  — the mapping every client depends on — is unverified. There is no `test/errors.test.ts`.
- **Router coverage**: `docs`, `events`, `run`, `settings`, `setup` have no caller test at all;
  `feature` covers 6 of 21 procedures. `routers/settings.ts:15,19` is structurally untestable —
  it drops the `io` seam that `settings.test.ts:43` depends on.
- **Untested mutators that write to the user's machine**: `ensureProjectWorktree`,
  `landProjectBranch`, `allowPushToCheckedOutBranches`, `detectDbDrift`, `dirtyPaths`;
  `latestEventTs`/`latestTsByFeature` have zero direct tests despite feeding the sidebar stamp and
  the ship date; the nested `stepModels` violation, a corrupt `config.json` and a hanging fetch
  are all uncovered. `migrationPaths` is pure and is the cheapest test in the scope.
- **No non-ASCII path anywhere in the git tests** (H12).
- **Tests pinning defects**: `settings.test.ts:254` asserts the global-settings event exists *by
  hard-coding the `'global'` sentinel* — needing the magic string is itself the proof no ordinary
  reader can reach those rows (D13). `lap-stamping.test.ts` pins the write-only `events.lap`
  column (B). `feature-create.test.ts:85` pins docs-committed-to-the-wrong-branch (D7) as if
  intended.
- **Harness duplication**: `initRepo` appears verbatim in **16 files**; `mkTmp`+teardown ×10;
  HOME/USERPROFILE swap ×8; the caller line ×16 — against a `test/helpers/` that is 72 lines
  total. And `fixtures.ts:11 tmpRepo` never registers cleanup while `seedProject` calls it by
  default, so **all 41 files leak a temp dir per test**.
- **Env-isolation fragility**: the root `vitest.config.ts` is 4 lines with no `setupFiles`, while
  `migrate.ts:22-25` resolves `RUNCASTLE_MIGRATIONS_DIR` at **module load**, affecting ~47 files.
  Only `asset-paths.test.ts:22-24` defends, and only in `afterEach` — so its own first test is
  exposed. This is the mechanism behind the known "unset `RUNCASTLE_*` or get phantom failures"
  footgun; a `setupFiles` env firewall would retire it.
