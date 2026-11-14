# Outcome — Skills become short rules

Rewrite the feature lead's and the orchestrator's skills as about ten rules each plus tool contracts, and stop patching every incident with a new paragraph.

- Shipped: 2026-11-14

## What shipped

20 commits · 38 files

## Review record

### Review · gates review

- Outcome: dropped

- **"Bring the context with the decision" was cut from both briefings, but neither skill picked it up and no handback lists it as dropped** (defect, medium) — fixed: 9aacab78: lead rules 3–4 and orchestrator rules 3–4 now carry context-with-the-decision (situation, why now, options, pick, cost if wrong), condense, senior advisor; the orchestrator also gains define-project-names, conclusion first, play each decision back.
- **The orchestrator's rule 3 says to notify_human after a wait, but notify_human's new description says not to, because a wait already pings the phone** (defect, medium) — fixed: 9aacab78: orchestrator rule 3 drops "notify_human once" and says the wait pings their phone, matching the tool.
- **The orchestrator's rule 3, "One question at a time", tells it in the next sentence to send one message of numbered questions** (defect, low) — fixed: 9aacab78: rule 3 now allows numbered questions only for small items that block nothing else, restoring main's exception.
- **Some tool contracts the spec listed never reached the tool descriptions, and handbacks.md doesn't list them as dropped** (defect, low) — fixed: e1da80ea: start_worker says it waits queued past the agent limit (workers/service.ts takeWorkerSlot). notify_human left as is: its autopilot refusal explains itself, and both notes it returns already say "Tell the human in this chat".
- **Small "one home per rule" leftovers: the briefings still repeat the commit rule, and the skills describe tool behaviour the new README line forbids** (observation, low) — open
- **One test fails outside the known baseline, the terminal backend's "kills the whole tree" test, almost certainly the review sandbox rather than this feature** (defect, low) — dismissed: Sandbox-only: pty-bun.test.ts passes on this machine, alone and in the full suite (5,405 passed); the branch touches no terminal code.

### Review: verify · gates review, verify

- Outcome: dropped
- Verified fix commits: 9aacab78 fix(skills): the ask rules carry the briefing's context-with-the-decision lines; one question at a time no longer fights batching, e1da80ea fix(mcp): start_worker says a worker waits queued past the agent limit

- No findings

## Notes record

- No human notes

## Workers

- Lead rules (on-its-own) — landed · tokens not counted
- Orchestrator rules (on-its-own) — dropped · tokens not counted
- Briefings and tools (on-its-own) — dropped · tokens not counted
- Review (review) — dropped · 3740286 tokens
- Review: verify (review) — dropped · 552424 tokens
