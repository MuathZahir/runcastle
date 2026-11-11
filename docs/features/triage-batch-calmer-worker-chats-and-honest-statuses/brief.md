Born from a notes triage in the orchestrator, 2026-11-10. Six notes the human jotted while running "Epics that look alive" and "Agents see the tweaks you picked". Every item below was grilled with the human; the decisions in **bold** are theirs. Look and exact layout are yours to design, within those decisions.

**Why this matters.** The charter now says the feature loop (workers, the Review worker's drive, the plan yes, test drive) is what runcastle is for, and it must be visible and calm. These are the places where that loop is currently noisy, hidden or mislabelled.

## 1. "Worked for" rows say what ran

Today a worker's or lead's chat is a ladder: "Worked for 17s >", one line, "Worked for 32s >", one line… (decided in `every-word-the-agent-writes-stays-in-view`, decisions 1 and 12: each run of tool calls between two text stretches folds to its own row, and every word the agent writes stays in view). The rows carry no information.

**Decision: keep every word in view and keep one row per stretch, but the row becomes a mechanical summary of what ran, e.g. "Ran 5 commands, read 2 files, edited 1 file".** Built from the tool-call kinds runcastle already records (`ToolKind` in packages/core/src/thread.ts: read, edit, delete, move, search, execute, think, fetch, other), plus subagents/thinking as fits. No agent writes it. Whether the duration stays alongside is your call.

A screenshot of the problem is at .runcastle-attachments/pnote_dV4ki0Ja3XrC.png in your workspace — Read it before starting. (Host path: /home/muath/.runcastle/project-notes/pnote_dV4ki0Ja3XrC.png)

## 2. Handback card: first paragraph, capped when opened

A worker's handback card in the lead's chat prints the whole report through Markdown (apps/web/src/components/workers/WorkerParts.tsx ~368); it was a screen and a half. No cap was ever decided.

**Decision: show the first paragraph of the report plus commit count and changed files as today; "Show more" opens the rest inside a box with a maximum height that scrolls, so the card never takes over the screen.** A mechanical cut, not a new worker-written summary field.

A screenshot of the problem is at .runcastle-attachments/pnote_Lx_fjRAfZI-z.png in your workspace — Read it before starting. (Host path: /home/muath/.runcastle/project-notes/pnote_Lx_fjRAfZI-z.png)

## 3. Assignment card starts folded

The assignment card pinned (sticky) at the top of a worker's chat is collapsible with `defaultOpen = true` (WorkerParts.tsx ~118); its comment says a caller folds it once the chat is long, but WorkerChat.tsx ~73 never does. Open + sticky = it covers the conversation.

**Decision: it starts folded to one line (worker name + first line of its goal); a click opens it; when open it gets the same maximum height with scroll as the handback card.** It stays pinned.

A screenshot of the problem is at .runcastle-attachments/pnote_Y1kI5HzF5BsX.png in your workspace — Read it before starting. (Host path: /home/muath/.runcastle/project-notes/pnote_Y1kI5HzF5BsX.png)

## 4. "Needs your answer" only when the lead is really waiting (bug)

The sidebar showed "Yours · Needs your answer" on "Agents see the tweaks you picked" right after its lead said "I've started the work" and started a worker — it was not waiting on the human. The drive screenshot in §5 shows the same on "Epics that look alive" while its review ran. Status line: apps/web/src/lib/feature-ui/status-line.ts (`statusOf` ~205); need: packages/core/src/feature-need.ts ~255–265. Likely causes: an open question box (`openAsk.kind === 'question'`) counted as halting while workers work, or a lead "answer" wait never cleared when it started the worker. Find the real cause, fix it, test it. Respect `the-status-tells-the-truth-about-who-and-what`.

A screenshot of the problem is at .runcastle-attachments/pnote_9-eFzzcfl-vE.png in your workspace — Read it before starting. (Host path: /home/muath/.runcastle/project-notes/pnote_9-eFzzcfl-vE.png)

## 5. The agent's test drive is labelled as the agent's

When the Review worker drives the app it takes the project's one drive slot (ADR-0014), and the UI cannot tell: the sidebar's bottom "Test drive" slot looks as if the human started it, and the feature chat shows "While this drive runs, the agent can't land its own edits" (`DRIVE_HOLDS_THE_AGENT`, apps/web/src/components/review/SendToAgent.tsx:24, shown by DriveChatNotice.tsx:41 whenever `isDriving`). The human's note suggested maybe hiding it.

**Decision: keep it visible (the slot is shared, so hiding it would block the human's own drive with no visible reason — and it is the loop showing itself), labelled as the agent's: e.g. "Review worker is trying this feature", and clicking it opens that worker's chat. The "can't land its own edits" banner shows only on the human's own drives.** The drive state must therefore carry who started it.

A screenshot of the problem is at .runcastle-attachments/pnote_n3vci0BC0ZZE.png in your workspace — Read it before starting. (Host path: /home/muath/.runcastle/project-notes/pnote_n3vci0BC0ZZE.png)

## 6. A "workers started" card in the lead's chat (new)

When a lead starts a worker, its chat shows nothing clickable; the human has to find the worker in the side panel.

**Decision: copy the orchestrator's feature cards (`orchestrator-actions-show-as-cards`: `feature_acted` event in packages/server/src/mcp/orchestrator-tools.ts ~123, folded to a `features_card` in packages/core/src/thread.ts, drawn by chat/thread/FeatureCards.tsx / FeatureCardItems.tsx). One card per turn, a row per worker started that turn: name, first line of its goal, a live status (working / waiting on you / handed back), and a click that opens the worker's chat.** The start would be emitted from packages/server/src/workers/service.ts; the handback card's `onOpenWorker` already opens a worker chat.

## Must not swallow

- Changing how workers hand back (no new summary field).
- Merging text stretches or hiding the agent's words — decision 12 of `every-word-the-agent-writes-stays-in-view` stands.
- Any change to the one-drive-slot rule (ADR-0014).
- The retired draft `open-a-worker-while-it-works` (superseded; the human may delete it).

Planning mode: plans itself

## Added by the orchestrator, 2026-11-10

## 7. Background-helper results count as the human typing (bug, added by the human's yes, 2026-11-10)

During this feature's own self-planning run, runcastle moved the feature from the orchestrator chat to the human ("cause: typed" at 16:23 UTC) although the human never typed in it. The cause: when a lead's background subagent finishes, Claude Code delivers its result to the lead as a new prompt beginning `<task-notification>`. The lead's UserPromptSubmit hook (`handleLeadPrompt`, packages/server/src/routes/hooks.ts ~395) treats any prompt without runcastle's tag as typed by the human, so it calls `releaseOnTyped` (takes a chat-owned feature for the human) and `markHumanMessage({ typed: true })`, which also clears the feature's waiting reason, stopped mark and outstanding handback. This run logged seven false `lead.human_message {typed:true}` events (16:23–16:35); the transcript confirms the ones at 16:33:27 and 16:35:27 were task-notifications.

**Decision (the human's): fix it in this feature.** Prompts Claude Code injects on its own (background task notifications, and any similar machine-made prompt you find) never count as the human typing: no owner change, no human-message mark. Cover it with a test. Check the Codex runtime's equivalent if it has one. This is the same "statuses tell the truth" family as item 4.
