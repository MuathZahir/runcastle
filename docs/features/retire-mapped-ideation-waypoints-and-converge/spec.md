# Retire mapped ideation (waypoints and converge)

## Problem

runcastle carries a whole second ideation mode that the operator no longer uses. Mapped ideation escalates a big feature into a map of typed waypoints (grilling, research, prototype, task), each worked in its own `waypoint` session, then closed out by a `converge` session into one spec and one branch. Only 5 of 153 features were ever mapped, and none since 2026-08-28. The two real ones both shipped as single features, and the other three sit in the demo project with every waypoint resolved or dropped.

Meanwhile the project session already does the job maps were for, in a better shape: it takes a lump of intent and cuts it into several features, each with its own brief, laps and merge. The map machinery costs roughly 5,400 lines across core, server, skills, web, docs and tests. That includes two of the feature session kinds, three MCP tools, an AFK research workflow, per-kind tool filtering, the map rail, and a mapped branch through the next-step bar. Every session prompt, skill and UI surface has to keep accounting for a mode nobody enters.

One gap is real. The project session currently cuts big intent with **no grilling at all**, since its skill forbids it, so it misjudges size. That is the size check maps were a clumsy substitute for.

## Approach

**For the user:** there is one ideation mode. A lump of intent goes to the project session, which runs a short shape grill across the main ideas, cuts the intent into features sized for one ideation window, and writes what it learned into each brief. Each feature is then grilled, specced, ticketed, burned and merged on its own. No map, waypoint, converge button, map rail or research run exists anywhere. The former mapped features appear as ordinary features, and their old `map.md`, `research/` and `prototypes/` remain readable as plain docs.

**Shape of the change.** This is a deletion with three pieces of new or rewritten behaviour: the migration, the project session's shape grill, and the ADR/doc record. It removes, layer by layer:

- **Core contracts.** The `SessionKind` enum loses `waypoint` and `converge`. The waypoint schemas (`WaypointType`, `WaypointStatus`, `WaypointDisposition`, `WaypointInput`, `Waypoint`) are deleted. `Feature.mapped` is removed. `ModelStep` loses `waypoint`, `converge` and `research`, and loading a config whose `stepModels` still names one of those three keys **ignores the key rather than failing** (decision 9). The run-context `resolveWaypoint` hook goes. `map.md` leaves the canonical agent-digest doc lists, so an old feature's `map.md` shows up under `moreDocs` like any other doc (decision 2).
- **Database.** One new drizzle migration:
  - drops the `waypoints` table and its rows;
  - drops `features.mapped`;
  - rewrites `sessions.kind` from `waypoint`/`converge` to `chat`.

  `events` rows are untouched: past `waypoint.*`, `research.*` and `feature.escalated` events stay as timeline history. After the migration, every existing row still parses under the shrunk schemas. This is the contract `row-contracts` pins.
- **Server.** Deleted:
  - the waypoints service;
  - the research workflow and its registry entry;
  - the three MCP tools (`escalate_to_map`, `emit_waypoints`, `resolve_waypoint`);
  - the mapped fields of `get_feature_context` (`frontierIds`, `assignedWaypointId`, `waypoints`) and the "mapped" tag on feature-index lines;
  - `escalateToMap` and `scaffoldMapDoc`;
  - the launcher's `workWaypoint`/`converge` entry points and the waypoint claim, promote and release threading through launch, session end, hooks and run reconciliation;
  - the waypoint and converge system prompts, entry skills and kickoff lines;
  - the prototype-waypoint edit-guard exemption;
  - the research branch prefix in git's branch sweeps;
  - the burner's map-doc trimming;
  - the `workWaypoint`/`converge` tRPC procedures;
  - the mapped step of the smoke script.

  The tool-audience tables lose the two kinds, and `create_feature`'s audience is otherwise unchanged. Code shared with tickets stays exactly as it behaves today: batch blocking resolution, the runner, run reconciliation and the temp-branch sweep. Only the map-specific branches come out of it.
- **Skills.**
  - Deleted: the `waypoint` and `converge` skills and the research-waypoint burner prompt.
  - **Ideate** loses §3 (escalation) and the map-oriented "probe the size early" instruction. Its "Size and certainty are orthogonal" bullet is rewritten without mapping: an oversized feature gets a thin lap 1, with the rest under `## Later laps` (decision 5). Its closing §4 is renamed so it no longer says "converge". `create_feature(draft)` stays for scope creep only.
  - **Spec** and **tickets** lose "`/runcastle:converge` for a mapped one".
  - **Revisit** loses its map lines, and an oversized lap defers into later laps.
  - **QA** loses "Branching the map".
  - The pack README, NOTICE and plugin metadata stop listing the two skills.
  - **Project skill rewrite (decision 3):** "advisor, not a griller" becomes **shape griller, not design griller**. Before proposing a cut, it grills one question at a time, each with a recommendation, breadth-first across the main ideas. It asks only what could change the cut: the pieces, which is the core, where the human is unsure and what they would test-drive first, and roughly how wide each piece is, including any research or prototype needed. It stops at the cut, locks no decisions and writes no feature docs. It writes what it learned into each brief: purpose, must-not-swallow, understood, open, and ordering relative to sibling features. It keeps cutting until every feature can be thought through in one ideation window, parking later pieces as drafts. Design questions still go to the feature's own session. The "Never run an ideation grilling" rule is reworded to match.
- **Web.** Deleted:
  - MapRail, WaypointCard and the map feature-ui module;
  - the mapped branch of the planning next-step, with its converge/work-next/resume-converge actions;
  - the done states that only exist for maps (`workNext`, `awaitingResearch`, `mapComplete`);
  - the Waypoint/Converge strip labels and context lines;
  - the Workspace's converge/workWaypoint mutations and its map fog warning;
  - the pinned view's map rail;
  - the map-rail width and collapse state;
  - the "N waypoints" phase-summary fact;
  - the waypoint explainer;
  - the Waypoint/Converge/Research model rows in settings.

  A planning feature always gets the linear next-step.
- **Record (decision 8).**
  - A new ADR-0012 "Retire mapped ideation" states decisions 1, 3, 5 and 7 in short form.
  - ADR-0001's status line is stamped superseded by ADR-0012 in place.
  - SPEC §13 is deleted.
  - ADR-0009 and ADR-0010 lose their map and converge mentions; ADR-0010's "escalate via ideate §3" becomes "defer into later laps".
  - CONTEXT.md principle 7's mapped-ideation sentence becomes: big intent is cut into several features by the project session after a shape grill (ADR-0012).
  - CLAUDE.md's MCP tool-count note is corrected if it changes.

**What does not change:** laps, revisit, forks, drafts, the ticket pipeline, and the feature docs of the formerly mapped features on disk.

## Seams

All are existing seams. The feature adds none.

- **Migration + row contracts** (server tests over a migrated DB): a DB seeded with a mapped feature, waypoints, and `waypoint`/`converge` sessions migrates cleanly. The table and column are gone, those sessions read back as `chat`, events are unchanged, and every row parses under core's schemas.
- **Core schema/config parse** (core tests): `SessionKind` and `ModelStep` no longer accept the retired values. A config with `stepModels.waypoint`/`converge`/`research` loads without error, and those keys are absent from the result. `map.md` is not a canonical digest doc.
- **MCP tool registry per session kind** (`mcp-tools` / `project-mcp-tools` tests): no session kind is offered `escalate_to_map`, `emit_waypoints` or `resolve_waypoint`. `get_feature_context` carries no mapped fields. Every remaining kind's tool list is otherwise unchanged.
- **Launch artifacts** (`launch-artifacts` tests): the system prompt, entry skill and MCP allow rules render for every remaining kind, and no rendered prompt or allow list mentions waypoints, converge or `map.md`.
- **Session lifecycle** (`session-lifecycle` / `hooks-route` / `reconcile-runs` tests): launching, ending and reconciling sessions and runs behave as before for the remaining kinds, with no claim/release path.
- **Skill pack content** (skill-content tests plus a repo grep): the waypoint and converge skills are gone. No remaining skill or pack metadata mentions `escalate_to_map`, `emit_waypoints`, `resolve_waypoint`, `/runcastle:converge`, waypoints or maps as a live mechanism. The project skill carries the shape grill.
- **Web next-step and feature-ui** (`feature-ui` / `chat-view` / `settings-models` tests): a planning feature always yields the linear next-step, no strip label or done state names a waypoint or converge, and settings lists no Waypoint/Converge/Research model rows.
- **Repo-wide grep gate:** after the last ticket, a grep over `packages/` and `apps/` finds no live reference to waypoints, converge sessions, `mapped`, `escalate_to_map` or the research workflow. Historical feature docs and superseded ADR-0001 are excluded.

## Out of scope

- **Feature dependencies (merge-order gates):** parked as its own draft feature, `feature-dependencies-merge-order-gates` (decision 4). Until it ships, the project session states ordering in briefs.
- Any new standalone research trigger (decision 6).
- A cross-feature or converged spec of any kind (decision 7).
- Deleting or rewriting the formerly mapped features, or their `map.md`/`research/`/`prototypes/` docs (decision 2).
- Rewriting past events or other features' `decisions.md`, including grouping-feature decision 24; the dependencies feature amends that one.
- The chat layout work of `one-chat-layout-everywhere`, which has already merged.

## Open questions

None. All ten decisions are locked.
