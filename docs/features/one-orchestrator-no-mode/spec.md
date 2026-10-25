# One orchestrator, no mode

## Problem

The project chat can act on features only when an experimental per-project setting is on, and then only on features it created or was handed. Those features carry an "Orchestrated" tag. So the human has two kinds of project chat, two kinds of feature, and a switch to remember. With the switch off, the project chat can see a feature but cannot start, message or merge it, and the human has to open every feature and do it by hand. The human wants one front door: they say what they want in the project chat and are pulled in only to judge how it looks and whether it should merge. Nothing should happen that they did not agree to.

The current mode also predates the feature lead: its news lines still talk about burns and laps, it cannot hear when a feature's agent is waiting for an answer or declares ready, and it can message a feature's agent but cannot read what the agent said back.

## Approach

**For the human.** There is one project chat, and it is always the orchestrator. The Orchestrator setting and the "Orchestrated" tag are gone. The human asks for anything in the project chat ("check on the redesign features", "start them all", "merge the sidebar one"), and the orchestrator does it on any feature, as far as they asked (decision 2). For a larger piece of work it still agrees with the human first how the work is run (decision 11), writes that into every brief, and works within it. It gathers what needs the human into one message (decision 9). When it routes a request differently from how it was put, because several features would otherwise edit the same shared thing, it says where the change goes and why before it acts (decision 7). It leaves a feature alone while the human is using that feature's chat (decisions 6, 14). Its messages show in a feature's chat as the orchestrator's (decision 13). The human stops it by telling it to, or by ending the project chat (decision 4).

**The project session's launch** (launcher, artifacts). Every project session launches as today's orchestrate session does: prompts off (decision 1), the message waiter hook, the orchestrating briefing, and the catch-up list of what happened on its followed features since the last project session ended. The notes-triage launch is the same session with its triage errand added. The `orchestrate` session purpose goes. Old session rows that carry it are migrated to no purpose. A project still has one live project session at a time (the launch already refuses a second one), so there is never a question of which chat hears the news.

**The acting tools** (MCP). The gate becomes "the caller is a live project session of this project". The setting check and the ownership check go, and each tool keeps the refusals its service already has (a draft waiting on a dependency, a drive already running, a merge conflict). `take_over_feature` and `record_test_note` are removed (decision 5). `start_feature`, `plan_feature`, `stop_feature_run`, `drive`, `merge_feature` and `add_to_brief` stay, with their descriptions brought up to date: no "Orchestrator only" or "you own", no planning phase, rounds rather than burns. Two tools change:

- `send_to_feature({ slug, message, relaysHuman? })` delivers through the lead delivery as today, but the delivered text opens with a line saying it is from the project's orchestrator (decision 13). With `relaysHuman: true` that line says instead that it relays the human's own answer. Either way it still counts as a human message for the Stop and dispatch checks.
- `read_feature_chat({ slug })` is new. It returns the last turns of the feature's main chat, capped, plus the transcript path, through the existing main-chat excerpt service that side sessions use. With no chat on disk it returns no quote, with a reason.

`get_feature_context({ slug })` gains when the human last typed in that feature's chat (a typed turn, not a message from `send_to_feature` or runcastle). The orchestrator reads busy as "within the last 30 minutes, or the agent is mid-turn on it" (decision 14).

`create_feature` from a project session runs as the orchestrator, so its events carry `actor: 'orchestrator'`. The other acting tools already do.

**What the orchestrator hears** (notifier, catch-up). A feature is **followed** when it is not shipped and at least one of its events carries `actor: 'orchestrator'` (decision 3). This is computed from the events table, and nothing is stored on the feature. Followed replaces "orchestrated" everywhere the notifier and the catch-up asked it. The line kinds:

- END lines (also listed in the catch-up): a self-planning or headless run ended; a round finished or failed; a review ticket finished or failed; the feature's agent waits for the human, with its reason (`feature.waiting` with a non-null reason); the agent declared ready (`feature.ready_declared`); a merge landed or conflicted; a drive's dev server failed. When a self-plan end and the waiting reason it sets arrive together, they go as one line.
- ACT lines (the human did something on a followed feature): a chat with a terminal opened or ended, a drive started or stopped. Lines for things the orchestrator's own call already returned are still dropped.

The wording speaks of rounds, and drops laps, burns and Go. The setting-off stop line goes.

**Data.** One migration drops `projects.orchestrator` and `features.orchestrated`, and clears `sessions.purpose = 'orchestrate'`. `markOrchestrated`, the `feature.orchestrated` event, the settings key, its project override and its web field all go. The feature index line loses its "· orchestrated" mark.

**Web.** The settings page loses the Orchestrator switch. The feature page header loses the Orchestrated tag. The sidebar row's unused second-ring prop (`glyphRing`) and the preview sample data go. The Orchestrator card's hover text says in one plain sentence what the project chat is: it plans, starts, messages and merges features when you ask, and it edits this repo and runs commands without asking (decision 1).

**The skill** (the project pack's SKILL.md). The conditional "Orchestrating" section becomes the project session's standing guidance, merged with the rest. The heading "Orchestrating" stays, because the briefing names it. The skill text is where decisions 2, 6, 7, 8, 9, 10, 11 and 14 live, as judgement and not as task rules:

- the line on what it may act on: what the human asked, as far as they asked, or a cut's agreement;
- one place for a shared thing, and saying so before acting;
- telling the human what they are looking at when they judge one part;
- gathering interruptions;
- weighing machine cost when setting many features working;
- the working agreement and what it says about merging;
- when a feature is busy, and how a cut survives the human stepping in.

The rules that only made sense without the tools go or are rewritten: "never launch what you create", "you have no tool for an existing feature's change", the five-destination routing's "tell the human to open it", and "Never advance a phase". The remaining phase, lap, burn and Go wording in the skill is brought up to date in the same pass.

## Seams

- **MCP tool calls from a project session** (existing): call `send_to_feature`, `merge_feature`, `start_feature`, `plan_feature`, `drive`, `add_to_brief`, `create_feature` and the new `read_feature_chat` as a project session, on features it did and did not create. Observe each succeeds or refuses only where the service refuses. `take_over_feature` and `record_test_note` are not registered. `toolsForAudience('project')` is the assertion point.
- **`orchestratorLineFor(event, state)` and `orchestratorCatchUp(ctx, project)`** (existing, pure plus one query): feed events and observe which become lines. Followed vs not followed, `feature.waiting`, `feature.ready_declared`, the merged self-plan line, and no stop line.
- **`launchProjectSession`** (existing): observe that every project launch, triage included, gets `bypassPermissions`, the message waiter, the orchestrating briefing and the catch-up, and that no session row gets purpose `orchestrate`.
- **The migration** (existing pattern in the migration tests): an existing database keeps its features, projects and sessions, with the two columns gone and old `orchestrate` purposes cleared.
- **The shipped skill text** (existing pattern in the orchestrator skill test): pin the wording that carries the decisions and the tool list.
- **Web components** (existing): the settings page renders no Orchestrator field, the feature header renders no tag, and the Orchestrator card's title carries the warning.

## Out of scope

- Relaunching the orchestrator headless when it is not live (rejected in whole-cuts-plan-themselves; reopen only if the human asks).
- Designs made while the human is away (*Designs wait for you*).
- A combined preview of several unmerged features (decision 8). It would be its own feature if wanted.
- A stop control, a follow list, or a cap on how many features run at once (decisions 4, 15, 10).
- Removing the `relay` and `start-lap` session purposes. Nothing launches them any more, but they are feature-lead leftovers, not orchestrator machinery. Their notifier lines go here. The enum values and launch paths can go in a later cleanup.
- An ADR recording that the mode is gone. The project session writes it after merge.

## Open questions

- Whether "you decide" in the working agreement should include merging (decision 11, challenged).
- Whether the project chat should keep permission prompts for shell commands and edits (decision 1, challenged).
