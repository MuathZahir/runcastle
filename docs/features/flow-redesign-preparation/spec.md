# Flow redesign: preparation

## Problem

Preparation is the flow that makes a repo drivable and burnable, and it has been reworked twice with the human still unhappy with it. The ideation walk (live app, all reachable states) found why:

- The **prepared** state — the one that exists to make re-prepare discoverable — buries its own actions. The Established evidence frame renders above Resume / Start fresh, and evidence blobs are unbounded agent-written essays; on a real project the frame measured ~6,350px, putting the two buttons ten screens below the fold.
- The **staleness machinery is dead code** for every finding that can exist today. Staleness is commit-distance (100+ main-branch commits since a finding's `establishedSha`), but the only live write path — the `record_finding` MCP tool — never stamps `establishedSha`; only the retired headless run did. So session findings never age, and the "N stale" rail badge, the stale warning, and the drift-based reason to re-prepare can never fire.
- The copy never says what "Start preparation" does (audit F17.1): nothing names the terminal session, the agent, or that it opens right there in the pane — while the page compensates with volume everywhere else.
- The surface still rides legacy `styles.css` rules rather than the foundation's tokens and primitives.

## Approach

From the user's perspective: the preparation workspace keeps its exact flow topology — auto-land for a featureless unprepared project, the permanent rail-foot row, the ⌘K row, the same three body states (call-to-action, live terminal session, dry-run row pinned above all) — but the prepared state now leads with why to act and what to press, the evidence is reference material one click away instead of the page itself, every launch affordance says in one sentence that it opens a terminal session with an agent in your own checkout, and the "N stale" nudge actually fires when the repo drifts.

The shape:

**Server — staleness stamping (decision 2).** The `record_finding` tool handler resolves the project's current main-branch HEAD sha server-side and passes it through to the finding write, exactly as the retired headless run used to. No MCP schema change; the agent never supplies a sha. Everything downstream — `staleCommits` computation, `isStale`, the rail badge, the stale warning, the prepare brief's "N commits behind" clause — already exists and starts working the moment its input returns. Human-sourced findings remain never-stale.

**Prepared call-to-action reorder (decision 3).** The prepared branch renders: title → prepared-when line + stale warning (the reason to act) → Resume / Start fresh → the Established frame last. The unprepared branch and the live-session layout keep their current order.

**Evidence collapsed by default (decision 3).** In the Established frame — in every state that shows it — each finding always shows its key, source badge, verification badge, and provenance line; the evidence blob is clamped to a few lines with a per-finding expand. The full text stays stored and rendered on demand; the source/verification badge semantics (yours / verified / proposed / measured; dry-run stamps on the three provable drive-loop keys only) are unchanged.

**Copy names the mechanism, once (decision 4).** The unprepared CTA's sub-copy collapses to one sentence that says a terminal session with an agent opens here, in your own checkout, running this repo's commands and asking you the rest. The prepared explainer collapses to one sentence: Resume continues the last conversation, Start fresh opens a new one, hand-typed values are never overwritten. The ⌘K row is untouched — it navigates, and the page it lands on now explains launching.

**Foundation migration + code quality (brief mandates).** The preparation surface's rules move out of `styles.css` (the `pw-`/`prep-` blocks) onto the foundation's Tailwind tokens and primitives, and the old rules are deleted. Code quality in this flow's files is in scope while touching them.

## Seams

- **`project.prep` tRPC query (existing).** The `PrepView` contract — `prepared`, `preparedAt`, `pendingKeys`, `findings` (now carrying `establishedSha`/`staleCommits` for session findings), `dryRun`. Observes the staleness fix end-to-end: record a finding, land commits, watch `staleCommits` climb.
- **`record_finding` MCP tool (existing).** Same input schema as today; observe via the stored finding that a main-branch sha was stamped and that a human-sourced write behaves as before.
- **`prepRailRow` and `workspaceView` pure functions (existing).** The rail row variants/badges and the body-state selection (auto-land included) are already unit-testable here and must not regress.
- **PreparationWorkspace component render (existing tier).** Per the web app's two component-test tiers: prepared-state ordering (actions before Established frame), evidence clamped with expand toggle, the one-sentence copy, stale warning presence when findings are stale.

No new seams.

## Out of scope

- The Settings overlay, entirely (decision 1) — including its "overridden" badge on prep-established fields, which is handed to the settings flow as: *relabel prep-established provenance; the generic override badge misreads as a human override.*
- The test-drive experience (build→review→ship) — preparation feeds it, never renders it.
- The preparation agent's briefing content beyond the staleness data it already receives.
- The stale threshold's value (stays 100 commits) and the staleness model itself — only the missing stamp changes.

## Open questions

None — all decisions locked in ideation; the flow map was walked and confirmed against the live app.
