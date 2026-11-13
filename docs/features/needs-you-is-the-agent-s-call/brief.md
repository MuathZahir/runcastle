## Why

The human, 2026-11-13: "the status being wrong most of the time is very annoying. I would see it says needs your answer even though the agent is still working or has subagents. I feel like these things shouldn't be mechanical. The agent should probably call the tool. Why do we even need the waiting states? I just want to know if the agent needs me or not. I don't care about the state."

The root cause is in the code that works out what a feature needs from the human (`packages/core/src/feature-need.ts`). It treats a lead that merely ended its turn as needing an answer (`leadAwaitsHuman`, the "implied answer"), even while its subagents or background commands still run. On top of that sit 10 need kinds (permission, conflict, worker, answer, plan, design, stopped, test, merge, handback), 4 wait kinds passed to `wait_for_you` (answer, plan, design, stuck), a 60-minute grace before an epic's held need comes to the human, and owner prefixes ("With <chat> ·", "Asking <chat> ·"). All of it is derived mechanically from facts, and it guesses wrong.

## What the human wants

One bit per feature and per worker: **needs you, or not**. When it needs you, show the one line the agent wrote saying why. Nothing else in the status.

- Only an agent's tool call sets "needs you": `wait_for_you({ why })`, `declare_ready` (that's a need too: "ready to test"), or a real permission prompt or question box waiting on a click. Ending a turn never does.
- Your reply (or the agent's next tool call that takes it back) clears it.
- Everything else reads "working" or "idle" and never pings.

## What it must not swallow

- Events with no agent behind them (a merge conflict, a usage limit, a dead container) still need a home. Recommend the simplest one: they go to the owning agent, which decides whether to tell the human. The grill settles it.
- The feature lead and the orchestrator skills already tell agents to call `wait_for_you` before they hand anything to the human; the wording loses its kinds.

## Direction (to grill, not settled)

Delete the need kinds, the wait kinds, the implied-answer rule, the held-need grace and the owner prefixes, rather than keeping them behind a simpler label. Count what the UI then shows and confirm it is just "needs you · <why>", "working", "idle", "ready to test", "merged". Part of a wider reset toward "rules, not procedures" (see the sibling features "Ownership is a label" and "Skills become short rules"); prefer deleting code to adding it.

Planning mode: grill with you

## Added by the orchestrator, 2026-11-13

## 2026-11-13: the human's standing direction for this whole reset

The human: "The whole process should be as simple as possible for both the agents and the user. The user should be interacting with the system in a very smooth way without any confusion. He has to have a very simple mental model of things. And things should be leading to each other." This is now a charter principle ("A simple path for the human").

For this feature, that means:
- Wherever "needs you" shows (the sidebar, a ping, an orchestrator's message), it is one click to the exact chat where the question waits.
- The reason line is the agent's own words, kept to one short line.
- "Needs you" belongs to the chat whose agent called the tool. A feature an orchestrator chat runs brings its questions to that chat, and the orchestrator asks the human there, with a link. That part is the sibling feature "Ownership is a label". This feature should leave room for it, not build it.

Prefer deleting code to adding it.
