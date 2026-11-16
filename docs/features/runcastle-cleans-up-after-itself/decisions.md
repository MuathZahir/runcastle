# Decisions — Runcastle cleans up after itself

Planned with nobody present (2026-11-16). Decisions 1–3 are the human's, from the brief; the rest are assumed.

Check first: 4, 7, 8, 10, 12

## 1. Everything runcastle makes is removed once it is no longer needed
**Decision:** Worker containers, sandbox images and their build cache, volumes, drive data folders, worker origins and branches, worktrees and review captures are removed once nothing needs them, including after a crash, a kill, a usage limit, a server restart or a test drive. Nothing runcastle did not create is touched, and nothing that holds work not yet on a branch is removed.
**Why:** On 2026-11-16 runcastle filled the human's disk (96 GB, 192 MB free); about 40 GB of it was runcastle's leftovers. The human: "I don't want runcastle filling people's disks."

## 2. A worker's container goes when its work lands or it is dropped
**Decision:** A worker's container is removed as soon as its work lands or it is dropped, not when the feature merges. Only a handed-back worker, which the human may still open and talk to, keeps its stopped container until the feature merges or the worker is landed or dropped. A landed or dropped worker's conversation stays readable without its container.
**Why:** Two landed workers of one open feature held 3.7 and 4.5 GB each. The human: "Ok".

## 3. It works for every runcastle user
**Decision:** The cleanup runs in the worker sandbox engine, drives, image builds and the server's start-up sweep, for every runcastle user on any machine: Docker or Podman, on Linux, macOS or Windows.
**Why:** The brief's who and where, settled with the human.

## 4. A worker keeps a stopped container only while it might go on
**Decision:** A worker that is working, waiting out a usage limit, handed back or failed keeps its container, stopped whenever its agent is not running (after 30 idle minutes, and now also when the server shuts down). It is removed, with its origin copy and branch, the moment it lands or is dropped, or when its feature merges, is archived or is deleted. A worker that fails while it is still being set up has done no work, so its container goes at once.
**Why:** Decision 2 keeps what the human may still open; a failed worker may still hold commits the lead wants to look at or retry from. Today land, fail and server shutdown leave containers running, and a worker that failed during setup is forgotten with its container still running (the brief's leak 2).
**Assumed.** Alternative: remove a failed worker's container at once too, losing any commits not yet fetched.

## 5. Runcastle marks what it makes, and each install only cleans its own
**Decision:** Every container, image and volume runcastle makes carries a mark saying runcastle made it and which runcastle data folder it belongs to. A sweep removes a container when its data folder is this one and no live worker owns it, or when its data folder no longer exists. It never touches a container marked with another data folder that still exists, so a test drive's runcastle and the real one cannot remove each other's work.
**Why:** Today the start-up sweep only reads database rows, so containers whose row lost its name are invisible (leak 2), and a drive's runcastle copies the real database and could remove the real install's containers. The mark answers the brief's open "how does a sweep tell a live drive's containers from an orphan's".
**Assumed.** Alternative: match by name only, which cannot tell two installs on one machine apart.

## 6. The sweep runs at start-up, when a drive ends, and every hour
**Decision:** Runcastle sweeps for its own leftovers when the server starts, when a test drive stops, and once an hour while it runs. A drive's stop also removes that drive's containers before its data folder is deleted.
**Why:** A crash or kill leaves no chance to clean in the moment, and a server that runs for weeks would otherwise only catch leftovers on its next restart. The drive containers in leak 3 ran two days after their drive ended.
**Assumed.** Alternative: start-up and drive stop only, no hourly sweep.

## 7. Leftovers from older runcastle versions are removed once
**Decision:** The first sweep after upgrading also removes what earlier versions left: containers of the retired burn engine (named `sandcastle-…` and `runcastle-run_…`, still running 10–12 days on this machine), worker containers made before the mark existed, the old shared `runcastle-worker-cache` volume, and the cache volumes of projects no longer in runcastle. The burn engine's old worktrees inside the human's own repo (`.sandcastle/worktrees`, 1.9 GB here) are removed only when they hold no uncommitted changes; any others are left and named on the project timeline.
**Why:** Those leftovers sit on every machine that ran an older runcastle and nothing else will ever remove them. The worktree rule keeps the brief's "never remove work not yet on a branch".
**Assumed.** Alternative: clean only what this version makes, and tell the human how to remove older leftovers by hand.

## 8. Image builds keep no cache, and a replaced image is removed
**Decision:** Runcastle builds its sandbox images in a builder of its own and keeps no build cache afterwards. When a new image replaces an old one, the old one is removed once no container uses it, and a removed project's image goes with it.
**Why:** Docker's build cache cannot be told apart by owner, so pruning it would touch the human's own builds; a builder of runcastle's own can be emptied safely. Rebuilds are rare (only when the image is missing or its recipe changed), so losing the cache costs a few minutes now and then. On this machine the cache held 3.7 GB.
**Assumed.** Alternative: keep the build cache for faster rebuilds and only remove replaced images.

## 9. A project's cache volume stays while the project does, but its temp files do not
**Decision:** Each project's dependency cache volume is kept while the project exists and removed when the project is removed. Temp files on it older than a day are deleted when a worker starts. There is no size limit on the cache itself.
**Why:** The cache saves minutes on every worker start, so it is still needed. Its temp folder is a leak: on this machine it held 45,000 test leftovers (900 MB).
**Assumed.** Alternative: also cap the cache volume at a fixed size and clear it when it grows past that.

## 10. Review captures go 30 days after their feature closes
**Decision:** A feature's review captures (screenshots and recordings) are kept while it is open and for 30 days after it ships or is archived, then removed. A deleted feature's captures go at once. Old captures from the retired burn engine follow the same rule through their feature.
**Why:** Captures are what the review package and the chat show, so they matter while the work is fresh; after that they only fill the disk (1.4 GB across 488 folders here). Nothing removes them today, not even deleting the feature.
**Assumed.** Alternative: keep them forever but only the last review of each feature.

## 11. Cleanup is quiet, with one line on the timeline
**Decision:** Cleanup adds no screen or setting. When a sweep removes leftovers it adds one line to the project's timeline saying what it removed and how much space came back, e.g. "Removed 3 leftover containers and 1 old image (11.2 GB)". Cleanup that is part of a normal land, drop or merge adds no line of its own. A failed removal is a timeline line too, never a blocked merge.
**Why:** The brief rules out a dashboard; one line lets the human see it working without looking for it.
**Assumed.** Alternative: fully silent, only the server log.

## 12. Shrinking each worker's 4 GB is a separate feature
**Decision:** This feature removes containers; it does not make them smaller. The ~4 GB per worker is a full clone plus a full dependency install copied into the container, plus a copy of the human's Claude plugins and skills (about 40,000 files). Shrinking it is parked as its own backlog feature.
**Why:** Shrinking changes how every worker starts and needs its own measurements across package managers (ADR-0004 found a mounted store made pnpm 7× slower). Kept here it would double this feature.
**Assumed.** Alternative: do the shrinking here too.
