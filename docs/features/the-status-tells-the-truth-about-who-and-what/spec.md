# The status tells the truth about who and what

## Problem

The human reads a feature's status to know whether it needs them. Runcastle guesses that status from proxies, and the guesses go wrong both ways:

- A lead's question to the human sits under **Working** as "With the orchestrator · …" for an hour, because an orchestrator holds the feature and the need's kind is on the list of kinds an orchestrator may hold. No orchestrator ever hears of it.
- A feature whose lead waits on a background subagent drops out of Working after 10 minutes, though the subagent is still running.
- In the chat, that subagent hides inside a closed "Worked for 50s" fold, so nothing says work is still going.

## Approach

**Who a wait is for follows the tool.** Every wait a lead addresses to the human (an open question, `wait_for_you` of any kind, a reply ending in "?", a permission prompt, a design to approve, a worker's question) reads Needs you, counts and pings, held or not (decision 1). The old list of holdable need kinds goes. The only thing that makes a feature read "With the orchestrator · …" is an outstanding handback.

**A handback is recorded on the feature.** `hand_back` stores a mark on the feature row: when it was handed back and the summary. While the mark stands, an orchestrator still holds the feature and less than an hour has passed since the handback:

- with nothing else waiting and the lead idle, the feature's need is the handback itself: "With the orchestrator · <the summary's first line>", Working lane, no count, no ping (decision 5);
- a machine state that already stood when the lead handed back (merge conflict, Ready to test, Ready to merge, stopped) reads "With the orchestrator · <its words>" (decisions 6 and 15); one that appears after the handback is not held;
- a held need never outranks an unheld one: a question to the human that arrives after a handback always shows, whatever the usual order of need kinds.

After the hour the mark still stands but nothing is held: the handback reads "Handed back · <first line>" under Needs you, counts and pings, and held machine states read their plain words (decision 2). The existing need watcher already treats "held → not held" as news and pings; it keeps doing so.

**What ends the mark** (decision 7): the orchestrator doing something to the feature through one of its tools (a `send_to_feature` message, starting or stopping a drive or review, merging — the orchestrator tools already record each such action on the feature; reading context or docs does not count), the human's message in the lead's chat, a newer handback (it replaces the mark), the orchestrator letting go of the feature, or the feature leaving the active state. Every clearing emits an event so the UI updates at once.

**Skills** (decisions 8 and 13). The lead skill gains, beside `wait_for_you`: under a holder, what the orchestrator can settle goes by `hand_back`; `wait_for_you` is only for what the human must answer. Its planning-alone reference ends a held, self-planned run with `hand_back` (the plan, its check-first and For-the-human decisions) instead of a `plan` wait. The line saying a sub-agent keeps the feature "Agent working" for at most 10 minutes is corrected (a subagent counts as long as it runs). The project skill's handback lines say the plan's yes for a self-planned feature arrives as a handback, and that the orchestrator puts For-the-human decisions to the human before its yes.

**What is still running** (decisions 3 and 9). The thread log's background-work event carries the running subagents as a list (an id, a title, a start time), not a bare count. Two producers feed it:

- Claude Code: the runtime's own message listing all live background work, whose subagent entries now keep their task title;
- Codex: the host keeps the set of subagents from their start and end reports and logs the same event when it changes.

Old log events with a bare count still read as that many untitled subagents. Thread activity counts a running subagent as working for as long as it is listed, with no time cap; the 10-minute window applies to background shell commands only. The process stopping clears the list. A question still beats running work. The server's lead state and the window timer follow the same rule, so the feature stays in Working and the sidebar keeps "Agent working" (decision 12).

**The fold tells the truth** (decisions 4 and 10). A folded run of work with a running subagent in it keeps its fold closed and shows a spinner and "Subagent running · <title>" in place of "Worked for …" (with several: "2 subagents running · <first title> +1"). Which fold: the one whose steps hold that subagent's card or the call that launched it, matched by id or title; when none matches, the newest fold at or before the subagent's start. When the last running subagent in it ends, the line becomes "Worked for …". Ending a turn no longer marks a still-listed subagent's card as completed; its card completes when the list drops it. Background shell commands never change a fold's line; they stay on the strip above the composer.

## Seams

- **Feature need** (existing): the pure function that computes a feature's need from its facts. Its facts gain the handback mark; observe the need's kind, words and held flag for every case above. The shared ping rule over it stays the test for "counts and pings".
- **The lead's `hand_back` tool and the orchestrator's tools** (existing): observe the mark written on the feature, replaced by a newer handback, and cleared by each orchestrator action, a human message, a release of the hold — and the event each emits.
- **Thread activity** (existing): the pure function from a thread's log to working / background / asking / idle. Observe a subagent keeping a thread working past 10 minutes, commands still capped, a question still winning, and old count-only events.
- **Background-work reading** (existing, changed): the functions that read Claude's background-work message now return subagents with titles; the Codex subagent set in the host logs the same event.
- **Thread folding** (existing): the function that turns a log into chat items. Its work item gains what is still running in it; observe the right fold carrying it, and losing it when the subagent ends.
- **The work fold component** (existing): renders the running line with a spinner, or "Worked for …".
- **Skill text** (existing tests over the skills): the new lines are present.

## Out of scope

- A wider simplification of the need rules (the nine kinds, quiet answers, precedence overall).
- Any model reading a chat to judge status.
- Waking the orchestrator for anything new; `hand_back` already wakes it once.
- Naming the subagent in the sidebar row or the feature header.
- Background shell commands in the fold.
- Editing shipped features' docs; this feature's decision 11 records what it supersedes.

## Open questions

- Whether Claude Code's adapter shows a subagent card in the chat for a background subagent at all. The worker on running work checks this in a real session first; if no card appears, the fold matches on the launching call's title.
- Whether Codex subagents outlive a turn in practice. The Codex path is built on its start and end reports and checked with recorded events only.
