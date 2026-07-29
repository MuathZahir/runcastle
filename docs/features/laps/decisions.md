# Decisions — Laps

> **Handoff.** This feature was grilled to completion on 2026-07-28 in a
> session outside runcastle. The design is locked: ADR-0010 records the
> trade-offs, SPEC §15 pins every name, and CONTEXT.md decision 15 is the
> summary. **Do not re-grill.** Ideation and spec are done (this file + the
> sibling `spec.md` satisfy G1/G2 honestly); the next session's job is
> tickets only — read the docs, confirm the slice plan with the human, and
> `emit_tickets`.

## 1. The loop closes on the feature branch
**Decision:** Laps accumulate on `feature/<slug>`; main is merged once, at the
end, when the human is happy. Test-drive mechanics and git topology untouched.
**Why:** Matches the existing single-final-merge topology and how a solo
dogfooder explores fuzzy ideas — half-formed experiments never land on main.
Rejected: merge-every-lap (trunk-based discipline is a team virtue).

## 2. The pipeline loops; the map was not generalized
**Decision:** Keep phases exactly as they are and add one sanctioned backward
transition: `RETHINK_LOOP_BACK = { from: 'review', to: 'ideation' }` (mirror
of `REVIEW_LOOP_BACK`). The map stays an ideation-scale tool, usable inside
any lap, never restructured.
**Why:** The map answers "too big to think through in one sitting"; laps
answer "can't know if I want it until I try it" — different problems, and one
abstraction for both makes both fuzzier. Rejected: a `build` waypoint type
spanning the lifecycle — demolishes working phase/gate machinery.

## 3. Three verbs from review: Fix / Rethink / Merge
**Decision:** *Fix* — spec was right, code wasn't: burn again via the existing
review→implementation loop-back, same lap. *Rethink* — code was right, spec
wasn't: `feature.rethink` increments the lap and lands the feature in
`ideation`, always. *Merge* — unchanged G5. The existing review-bar "Iterate"
action is subsumed by Fix/Rethink.
**Why:** Rethink always landing in ideation gives the digest-what-I-learned
conversation a permanent home (a small rethink is just a short grilling);
every lap's learning lands in `decisions.md`, which is what makes lap 3's
grilling smarter than lap 1's.

## 4. "Agile" is not a mode
**Decision:** No toggle, no flag. A feature merged on lap 1 is the old linear
flow verbatim; "waterfall" and "agile" are descriptions of how a feature went.
Slicing is the `ideate` skill's judgment, driven by one standing question —
*how sure are you this is what you want?* Sure/small → spec it whole, one
lap. Unsure/large → thin lap 1 (walking skeleton or sub-feature slice), with
deferred scope parked in the spec's `## Later laps` section.
**Why:** MVP-first is dogma; uncertainty is the honest driver. Machinery for
a conversational judgment would be fought every time the human is sure.

## 5. Laps 2+ are one session by default
**Decision:** A lap is one `revisit`-kind terminal with a lap-purpose kickoff:
digest test notes → update `decisions.md` + spec (pruning `## Later laps`) →
`emit_tickets` → `complete_phase` through ideation/spec/tickets. Human
ceremony per lap: one conversation + two clicks (Burn, Merge-or-loop). Full
ceremony and the map remain opt-in escalation. No new `SessionKind`.
**Why:** The standing constraint: a lap must never cost more than "I could've
done that in one Claude session". Decision 9's unbroken-window rule already
sanctions grill→spec→tickets in one context; `revisit`'s semantic (resume the
conversation, amend docs + tickets) *is* a lap session, and the kickoff
registry already varies revisit briefings by purpose.

## 6. Test-drive notes: quick-capture, inject, promote
**Decision:** The test-drive panel gains a notes box; notes append to
`docs/features/<slug>/test-notes.md` under `## Lap N` headings and are
injected into the next lap session's context. In review, notes render as a
checklist with a one-click "→ ticket" action (text editable inline) — the
promoted ticket joins the *current* lap and Fix burns it, no terminal needed.
The lap session is told which notes are already tickets and never re-emits
them. Promotion is optional; Rethink is the catch-all.
**Why:** Observations evaporate between clicking and terminal; capture at the
moment of noticing. The cheapest lap type ("three obvious bugs") costs a few
clicks and zero conversations.

## 7. Machinery is a counter plus tags — no laps table
**Decision:** `Feature.lap: number` (starts 1; Rethink increments, Fix never
does). `lap` columns on `tickets`, `sessions`, `events`, stamped at row
creation. G3/Burn scope to the current lap's pending tickets; G4 stays
cumulative (earlier laps' tickets are terminal by construction); G1/G2 stay
dumb on laps ≥2 (the lap starts with its grilling by construction). Lap trail
UI is derived by grouping — no new endpoints, no new polling.
**Why:** A lap has no independent lifecycle; a row would mirror the feature's
phase state, and mirrors drift. Re-arming G1/G2 with modified-this-lap file
heuristics is brittle machinery that trains the Override reflex.

## 8. The canonical term is "lap"
**Decision:** `lap` in schema, events, UI copy, and skill vocabulary.
**Why:** Extends the load-bearing test-drive metaphor; short; unambiguous in
transcripts ("iteration" never would be).

## 9. Build slicing: this feature dogfoods itself
**Decision:** Thin lap 1 — the Rethink transition + lap counter + lap kickoff
+ skill amendments — test-driven on a real feature; notes capture, promotion,
Fix surfacing, and the trail follow as later laps (see `spec.md`
`## Later laps`).
**Why:** The feature validates itself; recursion is the point.

## Open threads (tracked in CONTEXT.md, not this feature's scope)
- Per-burn overhead (sandbox spin-up, burner orientation) — attacked
  independently so laps never feel slower than a bare Claude session.
