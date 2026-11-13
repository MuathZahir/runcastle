# Planning with no human present

Read this when your briefing says no human is present: a run that plans the
feature while the human is away. Every rule in SKILL.md still holds; this page
says only what differs.

**One turn.** Do the whole plan in this one turn. Never end it to ask or to
report progress: nobody replies, and ending the turn ends the run.

**Survey through a subagent.** This chat goes on to build the feature, so send
the codebase survey to one Explore-type subagent with your questions, and keep
the short map it returns. Read a file yourself only to settle one fact the map
left open.

**What, where and who come first.** Check them against the brief: only the
request it quotes and its `## Decided with the human` section count. If any is
open, stop there: write no decisions, spec, designs or plan. Your closing
message says which is open and asks each in full, numbered, with your
recommendation and the real options the survey found, then call
`wait_for_you({ why: "what, where or who is open" })`. When the answers arrive,
record them as the human's (no mark) and finish the plan as below.

**Decide as you would recommend.** Where you would ask the human, take the
answer you would recommend and record it at once with `**Assumed.**` and its
main alternative (`./decisions-and-spec.md`). Record only decisions the human
must see; build detail goes to the spec.

**Check first.** Pick at most five decisions for the human to look at first:
guesses about their intent, and decisions that force several others. Write
their numbers in `decisions.md`'s `Check first:` line and the Plan's `C` list.

**Plan, never build.** Never call `start_worker` or `start_review` here. Write
the docs (`decisions.md`, `spec.md`, `preview.html`) and, where the feature
reshapes screens, design them (below). Write no other code.

**Tools.** A refused tool is no wait: decide without it and put that decision
in check first. A timeout may have landed: check, retry once, and if it times
out again carry on and say so at the end.

**Cards, never the panel.** `show_plan` and `show_design` post cards the human
finds when back; never call `show_panel`.

## Designing alone

Design only when the feature **adds a screen or changes a screen's layout**. A
small visual change (a colour, a label, one control) is described in the Plan
instead. Never design a screen whose what, where or who you guessed.

- **When:** once the decisions are recorded and before the spec, so the spec and
  the Plan can name the designed components.
- **How:** as `./design.md` says: one design page per screen, its states on a
  switcher, sample data, real components, the project's design docs. Design
  against the feature's base branch, never another feature's worktree. If a
  shared component must change, change it and say so at the end.
- **Tweaks:** at most two open choices per screen, on its Tweaks menu; past
  that, pick and list your picks at the end.
- **Look at your own screens:** `start_design_server({ command })`, then every
  state of every page (each `?state=` address). With `agent-browser` on the
  PATH, a subagent on the model the human's notes give UI work opens each, takes
  screenshots to a temporary path, critiques them against the design docs,
  fixes, looks again, and returns its verdict and the final picture's path. Do
  not read the images yourself. Without it, check each page compiles and
  serves, and say you never saw them.
- **Record each page:** `show_design({ path, title, width, picture })` once per
  page, never once per state, with the subagent's picture.
- **A screen you cannot serve** (a page the server builds, native mobile) is a
  hand mock in the Plan; say so at the end.
- **Leave the designs uncommitted:** only the human's approval commits them.
  Commit your docs by path, so nothing designed rides along.

## The end

1. Write `spec.md`, plan the workers you would offer (label, purpose, kind,
   none started; for a small feature, usually you alone), draw the Plan and run
   its self-check (`./preview.md`), commit the docs.
2. Call `show_plan()` once.
3. One closing message: that the plan was made without the human, how many
   decisions it holds and which to check first (number and title), the workers
   it offers and what you would do yourself, and anything that stopped you (a
   refused or failed tool, and what you decided without it). If you designed:
   each screen and its states, the open Tweaks, any shared component changed,
   whether you saw the screens or only checked they compile, and that only
   designs the human approves are committed. End by asking for their yes to
   start the work.
4. Call `wait_for_you({ why: "start the work?" })`, naming any design waiting
   for approval, and end the turn with the question last. **On autopilot** the
   yes is the epic's: call `hand_back({ summary })` instead, with the plan, its
   check-first decisions and any design waiting, and say the plan went to the
   epic.
