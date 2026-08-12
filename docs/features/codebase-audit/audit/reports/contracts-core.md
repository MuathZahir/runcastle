# Audit report — `packages/core` (contracts)

Leaf agent. Scope: every file in `packages/core/src` + `packages/core/test` +
`package.json`. Analysis only; no source edited.

Every claim below cites `file:line` and quotes the hunk. Verification commands used
for dead-code claims are named inline.

---

## A. Flow map

`@runcastle/core` is 10 source files / ~1.5k lines. Three entry points, declared in
`packages/core/package.json:6-10`:

```json
"exports": {
  ".": "./src/index.ts",
  "./paths": "./src/paths.ts",
  "./config-load": "./src/config-load.ts"
}
```

**Dependency graph (no cycles):**

```
index.ts (barrel, browser-facing)
 ├── ids.ts          -> nanoid
 ├── schemas.ts      -> zod                       [source of truth for wire types]
 ├── blocking.ts     -> (nothing)                 [pure algorithm]
 ├── pipeline.ts     -> type Phase from schemas
 ├── db-schema.ts    -> drizzle-orm/sqlite-core + type-only from schemas
 ├── workflow.ts     -> type Feature/Project/Ticket from schemas
 └── config.ts       -> zod                       [pure schema + 3 resolvers]

paths.ts             -> node:os, node:path        [NOT in barrel]
config-load.ts       -> node:fs, ./config, ./paths [NOT in barrel]
```

**Who consumes what (verified value-imports, `rg "^import \{...\} from '@runcastle/core'"`
over `packages/server/src` + `apps/web/src`):**

| Consumer | Imports |
|---|---|
| `packages/server/src/db/schema.ts:1-12` | all ten drizzle tables (re-export barrel) |
| `packages/server/src/services/tickets.ts:2`, `waypoints.ts:2` | `BlockingEdgeError`, `newId`, `resolveBatchBlocking` |
| `packages/server/src/services/gates.ts:3` | `nextPhase`, `previousPhase` |
| `packages/server/src/services/features.ts:12` | `RETHINK_LOOP_BACK`, `REVIEW_LOOP_BACK`, `newId`, `nextGate`, `nextPhase` |
| `packages/server/src/workflows/{ticket-burner,research,runner}.ts` | `newId`, `resolveModel`, `resolvePreparedSettings`, `resolveSandboxImage`, `nextGate`, `nextPhase` |
| `apps/web/src/lib/settings.ts:1` | `CURATED_MODELS`, `DRIVE_LOOP_KEYS`, `MODEL_STEPS` |
| everything else | **`import type` only** — the zod objects are used as TS types, never parsed |

That last row is the single most important structural fact about core and drives
most of section D.

---

## B. Dead code

### B1. `loopBackPhase` — verified dead export
**`violation` · key `dead:pipeline-loopback` · confidence HIGH**

`packages/core/src/pipeline.ts:118-124`:

```ts
/**
 * The phase a review-phase burn loops back to (`implementation`), or null from
 * any other phase — the pure model behind the server's burn-from-review guard.
 */
export function loopBackPhase(feature: { phase: Phase }): Phase | null {
  return feature.phase === REVIEW_LOOP_BACK.from ? REVIEW_LOOP_BACK.to : null
}
```

Search run: `rg -n --glob '!node_modules' -w "loopBackPhase" .` — **every hit** is
either `docs/SPEC.md:374`, `packages/core/test/pipeline.test.ts` (6 hits), or the
declaration itself. Zero hits in `packages/server`, `apps/web`, `packages/design-system`,
`packages/skills`, `scripts`, `site`.

The doc comment claims it is "the pure model behind the server's burn-from-review
guard". The server does not call it — it inlines the same logic against the constant,
`packages/server/src/services/features.ts:496` and `:515`:

```ts
setPhase(ctx, featureId, REVIEW_LOOP_BACK.to, 'burn.started', 'burn from review — iterating')
...
        REVIEW_LOOP_BACK.from,
```

So the function is dead **and** its stated contract is a lie about the codebase.

### B2. `rethinkPhase` — verified dead export
**`violation` · key `dead:pipeline-loopback` · confidence HIGH**

`packages/core/src/pipeline.ts:142-148`:

```ts
export function rethinkPhase(feature: { phase: Phase }): Phase | null {
  return feature.phase === RETHINK_LOOP_BACK.from ? RETHINK_LOOP_BACK.to : null
}
```

Search run: `rg -n --glob '!node_modules' -w "rethinkPhase" .` — hits are only
`docs/SPEC.md:374`, `docs/SPEC.md:464` and `packages/core/test/pipeline.test.ts`.
The server again inlines it, `packages/server/src/services/features.ts:541,567`:

```ts
  if (feature.phase !== RETHINK_LOOP_BACK.from) {
...
  return setPhase(ctx, featureId, RETHINK_LOOP_BACK.to, 'lap.started', `rethink — lap ${lap}`)
```

Note `docs/SPEC.md:464` lists "Vitest: `rethinkPhase` transition" as a test
requirement — which is satisfied, and is exactly why the dead function survives:
it has a test but no caller. **A test is not a caller.**

Counter-evidence for the sibling: `previousPhase` (`pipeline.ts:98`) IS live —
`packages/server/src/services/gates.ts:3,224`. I initially mis-flagged it and
re-verified. Only the two loop-back helpers are dead.

### B3. `SettingSource` / `SettingScope` — exported zod enums with no external consumer
**`violation` · key `dead:settings-enums` · confidence HIGH**

`packages/core/src/schemas.ts:419` and `:423`:

```ts
export const SettingSource = z.enum(['env', 'project', 'file', 'default'])
export const SettingScope = z.enum(['global', 'project'])
```

Search run: `rg -n --glob '!node_modules' -w "SettingSource"` (and `SettingScope`) —
the only hits are the declaration, its `z.infer` type alias, and the field reference
inside `SettingField` (`schemas.ts:435`, `:438`). Nothing outside `schemas.ts`
references either name. `SettingField` itself is live (6 files), so the *types* flow
through structurally — the exported runtime enum objects are dead weight.

### B4. Type-only exports never named outside their declaring file
**`judgement call` · key `dead:internal-types` · confidence MEDIUM**

Verified zero external references (same `rg -w` method):

| Symbol | Site |
|---|---|
| `BatchBlockingEdges` | `packages/core/src/blocking.ts:19` |
| `ResolvedBlockingEdges` | `packages/core/src/blocking.ts:25` |
| `ResolveBatchBlockingOptions` | `packages/core/src/blocking.ts:32` |
| `CuratedModel` | `packages/core/src/config.ts:34` |
| `PhaseDef` | `packages/core/src/pipeline.ts:25` (only other hit: `docs/SPEC.md:51`) |

These are param/return/element types that callers get structurally. Exporting them
is defensible API hygiene, so this is a judgement call, not a deletion demand — but
it means five of core's exported names are unreachable surface.

---

## C. Redundancy

### C1. `WaypointDisposition` is declared three times
**`violation` · key `duplicated:enum-lists` · confidence HIGH**

Declaration 1 — `packages/core/src/schemas.ts:162`:
```ts
export const WaypointDisposition = z.enum(['resolved', 'dropped'])
```

Declaration 2 (implicit, the terminal subset) — `packages/core/src/schemas.ts:158`:
```ts
export const WaypointStatus = z.enum(['open', 'claimed', 'resolved', 'dropped'])
```

Declaration 3 (hand-written inline union) — `packages/core/src/workflow.ts:47`:
```ts
  resolveWaypoint(id: string, disposition: 'resolved' | 'dropped', summary: string): void
```

`workflow.ts` already imports from `./schemas` (line 1), so the third one is a
gratuitous re-spelling of a type it could name. Nothing links declaration 1 to
declaration 2, so adding a fifth waypoint status that should be terminal requires
remembering two files.

### C2. `MODEL_STEPS` duplicates `SessionKind` with no type link
**`violation` · key `duplicated:enum-lists` · confidence HIGH**

`packages/core/src/schemas.ts:58-66`:
```ts
export const SessionKind = z.enum([
  'ideation', 'qa', 'waypoint', 'converge', 'revisit', 'prepare', 'project',
])
```

`packages/core/src/config.ts:18-29`:
```ts
export const MODEL_STEPS = [
  'ideation', 'qa', 'waypoint', 'converge', 'revisit',
  'research', 'implement', 'prepare', 'project', 'smoke',
] as const
```

`MODEL_STEPS` ⊇ `SessionKind` exactly (all 7 kinds, plus `research`/`implement`/`smoke`
for AFK agents). That containment is the actual invariant and it is enforced by
nobody: adding an eighth `SessionKind` silently produces a session kind with no
configurable model, and `resolveModel` (`config.ts:337`) will not accept it.

The repo already knows the fix and applies it one line away — `packages/core/src/schemas.ts:265-270`:
```ts
export const DRIVE_LOOP_KEYS = [
  'devCommand', 'driveSetupCommand', 'driveStopCommand', 'driveEnv',
] as const satisfies readonly PreparedKey[]
```
`satisfies` is used for `DRIVE_LOOP_KEYS` and for nothing else. This is the same
smell as C3.

### C3. `PREPARED_KEYS` duplicates eight `Project` fields, unlinked
**`violation` · key `duplicated:enum-lists` · confidence HIGH**

`packages/core/src/schemas.ts:241-250`:
```ts
export const PREPARED_KEYS = [
  'setupCommand', 'verifyCommands', 'knownFailures', 'devCommand',
  'driveSetupCommand', 'driveStopCommand', 'driveEnv', 'dbResetCommand',
] as const
```

Each string must be a key of `Project` (`schemas.ts:302-320`) — the doc comment at
`:237` says so explicitly ("Each maps 1:1 to a project column") — and each must have a
matching drizzle column (`db-schema.ts:45-61`). Three parallel lists, one `as const`,
zero `satisfies readonly (keyof Project)[]`.

### C4. `GateId` string literals are maintained in two places
**`judgement call` · key `duplicated:gate-ids` · confidence MEDIUM`**

`packages/core/src/pipeline.ts:9`:
```ts
export type GateId = 'G1' | 'G2' | 'G3' | 'G4' | 'G5'
```
and again as the five `id:` fields inside `PIPELINE` (`pipeline.ts:38, 45, 53, 61, 69`).
`GateId` could be derived (`(typeof PIPELINE)[number]['gateToEnter']`), or `PIPELINE`
could be the sole declaration. Adding G6 today edits two spots in one file — mild,
but it is the same "hand-maintained twin" pattern as C1–C3.

### C5. Path knowledge core owns is hand-rebuilt by the server (2 sites)
**`violation` · key `duplicated:path-knowledge` · confidence HIGH**

Core owns it — `packages/core/src/paths.ts:124-127`:
```ts
/** Feature docs location relative to the TARGET repo (forward slashes). */
export function featureDocsRel(slug: string): string {
  return `docs/features/${slug}`
}
```

Bypassed at `packages/server/src/routes/hooks.ts:352`:
```ts
    `docs: docs/features/${feature.slug}/ (brief.md, decisions.md, spec.md)`,
```
(`packages/server/src/launcher/artifacts.ts:107` does it correctly:
`const docs = featureDocsRel(feature.slug) // docs/features/<slug>`.)

Second site — `packages/server/src/config.ts:26` builds the worktrees ROOT by hand:
```ts
  mkdirSync(join(root, 'worktrees'), { recursive: true })
```
Core exposes `projectWorktreesDir(projectId)` (`paths.ts:84`) but no parent
`worktreesDir()`, so the literal `'worktrees'` lives in two packages. Small gap in
an otherwise well-centralised module (see F: `paths.ts` is core's second-best module).

I searched for wider leakage — `rg "'\.runcastle|\"\.runcastle|homedir\(\)" packages apps scripts`
excluding core — and found no other hand-built data-dir paths in product code. The
remaining `homedir()` uses (`packages/server/src/services/fsbrowse.ts:78,104,169`) are
the user's home for the repo browser, not the data dir. **Path ownership is otherwise clean.**

---

## D. Inconsistencies & structural smells

### D1. The zod schemas are never executed — "single source of truth" is aspirational
**`violation` · key `unvalidated:db-boundary` · confidence HIGH — biggest finding in core**

`packages/core/src/schemas.ts:3-9` states the contract:
```ts
/**
 * Wire types for tRPC and MCP. Every schema here is the single source of
 * truth; drizzle tables (db-schema.ts) mirror these shapes.
 */
```

Two searches say otherwise:

1. `rg -n "\b(Ticket|Feature|Project|SessionRow|EventRow|Waypoint|TestNote|Run|ProjectFinding)\.(safe)?[Pp]arse\(" packages/server/src apps/web/src`
   → **0 results.** No row schema is ever parsed at runtime, anywhere.
2. `rg -n "\.output\(" packages/server/src/trpc | wc -l`
   → **0.** No tRPC procedure declares an output schema.

The row schemas are consumed exclusively via `import type` (see the flow map table).
The zod runtime objects for `Ticket`, `Feature`, `Project`, `SessionRow`, `Run`,
`Waypoint`, `TestNote`, `EventRow`, `ProjectFinding` therefore ship and are never
called. The only schemas actually parsed are the *input* ones (`TicketInput`,
`WaypointInput`, `ProjectName`, `WaypointDisposition`, `SettingsUpdateInput` via
MCP/tRPC `.input()`) and `RuncastleConfig` (`config-load.ts:65`).

Consequence: the SQLite→TypeScript boundary is unvalidated. Everything typed as
`Phase`/`TicketStatus`/`SessionKind` is a claim, not a check.

The codebase already paid for this once. `packages/core/src/schemas.ts:23-32`:
```ts
/**
 * Read a phase from a value this build may not recognize — a row written by a
 * newer server, a hand-edited column, a corrupt import. ...
 * Every downstream reader types `phase` as `Phase` and switches on it
 * exhaustively, which means ONE bad value falls through EVERY switch at once —
 * on the web that rendered the whole app as a blank page (findings F19).
 */
export function parsePhase(value: unknown): Phase | null {
```

`parsePhase` is the fix, applied to exactly one of the twelve enum columns. Every
other one — `tickets.status`, `sessions.kind`, `sessions.status`, `features.status`,
`runs.status`, `waypoints.status`, `waypoints.type`, `test_notes.status`,
`project_findings.source` — has the identical failure mode and no equivalent guard.

### D2. `$type<>()` is a compile-time cast; the enum option and CHECK constraints are unused
**`violation` · key `unvalidated:db-boundary` · confidence HIGH**

Every enum column in `db-schema.ts` uses the same pattern, e.g. `db-schema.ts:113`:
```ts
  phase: text('phase').notNull().$type<Phase>(),
```
and `:203`, `:167`, `:170`, `:121`, `:220`, `:232`, `:238`, `:248`, `:82`.

`$type<X>()` erases at compile time — drizzle emits `TEXT`, and the driver returns
whatever the row holds. The alternative drizzle offers, `text('phase', { enum: [...] })`,
which produces a genuine narrowing *and* (with `sqliteTable` CHECK support) a database
constraint, is used **0 times**. Confirmed by grep: no `enum:` option and no CHECK
constraint anywhere in `db-schema.ts`.

Combined with D1, nothing at any layer — database, ORM, wire, or UI — rejects a bad
enum value. Getting one is not hypothetical: the module's own doc comment lists three
ways (`schemas.ts:24-25` — "a row written by a newer server, a hand-edited column, a
corrupt import").

### D3. Five concrete zod ↔ drizzle divergences
**`violation` · key `drift:zod-drizzle` · confidence HIGH**

I compared every drizzle column against its zod counterpart field-by-field. Nullability,
boolean-as-integer, timestamps and JSON columns are **consistent everywhere** (see D4 —
credit where due). The divergences are all *missing fields*:

| # | Drizzle | Zod | Nature |
|---|---|---|---|
| 1 | `projects.sandbox` — `db-schema.ts:32` `sandbox: text('sandbox'),` | absent from `Project`, `schemas.ts:302-320` | column with no wire field |
| 2 | `projects.closedAt` — `db-schema.ts:36` `closedAt: integer('closed_at'),` | absent from `Project`, `schemas.ts:302-320` | column with no wire field |
| 3 | `sessions.lap` — `db-schema.ts:166` `lap: integer('lap').notNull().default(1),` | absent from `SessionRow`, `schemas.ts:380-397` | column with no wire field |
| 4 | `events.lap` — `db-schema.ts:268` `lap: integer('lap').notNull().default(1),` | absent from `EventRow`, `schemas.ts:462-473` | column with no wire field |
| 5 | `gate_overrides` — whole table, `db-schema.ts:275-281` | **no zod schema exists at all** | table with no wire type |

Plus one inverse (zod field with no column), which is legitimate but undocumented as
such — `packages/core/src/schemas.ts:343`:
```ts
  staleCommits: z.number().optional(),
```
is computed (`git rev-list <sha>..<main>`, per `db-schema.ts:72`), not stored. And
`project_findings.projectId` (`db-schema.ts:79`) has no `ProjectFinding` field, because
the API returns findings already scoped. So `ProjectFinding` is a *view* type wearing a
row type's name.

**Severity assessment.** #2 is the sharpest: `closedAt` drives the entire multi-project
open/close feature — `packages/server/src/services/projects.ts:40` (`isNull(projects.closedAt)`),
`:89`, `:107`, `:131` — and the wire type says the field does not exist. Any consumer
typing a project as `Project` cannot see whether it is closed. #3/#4 are currently
harmless (I checked: `rg "\.lap\b" apps/web/src` returns only `feature.lap`, which IS in
the zod `Feature` at `schemas.ts:367`), but they are the exact fields a future lap-trail
UI needs. #5 means `gate.overridden` has no contract at all, which is what enables E2.

Because nothing parses (D1), each of these is invisible to tests and to `tsc` —
which is precisely why they accumulated.

### D4. What IS consistent (verified, stated so the above is not read as blanket drift)

- **Timestamps**: every one is `integer(...)` ↔ `z.number()` epoch-ms. No `Date`, no ISO
  string, no mixed representation. `features.createdAt` / `Feature.createdAt`,
  `runs.startedAt`/`endedAt`, `test_notes.createdAt`/`updatedAt`, `events.ts`,
  `project_findings.establishedAt`/`verifiedAt`. Matches the stated rule at `schemas.ts:7-8`.
- **Booleans**: both use `{ mode: 'boolean' }` ↔ `z.boolean()` — `features.mapped`
  (`db-schema.ts:105`) and `sessions.awaitingInput` (`db-schema.ts:181`). No int-as-bool leakage.
- **JSON**: all six use `{ mode: 'json' }` with matching `$type` and zod array types
  (`tickets.acceptanceCriteria/seams/blockedBy/commits/conflictFiles`, `waypoints.blockedBy`,
  `events.data`). Nullability matches (`conflictFiles` nullable ↔ `.optional()`).
- **Nullability**: every nullable column has an `.optional()` twin and vice versa, for
  every field that exists on both sides.

The mirroring discipline is genuinely good. The gap is that it is maintained by hand
with no mechanism, so the five holes in D3 opened silently.

### D5. `project_findings.key` is the one enum column with no `$type` cast
**`violation` · key `inconsistent:column-typing` · confidence HIGH**

`packages/core/src/db-schema.ts:80-82`:
```ts
    /** The prepared field this describes (a `PreparedKey`). */
    key: text('key').notNull(),
    source: text('source').notNull().$type<FindingSource>(),
```

The line below it casts. This one — which stores a `PreparedKey`, and says so in its
own doc comment — does not. Its zod twin does type it: `schemas.ts:338` `key: PreparedKey,`.
So the field is `string` on read and `PreparedKey` on the wire type, and it is half of a
composite primary key (`db-schema.ts:96`). Same for `gate_overrides.gate`
(`db-schema.ts:277` `gate: text('gate').notNull(),`) which stores a `GateId`.

### D6. `GateId`/`GateCheckId` are plain TS unions while all 14 other enums are `z.enum`
**`violation` · key `inconsistent:enum-declaration` · confidence HIGH**

`packages/core/src/pipeline.ts:9-17`:
```ts
export type GateId = 'G1' | 'G2' | 'G3' | 'G4' | 'G5'

export type GateCheckId =
  | 'decisions-file-exists'
  | 'all-waypoints-terminal'
  ...
```

Every enum in `schemas.ts` and `config.ts` is a `z.enum` — 14 of them — which means they
carry a runtime `.safeParse` and `.options`. These two do not, so there is no way to
validate a gate id at a boundary even if someone wanted to.

The consequence is live, in the web — `apps/web/src/lib/feature-ui.ts:581`:
```ts
      forcedGate = ((e.data ?? {}) as { gate?: GateId }).gate ?? null
```

That is an unchecked cast of untyped event JSON (`EventRow.data: z.unknown()`,
`schemas.ts:471`) straight to `GateId`. With a `z.enum` this would be
`GateId.safeParse(...)`. With `gate_overrides.gate` being bare `text()` (D5) and no zod
schema for the table at all (D3 #5), the value is unconstrained end to end.

### D7. `EventRow.type` is stringly typed and switched on across the UI
**`judgement call` · key `stringly:event-type` · confidence MEDIUM**

`packages/core/src/schemas.ts:469` and `db-schema.ts:270`:
```ts
  type: z.string(),
  ...
  type: text('type').notNull(),
```

Events are the UI's lifeblood per CLAUDE.md ("`events.list` is polled at 1.5s"), and the
web branches on literal type strings — `feature-ui.ts:580` `if (e.type === 'gate.overridden')`.
A typo in an emitter produces an event no reader will ever match, and neither `tsc` nor a
test can see it. The paired `data: z.unknown()` (`schemas.ts:471`) means the payload shape
per type is also uncontracted, which is what forces the cast in D6.

This is a judgement call because an open event vocabulary is a defensible design (new
event types without a core edit) — but then the *consumed* subset deserves a discriminated
union, and today there is neither.

### D8. Doc drift: CLAUDE.md points at the wrong file for core's only file read
**`violation` · key `docdrift:claude-md-core-io` · confidence HIGH**

`CLAUDE.md` (Package map section) states:

> `@runcastle/core` is the only package with no IO (except `paths.ts` pure path
> computation and `config.ts` lazy file read inside `loadConfig`).

`packages/core/src/config.ts` contains no IO and no `node:` import — verified by
`rg "node:|process\.|readFile|existsSync" packages/core/src/config.ts` (only doc-comment
mentions). Its own header says so, `config.ts:4-8`:
```ts
 * Runtime configuration schema. This module is PURE — no IO and no `node:`
 * imports — so it is safe to include in the browser-facing core barrel
 * (`index.ts`). The file-reading loader (`loadConfig`) lives in `./config-load`,
```

The read is in `packages/core/src/config-load.ts:21-23`:
```ts
  if (existsSync(path)) {
    try {
      fileConfig = JSON.parse(readFileSync(path, 'utf8'))
```

The code was split into pure/loader after CLAUDE.md was written; the doc still names the
pre-split file. Build-era document, so this is drift, not a bug — but it is drift on the
one invariant CLAUDE.md asserts about core, so it is worth correcting.

### D9. The barrel's browser-safe invariant holds — with an unstated caveat
**`judgement call` · key `bundle:drizzle-in-browser` · confidence MEDIUM**

`packages/core/src/index.ts:1-8` states the invariant:
```ts
// must not transitively import any Node builtin, because the bundler externalizes
// those to a default-only stub and named imports would throw at module-eval time.
```

**The invariant holds.** Verified: `rg "node:|process\.env|Date\.now|Math\.random|crypto|require\(|globalThis" packages/core/src`
returns node imports at only `config-load.ts:1` (`node:fs`) and `paths.ts:1-2`
(`node:os`, `node:path`), plus `process.env` at `config-load.ts:17`, `paths.ts:34`,
`paths.ts:44`. Neither file is in the barrel (`index.ts:10-16` lists ids, schemas,
blocking, pipeline, db-schema, workflow, config), and `package.json:6-10` backs it with
dedicated subpath exports for exactly those two files. No `Date.now`, no `Math.random`,
no `crypto` anywhere in core — id generation delegates to `nanoid` (`ids.ts:8`) and every
timestamp is supplied by the caller. Core is genuinely IO-free and genuinely deterministic.

One unmeasured item — `process.platform` at `paths.ts:57`:
```ts
    return process.platform === 'win32' ? abs.toLowerCase().replace(/\//g, '\\') : abs
```
A third `process` access beyond the two `process.env` reads the docs mention. Harmless
(node-only file) but it makes `sameDataDir` untestable for the other platform without
stubbing — visible in the test, which sidesteps it with `it.runIf`
(`packages/core/test/paths.test.ts:86,90`).

**The caveat the comment does not cover:** the barrel guards against *node builtins*,
not against *server-only dependencies*. `index.ts:14` re-exports `./db-schema`, which
imports `drizzle-orm/sqlite-core` (`db-schema.ts:1`). So every `apps/web` import of
`@runcastle/core` pulls drizzle's table-builder into the Vite bundle. It is pure JS so
nothing breaks — but `apps/web/package.json` does not list `drizzle-orm` (it resolves via
workspace hoist), and the web has zero use for ten SQLite table definitions. Splitting
`db-schema` onto its own subpath export would cost one line and match the treatment
`paths`/`config-load` already get.

### D10. The `satisfies`-link pattern is known and applied once out of four opportunities
**`judgement call` · key `inconsistent:invariant-enforcement` · confidence MEDIUM**

Cross-reference of C1/C2/C3/C4: four places where one list must stay a subset/keyset of
another. `DRIVE_LOOP_KEYS` (`schemas.ts:270`) uses `satisfies readonly PreparedKey[]`.
`MODEL_STEPS` vs `SessionKind`, `PREPARED_KEYS` vs `keyof Project`,
`WaypointDisposition` vs `WaypointStatus`, and `GateId` vs `PIPELINE` do not. Same
author, same file in two cases — the tool is on the shelf and mostly unused.

---

## E. Wrong-tool & weak typing

Preface, in core's favour: `rg "\bany\b|as any|@ts-ignore|@ts-expect-error|z\.any\(|passthrough"`
over `packages/core/src` returns **zero** real hits — every match is the English word
"any" in a doc comment. No `any`, no ts-ignore, no `.passthrough()`, no non-null `!`
assertions. The house rule (CLAUDE.md: "No `any` unless quarantined with a comment") is
fully honoured. The findings below are about *unvalidated* boundaries, not sloppy types.

### E1. LATENT BUG — an empty `RUNCASTLE_BURN_CONFLICT_ATTEMPTS` silently disables the conflict resolver
**`violation` · key `latentbug:env-empty-string` · confidence HIGH**

`packages/core/src/config-load.ts:48-51`:
```ts
  // Truthiness would swallow the meaningful `0` (disable in-loop resolution).
  if (env.RUNCASTLE_BURN_CONFLICT_ATTEMPTS !== undefined) {
    overrides.burnConflictAttempts = Number(env.RUNCASTLE_BURN_CONFLICT_ATTEMPTS)
  }
```

The comment correctly identifies why `!== undefined` is needed (to let an explicit `0`
through), but the guard now admits the empty string too: `Number('') === 0`, which passes
`z.number().int().min(0).max(3)` (`config.ts:216`) and lands as `burnConflictAttempts: 0`.
Per `config.ts:216-217` that means *"`0` disables it: conflicts go straight to the human"*.

An exported-but-empty env var — trivially produced by `export RUNCASTLE_BURN_CONFLICT_ATTEMPTS=`
in a shell profile, or by a CI matrix leaving a variable unset-but-defined — silently
turns off the in-loop conflict resolver, and the operator sees only that conflicts stopped
being auto-resolved. Every *other* numeric key in this file uses truthiness
(`config-load.ts:30,39,42,45,52`) and so is immune. This one key differs.

The sibling at `config-load.ts:56-58` uses the same `!== undefined` guard:
```ts
  if (env.RUNCASTLE_BURN_GUARD !== undefined) {
    overrides.burnGuard = env.RUNCASTLE_BURN_GUARD !== '0' && env.RUNCASTLE_BURN_GUARD !== 'false'
  }
```
There `''` yields `true` (guard on), which is the safe default — benign, but by luck
rather than by design.

### E2. Env parsing is 20 hand-rolled branches with three coercion idioms
**`violation` · key `wrongtool:env-parsing` · confidence HIGH**

`packages/core/src/config-load.ts:29-62` is a 34-line ladder. Three distinct idioms coexist:

```ts
  if (env.RUNCASTLE_MODEL) overrides.model = env.RUNCASTLE_MODEL                    // truthiness, string
  if (env.RUNCASTLE_BURN_CONCURRENCY) {                                             // truthiness, Number()
    overrides.burnConcurrency = Number(env.RUNCASTLE_BURN_CONCURRENCY)
  }
  if (env.RUNCASTLE_BURN_CONFLICT_ATTEMPTS !== undefined) {                          // presence, Number()
    overrides.burnConflictAttempts = Number(env.RUNCASTLE_BURN_CONFLICT_ATTEMPTS)
  }
  if (env.RUNCASTLE_BURN_GUARD !== undefined) {                                      // presence, bespoke bool
    overrides.burnGuard = env.RUNCASTLE_BURN_GUARD !== '0' && env.RUNCASTLE_BURN_GUARD !== 'false'
  }
```

Zod is the house schema library and handles all of this declaratively (`z.coerce.number()`,
`z.stringbool()`). Instead each new config field means a new hand-written branch and a
guess at which idiom to copy — which is how E1 happened. Secondary effect: `Number('abc')`
is `NaN`, and the resulting `RuncastleConfig.parse` throw (`config-load.ts:65`) names the
*config field*, not the env var the operator actually set.

Also note the env var list here is a fourth hand-maintained twin of the config schema
(after C2/C3): 20 of `RuncastleConfig`'s ~18 fields are wired, and nothing detects a field
added to `config.ts` without an env branch. `burnCpus` has one (`:52`), `burnWorkspace`
has one (`:62`), `sessionMcp` has one (`:36`) — all by hand.

### E3. `foldLegacyModelConfig` does typed object surgery through `Record<string, unknown>`
**`judgement call` · key `wrongtool:legacy-fold` · confidence MEDIUM**

`packages/core/src/config.ts:75-88`:
```ts
export const foldLegacyModelConfig = (raw: unknown): unknown => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw
  const obj = { ...(raw as Record<string, unknown>) }
  const legacy = obj.smokeModel
  if (typeof legacy === 'string' && legacy.length > 0) {
    const existing =
      typeof obj.stepModels === 'object' && obj.stepModels !== null && !Array.isArray(obj.stepModels)
        ? (obj.stepModels as Record<string, unknown>)
        : {}
    if (existing.smoke === undefined) obj.stepModels = { ...existing, smoke: legacy }
  }
  delete obj.smokeModel
  return obj
}
```

Two `as Record<string, unknown>` casts and four hand-written type guards to do what
`z.object({ smokeModel: z.string().optional(), stepModels: ... }).transform(...)` expresses
declaratively. Being a `z.preprocess` input (`config.ts:90-91`) forces the `unknown` in/out
signature, but the *body* could parse a permissive legacy schema first. It has good test
coverage (`test/config.test.ts:17-30`), which is why this is a judgement call.

### E4. `newId` returns bare `string` — primitive obsession across 22 files
**`judgement call` · key `stringly:ids` · confidence MEDIUM**

`packages/core/src/ids.ts:7-9`:
```ts
export function newId(prefix: string): string {
  return `${prefix}_${nanoid(12)}`
}
```

`rg -l -w newId` outside core → 22 files. Every id in the system — `featureId`,
`ticketId`, `projectId`, `runId`, `sessionId`, `waypointId`, `ticketId` on a test note —
is `z.string()` (`schemas.ts:120-121, 188-189, 219, 222, 303, 350-351, 381-383, 401-402,
464-467`). Nothing prevents passing a `featureId` where a `ticketId` is expected, and the
prefix that encodes the entity kind is decoration only.

The concrete hazard is visible in `Waypoint`, `schemas.ts:175` and `:192`:
```ts
  blockedBy: z.array(z.union([z.number(), z.string()])),   // WaypointInput: seq | id, mixed
  ...
  blockedBy: z.array(z.number()),                          // Waypoint: resolved to seq
```
A schema whose meaning depends on which of two same-named fields you hold, distinguished
only by `number` vs `string`. `newId` returning a branded `Id<'wp'>` would make the
resolution step type-visible.

### E5. `z.unknown()` payloads with no per-type contract
**`judgement call` · key `stringly:event-type` · confidence MEDIUM**

Three sites: `schemas.ts:434` (`SettingField.value`), `schemas.ts:471` (`EventRow.data`),
`workflow.ts:34` (`WorkflowCtx.input`). Each is genuinely polymorphic, so `unknown` beats
`any` — the gap is that no consumer-side parse exists, producing the raw cast at
`apps/web/src/lib/feature-ui.ts:581` (D6). `WorkflowCtx.input` documents the intent at
`workflow.ts:31-33` ("The research workflow reads the `Waypoint` it was started on from
here") — a discriminated union or a per-workflow generic would say that in types.

---

## F. Shallow modules

Deletion test applied to each of core's ten files.

| Module | Lines | Verdict |
|---|---|---|
| `blocking.ts` | 119 | **Deep — core's best module.** Interface is `resolveBatchBlocking(nodes, {startSeq, label})`; behind it sit range validation, self-reference rejection, and a three-colour DFS cycle detector (`blocking.ts:89-118`). Deletion test: two callers (`services/tickets.ts:2`, `services/waypoints.ts:2`) would each hand-roll cycle detection. Two adapters = **real seam**. Keep. |
| `paths.ts` | 128 | **Deep.** 15 functions, all derived from one `dataDir()` (`:43`) — redirecting that one function relocates db, config, env, logs, sessions, worktrees and caches together, which is exactly what `scripts/dev.ts` exploits. `sameDataDir` (`:54`) hides real Windows case/slash folding. Keep. |
| `pipeline.ts` | 177 | **Deep in principle, hollowed in practice.** `PIPELINE` (`:32-74`) is genuinely the pipeline-as-data, and `nextGate`'s mapped-G1 swap (`:168-177`) is real behaviour behind a small interface. But 3 of 8 exports are dead (B1, B2, B5) and the server bypasses the transition helpers for the raw constants (C5). Depth exists; callers declined it. |
| `schemas.ts` | 473 | **Data declaration, not a module.** Fine as such. But see D1 — 9 of its ~20 schemas are runtime-dead. |
| `db-schema.ts` | 281 | **Data declaration.** Fine. |
| `config.ts` | 344 | **Mixed.** `RuncastleConfig` is a deep schema (defaults, ranges, legacy fold). `resolvePreparedSettings` (`:305`) is deep — the empty-string-inherits rule at `:313-318` is a real invariant. `resolveModel` (`:337`) is deep — a 4-level precedence chain, 10 consumers. |
| `config.ts::resolveSandboxImage` | 3 | **Shallow but justified.** `config.ts:288-290` is `config.sandboxImage ?? DEFAULT_SANDBOX_IMAGE`. Deletion test: nothing vanishes mechanically — but the 9-line comment at `:273-281` records that the name previously drifted and produced "Image not found locally". The module's value is the *invariant*, not the code. Keep; classic case where shallow is correct. |
| `workflow.ts` | 55 | **Interface-only, deep by definition.** The contract between runner and workflows. Keep. |
| `ids.ts` | 9 | **Shallow, and passes anyway.** Deletion test: 22 files each write `` `feat_${nanoid(12)}` ``, and the id *format* (prefix, separator, length) becomes 22 independent decisions. Passes on locality. Weakened by E4 — a shallow module that could be deep by branding its return type, for the same nine lines. |
| `index.ts` | 17 | **Barrel.** Earns its keep via the browser-safety invariant it enforces (D9); should also exclude `db-schema`. |

**Adjacent (out of scope, noted because it consumes core):**
`packages/server/src/db/schema.ts` is a pass-through — it imports the ten tables from
core and re-exports the same ten names verbatim (lines 1-12 and 35-46), plus an object
literal of them. Only the object literal (`export const schema`, needed by
`drizzle({ client, schema })`) is load-bearing; the re-export block is pure indirection.
Flagging for whichever agent owns `packages/server/src/db`.

---

## G. Deepening / extraction opportunities (ranked)

**G1. A row-parsing seam at the SQLite boundary** — *highest leverage in core*
Addresses D1, D2, D3, D5. Today `parsePhase` (`schemas.ts:33`) is a one-off fix for one
column, added after an outage. Generalise it: a `rowSchemas` map plus a `parseRow(table, row)`
helper that every service read funnels through, degrading unrecognised enum values to a
named "unrecognized" state instead of poisoning exhaustive switches. Two adapters already
exist in spirit (the F19 phase fix; the same class of bug latent in 11 other columns), so
this is a **real seam**, not a hypothetical one. Callers gain: one contained failure instead
of a blank page, and the zod schemas stop being decorative.

**G2. Generate drizzle enum constraints from the zod enums**
Addresses D2, D5. Replace `text('phase').notNull().$type<Phase>()` (`db-schema.ts:113`)
with `text('phase', { enum: Phase.options }).notNull()` across all 12 enum columns, and
add `$type<PreparedKey>()`/`GateId` to the two bare ones (`db-schema.ts:81`, `:277`).
Mechanical, no runtime cost, converts a compile-time fiction into a real narrowing, and
closes the drift channel at its source. Do alongside G1, not instead of it.

**G3. Declarative env table in `config-load.ts`**
Addresses E1 (the latent bug), E2. Replace the 20-branch ladder (`config-load.ts:29-62`)
with one `ENV_MAP: { env: string; key: keyof RuncastleConfig; coerce: ZodType }[]` and a
single loop. Fixes the empty-string hazard uniformly, gives error messages that name the
env var, and makes "config field added without an env override" a visible gap rather than
an invisible one. Small, self-contained, testable.

**G4. `satisfies` links for the four hand-maintained twin lists**
Addresses C1, C2, C3, C4, D10. Four one-line changes:
`MODEL_STEPS ... as const satisfies readonly (SessionKind | 'research' | 'implement' | 'smoke')[]`;
`PREPARED_KEYS ... as const satisfies readonly (keyof Project)[]`;
`WaypointDisposition` derived from `WaypointStatus.options`; `GateId` derived from
`PIPELINE`. Plus `workflow.ts:47` naming `WaypointDisposition` instead of re-spelling it.
Highest ratio of drift-prevention to effort in the whole report — and the pattern is
already proven in-repo at `schemas.ts:270`.

**G5. Branded ids from `newId`**
Addresses E4. `newId<'feat'>('feat'): Id<'feat'>` with `type Id<P> = string & { __brand: P }`.
Nine lines of core change; 22 files gain compile-time protection against swapping a
`featureId` for a `ticketId`. Would also make `Waypoint.blockedBy`'s `number | string`
union (`schemas.ts:175`) self-documenting. Larger blast radius than G1–G4 — worth doing,
but sequence it after them.

**G6. Split `db-schema` out of the barrel**
Addresses D9. Add `"./db-schema": "./src/db-schema.ts"` to `package.json:6-10` and drop
`export * from './db-schema'` from `index.ts:14`. Server updates one import
(`packages/server/src/db/schema.ts:12`); `apps/web` stops bundling drizzle's table builder.
One line each side, matching the treatment `paths` and `config-load` already receive.

**G7. Discriminated `EventRow` payloads for the consumed subset**
Addresses D6, D7, E5. Keep `type: z.string()` open, but add a
`KnownEventData = z.discriminatedUnion('type', [...])` covering the handful the UI
actually branches on (starting with `gate.overridden`, whose payload the web casts raw at
`feature-ui.ts:581`). Retires the cast and gives the emitter/consumer pair a contract.
Depends on `gate_overrides` gaining a zod schema (D3 #5).

**G8. Delete or wire up `loopBackPhase` / `rethinkPhase`**
Addresses B1, B2. Either remove both (and the SPEC.md lines that promise them,
`docs/SPEC.md:374`, `:464`), or have `packages/server/src/services/features.ts:496,515,541,567`
call them instead of destructuring the constants. Wiring them up is the better half —
`rethink` at `features.ts:541` is a hand-rolled guard the pure helper already models.
Cheap either way; the current state is the worst of both (dead code with green tests and
a SPEC that vouches for it).

---

## H. Cross-cutting candidates to pass UP

Ordered by how likely they are to be confirmed by sibling scopes.

| Canonical key | Kind | Confidence | Claim (core-side evidence) | Why it is cross-cutting |
|---|---|---|---|---|
| `unvalidated:db-boundary` | violation | HIGH | No row schema is ever parsed at runtime: `rg "(Ticket\|Feature\|Project\|SessionRow\|EventRow\|Waypoint\|TestNote\|Run\|ProjectFinding)\.(safe)?[Pp]arse\("` over `packages/server/src` + `apps/web/src` → **0 hits**. All 12 enum columns rely on compile-time-only `$type<>()` (`db-schema.ts:82,113,121,167,170,203,220,232,238,248`); the `enum:` option and CHECK constraints are used 0 times. `parsePhase` (`schemas.ts:33`) is the sole guard, added reactively after a blank-page outage (F19, documented at `schemas.ts:23-32`). | Every service read in `packages/server` and every switch in `apps/web` sits downstream. The server and web scopes will each see the *symptom* (exhaustive switches, unguarded reads); only core sees why. |
| `unvalidated:trpc-output` | violation | HIGH | `rg "\.output\(" packages/server/src/trpc \| wc -l` → **0**. No tRPC procedure declares an output schema, so the "wire types" of `schemas.ts:3-6` are never enforced on the wire either. | Purely a server/web contract question; core just proves the schemas exist unused. |
| `duplicated:enum-lists` | violation | HIGH | Four hand-maintained twin lists: `WaypointDisposition` ×3 (`schemas.ts:162`, `:158`, `workflow.ts:47`); `MODEL_STEPS` ⊇ `SessionKind` unlinked (`config.ts:18` vs `schemas.ts:58`); `PREPARED_KEYS` vs `keyof Project` unlinked (`schemas.ts:241` vs `:302`); `GateId` vs `PIPELINE` (`pipeline.ts:9` vs `:32`). `satisfies` is used exactly once, at `schemas.ts:270`. | If server/web scopes report their own re-spellings of core enums (likely for `Phase`, `SessionKind`, event types), they belong under this key. |
| `drift:zod-drizzle` | violation | HIGH | Five divergences: `projects.sandbox` (`db-schema.ts:32`), `projects.closedAt` (`:36`), `sessions.lap` (`:166`), `events.lap` (`:268`) have no zod field; `gate_overrides` (`:275-281`) has no zod schema at all. `closedAt` is the sharpest — it drives multi-project open/close (`services/projects.ts:40,89,107,131`) while the wire type says it doesn't exist. Timestamps, booleans, JSON and nullability are otherwise fully consistent. | Server scope owns the readers; the drift is only visible by comparing the two core files side by side, which is this report's job. |
| `stringly:ids` | judgement call | MEDIUM | `newId(prefix: string): string` (`ids.ts:7`), 22 consuming files. Every entity id is `z.string()`. `Waypoint.blockedBy` changes meaning between `WaypointInput` (`schemas.ts:175`, `number \| string`) and `Waypoint` (`:192`, `number`) with no type-level marker. | Any scope reporting "wrong id passed" or "id juggling" plugs in here. |
| `stringly:event-type` | judgement call | MEDIUM | `EventRow.type: z.string()` + `data: z.unknown()` (`schemas.ts:469,471`); `events.type: text('type')` (`db-schema.ts:270`). Forces raw casts downstream — `apps/web/src/lib/feature-ui.ts:581`: `((e.data ?? {}) as { gate?: GateId }).gate ?? null`. | CLAUDE.md makes event emission a house rule; the server scope will have an emitter inventory, the web scope a consumer inventory. Neither can see the missing contract alone. |
| `inconsistent:enum-declaration` | violation | HIGH | `GateId`/`GateCheckId` are plain TS unions (`pipeline.ts:9,11`) while all 14 other core enums are `z.enum` — so no `.safeParse` exists for gate ids at any boundary. Reinforced by `gate_overrides.gate` being bare `text()` (`db-schema.ts:277`) and `project_findings.key` being the one enum column with no `$type` cast (`db-schema.ts:81`). | Directly explains the web's unchecked cast; the gates service (`packages/server/src/services/gates.ts`) is the other half. |
| `duplicated:path-knowledge` | violation | HIGH | `packages/server/src/routes/hooks.ts:352` builds `` `docs/features/${feature.slug}/` `` by hand while `featureDocsRel` (`paths.ts:126`) exists and is used correctly at `launcher/artifacts.ts:107`. `packages/server/src/config.ts:26` builds `join(root, 'worktrees')` — core exposes no `worktreesDir()`. Wider sweep found no other leakage, so path ownership is otherwise clean. | Two sites only, both in server. Pass up so the server scope confirms there are not more. |
| `latentbug:env-empty-string` | violation | HIGH | `config-load.ts:49-51` guards on `!== undefined`, so `RUNCASTLE_BURN_CONFLICT_ATTEMPTS=''` → `Number('') === 0` → passes `.min(0)` → **silently disables the in-loop conflict resolver** (`config.ts:216-217`: "`0` disables it: conflicts go straight to the human"). Every other numeric env key uses truthiness and is immune. | Operational failure mode with no error message; the burner/workflows scope should know the resolver can be off without anyone touching config. |
| `docdrift:claude-md-core-io` | violation | HIGH | CLAUDE.md's package map says core's IO exception is "`config.ts` lazy file read inside `loadConfig`". `config.ts` has no `node:` import and no IO (verified); the read is at `config-load.ts:21-23`. The file was split post-CLAUDE.md and the doc was not updated. | Root agent's call — CLAUDE.md is build-era, but this is drift on the one invariant it asserts about core. |
| `deadcode:spec-declared-helpers` | violation | HIGH | `loopBackPhase` (`pipeline.ts:122`) and `rethinkPhase` (`pipeline.ts:146`) have zero callers outside core's own tests (verified by repo-wide `rg -w`), yet `docs/SPEC.md:374` documents them as contract and `docs/SPEC.md:464` mandates a vitest for one. The server inlines the logic instead (`services/features.ts:496,515,541,567`). | The pattern — SPEC promises a helper, tests cover it, no caller uses it — may recur in other packages. Worth a cross-scope check for "tested but uncalled". |
| `bundle:drizzle-in-browser` | judgement call | MEDIUM | `index.ts:14` re-exports `./db-schema`, which imports `drizzle-orm/sqlite-core` (`db-schema.ts:1`). The barrel comment (`index.ts:1-8`) guards only against *node builtins*, so the invariant technically holds — but `apps/web` bundles ten SQLite table definitions it never uses, via a package it does not declare (`apps/web/package.json` has no `drizzle-orm`). | Web/build scope may independently notice bundle weight; this names the cause. |

**Confirmed non-findings**, recorded so sibling scopes do not re-litigate:
core is genuinely IO-free (only `config-load.ts:1` and `paths.ts:1-2` import node
builtins, both outside the barrel, both backed by subpath exports in
`package.json:6-10`); genuinely deterministic (zero `Date.now`, `Math.random`, `crypto`);
and fully clean of `any` / `as any` / `@ts-ignore` / `.passthrough()` / non-null `!`.
Timestamp, boolean, JSON and nullability mirroring between zod and drizzle is correct in
every field that exists on both sides.

---

## Test coverage assessment (core's own tests, 563 lines / 5 files)

**Asserted well:**
- `blocking.test.ts` (66 lines) — the strongest. Range, non-integer, self-reference,
  2-cycle, 3-cycle, diamond, empty batch, `startSeq` offset, custom label. Matches the
  module's actual contract.
- `pipeline.test.ts` (159 lines) — full forward order, both loop-backs, mapped-G1 swap,
  terminal nulls, per-gate id+check mapping.
- `config.test.ts` (145 lines) — legacy fold precedence, `stepModels` sparseness,
  `burnConcurrency`/`burnMaxIterations` ranges, the full `resolveModel` precedence chain,
  the "no `[1m]` for Haiku" rule.
- `paths.test.ts` (93 lines) — dev/prod split, per-call env read, Windows case/slash folding.

**Not asserted — gaps that map to findings above:**

1. **Zod ↔ drizzle sync — zero tests.** No test compares any zod schema's keys against its
   drizzle table's columns. This is exactly why the five D3 divergences went unnoticed. A
   single table-driven test (`Object.keys(Ticket.shape)` vs `getTableColumns(tickets)`)
   would have caught all five and would catch the next one.
2. **`config-load.ts` — zero tests.** No test file exists for the module that contains the
   E1 latent bug and all 20 env branches. It is also the only core module that touches the
   filesystem — the highest-risk file has the least coverage.
3. **Gate *behaviour* is untested here** — only gate *identity* is (`pipeline.test.ts:59-66`
   asserts id↔check mapping). Correct scoping: the checks live in
   `packages/server/src/services/gates.ts`. Noted so the server scope knows the pairing is
   asserted core-side and need not be duplicated.
4. **`parsePhase` is tested (`schemas.test.ts:82-100`) but is the only boundary parser** —
   the test proves the pattern works, which strengthens G1 rather than weakening it.
5. **No test asserts the barrel's browser-safety invariant** (D9). It is the one property
   `index.ts` exists to enforce, and it is guarded by a comment. A test that walks
   `index.ts`'s transitive imports for `node:` specifiers would make it enforceable —
   currently a single `export * from './paths'` would break the web at module-eval time
   with nothing catching it before runtime.
6. `ids.ts`, `workflow.ts`, `db-schema.ts` untested — appropriate (trivial / type-only /
   declarative), except insofar as gap 1 covers `db-schema`.
