# Decisions — next-step bar affordance audit

## 1. Remove `openGrill` entirely; live-session states go status-only
**Decision:** Delete the `openGrill` action kind ("Jump to grill" / "Back to grill") from `nextStep()` and the Workspace dispatcher. States where a session is live (ideation-live, spec-live, tickets-waiting-live) render the bar as status-only: kick + title + desc, `primary: undefined`, no secondaries pointing at the terminal.
**Why:** Every phase body already renders the SessionPanel terminal full-height — `openGrill` only scrolls something already on screen into view. A status-only bar honestly says "the agent is working"; precedent exists (shipped phase has no primary). Demoting to a secondary would keep exactly the scroll-only clutter the audit exists to remove.

## 2. `advance` never shows while live; demoted to a secondary when idle
**Decision:** In `nextStep()` the live-session check wins unconditionally over the gate-satisfied check: while any session is live at ideation or spec, the bar shows the status-only live state and never offers `advance`. With no live session and the gate satisfied, `advance` ("Promote to spec" / "Approve spec → tickets") survives only as a quiet ghost secondary; the primary stays Resume/Start grill session.
**Why:** The session agent calls `complete_phase` itself, and it locks decisions incrementally — so `decisions.md` exists minutes into a grill and the current precedence flips the bar to "Promote the idea" mid-session, inviting a click that races the live agent. With no session, `advance` is not a duplicate but a rare recovery path (hand-written docs, unresumable conversation) — worth keeping as an escape hatch, not the happy path.

## 3. UI-only — no server-side advance guard this lap
**Decision:** The feature changes only the web derivation (`nextStep()`) and its rendering. `feature.advance` keeps accepting calls while a session is live; a server guard is recorded as out of scope in the spec.
**Why:** The audit is about bar affordances — removing the invitation to race the agent. A server guard is real hardening but a separate concern with its own decisions (which session kinds block, error wording), and the 1.5s polling keeps the stale-tab window small. Bolting it on widens a small, sure feature.

## 4. Delete the superseded `primaryAction` + `stateSummary` state machine
**Decision:** Remove `primaryAction`, `stateSummary`, and their supporting types (`PrimaryActionKind`, `PrimaryAction`) plus their test blocks from `feature-ui.ts` / `feature-ui.test.ts`. `nextStep()` is the one derivation left.
**Why:** Nothing outside tests imports them — `nextStep()` superseded them in the pipeline-first redesign. This audit is exactly the "which affordances earn their place" pass over this file; leaving a parallel drifting state machine makes every future reader disprove it.

## 5. The audit's conclusion — everything else keeps its place
**Decision:** All remaining affordances survive unchanged: Converge / Override & converge (mapped ideation), Burn (stays primary at tickets t>0 even while a session is live — emit_tickets lands as one batch, so t>0 means the cards are ready to review), Cancel run, Resume burn, Merge & ship, Test drive start/stop, Rethink, Revisit, Ask a question, Unarchive. Tickets t=0 with a live session goes status-only ("agent is emitting tickets"); tickets t=0 idle keeps Open/Resume grill.
**Why:** These are all actions the session agent cannot perform — human-only gates (G3 Burn, G5 Merge), bar-owned transitions (Converge, decision #4 of the app-redesign), or session/run lifecycle controls. The audit removes duplicates of the agent, not human-owned verbs.
