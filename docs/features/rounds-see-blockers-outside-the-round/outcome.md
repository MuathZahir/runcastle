# Outcome — Rounds see blockers outside the round

A dispatched round fails any ticket whose blocker is done or cancelled outside that round ("blocked by missing ticket N"); such blockers should count as satisfied, and a blocker that is still pending outside the round should be refused clearly at dispatch.

- Shipped: 2026-10-22
- Laps run: 1

## What shipped

5 commits · 15 files

### Lap 1
- 1 tickets landed: #1 Rounds: honour finished blockers outside the round, refuse unfinished ones at dispatch
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 3ab4ecea04ccd370bc9f708f3ab3ddaead454f14
- Landed since: 0
- Outcome: done

- **The "done or cancelled counts as satisfied" rule is now written out in three files** — open
- **One assertion in the new runner test can never fail** — open
- **The lead skill's round-planning step mentions pending outside blockers but not failed ones** — open
- **No test pins the new dispatch_round description or lead-skill sentences** — open
- **The accepted orphan case (a leftover burning row outside the round reported as failed) has no test** — open

## Notes record

- No human notes
