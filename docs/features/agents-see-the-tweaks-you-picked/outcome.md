# Outcome — Agents see the tweaks you picked

A design page reports its Tweaks values and current state to the Design tab, and runcastle passes the open design's values to the agent on Approve and with each chat message.

- Shipped: 2026-11-10

## What shipped

13 commits · 31 files

## Review record

### Review · drive review

- Outcome: handed-back

- **A tweak changed just before Approve is lost: the approval keeps the previous values** (defect, medium) — fixed: 927238c7: Approve first sends the design's pending report (flushDesignReport) and waits for the server to have it, then approves. Tier-2 test covers it.
- **A re-shown design approved in words carries its previous round's approved tweaks into the approval line** (defect, medium) — fixed: 927238c7: recordDesign clears approved_report when it re-shows a design, so a word approval falls back to the newest report. Server test covers the reported sequence.
- **No scenario reaches a feature with a waiting design whose page reports tweaks** (observation, low) — open

### Review: verify · drive review, verify

- Outcome: handed-back
- Verified fix commits: 927238c7 fix(designs): Approve sends a pending report first; a re-shown design forgets its earlier click's values

- **Scenario "Designs · Feature with designs waiting" works in a real drive: all five checks pass** (observation, low) — open

## Notes record

- No human notes

## Workers

- Relay (on-its-own) — landed · 5559732 tokens
- Review (review) — handed-back · 5336966 tokens
- Review: verify (review) — handed-back · 5453196 tokens
