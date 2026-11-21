## Purpose

Workers run in containers today. An audit of a 36-hour run traced a large share of its problems to that: images missing a toolchain, no shared build cache, 1.6 GB copied into every worker, private copies of the branch that went stale, container deaths nobody saw, and one worker at a time (16.4 hours of queueing). Meanwhile leads and the orchestrator already run on the host with no permission prompts, so the container was not a consistent safety line.

The human decided sandboxes go entirely. This feature moves workers onto the host; a second feature, which waits on this one, deletes the sandbox machinery. The decision is recorded in `docs/adr/0023-a-lighter-feature-loop-without-sandboxes.md` (decisions 1 to 5).

What the human gets:

- **One worker builds in the feature's own folder, straight on the feature branch.** Its commits are simply there: no landing step, and it always sees the lead's latest commits.
- **Parallel workers each get their own folder and branch** (a git worktree). Each merges back into the feature branch when the project's checks pass and the lead has skimmed the diff. No review agent per worker.
- **The lead may build small things itself.** The guard that keeps the lead's folder docs-only goes. The rule of thumb for the lead's skill: build it yourself when writing the assignment would take about as long as doing it.
- **Guards are the only protection.** Edits stay inside the agent's own folder, and a short list of destructive commands is refused (deleting outside the folder, pushing to a remote, rewriting git history). Read what guards exist today and fill gaps.
- **A rule for leads:** give parallel workers work that does not need the same port or database, because nothing separates them any more.

Where: runcastle's server (the worker runner and guards) and the lead's rules. Who: every runcastle user; Docker stops being needed to build.

## Must not swallow

- Deleting the sandbox code, images, caches and the Docker prerequisite: the next feature. Here, make the host path work and be the one used.
- The number of workers that run at once and the visible queue: its own feature.
- The review's rules, the docs, plan approval, the involvement setting, autopilot: other features.
- The drive's two chats, which already run on the host in the human's checkout. Leave them as they are.

## Decided with the human

- "if sandboxes are causing all these issues I dont think it should even be opt in. Why offer something if the user will hate it (and hate the product). For workers, I dont see why they cant be there, just without the sanboxes.."
- The folder rule (one worker in the feature's folder; parallel workers in their own folder and branch, merged back on green checks plus the lead's skim; one review of the whole feature at the end): "Agreed".
- The lead builds small things itself, by judgement, with the docs-only guard removed: "Agreed."
- On relying on guards alone, with the risk that an agent's script can still reach outside its folder: "Alright this is fine."
- The cut and its order: "Alright, you can start". Planning mode was the orchestrator's pick (plan automatically).

## Understood

- A new folder from git has no installed packages or local env files. On the host the package managers' shared caches make that install cheap; the lead decides how a parallel worker's folder is prepared.
- The lead accepts or sends back from the review and a skim of the diff's shape; it does no line-by-line review of its own.
- A lead that keeps building lets its conversation grow; the existing cap on lead conversations bounds that.
- The risk that remains without containers must be stated plainly in the docs, not hidden.

## Open

- What stops a worker and the lead from editing the same file at once in the shared folder. The orchestrator expects it to be rare, since the lead mostly writes docs; say how it is handled.
- How a worker the human enters, and a review, fit the same folder while a build worker is running.
- Whether today's guards can be relied on for shell commands on Windows as well as Linux and macOS.

## Ordering

Waits on "A worker never shows working with nothing running", because both rewrite the same worker code. "Sandboxes are removed" and "One number for how many build at once" wait on this.

Planning mode: automatic

## Added by the orchestrator, 2026-11-21

The human, 2026-11-21: "I also want you to tell all features to prioritize implementing on their own. Maybe use subagents. But prefer not to use workers since we keep running out of memory and disk... We need to finish these fixes as fast as possible". So the lead builds this itself in the feature's folder, with its own subagents for parallel parts, and starts no workers, not even a Review worker. It reviews with its own subagents, fixes what they find, runs typecheck and the affected tests, then declares ready.
