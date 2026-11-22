# Sandboxes are removed

## Problem

Workers now build on the host, in the feature's folder, yet runcastle still carries
everything it had for containers. New users are told to install Docker, the first-run
wizard walks them through building an image and minting a token nobody uses, and
Settings shows a Sandboxes page whose knobs do nothing. On machines that ran workers in
containers, the leftovers stay on disk: on the owner's machine they filled a 96 GB disk
on 2026-11-21 (23 GB in stopped containers alone) and stopped every feature. The code
that ran containers is a large share of the server and its tests, and every agent that
reads it pays for it.

## Approach

From the user's side: installing and setting up runcastle never mentions Docker. The
wizard has no "Unattended workers" step; Settings has no Sandboxes page, and "how many
workers run at once" sits on the General page (decision 5). The first start after
upgrading cleans up what runcastle made for containers on that machine and says how much
space came back (decision 3); a worker that was still in a container is closed with its
commits kept on a branch (decision 4). Old features' history (frozen runs, rounds,
tickets, and old workers' conversations and handbacks) stays readable.

The shape:

- **Deleted outright.** The sandbox engine and its container calls; the in-container
  paths, run arguments, setup and install scripts and push hook; the project copy into a
  worker and the fetch that landed its commits; copying the human's Claude or Codex setup
  into a container; the in-container tool relay and its MCP script; the in-container
  guard hook (the host guard before each tool call stays); the UID mapping; the spike
  harness; the stock and project images, their build, adopt/release and cleanup; the
  per-project cache volume; the image Dockerfiles in the server's assets and at the repo
  root, and the packaging step that ships them; the hourly container sweep and the
  container stop at shutdown; the unused Docker and Podman logos on the site. The release
  smoke test's Dockerfiles are not sandboxes and stay.
- **Worker service.** Only the host path remains: placing, prompting, landing, sending
  back, stopping, previews, keeping a conversation. Every branch that asked "is this a
  container worker?" goes. New worker rows no longer record an engine. Boot no longer
  resumes or wakes container workers; the one-off upgrade step below closes them.
- **The upgrade step (one small module, the only code left that calls Docker).** Runs
  once per install at boot, after migrations, and records that it ran in the data
  folder. When neither a docker nor a podman binary answers, it records itself done and
  stops. Otherwise, for things labelled `runcastle.owner=runcastle` with this install's
  `runcastle.data-dir`:
  - For each unfinished container worker (a row with a container and a status that is
    not landed, dropped or failed): fetch its branch from its copy in the data folder
    into the project repo with plain git, mark it failed with the reason from decision
    4, emit an event on its feature naming the branch and the container's remove
    command, and tell the feature's lead.
  - For each finished container worker: keep its conversation file if it was not kept
    yet (one copy out of the container), then remove the container.
  - Remove the labelled images, volumes and runcastle's own image builders, the project
    copies and runtime folders under the data folder, and legacy burn-engine containers
    of this install.
  - Measure what was freed, write one log line and one project event saying so, and
    name `docker builder prune` with the size of Docker's shared build cache when it is
    large.
  Every Docker call is best-effort: a failure is an event, never a failed boot. A later
  release may delete this module; that is outside this feature.
  Until the human answers decision 3, the step has two modes picked by one constant in
  the module. "Remove" does the above. "Tell" removes nothing and calls Docker only to
  list: it closes unfinished container workers (plain git, as above), then writes one
  project event and log line naming what is left, its size, and the commands that
  remove exactly those things (by name, not by a label filter, so an unfinished
  worker's container is never in them). "Tell" ships unless the human's answer arrives
  first.
- **Setup, doctor and CLI.** `runcastle setup` loses the Docker install, the docker group
  and the log-out step. The doctor loses its container runtime, image, cache volume, user
  mapping and unattended-token checks. The `build-image` and `token` commands go. The
  refusal to run as root stays where setup and the service use it, moved out of the
  container code.
- **Config and settings.** The keys `sandbox`, `sandboxImage`, `burnCpus`, `burnGuard`
  and `burnCache`, their environment variables and the project-level image are removed;
  a config file or environment that still has them is ignored without error.
  `burnConcurrency` and `setupCommand` stay; the latter's wording drops "sandbox".
- **Server API.** The setup router loses the runtime install guide, the image build
  target, the token writer and the image build terminal; the system router loses the
  build cache status and clear.
- **Database.** One migration drops `projects.sandbox` and `projects.sandbox_image`,
  and `workers.engine` and `workers.container`. The upgrade step reads container names
  from labels, so it needs neither column. `workers.preview_port` and
  `workers.dev_server` stay: host workers use them. Old rows in tickets, runs, rounds,
  findings and events are untouched; an old image-build event or `sandboxImage` finding
  renders through the generic fallback.
- **Web.** The first-run wizard drops its `afk` step and the `afkReady` flag. The
  Sandboxes settings page, its rail entry and the prerequisite card go; the reusable
  checklist pieces the runtimes step borrows from that card move to their own file. The
  worker concurrency row moves to the General page with its current behaviour. Wording
  that says agents run sandboxed (sidebar, glossary, pipeline step, worker pending hint)
  is corrected; an old worker's chat shows no "Sandbox" label. The iframe `sandbox`
  attributes are unrelated and stay.
- **Docs and skills.** README: the requirement row, the wizard step and "The unattended
  sandbox" section go; the plain risk statement (decision 7) takes their place. Website:
  the install requirement, the VPS guide's docker-group line, the landing section and
  animation (decision 8), the comparison pages' wording. The project skill's preparation
  page loses "The sandbox image" and its `setupCommand` line is reworded. `CLAUDE.md`'s
  worker row and `docs/SPEC.md`'s token and config lines are updated. `CONTEXT.md` and
  the ADRs are the orchestrator's and are not edited.

Built by the lead with its own subagents, in parallel parts that touch disjoint
folders: server workers and boot; doctor, setup, CLI, config and API; web; docs, site
and skills. Then the project's typecheck and tests, a review by the lead's own
subagents, fixes, and ready.

## Seams

- **Typecheck of the whole repo** (existing): nothing still imports what was deleted.
- **The upgrade step against a fake container CLI** (new): given labelled containers,
  images, volumes and worker rows in each state, it removes only finished workers' and
  this install's things, keeps an unfinished worker's commits as a branch and marks it
  failed, and runs only once. The existing fake engine used by the worker tests is
  replaced by this one fake CLI.
- **Worker service tests on host workers only** (existing): land, send back, stop and
  previews still pass with the container branches gone.
- **Doctor report** (existing): no container rows, and a machine with no Docker reports
  healthy.
- **Setup plan** (existing): no Docker install step on any platform.
- **Config load** (existing): a config with the removed keys loads and ignores them.
- **Web component tests** (existing): the wizard's step list, the settings rail and the
  General page's concurrency row.
- **A grep** for `sandcastle`, `docker`, `podman` and "sandbox" across server, core,
  web, skills, README and site, each remaining hit justified (history, the upgrade step,
  the release smoke test, iframe attributes).

## Out of scope

- Making host workers work: "Workers build in the feature's folder" (merged).
- The concurrency number's default, its final home and the visible queue: their own
  feature. This one only moves the row.
- Old features' recorded history: stays readable, not migrated.
- `CONTEXT.md` and the ADRs: the orchestrator rewrites them at merge.
- A new landing-page section in place of the sandbox one: offered as a backlog feature.
- Deploying the website: the human's step.

## Open questions

- Whether the upgrade step itself is deleted in a later release, and when.
