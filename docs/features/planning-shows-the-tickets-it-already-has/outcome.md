# Outcome — Planning shows the tickets it already has

A feature in the planning phase that already has tickets never shows them. Its page renders only the planning body (GrillBody: 'Decisions so far' plus the session pane, apps/web/src/components/Workspace.tsx ~line 1250), and the ticket list (TicketsBody, ~line 1276) only appears once the phase reaches building. So the next-step bar says 'Review the tickets, then burn. 7 tickets ready' while no ticket is visible, and you can't read or correct a ticket until you've already burned it. This hits quick changes (created straight into planning with tickets) and ordinary features after the tickets agent has emitted them. It looks like a regression: commit f7a4c021 shipped 'a card you can correct before Burn', and the phase collapse (96890432 and the four-states work) seems to have dropped it. Expected: while in planning with at least one ticket, the page shows the ticket ledger (the same TicketsBody or TicketLedger rows, editable before burn as f7a4c021 intended), and not the 'No decisions yet' / 'No session yet — start a session… shape the idea' empty states, which are wrong for a quick change that never has a planning session. A feature in planning with a live session and no tickets yet keeps today's planning body. Reproduce: create a quick change with two or more tickets and open it. Cover it with a feature-ui test for both cases (a quick change with tickets; a feature in planning with no tickets).

- Shipped: 2026-09-26
- Laps run: 1

## What shipped

2 commits · 4 files

### Lap 1
- 1 tickets landed: #1 A feature in the planning phase that already has tickets never shows…
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 261a737a09e10c886eaa7d342708c25a4bf79607
- Landed since: 0
- Outcome: done

- **Host disk ran out of space mid-drive; the walk and the recording were cut short** — open
- **Not driven: a real quick change, and an unmapped planning feature with no tickets (GrillBody)** — open

## Notes record

- No human notes
