# Planning with no human present

Load this when your briefing says no human is present: a headless run that
plans the feature while the human is away. With a human in the chat, grill them
instead (`./grilling.md`); nothing here binds that conversation.

You still look facts up, model the domain and park scope creep as
`./grilling.md` says. What changes is who answers.

**This run plans; it does not build.** Whatever the plan says,
never call `dispatch_round` in this run: no round starts without the human's
yes. You write the feature's docs (`decisions.md`, `spec.md`, `preview.html`)
and, when the work is worth handing to workers, its tickets. The one exception
is designing its screens (**Designing alone**, below): for that, and only that,
you may install dependencies and write components, preview pages and sample
data. Write no other code.

- **One turn.** Do the whole plan in this one turn. Never end the turn to ask a
  question or to report progress: nobody will reply, and ending the turn ends
  the run.
- **Frontier rounds.** Work in question rounds. A question round is every open
  question that does not depend on an unanswered one. Write each as you would
  put it to the human, with your recommended answer and the main alternative,
  then accept your own recommendations and record them. Then ask what those
  answers opened: that is the next question round. Write each to
  `decisions.md` as it is decided (`./grilling.md`, the `**Assumed.**` shape),
  not at the end, so a run that dies keeps what it had.
- **Depth rule.** Record a decision only if it changes what the feature is or
  does for its users, or the human might reasonably overturn it. Anything an
  engineer would settle while building (wording, internal formats, test
  coverage) is not a question; it goes to the spec as detail.
- **Exactly one challenger.** When a question round would be empty, run one
  separate agent: the Agent tool in Claude Code, `spawn_agent` in Codex. Give it
  only the brief and `decisions.md`. Ask it for (a) design branches never asked,
  within the depth rule, and (b) decisions it would have made differently, with
  its reason. Do not tell it what you expect to hear. Ask its branches as one
  more question round and decide them, with whatever they open. A decision it
  disagrees with gets a `**Challenged:**` line with its reason, and your own
  answer stands. There is no second pass. If you have no tool that runs a
  separate agent, challenge your own plan as a separate pass and write in
  `decisions.md` that the challenge was not independent.
- **A refused tool is not a wait.** If a tool is refused, do not retry it and do
  not wait: decide on what you know, and treat that decision as one to check
  first.
- **A timed-out tool is not a refused one.** A timeout is no answer, and the
  call may have landed anyway. Retry it once, checking first that it did not
  land: before repeating `emit_tickets`, `update_ticket` or `cancel_ticket`,
  read `list_tickets` and send only what is missing. If the retry times out
  too, carry on and say so in the closing message.
- **Check first.** Pick at most five decisions for the human to check first:
  guesses about their intent the brief did not settle, decisions that force
  several others, and decisions the challenger disagreed with. They open the
  preview's decisions part (`./preview.md`).
- **Design, but never show.** You may design the feature's screens
  (**Designing alone**, below), but never call `show_panel`: nobody is there to
  look, and the human opens the designs when they choose.

## Designing alone

Design when the feature **adds a screen or changes a screen's layout**. A small
visual change (a colour, a label, one control) is described in the plan
instead: it would not repay the install. A feature with no screen designs
nothing.

- **When.** Once the decisions are recorded and before the spec, so the spec,
  the tickets and the preview can name the designed components.
- **How.** As `./design.md` says for an attended chat: the project's own
  install, the project's own frontend dev server, one preview page per state,
  sample data, navigation off, real components, the project's design docs.
  Design against the components on the feature's base branch; never read
  another feature's worktree. If a screen needs a shared component changed, change
  it here and say so in the closing message.
- **Tweaks for taste.** Where a look is genuinely open (two layouts, a density,
  an accent), leave a Tweaks menu on that preview page instead of guessing
  (`./design.md`, Tweaks). **At most two
  open choices per screen**: past that, pick, and list your picks in the
  closing message. Everything the menu needs, the alternative styles included,
  lives in the preview page, never in the app's own files.
- **Look at your own screens.** Call `start_design_server({ command })`, which
  also records the command so the human's Open in design starts it later. Then
  check every preview page. With `agent-browser` on the PATH: `agent-browser
  open <url>`, `agent-browser screenshot <path>` (a temporary path, never in the
  repo), read the image, critique it against the project's design docs, fix it,
  and look again; `agent-browser close` when done. Without it, check that each
  page compiles and serves, and say in the closing message that you never saw
  them. The design server stops by itself when this run ends.
- **A screen you cannot serve** (no frontend dev server you can work out, a
  page the server builds, native mobile) is a hand mock in `preview.html`, as
  any plan draws one. Say so in the closing message. Do not stop or ask.
- **Leave the designs uncommitted.** Never commit a component, preview page,
  sample data or `.runcastle/design.json` you designed: only the human's
  approval commits them. Commit your docs by path, so nothing designed rides
  along.
- **In the preview**, each designed screen is a designed-screen entry
  (`./preview.md`, Designed screens) naming its component file and preview page.
  A ticket that wires one follows `./tickets.md` on designed screens.

## Straight through, then ask

1. Write `spec.md` (`./spec.md`) once the decisions are recorded.
2. Write the tickets if the work is worth handing to workers (`./tickets.md`);
   otherwise the plan says you will build it yourself.
3. Draw the preview and run its self-check (`./preview.md`).
4. Commit the docs.
5. **End with one closing chat message** that covers the plan only: that it was
   made without the human, how many decisions it holds and which are to check
   first (by number and title), whether it is tickets or work you will do
   yourself, and anything that stopped you doing the job (a refused or failed
   tool the plan needed, and what you decided without it). Leave out the state
   of tools and connectors the plan did not need. **If you designed**, also
   name each designed screen, the open Tweaks choices, any shared component you
   changed, and whether you saw the screens in screenshots or only checked that
   they compile, and say that the yes commits the designs as they stand. Close the message by asking
   the human for their yes to start round 1 (or to start the work, if there are
   no tickets).
6. Call `mcp__runcastle__wait_for_you({ why: "start round 1?" })`, or
   `mcp__runcastle__wait_for_you({ why: "designs to look at · start round 1?" })`
   if you designed. With no tickets, say "start the work?" in place of "start
   round 1?". Then end the turn. The human answers in this chat when they
   are back; their yes is what starts the work, in a later turn.
