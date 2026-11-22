## Purpose

Once workers build on the host (the feature this waits on), nothing uses a container. The human decided sandboxes are not kept as an option: "if sandboxes are causing all these issues I dont think it should even be opt in. Why offer something if the user will hate it (and hate the product)."

This feature deletes what is left, so no user meets it and no code carries it. It is decisions 1 and 2 of `docs/adr/0023-a-lighter-feature-loop-without-sandboxes.md`.

What the human gets:

- Docker is no longer a prerequisite anywhere: setup, the first-run checks, the README, the website's install steps.
- The sandbox engine, the worker images and their build, the shared caches made for containers, the copy of the project into each worker, and the landing step that brought a container's commits back are gone.
- Settings and screens that only made sense for containers are gone.
- Leftovers on a user's machine are cleaned up, or the user is told the one command that does it: stopped worker containers, images, volumes and build cache. On the owner's machine these filled a 96 GB disk on 2026-11-21 (23 GB in stopped containers alone) and stopped every feature.

Where: runcastle's server, its setup and docs. Who: every runcastle user.

## Must not swallow

- Making host workers work: the feature this waits on.
- The concurrency number and the visible queue: their own feature.
- Old features' recorded history (frozen runs, rounds, tickets). It stays readable.

## Decided with the human

- Sandboxes removed entirely, not opt-in (quoted above).
- The cut and its order: "Alright, you can start". Planning mode was the orchestrator's pick (plan automatically).
- Cleanup runs by itself, once, on the first start after upgrading (2026-11-22, relayed by the orchestrator): "Yes, just make sure this doesnt affect existing work in runcastle". It removes only what belongs to workers that landed or were dropped, in every project on the machine; anything that may hold unfinished work is kept and named with the command that removes it.

## Understood

- This supersedes ADR-0022 (smaller sandboxes), ADR-0004, 0005 and 0018, and amends ADR-0019 and ADR-0020. The orchestrator rewrites the charter's lines when this merges; the lead does not edit `CONTEXT.md` or the ADRs.
- The draft feature "smaller worker sandboxes" is obsolete.
- Simplicity is the point: remove, do not leave a switch or a dormant code path.

## Open

- Whether cleanup of a user's leftover containers and images runs by itself on upgrade or is offered as one command. Deleting a container could delete work that never landed, so look before removing: only containers of workers that are finished.
- What happens to a worker still running in a container at the moment a user upgrades.

## Ordering

Waits on "Workers build in the feature's folder". Nothing waits on it.

Planning mode: automatic

## Added by the orchestrator, 2026-11-21

The human, 2026-11-21: "I also want you to tell all features to prioritize implementing on their own. Maybe use subagents. But prefer not to use workers since we keep running out of memory and disk... We need to finish these fixes as fast as possible". So the lead builds this itself in the feature's folder, with its own subagents for parallel parts, and starts no workers, not even a Review worker. It reviews with its own subagents, fixes what they find, runs typecheck and the affected tests, then declares ready.
