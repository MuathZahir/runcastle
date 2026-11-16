# Epic messages reach a busy agent at once

## Problem
On autopilot the human talks only to the epic (the orchestrator chat running the features). When they give a feature an instruction mid-run, the epic passes it on with `send_to_feature`, but if the feature's lead is in the middle of a turn the message waits for the whole turn to end. On another project that cost 1–2 hours and a worker pass built on stale instructions, and the lead then answered each queued message in order, outdated ones included. The human's own typing in a feature chat does not have this problem: it is steered into the running turn at once.

## Approach
From the user's side: an epic's message reaches a busy lead the moment it is sent, and the feature's chat shows it as the epic's message with "Sent into the running turn" under it (decisions 1, 2, 4). Everything runcastle itself tells a lead still waits for the turn's end (decision 3).

Shape:

- **Agent host prompt options.** The host's `prompt` today queues every prompt whose source is `runcastle` behind a running turn and steers other sources when the runtime supports steering. Add one option, `steer`, that lets a `runcastle`-source prompt take the steering path: logged at once with `steered: true`, then sent with the runtime's steering call. The source stays `runcastle`, so nothing else changes for it: it does not fire the human-prompted lifecycle (which would clear the lead's wait), does not stamp the human's last-message time, does not feed thread naming, and still renders as runcastle's display. All existing guards keep their order and still apply to a steering prompt:
  - `hold` (news-only lines) still holds;
  - over the usage limit, the message is held as runcastle's messages are today;
  - during a compaction it is logged and queued, never steered (decision 5);
  - when the steering call answers that the turn just ended, it is enqueued as the next turn (existing fallback);
  - a runtime without steering queues it as a runcastle prompt today (both current runtimes, Claude and Codex, advertise steering).
- **Lead delivery.** `deliverToLead`'s message gains a matching `steer` flag that it passes to the host. Lines held from an earlier failed delivery ride ahead of it as today, so they go in with the steered message.
- **`send_to_feature`.** Sets `steer` on every delivery (decision 2). It stays `source: 'human'` for the delivery's own bookkeeping (the human's mark on the feature), as today. No other caller of lead delivery sets it (decision 3).
- **Chat display.** The thread fold already keeps `steered` on runcastle items. The runcastle display branch of the chat passes it through, and the epic's message (`OrchestratorMessage`) shows the same "Sent into the running turn" line, icon and style as a steered human message. Only orchestrator displays can be steered, so only that branch needs it.

Built by the lead alone: one server change across three modules, one small web change, tests at the seams below.

## Seams
- **Agent host, with the fake ACP agent (existing).** A `runcastle` prompt with `steer` during a running turn is logged at once as steered and reaches the agent's steering call; without `steer` it still queues (existing test). During a compaction it queues; over the usage limit it is held; with steering off it queues; with `promptRequired` it runs as the next turn. It never clears a wait.
- **`send_to_feature` through lead delivery (existing test file).** With the lead mid-turn, the epic's message reaches the agent before the turn ends, shown as the epic's display with `steered`; a worker handback in the same situation still waits.
- **Chat thread component test (existing tier).** An orchestrator display item with `steered` shows "Sent into the running turn"; without it, it does not.

## Out of scope
- How runcastle's own notices (handbacks, news, restarts, merge conflicts, usage resets) are delivered.
- The human's test-drive notes, which also queue today: offered as a separate backlog idea.
- Editing or withdrawing a queued message.
- Any change to the lead's instructions on how to treat a message mid-turn.

## Open questions
- None blocking. Testing it live needs the branch's server started by hand (runcastle's drives run the installed version), and the human's own sessions only get it after a publish and reinstall.
