# Outcome — Stopping a session kills its process

When runcastle stops an agent session, its processes really exit, and leftovers from earlier are cleaned up.

- Shipped: 2026-11-21

## What shipped

7 commits · 19 files

## Review record

### Review · gates review

- Outcome: handed-back

- **No test shows the Codex usage read or a timed-out short command leaves no process behind** (defect, medium) — fixed: 20acf3bf: thread-usage.test.ts runs the usage read against a fake app server that starts a child and ignores stdin EOF, then asserts both are gone; doctor-system-exec.test.ts times out a command that starts a child and asserts both are gone. Both fail with the own-group spawn turned off (checked).
- **A thread stopped while its adapter is still starting leaves nothing for the next start to wait on** (observation, low) — open
- **The new crash-path cleanup (stopping what a crashed adapter left) has no test** (observation, low) — open
- **Log lines are less exact than the decisions say: the start-up count is "picked", not "ended", and a survivor is named only by its root pid** (observation, low) — open
- **Every short command now runs in its own process group, including the worker docker commands the brief keeps out of scope** (observation, low) — open
- **Duplicated code: the "own process group off Windows" rule appears in four files, and the /proc stat parsing appears twice** (observation, low) — open

### Review: verify · gates review, verify

- Outcome: handed-back
- Verified fix commits: 20acf3bf test(server): prove every leaky stop leaves no process behind

- No findings

## Notes record

- No human notes

## Workers

- Review (review) — handed-back · tokens not counted
- Review: verify (review) — handed-back · tokens not counted
