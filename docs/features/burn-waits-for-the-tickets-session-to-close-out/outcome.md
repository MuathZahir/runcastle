# Outcome — Burn waits for the tickets session to close out

Arm the Burn button only after the ideation session completes the tickets phase, so a mid-emit click can never burn placeholder tickets or race the session's close-out.

- Shipped: 2026-09-09
- Laps run: 1

## What shipped

7 commits · 14 files

### Lap 1
- 1 tickets landed: #1 Burn readiness: ticketsReadyLap flips at complete_phase(tickets), gates the first burn, and calms the UI
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: ee1c7918a9819f38a7de49bb483907e8cd0c5ddb
- Landed since: 0
- Outcome: done

- **Tickets-phase waiting and Burn states could not be reached in the review drive** — open
- **Readiness guard, late completion, and unchanged re-burn paths remain unverified** — open
- **Repository verify-command acceptance criterion was not evaluated in Drive mode** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Burn readiness: ticketsReadyLap flips at complete_phase(tickets), gates the first burn, and calms the UI

# Ticket 1 — burn readiness (ticketsReadyLap)

## What was done

The `features` table, the core `Feature` wire schema and `rowToFeature` now carry
`ticketsReadyLap` (column `tickets_ready_lap`, nullable integer), added by
`packages/server/drizzle/0035_feature_tickets_ready_lap.sql`. The MCP
`complete_phase({phase:"tickets"})` G3 branch stamps it with the feature's current lap
through a new `markTicketsReady` in `services/repo.ts`, which also emits the
`tickets.awaiting_burn` milestone that used to be emitted inline in the tool handler —
the mutation and its event now live together, per the project's emit-on-mutate rule.
`burn()` gained one private guard, `assertTicketsReady`, called only on the fresh
`tickets` path after the `tickets-approved` gate check: it refuses with a `GateError`
when `ticketsReadyLap !== lap` and an active session exists, and returns silently when
no session is alive (the escape hatch). Restart and Iterate never reach it. A late
`complete_phase({phase:"tickets"})` against a feature already past `tickets` now returns
`{ ok: true, nextPhase, note }` instead of falling through to the G4 check, using a new
`note` field on the ok-branch and a new pure `isPastPhase` helper in `core/pipeline.ts`.
The tickets next-step resolver shows a WAITING "Finishing the tickets" step (no Burn,
no secondary) under exactly the server's condition. Deviation from the ticket text: none
of substance; I also extended the `complete_phase` MCP tool *description*, because the
call is now load-bearing for the human's button and a session reading the old text would
not know that.

## Surprises

- The `complete_phase` early return is scoped to `input.phase === 'tickets'` deliberately.
  Generalising `isPastPhase` to every phase would silently change other phases' behaviour
  (e.g. `complete_phase({phase:"ideation"})` at `spec` currently advances `spec → tickets`
  when G2 is satisfied), which this ticket does not ask for.
- One existing web test — "keeps Burn primary at tickets while live" — asserted precisely
  the behaviour this feature removes. It is updated to pass `ticketsReady`, and its
  fixture now sets `lap`/`ticketsReadyLap` on the feature and `lap` on the tickets (both
  were previously `undefined`, which matched only by accident).
- **A pre-existing test failure that is NOT in the prompt's baseline**:
  `packages/server/test/dev-pane.test.ts > kills the child process tree so the port-holder
  is not orphaned` fails with `expected true to be false`. I confirmed it is not mine by
  running that file at the base commit (`6d0997b`) in a clean `git worktree` with linked
  deps: identical failure, `1 failed | 10 passed | 2 skipped`. It is a real process-group
  kill against the sandbox kernel and cannot be reached from this diff. Everything else is
  green: `bun run typecheck` clean, `env -u GIT_ASKPASS bun run test` → 3383 passed, that
  one failure, 4 skipped.
- The drizzle `meta/_journal.json` is already out of sync with the migrations directory
  (`0034_review_evidence_stamps.sql` has no entry), and the runtime migrator sorts files by
  name and tracks them in `__migrations`, ignoring the journal. I followed the recent
  hand-written-migration precedent and added no journal entry.

## Left undone

- Drive machinery: none of the four triggers (new service, required env var, seed,
  extra process) applies — the change is one additive nullable column plus service code —
  so `.runcastle/drive-setup.ts` and friends are untouched and I did not run them.
- The `emit_tickets` ~10KB payload timeout that forces the placeholder-then-enrich pattern
  is still there, parked by the spec as its own draft feature.
- `docs/SPEC.md` line 46's `Feature { … }` shape is stale (it still lists `size` and omits
  `mapped`/`lap`); I did not add `ticketsReadyLap` to it rather than half-fix a build-era
  document.
- `apps/web/src/lib/feature-ui/sidebar.ts` still shows the lane hint "review & burn tickets"
  the moment tickets exist, with no readiness condition. It is a lane label, not a button,
  so it cannot start a premature burn — but it is the one other surface that talks about
  burning before the session has closed out.
