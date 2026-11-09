# Decisions — The status tells the truth about who and what

Planned without the human (a self-planning run, 2026-11-09). Decisions 1–4 were settled with the human in the orchestrator's chat; the rest are the lead's, marked **Assumed.**

Check first: 6, 7, 8, 10, 13

## 1. Who a wait is for follows the tool the agent used
**Decision:** A lead's `wait_for_you`, and every other wait addressed to the human, always reads as needing the human: Needs you, counts, pings, whether or not an orchestrator holds the feature. "With the orchestrator · …" shows only after the lead hands back to the orchestrator (`hand_back`), until the orchestrator replies. The guess by need kind (`HOLDABLE`) goes.
**Why:** Since leads reach the orchestrator only by `hand_back`, a wait the lead put to the human was hidden from the human for an hour while no orchestrator knew it existed.

## 2. The hour stays as a safety net on a handed-back wait
**Decision:** A handback the orchestrator leaves unanswered for an hour moves to Needs you with its plain words, counts and pings.
**Why:** An orchestrator that never answers must not hide a feature for good.

## 3. A running subagent keeps the feature working for as long as it runs
**Decision:** The 10-minute window applies only to background shell commands (a dev server can run forever). A question still beats running work (asks, `wait_for_you`, declared ready, a reply ending in "?").
**Why:** The runtime now reports subagents apart from commands, so the cap's reason no longer holds for them.

## 4. The fold stays closed while something in it runs, but its line tells the truth
**Decision:** A folded run of work shows a spinner and what is running, e.g. "Subagent running · Build switcher direction mocks". It reads "Worked for …" only once everything in it has finished. It does not open itself.
**Why:** A live subagent hid inside "Worked for 50s"; words already shown never move (`every-word-the-agent-writes-stays-in-view` decision 2 stands).

## 5. A handback is a need of its own until it is answered
**Decision:** `hand_back` leaves a mark on the feature: the handback is outstanding. While it is outstanding, an orchestrator holds the feature and its lead is idle, the feature reads "With the orchestrator · <the handback's first line>" in the Working lane. It does not count and does not ping. After the hour (decision 2) it reads "Handed back · <first line>" under Needs you, counts and pings.
**Why:** Today a handback leaves no trace on the feature, so a lead that hands back with nothing else waiting reads "Talking with you" while the orchestrator owes the next move.
**Assumed.** Alternative: a handback shows nothing of its own and only holds the needs already there.
**For the human.** A handed-back feature now reads "With the orchestrator · …" with the lead's own summary, where it read "Talking with you".

## 6. An outstanding handback holds machine states, never a question to the human
**Decision:** While a handback is outstanding, it also holds a merge conflict, Ready to test, Ready to merge and a stopped feature: they read "With the orchestrator · <their words>" in Working. It never holds a question or prompt put to the human: an open question, any `wait_for_you` (plan included), a reply ending in "?", a permission prompt, a design to approve, a worker's question. Those read Needs you and ping, as decision 1 says.
**Why:** The usual handback is "ready" or "blocked on a conflict", and under a working agreement the orchestrator carries those next; a question the lead put to the human is the human's however the feature is held.
**Assumed.** Alternative: the handback holds only its own words; Ready to test after a handback goes straight to Needs you.
**For the human.** Under an orchestrator, a ready or conflicted feature that handed back stays in Working until the orchestrator answers or the hour runs out.
**Challenged:** Holding Ready to test, Ready to merge, a conflict and a stop brings back four of the six kinds the old guess held, and a conflict or stop that appears after the handback reaches no orchestrator; hold only the handback's own words, and let Ready to test read Needs you. (Decision 15 narrows this to states that stood at the handback.)

## 7. What ends a handback
**Decision:** A handback stops being outstanding when the orchestrator does something to the feature through one of its tools (a message with `send_to_feature`, starting or stopping a drive or review, merging); reading the feature's context or docs does not count, when the human writes in the lead's chat, when the lead hands back again (the new one replaces it), when the orchestrator lets go of the feature, or when the feature is merged or shelved. The hour does not end it; it only moves it to Needs you.
**Why:** "The orchestrator replied" has to be a fact runcastle already sees; every orchestrator tool that touches a feature already records that it did. A human who steps into the lead's chat has taken the conversation over.
**Assumed.** Alternative: only an orchestrator message (`send_to_feature`) ends it.
**For the human.** Writing in a handed-back feature's chat ends its "With the orchestrator" line.
**Challenged:** If reading tools counted, an orchestrator glancing at the feature would end the handback with nobody owing the next move; only actions that change something should end it. (Taken: the decision now says so.)

## 8. A held, self-planned feature asks the orchestrator for its plan yes by handing back
**Decision:** When an orchestrator holds the feature and the plan's yes is the orchestrator's to give (a feature that plans itself), the lead ends its planning run with `hand_back` (the plan, its check-first decisions and its For-the-human decisions) instead of `wait_for_you` kind `plan`. A feature the human grills, or one with no holder, still waits with `wait_for_you`. The lead and project skills get a line each. This supersedes `agents-are-woken-only-when-it-matters` decision 22 in part, which counted a plan's yes as human-only.
**Why:** Under decision 1, a `wait_for_you` would ping the human for a yes the orchestrator gives, and the orchestrator would never hear the plan was ready. The orchestrator brings the For-the-human decisions to the human before its yes.
**Assumed.** Alternative: the lead both hands back and waits, so the human is pinged as well.
**For the human.** A held, self-planned feature's finished plan sits under Working ("With the orchestrator · …") instead of asking you; the orchestrator brings it to you.

## 9. Where "a subagent is running" comes from
**Decision:** For Claude Code, from the runtime's own list of live background work (the subagents in it, now kept with their task titles, not just a count). For Codex, from its subagent start and end reports. A subagent counts as running until its end is reported or the session's process stops; there is no time cap.
**Why:** These are the only facts each runtime gives; the Claude list is the whole live set each time it changes, so it cannot drift.
**Assumed.** Alternative: a long cap (say an hour) as a safety net in case a Codex end report is lost.
**Challenged:** For Codex, a lost end report would keep the feature in Working forever and hide that the lead is idle; keep no cap for Claude Code but an hour's cap for Codex subagents.

## 10. The fold speaks for subagents only
**Decision:** The fold's running line covers subagents. A background shell command (a test run, a dev server) keeps its place on the strip above the composer and never holds a fold's line on "running".
**Why:** A dev server can run all day; a fold that spins for it would read as work that never ends, and the strip already names it.
**Assumed.** Alternative: the fold also says "Command running · <title>" for a background command started in it.
**For the human.** A fold that started a dev server or a long test still reads "Worked for …".
**Challenged:** A background test run started in a fold would read "Worked for …" while it runs, the very false line this feature fixes; show "Command running · <title>" while the command is inside the 10-minute window the status already counts.

## 11. This feature's place against shipped decisions
**Decision:** It supersedes in part `you-always-know-what-s-waiting` 18 (holding by need kind; the hour stays), `threads-open-fast-and-show-the-truth` 2 (the window now covers commands only) and `agents-are-woken-only-when-it-matters` 22 (a held self-planned plan's yes is handed back), and refines `every-word-the-agent-writes-stays-in-view` 2 (a closed fold's line can say what still runs). Those features' own docs are not edited.
**Why:** Shipped features' docs record what was true when they shipped; the change is recorded here.
**Assumed.** Alternative: append a "superseded by" line to each shipped decision.

## 12. The sidebar and header words stay as they are
**Decision:** The sidebar row and the feature header keep reading "Agent working" for a feature whose lead waits on a subagent; only the fold line names the subagent.
**Why:** The bug was that the feature left Working, not what Working said; naming the subagent in the sidebar is a wider change to status words this narrow fix does not need.
**Assumed.** Alternative: the row's second line reads "Subagent running · <title>".

## 13. Under a holder, anything the orchestrator can settle goes by handback
**Decision:** Decision 8 is one case of a general line in the lead skill: when an orchestrator holds the feature, a question the orchestrator can settle (under its working agreement: a plan's yes, "merge now?", a scope call it owns) goes to it with `hand_back`; `wait_for_you` is only for what the human must answer. This is what the skill already says about being blocked; the new line makes it explicit next to `wait_for_you`.
**Why:** With decision 1, every `wait_for_you` pings the human; a lead that used it out of habit for the orchestrator's questions would now ping the human for each.
**Assumed.** Alternative: only the plan's yes moves to a handback; other questions under a holder keep `wait_for_you` and ping the human.
**For the human.** Under an orchestrator you are pinged only for what the lead says is yours to answer.

## 14. An orchestrator waiting on the human about a held feature is the orchestrator's to show
**Decision:** When the orchestrator, answering a handback, needs the human first, the feature keeps reading "With the orchestrator · …" in Working until the orchestrator acts or the hour runs out. The question to the human is shown and pinged where the orchestrator asked it, in its own chat; the feature adds no second ping.
**Why:** One wait, one ping, in the chat where the human answers it; the hour still catches an orchestrator that never asks.
**Assumed.** Alternative: the orchestrator's open question also marks each feature it concerns as Needs you.

## 15. A handback holds only what stood when the lead handed back
**Decision:** A machine state (merge conflict, Ready to test, Ready to merge, stopped) is held only when it already stood at the moment the lead called `hand_back`; that is what the handback addressed to the orchestrator. One that appears after the handback reads Needs you and pings, as without a holder. Narrows decision 6.
**Why:** The orchestrator hears of a feature only through the lead's handback and a few machine events; a conflict or stop arriving later would otherwise be hidden from the human for an hour while no orchestrator knew of it — the bug this feature exists to fix.
**Assumed.** Alternative: hold every machine state while a handback is outstanding (decision 6 as first written).
