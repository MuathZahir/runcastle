## Purpose

Runcastle has two controls for how much the human is asked: the "plan with me or plan automatically" choice when a feature is created, and autopilot, a switch on an epic with a run plan and locked chats. Neither fits what the human actually wants: "What if I want the feature to plan itself but show me the design before starting. Or maybe I want it to implement on its own but show me before merging. Do we really need something called 'Autopilot' in this case? I'm really trying to think of the simplest way to go about this that results in the simplest mental model for the user. I don't want the user to be confused or overwhelmed".

This feature adds one setting per feature that answers "how involved do you want to be?". It is decision 7 of `docs/adr/0023-a-lighter-feature-loop-without-sandboxes.md`.

A feature has three moments where it may need the human: decisions (questions about what they get), designs (a screen to approve), and the result (trying it and merging). They nest, so it is one setting with four levels. The names are working names; the human expects to change them:

- **Everything:** ask me the decisions, show me the designs, I try it and merge. The default.
- **Designs:** decide the small things yourself, show me the screens, I try it and merge.
- **Result:** plan and build it all, then show me before merging.
- **Nothing:** merge it when the lead says ready and the review is clean.

At every level: work stops before money, accounts, or anything outside git that cannot be undone; anything the human named as theirs in the brief is still asked; and each decision made without them is recorded and listed for their return, so they can overturn one by telling that feature's lead.

What the human gets, and where:

- A dropdown on the feature creation card, one per feature, with the epic's recommended level preselected.
- The level shown on each feature, in its chat, and changeable there at any time.
- "Set all to…" on the epic, with the four levels, for every feature of that epic at once.
- When the level changes while a lead waits on a question, the lead is told, decides the question itself, records it and carries on.
- The review package lists what was decided without them.

Who: every runcastle user.

## Must not swallow

- Removing autopilot's machinery (the locked chats, the relay of questions through the epic, the run plan and its tools, the epic's merge message). The next feature does that and waits on this one. Here, the setting must work beside what exists.
- A "small" and "large" path. Each stop exists only when it has something to stop for.
- Building a waiting feature on its dependency's unmerged branch. A feature starts only after what it waits on has merged.

## Decided with the human

- One setting with four nested levels, replacing autopilot and the planning mode: "Alright, but this setting will be for every feature."
- The surfaces: "I assume we can have some new UI on the feature creation card that allows the user to choose from a dropdown the level of each feature (with the recommended combination being preselected). Maybe with a button that converts all to 'Nothing' which I can use when going to sleep for example." and "yes, we will have to change the names probably".
- The orchestrator proposed two changes, and the human went on without objecting, so confirm both in this feature's grill: the bulk control lives on the epic, not only on the creation card, and it is "Set all to…" with all four levels, not a button fixed to "Nothing", because merging unseen is the riskiest level to put behind one tap.
- Why it exists: "the reason I made autopilot was because sometimes I want to go sleep and keep the agent working without having to answer its questions" and "sometimes I would like the epic agent to take a feature and just finish it without me".
- The human grills this feature themselves ("Plan it with me"), agreed with the cut: "Alright, you can start".

## Understood

- At the lower levels the lead decides its own open questions, picking its recommendation, and does not send them to the epic. The record shown on the human's return is the check on that.
- At "Nothing", runcastle merges in the recorded order, and a feature that was waiting starts working by itself at its own level.
- A feature with no screens makes the first two levels nearly the same. Harmless, but the design should not make it look odd.

## Open

- The names of the four levels and the setting itself. They must be obvious at a glance.
- The look of the dropdown, the per-feature control and "Set all to…": designed with the human in design mode.
- Who decides a screen's design when the level is below "Designs": the orchestrator's reading is the lead, recorded as decided without the human.
- Whether the human wants their previous levels back in the morning after "Set all to…", or sets them again.

## Ordering

Waits on "Building starts without a plan approval". "Autopilot retires" waits on this.

Planning mode: with you
