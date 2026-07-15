# ADR-0001: Mapped ideation (wayfinder as an ideation mode)

- **Status:** accepted (2026-07-15)
- **Deciders:** Muath + grilling session
- **Spec delta:** `docs/SPEC.md` §13

## Context

The pipeline's ideation phase assumes decision 9's "one unbroken context
window": grill → spec → tickets in a single session. Big features break that
assumption — one session can't hold their ideation, and nothing coordinates
multiple sessions exploring the same feature. The wayfinder skill (Matt Pocock
methodology, already in our lineage) solves exactly this with a shared map of
decision tickets worked one session at a time.

Three locked decisions anticipated the shape: decision 6 built docs-only
worktrees "enabling parallel grilling", decision 7 made Research/Prototype
detour activities and phases data, decision 10 planned a `research-sweep`
workflow. The dogfooded workflow runner is already generic over `WorkflowDef`.

## Decision

Integrate wayfinder as **a state of the ideation phase** — not a new phase, not
a new feature size, not a planning object above features.

1. **Entry, two doors, one mechanism.** `mapped` is an ideation-phase state.
   A creation-time toggle enters it at t=0; the `escalate_to_map` MCP tool
   enters it mid-grill, seeding the map from the `decisions.md` written so far.
   `size` (`full|collapsed`) is untouched and stays orthogonal; `nextPhase()`
   does not change.

2. **Storage splits along the decision-5 seam.** `map.md` in
   `docs/features/<slug>/` holds the prose only humans and sessions edit
   (Destination, Notes, Not yet specified, Out of scope). Waypoint machinery
   rows live in app SQLite. Resolutions append to the existing `decisions.md`
   — wayfinder's "Decisions so far" index is that file, not a new artifact.

3. **Waypoints, never "tickets".** A separate `waypoints` table
   (`featureId, title, type, question, status, claimedBy, lastSessionId,
   blockedBy, originWaypointId, summary`). Tickets remain implementation
   slices for the burner; the burner must never be able to see a waypoint.
   Types: `grilling | research | prototype | task` — all four from day one.

4. **Execution: HITL spawns terminals, research runs AFK.** Grilling,
   prototype, and task waypoints spawn injected terminals via the existing
   launcher. Research waypoints run AFK through the existing runner as a
   `research` WorkflowDef on sandcastle (one substrate for all AFK work;
   headless-in-worktree is a later optimization behind the same WorkflowDef).
   `WorkflowCtx` gains a per-run `input` and a `resolveWaypoint` callback.

5. **Claiming is a server-side spawn effect.** The launcher/runner claims a
   waypoint transactionally before work starts (`claimedBy` = session or run
   id). Session end or run failure without resolution auto-releases back to
   `open`, keeping `lastSessionId` so the UI can offer resume. Agents never
   self-claim.

6. **Flat map, recursive creation.** Every session on a mapped feature can
   `emit_waypoints`; branching-out is one shared frontier growing and
   shrinking, with lineage recorded (`originWaypointId`) for display. No
   nested maps. Frontier = open ∧ unclaimed ∧ all blockers terminal —
   **derived at query time, never stored**. `blockedBy` reuses the tickets
   seq-resolution and cycle-rejection; a dropped blocker counts as terminal.

7. **Serial HITL per feature, parallel AFK.** One live terminal per feature
   at a time (one talk worktree per feature; git forbids two worktrees on one
   branch). Research runs in parallel via sandbox clone + merge-back. The
   frontier is a menu, not simultaneity. Per-session docs branches are the
   upgrade path if dogfooding demands two terminals per feature.

8. **MCP surface: three tools, nothing more.** `escalate_to_map`,
   `emit_waypoints`, `resolve_waypoint({id, disposition: resolved|dropped,
   summary})`. No claim tool, no map-prose tool (files), no list tool (map
   state folds into `get_feature_context`).

9. **Convergence.** G1 for mapped features checks `all-waypoints-terminal`
   (machine-checkable, same shape as G4). Fog remaining in `map.md` is shown
   at the gate, not enforced — seatbelt, not cage. A human-triggered
   **converge** session then runs spec → tickets in one unbroken window,
   reading only the compressed knowledge (`map.md` + `decisions.md`). The map
   does not subsume the spec; it retires with ideation.

10. **UI: one component variant, one form toggle.** `GrillBody` grows a
    mapped variant (frontier/blocked/claimed/resolved groups, fog, Converge
    button); `NewFeatureForm` gets the start-mapped toggle. No new routes,
    polling, or panels.

11. **Skills: distribute wayfinder, don't vendor it wholesale.** `ideate`
    learns to escalate and end the session; new `waypoint` and `converge`
    entry skills; a research prompt template joins the burner templates.
    (Decision 11's adapted-forks pattern.)

## Sequencing

Locked now; built after (a) the three ship-path bugs from the 2026-07 dogfood
are fixed and (b) the workspace redesign lands. Then built as the next major
feature through the normal pipeline.

## Consequences

- Decision 9's unbroken-window rule survives by relocating to the converge
  session; ideation is the part allowed to span sessions.
- "Ticket" keeps exactly one meaning in runcastle forever.
- Research waypoints silently upgrade from sandcastle to any cheaper substrate
  later with zero schema change (execution is bound behind `WorkflowDef`).
- The map can keep growing while "nearly done" — that is the fog clearing,
  made visible by the frontier view, not a bug.
