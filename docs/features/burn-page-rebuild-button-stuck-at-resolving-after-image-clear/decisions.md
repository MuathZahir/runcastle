# Decisions — burn-page-rebuild-button-stuck-at-resolving-after-image-clear

Quick-change feature: no grill session; the original intent is the two
sentences in `brief.md`.

## Revisited 2026-09-19

- **Shorten the armed Rebuild label.** The armed button label at
  `EnableAfkCard.tsx:514` renders the full Dockerfile path
  (`Rebuild image · <path> → <tag>`). Shorten it: path → basename, or drop
  the path from the label entirely (implementer's call on which reads
  better); the full path stays in the tooltip, which already carries it
  (`title` at EnableAfkCard.tsx:506). Added to ticket 1 (the EnableAfkCard
  image-row ticket).

- **A quick change is born with its tickets marked ready.** Observed during
  this revisit: opening a chat on a quick-change feature hides Burn for as
  long as the terminal is open. The planning bar
  (`apps/web/src/lib/feature-ui/next-step/planning.ts:77`) shows "Finishing
  the tickets" instead of Burn while `pending > 0 && live &&
  ticketsReadyLap !== lap`. The stamp is written only by
  `markTicketsReady` (`packages/server/src/services/repo.ts:234`), and only
  `complete_phase("tickets")` calls that — which a quick change never runs,
  because it has no planning session. So its `ticketsReadyLap` stays `null`
  forever, and the guard reads every later chat as a session "still
  finishing the tickets".

  Fix: `quickChange` (`packages/server/src/services/features.ts:377`) writes
  `ticketsReadyLap: 1` in its insert. The fact is true at birth, because the
  tickets are complete and no session is enriching them. It is a readiness
  fact rather than a quick-change marker, so ADR-0010 §7 ("nothing on the row
  marks it") still holds. The web guard is unchanged. Both doors, the tRPC
  `feature.quickChange` and the MCP `create_feature` `tickets` shape, go
  through the same service, so both are covered.

  Checked for side effects before deciding:
  - The stamp has exactly one reader, the guard above. The server's burn
    path, the Burn dialog and the building/review resolvers never read it.
  - Stamp in the insert rather than calling `markTicketsReady`. That avoids a
    second `tickets.awaiting_burn` event, which nothing consumes, and
    `feature.quick_change` already records the birth on the timeline.
  - Laps still work. On lap 2 and later, a stamp of 1 is stale by design, so
    the lap session's `complete_phase("tickets")` re-arms it, the same as
    for every other feature.
  - Accepted trade-off: a live revisit that emits new tickets on a stamped
    feature shows Burn before it has finished enriching them. Every ordinary
    feature already behaves this way after its first `complete_phase`, so
    this puts quick changes on the same footing and adds no new risk. That
    race is out of scope here.
  - No backfill. Quick changes created before the fix keep `null`. Their
    only symptom is Burn hidden while a chat terminal is open, and it clears
    when the terminal closes. A migration keyed off event history is not
    worth its risk for that.
