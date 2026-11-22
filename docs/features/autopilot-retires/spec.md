# Autopilot retires

## Problem

Autopilot is a state on an epic (an orchestrator chat) that locks its open features' chats, routes every lead question, plan yes and "ready" through the orchestrator, and follows a run plan the orchestrator writes as chat text. In a 36-hour run the relay was the largest cost: the orchestrator's conversation outgrew its cap, a stale hook locked the human out, and leads waited on answers the orchestrator made up anyway. Since "How involved am I" merged, every feature has its own "Involve me in" level, which already says what a lead may decide alone and already merges at "Nothing". Autopilot has no job left, and the separate "Plan automatically" mode says the same thing a second time.

## Approach

### What the human sees

- Feature chats are never locked. The lock note, its "End autopilot" dialog, the autopilot crumb and marks on epic cards, feature rows and the header all go. Old chat entries ("Autopilot on/off") and designs approved by autopilot still render their old words, read from history.
- A feature that has not started shows one Start button; the hint under it says what the lead will do at the feature's level ("asks you first" at Everything, "plans and builds, stopping where your level says" below). "Plan automatically" goes (decision 4).
- A feature whose last dependency merges starts working by itself (decision 5).
- At "Nothing", runcastle merges on ready only when the review is clean (decision 11), and posts a line in the feature's chat naming the merge commit and its revert command (decision 7).
- No new screens. The changes are removals plus one hint line, so they are described in the Plan, not designed.

### Server

- **Autopilot service deleted.** The lock checks, the refusal of the human's messages and edits, the hook that refuses typed prompts in a locked lead's chat, `set_autopilot`, `feature.endAutopilot`, the autopilot field on feature lists, feature context, project context and index marks, and the epic-as-approver branch for designs all go.
- **Orchestrator permissions** (decision 12) become one small rule in place of `mayAct`: the orchestrator acts only on its own epic's features; create (with its level), start, read, dependencies, message and merge pass; a level changes afterwards only by the human, as before; a brief edit passes only while the feature is a draft. The orchestrator's drive tool and `stop_feature_run` are removed from its tool list. `merge_feature` stays (the human asks for it), with the same merge as the Merge button. `send_to_feature` keeps its "from the epic" line.
- **Start by level** (decisions 4, 5). One start path launches the lead with an opening prompt chosen by level: at Everything the interactive opening ("read the brief, speak first"); below it, the headless run that plans and builds alone. `plan_feature` folds into the orchestrator's start tool; the web's start and self-plan calls fold into one. The self-plan purpose and its end handling stay only as far as the headless start reuses them. `startUpNextDependents` calls this same start after it cuts the branch; a failure to launch is trouble that wakes the epic (decision 9).
- **Lead → epic** (decision 9). The lead form of `hand_back` stays, renamed in its description to "trouble that crosses features", with no autopilot gate: it wakes the feature's epic once with the lead's summary, and is refused for a feature with no epic. `wait_for_you`, `declare_ready` and `notify_human` lose their locked branches and always reach the human. A failed wake of a lead tells the human (as off-autopilot today), not the epic.
- **Merge wake** (decision 2). Every merge of a feature with an epic wakes that epic; the hold-when-nothing-else-runs rule and the "epic merged it itself" exclusion go. The message carries the review summary text (the same text written to the brief's "Review summary"), the decisions marked "Decided without you", and any defects dismissed. Non-merge news reaches the epic only for decision 9's trouble: a dependent that failed to start, and the lead's own trouble handback.
- **Clean review** (decision 11). `declare_ready` takes `checksPassed`. The merge at "Nothing" requires `checksPassed: true` on that call and no open defect of any severity (fixed or dismissed count as closed); no review worker is required. Otherwise the existing fallback: wait as Ready to test, tell the lead which part was missing. `report_finding` opens to the lead (its own chat), so a lead that reviewed with subagents records their defects against the feature; the lead closes them with `resolve_finding` as today.
- **Upgrade** (decision 13). Migration 0079 first marks every open feature of an epic with autopilot on, then drops the column; a one-off boot step, idempotent, then reads those marks: each such feature still at "everything" is set to "resultOnly" through the involvement service (so its lead is told), and a question the lead had handed to the epic moves back to the lead's chat as its wait, unless a later message to the lead (the epic's answer) or a later handback followed it. The `autopilot` value stays in the designs' approver enum and in old thread entries, for history only.

### Skills

- Project skill: drop autopilot and the run plan from its description, intro and rules 1 and 8; re-home the hard-limit stops (money, accounts, anything outside git that cannot be undone) as their own rule; describe the merge wake and what the epic does with it.
- Feature skill: rule 11 becomes "the epic hears only trouble that crosses features, with `hand_back`"; remove "On autopilot" from the involvement page, the `hand_back` ending of the planning-alone page (it always ends on `wait_for_you`), the "Decided by autopilot" mark, and autopilot lines in the design page and the pack README. The involvement page states decision 11's clean-review rule: pass `checksPassed` to `declare_ready`, and record a subagent review's defects with `report_finding`.

### Scenarios and previews

- "Feature that became yours" is deleted; "Epics in all states" loses its autopilot epic. The autopilot design previews go; other previews drop their autopilot props.

## Seams

- **Orchestrator MCP tool calls** (existing): what each tool allows or refuses on own and foreign features; merge stays on own features; drive and stop tools are gone.
- **`declare_ready` at "Nothing"** (existing, `involvement.test.ts`): merges with checks passed and no open defect, with or without a review worker; falls back to Ready to test with checks not passed or missing, and with an open defect of each severity, including one the lead reported itself.
- **`mergeFeatureFlow` → orchestrator wake** (existing, `merge-news.test.ts`): every merge wakes the epic; the message holds the review summary, the decided-without-you list and dismissed defects.
- **Dependency merge → dependent's lead launched** (existing seam, new behaviour, `up-next` tests with the launcher faked).
- **Upgrade step against a seeded database** (new, like `involvement-migration.test.ts`): autopilot epics' features at "everything" move to "resultOnly", hand-set levels stay, the column is gone.
- **Thread send and the prompt hook** (existing): a human message is never refused for autopilot.
- **Web component tests**: the empty-state start shows one button and the level's hint; no lock note renders.

## Out of scope

- The level setting and its screens (shipped in "How involved am I").
- Stacked branches or building on an unmerged dependency.
- Any supervisor or watchdog in autopilot's place.
- `CONTEXT.md` and ADR-0022: only the orchestrator may write them; it should mark ADR-0022 superseded and drop autopilot from `CONTEXT.md` when this merges.
- ADR-0023 decision 6 (no required plan approval) and the Plan tab's removal.

## Open questions

- Whether "Designs and result" should keep the plan's yes. Today's skill text says the lead decides open questions there; this feature does not change that.
