# Epics on autopilot

## Problem

The human can hand a single feature to an orchestrator chat. That one ability grew a
pile of machinery: each feature has its own owner, a tool takes a feature, a "who
finishes it" setting, owners that flip by themselves when a question comes up, refusals
when the wrong chat acts, and startup repairs that move owners around. The human has to
remember who runs each feature, the status is often wrong, tools get refused, and they get
bounced between chats.

What they actually want is two modes: "I work on these features myself", and "run this
epic while I sleep". And at every moment it must be obvious where to go: the feature's
chat or the epic's.

## Approach

**For the human.** Every feature is theirs by default, worked in its own chat. When they
tell an epic (an orchestrator chat plus the features it created) "go on autopilot", after
the epic's grill, its cut, and their yes to the orchestrator's run plan, the features in
that run plan lock: their chats can be watched but not typed in, their acting buttons go,
and a lock note links to the epic. The epic chat becomes the only place the human talks.
Leads report to the orchestrator; the orchestrator answers what it can (all of it, if the
human handed over their decisions, within the hard limits) and asks the human only what it
cannot. The sidebar makes autopilot epics and their locked features look distinct. The
human ends autopilot by saying so in the epic, or with the "End autopilot" link in any
locked feature's lock note, which works even when the orchestrator cannot take a turn.
On waking they get one summary of what was decided for them, with links.

**The shape.**

- **State.** Two facts replace ownership. On the epic (the orchestrator chat's session):
  whether autopilot is on. On the feature: whether it is in its epic's run. A feature is
  locked exactly when it is in the run and its epic is on autopilot. The feature's epic is
  the chat that created it (the existing link from a feature to the chat that cut it);
  "also run X" re-points that link. The `held_by` and `finish` columns are dropped by a
  migration; every epic starts with autopilot off (decision 21).
- **One check replaces the hold refusals.** The holding service (`requireHold`,
  `requireMayMessage`, owner writes, owner reads, the three startup repairs, the
  automatic flip on `wait_for_you`, the take-on-typing hook) is deleted. In its place, one
  small function answers "may this orchestrator chat act on this feature?": yes for
  creating, starting, planning, reading, editing a draft's brief and dependencies on the
  epic's own features; yes for messaging a lead, stopping a run, driving and merging only
  when the feature is locked to that epic. The orchestrator's acting tools call it.
- **Orchestrator tools.** `take_feature` is deleted. A new tool turns autopilot on for the
  calling epic with the list of features it runs, adds or removes features from the run,
  and turns it off. Its description says it is called only on the human's words, after the
  human agreed a run plan. `send_to_feature` opens with the epic's name (decision 22).
  `create_feature` loses the "run it for me" answer; a feature created while the epic is on
  autopilot joins the run.
- **Leads.** A locked lead's `get_feature_context` header says "on autopilot · <epic>"
  instead of an owner. On autopilot the lead's `hand_back` goes to the epic, and a
  `wait_for_you` it calls anyway is delivered to the epic in the same way, setting no
  need on the feature. Off autopilot, `hand_back` to an orchestrator is refused with a
  pointer to `wait_for_you`. Events with no agent behind them (a dead lead run on a locked
  feature) are delivered to the epic as a message.
- **Turning off.** The tool and the "End autopilot" link call the same service function:
  it clears the epic's switch and every feature's membership, emits one event, prompts
  each locked lead once ("this feature is the human's again; re-ask any open question with
  wait_for_you"), and tells the orchestrator. Taking back one feature does the same for
  that feature only. Nothing running stops. Turning on (or adding a feature) is the
  mirror: a wait already open in a joining feature's chat is closed and its lead is told
  to re-ask through the epic.
- **Usage limits.** No machinery: the human's "carry on after a usage limit" setting
  rules on autopilot as everywhere else. The project skill tells the orchestrator to say
  in the run plan when that setting is off, so a limit overnight pauses the run (decision
  23).
- **Several epics.** Any number of epics can be on autopilot at once. Moving a feature
  into another epic is refused while it is locked to its current one.
- **The human's typing.** The hook that today takes a feature when the human types in its
  chat is replaced by a refusal: the web app shows no message box on a locked chat, and
  the server refuses a message sent to a locked lead or its workers from the human side.
  Worker chats of a locked feature lock the same way.
- **Web.** The owner crumbs, the owner control, the owner strip and the owner reading
  helper are deleted. The sidebar gains the autopilot look on the epic card and its
  locked feature rows (designed: "Sidebar on autopilot"). A locked feature's page shows
  "<epic> · Autopilot" in its header trail, hides Stop, Test drive, Merge and design
  Approve, and swaps the message box for the lock note (designed: "Feature chat on
  autopilot"). A locked feature's row shows Working, Idle or Merged, never Needs you; the
  epic's row carries the orchestrator's own need.
- **Decisions handed over.** Purely skill guidance, no machinery: the orchestrator records
  each decision it makes for the human in the feature's `decisions.md` as
  `**Decided by autopilot.**`, approves designs with `set_design_state` (which records
  the approver as the epic, shown as "approved by autopilot" in the Design tab), keeps to
  the hard limits (decision 18), and posts the one summary (decision 19). Without
  handed-over decisions it links the human to the locked feature's plan or design and
  relays their answer marked as the human's own words, which the lead accepts (decision
  25). The run plan states the order features run in, any dependency between them, and
  how many run at once within the existing worker limits.
- **Skills, ownership lines only.** The feature skill's "Talk to your owner" section
  becomes two cases: off autopilot the human, with `wait_for_you`; on autopilot the epic,
  with `hand_back`. Its rule refusing an orchestrator's yes on designs and behaviour gains
  the autopilot exception (decision 12). The project skill swaps owned features, finish
  choices and taking for: the run plan, the autopilot tool, the hard limits, the summary,
  and "off autopilot, create and start, nothing more". The intake reference loses "run it
  for me". The broader rewrite stays with "Skills become short rules".
- **Records.** A new ADR supersedes ADR-0016 (threads hold features) and ADR-0021 (one
  place to answer). Charter decisions 9 and 18 are rewritten by the project session at
  merge; this feature's outcome says what they should say.
- **Scenarios.** The two epic scenarios that exercise owner flips and owner crumbs are
  rewritten: one epic on autopilot with locked features, one needing you, one feature left
  for the human's grill; and a feature returned when autopilot ended.

## Seams

- **The autopilot service** (new): turn on with a list, add, remove, turn off; and the
  "may this chat act on this feature" check. Observe the stored switch and memberships,
  the event it emits, and the prompts it sends to leads and the orchestrator. Unit-tested
  against the database like the holding service was.
- **The orchestrator's MCP tools** (existing seam): with autopilot off, messaging, stopping,
  driving and merging an epic's feature are refused, while creating, starting and planning
  pass; with it on, they pass for that epic's run only. `take_feature` is gone.
- **The lead's MCP tools** (existing seam): `get_feature_context` reports autopilot;
  `hand_back` and `wait_for_you` route to the epic on autopilot and set no need on the
  feature; off autopilot, `wait_for_you` sets the need as today.
- **The hooks route** (existing seam): a human message to a locked lead or worker is
  refused; nothing changes owner on typing.
- **The feature list over tRPC** (existing seam): each feature carries whether it is
  locked and its epic's name; each epic carries whether autopilot is on. The web reads
  only these.
- **The web components** (existing seam, the two design pages): the sidebar's epic card
  and feature row in their autopilot states, and the feature page's lock note, header and
  hidden actions; component tests on the lock note's links and the confirm.

## Out of scope

- The status model ("Needs you", Working, Idle, Merged): it belongs to "Needs you is the
  agent's call", already merged.
- The broader skill rewrite: "Skills become short rules". Only the ownership lines change
  here.
- Editing `CONTEXT.md`: the project session writes charter decisions 9 and 18 at merge.
- Any per-feature autopilot switch or button in the main UI.
- Scheduling (e.g. "start at midnight"), quiet hours for pings, or cost budgets for a run.

## Open questions

- A lead's permission prompt or question box on a locked feature waits on a human click
  that the lock forbids. Leads run without permission prompts today, so the plan lets the
  click through and shows it as the epic's need; the build confirms leads never raise one.
