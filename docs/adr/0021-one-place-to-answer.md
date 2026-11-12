# ADR-0021: One place to answer — a feature is the human's unless they hand it over

- **Status:** accepted (2026-11-12); in force once `one-place-to-answer` merges
- **Deciders:** Muath + the orchestrator (decisions 1–7), Muath + the feature lead of `one-place-to-answer` (8–16)
- **Amends:** ADR-0016 (orchestrator threads hold features): its decision 2, and its consequence that a held feature's human is reached only through its orchestrator
- **Builds on:** `every-feature-has-one-owner` (the holder of ADR-0016 is shown to the human as the feature's owner), and replaces its decisions 4, 14 and 18
- **Record:** `docs/features/one-place-to-answer/decisions.md`

## Context

ADR-0016 gave every feature at most one holding orchestrator chat, and
`every-feature-has-one-owner` showed that to the human as the feature's owner:
the human, or one orchestrator chat (an epic).

The human still could not tell where to answer. Who owned a feature followed
from two separate settings, how it is planned and how far the epic takes it. A
feature that planned itself was handed to the epic even while the human watched
it. A feature the human grilled passed to the epic at the plan's yes. The epic
put a feature's questions to the human and relayed their answers, and leads
refused a design approval that arrived that way, so the human answered twice.

The human has two real modes: working on a feature themselves, and "do these
while I'm gone".

## Decision

1. **A feature is the human's unless they said, in words, that an epic runs
   it** ("run these for me"). Creating a feature no longer holds it. The epic
   becomes the owner at creation exactly when the human chose "Run it for me".

2. **One choice per feature at cut time, with three answers**: "Plan it with
   me" (the human's, grilled in its chat), "Plan automatically" (the human's; it
   plans alone and shows the plan in its chat), "Run it for me" (the epic's; it
   plans automatically, and the epic asks "show you first, or merge?"). A
   grilled feature cannot be handed to the epic at creation.

3. **One place per feature.** The human answers a feature of theirs in its chat
   and an epic's feature in the epic. The header says which. The other agent
   asks the human nothing about it, and an agent that points the human
   elsewhere does not also ask.

4. **The epic never carries the human's decisions.** `send_to_feature` has no
   relay of the human's words. A plain note from the orchestrator stays, and
   never counts as the human.

5. **An epic-run feature that needs the human becomes the human's.** The lead
   waits on the human as any lead does (`wait_for_you`); the server changes the
   owner in the same move, the feature's chat says why it is theirs now, and
   the epic is woken once to say so and carries on with the rest of the batch.

6. **A feature never goes back to an epic by itself.** The human gives it back
   with the owner control or by telling the epic to run it. The hand-over at
   the plan's yes, and the "Yours to plan · then <Epic>" state, are gone. The
   finish choice (show first, or merge) means something only while an epic owns
   the feature.

7. **About features it runs, the epic asks the human two things only**: before
   starting, anything unclear about the batch; at the end, one report and
   "merge these?" for those they chose to see first. A plain yes is given in
   the epic. Feedback beyond that is typed in the feature's chat, which makes
   the feature the human's.

8. **One allowance on the human's features**: the epic may start a "Plan
   automatically" feature it cut, and its planning run, once, when the cut's
   order reaches it. Every other acting tool stays refused there (ADR-0016 §4).

## Consequences

- ADR-0016 otherwise stands: one holder, news only to the holder, a non-holder
  refused, taking explicit, holding binds threads and never the human.
- Features an epic owned when this shipped keep their owner and finish. A
  one-time boot step sets "I finish it" on the human's features.
- Accepted cost: an away batch where three features each need the human is
  three chats to open. A batch left running is meant to hold work with nothing
  left to decide.
- An epic no longer hears of the features it cut for the human. The feature
  `the-epic-hears-when-its-features-merge` gives it their merges, so it can
  still check that the pieces of a cut fit together.
