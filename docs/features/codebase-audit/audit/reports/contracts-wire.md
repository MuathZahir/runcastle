# Audit report — wire-contract drift & the event contract (cross-package)

**Scope:** boundaries only — the same shape declared twice, validated at one end only,
or renamed in flight. Not service internals, not component internals.
**Method:** traced 12 shapes hop-by-hop (core zod → core drizzle → server service →
tRPC → web → MCP), plus a mechanical set-difference on the event vocabulary.

Anchors inherited from the orchestrator and re-confirmed here: `.output(` appears 0× in
`packages/server/src`; the nine core entity schemas are never `.parse()`d; drizzle enum
columns are all `$type<X>()` compile-time casts.

---

## A. Flow map

### A.0 The one-line summary of this scope

There are **three parallel type systems** describing the same domain, and they are joined
by convention rather than by code:

| Layer | Declared in | Runtime-checked? | Linked to core? |
|---|---|---|---|
| core zod schemas | `packages/core/src/schemas.ts` | almost never (see B1) | — |
| drizzle tables | `packages/core/src/db-schema.ts` | never (`$type<>()` casts) | by hand, field-by-field |
| server service TS interfaces | `services/*.ts` | never | by hand |
| tRPC wire shapes | `trpc/routers/*.ts` | **input** yes (hand-written zod), **output** never | 3 procedures out of 59 |
| MCP tool shapes | `mcp/server.ts` | input yes | 5 of 14 tools |
| web view types | `apps/web/src/**` | never | via `RouterOutputs` (good) *or* re-declared |
| design-system props | `packages/design-system/src/screens/*` | never | **no dependency on core at all** |
| PTY / SSE frames | `pty/ws.ts`, `services/bus.ts` vs `apps/web/src/lib/*` | never | hand-mirrored, twice |

### A.1 Traces

Legend per hop: `file:line`. "≡" = shape matches. "≠" = drift (detailed under D).

**1. Feature**
`schemas.ts:349-378` (zod `Feature`) → `db-schema.ts:99-123` (`features`, `phase`/`status`
are `$type<>()` casts) → `services/repo.ts` `rowToFeature` → `services/features.ts:69-85`
`FeatureListItem extends Feature` (+`ticketCounts`, `activeRun`, `liveSession`,
`lastActivityAt`) → `trpc/routers/feature.ts:47-53` (`list`/`get`, no `.output`) →
`apps/web/src/lib/api.ts:14-15` `FeatureListItem`/`FeatureFull` from `RouterOutputs`
(**good pattern**) → MCP `mcp/server.ts:6` imports `Feature` as a *type only*.
**≠** drizzle `features` has no column missing, but the zod `Feature` never validates a row.

**2. Ticket / TicketInput** — the worst-drifted shape. Six declarations:
| # | Site | Shape |
|---|---|---|
| 1 | `schemas.ts:107-115` | `TicketInput` = title, goal, context, acceptanceCriteria[], seams[], blockedBy[] |
| 2 | `schemas.ts:119-150` | `Ticket` = TicketInput + id, featureId, seq, status, lap, commits, error?, attemptBranch?, conflictFiles? |
| 3 | `db-schema.ts:185-208` | `tickets` — JSON columns `$type<string[]>()`, never validated |
| 4 | `services/tickets.ts:129-131` | `TicketContentPatch = Partial<Pick<Ticket,'title'\|'goal'\|'context'\|'acceptanceCriteria'\|'seams'>>` |
| 5 | `trpc/routers/ticket.ts:52-61` | `ticket.edit` input — **omits `seams`**, adds `.min(1)` on title/goal/criteria, key is `ticketId` |
| 6 | `mcp/server.ts:837-844` | `update_ticket` input — **has `seams`**, **no `.min(1)`**, key is `id` |
Sites 5 and 6 call the *same* service (`editTicket`, `tickets.ts:150`). Field-level diff in D2.

**3. Phase** — `schemas.ts:13-21` → `db-schema.ts:113` `text('phase').$type<Phase>()` →
`services/*` → tRPC (never an input; `complete_phase` MCP input is `Phase` at
`mcp/server.ts:947` — the **one** correct enum reuse) → web imports `Phase` type +
`parsePhase` (`Inspector.tsx:2`, `Workspace.tsx:2`, `feature-ui.ts:1`) → **≠**
`design-system/src/screens/Inspector.tsx:5`, `OverviewScreen.tsx:6`, `Sidebar.tsx:4`
each hand-redeclare the 6-member union with zero import of core.

**4. Gate result** — `pipeline.ts:9` `GateId` TS union; `pipeline.ts:19-23` `GateDef`;
`services/gates.ts:21-24` `GateResult {satisfied, reason?}` → `services/features.ts:87-91`
`FeatureGateState {next: GateDef|null, satisfied, reason?}` — a hand-widened **second**
declaration of `GateResult` → `trpc/routers/feature.ts:18` `const gateId = z.enum(['G1'..'G5'])`,
**unlinked** to `GateId` → web `lib/api.ts:16` `GateState = FeatureFull['gate']` (good) but
`lib/feature-ui.ts:581` casts `event.data.gate` straight to `GateId` with no check.

**5. EventRow / event type** — `schemas.ts:462-473` (`type: z.string()`, `data: z.unknown()`)
→ `db-schema.ts:254-273` (`text('type')`, plus a `lap` column the zod schema **does not have**)
→ `services/events.ts:20-26` `EmitInput` (a 4th declaration; `type: string`) →
`core/workflow.ts:14-19` `WorkflowCtx.emitEvent` (a 5th, structurally `EmitInput` minus `runId`)
→ `trpc/routers/events.ts` (no output schema) → web `EventRow` type import.
Full vocabulary analysis in section **A.2**.

**6. SessionRow + SessionKind** — `schemas.ts:58-67`, `380-398` → `db-schema.ts:125-183`
(**≠** table has `lap`, zod `SessionRow` does not) → `trpc/routers/feature.ts:63`
`kind: SessionKind` — **the one tRPC input that reuses a core enum** → web via `RouterOutputs`
→ **≠** `design-system/src/screens/TerminalScreen.tsx:4` re-declares `SessionStatus`.

**7. Waypoint / WaypointInput** — `schemas.ts:171-197` → `db-schema.ts:227-242` →
`services/waypoints.ts` → **no tRPC input at all** (waypoints only enter via MCP) →
MCP `mcp/server.ts:899` `z.array(WaypointInput)` ✅ and `:914` `WaypointDisposition` ✅,
but the handler at `:178-181` re-declares the disposition inline as
`'resolved' | 'dropped'`. Web reads them through `FeatureFull['waypoints']`.

**8. Run / RunStatus** — `schemas.ts:95-96`, `400-409` → `db-schema.ts:244-252` →
`workflows/runner.ts:224` emits `run.finished` with `data: {status, summary}` →
**≠** `apps/web/src/lib/notifications.ts:71-83` re-declares `RunStatus` inline as
`'succeeded'|'failed'|'cancelled'` and hand-rolls a 7-line validator. Also
`design-system/src/screens/RunScreen.tsx:4`.

**9. Project / ProjectFinding** — `Project` `schemas.ts:302-321` vs `projects` table
`db-schema.ts:21-62`: **≠ the table has two columns the schema does not** (`sandbox`,
`closedAt`). `ProjectFinding` is the **healthiest** trace: `schemas.ts:337-347` →
`db-schema.ts:76-97` → `services/findings.ts:242` `listFindings(): Promise<ProjectFinding[]>`
→ `services/prep.ts:104-136` `PrepView.findings: ProjectFinding[]` → `project.prep`
→ `lib/api.ts:22-23` `ProjectFinding = PrepView['findings'][number]`. One end-to-end
type-linked chain. MCP `record_finding` (`mcp/server.ts:696-701`) reuses `PreparedKey` ✅.

**10. TestNote** — `schemas.ts:216-226` → `db-schema.ts:210-225` → `services/test-notes.ts`
→ `trpc/routers/test-notes.ts` (5 hand-written inputs, all `{ noteId: z.string() }` variants;
no output) → web. No MCP surface. No re-declaration found. Clean-ish, but `TestNoteStatus`
zod is a dead runtime value (B1).

**11. SettingsView / SettingField** — `schemas.ts:432-447` → **no drizzle table** (composed
from `projects` override columns + `~/.runcastle/config.json`) →
`services/settings.ts:372` `getSettings(): SettingsView` (typed, and each field carries its
own `valueSchema` zod — `settings.ts:241`) → `trpc/routers/settings.ts:18`
`.input(SettingsUpdateInput)` — **the best boundary in the repo**: core schema reused
verbatim → `lib/api.ts:20-21` derives from `RouterOutputs`. Copy this pattern.

**12. PreparedKey / DRIVE_LOOP_KEYS** — `schemas.ts:241-252`, `265-270` → project columns
`db-schema.ts:45-61` (8 keys ↔ 8 columns, joined by `COLUMN_NAME[key]` in
`services/findings.ts`) → MCP `record_finding` `key: PreparedKey` ✅ →
`services/git.ts:5` and `apps/web/src/lib/settings.ts:1` both import `DRIVE_LOOP_KEYS`
as a value. Clean. One asymmetry: `RecordFindingInput.value` is `string | null`
(`findings.ts:102-110`, null clears) but the MCP tool declares `value: z.string()`
(`mcp/server.ts:698`) — **the clear operation is unreachable from an agent**.

### A.2 Event vocabulary — the set difference

**Emitted (89 real types + 5 via `setPhase`'s positional arg = 94 total).**
The 5 that a `type: '...'` grep misses because they are positional
(`setPhase(ctx, id, phase, 'event.type', msg)`): `phase.advanced`, `burn.started`,
`lap.started`, `feature.shipped`, `gate.override.undone`. Conversely `branch`, `command`,
`file`, `http`, `text` are grep false positives (sandcastle/hook/MCP config literals,
e.g. `workflows/ticket-burner.ts:1843`, `launcher/artifacts.ts:717`, `mcp/server.ts:661`).

**Consumed by web (14):** `burn.started`, `feature.shipped`, `feature.status`,
`gate.overridden`, `merge.conflict`, `merge.conflict.resolved`, `merge.conflict.resolving`,
`run.finished`, `session.ended`, `session.kickoff`, `session.kickoff_undelivered`,
`session.not_ready`, `session.resume_failed`, `testdrive.started`.

**Emitted-but-never-consumed by name: 80 of 94 (85%).**
`burn.cycle burn.restarted burn.setup burn.summary burn.text burn.tool
burn.worktree.teardown-failed converge.resumed docs.scaffolded feature.archived
feature.created feature.deleted feature.escalated feature.quick_change feature.unarchived
gate.override.undone git.commit_pending lap.started merge.conflict.needs-human note.added
note.deleted note.edited note.promoted note.toggled phase.advanced phase.complete_requested
prep.dryrun.started prep.dryrun.stopped prep.dryrun.url prep.dryrun.verified
prep.finding_recorded project.closed project.opened project.renamed project.slow-path
research.done research.error research.failed research.started run.error run.reconciled
run.started session.auto_ended session.launched session.launching session.pty_exited
session.reconciled session.resume_unavailable session.resumed session.spawn_failed
session.started session.worktree_pending settings.updated testdrive.carried_changes
testdrive.db_drift testdrive.dev_failed testdrive.dev_started testdrive.env
testdrive.env_unknown_placeholder testdrive.stopped testdrive.url ticket.blocked
ticket.burning ticket.cancelled ticket.done ticket.edited ticket.failed ticket.resuming
ticket.retry ticket.retrying ticket.stopped ticket.timing ticket.updated
tickets.awaiting_burn tickets.stored waypoint.claimed waypoint.released waypoint.resolved
waypoint.unblocked waypoints.stored`

This is **not** 80 dead events — most are rendered generically as prose in the Activity feed
(`lib/activity.ts:79`) and the run stream (`RunBody.tsx:408-414`). But it means 80 strings
have no consumer that would break if they were renamed, which is exactly the condition
that produced the verified `ticket.retry`/`ticket.retrying` and `research.error`/
`research.failed` splits.

**Consumed-but-never-emitted: 0.** (The four non-event dotted strings web holds —
`runcastle.guidance`, `runcastle.inspector.collapsed`, `runcastle.maprail.collapsed`,
`runcastle.update.dismissed` — are localStorage keys, plus `map.md`/`spec.md` filenames.)
Good: no phantom listeners.

---

## B. Dead code

### B1 — `violation` · `dead:core-zod-runtime` · confidence **high**

**~20 of the 31 core zod schemas are dead as runtime values.** Every value-import of
`@runcastle/core` across `packages/server/src`, `apps/web/src` and `scripts` was enumerated;
the complete set of core *schemas* imported as values is:

```
packages/server/src/trpc/routers/feature.ts:1   import { SessionKind }        from '@runcastle/core'
packages/server/src/trpc/routers/project.ts:2   import { ProjectName }        from '@runcastle/core'
packages/server/src/trpc/routers/settings.ts:1  import { SettingsUpdateInput } from '@runcastle/core'
packages/server/src/dev/args.ts:1               import { Phase }             from '@runcastle/core'
packages/server/src/mcp/server.ts:19-27         import { Phase, PreparedKey, TicketInput,
                                                         WaypointDisposition, WaypointInput }
```

Everything else — `Feature`, `Ticket`, `Run`, `SessionRow`, `Project`, `Waypoint`,
`TestNote`, `EventRow`, `ProjectFinding`, `SettingsView`, `SettingField`, `TicketStatus`,
`RunStatus`, `FeatureStatus`, `SessionStatus`, `WaypointStatus`, `WaypointType`,
`TestNoteStatus`, `SettingSource`, `SettingScope`, `FindingSource` — is imported **only**
via `import type`. The `z.object(...)`/`z.enum(...)` calls execute at module load, produce
validators nothing calls, and ship in the bundle. They are being used as a TypeScript type
DSL. The file's own header (`schemas.ts:3-9`) says *"Every schema here is the single source
of truth"* — true for types, false for values.

**Deletion test:** replacing them with plain `interface`/union declarations would change
nothing at runtime today. That is the definition of a shallow, unearned abstraction —
and simultaneously the strongest argument for section G1 (start *using* them).

### B2 — `violation` · `dead:setting-source-enums` · confidence **high**

`SettingSource` (`schemas.ts:419-420`) and `SettingScope` (`schemas.ts:423-424`) have
**zero references outside `schemas.ts`** across server, web, core and scripts. They are
used only inside `SettingField`'s own `z.object` at `schemas.ts:435,438`. Exporting them
is speculative generality.

### B3 — `judgement call` · `dead:pty-exit-code` · confidence **medium**

The PTY control protocol's `exitCode` field is written at three sites
(`pty/registry.ts:18,75,101`, `pty/ws.ts:66`) and **never read**: the only client
(`apps/web/src/lib/terminal.ts:164-179`) declares the inbound frame as
`{ t?: string; status?: string }` and branches on `status` alone. A wire field with a
producer and no consumer.

---

## C. Redundancy

### C1 — `violation` · `redundant:mcp-input-shapes` · confidence **high**

**12 of 14 MCP tools declare their input shape twice** — once as the registered zod
`inputSchema`, once as an inline TS object type on the handler, with no `z.infer` linking
them:

| Tool | zod inputSchema | handler TS type |
|---|---|---|
| `record_finding` | `mcp/server.ts:696-701` | `mcp/server.ts:403` |
| `dry_run_drive` | `:724` `z.enum(['start','status','stop'])` | `:451` `'start'\|'status'\|'stop'` |
| `create_feature` | `:746-752` | `:492-…` |
| `get_work_record` | `:790` | `:615` |
| `emit_tickets` | `:820` `z.array(TicketInput)` | `:196` `{ tickets: TicketInputT[] }` |
| `update_ticket` | `:837-844` | `:222` `{ id: string } & TicketContentPatch` |
| `cancel_ticket` | `:861` | `:232` |
| `escalate_to_map` | `:878` | `:241` |
| `emit_waypoints` | `:899` `z.array(WaypointInput)` | `:249` |
| `resolve_waypoint` | `:914` `WaypointDisposition` | `:181` `'resolved' \| 'dropped'` |
| `record_event` | `:932` | `:272` |
| `complete_phase` | `:947` `Phase` | `:294` `{ phase: PhaseT }` |

`update_ticket` is the dangerous one: the handler type is `{ id } & TicketContentPatch`
(derived), the zod is hand-written. Add a field to `TicketContentPatch` and the compiler
is happy while the wire silently rejects it. Every row here is one `z.infer<typeof …>` away
from being impossible to drift.

### C2 — `violation` · `redundant:ticket-content-patch` · confidence **high**

One "edit a ticket's prose" operation, **four** shape declarations (see A.1 trace 2):
`services/tickets.ts:129-131`, `trpc/routers/ticket.ts:52-61`, `mcp/server.ts:837-844`,
plus core `TicketInput` which already owns the field list. Field diff in D2.

### C3 — `violation` · `redundant:live-signal` · confidence **high**

The SSE wire contract is declared twice, in two packages, with a comment admitting it:

```ts
// packages/server/src/services/bus.ts:22-35
export type LiveSignal =
  | { kind: 'event'; projectId: string; featureId?: string; eventId: number }
  | { kind: 'transcript'; ticketId: string }
```
```ts
// apps/web/src/lib/live.ts:22-25
/** Mirrors `LiveSignal` in packages/server/src/services/bus.ts. */
type LiveSignal =
  | { kind: 'event'; projectId: string; featureId?: string; eventId: number }
  | { kind: 'transcript'; ticketId: string }
```

Neither end validates: `live.ts:152` does `JSON.parse(...) as LiveSignal`. This shape is a
pure IO-free contract — it belongs in `@runcastle/core`, which exists precisely for this.

### C4 — `violation` · `redundant:pty-control-frames` · confidence **high**

The PTY control protocol is declared **four** times, all inline, none shared, none zod'd:

- `packages/server/src/pty/registry.ts:17-19` — `ControlFrame` (the only named one, server-internal)
- `packages/server/src/pty/ws.ts:66` — `ws.send(JSON.stringify({ t:'status', status:'ended', exitCode: 0 }))` bypasses `ControlFrame` entirely
- `packages/server/src/pty/ws.ts:77` — inbound: `JSON.parse(message) as { t?: string; cols?: number; rows?: number }`
- `apps/web/src/lib/terminal.ts:151` (outbound `{t:'resize',cols,rows}`) and `:164-166` (inbound `{ t?: string; status?: string }`)

Both directions of one protocol, split across two packages, joined only by a doc comment
(`pty/ws.ts:15`, `terminal.ts:6`).

### C5 — `violation` · `redundant:hook-payload-narrowing` · confidence **high**

`routes/hooks.ts` narrows the identical Claude Code `SessionStart` payload triple twice,
verbatim:

```ts
// hooks.ts:127-130 (feature path)
const ccSessionId = typeof payload?.session_id === 'string' ? payload.session_id : undefined
const transcriptPath = typeof payload?.transcript_path === 'string' ? payload.transcript_path : undefined
const source = typeof payload?.source === 'string' ? payload.source : undefined
```
```ts
// hooks.ts:164-167 (project-scoped path) — byte-identical apart from indentation
```

Plus four more one-off `typeof payload?.x === 'string'` narrowings at `:193`, `:278`,
`:313`, `:317-319`. Six hand-rolled validators where the repo already mandates zod.

### C6 — `violation` · `redundant:event-tone-classifier` · confidence **high**

Two independent, *disagreeing* classifiers map an event type string to a severity:

```ts
// apps/web/src/components/bodies/RunBody.tsx:425-434
if (type === 'merge.conflict.resolved') return 'ok'
if (type === 'merge.conflict.resolving') return 'active'
if (/(error|fail|conflict|cancel|stopped)/i.test(type)) return 'error'
if (/(done|succeed|finished|shipped|merged)/i.test(type)) return 'ok'
if (/(start|burn|launch|advance|running|retry|resum)/i.test(type)) return 'active'
```
```ts
// apps/web/src/components/Inspector.tsx:331-336
if (type.includes('failed') || type.includes('error') || type.includes('blocked')) return 'is-danger'
if (type.includes('done') || type.includes('shipped') || type.includes('merged')) return 'is-ok'
if (type.startsWith('phase') || type.startsWith('gate')) return 'is-accent'
```

Concrete disagreements (traced through both functions by hand):

| Event type | `RunBody.eventLevel` | `Inspector.eventTone` |
|---|---|---|
| `ticket.cancelled` | `error` (matches `cancel`) | neutral |
| `ticket.stopped` | `error` (matches `stopped`) | neutral |
| `ticket.blocked` | neutral | `is-danger` (matches `blocked`) |
| `merge.conflict.needs-human` | `error` (matches `conflict`) | neutral |
| `testdrive.dev_failed` | `error` | `is-danger` (agree) |
| `phase.advanced` | `active` (matches `advance`) | `is-accent` |
| `run.finished` of a **failed** run | `ok` | neutral |

That last row is the real bug in both: the outcome lives in `data.status`
(`workflows/runner.ts:224-230`), not in the type string, so a failed burn paints green in
the run stream. Both functions are substring-matching a stringly-typed enum — the textbook
symptom of D1.

---

## D. Inconsistencies & structural smells

### D1 — `violation` · `stringly-typed:event-vocabulary` · confidence **high**

`EventRow.type` is `z.string()` (`schemas.ts:469`) and the column is
`text('type').notNull()` (`db-schema.ts:270`). There is **no enum, no union, no registry**
for 94 event types spread over 30+ files, and `record_event` lets an *agent* mint arbitrary
new ones (`mcp/server.ts:932` — `inputSchema: { type: z.string(), message: z.string() }`).
Consequences observed in-tree:

**a. Near-synonym drift (7 pairs found; 2 were pre-verified).**

| Pair | Sites |
|---|---|
| `ticket.retry` vs `ticket.retrying` vs `ticket.resuming` | `services/features.ts:734`; `workflows/ticket-burner.ts:2125`; `ticket-burner.ts:1773,1985` |
| `research.error` vs `research.failed` | `workflows/research.ts:95` and `:125` — **same file** |
| `run.error` **and** `run.finished` both fire on every failure | `workflows/runner.ts:205` then `:224` — the error path emits two events for one outcome; web only reads `run.finished` |
| `session.ended` vs `session.auto_ended` | `routes/hooks.ts:296`, `services/…`; `launcher/launcher.ts:317` |
| `feature.created` + `feature.quick_change` both fire for one creation | `services/features.ts:250` and `:275` — *deliberate* (documented at `:271-273`: the row carries no marker so the second event is the timeline's only account), but it means one domain action produces two events and no consumer distinguishes them |
| `ticket.stopped` vs `ticket.cancelled` vs `ticket.failed` | `ticket-burner.ts:2075,2142`; `services/tickets.ts` |
| `merge.conflict` / `.resolving` / `.resolved` / `.needs-human` | 4 variants; web consumes 3, `needs-human` has no consumer |

**b. Three naming conventions in one vocabulary.**
kebab: `burn.worktree.teardown-failed`, `merge.conflict.needs-human`, `project.slow-path`.
snake: `session.kickoff_undelivered`, `feature.quick_change`, `tickets.awaiting_burn`,
`testdrive.dev_failed`, `session.pty_exited`, `prep.finding_recorded`.
plain: `research.failed`, `run.finished`, `waypoint.resolved`.
Also 2-segment vs 3-segment (`ticket.done` vs `merge.conflict.resolved` vs
`burn.worktree.teardown-failed`).

**c. Repeated switching on the untyped string** — `RunBody.tsx:425`, `Inspector.tsx:331`,
`lib/activity.ts:75` (`type.endsWith('.tool')`), `lib/feature-ui.ts:529/533/580/600/750-752`,
`lib/notifications.ts:100`, `ShippedBody.tsx:22`, `Workspace.tsx:667`. **None** has an
exhaustiveness check — they cannot, because there is no union to be exhaustive over.
Unknown types silently fall through to a neutral/default rendering everywhere.

### D2 — `violation` · `drift:ticket-edit-surface` · confidence **high**

Field-by-field diff of the two wire surfaces onto `editTicket` (`services/tickets.ts:150`):

| Field | core `TicketInput` | `ticket.edit` (tRPC, `routers/ticket.ts:52-61`) | `update_ticket` (MCP, `mcp/server.ts:837-844`) |
|---|---|---|---|
| id key | — | `ticketId: z.string()` | `id: z.string()` |
| `title` | `z.string()` | `z.string().min(1).optional()` | `z.string().optional()` |
| `goal` | `z.string()` | `z.string().min(1).optional()` | `z.string().optional()` |
| `context` | `z.string()` | `z.string().optional()` | `z.string().optional()` |
| `acceptanceCriteria` | `z.array(z.string())` | `z.array(z.string().min(1)).optional()` | `z.array(z.string()).optional()` |
| `seams` | `z.array(z.string())` | **absent** | `z.array(z.string()).optional()` |
| `blockedBy` | `z.array(z.number())` | absent | absent |

Two real consequences: (1) the human editing a ticket in the UI **cannot fix its seams**,
though the service supports it (`tickets.ts:159`) and an agent can; (2) an agent may blank
a ticket's title to `""` while a human may not — the same service, two different validity
rules. The id key even differs in name for no reason.

### D3 — `violation` · `drift:zod-vs-drizzle-columns` · confidence **high**

The header of `db-schema.ts:16` claims the tables "mirror the zod schemas". Three tables
do not:

| Table | Column | zod counterpart |
|---|---|---|
| `projects` (`db-schema.ts:32`) | `sandbox: text('sandbox')` | **missing** from `Project` (`schemas.ts:302-321`) |
| `projects` (`db-schema.ts:36`) | `closedAt: integer('closed_at')` | **missing** from `Project` |
| `sessions` (`db-schema.ts:166`) | `lap: integer('lap').notNull().default(1)` | **missing** from `SessionRow` (`schemas.ts:380-398`) |
| `events` (`db-schema.ts:268`) | `lap: integer('lap').notNull().default(1)` | **missing** from `EventRow` (`schemas.ts:462-473`) |
| `gate_overrides` (`db-schema.ts:275-281`) | whole table | **no zod schema at all** |

The `lap` omissions are arguably deliberate (server-side grouping keys never sent to the
UI) — but nothing says so, and `db-schema.ts:16`'s "mirroring" claim reads as a guarantee.
`sandbox`/`closedAt` are wire-visible fields the UI can never receive: `Project` is the type
`project.list` returns (`services/projects.ts:35` `listProjects(): Project[]`), and
`rowToProject` (`services/repo.ts`) enumerates 14 fields by hand, **silently omitting both**
— verified by reading the function. `sandbox` is instead surfaced through the settings
router as a per-project override, and `closedAt` through `isNull(projects.closedAt)`
filtering, so nothing is broken today; but the omission is invisible at the type level
(a hand-written mapper cannot fail to compile for a field the target type lacks), which is
precisely what G1's `Project.parse(...)` would make impossible to drift further.

### D4 — `violation` · `drift:gate-id-unlinked` · confidence **high**

```ts
// packages/core/src/pipeline.ts:9
export type GateId = 'G1' | 'G2' | 'G3' | 'G4' | 'G5'
```
```ts
// packages/server/src/trpc/routers/feature.ts:18
const gateId = z.enum(['G1', 'G2', 'G3', 'G4', 'G5'])
```

Two declarations of the same closed set, in two packages, with no type relation. Add `G6`
to the pipeline and the wire silently rejects it with a raw zod error. Fix is one line:
`GateId` should be `z.enum(['G1'..'G5'])` in core with `type GateId = z.infer<...>`, and
the router should import it — exactly what `SessionKind` already does two lines earlier
(`feature.ts:1,63`). **The same file demonstrates both the right and the wrong pattern.**

### D5 — `violation` · `inconsistent:enum-parsing-in-one-file` · confidence **high**

`packages/server/src/dev/args.ts` parses two enums 14 lines apart, two different ways:

```ts
// :99  — the good way
const parsed = Phase.safeParse(phase)
if (!parsed.success) throw new UsageError(...)
return { kind: 'feature-phase', feature, phase: parsed.data }
```
```ts
// :111-113 — the hand-rolled way, for FeatureStatus
if (!(FEATURE_STATUSES as readonly string[]).includes(status)) throw new UsageError(...)
return { kind: 'feature-status', feature, status: status as FeatureStatus }
```

`FeatureStatus` is a core zod enum (`schemas.ts:98`); a local `FEATURE_STATUSES` const plus
a cast reimplements `.safeParse` badly (the `as` is what tsc needs *because* the check is
opaque to it).

### D6 — `violation` · `inconsistent:design-system-domain-enums` · confidence **high**

`packages/design-system` re-declares six domain enums with **no dependency on
`@runcastle/core`** whatsoever:

```ts
packages/design-system/src/screens/Inspector.tsx:5      type Phase = 'ideation'|'spec'|'tickets'|'implementation'|'review'|'shipped'
packages/design-system/src/screens/Inspector.tsx:6      const PHASE_ORDER: Phase[] = [...]      // duplicates core's PIPELINE order
packages/design-system/src/screens/OverviewScreen.tsx:6 type Phase = ...                        // 3rd copy
packages/design-system/src/screens/Sidebar.tsx:4        type Phase = ...                        // 4th copy
packages/design-system/src/screens/RunScreen.tsx:4      type RunStatus  = 'running'|'succeeded'|'failed'|'cancelled'
packages/design-system/src/screens/RunScreen.tsx:5      type LaneStatus = 'pending'|'burning'|'done'|'failed'      // TicketStatus − 'cancelled'
packages/design-system/src/screens/TerminalScreen.tsx:4 type SessionStatus = ...
packages/design-system/src/screens/TicketsScreen.tsx:5  type TicketStatus  = 'pending'|'burning'|'done'|'failed'|'blocked'
```

**`TicketsScreen.tsx:5` has `'blocked'` where core has `'cancelled'`** — a member that does
not exist in the domain, and a missing member that does. `RunScreen.tsx:5` `LaneStatus`
is a *third* variant of ticket status. Mitigating: `packages/design-system` is only imported
by `.design-sync/previews/*`, not by `apps/web`, so nothing ships broken today — this is a
**divergent-change** smell (a phase added to core needs edits in 4 more files nobody will
remember), not a live bug. Also `Inspector.tsx:6`'s `PHASE_ORDER` re-encodes the pipeline
order that `pipeline.ts:32-74` owns.

### D7 — `judgement call` · `asymmetric:validation-hooks-endpoint` · confidence **high**

`POST /api/hooks/:event` (`routes/hooks.ts:50-111`) is the one HTTP surface with **zero**
schema validation:

```ts
const event = c.req.param('event')                                    // :52  free string
const body = (await c.req.json().catch(() => ({}))) as HookBody       // :53  unchecked cast
```

`HookBody` (`:44-48`) is `{ event?, sessionId?, payload?: Record<string, unknown> }` — a TS
interface, not a schema. The producer (`launcher/hook-client.ts:44`) does
`JSON.parse(raw)` into `unknown` and posts `{ event, sessionId, payload }` with no shared
type. The four known events are switched on at `:78-89` and `:95-106`, both with
`default: return c.json({})` — an unknown or misspelled hook name is **silently swallowed**
(defensible per the file's stated golden rule at `:28-29`, but it means a settings-template
typo in `launcher/artifacts.ts` produces zero signal anywhere).

Note the asymmetry: MCP validates every tool input with zod; tRPC validates every procedure
input with zod; the hook receiver — which is the *only* boundary reached by third-party
(Claude Code) JSON — validates nothing.

### D8 — `judgement call` · `asymmetric:no-output-validation` · confidence **high**

Confirmed: `.output(` appears **0×** across `packages/server/src`. Every one of the 59
procedures publishes whatever its service happens to return. Web then infers types from
those returns (`lib/api.ts:12`), so `RouterOutputs` is honest about *shape* but there is no
runtime contract at all: a service that returns a widened object literal (e.g.
`feature.merge` at `routers/feature.ts:219` returns a hand-built
`{ ok, conflict, base, files }` that exists nowhere else) becomes the wire type by accident.
Three procedures build their output inline rather than returning a named type:
`routers/feature.ts:219` (merge), `routers/ticket.ts:35/43/45` (`{stopped, swept}`),
`routers/run.ts:26-28` (`{ok: true}`).

### D9 — `violation` · `latent-bug:run-cancel-lies` · confidence **high**

```ts
// packages/server/src/trpc/routers/run.ts:24-28
cancel: publicProcedure
  .input(z.object({ runId: z.string() }))
  .mutation(({ input }) => { cancelRun(input.runId); return { ok: true } }),
```
```ts
// packages/server/src/workflows/runner.ts (cancelRun)
export function cancelRun(runId: string): void { controllers.get(runId)?.abort() }
```

`cancelRun` returns `void` and is a no-op for an unknown or already-finished run; the
procedure reports `{ ok: true }` unconditionally. The wire's success flag carries no
information. It also emits **no event** — the only mutating-ish procedure that reports
success without a timeline entry (the eventual `run.finished` comes from the aborted
workflow, if there was one).

### D10 — `judgement call` · `gap:machine-scoped-mutations-emit-nothing` · confidence **medium**

The house rule is "every service function that mutates emits an event". Four mutating tRPC
procedures emit none, and structurally *cannot*: `events.project_id` is NOT NULL
(`db-schema.ts:259`) while these mutate machine-global state:

- `setup.gitIdentity` (`routers/setup.ts:41-43`) — writes global git config
- `setup.afkToken` (`routers/setup.ts:46-48`) — writes an **OAuth token** to `~/.runcastle/.env`
- `setup.startTerminal` (`routers/setup.ts:56-…`) — spawns a PTY
- `run.cancel` (D9)

Not a code bug so much as a modelling gap: the event contract has no machine scope, so the
one class of mutation a user most wants an audit trail for (credential capture) has none.
Also `setup.gitIdentity`'s input is `z.object({ name: z.string(), email: z.string() })` —
no `.min(1)`, no email shape, on a value written to `git config --global`.

### D11 — `violation` · `latent-bug:failed-run-paints-green` · confidence **high**

A failed burn renders as a **green/ok** line in the run stream. `run.finished` is emitted
for every terminal status (`workflows/runner.ts:224-230`, `data: { status, summary }`), but
`RunBody.eventLevel` (`RunBody.tsx:425-434`) classifies on the *type string* only:
`/(done|succeed|finished|shipped|merged)/i.test('run.finished')` → `'ok'`. Nothing in that
function can see `e.data.status`. `apps/web/src/lib/notifications.ts:96-112` reads the
payload correctly and fires "Burn failed", so the desktop notification and the run stream
disagree about the same event. Direct consequence of E3 (no typed `data`) + D1 (severity
inferred from a substring).

---

## E. Wrong tool & weak typing

### E1 — `violation` · `unschemad:json-parse` · confidence **high**

Every `JSON.parse` in server/core/web/scripts, and whether a schema exists for it:

| Site | Parsed shape | Core/zod schema exists? | Validated? |
|---|---|---|---|
| `launcher/hook-client.ts:44` | CC hook payload | no | no (`unknown`, then posted) |
| `pty/pty-sidecar.ts:124` | `HostMessage` | no | no — `as HostMessage` |
| `pty/ws.ts:77` | control frame | `ControlFrame` (TS, `registry.ts:17`) | no — `as {t?,cols?,rows?}` |
| `services/settings.ts:264` | `config.json` | **yes** — `RuncastleConfigSchema` | **partially** — only `typeof === 'object'`, then `as Record<string,unknown>` |
| `services/setup.ts:177` | sandcastle manifest | no | no — `as {...}` |
| `version.ts:31` | `package.json` | no | no — `as { version?: string }` |
| `workflows/ticket-burner.ts:651` | `package.json` | no | no — `as { packageManager?: unknown }` |
| `core/config-load.ts:23` | `config.json` | **yes** | **yes** — result feeds `RuncastleConfig.parse` ✅ |
| `apps/web/src/lib/live.ts:152` | `LiveSignal` | no (C3) | no — `as LiveSignal` |
| `apps/web/src/lib/terminal.ts:168` | control frame | no (C4) | no |
| `scripts/devtool.ts:401` | saved git identity | no | no |
| `scripts/smoke.ts:152` | tRPC response | **yes** (`RouterOutputs`) | no |
| `scripts/vendor-node-pty-prebuilds.ts:32` | `package.json` | no | no |

**13 sites, 1 validated.** The standout is `services/settings.ts:264` vs
`core/config-load.ts:23`: the *same file* on disk, read by two modules, one of which
validates it against `RuncastleConfigSchema` and one of which does not.

### E2 — `violation` · `unschemad:json-db-columns` · confidence **high**

Four JSON-encoded columns are `$type<>()` casts over untyped SQLite text, **never
schema-checked on read**:

```
db-schema.ts:192  acceptanceCriteria  text(..., {mode:'json'}).$type<string[]>()
db-schema.ts:195  seams               text(..., {mode:'json'}).$type<string[]>()
db-schema.ts:196  blockedBy           text(..., {mode:'json'}).$type<number[]>()
db-schema.ts:204  commits             text(..., {mode:'json'}).$type<string[]>()
db-schema.ts:207  conflictFiles       text(..., {mode:'json'}).$type<string[]>()
db-schema.ts:236  waypoints.blockedBy text(..., {mode:'json'}).$type<number[]>()
db-schema.ts:272  events.data         text(..., {mode:'json'})            // no $type at all
```

`services/tickets.ts:19-37` `rowToTicket` copies each straight through to a `Ticket` — the
declared return type is `Ticket` but nothing checks it. A hand-edited row, a migration that
wrote `null` into `commits`, or an older/newer server's encoding propagates unvalidated all
the way to the browser. `core/schemas.ts` already owns the exact validators
(`z.array(z.string())` etc.) and B1 shows they are never called.

### E3 — `violation` · `unschemad:event-data-payload` · confidence **high**

`EventRow.data` is `z.unknown().optional()` (`schemas.ts:471`) and the column carries no
`$type` (`db-schema.ts:272`). There is **no per-event-type payload contract anywhere**.
Every consumer hand-rolls a narrowing:

```ts
apps/web/src/lib/feature-ui.ts:530  const d = (e.data ?? {}) as { base?: unknown; files?: unknown }
apps/web/src/lib/feature-ui.ts:558  const d = (e.data ?? {}) as { from?: unknown; to?: unknown }
apps/web/src/lib/feature-ui.ts:581  forcedGate = ((e.data ?? {}) as { gate?: GateId }).gate ?? null
apps/web/src/lib/activity.ts:69     const d = data as Record<string, unknown>
apps/web/src/lib/notifications.ts:78 const d = data as Record<string, unknown>   (+ 5 lines of manual enum check)
```

`feature-ui.ts:581` is the sharp one: it casts an arbitrary string to `GateId` with **no
validation** and that value is then passed back to `feature.undoGateOverride`, whose input
is `z.enum(['G1'..'G5'])` (`routers/feature.ts:140`) — so a malformed payload turns into an
opaque server-side zod error rather than a handled UI state. Compare `feature-ui.ts:559-560`,
which does the right thing for phases (`parsePhase`) — the file contains both patterns.

`notifications.ts:77-83` is 7 lines that `RunStatus.safeParse` would replace, using an enum
that already exists and is dead (B1).

### E4 — `judgement call` · `weak-typing:wire-casts` · confidence **high**

Unchecked `as` at wire boundaries, consolidated: `routes/hooks.ts:53` (`as HookBody`),
`routes/hooks.ts:314` (`as Record<string, unknown>`), `pty/ws.ts:77`,
`pty/pty-sidecar.ts:124`, `dev/args.ts:113` (`as FeatureStatus`), `lib/live.ts:152`
(`as LiveSignal`), the five `event.data` casts in E3, `services/settings.ts:266,275`.
No `any` and no `@ts-ignore` were found at any boundary in scope — the house rule holds
there; the leak is `as`, which tsc cannot flag.

---

## F. Shallow modules

### F1 — `judgement call` · `shallow:core-schemas-as-types` · confidence **high**

`packages/core/src/schemas.ts` presents itself as a validation module ("Wire types for tRPC
and MCP. Every schema here is the single source of truth", `:3-9`) but its *interface* to
callers is, in practice, 31 exported TypeScript types. Its zod half — the part that would
make it deep, i.e. behaviour behind a small interface — is invoked exactly 6 times
repo-wide (B1). Deletion test on the *zod* layer: replace with plain types → nothing
changes. That is the textbook shallow verdict, and it is fixable by *deepening* (G1) rather
than deleting.

### F2 — `judgement call` · `shallow:events-router` · confidence **medium**

`trpc/routers/events.ts` (16 lines) is two pass-throughs to `listAfter`/`listByProject`
with `{featureId|projectId, afterId?}` inputs. It adds no validation of substance and no
output contract. Fine as-is; noted because it is the *only* place a per-event-type payload
contract could be enforced centrally (G3), and today it enforces nothing.

### F3 — `judgement call` · `shallow:trpc-input-wrappers` · confidence **medium**

47 of 59 procedures are `.input(z.object({ someId: z.string() })).mutation(x => service(...))`.
Individually correct; collectively they mean the wire's whole contribution is an id-shape
check. The interesting part — what the id refers to, what states the operation is legal in
(`assertMutable`, `tickets.ts:136`), what it returns — lives in services and is invisible
to the wire. This is why `.output()` costs nothing to add today and why nothing catches D2.

---

## G. Deepening / extraction opportunities (ranked)

**G1. Make the core zod schemas load-bearing at the DB boundary.** *(highest leverage)*
One `rowToX` per table already exists (`services/tickets.ts:19`, `services/events.ts:30`,
`services/repo.ts` `rowToFeature`/`rowToProject`) — six real adapters, i.e. a **real seam**,
not a hypothetical one. Route each through `X.parse(...)` (or `safeParse` + a named
degradation, following `parsePhase`'s documented precedent at `schemas.ts:23-36`). This
kills E2 entirely, resurrects ~20 dead validators (B1), and makes D3 a compile error
instead of a silent field drop. Cost: ~6 lines. Risk: a genuinely corrupt row now throws —
which `parsePhase`'s own docstring argues is the point.

**G2. One `z.enum` per domain enum, imported everywhere.** Replace `pipeline.ts:9`'s TS
union with a zod enum (D4); delete `routers/feature.ts:18`'s copy; delete
`dev/args.ts`'s `FEATURE_STATUSES` + cast (D5); replace `notifications.ts:71-83` with
`RunStatus.safeParse` (E3); make `packages/design-system` depend on `@runcastle/core` and
delete its 8 hand-copied unions (D6). Callers gain: adding a phase/gate/status becomes one
edit instead of nine.

**G3. An `EventType` registry in core — the single biggest structural win.**
94 strings, 3 naming conventions, 7 synonym pairs, 2 disagreeing classifiers, 5 unschema'd
`data` narrowings. A core module owning `EventType` (a zod enum or a discriminated union of
`{type, data}` pairs) would: make `EmitInput` (`services/events.ts:20`) and
`WorkflowCtx.emitEvent` (`core/workflow.ts:14`) one type; give the two web classifiers
(C6) a real switch with an exhaustiveness check; make `activity.ts`/`feature-ui.ts`/
`notifications.ts` payload narrowings into `.parse()` calls; and make renaming an event a
compile error rather than a silent UI regression. Do it incrementally: a `z.union([EventType, z.string()])`
keeps `record_event`'s agent-minted types working while typing the 94 known ones.
Two+ consumers per event on the web side = real seam.

**G4. `z.infer` the MCP handler types.** Delete 12 duplicate TS input declarations
(C1) by exporting each tool's `inputSchema` as a named `z.object` and typing the handler
`z.infer<typeof X>`. Purely mechanical, zero behaviour change, removes an entire class of
silent drift.

**G5. One `TicketContentPatch` schema in core.** Define `TicketInput.pick({title, goal,
context, acceptanceCriteria, seams}).partial()` in `schemas.ts`; have `ticket.edit`,
`update_ticket` and `editTicket` all consume it (C2/D2). Resolves the seams asymmetry
and the `.min(1)` asymmetry by construction. Two callers = real seam.

**G6. Move `LiveSignal` and the PTY `ControlFrame` protocol into `@runcastle/core`.**
Both are IO-free contracts crossing a package boundary, both currently hand-mirrored
(C3, C4). `core` exists for exactly this. Adding zod on top gives `live.ts:152` and
`terminal.ts:168` real parses instead of casts.

**G7. A zod schema for the hook envelope + payloads.** `HookBody` (`routes/hooks.ts:44`)
and the four CC payload shapes are declared nowhere shared, narrowed by hand six times
(C5, D7). One schema module consumed by `hook-client.ts` (producer) and `hooks.ts`
(consumer) is a two-caller seam and would let the `default:` branches log an unknown-event
warning instead of swallowing it.

**G8. Add `.output()` to the ~10 procedures whose shape is built inline.**
Not all 59 — the win is concentrated where a service returns a hand-shaped literal
(`routers/feature.ts:219`, `routers/ticket.ts:35-45`, `routers/run.ts:27`), which is where
an accidental shape becomes an accidental contract (D8).

---

## H. Cross-cutting candidates to pass UP

Ranked by how far the smell reaches beyond this scope.

| # | Canonical key | Kind | Confidence | One-line claim | Anchor sites |
|---|---|---|---|---|---|
| H1 | `stringly-typed:event-vocabulary` | violation | high | 94 event types with no enum, 3 naming conventions, 7 synonym pairs, 80/94 unconsumed by name, `data` payload contract absent, 2 disagreeing web classifiers. Touches every service, every workflow, and 8 web modules. | `core/schemas.ts:462-473`, `core/db-schema.ts:270-272`, `services/events.ts:20-26`, `core/workflow.ts:14-19`, `workflows/research.ts:95,125`, `services/features.ts:734`, `workflows/ticket-burner.ts:2125`, `RunBody.tsx:425`, `Inspector.tsx:331` |
| H2 | `unvalidated:zod-schemas-are-types-only` | violation | high | ~20 of 31 core zod schemas are never invoked at runtime; zod is used as a type DSL. No DB row, no tRPC output, no JSON column is ever parsed. | `core/schemas.ts` (whole file), value-import census in B1, `services/tickets.ts:19-37`, `services/events.ts:30-42` |
| H3 | `duplicate:wire-shape-declared-twice` | violation | high | The same shape is declared 2–6× across a package boundary with no type link: ticket-edit patch (×4), MCP tool inputs (×12), `LiveSignal` (×2), PTY frames (×4), `GateId` (×2), `GateResult`/`FeatureGateState` (×2), `EmitInput`/`emitEvent` (×2). | `routers/ticket.ts:52-61` + `mcp/server.ts:837-844` + `services/tickets.ts:129`; `mcp/server.ts` C1 table; `services/bus.ts:22` + `lib/live.ts:23`; `pipeline.ts:9` + `routers/feature.ts:18` |
| H4 | `unschemad:json-boundary` | violation | high | 12 of 13 `JSON.parse` sites are unvalidated `as` casts, including one (`services/settings.ts:264`) reading a file that `core/config-load.ts:23` validates properly. Same for 7 JSON DB columns and every `event.data` read. | E1 table, E2 list, E3 list |
| H5 | `asymmetric:validation-at-one-end` | judgement call | high | tRPC validates inputs (59/59) and outputs (0/59); MCP validates inputs; the hook receiver — the only third-party-fed boundary — validates nothing (`as HookBody`). Human and agent surfaces onto the same service accept different values. | `routes/hooks.ts:44-53`, D2 diff table, `.output(` = 0× |
| H6 | `drift:schema-vs-table` | violation | medium | `db-schema.ts:16` claims the tables mirror the zod schemas; `projects.sandbox`, `projects.closedAt`, `sessions.lap`, `events.lap` have no zod counterpart and `gate_overrides` has no schema at all. Two of those are wire-visible fields the UI can never receive. | `core/db-schema.ts:32,36,166,268,275-281` vs `core/schemas.ts:302-321,380-398,462-473` |
| H7 | `divergent-change:design-system-domain-copies` | violation | medium | `packages/design-system` hand-copies 6 domain enums with zero dependency on `@runcastle/core`, and one copy is already **wrong** (`TicketStatus` has `'blocked'`, lacks `'cancelled'`). Adding a phase requires edits in 4 extra files. Currently unshipped (previews only) — so cheap to fix now. | `design-system/src/screens/{Inspector,OverviewScreen,Sidebar,RunScreen,TerminalScreen,TicketsScreen}.tsx` lines 4-6 |
| H8 | `latent-bug:success-without-evidence` | violation | high | Three independent "success is asserted, not observed" bugs at the wire: a **failed burn renders green** in the run stream (severity read from the type substring, not `data.status`, while the desktop notification reads it correctly); `run.cancel` returns `{ok:true}` for an unknown/finished run and emits no event; `setup.*` mutate machine-global state (including an OAuth token) with no event at all, because `events.project_id` is NOT NULL and the event contract has no machine scope. | `RunBody.tsx:425-434` vs `lib/notifications.ts:96-112` vs `workflows/runner.ts:224-230`; `routers/run.ts:24-28`; `routers/setup.ts:41-48`, `core/db-schema.ts:259` |
| H9 | `redundant:hand-rolled-validators` | judgement call | medium | Manual `typeof x === 'string'` narrowing and hand-written enum membership checks where a zod schema already exists — 6× in `routes/hooks.ts` (two blocks byte-identical), 1× in `dev/args.ts` (14 lines after a correct `safeParse` in the same function), 1× in `lib/notifications.ts`. | `routes/hooks.ts:127-130,164-167,193,278,313-319`, `dev/args.ts:99` vs `:111-113`, `lib/notifications.ts:77-83` |

**Exemplars to point other scopes at (the repo already knows how to do this):**
`trpc/routers/settings.ts:18` (`.input(SettingsUpdateInput)` — core schema on the wire);
`apps/web/src/lib/api.ts:12-25` (`RouterOutputs` derivation);
`core/schemas.ts:23-36` + `apps/web/src/lib/feature-ui.ts:557-562` (`parsePhase` — boundary
parsing with a *documented* degradation, written after a real blank-page outage);
`core/config-load.ts:23` (JSON.parse → schema parse);
`services/prep.ts:104-136` → `lib/api.ts:22-23` (`ProjectFinding` typed end to end).
