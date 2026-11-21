# Decisions — Sandboxes are removed

Planned with nobody present (2026-11-21), on the epic "Runcastle Rethink". Decisions
marked **Assumed.** are the lead's picks, waiting for the human's word.

Check first: 3, 4, 5, 7, 8

## 1. Sandboxes are removed entirely, not kept as an option
**Decision:** Workers run only on the host. No container engine, no switch, no dormant
code path: the sandbox engine, the worker images and their build, the shared caches, the
copy of the project into each worker and the step that brought a container's commits
back are deleted.
**Why:** The human: "if sandboxes are causing all these issues I dont think it should
even be opt in. Why offer something if the user will hate it (and hate the product)."

## 2. Build it now, in the agreed order, with no workers
**Decision:** This feature starts after "Workers build in the feature's folder" (merged).
The lead builds it itself with its own subagents, starts no workers (not even a Review
worker), reviews with its own subagents, runs the checks, then says ready.
**Why:** The human: "Alright, you can start", and on 2026-11-21: "prefer not to use
workers since we keep running out of memory and disk... We need to finish these fixes
as fast as possible".

## 3. Leftovers are cleaned up by themselves, once, on the first start after upgrading
**Decision:** On its first start after the upgrade, runcastle removes what it made for
containers on this machine, but only what carries its own label and this install's data
folder: containers of finished workers, its worker images, its cache volumes, its own
image builders (their build cache goes with them), and the project copies under the
data folder. Docker's shared build cache, which also holds the user's other builds, is
not touched; the user is told the one command that clears it (`docker builder prune`)
with the space it would free. The start's log and the timeline say what was removed and
how much space came back. When no Docker is installed, nothing runs.
**Why:** The owner's 96 GB disk filled with these on 2026-11-21 and stopped every
feature; most users would never run a command they were only told about. Removing only
labelled things of finished workers cannot lose work or touch other projects.
**Assumed.** Alternative: never run Docker from runcastle again, and only tell the user
the commands to run.

## 4. A worker still in a container at upgrade is stopped, and its commits are kept as a branch
**Decision:** A worker that was not finished when the upgrade happened (working, queued
or waiting, in a container) is marked failed with a plain reason ("it ran in a
container, which runcastle no longer has"). Every commit it made is kept on a branch
`runcastle/worker/<id>` in the project, and the feature's lead is told, so it can merge
the branch or start a new worker. Its container is left in place, since it may hold
uncommitted edits, and the timeline names it with the command that removes it.
**Why:** Workers' commits already sit on the host (each container pushed every commit to
a copy in the data folder), so plain git keeps them without any container code. Only the
uncommitted edits would need the container, so it is the one thing not removed.
**Assumed.** Alternative: drop such workers outright, removing their containers and
copies, and let the lead start the work again.

## 5. The first-run wizard loses its "Unattended workers" step, and Settings loses its "Sandboxes" page
**Decision:** The wizard goes straight from the runtimes step to the next one. The
Sandboxes settings page goes with its rows: container runtime, image build, build cache,
CPU limit, guard and image. The one setting on it that stays, how many workers run at
once, moves unchanged to the General page. Its final home and the visible queue belong
to the concurrency feature. The unattended token (`CLAUDE_CODE_OAUTH_TOKEN`, minted by
`claude setup-token`) and the `runcastle token` and `runcastle build-image` commands go
too: only containers used them; host workers use the human's own sign-in.
**Why:** The brief: settings and screens that only made sense for containers are gone.
**Assumed.** Alternative: keep the Sandboxes page renamed "Workers", holding only the
concurrency number.

## 6. Docker is no longer a prerequisite anywhere
**Decision:** `runcastle setup` stops installing Docker (and stops adding the user to the
docker group and asking them to log out). The doctor drops its Docker, image, cache, user
mapping and unattended-token checks. The README's requirement row and its "The unattended
sandbox" section go, as do the website's "Docker or Podman, running" requirement and the
VPS guide's docker-group line. Docker already installed on a machine is left alone.
**Why:** The brief; ADR-0023 decision 1.

## 7. The README and website say plainly what protects the user now
**Decision:** Where they used to describe the sandbox, the README and the website's docs
say in two sentences that workers run on your machine, that runcastle refuses edits
outside the agent's own folder and a short list of destructive commands, and that a
script an agent runs can still reach outside its folder.
**Why:** ADR-0023 decision 1: the remaining risk "is accepted and stated plainly to
users".
**Assumed.** Alternative: say nothing about safety and only remove the Docker text.

## 8. The website's sandbox section is removed, not replaced
**Decision:** The landing page's "Every ticket runs in its own sandbox" section and its
animation are removed, and the comparison pages stop saying "sandboxed workers". No new
section takes its place in this feature; the site files change here, and deploying them
stays the human's step.
**Why:** The section now describes something runcastle does not do. Designing a new
section is landing-page taste work the human steers, so it is offered as a backlog
feature instead.
**Assumed.** Alternative: replace it with a section about workers running in the
feature's folder.
