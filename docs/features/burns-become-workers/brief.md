## Purpose

Last feature of the **worker model** cut (2026-11-06): consolidate burns into workers, so runcastle has two levels and one kind of delegated work. The human (2026-11-06): consolidating threads and burners "would make the mental model of the application a lot simpler. It's just two levels. The Orchestrator delegates to features and the features delegate to workers", with any worker enterable like a Claude Code desktop subagent.

## What moves

- **Implementation tickets** run as background workers on the worker runner built by `interactive-workers` (and proven by the prototype). A ticket becomes the worker's assignment; the digest becomes its handback.
- **Review tickets, conflict resolvers, drive-fix / scenario chats** become workers with their own labels.
- **Transcripts are kept** (today they are lost with the container), which also closes the burn-logging blind spot (sandcastle logs only Bash/WebFetch/WebSearch/Agent calls) and lets tokens be counted from the transcript.
- The human can **step into** a running or finished worker. This supersedes the draft `open-a-worker-while-it-works` (read its brief for the options weighed then).

## Must keep (the burn engine's hard-won machinery)

Landing queue and per-ticket temp branches (ADR-0002, 0003), dependency caching (ADR-0004), isolated workspace (ADR-0005), attempt chaining and transient-error retry (ADR-0006), in-loop conflict resolution (ADR-0007), measurement and agent bounds (ADR-0008), the sandcastle patch (ADR-0011), image build (ADR-0018), stall detection and usage-limit / 429 / quota classification (`ticket-burner.ts` ~2452–2561, ~4544). Moving the runner must not lose any of it; this is runcastle's most battle-tested code.

## Understood

- Rounds may dissolve into "workers running" — the lead's call in its grill, not settled.
- The lead may still write code itself (human, 2026-11-06).
- Prompt- and guide-level burn savings (ticket size, check rule, review screenshots, compaction, model default) land earlier in `cheaper-burns` and should carry over unchanged.

## Must not swallow

- New interactive-worker UI → `interactive-workers` (reuse it).
- The wake rule → `agents-are-woken-only-when-it-matters`.

## Ordering

Waits on `interactive-workers`; up next — starts itself when that merges.

## Working agreement (cut 1, agreed 2026-11-06): checkpoints

No checkpoint is named on this feature: the human passes interactive workers at checkpoint 2 before this one is planned, and the orchestrator carries this one to merged on its own judgement after the lead's review round.

## Added by the orchestrator, 2026-11-06

## Planning mode: grill with the human (2026-11-06)

The human decided this feature is planned in a full grill with them, not by a self-planning run: it changes how runcastle's most battle-tested code runs agents, and decides whether rounds survive. The orchestrator does not call plan_feature on it; when it starts, it tells the human to open this feature's chat.
