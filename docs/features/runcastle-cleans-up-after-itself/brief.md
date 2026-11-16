## Purpose

On 2026-11-16 the human's machine hit a full disk: 96 GB used, 192 MB free, and a worker container was killed, likely because of it. Docker held ~62 GB, mostly runcastle's: seven `runcastle-worker-*` containers killed (exit 137) and never removed, 3.7–6.2 GB each (31.5 GB); 3.8 GB build cache; 3.6 GB unused images and volumes. The human: "I don't want runcastle filling people's disks. We need to make sure that runcastle is cleaning after itself."

## Decided with the human (2026-11-16)

- What: everything runcastle creates (worker containers, sandbox images and build cache, volumes, drive data folders, worker origins and branches, worktrees, review captures) is removed once it is no longer needed, including after a crash, a kill, a usage limit, a server restart or a test drive. The human: "Yes" to creating this feature, planned automatically.
- A worker's container is removed as soon as its work lands or it is dropped, not when the feature merges. Only handed-back workers (which the human may still open and talk to) keep their stopped container until the feature merges or the worker is landed/dropped. The human: "Ok". Check that a landed or dropped worker's conversation stays readable without its container (it is kept outside, via `keepConversation`); if reopening one needs the container, say so.
- Where: the worker sandbox engine, drives, image builds, the server's start-up sweep.
- Who: every runcastle user, on any machine (Docker or Podman, Linux/macOS/Windows).

## Understood (the orchestrator's read of this machine and the code, 2026-11-16 — verify)

Three leaks, seen live:
1. Kept on purpose until merge: `stopSandbox` (`packages/server/src/workers/worker.ts`) stops but keeps the filesystem; `removeSandbox` runs only from `retireWorker` and from `stopLeftoverWorkerSandboxes` at server start (`workers/service.ts`), and only for workers whose row still names a container. Two landed workers of `a-faster-web-app` held 3.7 and 4.5 GB each while the feature was still open.
2. Dropped or failed workers whose row has `container: null` while their container keeps running: `sess_70dIX_mM9q9t` (dropped, running 24 min), `sess_Yfozl0i2pDhw` (failed, 2 days), `sess_WFyEkhaULIvO` (dropped, 6 days). The start-up sweep cannot see them because it only reads rows with a container.
3. A test drive of runcastle itself runs a second runcastle with its own data folder (`~/.runcastle-drive-<slug>`). Its worker containers outlived the drive and the folder: three ran for 2 days, mounting `~/.runcastle-drive-workers_nest_under_their_feature`, which no longer existed.
- The orchestrator removed those eight containers by hand with the human's yes (disk went from 23 GB to 36 GB free). Two handed-back review containers of `epic-messages-reach-a-busy-agent-at-once` were kept.
- Each worker container's writable layer is ~3.7–4.5 GB, likely the project's dependency install inside the container. Find out what fills it and whether it can be smaller (the burner had a dependency-cache decision: ADR-0004, ADR-0005).
- Containers carry labels (`runcastle.claude-code-version`, `runcastle.dockerfile-hash`); a sweep can find every runcastle container by name or label, not only by database rows.
- Sandbox images are rebuilt when the dockerfile hash changes (ADR-0018); old images and build cache may be left behind.

## Must not swallow

- Cleaning anything runcastle did not create (the human's own images, containers, caches, ~/.npm, ~/.bun).
- A disk-usage dashboard or settings page.
- Removing anything that holds work not yet on a branch.

## Open

- What fills ~4 GB per worker, and whether that can shrink.
- How a sweep tells a live drive's containers from an orphan's when several runcastle data folders exist.
- Whether review captures (`~/.runcastle/reviews`, 1.4 GB here) need a limit.

## Ordering

Independent. It touches `workers/service.ts` and `workers/worker.ts`; no in-flight feature of this epic is known to change those.

Planning mode: automatic
