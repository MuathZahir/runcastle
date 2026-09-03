# Decisions — Flow redesign: build, review, and ship

## 1. The walkthrough video and annotation loop is the priority of this flow; it must work perfectly
**Decision:** Of the seven areas this flow covers, the walkthrough player and the annotate → note → fix-ticket → next-lap loop come first. The walk gives it the most attention (every scrub, pause, draw, save, jump and dead end), its grilling waypoint is the deepest, and the redesign is judged first on whether that loop works end to end without friction. Other areas are redesigned too, but none may trade against this one.
**Why:** The human's standing complaint: "the annotation flow doesn't work well and isn't very user friendly", restated at charting as "I want to get it to work perfectly". The loop is also the one the human chose to keep whole rather than split, because it cannot be judged in halves.

## 2. Ideation is mapped
**Decision:** This flow is charted into a waypoint map (ADR-0001) rather than grilled in one window: an AFK research pass over the prior designs and audit findings, three serial walk tasks that write `flow-map.md`, a confirm-the-map grilling with the human, then one grilling per design area and one for code shape / `styles.css` retirement. Spec and tickets happen in the converge session, which is also where the lap-1 slicing question is asked.
**Why:** The walk alone (success / failure / cancel burns, a review with a walkthrough, drives with and without a dev command, annotation, both triage paths, a lap 2, a real conflict, merge, shipped) is hours of agent time and dozens of screenshots — more than one context window can hold and still spec from — and seven design areas plus six prior designs to reconcile sit on top of it. Confirmed by the human on 2026-09-03.
