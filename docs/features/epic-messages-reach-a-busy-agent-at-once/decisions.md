# Decisions — Epic messages reach a busy agent at once

Planned with nobody present (2026-11-16). Decisions marked **Assumed.** are the lead's picks, waiting for the human's look.

Check first: 2, 3

## 1. An epic's message goes into the lead's running turn at once
**Decision:** A message an epic sends a feature's lead (`send_to_feature`) reaches a busy lead right away, steered into its running turn, the same way the human's own typing in that feature's chat already does. If the lead is idle, it starts a turn as today.
**Why:** On autopilot the epic is the only place the human can talk, and their mid-run instructions were arriving hours late, after the lead's whole turn ended. The human's answer to "make epic messages reach a busy agent right away": "yes".

## 2. Every epic message steers, not only those carrying the human's words
**Decision:** Both kinds of epic message steer into a running turn: the human's own words the epic passes on, and the epic's own instructions.
**Why:** The epic's own lines are usually direction too (a correction, a change of plan), and on autopilot it speaks for the human; a stale instruction costs the same whoever wrote it. One rule is also simpler for the human to predict.
**Assumed.** Alternative: only messages carrying the human's own words steer; the epic's own lines keep waiting for the turn to end.

## 3. Runcastle's own notices keep waiting for the turn to end
**Decision:** Only epic messages change. Runcastle's own notices to a lead (worker handbacks, news, restarts, merge conflicts, usage resets) and the human's test-drive notes keep queueing behind a running turn as today.
**Why:** The brief rules out changing how runcastle's notices arrive. Test-drive notes are the human's words too, but the brief scopes this feature to epic messages; they are offered as a separate backlog idea.
**Assumed.** Alternative: test-drive notes steer too, here.

## 4. A steered epic message looks as it does now, plus the "Sent into the running turn" label
**Decision:** In the feature's chat the epic's message keeps its own look (the epic's name and mark, on the left), and when it went into a running turn it gains the same small "Sent into the running turn" line the human's steered messages carry. It still never counts as the human typing in that chat: it does not clear the lead's "waiting on you" mark.
**Why:** The human should see that the message reached the lead mid-turn, and in the words they already know from their own messages. Keeping it the epic's message keeps who-said-what honest.
**Assumed.** Alternative: no label; the message looks exactly as today.

## 5. A message sent during a compaction still waits for the compaction
**Decision:** If the lead is compacting its conversation (shrinking it to keep it small) when the epic's message arrives, the message waits until the compaction ends, then goes in, as the human's own typing does today.
**Why:** Steering into a compaction can lose the message; the brief asks to keep this.
**Assumed.** Alternative: none worth taking; listed so the human sees it.
