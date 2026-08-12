# CONTRACTS — cross-cutting audit (the contract spine and its drift)

Consolidated from three leaf audits plus orchestrator verification:

- `contracts-core.md` — `packages/core` deep audit
- `contracts-wire.md` — wire + event contract drift across package boundaries
- `contracts-docs.md` — SPEC/UI-SPEC/CLAUDE/README vs code

Scope: the contract spine and its **boundaries**. Server service internals and web
component internals belong to sibling orchestrators; where a finding straddles a
boundary it is recorded here and flagged for the owning scope.

**Consolidation note.** Every claim promoted to section H was named by ≥2 leaves or
verified by the orchestrator directly against source. Three leaf claims were
corrected during consolidation — see §J (Corrections) at the end. Both dead-code
claims were independently re-verified per the briefing's rule.

---

## A. Flow map — the intended spine, and what actually enforces it

```
packages/core/src/schemas.ts   zod: Phase, Ticket, Feature, SessionRow, Run, …
        │   z.infer  (types only — see H1)
        ├──> core/db-schema.ts          drizzle tables, text().$type<X>()   [no runtime constraint]
        ├──> server/services/*          hand-shaped return objects          [no validation]
        │        └──> server/trpc/routers/*   59 procedures                 [inputs 59/59, outputs 0/59]
        │                    └──> apps/web/src/lib/api.ts  RouterOutputs    [correct pattern]
        ├──> server/mcp/server.ts       14 registerTool zod inputs          [re-declared, not imported]
        └──> packages/design-system/*   domain enums hand-copied            [no core dependency]
```

**What is genuinely good, stated first so the findings below are not read as a
blanket condemnation:**

- `packages/core/src/pipeline.ts` models the pipeline **as data** (`PIPELINE:
  PhaseDef[]`, `:31-74`), derives the order from it (`const ORDER = PIPELINE.map(…)`,
  `:76`) rather than restating it, and types the two backward transitions separately
  with prose explaining why. This is the reference-quality module in the spine.
- `apps/web/src/lib/api.ts:12-25` derives every web type from `RouterOutputs` — the
  correct pattern, applied consistently.
- **Core is genuinely IO-free and the barrel's browser-safe invariant holds.**
  Only `config-load.ts:1` and `paths.ts:1-2` import Node builtins; neither is in the
  barrel; `package.json:6-10` backs it with dedicated subpath exports. Zero
  `Date.now`/`Math.random`/`crypto`, zero `any`/`as any`/`@ts-ignore`/`.passthrough()`.
- **The contracts that are *executed* did not drift.** All 12 distinct
  `mcp__runcastle__*` names in `packages/skills/**` resolve to real `registerTool`
  calls; all 5 gate ids and all 6 `GateCheckId` values match `pipeline.ts:9-74`
  exactly; ports (4512/4513) and the data dir hold completely. This is the single
  most useful diagnostic in the audit — see H4.
- The `ProjectFinding` chain (`findings.ts:242` → `prep.ts:104` → `lib/api.ts:22-23`)
  is the one shape typed cleanly end to end.

---

## B. Dead code

### B1. `NotImplementedError` is never thrown — five live branches unreachable
`dead:wave-b-scaffolding` · **violation** · confidence **high** · named by 2 leaves + orchestrator

`new NotImplementedError` has **zero occurrences repo-wide**. The class
(`packages/server/src/errors.ts:15-22`), its predicate (`:48-49`) and its
`toTRPCError` mapping (`:60`) all survive, and five production branches test for it:

- `packages/server/src/services/features.ts:311` — dead fallback:
  ```ts
  // Pre-B2 the git service is a stub — the feature is created branchless …
  if (isNotImplemented(e)) return { branchReady: false, baseBranch: requestedBase }
  ```
- `packages/server/src/services/projects.ts:166-190` — an entire section headed
  `// --- B2 tolerance ---`. `assertRepoTolerant` (`:168`) can now only delegate and
  rethrow (its `existsSync(join(repoPath,'.git'))` fallback is dead);
  `detectMainBranchTolerant` (`:183`) likewise (its `return ctx.config.mainBranch` is
  dead). Both are now pure pass-throughs — also §F.
- `packages/server/src/launcher/launcher.ts:339` — dead branch (see B2)
- `packages/server/src/mcp/server.ts:344` — a ternary whose
  `'docs checkpoint skipped (git service pending)'` arm can never be selected

Plus stale comments at `packages/server/src/trpc/routers/feature.ts:55` and `:168`
describing stubs that no longer exist.

Build-era wave-A/wave-B scaffolding: the stubs were filled in, but the branches
written to *tolerate* them stayed. Pairs with the doc half at H8.

### B2. `session.worktree_pending` — a dead event type
`dead:event-type` · **violation** · confidence **high**

Exactly one emitter, `packages/server/src/launcher/launcher.ts:342`, sitting *inside*
B1's unreachable `isNotImplemented(e)` branch, and **zero consumers** anywhere in
`packages/` or `apps/`. Verified unreachable *and* unconsumed. A typed event
vocabulary (H2) would have surfaced this automatically.

### B3. `loopBackPhase` / `rethinkPhase` — dead exports the SPEC vouches for
`dead:pipeline-loopback` · **violation** · confidence **high** · orchestrator re-verified

`packages/core/src/pipeline.ts:122` and `:146`. A repo-wide `grep -w` returns **no
callers outside `packages/core/test/pipeline.test.ts`**. Both carry doc comments
claiming to be "the pure model behind the server's guard", but the server inlines the
logic against the raw constants at `packages/server/src/services/features.ts:496,
515, 541, 567`. `docs/SPEC.md:374,464` vouches for them and mandates a vitest — **a
test is not a caller**, and the test is what makes them look alive.

This is a reusable pattern worth a repo-wide sweep: *exported, spec-blessed,
unit-tested, and uncalled*. Flagged to root as `deadcode:spec-declared-helpers`.

### B4. The end-to-end smoke walk cannot run — and nothing would notice
`dead:smoke-walk` · **violation** · confidence **high** · orchestrator-corrected (see §J.1)

`scripts/smoke.ts` is the executable form of the SPEC §206 end-to-end walk. It is
broken in at least two places:

- `scripts/smoke.ts:191` — `await trpc.project.init({ repoPath: TARGET })`.
  **`project.init` does not exist**; `packages/server/src/trpc/routers/project.ts:13-113`
  exposes `list, roots, browse, branches, open, close, rename, …`. The script dies at
  STEP 2.
- `scripts/smoke.ts:198-201` — `trpc.feature.create({ title, oneLiner, size: 'collapsed' })`
  passes a removed field **and omits the required `projectId`**
  (`packages/server/src/trpc/routers/feature.ts:22-28`).

The client is fully typed — `scripts/smoke.ts:103`:
`const trpc = createCallerFactory(appRouter)(ctx as never)` — so these *are* type
errors. **Nothing ever compiles the file**: `scripts/` has no `tsconfig.json` and
appears in no tsconfig `include`, and the root gate is
`"typecheck": "bun run --filter '@runcastle/core' --filter '@runcastle/server' typecheck"`
(`package.json:17`). There is also no `package.json` script that runs it.

So the repo's documented end-to-end verification walk is dead, silently rotted past
two removed contracts, and sits in the one directory the verification gate does not
cover. **This is a hole in the gate, not just a stale file** — see H9.

### B5 (docs). Concepts alive only in prose
`dead-doc:feature-size` · **violation** · confidence **high**

`FeatureSize`/`size`/`collapsed` was removed deliberately (migration 0008; proof at
`packages/server/test/feature-size-drop.test.ts:16-19`) yet is still described at six
doc sites (`docs/SPEC.md:39,46,58,117,199,232`; `docs/UI-SPEC.md:41,44`). **The stale
reference reaches runtime**: `packages/server/src/launcher/artifacts.ts:248` injects
the phrase "for a `full` feature" into every converge session's system prompt, so a
live agent is told about a feature attribute that cannot exist. Doc wrong, code
current — but the prompt injection makes it a runtime concern, not a cosmetic one.

Also dead in docs: `project.get`/`project.init` (`SPEC.md:116,117`),
`RUNCASTLE_LAUNCH_MODE` (an env var no code reads), and UI-SPEC's "Pop out ↗"
control (`UI-SPEC.md:52`, contradicted by `:59` seven lines later).

---

## C. Redundancy

### C1. The same shape declared twice or more, with no type link
`duplicate:wire-shape-declared-twice` · **violation** · confidence **high** · named by 3 leaves

The single most repeated structural problem in this scope. Verified instances:

| Shape | Declaration A | Declaration B (+more) | Link? |
|---|---|---|---|
| `GateId` | `core/pipeline.ts:9` (TS union) | `server/trpc/routers/feature.ts:18` (`z.enum`) | none |
| ticket-edit patch | `routers/ticket.ts:52-61` | `mcp/server.ts:837-844`, `services/tickets.ts:129`, handler type | none (×4) |
| MCP tool inputs | zod `inputSchema` | inline TS handler type | none (**12 of 14 tools**) |
| `LiveSignal` | `services/bus.ts:22-35` | `apps/web/src/lib/live.ts:23-25` (comment admits the mirror; `as`-cast at `:152`) | none |
| PTY control frames | `pty/registry.ts:17` | `pty/ws.ts:66,77`, `terminal.ts:151,164` | none (**×4**, zero zod) |
| `WaypointDisposition` | `core/schemas.ts:162` | terminal subset of `:158`, inline union at `core/workflow.ts:47` | none (×3) |
| `MODEL_STEPS` ⊇ `SessionKind` | `core/config.ts:18` | `core/schemas.ts:58` | none |
| `PREPARED_KEYS` vs `keyof Project` | `core/schemas.ts:241` | `core/schemas.ts:302-321` | none |
| domain enums | `core/schemas.ts` | `design-system/src/screens/*` (6 enums) | none |

`satisfies` — the one-line fix the repo already knows — is used **exactly once**
(`core/schemas.ts:270`), out of at least four opportunities in core alone.

Two consequences worth naming concretely:

- **`drift:ticket-edit-surface`** — one service (`editTicket`, `services/tickets.ts:150`),
  four declarations, already divergent: `ticket.edit` **omits `seams`** and requires
  `.min(1)`; `update_ticket` **has `seams`** and allows `""`; the id key is `ticketId`
  vs `id`. Net: *a human cannot fix a ticket's seams in the UI but an agent can; an
  agent can blank a title but a human cannot.* Same service, two different contracts,
  depending on who you are.
- **`GateId`** — adding a `G6` to `PIPELINE` compiles cleanly and is then silently
  rejected at the wire. The same file demonstrates the correct pattern 45 lines later
  (`kind: SessionKind`, `feature.ts:63`).

### C2. Path knowledge core owns, rebuilt by hand
`duplicated:path-knowledge` · **violation** · confidence **high**

`packages/server/src/routes/hooks.ts:352` hand-builds `docs/features/${slug}/` though
`featureDocsRel` exists in core and is used correctly at
`packages/server/src/launcher/artifacts.ts:107`. `packages/server/src/config.ts:26`
hand-builds `join(root,'worktrees')`. Two sites only — but they are exactly the
Windows-path class CLAUDE.md warns about, and core already owns the knowledge.

### C3. Four documents restate the same conventions list, and have diverged
`redundant:convention-restatement` · **judgement call** · confidence **high**

SPEC §0/§12, CLAUDE.md, README, and `docs/agents/*` each restate the package map and
conventions. Both package maps are now incomplete (neither lists
`packages/design-system`, added later).

---

## D. Inconsistencies & structural smells

### D1. The contract spine is never enforced at runtime — the four-boundary chain
`unvalidated:contract-spine` · **violation** · confidence **high** · named by 3 leaves

Four independently verified facts compose into one latent-bug chain:

1. **The database cannot reject a bad enum value.** All 12 enum columns are
   compile-time casts: `packages/core/src/db-schema.ts:113`
   ```ts
   phase: text('phase').notNull().$type<Phase>(),
   ```
   (also `:82, 121, 167, 170, 203, 220, 232, 238, 248`). Drizzle's `enum:` option is
   used **0 times**; there are no CHECK constraints. `$type<>()` emits no SQL.
2. **The zod schemas are almost never executed.** The wire leaf enumerated every
   *value*-import of `@runcastle/core`: the complete set of schemas ever used as
   runtime validators is **five** — `SessionKind`, `ProjectName`,
   `SettingsUpdateInput`, `Phase`, and the MCP set
   (`Phase, PreparedKey, TicketInput, WaypointDisposition, WaypointInput`). The other
   ~20 — `Feature`, `Ticket`, `Run`, `SessionRow`, `Project`, `EventRow`, `TestNote`,
   `Waypoint`, `ProjectFinding`, every status enum — are `import type` only. The zod
   runtime objects ship in the bundle and are never called.
3. **No tRPC procedure validates its output.** `.output(` = **0 occurrences** across
   `packages/server/src`, against 59 procedures. Inputs are validated 59/59; outputs
   0/59.
4. **The web then trusts that shape completely** via `RouterOutputs`
   (`apps/web/src/lib/api.ts:12-25`) — the *correct* pattern, which is precisely why
   it propagates the unverified assumption intact.

**The resulting latent bug.** `apps/web/src/lib/feature-ui.ts:73-89`:
```ts
export function phaseGlyph(phase: Phase): string {
  switch (phase) {
    case 'ideation': return '◉'
    …
    case 'shipped': return '✓'
  }
}
```
No `default:` — and that is *correct* TypeScript; tsc proves the switch exhaustive and
the briefing rightly says not to report what tooling enforces. The problem is that
**tsc's proof rests on a premise nothing checks.** A row whose `phase` holds any other
string travels an unconstrained column, an unvalidated service return and an
unvalidated tRPC boundary to arrive here, where the function returns `undefined` while
its signature promises `string`.

**This is not hypothetical.** `parsePhase` (`core/schemas.ts:33`) exists *because this
already happened* — it was added reactively after one bad value blanked the entire web
app (finding F19, documented in the comment at `schemas.ts:23-32`). Eleven other enum
columns have the identical failure mode and no equivalent guard. The repo has already
paid for this bug once and fixed only the instance.

This is the finding no single-package agent can see: each of the four facts is
defensible in its own package; only the composition is dangerous.

### D2. The event vocabulary: 94 stringly-typed literals, no schema
`stringly-typed:event-vocabulary` · **violation** · confidence **high** · named by 3 leaves

`core/schemas.ts:462-473` types the UI's lifeblood as free text
(`type: z.string()`, `data: z.unknown().optional()`); `core/db-schema.ts:270` stores it
as plain `text('type')` — no `$type<>()`, no enum. Against **94 distinct emitted
literals**. Measured consequences:

- **Set difference: 80 of 94 emitted types are never consumed by name; 0 consumed
  types are unemitted.** The vocabulary is ~85% write-only.
- **Seven synonym pairs.** `ticket.retry` (`services/features.ts:734`) vs
  `ticket.retrying` (`workflows/ticket-burner.ts:2125`); `research.error` vs
  `research.failed` (`workflows/research.ts:95` and `:125` — *same file, 30 lines
  apart*); `session.ended` vs `session.auto_ended`;
  `ticket.stopped`/`cancelled`/`failed`; four `merge.conflict.*` variants.
- **Three naming conventions coexist** — kebab (`project.slow-path`), snake
  (`session.pty_exited`), plain (`run.finished`).
- **No consumer switch has an exhaustiveness check — none *can***, because the type
  is `string`.

### D3. Latent bugs from the untyped event payload
`latent-bug:success-without-evidence` · **violation** · confidence **high**

- **A failed burn renders green.** `apps/web/src/components/bodies/RunBody.tsx:425-434`
  classifies severity by **regex on the type string**; `run.finished` matches
  `/finished/` → `'ok'` regardless of `data.status`. `apps/web/src/lib/notifications.ts:96-112`
  reads the same payload correctly and says "Burn failed". One event, two answers, and
  `workflows/runner.ts:205,224` fires `run.error` *and* `run.finished` on every failure.
- **Two disagreeing tone classifiers** (`redundant:event-tone-classifier`) —
  `RunBody.tsx:425` and `Inspector.tsx:331` are independent substring matchers that
  disagree: `ticket.cancelled` → error / neutral; `ticket.blocked` → neutral / danger;
  `merge.conflict.needs-human` → error / neutral.
- `run.cancel` returns `{ok:true}` for unknown run ids and emits nothing
  (`routers/run.ts:24-28`).
- `setup.*` mutates machine state — including an OAuth token — and emits **no event**
  (`routers/setup.ts:41-48`), because `events.project_id` is `NOT NULL`
  (`db-schema.ts:259`) and there is no machine scope. A structural gap in the
  "every mutation emits an event" rule, not an oversight.

### D4. zod ↔ drizzle divergence
`drift:zod-drizzle` · **violation** · confidence **high** · named by 2 leaves

`db-schema.ts:16` claims the tables mirror the zod schemas. Five divergences:
`projects.sandbox` (`:32`), `projects.closedAt` (`:36`), `sessions.lap` (`:166`),
`events.lap` (`:268`) have **no zod counterpart**, and `gate_overrides` (`:275-281`)
has **no zod schema at all**.

Sharpest is `closedAt`: it drives multi-project open/close
(`services/projects.ts:40,89,107,131`) while the wire type says the field does not
exist. `rowToProject` (`services/repo.ts`) enumerates 14 fields and silently omits
both project columns. Timestamps, booleans, JSON and nullability are otherwise
correctly mirrored wherever both sides have the field — this is drift, not chaos.

### D5. Validation asymmetry
`asymmetric:validation-at-one-end` · **judgement call** · confidence **high**

tRPC validates inputs 59/59 and outputs 0/59. MCP validates inputs. The hook
receiver — **the only third-party-fed boundary in the system** — validates nothing:
`packages/server/src/routes/hooks.ts:53` does `as HookBody`, then six hand-rolled
`typeof x === 'string'` narrowings (`:127-130` and `:164-167` are *byte-identical*),
with `default:` branches silently swallowing unknown events. The least trusted input
gets the weakest checking.

### D6. Unschema'd JSON at boundaries that have schemas
`unschemad:json-boundary` · **violation** · confidence **high** · named by 2 leaves

12 of 13 `JSON.parse` sites are unvalidated casts. Standout:
`packages/server/src/services/settings.ts:264` and `packages/core/src/config-load.ts:23`
**read the same file**, and only the latter validates it. The JSON DB columns
(`db-schema.ts:194-196` `seams`/`blockedBy`, `:204` `commits`, `:207` `conflictFiles`)
are `$type<>()` casts over text — malformed JSON yields a value that lies about its
type. Every `event.data` read is likewise a cast.

### D7. Enum declaration style is inconsistent
`inconsistent:enum-declaration` · **violation** · confidence **high**

`GateId`/`GateCheckId` are plain TS unions (`core/pipeline.ts:9,11`) while all 14
other core enums are `z.enum`. Because pipeline's form carries no runtime value, no
`.safeParse` for gate ids can exist — which is *why* the wire hand-copied the list
(C1). Live consequence at `apps/web/src/lib/feature-ui.ts:581`:
`((e.data ?? {}) as { gate?: GateId }).gate ?? null`. Also
`project_findings.key` (`db-schema.ts:...`) is the one enum column with no `$type` cast.

### D8. Domain enums hand-copied into design-system, one already wrong
`divergent-change:design-system-domain-copies` · **violation** · confidence **medium** · named by 2 leaves

`packages/design-system` declares **no dependency on `@runcastle/core`**, so it
rewrites the vocabulary: `Phase` ×3 (`Inspector.tsx:5`, `OverviewScreen.tsx:6`,
`Sidebar.tsx:4`), `RunStatus` (`RunScreen.tsx:4`), `SessionStatus`
(`TerminalScreen.tsx:4`), `TicketStatus` (`TicketsScreen.tsx:5`), plus a third
`LaneStatus` variant (`RunScreen.tsx:5`).

One has **already drifted**: `TicketsScreen.tsx:5` has `'blocked'` where
`core/schemas.ts:44` has `'cancelled'`. `blocked` is a *derived* UI state (there is a
`ticket.blocked` event and a `blockedBy` column), so this type both invents a member
core lacks and cannot represent a genuinely cancelled ticket.

**Severity is bounded and should be stated honestly:** `apps/web` does not import
`@runcastle/design-system` at all — its only importers are `.design-sync/previews/*`.
Unshipped, therefore cheap to fix now, and it has already demonstrated it drifts.

### D9. Doc drift (full tables in `contracts-docs.md`)
`drift:contract-authority` · **violation** · confidence **high**

Measured coverage of the document that says "**Names in this file are law**"
(`SPEC.md:8`): **25/59 tRPC procedures, 7/14 MCP tools**, 5 spec-named procedures with
no implementation, 4 entire routers (`ticket`, `notes`, `setup`, `system` = 17
procedures) absent. `CLAUDE.md:66` still says "4 MCP tools" against 14 real
`registerTool` calls. `trpc/router.ts:14-17` still instructs readers to "keep the
procedure names/inputs aligned with §4" — false as written.

Every enum SPEC pinned has since grown exactly one terminal value, unrecorded:
`TicketStatus` +`cancelled`, `Feature.status` +`archived`. `SPEC.md:373` is internally
contradictory. **Direction: doc wrong, code current** in nearly every case — SPEC's own
header (`:3-6`) already half-concedes this by declaring the code authoritative.

Two smaller drifts worth carrying: CLAUDE.md places core's only file read in
`config.ts` when it lives at `config-load.ts:21-23`; and `implementation` is pinned in
`core/schemas.ts:13-20` but rendered as `'build'` at
`apps/web/src/lib/feature-ui.ts:211` and in `README.md:31,111` — a synonym drift
`docs/agents/domain.md:41-45` explicitly forbids.

---

## E. Wrong-tool & weak typing

- **`$type<>()` where a constraint was needed** (D1.1) — `enum:` used 0 times.
- **zod as a type-generator only** (D1.2) — the repo pays for zod at every definition
  and collects none of its runtime benefit for entities.
- **`data: z.unknown()`** (`core/schemas.ts:472`) — no per-type payload contract.
- **`latentbug:env-empty-string`** · **violation** · high — `core/config-load.ts:49-51`
  guards on `!== undefined`, so `RUNCASTLE_BURN_CONFLICT_ATTEMPTS=''` →
  `Number('')===0` → passes `.min(0)` → **silently disables the in-loop conflict
  resolver** (`core/config.ts:216-217`: "`0` disables it"). Every other numeric env key
  uses truthiness and is immune. Env parsing is 20 hand-rolled branches with three
  coercion idioms.
- **`newId` returns bare `string`** (`core/ids.ts`) — primitive obsession across 22
  files; project/feature/ticket/run/session ids are mutually assignable.
- **Hand-rolled validators where a schema exists** — 6× in `routes/hooks.ts` (two
  blocks byte-identical), 1× in `dev/args.ts:111-113` (14 lines after a correct
  `safeParse` in the same function), 1× in `lib/notifications.ts:77-83`.
- **`ctx as never`** at `scripts/smoke.ts:103` — in the one directory no tsconfig
  covers (B4).

## F. Shallow modules

- `assertRepoTolerant` / `detectMainBranchTolerant`
  (`services/projects.ts:168`, `:183`) — with B1 established, each is a one-line
  delegation wrapping a dead catch. Interface ≡ the function it wraps; they now fail
  the deletion test.
- `docs/agents/triage-labels.md` (15 lines restating a label list) and CLAUDE.md's
  package-map table (says less than `package.json`) — documents whose interface ≈
  their implementation.

## G. Deepening / extraction opportunities — ranked across all leaves

1. **Route the six existing `rowToX` adapters through `X.parse()`**
   (`extract:row-validation`). ~6 lines at a seam **that already exists**. Converts D1's
   four unchecked assumptions into one enforced boundary, resurrects ~20 dead
   validators, kills the unschema'd-JSON-column class (D6), and turns D4 into a compile
   error. Highest leverage-to-effort ratio in the audit by a wide margin.
2. **Type the event vocabulary in core** (`extract:event-type-union`) — a `z.enum`, or
   better a discriminated union keyed on `type` giving `data` a per-type shape. Two
   real adapters already exist (server emitters, web consumers), so this is a **real
   seam**. Kills D2's synonym drift, D3's classifier disagreement, and B2's dead type,
   and gives the web the exhaustiveness checking it currently cannot have.
3. **`text('x', { enum: Zod.options })` across the 12 enum columns** — makes the
   database refuse what the types already forbid; complements #1 at the write side.
4. **Generate the contract doc instead of writing it** (`extract:generated-contracts`).
   A `docs/CONTRACTS.generated.md` derived from `AppRouter` + the `registerTool` calls
   + `schemas.ts` would have caught D9's procedure, tool and enum drift automatically.
   Argued directly by H4: the contracts that are *executed* did not drift.
5. **Four one-line `satisfies` links** — `GateId`↔`PIPELINE`, `MODEL_STEPS`↔`SessionKind`,
   `PREPARED_KEYS`↔`keyof Project`, `WaypointDisposition`↔`WaypointStatus`. The repo
   already knows this idiom (`schemas.ts:270`); it is simply under-applied.
6. **Lift `LiveSignal` and the PTY control frames into core** — two IO-free contracts
   currently declared 2× and 4× respectively across package boundaries.
7. **A declarative env table** — fixes E's `latentbug:env-empty-string` uniformly
   rather than per-key.
8. **Branded id types** for project/feature/ticket/run/session.
9. **Delete the wave-B tolerance scaffolding** (B1 + B2 + F) — mechanical, low-risk,
   removes two misleading comments.
10. **Split `db-schema` off the isomorphic barrel** — `index.ts:14` pulls
    `drizzle-orm/sqlite-core` into the web bundle. The invariant survives (pure JS) but
    `apps/web` bundles an ORM it does not declare.

## H. Cross-cutting candidates to pass UP

| # | Canonical key | Kind | Conf | Claim | Leaves |
|---|---|---|---|---|---|
| **H1** | `unvalidated:contract-spine` | violation | high | **Headline.** The contract spine is type-level only end to end: 12 enum columns are `$type<>()` casts with no SQL constraint; ~20 of ~25 core entity schemas are never invoked at runtime; `.output(` = 0/59; the web faithfully propagates the unverified shape. tsc's exhaustiveness proofs rest on a premise nothing checks — and `parsePhase` (`core/schemas.ts:23-36`) exists because this bug **already shipped once**. Fix is one seam (G1). | 3/3 |
| **H2** | `stringly-typed:event-vocabulary` | violation | high | 94 event types, no enum (`core/schemas.ts:469`, `db-schema.ts:270`), 3 naming conventions, 7 synonym pairs, 80/94 never consumed by name, `data: z.unknown()`, 2 disagreeing web classifiers, 1 provably dead type. Touches every service, every workflow, 8 web modules. | 3/3 |
| **H3** | `duplicate:wire-shape-declared-twice` | violation | high | The generative smell behind most of this report: the same shape declared 2–6× across package boundaries with **no type link** — MCP inputs ×12, PTY frames ×4, ticket-edit ×4, `WaypointDisposition` ×3, `GateId` ×2, `LiveSignal` ×2, 6 design-system enums. `satisfies` used once out of ≥4 chances. Already produced a user-visible divergence (humans and agents get different ticket-edit contracts). **Ask other scopes for hand-maintained mirrors of derivable facts.** | 3/3 |
| **H4** | `drift:contract-authority` | violation | high | Three incompatible authority claims (`SPEC.md:8` "names are law" vs `SPEC.md:3-6` "code is authoritative" vs `UI-SPEC.md:8` "supersedes §10"), and the pin is wrong about ~half of what it pins (25/59 procedures, 7/14 tools). Any agent told "read SPEC.md before implementing anything" (`CLAUDE.md:7`) is misdirected. **Root's headline doc finding.** Cheap to resolve: pick one authority, demote the rest explicitly. | 1 + orch |
| **H5** | `verified:executed-contracts-hold` | judgement (positive control) | high | **The diagnostic that explains H4 and argues for G4.** Every contract that is *executed* held perfectly: 12/12 skill MCP tool names resolve, 5/5 gate ids + 6/6 check ids match, ports/data-dir exact, 10/10 ADRs uncontradicted. Every contract that is only *read* drifted. The fix for doc drift is to make docs derived/executable, not to write them more carefully. | 1 + orch |
| **H6** | `latent-bug:success-without-evidence` | violation | high | Three "success asserted, not observed" bugs: a failed burn paints green (`RunBody.tsx:425-434` regex-matches `/finished/` while `notifications.ts:96-112` reads the payload correctly); `run.cancel` returns `{ok:true}` for unknown ids and emits nothing (`routers/run.ts:24-28`); `setup.*` mutates machine state incl. an OAuth token with no event, structurally blocked by `events.project_id NOT NULL` (`db-schema.ts:259`). | 1 |
| **H7** | `unschemad:json-boundary` | violation | high | 12/13 `JSON.parse` sites unvalidated, incl. `services/settings.ts:264` and `core/config-load.ts:23` reading **the same file** with only one validating. Plus 7 JSON DB columns and every `event.data` read. | 2/3 |
| **H8** | `stale:wave-ownership` | violation | high | Build-era wave-A/B coordination is fiction but still live in agent instructions (`CLAUDE.md:20,21,46,50-72`; `SPEC.md:97,110,212`) **and** left code fossils (`routers/feature.ts:55,168`; `services/projects.ts:166-190`; 5 unreachable branches; 1 dead event type). `new NotImplementedError` = 0 repo-wide. One finding, two owners. "Never touch files outside your assigned dirs" is the highest-impact stale directive in the repo. | 2/3 + orch |
| **H9** | `gap:verification-coverage` | violation | high | **Orchestrator finding.** `scripts/` is covered by **no tsconfig and no typecheck filter** (`package.json:17` filters core+server only). `scripts/smoke.ts` — the executable form of the SPEC §206 end-to-end walk — calls the removed `project.init` (`:191`) and omits the required `projectId` (`:198-201`) against a fully typed caller (`:103`). These are type errors nothing compiles, in a file nothing runs. The gate has a hole exactly where the end-to-end check lives. | orch |
| **H10** | `drift:zod-drizzle` | violation | medium | `db-schema.ts:16` claims mirroring; 4 columns have no zod counterpart and `gate_overrides` has no schema. Two are wire-visible fields the UI can never receive (`closedAt` drives multi-project open/close). Becomes a compile error under G1. | 2/3 |
| **H11** | `deadcode:spec-declared-helpers` | violation | high | `loopBackPhase`/`rethinkPhase` (`core/pipeline.ts:122,146`) are exported, SPEC-blessed (`SPEC.md:374,464`), unit-tested — and uncalled; the server inlines the logic (`services/features.ts:496,515,541,567`). **A test is not a caller.** Worth a repo-wide sweep for the pattern. | 1 + orch |
| **H12** | `divergent-change:design-system-domain-copies` | violation | medium | 6 domain enums hand-copied with zero core dependency; `TicketsScreen.tsx:5` already has `'blocked'` where core has `'cancelled'`. Unshipped (`apps/web` does not import it; only `.design-sync/previews/*` do), so cheap now. Sequence behind the web scope's ruling on design-system's future. | 2/3 |
| **H13** | `inconsistent:phase-vocabulary` | **ambiguous — needs a human** | high | `core/schemas.ts:13-20` pins `implementation`; `feature-ui.ts:211` and `README.md:31,111` say `build`; `CONTEXT.md` #7 and `SPEC.md:36` say `Implementation`; `docs/agents/domain.md:41-45` forbids exactly this. Root must rule once for the repo. **Recommendation: record `build` as the UI label in CONTEXT.md's vocabulary, don't revert it.** | 1 |
| **H14** | `abandoned:corrections-ledger` | violation | high | `docs/research/CORRECTIONS.md` holds 3 M1-era entries; ~35 later contract changes unrecorded. Its trigger (`CLAUDE.md:12-13`, research-note-vs-spec *format* conflicts) structurally cannot catch redesigns. Process finding: root should decide whether ADRs subsume it (ADR-0002 shows they work) or widen the trigger. | 1 |
| **H15** | `latentbug:env-empty-string` | violation | high | `core/config-load.ts:49-51` guards `!== undefined`, so an empty `RUNCASTLE_BURN_CONFLICT_ATTEMPTS` silently disables the burn conflict resolver. Only this key is affected; a declarative env table fixes the class. | 1 |

**Confirmed non-findings** (so siblings and root do not re-litigate): core is
genuinely IO-free, deterministic, and free of weak-typing escapes; the barrel's
browser-safe invariant holds and `package.json:6-10` backs it; zod↔drizzle
timestamp/boolean/JSON/nullability mirroring is correct wherever both sides have the
field; path ownership is clean apart from the two sites in C2; gate ids, skill MCP
tool names, ports, data dir and all 10 ADRs are accurate.

---

## J. Corrections made during consolidation

**J.1 — `contracts-docs.md` D11 overstated the smoke script's survivability.** The leaf
reported that `scripts/smoke.ts:197-201` passes `size: 'collapsed'` and that
"non-strict zod silently drops it, so the smoke passes while testing something other
than what it says." Re-checked against source: the script cannot reach that line. It
calls `trpc.project.init` at `:191`, and `project.init` does not exist on
`routers/project.ts:13-113`; and the `feature.create` call additionally omits the
**required** `projectId` (`routers/feature.ts:22-28`), so zod would reject it rather
than silently widen. Recorded as B4/H9 — dead tooling plus a verification-gate hole —
which is a stronger and more actionable finding than a silently-passing test.

**J.2 — dead-code claims re-verified per the briefing.** `loopBackPhase`/`rethinkPhase`
(B3) re-checked with a repo-wide `grep -w`: callers exist only in
`packages/core/test/pipeline.test.ts`. `NotImplementedError` (B1) re-checked:
`new NotImplementedError` = 0 occurrences. `session.worktree_pending` (B2) re-checked:
one emitter inside a provably unreachable branch, zero consumers. The core leaf's
self-correction on `previousPhase` (live at `services/gates.ts:224`) is accepted and
that symbol is **not** reported as dead.

**J.3 — event set-difference reconciled.** The orchestrator observed the web consuming
`burn.started` and `feature.shipped`; both are emitted (`services/features.ts`,
`mcp/server.ts` + `routers/feature.ts`). This agrees with the wire leaf's
"0 consumed-but-never-emitted" — no disagreement.

**J.4 — `phaseGlyph` framing sharpened.** An earlier orchestrator draft described web
switches as "lacking default branches". Corrected: the switch is exhaustiveness-checked
by tsc and is correct TypeScript, so per the briefing it is not a finding on its own.
The reportable claim is the *chain* (D1) — that tsc's proof rests on an unvalidated
cast four hops upstream.
