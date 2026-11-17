## Purpose

On another project, run on autopilot, the human's mid-flight instructions reached a feature's lead hours late. The epic (the orchestrator chat running the features) passed the human's words on with `send_to_feature`, the lead was mid-turn, and the message waited for the whole turn to end; the lead then answered each queued message in order, even outdated ones. That project's orchestrator put the cost at 1–2 hours plus a worker pass built on stale instructions. On autopilot the epic is the only place the human can talk, so every instruction they give mid-run pays this.

## Decided with the human (2026-11-16)

- What: a message from an epic reaches a busy feature agent at once, steered into its running turn, the same way the human's own typing in that feature's chat already does. The human's answer to "make epic messages reach a busy agent right away, as a new feature planned automatically": "yes".
- Where: delivery of `send_to_feature` messages (epic → feature lead).
- Who: the human talking through an epic, and the epic itself.

## Understood (orchestrator's code read, 2026-11-16 — verify)

- `send_to_feature` (`packages/server/src/mcp/orchestrator-run-tools.ts`) calls `deliverToLead` with `source: 'human'`, but `deliverToLead` (`services/lead-delivery.ts`) always calls `agentHost.prompt` with `source: 'runcastle'`.
- `prompt` in `threads/host.ts` queues every `source: 'runcastle'` prompt behind a running turn (`t.queue.push`), and only steers others when the adapter supports steering (`_session/steering`). The installed Claude ACP adapter advertises steering.
- So the fix is likely to steer epic messages (at least those carrying the human's words, probably every `send_to_feature`) into a running turn, while runcastle's own machinery lines (handbacks, news, restarts) keep queueing as today.
- Runtimes without steering (Codex, if it has none) keep the queue; check what happens there.

## Must not swallow

- Changing how runcastle's own notices (handbacks, news, restarts, usage resets) are delivered.
- A way to edit or withdraw queued messages.

## Open

- Whether every epic message should steer, or only those carrying the human's words.
- Compaction: messages already never steer into a compaction; keep that.

## Ordering

Independent; nothing waits on it.

Planning mode: automatic
