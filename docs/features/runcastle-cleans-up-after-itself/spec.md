# Runcastle cleans up after itself

## Problem

Runcastle filled its human's disk. Every worker gets a container whose writable layer is 3.7–6 GB, and almost nothing removes them: landing, failing, a crash, a usage limit and a server shutdown all leave the container behind, a worker that failed during setup is forgotten with its container still running, and a test drive of runcastle leaves its inner runcastle's containers running after the drive's data folder is gone. Old sandbox images, the image build cache, cache-volume temp files, review captures and the retired burn engine's containers pile up too. A user of runcastle should never have to know any of this exists.

## Approach

From the user's side: nothing new to see or set. Containers disappear when a worker lands or is dropped; a handed-back or failed worker keeps a stopped one until it is settled or its feature closes; leftovers from crashes, drives and older versions vanish at the next sweep; a sweep that removed something leaves one line on the project timeline with the space it freed (decisions 2, 4, 11).

### Ownership marks (decision 5)

Every `run`, `build` and `volume create` runcastle issues adds labels:

```
runcastle.owner=runcastle
runcastle.data-dir=<absolute dataDir()>      # where this install keeps its state
runcastle.worker=<worker id>                 # containers only
runcastle.project=<project id>               # images and volumes
```

The data-dir label is the ownership key. An install acts on a resource only when the label equals its own `dataDir()`, or when the labelled folder no longer exists (an orphan; any install may remove it). Resources made before the labels existed are recognised by what they are: a `runcastle-worker-*` container is owned by the install whose `workers/origins` folder its origin mount points into; containers built from runcastle's sandbox images (the `runcastle.dockerfile-hash` image label) whose names are not `runcastle-worker-*` belong to the retired burn engine and are always removable (decision 7).

This also closes a live hazard: a drive's runcastle copies the real database, including worker rows naming the real install's containers. Every container action (remove, stop, exec) now checks the label (or the origin-mount rule) against the acting install's data folder first and refuses on a mismatch, so a drive can never remove or drive the real install's containers.

### Lifecycle changes in the worker service (decisions 2, 4)

- **Container recorded before it can leak.** The worker row's container name is written right after `run` succeeds, before clone, install and setup. A setup failure then removes the container and origin at once (the worker did no work) and marks the worker failed.
- **Drop during setup.** A drop that arrives while setup runs marks the worker dropped; setup checks for that when it finishes, removes what it made and sends no kickoff.
- **Land** keeps the worker's conversation, then removes container, origin copy and branch, exactly as drop does today.
- **Keep conversation before every removal**, the start-up sweep included (today it removes landed and dropped containers without keeping their conversation and token count).
- **Fail** stops the container and keeps it. It is removed on drop, or when the feature merges, is archived or deleted (already the case).
- **Server shutdown** stops every running worker container within the existing 5-second shutdown budget, best effort; anything it misses the next start-up sweep handles.
- **Messaging a landed worker** is refused like a dropped one, since it has no container to answer from. The web already hides the composer for landed workers.
- A conversation of a landed or dropped worker stays readable: the chat reads the host-side thread log, never the container (confirmed by the survey).

### The sweep (decisions 5, 6, 7)

One function, `sweepLeftovers`, replaces the start-up `stopLeftoverWorkerSandboxes`. It lists every container the engine has (by owner label, by `runcastle-worker-` name, and by runcastle image), every runcastle volume, and every runcastle image, and decides each by the ownership rule above plus this install's worker rows:

| Resource | Removed when |
|---|---|
| Worker container of this install | no worker row, or its row is landed, dropped, or failed-during-setup, or its feature is merged/archived/deleted |
| Worker container of a non-terminal worker | stopped (not removed) if running with no live agent |
| Container labelled with a data folder that no longer exists | always |
| Retired burn-engine container | always |
| Worker origin folder / `runcastle/worker/*` branch | its worker is removed or unknown |
| Cache volume `runcastle-<projectId>` | that project is not in this install, and no container mounts it |
| Legacy `runcastle-worker-cache` volume | no container mounts it |
| Sandbox image | an image with the same tag replaced it (dangling, runcastle-labelled), or its project is gone; never while a container uses it |
| `workers/runtime/<version>` folders | not the current adapter version |
| Review capture folders | decision 10's rule (below) |

It runs at server start (as today; skipped on a copied database) and once an hour. The drive stop hook does not run it: it removes the drive's own labelled containers and volumes itself (below), and the live install's hourly sweep catches anything a drive left. It is serialised so two runs never overlap, never throws (each removal is best effort and a failure becomes a `cleanup.failed` event), and emits one `cleanup.swept` project event per project that lost something, with counts and freed bytes (sizes from `ps --size`, `system df -v` / `volume inspect`, and a file walk for folders, which works on Windows too). Normal land/drop/merge cleanup emits no extra event (decision 11).

The retired burn engine's `.sandcastle/worktrees/*` inside each project repo are removed once by the first sweep if `git status --porcelain` is empty; dirty ones are listed in one `cleanup.kept` event and left.

### Drives (decision 6)

`.runcastle/drive-stop.ts` (this repo's drive stop hook) removes every container and volume labelled with the drive's data folder before it deletes the folder. The live install's hourly sweep is the backstop for any drive whose stop never ran (the folder is gone, so its containers are orphans). This is the general rule for every project whose app is runcastle; other projects' drives make no runcastle containers.

### Image builds (decision 8)

- **Docker:** builds go through a runcastle-only BuildKit builder (`docker buildx` with its own name, `--load` into the image store), which is removed after the build, taking its cache with it. If buildx is missing, fall back to a plain build followed by removing only the cache records whose IDs that build created; if that cannot be done safely, keep the cache and say so in the `cleanup.kept` event. Verify the `--load` cost on a real build.
- **Podman:** `podman build --layers=false`, which keeps no intermediate layer images.
- After a successful rebuild, the image it replaced (now untagged, runcastle-labelled) is removed if no container uses it; otherwise the sweep takes it later.

### Cache volume temp files (decision 9)

The worker setup script deletes files under the volume's `tmp` folder older than one day before the agent starts (`find -mtime +1 -delete`, scoped to the volume's temp folder only). The cache store itself is untouched. The manual Clear button keeps working; it now refuses while any container mounts the volume (it checks the retired burner's slot allocator today, which workers never use).

### Review captures (decision 10)

Capture folders are keyed by review id. Each is mapped to its feature through the review/worker/ticket rows. A folder is removed when its feature is deleted, or 30 days after the feature shipped or was archived. Folders that map to nothing are removed once they are 30 days old. Feature delete also removes them at once.

## Seams

- **Worker service with the fake engine (existing).** `fakeEngine()` already records `created`, `stopped`, `removed` and `held`. Extend it with labels and a fake `ps` listing so tests assert, for each lifecycle path (land, drop, drop-during-setup, setup failure, fail, shutdown, merge), which containers end up removed or stopped. This is the main seam.
- **`sweepLeftovers` with an injected engine listing and data folder (new).** Feed it containers, volumes and images with every label combination (own, other live install, missing folder, unlabelled worker, burn-engine) and assert what it removes and what event it emits. Covers the drive hazard: a copied database must never remove another install's container.
- **Argv tests (existing).** `runArgs` and the build command builders: the labels are present, the builder is runcastle's own, Podman gets `--layers=false`.
- **Real-engine check (existing spike harness).** One run on a real Docker: start a worker, land it, confirm `docker ps -a` shows nothing of it and its origin folder is gone; kill the server mid-setup and confirm the next start removes the orphan.

## Out of scope

- Shrinking the ~4 GB each worker container takes (decision 12): parked as a backlog feature.
- A disk-usage screen, a setting, or a low-disk warning.
- Anything runcastle did not create: the human's images, containers, caches, `~/.npm`, `~/.bun`.
- Deleting feature branches after merge (they are cheap and are the record of the work).
- Archived features' talk worktrees with uncommitted changes (kept today on purpose; kept still).

## Open questions

- Settled 2026-11-17: `docker buildx … --load` through runcastle's own builder adds about 14 s per build (mostly starting the builder) and leaves nothing behind but Docker's ~200 MB BuildKit program image, which every later build reuses. Measured on a real Docker 29.9 with buildx 0.38.
- Not done: a project image is built `FROM` the local stock image, which a builder of runcastle's own cannot read, so project image builds still go through Docker's own builder and keep their cache (said on the timeline as `cleanup.kept`). Closing it means exporting the stock image into the builder first; left for the human to decide.
- How Podman reports per-container size on macOS and Windows machines (needed only for the freed-space figure; the line says "space freed unknown" when it cannot).
