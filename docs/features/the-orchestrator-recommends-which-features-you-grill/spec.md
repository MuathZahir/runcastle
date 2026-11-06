# The orchestrator recommends which features you grill

## Problem

After a cut is agreed, the orchestrator asks the human how far to carry the work, but never how each feature gets planned. Every feature defaulted to a self-planning run with no human in it, so important and big features were planned on guesses. The human wants to be grilled on those before anything is built, and wants the orchestrator to say which ones.

## Approach

**What the human sees.** When the orchestrator proposes a cut, each feature's line shows a planning mode as its own item, **grill with you** or **plans itself**, with a one-line reason. The human confirms the cut and flips any mode in the same answer. Later, when a "grill with you" feature's turn comes, the orchestrator tells them in its chat to open that feature's chat, names what is waiting on it, and pings their phone once if they seem away. They grill with the feature's lead and give the plan their yes there (or tell the orchestrator, who relays it as their own words). From then on the cut runs exactly as its working agreement says.

**Rules the orchestrator follows** (decisions 1–11):

- Recommend a grill when the feature decides how something new works or looks (where the human would have opinions), is big or hard to undo, or has open questions its brief marks as the human's: a new screen, a new workflow, a change to how the human works with agents. Bug fixes, well-specified mechanical work and small visible tweaks to something that exists (a meter colour, a label) plan themselves. When unsure, recommend the grill. The skill gives one or two short examples of each side.
- Write the mode and its reason into each brief next to the working agreement, and append changes with `add_to_brief`. Read it back after a compaction or relaunch.
- For a "grill with you" feature: never call `plan_feature`, never give its plan the yes on its own judgement, and skip the pre-plan questions it asks before a self-planned run. Start it with `start_feature` if it is still a draft and the agreement allows, then hand the human the chat (bundled with anything else that needs them). Only that feature and its dependents wait; there is no time-out fallback.
- A feature with no recorded mode is judged by the same rule; when the orchestrator would recommend a grill, it asks before a self-planning run.
- The three ways of running a cut (autonomous, checkpoints, check-in after each feature) are unchanged.

**Shape of the change.** All of it is prompt text:

- **The intake reference of the project skill** (`references/intake.md`): the cut proposal in §1b gains the per-feature mode and the rule for recommending it; the working-agreement section gains the line written into each brief.
- **The project skill's core file** (`SKILL.md`, Orchestrating): "Grill, create, plan, start" splits the two modes (the self-planning paragraph applies only to "plans itself"); "The yes, rounds, driving" and "Messages from runcastle" say a grill feature's plan wait is the human's, not the orchestrator's to answer; the self-started draft bullet says a grill feature waits for the human's chat; Reporting lists features waiting on a grill. Keep the core file's size about where it is: the detail goes in the intake reference.
- **The orchestrator's news line for a draft that started by itself** (in the service that turns events into orchestrator news, `orchestrator-notify.ts`): today it says `plan_feature or send_to_feature sets it going`; it also says that a feature whose brief says "grill with you" waits for the human's chat instead.

The feature lead's skill is untouched: an attended lead already grills, and a lead's plan wait already reaches the orchestrator as news.

## Seams

- **The orchestrator skill's wording test** (existing, `packages/server/test/orchestrator-skill.test.ts`): pins the skill's key sentences. New assertions pin the two mode names, the recommendation rule, the brief line, the never-`plan_feature` and never-give-the-yes rule for grill features, and that the three agreement shapes are unchanged.
- **The orchestrator news formatter** (existing, the function that renders an event as an orchestrator line in `orchestrator-notify.ts`, and its tests): the `feature.started` line for an auto-started draft carries the grill path.

## Out of scope

- Any UI for choosing or showing a planning mode. Prompt only.
- The feature lead's own grilling skill.
- A standing preference across cuts ("only grill the big ones"): the human flips modes per cut.
- What happens inside a grill: the human changing their mind mid-grill, or a grill that reshapes the cut, is between the human and the feature's lead, as today.
- Switching a feature to a grill after its plan has its yes: the mode only matters before the plan's yes.

## Open questions

- Whether a grilled feature should also get a check-in before its merge under an autonomous agreement (decision 7 says no; the challenger disagreed).
- Whether the server news line change (decision 9) is welcome, or the skill should carry it alone.
