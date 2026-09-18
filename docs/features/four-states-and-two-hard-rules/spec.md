# Four states and two hard rules

## Problem

The six-phase pipeline manufactures states the operator can get stuck in. The 2026-09-14 post-mortem showed a feature wedged at ideation on lap 4 with no road to Review or Merge — the operator typed "just create a random ticket so I can merge". Meanwhile the same lap crossed ideation, spec and tickets in under a minute because G1/G2 are file-existence stamps the same agent satisfies: three "phase complete" events seconds apart is decoration, not a pipeline. Gates that were meant to guide instead imprison, and the lap counter has to be hand-managed by transitions (Rethink) that exist only to manage it.

## Approach

From the operator's perspective: a feature is in one of four states — **Planning**, **Building**, **Review**, **Shipped** — and there are exactly two clicks, **Burn** (Planning → Building, also reachable from Review) and **Merge** (→ Shipped, reachable from every state after creation). Nothing ever refuses except two hard rules that are physics: git safety (no merge while a test drive is active, the main checkout is dirty, or the base branch is gone; no second checkout of a branch) and one burn at a time per feature. Everything the old gates refused becomes a warning the operator reads and clicks through. Nothing moves a feature backwards. A lap is one burn plus the review that follows; Burn stamps it, nobody manages it.

The shape:

- **Core pipeline model** collapses to the four-value `Phase` enum (`planning | building | review | shipped`) and the transitions above. `REVIEW_LOOP_BACK`, `RETHINK_LOOP_BACK`, `previousPhase`, and the gate table go; what remains of the pipeline module is the state order, the two click-transitions, and the derived planning-progress model. (Decisions 2, 3, 6.)
- **Planning sub-steps are derived, never stored** (decision 2). No `step` column: decisions doc exists → ideation done; spec doc exists → spec done; tickets in the store → tickets emitted. The `complete_phase` MCP tool keeps its name and its `phase: "ideation" | "spec" | "tickets"` argument for wire compatibility with the skills, but inside Planning it transitions nothing — it records a timeline progress event and answers with what's next. `complete_phase("tickets")` returns `ok: true` with a `warnings` field (decision 5) instead of refusing on the review-ticket precondition.
- **Mutation surface** (decision 3): `rethink` (with `rethinkAndLaunch`, the `lap.aborted` event and its alert UI) and `advance` are deleted, no stubs. `burn` and `merge` are the only state-moving mutations. Burn stamps the lap (derived from runs — decision 4 of the project session), launches the run, and crosses to Building; the runner's auto-advance Building → Review stays, and becomes a no-op on a feature already Shipped (decision 7). Merge drops its phase precondition entirely.
- **Warnings** (decision 5): a server-computed burn-warnings list, exposed as a tRPC query in the same pattern as the merge delta, feeds a Burn confirm dialog shaped like the existing Merge dialog — summary of what will burn, warn-styled box, enabled primary button; friction is reading. The warning set: no review-kind ticket in the pending batch, earlier-lap open defects not linked/carried/closed, no spec doc on disk. Burn with zero pending tickets is simply not offered (a no-op, not a gate); the next-step bar hints "emit tickets". Merge during a live burn warns that later-landing work stays unshipped (decision 7).
- **Override machinery dies whole** (decision 6): the override/undo service code, mutations, and the `gate_overrides` table — dropped in the same migration, historical rows included. With two unoverridable hard rules and everything else warning, there is nothing left to override.
- **Migration** (decision 4): one irreversible value-mapping — `ideation`/`spec`/`tickets` → `planning`, `implementation` → `building`, `review`/`shipped` unchanged. No dual-enum period, no down-migration. Historical timeline events are left exactly as written. The migration itself un-wedges any feature stuck by Rethink.
- **Web next-step resolvers** collapse six per-phase files to four per-state ones; the Planning resolver derives its hints from the artifact facts. The draft resolver stays (draft is a status, not a phase). The review page changes only what the state change forces: Rethink removed, Merge availability per the new rules. Lap 2 (decision 8): the deletion extends to the web's inert gate vocabulary — `GateCard.tsx`, the `GateState` type in `lib/api.ts`, `GATE_EXPLAINER` in `lib/vocabulary.ts`, and the story/tests that exist only to exercise them.
- **Mapped ideation survives as a mode inside Planning** (settled in the project session): the map/waypoint machinery is untouched except that convergence lands the feature in the same Planning state instead of a distinct phase.

## Seams

The fewest seams that observe every decision, all but one existing:

1. **The tRPC feature router** (existing, highest seam): `burn` and `merge` as the only state movers; `advance`/`rethink`/override mutations gone; `merge` callable from every state with only the two hard-rule refusals; the burn-warnings query returning the computed list. Most behavior asserts here.
2. **The MCP `complete_phase` tool** (existing): wire-compatible phase-name arguments; inside Planning returns `ok` + progress event + next hint without transitioning; `"tickets"` returns warnings instead of refusing.
3. **The core pipeline module** (existing, pure): the four-value enum, forward-only transitions, derived planning progress from artifact facts — property-style tests need no IO.
4. **The workflow runner's phase writes** (existing): Burn stamps the lap from the run; auto-advance Building → Review; no-op on Shipped.
5. **The migration** (new, one-shot): old-enum rows map to the new enum and `gate_overrides` is dropped; assert by opening a copy of a pre-migration database and reading features back through the ordinary services.

## Out of scope

- Session lifecycle: session kinds, where chat lives, what a burn may write — parked feature "One chat per feature". `SessionKind` is not renamed.
- Review page layout, lap trail, unverified-review outcome, agentic-review button — parked feature "Review as a lap trail"; only the removals the state change forces happen here.
- Finding kinds (defect/observation stay as settled in `review-arrival-is-legible`).
- Kickoff delivery and the Codex adapter (in flight elsewhere).
- Making an unverified review loud (the review-trail feature's job; auto-advance stays unconditional here).
- The ADR and `CONTEXT.md` amendments — the project session writes those once this feature's decisions are in.

## Open questions

None unresolved. The one judgment call flagged during grilling — zero-pending-tickets hides Burn rather than warning — was confirmed (decision 5).

## Later laps

None. Decision 1: the whole collapse ships as one lap; a half-collapsed enum is worse than either endpoint. Lap 2 is a closing lap (decision 8) — the web gate-vocabulary deletion — and nothing is parked beyond it.
