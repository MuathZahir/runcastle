## Why

This replaces the draft "Ownership is a label", which is now superseded.

On 2026-11-13 the human named the real source of runcastle's ownership machinery: you can hand a single feature to an orchestrator chat. That one ability creates everything below:

- each feature having its own owner;
- the tool that takes a feature (`take_feature`) and the "who finishes it" choice;
- owners flipping by themselves when a human decision comes up (ADR-0021 §5);
- the "one place to answer" exceptions;
- refusals from the holding code (`packages/server/src/services/holding.ts`, `requireHold` and `requireMayMessage`, about 40 sites);
- the startup repairs (`moveOwners`, `moveHumanFinishes`, `sweepHolders`).

The human had to remember who ran each feature. The status was often wrong, tools were refused, and they got bounced between chats.

The human's goal: "I don't have to manage the features. When autopilot is on, I can go sleep." Also: "it should be very obvious when the user has to go to the orchestrator and when to the feature agent."

## What the human agreed

- **Autopilot is one switch per epic.** An epic is an orchestrator chat plus the features it created. There is no per-feature ownership any more.
- **Autopilot off is the default.** Every feature is the human's. They talk to it in its own chat. The orchestrator creates features and links the human to them. It doesn't message features or answer for them.
- **Autopilot on.** The epic chat is the only place the human talks.
  - The epic's features work for the orchestrator.
  - Their questions for the human, their "ready to test" and their merges all come to the epic.
  - The human can open a feature's chat and watch, but can't type there. A note says the epic is on autopilot and links to the epic.
- **How far it goes is whatever the human says in the epic.** It doesn't have to merge. "Build them and show me the screenshots" is a valid instruction. There is no separate "finish" setting.
- **Only the human turns it off.** A question only the human can decide does not end autopilot. It waits in the epic while the other features carry on. The orchestrator still never makes the human's decisions; overnight, that feature just waits.
- **Turning it off returns every feature to the human.** Each lead is told, and each feature's chat opens for typing again.
- **It must be very obvious.** In the sidebar, the epic and its features look distinct, "cool and maybe futuristic" in the human's words. The look stresses that the features are locked and being worked by the orchestrator. An autopilot feature shows no "needs you" of its own; the epic shows it. Design it in design mode with the human.
- **Switched through the chat.** The human said: "all of that should be through the chat. No separate button." The orchestrator calls a tool when they say "go on autopilot" or "stop". The orchestrator's view on the open part is below.

## Open: a way out when the orchestrator can't answer

Chat-only has one gap. If the orchestrator chat can't take a turn, a chat-only switch can't be turned off. That happens with a usage limit (common overnight), a crash, or a very long turn. The human wakes up, wants to work on one feature, and it stays locked for hours. The orchestrator recommends:

- the chat is the way on and the usual way off;
- the lock note in a locked feature chat also carries an "end autopilot" link, which works without the orchestrator.

That is not a button in the main UI, only an escape hatch where the lock is. The grill settles it.

## Other things to settle in the grill

- **Which features belong to the epic.** Recommendation: the ones it created, plus any the human tells it to add ("also run X"). Features created during autopilot join it.
- **What the lead's reply goes through.** Under autopilot, a lead tells its epic by tool call (today's handback). Off autopilot, it talks to the human in its chat.
- **Orchestrator messages say which chat sent them.** Add the epic's name to the "From the project's orchestrator" prefix.

## What it deletes

Delete these rather than wrapping them:

- per-feature ownership (`held_by`) and the tool that takes a feature (`take_feature`);
- the finish choice;
- the automatic flip;
- the hold refusals;
- the startup owner repairs;
- the held-news and "With <chat>" leftovers that "Needs you is the agent's call" doesn't already remove.

Rewrite charter decision 18, ADR-0016 and ADR-0021. The project session writes the charter edit at merge.

## What it must not swallow

- The status model belongs to "Needs you is the agent's call", which this feature waits on.
- The broader skill rewrite belongs to "Skills become short rules". Update here only the skill lines that describe ownership.

Planning mode: grill with you

## Added by the orchestrator, 2026-11-13

## 2026-11-13: autopilot is flexible, and the orchestrator proposes how to run it

The human agreed everything above, including the "end autopilot" escape link in locked feature chats. They added that what the orchestrator does on autopilot is flexible and depends on what they ask: "if the epic is simple, I could just tell the agent, complete the whole thing until it's ready to merge. So it would go through the features, answer all the decisions, make the features plan themselves. But if the agent thinks one of the features might be complicated and will need my grill, then it would suggest that... it will finish the features that it can and leave the feature that needs my grill till I come... the agent should give the user the best way to go about things."

What follows from this:

- **The orchestrator proposes a run plan before going on autopilot.** For each feature it says whether it will plan itself and get built, or wait for the human's grill, and why. For example: "A and B I'll take to ready to merge; C changes how billing works, so I'll leave it for your grill." The human says yes or adjusts it in the chat. That proposal is the agreement. Nothing about it is fixed in machinery.
- **The human can hand over their decisions.** When the human says "do the whole thing", the orchestrator answers the feature leads' decisions in their place. This turns charter decision 9 ("the human makes every decision") from an absolute into a default: the human decides unless they hand decisions to an autopilot. The project session rewrites decision 9 at merge.
- **Every decision made for the human is recorded and shown.** It is marked "decided by autopilot" in its feature's decisions.md. On waking, the human gets one summary in the epic, with links, so they can reverse anything before merging.
- **Hard limits stay, even when decisions are handed over.** This is the orchestrator's recommendation, to settle in the grill. The orchestrator still stops and waits for anything that costs money, adds an account or setup step for the human, risks losing data, or can't be undone. It also waits on anything the human named as theirs. The feature carries on around the wait where it can.
- **Leads accept the orchestrator's answers on autopilot.** Today the feature skill tells a lead to refuse an orchestrator's yes on designs and behaviour and wait for the human's own words. On autopilot with decisions handed over, the orchestrator's answer counts. Off autopilot, nothing changes. Only the skill lines that say this change here. The broader rewrite stays in "Skills become short rules".

## Added by the orchestrator, 2026-11-13

## 2026-11-13: the epic grill stays

The human: "the orchestrator obviously should grill the user on the epic so that it understands the best way to cut it — that doesn't change." Autopilot comes after the shape grill and the cut, never instead of them. The order is: the grill, the cut into features, the orchestrator's proposed run plan (which features it can finish, which wait for the human's grill), the human's yes, then autopilot. Handing over decisions covers the feature-level decisions that come up later. It never covers the grill that shapes the epic.
