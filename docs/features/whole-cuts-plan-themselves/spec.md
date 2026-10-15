# Whole cuts plan themselves

## Problem

"Features plan themselves" proved that a feature can plan itself well enough to approve by looking. But the human still runs every feature by hand: they open each one, click Plan it yourself, read every plan, click every Burn, drive every branch, judge every lap and merge. For a cut of several features, the human is the loop.

The human wants to say what they want once and come back to work in progress. The project session they talk to should run the project the way a senior engineer runs a team of agents: create the features, have them plan themselves, judge the plans, burn, check that the pieces fit together, call the human in to test when their eyes are needed, run more laps, and merge (decisions 1, 2).

## Approach

### What the human sees

**A setting.** Each project has an **Orchestrator (experimental)** setting, off by default (decisions 3, 14). Its description says the orchestrator creates, plans, burns, drives, runs laps and merges by its own judgement, and that it edits the repo and runs commands without asking (decision 10). It takes effect the next time the project session opens. With it off, the project session, Start and Plan it yourself are exactly what they are today.

**The orchestrator is the project session.** With the setting on, opening the project session opens the orchestrator. It grills the human about what they want, as the project session does today, and writes that intent into each feature's brief (decision 16). It creates the features, which become its own (decision 9), and runs them. Nothing about the order of its moves is fixed: whether a plan needs a subagent's review, whether merged siblings need an integration check, when to drive, when to run another lap, and when to call the human are all its judgement (decision 5). It has every click the human has, merge included, and no limits beyond what those buttons already refuse (decisions 4, 6).

**Runcastle tells it what happened.** While it is live, each time something ends on one of its features, runcastle types a one-line message into its terminal naming the feature, what happened and what to read next (decision 11). When the human acts on one of its features, it hears about that the same way (decision 13). When the human reopens the project session after it was closed, its briefing opens with what happened on its features since. Nothing relaunches it by itself.

**It talks to the human in its terminal.** It asks a question only when the answer changes what the human gets and a wrong guess would cost a lap, one question at a time, and it keeps the rest of the cut moving while it waits (decision 12). When it wants the human to test, it starts the drive and says what to try; the human answers in the terminal.

**Its features are marked on the page.** A feature it owns shows an **Orchestrated** marker on its card and its page. Every human button still works on it (decision 13). A headless run it starts on a feature (sending a plan back, planning a lap) shows as working with **Stop**, as a self-planning run does today.

**One move stops it.** Turning the setting off types a message into a live orchestrator telling it to start nothing new, and from that moment its tools refuse to start anything. Runs already going finish or are stopped as today. Telling it to stop in its terminal also works (decision 6).

### What the orchestrator is told

The orchestrator's behaviour is skill text in the project session's skill pack: a section for orchestrating, read only when the mode is on. It describes judgement, not a procedure (decision 5):

- **A senior engineer leading a team.** It does not go into a feature's details unless something needs it. Its attention is on the project as a whole: no conflicts or contradictions between features, the features integrating well, the best tooling for the job, and nothing more complicated than it needs to be (decision 17).
- **Guard its own context.** Reading goes to subagents on a cheaper model: Sonnet through Claude Code's Agent tool, the equivalent smaller model through Codex's `spawn_agent`. Subagents gather context, read a feature's docs, plan and tickets, and read reviews and outcomes. The orchestrator keeps what they conclude (decision 17). After a compaction or a relaunch it reorients from runcastle's record, not from memory.
- **Judging a plan.** It judges against what the human said, which lives in each feature's brief. It sends back a decision that contradicts the human, and settles one the human never spoke to by its own judgement, naming it in its report. It asks the human only on the line decision 12 draws.
- **Sending a plan back** goes to the feature's own planning conversation, with the change and why. That session edits the decision, adds `**Changed by the orchestrator:** <why>` and keeps it `**Assumed.**`, redraws the preview, and reconciles the spec and tickets (decision 16). When the human answered, the orchestrator relays the answer as the human's, and the session removes the marks.
- **Every click is its call.** Burning, driving, starting a lap, merging, and starting a draft that waited on a feature it just merged are all its call. A stopped-short planning run is also a message, and it decides whether to send the run back to work. A run it judges has gone on too long, it stops (decision 15).
- **Merge conflicts** it resolves itself or through a subagent, in the feature's worktree, and then merges again through runcastle. It can also hand the conflict to the feature's own conflict-resolving session (decision 8). It never works in a feature's worktree while that feature has a live session.
- **What is not its.** Features it did not create and was not handed are the human's. It may point out an interaction with them, but it does not act on them (decision 9). When the human hands it one by name, it takes it over with a tool.
- **Reporting.** It tells the human what it did and what it decided in short reports in its terminal. The record of a decision is `decisions.md`, not the terminal (decision 16).

### The shape of it

Everything new is one of three kinds: MCP tools for the project session, messages typed into its terminal, and skill text. The services under each tool already exist.

**The setting.** A per-project setting, `orchestrator`, on the existing settings surface (a per-project override with a default of off). The project session launch reads it.

**The orchestrating launch.** With the setting on, the project session launches with a new project purpose, `orchestrate`, beside the existing `triage`. That purpose:
- changes the permission mode from `default` to prompts off (Claude Code `bypassPermissions`; Codex approvals `never`, with the sandbox posture the existing Windows mapping gives `never`);
- adds the orchestrating section to the briefing and the injected prompt;
- adds the catch-up: the events that ended something on its features since the project's last orchestrating session ended, one line each.

A resumed orchestrator conversation is still `orchestrate`. A launch with the setting off is the project session as today, even when resuming a conversation that was once an orchestrator.

**Ownership.** A feature records whether the orchestrator owns it. It becomes owned when `create_feature` is called from an `orchestrate` session (any shape), or when the orchestrator takes it over with `take_over_feature`. Ownership drives the marker, which features' events reach the orchestrator, and which features its acting tools accept. `get_project_context` marks owned features in its index.

**The tools.** These are registered for the `project` kind. Every acting tool refuses unless the calling session is a live `orchestrate` session, the project's setting is still on, and the feature is owned. Each refuses with a sentence saying why, as the human's buttons do, and adds no rule of its own (decision 6).

| Tool | What it does | Over |
|---|---|---|
| `get_feature_context`, `read_feature_doc`, `list_tickets`, `get_ticket` | The existing feature reads, given a `slug` when called from a project session; reads only, and allowed on any feature of the project | today's reads |
| `take_over_feature` | Marks a feature the human handed it as owned | — |
| `start_feature` | Starts an owned draft (its dependencies merged), with a base branch | `startDraft` |
| `plan_feature` | Launches the feature's self-planning run | the `self-plan` launch |
| `send_to_feature` | Delivers a message to the feature's planning conversation as a headless run (below) | new purpose `relay` |
| `stop_feature_run` | Ends the feature's live headless run | end session |
| `burn_feature` | Burns the feature's pending tickets | `burn` |
| `drive` | Starts or stops a test drive of a feature branch, or a drive of the base branch | test drive, project drive |
| `record_test_note` | Files a test note on a feature, saying whether the human or the orchestrator observed it | test notes |
| `start_feature_lap` | Starts the next lap, planned by a headless run from the review, the notes, and the orchestrator's message | the start-lap launch, headless |
| `merge_feature` | Merges through runcastle: outcome doc, shipped state, worktree clean-up, conflict event | merge, moved from the router into a service both share |
| `add_to_brief` | Appends what the human said later about a feature to its brief | the feature's docs |

`create_feature` keeps its shapes. In an `orchestrate` session it marks what it creates as owned and does not launch anything; the orchestrator calls `plan_feature` when it judges the feature ready.

**Headless runs on a feature.** The self-planning launch gains two siblings that reuse its machinery: headless, no terminal, Stop on the page, an exit event saying whether the run finished, refused while another session is live on the feature.
- **`relay`** resumes the feature's most recent planning conversation by its id with the orchestrator's message as the prompt: Claude Code print mode with `--resume`, Codex `exec resume`. If there is nothing to resume, it starts fresh from the docs with the message, as the chat does. Its briefing says no human is present and that the message is from the orchestrator. It follows the change-handling rules, including the `**Changed by the orchestrator:**` line, unless the message relays the human's own answer.
- **A headless start-lap** is the existing start-lap launch run headless. The orchestrator's message and any notes it filed seed the lap's agenda as test notes do today, and the lap plans itself through tickets as a self-planning run does.

A session row records that it runs headless, so the page, the chat refusal and the exit handling key on "headless", not on the `self-plan` purpose alone.

**Messages into the orchestrator's terminal.** A notifier subscribes to the live event bus. For an event on an owned feature that ends something, while the project's `orchestrate` session is live, it types one line into that terminal through the same live-terminal write the chat briefing uses, and submits it. The events that count:
- a headless run ending, finished or stopped short;
- a burn finishing or failing;
- a review or verification pass finishing;
- a merge conflicting or landing;
- a drive starting, failing or stopping;
- a human-started session opening or ending on the feature;
- a human click on the feature (burn, merge, drive, Start lap).

Lines are prefixed `[runcastle]`. Events the orchestrator's own tool call just caused, and answered in that call's result, are not repeated. Turning the setting off types the stop line. Delivery is best-effort, as the chat briefing's is. The catch-up briefing covers anything missed while the orchestrator was down.

**The page.**
- The settings page gains the toggle.
- An owned feature's card and page show the Orchestrated marker.
- The next-step resolver's planning-itself bar and stopped-short bar are keyed on a headless run, so a `relay` or headless start-lap run reads as working with Stop.
- A started feature with nothing planned keeps today's Plan it yourself entry.

### Both CLIs

Claude Code and Codex can both orchestrate, on whichever runtime the project session's model belongs to (decision 14). The build checks both:
- the orchestrator launch with prompts off;
- a `relay` run resuming a conversation headless;
- a typed message reaching a busy session and an idle one;
- a cheaper-model subagent spawned from the skill text's wording.

## Seams

- **The project session launcher with spawning off** (existing). Observable: launching with the setting on gives the session row the `orchestrate` purpose, the prompts-off mode in the rendered command for each runtime, and a briefing carrying the orchestrating section and the catch-up lines. Launching with it off is unchanged.
- **The runtime launch description** (existing). Observable: the headless resume argv with a message for each runtime (`relay`), and the prompts-off posture for an `orchestrate` launch. Interactive launches are unchanged.
- **The MCP tool functions** (existing seam, new tools). Each `tool*` function is called directly with a context and a session row. Observable: ownership marking on create and take-over; every acting tool's refusal when the session is not `orchestrate`, the setting is off, or the feature is not owned; and each tool reaching its service (`plan_feature` → a `self-plan` session row, `send_to_feature` → a `relay` row, `merge_feature` → shipped and the outcome doc, the same as the router's merge).
- **The notifier** (new, at the highest point: a pure function from an event plus the project's state to an optional line, wired to the bus and the terminal write). Observable: which events on which features produce a line, the line's text, nothing for non-owned features or a non-`orchestrate` session, and the stop line when the setting turns off.
- **The briefing renderers** (existing, pure). Observable: the orchestrating section, the catch-up list, and the `relay` and headless start-lap briefings, spelled per runtime.
- **The process exit handler** (existing). Observable: a `relay` or headless start-lap run's exit event saying whether it finished.
- **The next-step resolver** (existing, pure). Observable: the working bar with Stop for any headless run, the stopped-short bar after one, and unchanged bars for a human-run feature.
- **The skill pack** (existing content). The project skill's orchestrating section, the change-handling skill's `**Changed by the orchestrator:**` rule, and the `relay` briefing are content. They are checked by reading them against decisions 5, 8, 12, 15, 16 and 17, and judged at the test drive.

## Out of scope

- The draft "Self-planning polish": Plan it yourself as the default, "plan the rest yourself" mid-grill, the check-first and Chat-tab observations, thin Codex plans, the ruling on Codex unsandboxed for ordinary sessions, and the page's self-planning entry for an abandoned grill (decision 15).
- Relaunching the orchestrator by itself when it is not live (decision 11).
- Acting on features the orchestrator did not create and was not handed (decision 9).
- Hard limits on spend, laps, concurrency or merging red (decision 6).
- The charter's record that "human-in-the-loop only at the two ends" now has an experimental exception. The project session writes it.
- The preview's form and its place on the page, owned by Plan preview.
- Showing a headless run's output while it works.

## Open questions

- **Typing into a terminal the human is typing in.** A message arriving while the human has a half-typed line will join it. Accepted for an experiment. The drive should show how often it happens, and whether the orchestrator recognizes a mangled line.
- **Codex's cheaper subagent model.** Whether Codex's `spawn_agent` takes a model, and which smaller model is the equivalent of Sonnet, is checked in the build. If it takes none, the skill text says so and the orchestrator delegates on its own model.
- **Long-lived context.** An orchestrator running a whole project will compact. The skill text tells it to reorient from runcastle's record. Whether that is enough is judged at the test drive.
- **Cost.** A cut of several features runs several planners and burns at once, with no cap (decision 6). The first real cut is the measurement.
