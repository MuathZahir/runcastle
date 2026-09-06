## Why this feature exists

Part of the 2026-08-28 decision to redesign the runcastle web app **one flow at a time** on top of `web-ui-foundation-tailwind-tokens-primitives-and-carving-feature-ui`. This is flow 6 of 7: from a feature card existing to the human clicking Burn. **Order:** land after the project-shell flow (shared `Workspace.tsx`/next-step bar) and before build→review→ship.

## The flow, as it exists

- `apps/web/src/components/Workspace.tsx` — header, clickable `PipelineStepper`, `NextStepBar` (one solid action + secondaries), `LapBannerRow`, read-only banner when an earlier phase is pinned, `PhaseBody` dispatch. (The foundation carves this; this flow owns its ideation/spec/tickets behaviour.)
- `components/bodies/GrillBody.tsx` — ideation/spec: `MapRail` (waypoint status groups, map-doc sections behind a disclosure, collapse toggle) + live inline PTY terminal (`SessionPanel.tsx`, `TerminalView.tsx`, `EndSessionButton.tsx`); spec doc card in `spec`; converge-resume recovery.
- `components/bodies/TicketsBody.tsx` — session panel + ticket ledger (seq, sandbox/model chips; rows expand to goal/context/acceptance/seams/commits/digest/error; pending/failed rows editable in place).
- Gate cards + "Override with reason…" in the Inspector's Details tab; G1 (decisions captured), G2 (spec), G3 (tickets, lap-scoped).
- Derivations in `lib/feature-ui.ts` (next-step per phase, gate checks, waypoint groups, map sections) — after the foundation, in their carved modules.

## Known issues going in

- Human's screenshot: the gate card carries a standing explainer ("Gates are the human approval points — runcastle stops at one and waits for you") on every view.
- Prior audit (`docs/features/identify-random-issues-throughout-the-system/findings.md`): F4 lap-blind next-step, F9 two competing resume CTAs in spec, F24 gate override silently advances with no undo, F17.6 override has no consequence copy, F10.6 "Resume session" inside read-only retrospective views, F10.7 empty map doc renders bare heading stubs, F16 jargon ("grill", "G1", "converge"). Check which its tickets closed.
- `improve-map-workflow-ui-ux-make-markdown-render-correctly` and `next-step-bar-affordance-audit` already reshaped the map rail and the bar — read their decisions; the human may still find them confusing, but start from what was decided.
- The human's process wish: the ideation agent should be able to show the *whole* flow; the map/waypoint UI is where that is hardest to follow today.

## How the ideation session must work (human's instruction, applies to every flow feature)

1. Walk the whole flow with agent-browser: small feature (plain grill → converge → spec → tickets) AND a mapped one (waypoints); session start/resume/end; gate pass and override; ticket edit; the read-only retrospective views of these phases on a shipped feature. Every branch, button, dead end.
2. Present the complete flow map to the human and get it confirmed before designing.
3. Redesign on the foundation's tokens and primitives; the terminal must stay first-class and reachable without scrolling past everything else.
4. Code quality is in scope for this flow's files.
5. Migration rule: move this surface's rules out of `styles.css` into Tailwind and delete the old rules.

## What it must NOT swallow

- The burn, run view, review, test drive, merge — flow 7.
- The shell (rails, palette, stepper *chrome*) — flow 2; this flow owns what the stepper and bar *offer* in these three phases.
- Gate/phase semantics (charter decisions 7, 8; ADR-0001 mapped ideation; ADR-0010 laps) — reflect them, don't change them. The skills that drive the sessions are out of scope.
