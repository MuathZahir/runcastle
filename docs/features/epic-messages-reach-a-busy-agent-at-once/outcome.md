# Outcome — Epic messages reach a busy agent at once

A message an epic sends a feature's agent goes into its running turn right away, as the human's own typing does, instead of waiting for the turn to end.

- Shipped: 2026-11-17

## What shipped

5 commits · 15 files

## Review record

### Review · gates review

- Outcome: handed-back

- **On a runtime that can't steer, an epic's message no longer queues like runcastle's own: it is logged at once and out of order** (defect, low) — fixed: 87393d2c: the host's queue check now lets a steer prompt skip the queue only when the runtime steers; otherwise it queues unlogged as runcastle's own. The non-steering test now asserts it is not in the log mid-turn.
- **Some tests the spec lists were not written (compaction, usage limit, turn-just-ended fallback, handback still waits)** (observation, low) — open
- **Runcastle notices held from a failed delivery get steered in along with the epic's message** (observation, low) — open
- **The prompt options now allow combinations that mean nothing (steer on a human prompt, steer with hold)** (observation, low) — open

### Review: verify · gates review, verify

- Outcome: handed-back
- Verified fix commits: 87393d2c fix(server): a steer prompt on a runtime that cannot steer queues as runcastle's own

- **Some tests the spec lists were not written: the turn-just-ended fallback is still untested** (defect, low) — dismissed: The turn-just-ended fallback is the host's shared steer() path, which this feature did not change; a steered epic message reaches it the same way a human one does. Testing it needs the host to think a turn runs while the fake agent has none, a race the fake cannot set up deterministically. Worth a test of its own, but not this feature's gap.

## Notes record

- No human notes

## Workers

- Review (review) — handed-back · 782737 tokens
- Review: verify (review) — handed-back · 364298 tokens
