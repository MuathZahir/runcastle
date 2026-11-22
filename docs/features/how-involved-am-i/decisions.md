# How involved am I: decisions

## 1. One setting per feature, four nested levels
**Decision:** One setting on every feature says how involved the human is, with four nested levels: Everything (ask the decisions, show the designs, the human tries it and merges; the default), Designs (the lead decides small things, the human sees screens, tries it and merges), Result (the lead plans and builds it all, the human tries it and merges), Nothing (runcastle merges once the lead says ready and the review is clean). It replaces the "plan with me or plan automatically" choice and, in the next feature, autopilot. The names are working names.
**Why:** "Alright, but this setting will be for every feature." Chosen over keeping autopilot and the planning choice as two separate controls.

## 2. At every level, some things are still asked
**Decision:** At every level, work stops before money, accounts or anything outside git that cannot be undone; anything the human named as theirs in the brief is still asked; each decision made without the human is recorded and listed for their return, and they can overturn it by telling that feature's lead.
**Why:** From ADR-0023 decision 7 and the brief, so a lower level never costs the human money or data, or a choice they reserved.

## 3. Where the setting appears
**Decision:** A dropdown on the feature creation card, one per feature, with the epic's recommended level preselected; the level shown on each feature and in its chat, changeable there at any time. When the level changes while a lead waits on a question, the lead is told, decides the question itself, records it and carries on. The review package lists what was decided without the human.
**Why:** "I assume we can have some new UI on the feature creation card that allows the user to choose from a dropdown the level of each feature (with the recommended combination being preselected)."

## 4. "Set all to…" lives on the epic, with all four levels
**Decision:** The bulk control lives on the epic, not only on the creation card, and it is "Set all to…" offering all four levels, not a button fixed to "Nothing".
**Why:** "Yes to both." At bedtime the features already exist, so the control must reach them where they are; and merging unseen is the riskiest level to put behind one tap, so the safer overnight level ("Result") is as easy to pick. Chosen over the human's first idea, a creation-card button that turns all to "Nothing".

## 5. The names: "Involve me in" with four levels
**Decision:** The setting is named "Involve me in". Its levels are "Everything" (the default), "Designs and result", "Result only" and "Nothing". On a feature it shows as e.g. "Involve me in: Result only". Supersedes the working names in 1.
**Why:** "Yes to all." Each level names everything it covers, so the nesting reads at a glance; the working names "Designs" and "Nothing" could read as "only designs" and "do nothing". Chosen over keeping the working names, or a "Stop me for:" label.

## 6. Below "Designs and result", the lead designs screens itself
**Decision:** At "Result only" and "Nothing", the lead settles a new screen's look itself, records it as decided without the human, and the human sees it when they try the result.
**Why:** "Yes to all." Stopping for designs at every level would stop "Result only" mid-way and defeat leaving it overnight. Chosen over stopping for designs at every level.

## 7. "Set all to…" has no undo
**Decision:** After "Set all to…", the human sets levels again themselves (another "Set all to…" or per feature); runcastle keeps no memory of the earlier levels.
**Why:** "Yes to all." Remembering old levels adds hidden state for a rare need. Chosen over an "Undo" that restores each feature's earlier level.

## 8. The "features created" card stays after creation, with no confirm step
**Decision:** The orchestrator creates each feature at the level it recommends, and the "features created" card that follows carries a picker on each created row; there is no confirm step before creation. The look of the pickers, "Set all to…" and the review package's "Decided without you" list is approved as designed.
**Why:** "Yes, these are fine." Chosen over adding a confirm step to the orchestrator's cut, which would slow every cut for a choice the picker can change a moment later.
