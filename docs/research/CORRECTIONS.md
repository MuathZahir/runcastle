# Corrections

Format-detail corrections where an implementation had to diverge from the prose
in `docs/SPEC.md` because a *pinned contract* (core zod/drizzle schema) or a
research note said otherwise. Per `CLAUDE.md`, the pinned contract / research
note wins; this file records why.

## C1 — ticket `blockedBy` resolves to global seq, not id (A1)

- **Where:** SPEC §3 — `storeTickets(featureId, TicketInput[]) [assign seq,
  resolve blockedBy seq→id]`.
- **Conflict:** the phrase "seq→id" implies storing resolved ticket **ids**
  (`string[]`), but the pinned core schema types `Ticket.blockedBy` (and the
  drizzle `tickets.blocked_by` column) as `number[]` — see
  `packages/core/src/schemas.ts` and `db-schema.ts`. The wire type is law.
- **Resolution (implemented in `packages/server/src/services/tickets.ts`):**
  `TicketInput.blockedBy` values are treated as **1-based positions within the
  emitted batch** (the only reference an emitter has, since `TicketInput` carries
  no seq field). `storeTickets` assigns each ticket a **global** `seq`
  (`max(existing seq) + 1`, then +1 per ticket in array order) and rewrites each
  `blockedBy` position to the referenced ticket's assigned **global seq**,
  stored as `number[]`. An out-of-range or self-referencing position throws
  `InvalidInputError`.
- **Impact:** the ticket-burner (B3) topo-sorts by `seq` using `blockedBy` as a
  list of global `seq` numbers — no id lookup needed.
