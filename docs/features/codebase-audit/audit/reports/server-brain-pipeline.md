# Audit report — server brain: the pipeline state machine

Scope (read in full): `packages/server/src/services/features.ts`, `gates.ts`,
`tickets.ts`, `waypoints.ts`, `findings.ts`.
Supporting reads (contracts only, not audited): `packages/core/src/pipeline.ts`,
`packages/core/src/db-schema.ts`, `packages/server/src/services/repo.ts`,
`services/events.ts`, `errors.ts`, `trpc/routers/feature.ts`, `trpc/routers/ticket.ts`,
`workflows/runner.ts`, `launcher/launcher.ts` (converge), `mcp/server.ts` (tool hops),
`launcher/sessions.ts`, `services/settings.ts`.

Leaf agent — no subagents spawned. Analysis only; no source edited. Tests were read,
never run.

---

## A. Flow map

### A1. Phase advance (the plain forward step)

```
apps/web  →  trpc feature.advance            trpc/routers/feature.ts:127-129
          →  features.advance                services/features.ts:381
             ├─ getFeatureRow                services/repo.ts:96      (SELECT features)
             ├─ nextGate(feature)             core/src/pipeline.ts:168 (G1 swaps to
             │                                 all-waypoints-terminal when mapped)
             ├─ hard refusal if gate.id==='G3' features.ts:391-393     → GateError
             ├─ checkGate                     services/gates.ts:26
             │   ├─ decisions-file-exists → docGate → fileGate → existsSync   gates.ts:107-161
             │   ├─ all-waypoints-terminal → waypoints.listByFeature          gates.ts:31-47
             │   ├─ spec-file-exists     → docGate                            gates.ts:49
             │   ├─ tickets-approved     → tickets.listByFeature (lap-scoped) gates.ts:52-62
             │   ├─ all-tickets-terminal → tickets.listByFeature (cumulative) gates.ts:64-78
             │   └─ human-merge          → always {satisfied:false}           gates.ts:80-82
             └─ setPhase                      services/repo.ts:187
                ├─ UPDATE features SET phase  repo.ts:195
                └─ emit('phase.advanced')     services/events.ts:75 → INSERT events
                                              → publishLive (bus) events.ts:144
          →  Feature returned to the wire (rowToFeature shape)
```

Second entrance to the exact same service: `mcp.complete_phase` →
`toolCompletePhase` (`mcp/server.ts:291`) → `advance` (`mcp/server.ts:321`).

### A2. Burn (G3, the human click)

```
trpc feature.burn                trpc/routers/feature.ts:162-166
 → features.burn                 features.ts:425
   ├─ getFeatureRow / hasActiveRun (repo.ts:96 / :173)
   ├─ listByFeature (tickets)     tickets.ts:53
   ├─ lap scope + pending calc    features.ts:437-444
   ├─ refusals → GateError        features.ts:446-460
   ├─ restarting? sweepOrphanedBurning  tickets.ts:214
   │                → updateTicket(failed) tickets.ts:234  → emit ticket.updated
   │                → emit ticket.failed   tickets.ts:224   (SECOND event, see D3)
   │   then reset failed→pending  features.ts:477-483  (N × emit ticket.updated)
   │   then emit burn.restarted   features.ts:484
   ├─ iterating? setPhase(review→implementation, 'burn.started')  features.ts:496
   ├─ else setPhase(→implementation, 'burn.started')              features.ts:498
   └─ await startRun              workflows/runner.ts:84
        ├─ INSERT runs                              runner.ts:98
        ├─ emit run.started                         runner.ts:124
        └─ … executeRun → sweepOrphanedBurning → emit run.finished
             → maybeAutoAdvance (G4) → setPhase(→review)   runner.ts:242-249
      catch → iterating? setPhase back to review, 'burn.aborted'  features.ts:511-519
```

### A3. Rethink / lap N+1

```
trpc feature.rethink             trpc/routers/feature.ts:100-110
 → features.rethinkAndLaunch     features.ts:585
   ├─ before = getFeatureRow
   ├─ features.rethink           features.ts:539
   │   ├─ guards: phase===review, no active run, no live session,
   │   │          not test-driving (features.ts:541-563)  → GateError
   │   ├─ UPDATE features SET lap = lap+1   features.ts:566   ← bare write, no event
   │   └─ setPhase(→ideation, 'lap.started')  features.ts:567
   └─ launch(feature) = launcher.launchSession(kind:'revisit', lapKickoff)
      catch → UPDATE features SET lap = before.lap (features.ts:595)
            + setPhase(before.phase, 'lap.aborted')  features.ts:596
```

### A4. Ticket store (MCP emit_tickets, and quick-change)

```
mcp emit_tickets → toolEmitTickets      mcp/server.ts:193
 → tickets.storeTickets                 tickets.ts:76
   ├─ getFeatureRow → lap               tickets.ts:83
   ├─ SELECT max(seq) (read)            tickets.ts:85-90   ← read-modify-write
   ├─ resolveBatchBlocking (core)       tickets.ts:92
   ├─ INSERT tickets (batch)            tickets.ts:112
   └─ emit tickets.stored               tickets.ts:113
quick-change path: features.quickChange (features.ts:212) → INSERT features →
  emit feature.created → scaffoldDocs → storeTickets → emit feature.quick_change →
  git.commitDocs (best-effort, swallowed)
```

### A5. Waypoints (mapped ideation)

```
mcp emit_waypoints → toolEmitWaypoints   mcp/server.ts:246
 → waypoints.storeWaypoints              waypoints.ts:80  (INSERT + emit waypoints.stored)
feature.workWaypoint → launcher.workWaypoint → waypoints.claim  waypoints.ts:175
 (conditional UPDATE …WHERE status='open' → re-read verify → emit waypoint.claimed)
mcp resolve_waypoint → toolResolveWaypoint (mcp/server.ts:180) → waypoints.resolve
 waypoints.ts:270 → UPDATE → emit waypoint.resolved → N × emit waypoint.unblocked
session end (hooks.ts / end-session.ts / reconcile.ts / runner.ts:213)
 → releaseForSession → release → UPDATE → emit waypoint.released
G1(mapped) reads them back through gates.ts:31-47
```

### A6. Findings (prepared-field provenance) — the odd one out

```
mcp record_finding → toolRecordFinding    mcp/server.ts:400
 → findings.recordFinding                 findings.ts:117
   └─ ctx.db.transaction (THE ONLY transaction in server src)   findings.ts:119
        UPDATE projects SET <col>=value ; UPSERT/DELETE project_findings
 → emitProject('prep.finding_recorded')   mcp/server.ts:423     ← emitted BY THE CALLER
settings.update → recordHuman             settings.ts:430 / :453
   UPDATE projects (settings.ts:424 / :447) and recordHuman (findings.ts:162)
   are TWO separate statements, NOT a transaction  ← see D5
git dry-run → markVerified                git.ts:1749 → findings.ts:220 (no event, documented)
```

---

## B. Dead code

**B1. `isNotImplemented` branch in `ensureFeatureBranch` is unreachable** —
`packages/server/src/services/features.ts:311`

```ts
    if (isNotImplemented(e)) return { branchReady: false, baseBranch: requestedBase }
```

`NotImplementedError` is **constructed nowhere in the repo**. Verified with a
repo-wide search (`grep -rn "NotImplementedError" --include=*.ts --include=*.tsx`,
excluding `node_modules`/`vendor`/`dist`): the only hits are the class definition
(`errors.ts:15`), the type guard (`errors.ts:48`), the `toTRPCError` branch
(`errors.ts:60`), a `trpc/context.ts:10` comment, and two stale router comments
(`trpc/routers/feature.ts:55`, `:168`). `docs/SPEC.md:110` documents the wave-B
stub convention that has since been fully replaced. So `branchReady` can only ever
be `true` or the error rethrows — and every consumer of `branchReady === false`
(`features.ts:161-163`, `:173`, `:252-254`, `:283`) is dead with it, including the
`'feature.created (branch pending)'` message that can never be emitted.

- Kind: **violation** · Confidence: **high** · Effort S / risk low
- Canonical key: `dead:not-implemented-scaffolding`
- Same dead branch appears at `launcher/launcher.ts:339`, `mcp/server.ts:344`,
  `services/projects.ts:173` and `:185` — see section H, this is repo-wide.

**B2. `notYetTerminal` is exported but has no importer** — `services/gates.ts:92`

```ts
export function notYetTerminal(
```

Verified: the only three occurrences in the whole repo are its own definition and
its two internal call sites (`gates.ts:45`, `gates.ts:76`). No test imports it, no
sibling module does. Over-export, not dead logic.

- Kind: **violation** (over-export) · Confidence: **high** · Effort S / risk low
- Canonical key: `over-export:gates`

**B3. `loopBackPhase` / `rethinkPhase` (core) have no production caller** —
`packages/core/src/pipeline.ts:122` and `:146`

Verified: outside `packages/core/test/pipeline.test.ts` and docs, nothing imports
them. `features.ts` implements the same predicate inline instead:
`feature.phase === 'review' && …` (`features.ts:444`) and
`feature.phase !== RETHINK_LOOP_BACK.from` (`features.ts:541`). Core is a sibling's
scope, so I flag the *duplication* rather than propose the deletion: the pure model
exists and the state machine does not use it (see C1).

- Kind: **violation** (dead pure helpers) / **judgement call** (which side to fix)
- Confidence: **high** on the importer facts · Effort S / risk low
- Canonical key: `dead:pipeline-loopback-helpers`

**B4. `preparedValue` is a test-only export** — `services/findings.ts:284`

```ts
/** Test/inspection helper: the value currently stored for a prepared key. */
```

Verified importers: `test/findings.test.ts` and `test/prepare-session.test.ts` only.
Self-documented as such, so it is not a defect — recording it only so the parent does
not double-count it as dead. `VALUE_COLUMN` (`findings.ts:31`) exists solely to serve
it, which is why the module carries two parallel key→column maps (see C3).

- Kind: **judgement call** · Confidence: **high** · Effort S / risk low
- Canonical key: `test-only-export:findings`

Nothing else in scope failed an importer search. `fileGate` (`gates.ts:107`) is
module-private with one caller and stays — it is the `existsSync` seam.

---

## C. Redundancy & repeated logic

**C1. The loop-back predicate is written three ways** —
`core/src/pipeline.ts:122`/`:146` (unused pure helpers), `features.ts:444`
(`feature.phase === 'review' && !running && pending.length >= 1`), `features.ts:541`
(`feature.phase !== RETHINK_LOOP_BACK.from`). The service imports the *constants*
(`REVIEW_LOOP_BACK`, `RETHINK_LOOP_BACK`) but re-derives the *predicate* the core
functions already encode. Suggested single module: keep `loopBackPhase`/`rethinkPhase`
and call them; delete the inline comparisons.

- Kind: **judgement call** · Confidence: **high** · Effort S / risk low
- Canonical key: `redundant:phase-loopback-predicate`

**C2. `errMsg` is defined four times, identically** —
`services/features.ts:607`, `launcher/launcher.ts:873`, `services/git.ts:160`,
`services/fsbrowse.ts:241`, all exactly:

```ts
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
```

plus four inline copies (`dev/state.ts:200`, `launcher/sessions.ts:729` and `:731`,
`mcp/server.ts:346`). Suggested shared module: one `errMsg` in `src/errors.ts` next to
`toTRPCError`, which is already the error-shape module.

- Kind: **judgement call** · Confidence: **high** · Effort S / risk low
- Canonical key: `redundant:err-msg`

**C3. Three parallel prepared-key → project-column maps** —
`findings.ts:31` (`VALUE_COLUMN`, drizzle column objects),
`findings.ts:43` (`COLUMN_NAME`, the same eight keys as **strings**), and
`settings.ts` `DESCRIPTORS[].projectColumn` (a third spelling, consumed at
`settings.ts:424`/`:447`). Adding a prepared field means editing three lists plus
`PREPARED_KEYS` in core — textbook shotgun surgery. `COLUMN_NAME` exists only because
`.set({ [name]: value })` needs a string; `VALUE_COLUMN` only because `preparedValue`
(a test helper) needs the column object.

```ts
/** Drizzle column NAME for a prepared key, for the `.set()` object literal. */
const COLUMN_NAME: Record<PreparedKey, string> = { setupCommand: 'setupCommand', … }
```

- Kind: **judgement call** · Confidence: **high** · Effort M / risk low
- Canonical key: `redundant:prepared-key-column-map`

**C4. `storeTickets` and `storeWaypoints` are the same function twice** —
`tickets.ts:76` vs `waypoints.ts:80`. Both: early-return on empty, read all existing
rows to compute `startSeq = max(seq)+1`, call `resolveBatchBlocking`, map
`BlockingEdgeError → InvalidInputError`, build rows with `newId(prefix)`, one batch
INSERT, one `<noun>s.stored` event with `{count, seqs}`. The only real difference is
that waypoints additionally accept string-id edges (`waypoints.ts:106-116`). Core
already owns the pure half (`resolveBatchBlocking`); the IO half is duplicated.
Suggested shared module: `services/seq-batch.ts` — `storeSeqBatch(ctx, table, featureId,
rows, {label, eventType})`. Two real callers today, so this is a real seam, not a
hypothetical one.

- Kind: **judgement call** · Confidence: **medium-high** · Effort M / risk medium
  (touches both mutation paths; drizzle table generics are the awkward part)
- Canonical key: `redundant:seq-batch-store`

**C5. The "is this feature quiescent?" guard trio, copy-pasted** —
`rethink` (`features.ts:546-563`) checks active run + live sessions + this feature's
test drive; `deleteFeature` (`features.ts:861-874`) checks/does the same three plus a
worktree; `launcher.reconverge` (`launcher.ts:903-914`) checks live sessions + run;
`retryTicket` (`features.ts:659`) and `burn` (`features.ts:431`) check only the run.
Each writes its own message. Suggested shared module: `assertFeatureQuiescent(ctx,
feature, {what})` returning the reason string, so the three refusals read the same.

- Kind: **judgement call** · Confidence: **high** · Effort M / risk low
- Canonical key: `redundant:feature-quiescence-guard`

**C6. Ticket status counting is written in two places with different rules** —
`features.ts:347-354` (the six-way `TicketCounts` for the list) and
`gates.ts:64-78` / `features.ts:440-442` (the "non-terminal" filter). The terminal
set `['done','failed','cancelled']` is spelled out literally at `features.ts:441`,
`gates.ts:70`, and inverted at `tickets.ts:134` (`MUTABLE_STATUSES`). Waypoints do
have a `TERMINAL` set (`waypoints.ts:40`) — tickets do not. Suggested: a
`TICKET_TERMINAL` set beside `MUTABLE_STATUSES` in `tickets.ts`, exported.

- Kind: **judgement call** · Confidence: **high** · Effort S / risk low
- Canonical key: `redundant:ticket-terminal-set`

---

## D. Inconsistencies & structural smells

**D1. `setPhase` + `setFeatureStatus` + `emit` are called from the tRPC router** —
`trpc/routers/feature.ts:206-218`

```ts
      if (res.ok) {
        setPhase(ctx, input.featureId, 'shipped', 'feature.shipped', `merged to ${res.target}`)
        setFeatureStatus(ctx, input.featureId, 'shipped')
      } else {
        emit(ctx, input.featureId, { type: 'merge.conflict', … })
      }
```

The merge procedure is the only pipeline transition with no service function: the
router orchestrates git + two phase/status mutations + an event. Every other
transition (`advance`, `burn`, `rethink`, `overrideGate`, converge, auto-advance)
lives in a service. Consequences: (a) the house rule "the *service* emits" is broken
literally here — `emit` is imported into the router at `feature.ts:11`; (b) the
transition is untestable without the tRPC layer; (c) it is the one path that emits
*two* phase-ish events (`feature.shipped` from `setPhase`, `feature.status` from
`setFeatureStatus`) for one logical act. `services/features.ts` has no `shipFeature`.

- Kind: **violation** (house rule + layering) · Confidence: **high** · Effort M / risk low
- Canonical key: `inconsistent:event-emission` / `layering:router-owns-transition`

**D2. `overrideGate` never checks that `gate` is the gate it is crossing** —
`services/gates.ts:167-186`

```ts
export function overrideGate(ctx, featureId, gate: GateId, reason: string): Feature {
  const feature = getFeatureRow(ctx, featureId)
  ctx.db.insert(gateOverrides).values({ featureId, gate, reason, ts: Date.now() }).run()
  …
  const next = nextPhase(feature)
```

`gate` is recorded and put in the event message, then **ignored**. The function
advances one phase from wherever the feature is. So `overrideGate(f, 'G5', …)` on a
feature at `ideation` records a G5 override and advances it to `spec`; the gate
argument is decorative. The wire accepts any of the five (`feature.ts:18`,
`z.enum(['G1'…'G5'])`). Nothing compares it to `nextGate(feature)`. The same
mismatch reappears in `undoGateOverride` (`gates.ts:222-241`): it steps back one
phase and drops the newest override *of the named gate*, without checking that this
override is what advanced the feature — so undoing a stale G1 override can walk a
feature back from `implementation` to `tickets`.

- Kind: **violation** · Confidence: **high** · Effort S / risk low
  (add `if (gate !== nextGate(feature)?.id) throw new GateError(...)`)
- Canonical key: `unvalidated:gate-override-id`

**D3. A G5 override splits `phase` from `status`** — `gates.ts:183-185` +
`features.ts:821`

`overrideGate(f,'G5',…)` on a `review` feature sets `phase: 'shipped'` and leaves
`status: 'active'` — only the router's merge path (`feature.ts:207-208`) sets both.
Downstream that divergence is load-bearing: `deleteFeature` refuses on
`feature.status === 'shipped'` (`features.ts:852`), so a phase-shipped feature with
`status: 'active'` is deletable and its branch gets destroyed; and
`unarchiveFeature` derives status *from phase* (`features.ts:821`,
`feature.phase === 'shipped' ? 'shipped' : 'active'`), so archive→unarchive silently
"fixes" the status and changes what delete will do.

- Kind: **violation** (latent bug) · Confidence: **medium-high** (I did not run it;
  the code path is unambiguous) · Effort S / risk low
- Canonical key: `latent-bug:phase-status-divergence`

**D4. One mutation, two events — `sweepOrphanedBurning`** — `tickets.ts:222-230`

```ts
  for (const t of orphaned) {
    updateTicket(ctx, t.id, { status: 'failed', error: reason })   // emits ticket.updated
    emit(ctx, featureId, { type: 'ticket.failed', … })             // and again
  }
```

`updateTicket` already emits `ticket.updated` (`tickets.ts:257`), so every swept
ticket writes two timeline rows for one status flip. This directly contradicts the
convention stated at `mcp/server.ts:199-201` ("`storeTickets` is the mutation and
emits the single event … this tool used to emit an additional note, which
double-logged the same action"). The same N+1 pattern appears in `burn`'s restart
(`features.ts:477-491`: N × `ticket.updated` + one `burn.restarted`) and in
`retryTicket` (`features.ts:713-741`: N × `ticket.updated` + one `ticket.retry`) —
on a timeline the UI polls at 1.5s.

- Kind: **violation** (stated convention) · Confidence: **high** · Effort S / risk low
- Canonical key: `inconsistent:event-emission`

**D5. The same two-row write is transactional in one path and not in the other** —
`findings.ts:117-154` vs `settings.ts:420-458`

`recordFinding` wraps value+provenance in the repo's only transaction, with a
docstring that says why:

```ts
 * Write a prepared value AND its provenance in one transaction — the two must
 * never diverge, or the UI attributes one run's finding to another's evidence.
```

The human path writes the identical pair as two independent statements —
`ctx.db.update(projects)…run()` at `settings.ts:424`/`:447`, then `recordHuman`
(`findings.ts:162`, its own INSERT/DELETE). A failure between them leaves a
human-typed value with no `human` provenance row, which makes it **auto-overwritable
by the next prep run** — the exact outcome rule 1 of the module docstring
(`findings.ts:19-22`) exists to prevent.

- Kind: **violation** (inconsistent atomicity on a stated invariant)
- Confidence: **high** · Effort S / risk low
- Canonical key: `non-atomic:prepared-value-provenance`

**D6. `findings.ts` imports no emitter at all** — verified: the import block
(`findings.ts:1-6`) has no `./events`. `recordFinding` and `recordHuman` both mutate
and emit nothing; the timeline entry is written by the *caller*
(`mcp/server.ts:423 emitProject('prep.finding_recorded')`, `settings.ts:432/455
emitProject('settings.updated')`). Only `markVerified` documents the omission
(`findings.ts:216-218`, "Deliberately emits no event … the dry-run service owns the
timeline entry"). So of five mutating exports, one has a written justification and
two are silently caller-emitted. Consequence: `recordFinding` called from any future
non-MCP path writes no event at all, and the "every mutating service function emits"
rule cannot be checked mechanically.

- Kind: **violation** (house rule) · Confidence: **high** · Effort S / risk low
- Canonical key: `inconsistent:event-emission`

**D7. `rethink` mutates `lap` with a bare UPDATE and no event** —
`features.ts:566`

```ts
  ctx.db.update(features).set({ lap }).where(eq(features.id, featureId)).run()
  return setPhase(ctx, featureId, RETHINK_LOOP_BACK.to, 'lap.started', `rethink — lap ${lap}`)
```

The lap bump is covered only because the *next* statement emits. The rollback in
`rethinkAndLaunch` (`features.ts:595`) does the same bare UPDATE. `escalateToMap`
(`features.ts:772`), `archiveFeature` (`features.ts:800`) and `unarchiveFeature`
(`features.ts:822`) likewise hand-roll `ctx.db.update(features).set(...)` instead of
going through a `repo.ts` setter — `repo.ts` has `setPhase` and `setFeatureStatus`
but no `setLap`/`setMapped`, so three of the six feature-column mutations bypass the
"data-access layer" the module docstring claims to be (`repo.ts:15-21`).

- Kind: **judgement call** · Confidence: **high** · Effort S / risk low
- Canonical key: `inconsistent:feature-column-mutation`

**D8. Two different definitions of "the feature has a live session"** —
`features.ts:797` and `:866` use
`listSessionsByFeature(ctx, featureId).find((s) => s.status === 'live')`, while
`rethink` (`features.ts:549`), `liveSessionOf` (`features.ts:372`) and the launcher's
spawn guard use `activeSessionsForFeature`, which is `['launching','live']`
(`launcher/sessions.ts:64-70`). So **archive and delete miss a session that is still
`launching`**: `archiveFeature` archives a feature whose terminal is mid-spawn and
leaves the PTY running, and `deleteFeature` deletes every `sessions` row
(`features.ts:912`) out from under a launching PTY that will then write to a
vanished session id.

- Kind: **violation** (latent bug) · Confidence: **medium-high** · Effort S / risk low
- Canonical key: `latent-bug:live-session-predicate`

**D9. `archiveFeature` does not cancel an active run; `deleteFeature` does** —
`features.ts:790-807` vs `features.ts:860-863`. Archive's docstring says "an archived
feature must not keep a terminal alive" and ends the session, but a ticket-burner run
keeps burning, committing to the branch of a feature that has been hidden from the
sidebar. `deleteFeature` cancels runs first, by design. Same verb family, different
teardown.

- Kind: **judgement call** (maybe intended — CONTEXT decision #8 is not explicit)
- Confidence: **medium** · Effort S / risk low
- Canonical key: `inconsistent:feature-teardown`

**D10. Terminal-state guards exist for tickets, not for waypoints** —
`tickets.ts:134-142` (`MUTABLE_STATUSES` + `assertMutable`, enforced by `editTicket`
and `cancelTicket`) versus `waypoints.resolve` (`waypoints.ts:270`), which flips
status with **no status precondition at all**. `resolve_waypoint` is an
agent-callable MCP tool (`mcp/server.ts:180`); a repeat call on an already-resolved
waypoint silently overwrites its `summary`, re-emits `waypoint.resolved`, and can
re-emit `waypoint.unblocked` — history rewritten by a retry. Note `claim`
(`waypoints.ts:176-193`) *does* guard carefully, which makes the omission look like
an oversight rather than a decision.

- Kind: **violation** · Confidence: **high** · Effort S / risk low
- Canonical key: `missing-guard:waypoint-resolve`

**D11. `updateTicket` accepts any status → any status** — `tickets.ts:234-266`.
It is the low-level setter (`runner.ts:161`, `ticket-burner.ts` ×9,
`features.ts:482`/`:715`, `tickets.ts:223`), and it enforces nothing: `done →
burning`, `cancelled → pending`, anything goes. The interface is the whole
implementation. Every invariant about ticket lifecycle therefore lives in the
callers, which is why `burn` needs the sweep-then-reset dance (`features.ts:462-483`)
and why an orphaned `burning` row is described as "a dead end in every direction"
(`tickets.ts:202-212`).

- Kind: **judgement call** · Confidence: **high** · Effort M / risk medium
- Canonical key: `shallow:update-ticket`

**D12. Repeated switches / stringly-typed dimensions.** The `Phase` value is
switched or compared literally in at least: `gates.ts:26` (the one legitimate
`GateCheckId` switch), `features.ts:391` (`gate.id === 'G3'`), `features.ts:443-451`
(three phase comparisons + a message-building if/else chain), `features.ts:541`,
`features.ts:821`, `launcher.ts:830`/`:892`, `runner.ts:245` (`gate.check !==
'all-tickets-terminal'`), `mcp/server.ts:309` (`gate?.id === 'G3'`). G3's special
status is asserted independently in **three** places (`features.ts:391`,
`mcp/server.ts:309`, and by omission in `overrideGate`), each with its own copy of the
explanation in a comment. Event `type` is a bare `string` everywhere
(`events.ts:21`), so `'burn.started'`, `'lap.aborted'`, `'phase.advanced'` are
un-typo-checkable string literals scattered across services, the router and the
launcher.

- Kind: **judgement call** · Confidence: **high** · Effort M / risk low
- Canonical key: `primitive-obsession:event-type` / `repeated-switch:phase-gate`

**D13. `data clump`: `(ctx, featureId)` and the branch/base/slug triple.** Every
function in scope takes `(ctx, featureId, …)` and immediately re-fetches the row
(`getFeatureRow` appears 9× in `features.ts` alone), including inside helpers already
holding the feature (`storeTickets` re-reads it at `tickets.ts:83`; `emit` re-reads
`projectId` at `events.ts:45` and `lap` at `events.ts:65` — three SELECTs of the same
row per emission). `createFeature`/`quickChange` build the same `{slug, branch,
baseBranch, branchReady}` clump twice (`features.ts:139-165` vs `:224-255`), ~35
lines duplicated near-verbatim including the identical best-effort `commitDocs` block
(`features.ts:173-179` vs `:283-289`).

- Kind: **judgement call** · Confidence: **high** · Effort M / risk low
- Canonical key: `redundant:feature-creation`

---

## E. Wrong-tool & weak typing

**E1. `ctx.db.transaction` is used exactly once in the entire server** —
`findings.ts:119`. Verified (`grep -rn "db.transaction(" packages/server/src` → this
line and `db/migrate.ts:55`). Consequences inside my scope, in severity order:

- *`storeTickets` seq assignment is a read-modify-write with no transaction and no
  unique constraint* — `tickets.ts:85-112`. `startSeq` comes from a SELECT
  (`tickets.ts:90`), the INSERT happens later (`tickets.ts:112`), and
  `core/src/db-schema.ts:185-208` declares **no unique index on
  `(feature_id, seq)`**. Two `emit_tickets` calls interleaved (two MCP sessions on one
  feature, or MCP racing `quickChange`) both compute the same `startSeq` and both
  insert. Duplicate seqs are silent, and `blockedBy` is stored *as seq numbers*
  (`db-schema.ts:196`), so a duplicate makes every dependency edge ambiguous — the
  scheduler's blocker lookup and `retryTicket`'s `bySeq` map (`features.ts:665`) both
  silently pick one. Identical hazard in `storeWaypoints` (`waypoints.ts:87-133`,
  `db-schema.ts:227-242`).
- *Phase transition + event are two statements* — `repo.ts:195-200`. A crash between
  them leaves the phase moved with nothing on the timeline; since the UI derives
  "what happened" from events, the feature appears to have teleported.
- *`rethink`'s lap bump and phase flip are two statements* (`features.ts:566-567`),
  and its compensating rollback (`features.ts:595-603`) is a hand-rolled saga rather
  than a rollback. Same for `converge` (`launcher.ts:858-870`) and
  `burn`'s abort (`features.ts:511-519`) — three bespoke compensation blocks, each
  with its own `*.aborted` event type.
- *`deleteFeature`'s seven-step teardown* (`features.ts:860-902`) is explicitly
  ordered for partial-failure safety ("deletes DB rows LAST"), and
  `deleteFeatureRows` (`features.ts:910-918`) then issues seven un-transacted DELETEs;
  a failure at delete #4 leaves half a feature.

- Kind: **judgement call** (design) with one **violation** (the missing unique index
  is objectively absent) · Confidence: **high** · Effort M / risk medium
- Canonical key: `non-atomic:multi-row-writes` / `missing-constraint:seq-uniqueness`

**E2. `preparedValue` casts a drizzle result** — `findings.ts:290`

```ts
  return (row?.value as string | null) ?? null
```

`VALUE_COLUMN` is typed `Record<PreparedKey, unknown>` (`findings.ts:40`), which
throws away the column type and forces the cast at the read. Untyped boundary in a
test helper — low blast radius, but it is the reason `VALUE_COLUMN` exists at all.

- Kind: **violation** (unchecked cast) · Confidence: **high** · Effort S / risk low
- Canonical key: `weak-typing:findings-value-column`

**E3. `updateTicket` returns `rowToTicket(updated as TicketSelect)`** —
`tickets.ts:265`. The cast papers over "the row I just wrote must still exist"; a
`NotFoundError` (which the same function already throws 20 lines earlier,
`tickets.ts:246`) would be the honest handling.

- Kind: **violation** (unchecked cast) · Confidence: **high** · Effort S / risk low
- Canonical key: `weak-typing:update-ticket-cast`

**E4. Event `data` is `unknown` and `type` is `string`** — `events.ts:21-26`. Every
emitter invents a payload shape (`{retried: number[]}`, `{from, to}`, `{gate,
reason}`, `{conflict, base, files}`) and every consumer in `apps/web` re-parses it.
No zod schema guards the boundary, in a repo whose convention is "zod is the schema
lib". Directly in scope: `features.ts:490`, `:740`, `:778`, `:804`, `:826`;
`gates.ts:180`; `tickets.ts:116`, `:169`, `:192`, `:228`, `:261`; `waypoints.ts:137`,
`:198`, `:240`, `:290`, `:309`.

- Kind: **judgement call** · Confidence: **high** · Effort L / risk medium
- Canonical key: `weak-typing:event-payload`

**E5. Errors are swallowed in four places with an empty `catch {}`** —
`features.ts:176-178` and `:286-288` (`commitDocs` best-effort — but the swallow also
hides a real git failure, and the comment says only "a commit hiccup"),
`features.ts:896-898` (`rmSync` of session dirs). Each is documented as
deliberate; the pattern is worth naming because there is no "best-effort" helper —
every site re-writes the try/catch/comment.

- Kind: **judgement call** · Confidence: **high** · Effort S / risk low
- Canonical key: `redundant:best-effort-swallow`

**E6. Error-class choice is inconsistent for the same kind of failure.**
`GateError` (→ HTTP 412) is used for genuine gate failures *and* for plain
argument/state validation: "only failed tickets can be retried"
(`features.ts:657`), "feature … is already archived" (`features.ts:791`), "waypoint N
is not open" (`waypoints.ts:178`), "ticket … does not belong to this session's
feature" (`mcp/server.ts:214`). Meanwhile `tickets.ts` uses `InvalidInputError`
(→ 400) for the structurally identical refusal "cannot edit ticket N — it is done"
(`tickets.ts:138`). So *the same rule* — a terminal row may not be mutated — surfaces
as 412 for waypoints and 400 for tickets.

- Kind: **violation** (inconsistent contract) · Confidence: **high** · Effort S / risk low
- Canonical key: `inconsistent:error-taxonomy`

---

## F. Shallow modules / deletion-test candidates

**F1. `gates.fileGate`** (`gates.ts:107-117`) — three lines wrapping `existsSync`,
one caller (`docGate`). Deletion test: inlining it into `docGate` removes a hop and
loses nothing; it does not concentrate the "where do feature docs live" knowledge
(that is `featureDocPath`). Keep-or-inline is cosmetic; noting it only because it is
the one genuine pass-through in scope.
Kind: **judgement call** · Confidence: medium · Effort S / risk low ·
Key: `shallow:file-gate`

**F2. `findings.recordHuman`** (`findings.ts:162-204`) — a near-copy of the non-value
half of `recordFinding` (same upsert, same `UNVERIFIED` spread, same delete-on-null),
differing only in hard-coding `source: 'human'` and nulling evidence. Two functions,
one behaviour, and the *pair* is what causes D5 (one is transactional, one is not).
Deletion test: fold it into `recordFinding` with `source` as the discriminator and
the divergence cannot recur.
Kind: **judgement call** · Confidence: **high** · Effort S / risk low ·
Key: `shallow:record-human`

**F3. `waypoints.release` vs `releaseForSession`** (`waypoints.ts:225` / `:253`) —
`releaseForSession` is a query + `map(release)`. That is fine; what makes it shallow
is that `release` itself does `getWaypoint` → UPDATE → `getWaypoint` again
(`waypoints.ts:226`, `:242`), so releasing N waypoints costs 3N queries and N events.
The same read-write-read shape is in `claim` (`waypoints.ts:176-200`),
`resolve` (`waypoints.ts:276-314`, which additionally lists the whole feature twice —
`before` at `:278` and `after` at `:295`), `editTicket`, `cancelTicket` and
`updateTicket`. Drizzle's `.returning()` (already used in `features.ts:156`,
`events.ts:138`) would collapse each to one statement — and would make them atomic.
Kind: **judgement call** · Confidence: **high** · Effort M / risk low ·
Key: `redundant:read-write-read`

**F4. `FeatureGateState`/`gateState`** (`features.ts:87-91`, `:920-925`) — a private
three-line re-shaping of `GateResult` + `GateDef` that exists so `getFeatureFull` can
return them as one object. Harmless, but it means the wire carries a *third* spelling
of gate state (`GateDef`, `GateResult`, `FeatureGateState`).
Kind: **judgement call** · Confidence: medium · Effort S / risk low ·
Key: `shallow:gate-state`

---

## G. Deepening / extraction opportunities (ranked)

1. **`shipFeature` service** — move `trpc/routers/feature.ts:194-220` into
   `services/features.ts`. Locality: the merge transition is the only one whose
   phase+status+event logic lives in the transport layer, which is also why D3's
   phase/status divergence has no single place to be fixed. Leverage: the router
   drops its `emit`/`setPhase`/`setFeatureStatus` imports; the transition becomes
   unit-testable like `burn` and `rethink`; the G5 override path can then call the
   same function instead of half of it. Two callers exist today (merge, and
   `overrideGate` at G5), so this is a **real seam**.
   Effort **M** · blast radius: one router procedure, one service, `merge-conflict.test.ts`.

2. **Validate + centralize gate crossing (`crossGate`)** — one function that takes
   `(feature, gateId, {override?})`, asserts `gateId === nextGate(feature).id`,
   applies the G3 human-click rule once, and advances. It absorbs D2 (unvalidated
   gate id), the G3 special-case triplicated at `features.ts:391` /
   `mcp/server.ts:309` / `overrideGate`'s silence, and the `checkGate + nextPhase +
   setPhase` sequence repeated at `features.ts:395-402`, `gates.ts:183-184`,
   `launcher.ts:836-846`, `runner.ts:244-248`. Four call sites = a very real seam.
   Effort **M** · blast radius: gates.ts, features.ts, launcher.converge, runner
   auto-advance, `gates.test.ts` + `converge.test.ts`.

3. **`storeSeqBatch` — the shared seq+blockedBy store (C4)** — collapses
   `storeTickets`/`storeWaypoints` and is the natural home for the transaction and
   the `(featureId, seq)` uniqueness that E1 says are missing. Fixing the race once
   beats fixing it twice. Two callers = real seam.
   Effort **M/L** (needs a drizzle migration for the unique index) · blast radius:
   tickets.ts, waypoints.ts, migration, `tickets.test.ts`/`waypoints.test.ts`.

4. **`assertFeatureQuiescent` (C5)** — one guard with one message vocabulary,
   consumed by `rethink`, `deleteFeature`, `reconverge`, `burn`, `retryTicket`.
   Five callers; today each writes its own subset and its own prose.
   Effort **M** · blast radius: features.ts, launcher.ts, `lap-guards.test.ts`.

5. **Ticket lifecycle behind `updateTicket` (D11)** — give the setter the transition
   table it lacks (`pending→burning→done|failed`, `failed→pending` on retry, sweep
   `burning→failed`). Concentrates the invariants the burner, the runner, `burn`,
   `retryTicket` and the sweep each half-enforce today. Leverage is large but it
   changes behaviour under the burner.
   Effort **L** · blast radius: ticket-burner.ts (9 call sites), runner.ts,
   features.ts, tickets.ts. **Highest risk in this list.**

6. **One prepared-key descriptor (C3)** — a single table `{key, column, …}` in core,
   consumed by `findings.ts` and `settings.ts`; drops `VALUE_COLUMN`, `COLUMN_NAME`
   and the duplication with `DESCRIPTORS`, and makes D5's atomicity fixable in one
   place. Two callers = real seam.
   Effort **M** · blast radius: findings.ts, settings.ts, core `PREPARED_KEYS`.

7. **Typed event catalogue (E4/D12)** — a discriminated union (or zod registry) for
   `EmitInput.type` + `data`. Highest total value across the repo, lowest confidence
   that it is worth the churn now; the web consumers must move with it.
   Effort **L** · blast radius: repo-wide. Speculative until the web scope confirms
   it is re-parsing these payloads.

8. **`errMsg` in `errors.ts` (C2)** — trivial, four callers, do it with any of the above.
   Effort **S** · blast radius: 4 files.

---

## G-bis. Test quality & coverage gaps (read, not run)

Read: `gates.test.ts` (189), `tickets.test.ts` (115), `waypoints.test.ts` (222),
`findings.test.ts` (312), `lap-guards.test.ts` (184), `lap-stamping.test.ts` (230),
`rethink.test.ts` (366), `quick-change.test.ts` (289), `burn-guard.test.ts` (139),
`converge.test.ts` (231), `feature-create.test.ts` (137), `feature-list.test.ts` (141),
plus `orphaned-burning.test.ts`, `burn-from-review.test.ts`, `burn-retry.test.ts`,
`archive.test.ts`, `delete.test.ts`, `mcp-tools.test.ts`.

Quality is high for this codebase's norms: real SQLite (no mocking of drizzle), tests
assert on **emitted events** as well as rows, and the lap/rethink/converge suites cover
the compensating-rollback paths explicitly. Gaps that matter, all of them exactly the
places section D/E flag:

- **No test asserts that `overrideGate` rejects a wrong gate id** — because it does
  not (D2). Every case in `gates.test.ts:151-189` overrides `G4` on a feature actually
  at `implementation`, i.e. the gate it really is at; the argument is never varied.
- **No test for the G5-override phase/status divergence** (D3). `archive.test.ts:59`
  ("archives a shipped feature") and `:78` ("unarchives a shipped-phase feature back
  to shipped") seed the shipped state directly, so `phase:'shipped' + status:'active'`
  is never constructed and `deleteFeature`'s status-only refusal
  (`delete.test.ts:268`) is never probed from the phase side.
- **No concurrency test anywhere for `storeTickets`/`storeWaypoints` seq assignment**
  (E1). `tickets.test.ts:23` and `waypoints.test.ts:39` both assert
  "continuing across batches" with strictly serial calls — which is precisely why the
  missing unique index has never surfaced.
- **No test that a `launching` session participates in archive or delete** (D8):
  `archive.test.ts:22` and `delete.test.ts:290` both seed `status: 'live'` and nothing
  else, so the predicate mismatch is invisible to the suite.
- **`waypoints.test.ts` has no double-resolve case** (D10) — `claim`'s double-claim
  refusal *is* tested (`waypoints.test.ts:148`), and `resolve` gets four tests
  (`:175-200`) none of which re-resolves. A pointed asymmetry.
- **Event-count assertions stop one step short of the double emission** (D4):
  `orphaned-burning.test.ts:95-96` asserts exactly one `ticket.failed` event, but
  never that the sweep wrote only one event *in total*, so the accompanying
  `ticket.updated` is not visible to the suite. `waypoints.test.ts:89-93` shows the
  stronger pattern ("emits a single waypoints.stored event per batch") that the ticket
  suite does not copy.
- **`archive` is never tested against an active run** (D9): `archive.test.ts` seeds a
  session but never a `running` run, while `delete.test.ts:276` explicitly covers
  "tears down a live session **and an active run**". The suite mirrors the code's own
  asymmetry rather than questioning it.
- **`findings.test.ts` does cover the settings→`recordHuman` pair** (`:154` "is
  stamped by a project-scoped settings write", `:159` "is dropped by clearing the
  override through settings") — so D5 is a *partial-failure* gap, not a coverage gap:
  the happy path is asserted, and the non-atomicity is by nature not reachable from a
  unit test. Correction noted so the parent does not over-credit the gap.
- Nothing exercises `ensureFeatureBranch`'s `isNotImplemented` branch — consistent
  with B1 (it is unreachable).

---

## H. Cross-cutting candidates to pass UP

1. **`dead:not-implemented-scaffolding`** — the entire wave-B stub apparatus is dead:
   `NotImplementedError` (`errors.ts:15`) is constructed **nowhere**; `isNotImplemented`
   guards five unreachable branches (`features.ts:311`, `launcher/launcher.ts:339`,
   `mcp/server.ts:344`, `services/projects.ts:173`, `:185`), `toTRPCError` carries a
   dead case (`errors.ts:60-61`), and two router comments still promise it
   (`trpc/routers/feature.ts:55`, `:168`). Every "…pending" fallback message and
   `branchReady === false` path dies with it. Verified repo-wide. Expect sibling
   scopes (launcher, mcp, projects) to report the same class — merge under this key.
   **violation / high confidence.**

2. **`inconsistent:event-emission`** — the house rule is violated in three distinct
   shapes, all likely repo-wide: (a) service mutates, *caller* emits —
   `findings.recordFinding`/`recordHuman` (no emitter imported at all) with the event
   at `mcp/server.ts:423` and `settings.ts:432`; also `launcher/sessions.ts:16-17`
   states this as a local convention. (b) one mutation → two events —
   `tickets.ts:222-230`, plus the N+1 storms in `features.ts:477-491` and `:713-741`.
   (c) transition + event emitted from the **tRPC router** —
   `trpc/routers/feature.ts:206-218`. A repo-wide sweep for `emit(` outside
   `services/` will find the rest. **violation / high confidence.**

3. **`non-atomic:multi-row-writes`** — `ctx.db.transaction(` appears **once** in all
   of `packages/server/src` (`findings.ts:119`) plus `db/migrate.ts:55`. In this scope
   alone that leaves un-transacted: seq assignment + insert (`tickets.ts:85-112`,
   `waypoints.ts:87-133`), phase + event (`repo.ts:195-200`), lap + phase
   (`features.ts:566-567`), settings value + provenance (`settings.ts:424` +
   `findings.ts:162`), and a seven-DELETE teardown (`features.ts:910-918`). Sibling
   scopes (burner, git, sessions) almost certainly have their own. Paired with
   **`missing-constraint:seq-uniqueness`** — `core/src/db-schema.ts:185`/`:227` declare
   no unique index on `(feature_id, seq)` for tickets or waypoints, so the race is
   silent rather than loud. **violation / high confidence.**

4. **`redundant:err-msg`** — `function errMsg(e: unknown)` defined verbatim 4× and
   inlined 4× more (`features.ts:607`, `launcher.ts:873`, `git.ts:160`,
   `fsbrowse.ts:241`, `dev/state.ts:200`, `sessions.ts:729`/`:731`, `mcp/server.ts:346`).
   One home: `src/errors.ts`. **judgement call / high confidence / effort S.**

5. **`inconsistent:error-taxonomy`** — `GateError` (412) doubles as the generic
   "invalid state" error while `InvalidInputError` (400) covers the identical rule
   elsewhere: `waypoints.ts:178` vs `tickets.ts:138` for "this row is terminal".
   Whoever audits `mcp/`, `launcher/` and `git.ts` will hit the same choice; worth one
   repo-wide rule (`GateError` = pipeline gate only). **violation / high confidence.**

6. **`primitive-obsession:event-type`** — `EmitInput.type` is `string` and
   `EmitInput.data` is `unknown` (`events.ts:20-26`). ~40 distinct literal event types
   are produced across services, launcher, router, runner and hooks, and consumed by
   `apps/web` by string match. Zod is the repo's schema lib and is not used at this
   boundary. Expect the web scope to report the mirror image (parsing `data` blind).
   **judgement call / high confidence / effort L.**

7. **`redundant:read-write-read`** — service mutators consistently do
   `get → UPDATE → get` instead of `UPDATE … .returning()`, which drizzle supports and
   which the same codebase already uses (`features.ts:156`, `events.ts:138`). In scope:
   `waypoints.claim/release/resolve`, `tickets.editTicket/cancelTicket/updateTicket`.
   Extra queries *and* a lost atomicity opportunity. Likely present in every service.
   **judgement call / high confidence / effort M.**

8. **`layering:router-owns-transition`** — `trpc/routers/feature.ts:194-220` (merge)
   and `trpc/routers/ticket.ts:34-46` (stop/sweep) both implement business logic in the
   transport layer, importing `setPhase`, `setFeatureStatus`, `emit`, `hasActiveRun`
   and `sweepOrphanedBurning` directly. Sibling router scopes should be checked for the
   same. **violation / high confidence / effort M.**

9. **`latent-bug:live-session-predicate`** — `status === 'live'` vs
   `activeSessionsForFeature` (`['launching','live']`) are used interchangeably for the
   same question (`features.ts:797`, `:866` vs `:372`, `:549`, launcher's spawn guard).
   Anywhere the codebase asks "is a terminal open", check which one it used.
   **violation / medium-high confidence / effort S.**

10. **`dead:pipeline-loopback-helpers`** — `loopBackPhase` (`core/src/pipeline.ts:122`)
    and `rethinkPhase` (`:146`) are documented in `docs/SPEC.md:374` and covered by
    core tests, but **no production code calls them**; `features.ts:444`/`:541` inline
    the predicate instead. Flagging for the core scope: this is a pure-model/service
    drift, not just an unused export. **violation / high confidence / effort S.**
