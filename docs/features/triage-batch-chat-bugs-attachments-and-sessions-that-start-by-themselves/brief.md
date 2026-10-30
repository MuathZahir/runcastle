## Purpose

A batch of small, separate behaviour fixes from the human's notes and reports on 2026-10-30, after the UI cut shipped. One feature, one merge. Judge each on its own; none needs the human's eye on a design.

## 1. Ghost "Subagent Subagent · 0 calls" cards

Seen in the project chat (screenshot from the human, 2026-10-30): a turn that ran only shell commands showed 16 identical cards reading "Subagent  Subagent · 0 calls" before its first real row. 16 is exactly how many subagents that long-running session had launched in earlier turns, and the session had just been relaunched, so the adapter appears to re-announce old subagents in the new turn.

Likely cause, confirmed in the code but not against the raw events: in `packages/core/src/thread.ts` (`case 'subagent'`), `t.subagents` is per turn, so an update for an id this turn has not seen always creates a new segment, titled 'Subagent' by default. `createUpdateMapper` in `packages/server/src/threads/acp-map.ts` maps every `subagent_update`. Check the stored events first. Expected: a subagent gets one card, in the turn it ran in; a later state update never makes a new card. Old threads already holding these events should render right too, so prefer a fix at the read side if that covers both.

`docs/features/the-chat-looks-the-part/` shipped the card without trying real agent turns, so while you are here, check the grouped tool rows against real tool titles too.

## 2. Attachments vanish when you switch chats

The human: attach or paste an image in a chat, go to another chat, come back, and the attachment is gone. Cause: `apps/web/src/lib/use-thread.ts` saves the typed draft per thread in localStorage (`DRAFT_KEY`, `draftAt`), but pending attachments are a plain `useState` with no key. Expected: pending attachments stay with their thread across switching chats and a reload, like the text does. Also check they never appear on the wrong thread.

## 3. An answer goes missing after a message sent into a running turn

Note from the human: "Why does it sometimes do this? This is on a thread that was existing before we created the web ui for chat (not sure if this is related)". In the screenshot, the human sent an image and "It seems empty", marked "Sent into the running turn". The turn then ends with "Worked for 1m 25s" and a "2 changed files" card, and no written answer at all. Expected: if the agent answered, the answer shows. Find out whether the words were lost in the mapping or the agent wrote none, and whether a turn steered mid-way or a thread resumed from before the web chat is what triggers it. If the agent really wrote nothing, say so and stop.

A screenshot of the problem is at .runcastle-attachments/pnote_BQHxm3zZ5J4Q.png in your workspace — Read it before starting.

## 4. A new feature's chat waits for "Hi"

Note from the human: "When opening a new feature, it just shows an empty chat. I have to say something like 'Hi' so the agent starts." Expected: opening a new feature's chat for the first time, the agent starts by itself, reading its brief and speaking first, instead of an empty "New thread" screen. Docs: `docs/adr/0009-kickoff-delivery.md` ("a session's opening briefing rides the launch, never the keyboard") binds how it gets its briefing. Don't start an agent for a feature nobody has opened. Side threads and the project chat are out of scope unless they share the same path.

A screenshot of the problem is at .runcastle-attachments/pnote_Pflc2nnbHS2q.png in your workspace — Read it before starting.

## 5. Agents skip the grill

Note from the human: "Agent doesn't grill the user in project session (orchestrator). I just tell it the issue and it immediately creates the proposed cut. Leading to me finding out things about the implementation that I didn't know about. Might be an issue with the feature chat too (check)". The want: the agent asks the human before settling things, so nothing about the implementation surprises them later. The project skill already says to grill (`packages/skills`, the `project` skill's §1b), so find why it is skipped on a short request (for example, an instruction that reads as permission to go straight to a proposal) and tighten the wording. Same check on the feature skill's planning with the human. This is skill text, not code. A separate note: self-planning runs have no human to ask, and that stays as it is.

## Must not swallow

- Any redesign of the chat. The look was settled in the-chat-looks-the-part.
- New agent behaviour beyond these five.
- "Agents hand work to a new thread", which is its own backlog feature.

## Open

Item 3 may turn out to be nothing. Report it either way.

## Ordering

Runs alongside "The rest of the app looks the part" and "The test suite is green again"; no order needed.

## Working agreement (the human, 2026-10-30)

Autonomous: the human said to start these and not wait for them. The orchestrator gives the yes and merges when it is right. Tickets and review are tools, used when they help; no gate or review pass is required.
