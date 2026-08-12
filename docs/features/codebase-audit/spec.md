# Codebase Audit

## Problem

Runcastle has accumulated a class of defects its own gates cannot see: SSE streams silently die every ~13 seconds, the local server is reachable from the LAN with no auth, failed burns render as green, a shipped migration corrupted event rows for deleted features, and the burn/merge UI can hide its primary action — while nothing typechecks the 15.6k-line web app and no CI runs on push. A recursive audit (5 orchestrators, ~19 leaf agents, findings consolidated and root-verified in `docs/features/codebase-audit/audit/REPORT.md`) found the common cause: the repo trusts what it never re-checks — types without runtime validation, docs without derivation, prompts without cross-checks, child processes without a kill/env policy, and a verification gate covering half the workspaces. The user needs the bleeding stopped now, and the structural work parked where it can be scheduled deliberately.

## Approach

Lap 1 lands the audit's small, high-confidence, test-drivable fixes as seven vertical slices; everything larger is filed as GitHub issues carrying the report's `file:line` evidence. Every fix takes the smallest form that kills its finding's class (decision #11 — no new machinery, no frameworks).

1. **Server hardening** — the one-line-each server fixes: WebSocket/SSE idle timeout raised above the heartbeat interval; the server binds localhost only (decision #7); indexes on the polled events table; empty burn-conflict env var no longer silently disables conflict resolution; podman-unavailable becomes a loud error instead of a silent no-sandbox downgrade; gate override validates the gate it was asked to override; cancelling an unknown run fails instead of reporting success; resolving a waypoint checks its state.

2. **Contract spine** — every row-to-wire adapter (8 exist) runs its rows through the corresponding core zod schema's `.parse()` before the value crosses the wire. This resurrects the ~20 never-executed core schemas as live validators and turns the enum-column/zod drift class (the F19 blank-screen class) into a loud server-side error.

3. **Process lifecycle: verify and fix** — the merged `killTree()` work is verified on a real Windows drive-stop, then adopted at the remaining kill sites (session-end/shutdown registry, drive hooks, the dev launcher script, the PTY host), and shutdown is restructured to await teardown instead of exiting synchronously.

4. **Child-env policy** — spawned burn/research agents inherit a merged `process.env` (plus overrides) instead of a replacement env; the stray committed Claude Code transcript is deleted and its path class gitignored.

5. **Web bug cluster** — run status derives from run state, not message regex; the shipped hero finds the shipped event correctly; a merge conflict no longer hides the Burn action (and the edit guard admits the conflict-resolution session ADR-0007 designs); dialogs dismiss on backdrop click, not drag; the undefined warn-color token is defined; settings numeric inputs coerce safely; live session teardown uses a real finished-predicate instead of constant-true.

6. **Verification gates** — root typecheck covers all four typed workspaces plus scripts; a minimal push/PR CI workflow runs typecheck + tests; a vitest setup firewall clears inherited `RUNCASTLE_*` env vars so talk-session-spawned test runs stop reading the developer's real data dir.

7. **Prompt/doc drift** — the verified skill-pack fixes (the restored double-log instruction removed, `## Later laps` added to the spec skill's section list, burner/research branch claims corrected, the refusal claim corrected, `blockedBy` documented as required); the findings-log namespace disambiguated (status-marked, citation scheme fixed); the "build" UI label recorded in the domain vocabulary doc (decision #12); design-system relabeled as the design-sync surface (decision #13); fork-attribution counts corrected including the public compare page.

The backlog — event-system overhaul under the emit-everything rule (decision #8), the working-copy mutex (decision #9), derived contract maps (decision #10), wire-shape dedup, overlay/focus rework, query-cache growth, migration-0004 repair, test-fixtures extraction, and the cleanup tail — is filed as GitHub issues per the repo's tracker conventions, each pointing into `audit/REPORT.md`.

## Seams

All existing seams; no new ones are introduced.

- **tRPC procedures over HTTP** (existing) — observes server hardening end-to-end: gate-override rejection, unknown-run cancel failure, waypoint-resolve guard, and (via a live server instance) binding and idle-timeout behavior.
- **Service functions against real SQLite** (existing — the repo's established no-mock test seam) — observes contract-spine enforcement: write a row that violates a core schema, read it through the service, expect a loud parse error instead of silent propagation.
- **Core config loading** (existing pure function) — observes env-var edge cases (`''` vs `'0'` vs unset) with table tests.
- **`PtySession` / registry teardown** (existing, extended by the merged `killTree()` work; its test file shows the pattern) — observes tree-kill adoption: after session end, shutdown, and drive-hook timeout, no grandchild holds a port.
- **Web pure derivations** (existing — the next-step/status derivation functions are pure) — observes the conflict/Burn fix and run-status derivation as input→output tests, no DOM needed.
- **Web component render** (existing vitest setup) — observes the shipped hero, dialogs, and disabled-reason surfaces.
- **The repo's own gates** (existing, being widened) — `bun run typecheck` and the new CI workflow are themselves the test that slice 6 worked; the workflow failing on a deliberately-broken web type is its acceptance check.
- **Skill-pack ↔ code cross-check** (existing content, new one-shot check) — each P1 fix is verified by grepping the pack for the corrected claim against the code that implements it; no permanent machinery (decision #11).

## Out of scope

- Everything filed as GitHub issues (the Tier 2 structural findings, migration repair, mutex, doc derivation, and the cleanup tail) — direction is decided (decisions #8–#10, #13–#14) but the work is not this lap's.
- Runtime/UX re-audit of the running app — this audit was static by decision #3; `E2E-FINDINGS.md` remains the runtime record.
- `vendor/` and generated artifacts (excluded by decision #2).
- Any redesign of the event vocabulary, overlays, or wire shapes beyond what the seven slices name.
- LAN/multi-host serving and auth (explicitly deferred by decision #7's opt-in framing).

## Open questions

None blocking. Two watch items recorded for later laps/issues: whether the emit-everything event rule (decision #8) needs a schema change for pre-project events sooner than the event-system issue lands, and the demo-video tripwire (decision #14) which fires only when the demo is next re-recorded.
