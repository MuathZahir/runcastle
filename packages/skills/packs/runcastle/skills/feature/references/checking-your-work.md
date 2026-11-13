# Checking your work

Load this the first time you drive the app to check your own work, and again
when a problem reaches its second or third failed round (SKILL.md, "Own the
work").

## The helper drives, you judge

Every drive to check your work, the first one included, goes to a helper: one of
your own subagents (the Agent tool in Claude Code, `spawn_agent` in Codex), not a
runcastle worker. The clicking and the screenshots stay out of this chat; you
keep the report.

- **Its model.** From the human's use-case notes (`annotatedModels` in
  `get_feature_context`): the one whose note fits simple, mechanical work. With
  no notes, name Haiku where the runtime offers it, else the smallest model you
  can name.
- **Its brief.** Where to start, the steps, and what each step should show.
  Start from the feature's own scenario when one can be run here, otherwise from
  the page, route or command. **The helper never edits code** and never decides
  whether the feature is done: it does the steps and reports.
- **How it drives.** A web app: `agent-browser` against your own dev server
  (`open <url>`, `snapshot -i`, `click` and `fill` by ref, `screenshot <path>`
  into a temporary folder, never the repo, and `close` at the end). A
  command-line tool or an API: it runs the commands or requests and keeps their
  output. When nothing can be driven here (no `agent-browser`, nothing to run),
  there is no helper: lean on the project's checks, and say so when you say
  ready.
- **Its report.** For each step: what it did, whether it showed what was
  expected, anything odd, any console or server error, and the screenshot's
  path. Ask for that and nothing more: no summary, no advice.
- **What you open.** The screenshots of steps that failed or look odd, and the
  last screenshot of a drive you are about to call a pass, so a false pass is
  caught. Not the rest.

A screen's look, judged against the design docs, is a screenshot critique loop
(SKILL.md, "Build it the cheapest good way"), not this helper: it only reports
what happened. The same goes for designing alone (`./planning-alone.md`, "Look
at your own screens"): there a UI subagent judges the pictures and you read
none. Here you judge, so you open the few named above.

## Rounds with a worker

Sending a worker back on a problem counts as a round when its handback's check
still shows it. After the second, your send-back note names the changed
approach, not only the symptom. A worker carries the same rule in its own
briefing: it steps back after its second failed try and stops after its third,
handing back with what it tried.

## The step-back line

One line, before the third try: the problem, that two fixes failed, what they
had in common, and whether you keep the approach or change it, and why. For
example: "Stepping back: the export still drops the last row after two fixes.
Both patched the loop; the page size is read twice. Switching to one paged
query."

## The stop

After the third failed round, start nothing new and send nothing back. Workers
at work on parts that do not depend on the problem finish their assignment;
land their handbacks as usual. Then one message:

- the problem, as the human would see it;
- each try: what you changed, and what its check showed;
- what you think is wrong;
- the direction you recommend, and whether it changes what they get;

then `wait_for_you({ why: "stuck: <a few words>" })`, under an
epic too. Their direction starts the count again.

## How and what

A change of how is yours: tell the human in one line what changed and why. If
it overturns a decision in `decisions.md`, append a decision that supersedes it.
A change of what (SKILL.md, "Own the work", lists what counts) goes to the human
with `wait_for_you`: the problem, the direction you recommend, and what it costs
them. Build nothing of it before they answer.
