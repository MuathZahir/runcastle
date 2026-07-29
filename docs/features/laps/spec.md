# Spec — Laps

**The authoritative contract is `docs/SPEC.md` §15** (committed `eeffdd9`,
alongside ADR-0010). Names there are law: schema fields, gate wording, tRPC
procedures, MCP surface, kickoff purpose, file formats. This file does not
restate it — it scopes what to build in which lap of this feature itself.
Read §15 in full before ticketing.

## Summary

The pipeline loops until the human merges; one trip is a **lap**. Review
offers Fix / Rethink / Merge. Rethink increments `feature.lap` and returns
the feature to ideation, where one `revisit`-kind session (lap kickoff)
digests test notes, amends decisions + spec, emits the lap's tickets, and
auto-advances to the Burn click. Machinery: `lap` columns + one new typed
transition; no laps table, no new session kinds, no new MCP tools.

## Lap 1 — the loop itself (this lap's tickets)

The thin slice that makes Rethink real, test-drivable on any feature:

1. **Core** — `Feature.lap` + `Ticket.lap` schema fields; `lap` columns on
   `features`/`tickets`/`sessions`/`events` (db-schema + stamping);
   `RETHINK_LOOP_BACK` + `rethinkPhase()` in `pipeline.ts`; G3 check scoped
   to current-lap pending tickets (SPEC §15.1).
2. **Server** — `rethink(featureId)` service (guards: phase=`review`, no
   active run; lap++, phase→`ideation`, emits `lap.started`);
   `feature.rethink` tRPC proc that launches the `revisit` session with the
   lap kickoff; lap stamping in `storeTickets` / session + event creation;
   burn's G3 wording (SPEC §15.2).
3. **Skills** — `revisit` lap mode (digest → amend → emit → complete_phase
   through tickets → hand to Burn; never re-emit promoted tickets);
   `ideate` slicing question (sure → one lap; unsure → thin lap 1 +
   `## Later laps`) (SPEC §15.5).
4. **MCP** — `get_feature_context` gains `lap` (SPEC §15.3).
5. **UI (minimal)** — **Rethink** button in the review bar (hidden while a
   session is live); "Lap N" chip on the stepper when `lap > 1`
   (SPEC §15.6, first two items only).
6. **Tests** — pipeline + service + G3-scoping vitest per SPEC §15.7; smoke
   extension deferred until promotion exists.

## Later laps

Consciously deferred; each lap's session prunes this list with the human.

- **Notes capture** — `feature.testNote` + `test-notes.md` append + the
  test-drive panel notes box; lap-session context injection of the previous
  lap's notes (SPEC §15.2, §15.6).
- **Promotion** — `feature.promoteNote` (bullet rewrite ` → tkt_<id>`,
  `testnote.promoted` event); review notes checklist with inline-editable
  "→ ticket"; **Fix** verb surfacing (current-lap pending tickets exist);
  promoted-ids injection into the lap kickoff (SPEC §15.2, §15.6).
- **Trail** — timeline grouped by lap, per-lap burn summary ("lap 2: 4
  tickets, 4 done") (SPEC §15.6).
- **Spec template** — optional `## Later laps` section added to the spec
  scaffold/skill templates (SPEC §15.4).
- **Smoke** — full loop: burn lap 1 → testNote → promoteNote → Fix burn →
  rethink → lap-2 session emits ticket → burn → merge (SPEC §15.7).
