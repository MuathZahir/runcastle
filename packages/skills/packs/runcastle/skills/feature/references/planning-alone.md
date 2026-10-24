# Planning with no human present

Load this when your briefing says no human is present: a headless run that
plans the feature while the human is away. With a human in the chat, grill them
instead (`./grilling.md`); nothing here binds that conversation.

You still look facts up, model the domain and park scope creep as
`./grilling.md` says. What changes is who answers.

**This run plans; it does not build.** Never edit code, never install, and
never call `dispatch_round` in this run, whatever the plan says: no round starts
without the human's yes. You write the feature's docs (`decisions.md`, `spec.md`, `preview.html`)
and, when the work is worth handing to workers, its tickets — nothing else.

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
- **No design.** Never open a design (`./design.md`): nobody is there to look.

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
   of tools and connectors the plan did not need. Close the message by asking
   the human for their yes to start round 1 (or to start the work, if there are
   no tickets).
6. Call `mcp__runcastle__wait_for_you({ why: "start round 1?" })`, then end the
   turn. The human answers in this chat when they are back; their yes is what
   starts the work, in a later turn.
