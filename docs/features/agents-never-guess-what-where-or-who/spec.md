# Agents never guess what, where or who

## Problem

The human says "we need to track something", gives no how or where, and an agent decides on its own that it is a dashboard on the settings page and starts drawing it. The human then has to notice the guess, undo it, and explain what they meant. The behaviour is written into the agents' instructions: a lone planning run accepts its own recommendations and designs screens, a feature's lead offers a live design in its first reply, and the orchestrator may cut a feature after one answered question of any kind. The human wants to stay the CEO: every important decision is theirs, and they always know what is going on.

Separately, the button and the planning mode called "Plan it yourself" do not say what they do; users will not know it means "an agent plans the feature without you and shows you the plan".

## Approach

**For the human.** Before any agent creates, plans or designs something, it can say three things from the human's own words: what they get, where it lives, and who sees it. When it cannot, it asks first, with a recommendation. A vague request to the orchestrator gets two or three questions before any feature exists; a concrete one (a bug with a repro, a named tweak) gets none. A feature's lead offers a live design only once the three are settled. A lone planning run that finds one open stops, asks it in full in its chat, and finishes the plan by itself once answered. Workers follow the same rule. Everything below the three (wording, layout details, edge cases) stays the agent's to guess and the human's to correct.

"Plan it yourself" becomes **Plan automatically** everywhere the human reads it, and every label describing that mode uses the same name ("Planning automatically", "automatic planning run", "Planned automatically — the plan is finished", "Planning mode: automatic").

**The shared statement.** One paragraph, identical word for word in four places: the orchestrator's skill, the feature lead's skill, the lone-planning reference, and the worker's briefing (decision 12). Its working text, to be tightened in the build but kept to this content:

> **Never guess what, where or who.** Before you create, plan or design anything, you must be able to say three things from the human's own words: what they get, where it lives (wherever they or their users meet it: a page, a command, a notification, how an agent behaves) and who sees it. One is settled when the human said it, or when what they said allows only one reasonable reading; who sees it is settled when the project has one kind of user. A brief settles them only in the human's words, never in another agent's reading. If any is open, ask before you go on, with your recommendation; when in doubt, ask. When the human says one is your call, say your pick back in one line. This holds whenever something new appears, mid-build too. Below these three (wording, layout details, edge cases) you may decide and be corrected.

Each place then adds only how it applies there:

- **The orchestrator** (its skill's intake reference, the shape-grill step). The rule "propose no cut until the human has answered at least one question" is replaced by the three-things test per feature in the cut (decision 16). The shape grill asks the open ones of the three first. Each answer goes into the feature's brief under `## Decided with the human`, in the human's words (decision 18). The planning choice offers **Plan automatically** only for features whose three are settled (decision 3); its recommendation text and examples are reworded for the new name, and the line that weighs "a needless grill" against "one plan it yourself" goes. A "you decide" counts only in the human's own words or a relay of them (decision 11). The project skill's other mentions of the two modes follow the rename.
- **A feature's lead in a live chat** (the feature skill and its design and grilling references). The grill opens with whichever of the three is open. The design reference's "offer it in your first reply" becomes "offer it once the three are settled"; opening a design when the human asks to see something stays (decision 4). When new scope appears mid-build, the lead applies the test before building it (decision 20).
- **A lone planning run** (the lone-planning reference, the self-plan kickoff and the "Your task" line the server writes). After reading the brief and surveying the code, and before its first question round, it checks the three. If any is open, it writes no decisions, spec, designs or plan; its closing message says planning stopped because that one was open and asks each open one in full, numbered, with a recommendation built from the survey; it waits with `wait_for_you` (kind `answer`), or hands back when an orchestrator chat owns the feature (decisions 13, 17). When the human answers, the lead records the answers under `## Decided with the human` and finishes the plan as automatic planning does (decision 14). "Designing alone" never draws a screen whose what, where or who is a guess (decision 5). Its question rounds, challenger and check-first list are unchanged.
- **A worker** (its briefing, written by the server). The statement is added to the briefing. A worker its lead started hands back to the lead with the question; a worker the human started with no assignment asks the human in its chat (decision 15). The review worker's briefing is untouched.

**The rename** touches only text the human reads or an agent is told to repeat; identifiers stay (`planning: 'self'`, `purpose: 'self-plan'`, `plan_feature`, the `session.self_plan_ended` event, the `planning-alone.md` file name). The places, by kind:

- The app: the Start-agent button and its tooltip, the draft's next-step action and its description, the status-line label, the activity-feed labels.
- The server: the planning line appended to cut features' briefs and the `planning` parameter's description; the orchestrator tool descriptions for `plan_feature` and `stop_feature_run`; the lead's "Your task" line and kickoff for a lone run; the thread name; the stop notices; the "cut it to plan itself" holding text; the launch event summary.
- The skill pack: every human-facing mention of the two modes in the project and feature skills and their references, including the orchestrator's question wording (**Plan it with me** or **Plan automatically**, decision 7).

Old briefs carrying "Planning mode: plans itself" keep working: the server only checks that some "Planning mode:" line exists, to avoid adding a second one.

## Seams

All existing except the first.

- **New: the shared-statement test.** Reads the four places and asserts each carries the statement paragraph, and that all four copies are identical. Lets you observe drift.
- **The skill text tests** (orchestrator skill, feature skill, preview skill). They pin phrases from the intake reference, the project skill, the lone-planning reference and the design reference; update the renamed phrases and add assertions for the new per-place rules (the floor's replacement, the lone run's stop, the design offer's timing). The feature skill's global scans (no build-era words, no repo paths) must still pass.
- **The server's prompt and briefing tests** (launch artifacts, kickoff, holding, thread naming, self-plan launch, worker briefing). They observe the exact lines a session is started with.
- **The web's unit and component tests** (the start-agent buttons, the self-plan next step, feature dependencies, the status line, the activity feed). They observe the labels the human sees.

## Out of scope

- Who owns a feature, where the human answers, and what the orchestrator relays: the sibling feature "One place to answer".
- What news reaches the orchestrator: the sibling "The epic hears when its features merge".
- Any other change to how a lone planning run works (question rounds, challenger, check-first list).
- Any server check or new machinery enforcing the rule; this is instruction text.
- The charter (`CONTEXT.md`) mentions "a self-planned feature" once; only the project session writes it, so it is left for that session.
- Historical feature docs, and internal identifiers.
- Re-checking features already cut or planned (decision 21), and the backlog draft's "make Plan it yourself the default" item, which the orchestrator will raise.

## Open questions

- The human confirms the name (decision 7) and the matching labels (decision 8); the build uses them as written until then.
