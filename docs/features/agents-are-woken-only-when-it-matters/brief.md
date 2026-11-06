## Purpose

Part of the **worker model** cut (2026-11-06). In the two-level model (orchestrator → features → workers) every agent has one parent, and a parent should be woken only by a **handback** (the child's work is done) or a **real question** it must answer. Everything else is held and delivered with its next turn. This feature applies that rule to today's two links — runcastle news to the orchestrator, and messages to a feature's lead — written so workers adopt the same rule later.

## Evidence (token analysis, 2026-10-23 to 11-06)

- Orchestrator main threads used ~220M context tokens over 1,387 calls; **57% (125M) went to turns started by `[runcastle]` news lines**. Of 308 news wakes, 151 made no tool call and just replied "noted", at ~187k context each (~28M).
- Four kinds of line rarely need a turn: "the human is talking to its chat" / "went quiet" (66 wakes, 14M); "finished planning" (28 wakes, 6.7M — every one arrived within 3 minutes of a "waits for you" line for the same feature, and the orchestrator answered "that notice is out of date"); "review pass finished" (22 wakes, 6.6M); "round finished / interrupted" (17 wakes, 4.5M).
- The batching window `ORCHESTRATOR_GATHER_MS` is 300 ms (`packages/server/src/services/orchestrator-notify.ts:347`); paired lines 20–60 s apart cost two turns. Duplicate messages followed: d833c0e6 sent two messages to one feature in one minute because "start the work?" and "planning stopped" arrived separately.
- The thread host already has a `hold` option that adds text to the next prompt without starting a turn (`threads/host.ts:461`, `hold()` ~:1091).
- Each background subagent finishing wakes the orchestrator separately (49 wakes, 24M) — e.g. 5 boot-time reads → 5 wakes at 83–201k.
- **Oversized orchestrator chats are never cut**: runcastle stops resuming a chat whose transcript passes 1 MB (`launcher/sessions.ts:581`), but that check runs only when the human opens the chat (`launcher.ts:759`). News restarts a stopped chat through the thread host's prompt path (`threads/host.ts:458–490`), which skips it. None of 20 orchestrator sessions ever compacted; contexts reached 190–352k. `inheritHolds` already exists for handing held features to a fresh chat.
- News delivered while the usage limit is hit is lost (5 turns ended "You've hit your 5-hour limit"; the human had to type "Continue all work").
- Lead side: the round-return wake message (`lead-delivery.ts:145–157`) lists tickets and findings, and the lead then fetches them again anyway.

## Must not swallow

- Workers and handbacks themselves (`workers-prototype…`, `interactive-workers`, `burns-become-workers`). This feature works with today's news lines and lead deliveries.
- Compaction of feature chats and general long-chat safety → `lead-chats-stay-small`.
- Slimming runcastle's tool results → `tools-and-skills-say-less`.

## Understood

- The orchestrator must still hear what it can act on: a lead waiting for the human, a ready declaration, a failed round, a merge conflict, another thread taking a feature.
- Held news is not lost: it rides the next prompt.
- Live sessions run the globally installed runcastle, and drives of runcastle start from it, so check behaviour by hand-starting this branch's server.

## Open

- Exactly which lines hold vs wake, and whether "finished planning" is dropped when a "waits for you" for the same feature went out minutes before, or the window just widens.
- What happens to news that arrives while the provider's usage limit is hit (retry after reset?).

## Ordering

Independent; starts now.

## Working agreement (cut 1, agreed 2026-11-06): checkpoints

No checkpoint is named on this feature: the orchestrator carries it to merged on its own judgement, after the lead's review round.
