# Next-step bar affordance audit

## Problem

The guided next-step bar is supposed to show the human their one next move, but several of its buttons duplicate what the session agent already does on its own. While a grill session is live the agent locks decisions incrementally, so the G1 gate satisfies minutes into the conversation and the bar flips to "Promote the idea" — inviting a click that races the agent's own `complete_phase`. "Jump to grill" / "Back to grill" only scroll a terminal that every phase body already renders full-height; in the tickets waiting state that scroll is even the primary button. The result is a bar that sometimes counsels the human to do the agent's job, which erodes trust in the one place the UI claims to know the next step.

## Approach

From the user's perspective: while the agent is working, the bar becomes an honest status line — kicker, title, description, no buttons. Buttons appear only for verbs the agent cannot perform (Burn, Merge, Converge, test drive, session/run lifecycle). Recovery paths survive as quiet secondaries instead of primaries.

The shape of it, per the five locked decisions:

1. **`openGrill` is deleted** — the action kind, its dispatcher case (the scroll-into-view), and every state that offered it. Live-session states at ideation, spec, and tickets-waiting render status-only: a kicker (e.g. `GRILL LIVE`), title, description, `primary: undefined`, empty secondaries. Precedent: the shipped state already renders without a primary.
2. **The live check wins over the gate check.** At ideation and spec, `nextStep()` tests for a live session *before* testing `canAdvance`. While live, the bar never offers `advance`. With no live session and the gate satisfied, the primary is Resume/Start grill session and `advance` ("Promote to spec" / "Approve spec → tickets") drops to a quiet ghost secondary — the escape hatch for hand-written docs or an unresumable conversation.
3. **UI-only.** No server changes; `feature.advance` still accepts calls while a session is live. A server-side guard is out of scope (below).
4. **Dead code removed.** The superseded pre-redesign state machine — `primaryAction`, `stateSummary`, and their supporting types — is deleted along with its tests. `nextStep()` is the one derivation left.
5. **Everything else keeps its place**, unchanged: Converge / Override & converge on mapped ideation (bar-owned), Burn as primary at tickets with tickets present — even while a session is live, since `emit_tickets` lands one batch, so a non-zero count means the cards are reviewable — Cancel run, Resume burn, Merge & ship, Test drive start/stop, Rethink, Revisit, Ask a question, Unarchive.

Status-only copy (drafted here, adjustable in review):
- ideation live — kick `GRILL LIVE`, title "Grill session in progress", desc "Shape the idea with Claude — it promotes the phase itself when the grilling is done."
- spec live — kick `GRILL LIVE`, title "Writing the spec", desc "The spec takes shape beside the conversation — the session advances the phase when it's written."
- tickets, none yet, live — kick `WAITING`, title "Emitting tickets", desc "The session breaks the spec into tickets — they appear here as they land."

The rendering layer needs no structural change: the bar already renders whatever the derivation returns, and already handles an undefined primary. The change is the derivation, the `ActionKind` union, and the dispatcher case that vanishes with it.

## Seams

- **`nextStep(full, ctx)` — existing.** The pure derivation over wire data; the entire behavioral change is observable here as `(FeatureFull, ctx) → NextStep` cases: which states return `primary: undefined`, where `advance` sits, and the absence of any `openGrill` action. The existing unit-test suite for this function is the harness; tests change in place.
- **The `ActionKind` union — existing.** Deleting `'openGrill'` makes the compiler enumerate every render/dispatch site that still references it; the type system is the audit trail that the sweep is complete.

No new seams. The dead-code deletion (decision 4) removes tests rather than adding them.

## Out of scope

- Any server-side guard on `feature.advance` while a session is live (recorded as future hardening).
- Changes to phase bodies, the terminal/SessionPanel, the map rail, or the readonly pinned-view banner.
- The project-level and preparation workspaces' bars — this audit covers the feature workspace's `nextStep()` only.
- Reworking gate semantics or the pipeline model.

## Open questions

None — the disposition of every affordance was settled in ideation. Final copy wording may be tuned at review.
