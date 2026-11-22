# Autopilot retires

## Problem

Autopilot is a state on an epic (an orchestrator chat) that locks its open features' chats, routes every lead question, plan yes and "ready" through the orchestrator, and follows a run plan the orchestrator writes as chat text. In a 36-hour run the relay was the largest cost: the orchestrator's conversation outgrew its cap, a stale hook locked the human out, and leads waited on answers the orchestrator made up anyway. Since "How involved am I" merged, every feature has its own "Involve me in" level, which already says what a lead may decide alone and already merges at "Nothing". Autopilot has no job left, and the separate "Plan automatically" mode says the same thing a second time.

## Approach

### What the human sees

- Feature chats are never locked. The lock note, its "End autopilot" dialog, the autopilot crumb and marks on epic cards, feature rows and the header all go. Old chat entries ("Autopilot on/off") and designs approved by autopilot still render their old words, read from history.
- A feature that has not started shows one Start button; the hint under it says what the lead will do at the feature's level ("asks you first" at Everything, "plans and builds, stopping where your level says" below). "Plan automatically" goes (decision 4).
- A feature whose last dependency merges starts working by itself (decision 5).
- At "Nothing", runcastle merges on ready only when the review is clean (decision 6), and posts a line in the feature's chat naming the merge commit and its revert command (decision 7).
- No new screens. The changes are removals plus one hint line, so they are described in the Plan, not designed.

### Server

- **Autopilot service deleted.** The lock checks, the refusal of the human's messages and edits, the hook that refuses typed prompts in a locked lead's chat, `set_autopilot`, `feature.endAutopilot`, the autopilot field on feature lists, feature context, project context and index marks, and the epic-as-approver branch for designs all go.
- **Orchestrator permissions** (decision 8) become one small rule in place of `mayAct`: the orchestrator acts only on its own epic's features; create, start, read, dependencies, level and message pass; a brief edit passes only while the feature is a draft. `merge_feature`, the orchestrator's drive tool and `stop_feature_run` are removed from its tool list. `send_to_feature` keeps its "from the epic" line.
- **Start by level** (decisions 4, 5). One start path launches the lead with an opening prompt chosen by level: at Everything the interactive opening ("read the brief, speak first"); below it, the headless run that plans and builds alone. `plan_feature` folds into the orchestrator's start tool; the web's start and self-plan calls fold into one. The self-plan purpose and its end handling stay only as far as the headless start reuses them. `startUpNextDependents` calls this same start after it cuts the branch; a failure to launch is trouble that wakes the epic (decision 9).
- **Lead → epic** (decision 9). The lead form of `hand_back` stays, renamed in its description to "trouble that crosses features", with no autopilot gate: it wakes the feature's epic once with the lead's summary, and is refused for a feature with no epic. `wait_for_you`, `declare_ready` and `notify_human` lose their locked branches and always reach the human. A failed wake of a lead tells the human (as off-autopilot today), not the epic.
- **Merge wake** (decision 2). Every merge of a feature with an epic wakes that epic; the hold-when-nothing-else-runs rule and the "epic merged it itself" exclusion go. The message carries the review summary text (the same text written to the brief's "Review summary"), the decisions marked "Decided without you", and any defects dismissed. Non-merge news reaches the epic only for decision 9's trouble: a dependent that failed to start, and the lead's own trouble handback.
- **Clean review** (decision 6). `start_review`'s `checksPassed` is stored on the review. The merge at "Nothing" requires: at least one completed review of the feature, the newest one started with checks passed, and no open defect of any severity (fixed or dismissed count as closed). Otherwise the existing fallback: wait as Ready to test, tell the lead which part was missing.
- **Upgrade** (decision 10). A one-off boot step, idempotent, runs before the database drops the column: for each project chat with autopilot on, every open feature of it at "everything" is set to "nothing" through the involvement service (so its lead is told), and any wait held by the epic for a feature moves back to the feature. Then a migration drops `sessions.autopilot`. The `autopilot` value stays in the designs' approver enum and in old thread entries, for history only.

### Skills

- Project skill: drop autopilot and the run plan from its description, intro and rules 1 and 8; re-home the hard-limit stops (money, accounts, anything outside git that cannot be undone) as their own rule; describe the merge wake and what the epic does with it.
- Feature skill: rule 11 becomes "the epic hears only trouble that crosses features, with `hand_back`"; remove "On autopilot" from the involvement page, the `hand_back` ending of the planning-alone page (it always ends on `wait_for_you`), the "Decided by autopilot" mark, and autopilot lines in the design page and the pack README. The involvement page states decision 6's clean-review rule.

### Scenarios and previews

- "Feature that became yours" is deleted; "Epics in all states" loses its autopilot epic. The autopilot design previews go; other previews drop their autopilot props.

## Seams

- **Orchestrator MCP tool calls** (existing): what each tool allows or refuses on own and foreign features; that merge, drive and stop tools are gone.
- **`declare_ready` at "Nothing"** (existing, `involvement.test.ts`): merges with a clean review; falls back to Ready to test with no review, with checks not passed, and with an open defect of each severity.
- **`mergeFeatureFlow` → orchestrator wake** (existing, `merge-news.test.ts`): every merge wakes the epic; the message holds the review summary, the decided-without-you list and dismissed defects.
- **Dependency merge → dependent's lead launched** (existing seam, new behaviour, `up-next` tests with the launcher faked).
- **Upgrade step against a seeded database** (new, like `involvement-migration.test.ts`): autopilot epics' features move to "nothing", hand-set levels stay, the column is gone.
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
