# ADR-0020: Burns become workers — one kind of delegated work, the burn engine retired

- **Status:** accepted (2026-11-08)
- **Deciders:** Muath (delegated the rest of the effort on 2026-11-08) + the feature lead of `burns-become-workers`
- **Supersedes:** ADR-0002 (per-ticket temp branches and serialized landings as the burn's concurrency model), ADR-0003 (short temp-branch paths, as a burn detail), ADR-0006 (attempt chaining and transient-error retry as a fresh attempt on a new branch), ADR-0007 (the in-loop conflict-resolver agent) and ADR-0011 (the sandcastle patch)
- **Amends:** ADR-0004 (dependency caching), ADR-0005 (isolated workspace) and ADR-0018 (image build): each now governs **worker sandboxes**. ADR-0008: its agent bounds and guard now govern worker sandboxes; its per-tool timing breakdown is retired and token counts per worker remain. Nothing else of ADR-0008 is amended.
- **Builds on:** ADR-0019 (two levels: the orchestrator delegates to features, features delegate to workers)

## Context

ADR-0019 settled that runcastle has two levels and one kind of delegated work.
`interactive-workers` moved build work onto workers. What stayed behind was the
burn engine: tickets, rounds, runs, `@ai-hero/sandcastle` and its patch, a
headless runner whose conversations were thrown away with the container, and a
review that only that engine could run. Meanwhile workers lacked the safety nets
the engine had earned: retries, stall detection, the warm dependency cache, the
image build, and the working rules that made burns cheaper.

## Decisions

1. **The burn engine is deleted.** `workflows/` (the ticket burner, review
   ticket, review gates, gate reuse, kill registry, run reconcile, runner and
   registry), the sandcastle dependency and its patch, the writing half of the
   tickets, runs and rounds services and routers, the lead's and orchestrator's
   ticket and round tools (`emit_tickets`, `update_ticket`, `cancel_ticket`,
   `list_tickets`, `get_ticket`, `dispatch_round`, `stop_round`), the round
   fields of `get_feature_context`, the burner prompt templates, and the
   per-tool timer. Nothing starts a round or a burn by itself any more.
2. **What the engine protected against is carried onto the worker runner, not
   kept beside it:** a transient error is retried in the same conversation after
   a backoff, up to three times; a stalled turn is cancelled and counted as one;
   a restart tells a cut-off worker to carry on; the usage limit follows the
   human's "Carry on when the usage limit resets" setting; an account-level
   error holds the queue; a landing conflict sends an "on its own" worker back
   to resolve it, and goes to the lead after two tries. Workers start from the
   warm per-project dependency cache and build a missing image (ADR-0004,
   ADR-0005, ADR-0018 now name worker sandboxes). The error classes live in a
   shared pure classifier (`services/agent-errors.ts`).
3. **The review is a worker**, labelled Review, enterable, its conversation kept.
   A drive review runs on the host while it holds the project's one drive slot;
   a gates review runs sandboxed on the committed feature branch. It runs the
   project's checks itself; server-run gates are gone. A fresh verify review
   checks the fixes.
4. **Tickets, rounds and runs are frozen history, not dropped.** The tables stay;
   nothing writes them (a boot step closes a run the old server left running).
   Their read queries serve the History view and `get_work_record`, which reads
   frozen tables for old features and worker records for new ones. A feature
   that still had tickets not done gets one held note on its lead's next
   message, naming each and its goal. Open review findings stay with their
   feature.
5. **Config.** The attempt, iteration, conflict-attempt and workspace-mode keys
   and the `noSandbox` switch are removed; a config file still carrying them
   loads (unknown keys are ignored, `noSandbox` reads as docker). Concurrency,
   the CPU cap, the guard switch, the cache switch, the image keys, the setup
   command, the verify commands and the known failures stay.

## Consequences

- One list, one runner, one set of tests for delegated work; any worker can be
  entered; transcripts are kept and tokens counted per worker.
- A published install no longer bundles a patched dependency
  (`BUNDLED_DEPENDENCIES` is empty; the mechanism stays).
- The per-tool timing breakdown is not rebuilt; context and token use are what
  workers show.
- The Fix-drive and scenario chats are not moved here; they become workers in
  their own feature.
