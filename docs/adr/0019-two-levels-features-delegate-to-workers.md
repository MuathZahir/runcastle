# ADR-0019: Two levels — the orchestrator delegates to features, features delegate to workers

- **Status:** accepted as direction (2026-11-06); where interactive workers run
  is settled by the prototype feature
- **Deciders:** Muath + project session
- **Amends:** `several-sessions-per-feature` (side sessions, and its decision 18
  "no notice to the main chat"); the headless burn as a separate kind of agent
  (ADR-0015 left burns outside runcastle's threads)

## Context

A token analysis of 2026-10-23 to 11-06 found about 3.3B tokens spent, 97% of
it cached context re-read on every call. Feature chats were 1.3B of it, and 99%
of that was the lead working alone in one window that grew to 300–700k and never
reset. Side chats existed but were used 4 times in two weeks: nothing came back
from them, and no agent ever offered one. Burns ran as headless processes in a
sandbox with their transcripts thrown away, so the human could not step into one,
and runcastle had five kinds of delegated agent (burn, review, conflict resolver,
drive-fix chat, side chat) with different rules.

## Decision

1. **Two levels.** The orchestrator delegates to features. A feature's lead
   delegates to **workers**. There is no third kind of agent.
2. **A worker is one thread** with a label, an assignment (goal and when it is
   done), its own workspace and branch, a status, and a **handback**: a short
   summary plus its commits or files. The lead reads the handback, not the
   worker's conversation.
3. **Any worker can be entered.** "Background" means only that nobody is typing
   in it; the human can open any worker and talk to it.
4. **Workers replace** burn tickets, review tickets, conflict resolvers,
   drive-fix chats and side chats. Side chats become workers the human starts.
5. **The lead offers workers** — in its plan after grilling, and whenever a piece
   splits off — and prefers handing work to them. It may still write code itself
   when starting a worker is not worth it.
6. **A parent is woken only by a handback or a real question.** Other news waits
   for its next turn. The same rule holds between the orchestrator and its
   features.
7. **The human finds their way by labels and status**, not by fewer threads: each
   feature lists its workers with "needs you" on top.
8. **An agent's in-reply subagents are not workers.** They stay invisible tools.
9. **User-level skills stay loaded** in every session. Keeping them lean is the
   user's job.

## Consequences

- The burn engine's machinery (ADR-0002 to 0008, 0011, 0018) must survive the
  move to the worker runner; it is not redesigned by this decision.
- Where interactive workers run — in a sandbox like burns, or on the host in
  their own worktree — is decided from the prototype's measurements. Charter
  decision 6 ("worktrees for talk, sandboxes for work") is amended when that is
  settled.
- Built by `workers-prototype-an-agent-you-can-enter-inside-a-sandbox`, then
  `interactive-workers`, then `burns-become-workers`; the wake rule by
  `agents-are-woken-only-when-it-matters`. The drafts
  `agents-hand-work-to-a-new-thread` and `open-a-worker-while-it-works` are
  superseded.
