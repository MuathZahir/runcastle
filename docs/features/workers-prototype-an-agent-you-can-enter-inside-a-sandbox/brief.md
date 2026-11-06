## Purpose

First feature of the **worker model** cut (2026-11-06, project session). runcastle is moving to two levels: the orchestrator delegates to features, and each feature's lead delegates to **workers**. A worker is one thread with a label, an assignment (goal and done-when), its own sandbox and branch, a status (working / needs you / handed back / landed / failed) and a **handback** (short summary plus commits). "Background" only means nobody is typing in it; the human can open any worker at any time and talk to it, the way the Claude Code desktop app lets you click into a subagent.

Workers will replace today's burn tickets, review tickets, conflict resolvers, drive-fix chats and side chats. This feature is the prototype that answers the one real unknown before anything is built for real: **can an agent run as a runcastle thread inside a sandbox and still be reachable by the human?**

## Why (the evidence behind the cut)

A token analysis of 2026-10-23 to 11-06 found about 3.3B tokens spent, 97% of it cached context re-read on every call. Feature chats were 1.3B: 99% of it the lead working alone in one window that grows to 300–700k and never resets, reading code, patching, and checking screenshots itself. Side chats exist (`several-sessions-per-feature`) but were used 4 times in two weeks: the human never opens one, because nothing comes back from it (that feature decided "no notice to the main chat"), and no agent ever offers one. Burns are the last agent still outside runcastle's own threads: headless `claude -p` through sandcastle, transcript lost with the container. ADR-0015 already made every conversation an ACP thread runcastle owns; workers finish that move.

## What the prototype must answer

1. **Running the agent in the sandbox as a thread.** Can the ACP adapter (ADR-0015) run inside the burn container and stream its session to the server, so the same thread view works? Or is "attach by handoff" better: the worker stays headless and Open resumes its captured session interactively in the same sandbox (option weighed in the `open-a-worker-while-it-works` draft; sandcastle captures sessions, see `ticket-burner.ts` ~2424)? Pick one with evidence.
2. **Fast enough to iterate with?** The human will iterate on designs with interactive workers. Measure sandbox start and turn latency. **If it is not fast enough, the fallback is interactive workers on the host in their own git worktree** — report the numbers so the human can decide at the checkpoint.
3. **Seeing its dev server.** A design worker runs the project's frontend dev server (design mode). The human must see it in their browser: a port per worker, exposed from the sandbox.
4. **Idle workers give their seat back.** A worker waiting hours on the human must not hold a burn slot (the machine-wide worker pool) or a running container. Chats stop their process after 30 idle minutes (ADR-0015 §4); a worker needs the same, container included, and must resume cleanly.
5. **What a handback is.** A tool call the worker makes that records a short summary plus its commits/files and wakes its lead once. The lead reads the handback, never the worker's transcript — that is what keeps the lead small.

## Understood (settled with the human)

- Two levels only: orchestrator → features → workers. The lead's own in-reply subagents (Agent tool) stay invisible tools; a worker is something with its own workspace, record and handback.
- **The lead may still write code itself.** Its prompt prefers handing work to a worker, but when starting a sandbox isn't worth it, it does the job itself.
- "Drowning in threads" is solved by labels and a per-feature worker list with "needs you" on top, grouped by status, like the main sidebar.
- User-level skills stay loaded in sessions (the human's call: keeping them lean is the user's responsibility).
- The burn engine's hard-won machinery (landing queue ADR-0002, isolated workspace ADR-0005, attempt chaining ADR-0006, in-loop conflict resolution ADR-0007, measurement ADR-0008, sandcastle patch ADR-0011, image build ADR-0018) must survive the eventual move. The prototype should not touch it beyond what it needs.

## Must not swallow

- The real worker list UI and the lead offering workers → `interactive-workers`.
- Moving burn tickets, reviews and conflict resolvers onto the worker runner → `burns-become-workers`.
- The wake rule → `agents-are-woken-only-when-it-matters`.

## Output

A findings record (decisions + a short report with the measurements) and the spike code. The code may be thrown away or kept behind a flag; it need not be product quality. It must be honest about what did not work.

## Ordering

Starts now. `interactive-workers` waits on this and starts itself when it merges; `burns-become-workers` waits on that.

## Working agreement (cut 1, agreed 2026-11-06): checkpoints

The orchestrator carries this cut. **Checkpoint 1 is this feature's result**: the orchestrator stops and shows the human the findings, and the human decides sandbox vs host for interactive workers before `interactive-workers` is planned. Checkpoint 2 is after `interactive-workers`, before burns move. The orchestrator merges this feature only once the human has passed it at checkpoint 1.
