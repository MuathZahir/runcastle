# Triage batch — calmer worker chats and honest statuses

## Problem

The feature loop (a lead starting workers, the Review worker driving, the human test-driving)
is what runcastle is for, and in seven places it is noisy, hidden or mislabelled:

- A chat's work rows read "Worked for 17s >" over and over and say nothing about what ran.
- A worker's handback card prints its whole report in the lead's chat, a screen and a half.
- A worker's assignment card is pinned open at the top of its chat and covers the conversation.
- The sidebar says "Needs your answer" while the lead's workers are at work and nobody waits on the human.
- When the Review worker drives the app, the drive slot looks like the human's own drive, and the
  feature chat warns that "the agent can't land its own edits".
- A lead that starts a worker leaves nothing clickable in its chat; the human hunts for it in the side panel.
- A lead's background helper finishing counts as the human typing: the feature moves to the human
  and its waiting marks clear.

## Approach

**Work rows say what ran (decisions 1, 7, 8, 9).** Each finished stretch of tool calls keeps its own
row and every word the agent writes stays in view. The row's label becomes a summary computed in the
web from the stretch's steps, in a fixed order: "Ran 5 commands, read 2 files, edited 1 file · 32s"
— commands, distinct files read, distinct files edited (edit, delete, move), searches, pages fetched,
subagents run (one each, their inner calls not added), other tool calls as "used N tools". The
duration follows, muted. A thinking-only stretch keeps "Thought for Ns"; a live stretch keeps showing
its steps; the "Subagent running" head is unchanged. It reuses the call-group wording the steps
already use ("Read 3 files"), so a file read twice counts once. One shared work-row component serves
every chat (lead, worker, orchestrator, phone), so the change lands everywhere.

**Handback reports are capped (decisions 2, 9, 17).** One small shared piece renders a report: its
first paragraph (text up to the first blank line, clamped to about four lines if that paragraph is
itself long), then "Show more", which opens the rest in an inset box with a maximum height that
scrolls, and "Show less". The worker handback card in a lead's chat and its orchestrator twin (a
feature lead handing back to its chat) both use it; commit count, changed files and "Open its chat"
stay as they are. The Review Package keeps its own layout. No worker writes anything new: the cut is
mechanical.

**The assignment card starts folded (decisions 3, 10, 11).** Folded, it is one pinned line: the
worker's name and its purpose (the one-line description every worker is started with, falling back
to the goal's first line when there is none). A click opens it; open, Goal and Done when sit in a box
with the same maximum height as the report box. The runcastle "Start your assignment" line below it is
unchanged.

**A "workers started" card in the lead's chat (decisions 6, 10, 12).** When a lead starts a worker or
the Review worker (a verify review included), the server appends a thread event to the lead's chat,
modelled on the orchestrator's `feature_acted` → `features_card` fold: the event carries the worker's
id and a snapshot of its label, purpose and kind. The fold gathers every such event of one lead turn
into one card, a row per worker, even when the lead's words fall between two starts; the card stands
on its own in the thread and is never folded into a work row. Each row looks up the worker's live
state at render time from the feature's worker list (as feature cards look up live features) and
shows it in plain words: waiting to start, working, waiting on you, handed back, landed, dropped,
failed. A click opens the worker's chat through the same path the handback card's "Open its chat"
uses. Sending a worker back adds no row. Workers the human starts from the drive page are not the
lead's and get no card.

**The false "Needs your answer" (decisions 4, 13, 14).** The cause: the sidebar takes its words from
the feature's need, and the need's quiet "the lead replied, so it may await you" branch fires whenever
the lead's own process is idle — a lead whose turn ended on "I've started the work" while its workers
run counts as idle. The header already counted workers, so the two disagreed. The fix is in the shared
need: a new fact, "workers at work" (any worker of the feature working or queued), and the quiet reply
branch does not stand while it is true. Real waits still win over workers: the lead's own
`wait_for_you`, an open question box, a permission prompt, a worker needing the human. The alerts read
the same need, so they stop too. Starting a worker does not clear a lead's own wait; the
`wait_for_you` tool description, which claims "your next dispatch clears it", is corrected to say only
the human's next message does. Respect `the-status-tells-the-truth-about-who-and-what`.

**The agent's drive is labelled as the agent's (decisions 5, 15, 16).** The server's drive state
already records its purpose (`human` or `review`); it gains the starting worker's id when the Review
worker takes the slot, and the drive info served to the web carries both. The web's drive state keeps
them instead of dropping them. Then:

- the sidebar's drive slot, for an agent's drive, reads "<worker label> is trying this feature" with
  the feature's title beneath; a click opens that worker's chat on the feature's page; its Stop asks
  first, saying it ends the review's drive;
- the feature's "is driving" flag, which feeds the "can't land its own edits" banner and the header's
  drive status and "Stop drive", is true only for the human's own drive; during an agent's drive the
  header reads as a worker at work;
- the human's own Test drive, refused while the slot is held, gives a reason naming the worker, with
  a way to open its chat.

The one-drive-slot rule (ADR-0014) is untouched. The phone has no drive slot and cannot start a
drive; its chat bar's status words and the chat banner read the same feature status, so they follow
the desktop with no phone-only work.

**A helper's result is not the human typing (decision 18, brief item 7).** The lead's prompt hook
(`handleLeadPrompt`, packages/server/src/routes/hooks.ts) treats any prompt without runcastle's tag
as typed by the human: it moves a chat-owned feature to the human and stamps the human-message mark,
which clears the feature's waiting reason, stopped mark and outstanding handback. Claude Code
delivers a finished background helper's result to the lead as a prompt opening with
`<task-notification>`, so every helper result did both. The hook skips such machine-made prompts,
the same way it already skips runcastle's compaction command. The builder lists any other
machine-made prompt shapes it finds and checks the Codex runtime's prompt path for the same flaw.

**Designs.** Two design pages hold the look of the chat pieces, waiting for the human's approval:
"Worker chat" (states: folded, assignment-open) and "Lead chat — worker cards" (states: started,
handed-back, report-open). They change the real work-row, assignment-card and handback-card
components and add the workers-card component; a builder wires them to real data and does not
restyle. The drive slot change is a label and a click and was not designed.

## Seams

- **The thread fold** (existing, core): feed a lead thread's events, including the new worker-started
  events, and observe one card item per turn with its rows; observe that the card is not swallowed by
  a work item.
- **The work-row summary** (new, pure, web): steps in, label out; plus the existing component tests
  that render a chat (they assert the old "Worked for" words and must be updated).
- **The feature need** (existing, core): need facts in, need out — a lead that replied with a worker
  working yields no need; with its own `wait_for_you`, an open question box or a worker needing the
  human, it still does. The sidebar's state words and the header's status line are checked against
  the same facts so they agree.
- **The workers service** (existing, server): starting a worker or a review appends the worker-started
  event to the lead's thread and emits as every mutation does.
- **The drive info** (existing, server → tRPC): a review drive's info carries purpose and worker id;
  a human drive carries purpose `human`.
- **The drive slot and drive notices** (existing, web): rendered for a human drive and an agent drive —
  label, click target, Stop confirm, banner present only for the human's.
- **The lead's prompt hook** (existing, server route): post a UserPromptSubmit for a lead whose
  feature a chat owns, with a `<task-notification>` prompt, and observe that the owner and the
  waiting marks are unchanged and no human-message event is emitted; a plainly typed prompt still
  moves the feature and stamps the mark.
- **The handback card and assignment card** (existing, web): folded by default, Show more reveals the
  capped box.

## Out of scope

- How workers hand back: no new summary field (brief).
- Merging text stretches or hiding the agent's words; decision 12 of
  `every-word-the-agent-writes-stays-in-view` stands.
- Any change to the one-drive-slot rule (ADR-0014): no queuing, no take-over.
- The Review Package's layout.
- The retired draft `open-a-worker-while-it-works`.
- A drive slot on the phone.

## Open questions

- What a review does when the human stops its drive from the slot (does the Review worker carry on
  without the app, or fail?). The builder finds out and the confirm's words say it truthfully.
- Whether a lead's plain-words question while workers run should be caught some other way
  (decision 13's challenge); left to the human.
