# Needs you is the agent's call

## Problem

The human looks at the sidebar to know whether anything needs them, and it is wrong
most of the time. A feature reads "Needs your answer" while its agent still works or
waits on its own subagents, because runcastle guesses a question from a finished turn.
An epic's chat reads "waiting" because its last words held a question mark after a plan
card. A worker reads "Needs you" because its turn ended without a handback. On top of
the guess sit ten need kinds, four wait kinds, a 60-minute grace and owner prefixes
("With <chat> ·", "Asking <chat> ·"), all derived from facts, all to pick a label. The
human does not want states; they want to know whether an agent needs them, and why.

## Approach

**What the human sees.** Every feature row, worker card and epic chat reads one of:
"Needs you · <the agent's line>", "Working", "Idle", or "Merged" (plus the backlog and
archive shelves, unchanged). Clicking "Needs you" anywhere opens the exact chat the
question waits in. Each time something starts needing the human, the desktop and phone
are pinged once with the agent's line. Nothing else pings.

**What sets it.** Only these:

- an agent calls `wait_for_you({ why })` (the lead, an epic's chat, or a worker);
- the lead calls `declare_ready({ scenario })`, which reads "Needs you · Ready to test · <scenario>";
- a permission prompt or question box waits on the human's click in a chat (its title is the line);
- the agent's run died, or the usage limit stopped it with "carry on" off: runcastle sets it with a fixed line ("The agent's run failed (exit 1)", "Usage limit reached"). This is the only need runcastle writes itself.

Ending a turn never sets it. Every agent's instructions carry the rule: if your last
message asks the human anything, call `wait_for_you` with one short line.

**What clears it.** Only the human writing in that chat (or answering its prompt or
question box, pressing Stop, or closing the feature: merge, archive, shelf, or dropping
or landing the worker), or the agent itself replacing the need (a new `wait_for_you` or
`declare_ready`) or withdrawing it. A worker handing back, a review finishing, a merge
conflict or an orchestrator's message does not clear it. "Needs you" beats "Working":
a wait stands while the agent, its subagents, background commands or workers still run.

**Events with no agent behind them** go to the lead as a message: a merge conflict
(today it wakes nobody), a failed worker and a dead sandbox (already delivered). The lead
decides whether the human hears. A human's Stop reads idle. A waiting design does not
turn a feature amber by itself; the lead's line does. An up-next draft that cannot start
shows its problem on its own row in red, outside the Needs you lane, with no ping.

**The shape.**

- *A wait lives on the agent's session row*, one per chat: the lead's chat, each
  worker, each orchestrator chat. It holds the line, when it was set, and whether
  runcastle or the agent set it. The feature-level waiting columns and the `waitingKind`
  column go (a migration). `wait_for_you` keeps its name; its input is `{ why }` only.
  The human's message in that chat clears that session's wait; `wait_for_you({ withdraw: true })` lets the agent take it back (the input is `{ why }` or `{ withdraw: true }`).
- *A feature's need* is the newest of: its lead's wait, its workers' waits, and an open
  prompt or question box in any of its threads. In core this is one small pure function
  over a list of waits; it replaces the ranked candidates, the held logic and every
  prefix helper in the module that decides a feature's need today.
  The wire shape replaces today's `FeatureNeed`:

  ```ts
  // replaces FeatureNeed / NeedKind / WaitingKind (packages/core)
  interface Need {
    why: string          // the agent's line, or runcastle's fixed line for a dead run
    since: number        // ms since the epoch
    threadId: string     // the chat to open
    by: 'agent' | 'runcastle'
  }
  ```

  `feature.list` and `feature.get` carry `need: Need | null`; a worker carries its own
  `need`; an orchestrator chat's thread entry carries its own `need` in place of its
  derived "waiting" state and `askingAbout`.
- *Working* is: the agent mid-turn, its subagents or background commands running, or
  (for a feature) any of its workers working. Otherwise idle.
- *Workers*: they get `wait_for_you` among their sandbox tools. The worker statuses keep
  `needs-you`, but only a wait, an open ask or a dead run sets it; a turn that ends with
  no handback, a Stop and a server restart leave it in its `working` status, and
  its card reads "Idle" while no turn of it runs. A feature counts as Working only for
  workers with a turn running. An "on its own" worker's instructions
  say to bring questions to the lead by handing back.
- *Orchestrator chats*: the project session gets `wait_for_you`; the "asked about"
  heuristic (question mark after a plan card) is deleted.
- *Pings*: one `needs_you` event per session entering a need, carrying the line, the
  thread and the feature if any. The one ping rule becomes "a well-formed needs_you
  event pings", shared by web and server.
- *Deleted*: the ten need kinds and their precedence, the quiet need, the implied-answer
  read of a finished turn (for needs only; the chat still shows a turn's state), the held
  needs, the owner and asking prefixes, the hour's grace and its 60-second sweep, the
  "Ready to merge" step, the "Stopped" labels, the self-plan "planning stopped" reason
  and the never-set provider-limit reason with the Resume path keyed on it.
- *Kept for the sibling*: the automatic switch of an epic's feature to the human on
  `wait_for_you` stays; "Ownership is a label" removes it.
- *Skills*: the lead, orchestrator and worker instructions lose the wait kinds and gain
  the one rule above. "Skills become short rules" rewrites them wholesale later; here the
  wording only stops describing what is deleted.

## Seams

- **`wait_for_you` → `feature.get().need`** (existing tool, existing query): a lead's call
  shows its line; the human's message in that chat or a withdraw clears it, a worker
  handback or orchestrator message does not. The main end-to-end seam.
- **`declare_ready` → `need`** (existing): reads "Ready to test · <scenario>", cleared by
  the human's next message.
- **Core need function** (new, replaces `featureNeed`): pure, waits in, newest need out;
  unit-tested in core.
- **Worker status** (existing `workers/service` turn-end path): a turn with no handback
  leaves the worker idle; a worker's `wait_for_you` or open ask makes it need you, and its
  feature's `need` points at the worker's thread.
- **Orchestrator thread entry** (existing thread listing): `need` set only by the
  project session's `wait_for_you`.
- **`needs_you` event + ping rule** (existing event, simplified rule): one per session
  entering a need; observable through the event list and the push service's sends.
- **Merge conflict delivery** (existing `deliverToLead` path, new caller): a conflict
  reaches the lead as a message.
- **Web pure helpers** (existing): the status line, sidebar lanes and notification
  helpers map a `need` to "Needs you · <why>", else Working / Idle / Merged; their
  component tests and the shared fixtures are rewritten to the four words.

## Out of scope

- Who owns a feature, the automatic owner switch, the finish choice and refusals:
  "Ownership is a label".
- Routing a feature's need to an orchestrator chat. A feature's question shows in its
  own chat; nothing here forwards it to an epic.
- Rewriting the skills into short rules: "Skills become short rules".
- A fallback for an agent that forgets the tool (decided: none).
- Changing the plan card, design cards, Approve button, Test drive or Merge buttons.

## Open questions

- None blocking. The check-first decisions (6, 7, 9, 13, 17) may change the shape:
  if the human keeps workers off `wait_for_you`, workers keep their own status words and
  only "with you" workers' asks reach the feature row.
