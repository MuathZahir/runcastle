# Outcome — Questions are written in the reply

Agents write every question to the human in their reply; the needs-you line is only a short label for the sidebar and phone.

- Shipped: 2026-11-21

## What shipped

6 commits · 19 files

## Review record

### Review · gates review

- Outcome: handed-back

- **The needs-you error still tells agents the label is "a short line saying what you need"** (defect, low) — fixed: 760884c0 rewords both empty-why errors; e8026b61 fixes the type comment. Verify review confirmed the errors.
- **The wait_for_you description is copied by hand in the main server and the worker script** (observation, low) — open
- **The orchestrator's needs-you tool tells it to use hand_back on autopilot, a tool it does not have** (defect, low) — fixed: 760884c0 scopes the hand_back line to feature leads on autopilot; verify review confirmed (397 chars).
- **The plan-ending step in the "planning alone" guide still reads as if the call carries the question** (defect, low) — fixed: 760884c0 rewrites planning-alone's step 4 and line 20: question last in the message, then wait_for_you with a label. Verify review confirmed.

### Review: verify · gates review, verify

- Outcome: handed-back
- Verified fix commits: 760884c0 fix(server,skills): label wording in the empty-why error, hand_back line for leads only, planning-alone's closing step

- **The needs-you error still tells agents the label is "a short line saying what you need": the type comment was left as it was** (defect, low) — fixed: e8026b61 rewrites the type comment at server.ts:879 to call why a few-word label. Comment-only, no further verify run.

## Notes record

- No human notes

## Workers

- Review (review) — handed-back · tokens not counted
- Review: verify (review) — handed-back · tokens not counted
