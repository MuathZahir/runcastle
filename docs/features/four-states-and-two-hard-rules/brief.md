# Brief

## Why this feature exists

The 2026-09-14 post-mortem of a real runcastle feature on another project (the "Decision Workspace Audit") showed the human getting stuck in states the pipeline created and could not exit. The sharpest case: after a Rethink click the feature sat at ideation on lap 4 with no road back to Review or Merge, because `rethink` only accepts the review phase (`packages/server/src/services/features.ts:821`) and `advance` refuses G3 (`features.ts:621`). The human typed "just create a random ticket so I can merge". The same lap crossed ideation, spec and tickets in 15 s, 10 s and 23 s, because G1 and G2 are file-existence stamps the same agent satisfies (`packages/server/src/services/gates.ts:29,53,198`). Three "phase complete" events seconds apart is decoration, not a pipeline.

The project session grilled the operator on 2026-09-15 and these are settled. They are the input to this feature's ideation, not open questions.

## Settled in the project session

1. **Exactly two hard refusals survive.** (a) Git safety: no merge while a test drive is active or the main checkout is dirty or the base branch is gone (`packages/server/src/services/git.ts:2832-2848`), and no second checkout of a branch. (b) One burn at a time on a feature branch. Every other refusal becomes a warning with the action still enabled: the review-ticket rule in G3 (`gates.ts:77-84`), the un-dispositioned-earlier-lap-defects rule (`gates.ts:91-94`, decision 4 of `docs/features/open-findings-survive-laps-carry-link-or-close/decisions.md`, consciously overturned), Rethink refused while a run or drive is live (`features.ts:807`), and the G1/G2 doc-writing-session rule (`gates.ts:176-208`). The charter's own principle, "gates guide, they never imprison", is the reason.

2. **Four states.** Planning (ideation + spec + tickets as one state, driven by one session; the map of ADR-0001 stays available as a mode inside it), Building (a burn is running), Review, Shipped. Nothing moves a feature backwards. The Rethink transition (`RETHINK_LOOP_BACK`, `packages/core/src/pipeline.ts:147`) goes away; "keep planning" from Review is just talking to the feature chat (a later feature) and then clicking Burn. `REVIEW_LOOP_BACK` is subsumed by "Burn from Review".

3. **Two human clicks remain: Burn and Merge.** Burn crosses Planning → Building. Merge crosses to Shipped and is reachable from every state after creation, subject only to the git refusals above.

4. **A lap is one burn run plus the review that follows it.** It starts automatically when Burn is clicked, so the counter is derived from runs and nobody manages it. Fix never bumped it and Rethink was the only incrementer (`features.ts:837`); both go. Everything that reads the `lap` column (tickets, sessions, events, findings, `review-findings.ts:260-330`) keeps working because Burn stamps it.

5. **Auto-advance Building → Review stays** (`packages/server/src/workflows/runner.ts:272-284`). A review that verified nothing must not block it; making that loud is the review-trail feature's job, not this one's.

## What this feature must decide in its own session

- Whether the three planning sub-steps survive internally as data (a `step` inside Planning the session reports through `complete_phase`) or vanish entirely. The UI shows one state either way. Existing MCP tools (`complete_phase`, `emit_tickets`) and skills (`/runcastle:ideate`, `spec`, `tickets`, `converge`) call phases by name; decide the compatibility story.
- The `advance`, `burn`, `rethink`, `merge` mutations and the next-step resolvers under `apps/web/src/lib/feature-ui/next-step/` after the transitions change. `rethinkAndLaunch` and `lap.aborted` (`features.ts:857-877`, `LapAbortAlert.tsx`) lose their reason to exist.
- Migration of existing rows: every feature in every registered project has a phase in the old enum.
- What "warn instead of refuse" looks like at the Burn click (the warnings box pattern from flow-redesign decisions 29/31 is the precedent).
- Override machinery (`gates.ts:220-310`, `gate_overrides` table): with two hard rules that are physics, overrides have nothing left to override. Decide whether it dies.

## What this feature must NOT swallow

- **Session lifecycle.** Which session kinds exist, where the chat lives, what it may write during a burn. That is the parked feature "One chat per feature". This feature may rename nothing in `SessionKind` (`packages/core/src/schemas.ts:63`).
- **The review page layout, the lap trail, the unverified review outcome, the agentic-review button.** Parked feature "Review as a lap trail". This feature changes only what the state change forces on that page (removing Rethink, Merge availability).
- **Finding kinds.** Defect and observation stay as decided in `review-arrival-is-legible` decisions 1 and 2.
- **Kickoff delivery and the Codex adapter.** In flight elsewhere.

## Consequences the project session owns

Decision 2 overturns charter decision 7 (six phases), amends decision 15 (laps) and supersedes ADR-0010 sections 1, 3, 5 and 8 in part. Once this feature's `decisions.md` is written, the project session writes the ADR and amends `CONTEXT.md`; feature sessions cannot. The draft feature `backing-out-of-a-lap` is deleted by the human: this feature makes the state it would have backed out of unreachable.

## Already settled elsewhere, still binding

- ADR-0002 (serialized landings) and ADR-0007 (in-loop conflict resolution) define the one-burn-at-a-time physics. Do not weaken them.
- `flow-redesign-build-review-and-ship` decision 19: never lap-filter the review evidence into a blank stage.
- `review-arrival-is-legible` decision 3: Merge is not always primary; enabled is not the same as recommended.
- `test-drive-improvements` decision 7 and flow decisions 29/31: open notes, open defects and stale evidence inform, never block, Merge. This feature extends that rule to Burn.
