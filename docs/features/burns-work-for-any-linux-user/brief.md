## Purpose

Runcastle is moving onto a VPS so work continues with the owner's PC off. The first trial burn there failed after 11 seconds with an error that hid the cause. This feature makes burns work on any Linux user and makes that kind of failure explain itself.

## Understood

- The bug is confirmed in code. `packages/server/src/workflows/burn-cache.ts` has `CONTAINER_USER = '1000:1000'` and chowns the burn cache volume to it, while `stockBuildArgs` in `services/sandbox-image.ts` bakes the host's real UID/GID into the image as `AGENT_UID`/`AGENT_GID`. On the VPS the user `muath` is UID 1001 (`ubuntu` holds 1000), so the agent cannot write to its cache volume. Windows has no `getuid` and defaults to 1000, and most personal Linux machines are UID 1000, which is why nobody saw this.
- The VPS setup agent also reported these, in the same failure path, and they belong here:
  1. The ticket error shows a truncated `mkdir ... burn-guard.sh` command while the real `Permission denied` is further down the log. Show the real cause first.
  2. Doctor passed while burns could not work. It should notice a cache volume the burn user cannot write to.
  3. The image build picked up the wrong group ID: `process.getgid()` returned the wrong group under `sg docker` / `newgrp`, nothing warned, and doctor checks the image's UID but not its GID.
  4. Doctor accepted a `.env` with three token lines, two of them bad. A quick real check that the token authenticates would have caught it.

## Open

- The setup agent saw the trial volume owned `0:0`, not 1000, before it fixed it by hand. That is unexplained: find out whether the chown ran at all. Do not assume the UID mismatch is the whole story until this is answered.
- Existing cache volumes on real machines may already be owned by the old value. Decide what happens to them (the volume is labelled with a layout version).
- Reproduce with a user whose UID is not 1000. Linux is the target; do not regress Windows, where burns must keep working exactly as now.

## Must not swallow

- A settings field for the cache, or any CLI for starting burns. Both were considered and dropped.
- Auto-building a missing image (`burns-build-their-own-image`) and the one-line install.
- Moving the cache design itself. ADR-0004, ADR-0005 and ADR-0011 stand.

## Ordering

This lands first. The move to another machine waits on it, and so does "Burns build their own image", because both touch image and doctor code. "No Node" runs alongside it.

## Working agreement

Checkpoints the human named, for this whole cut (Burns work for any Linux user, Move runcastle to another machine, No Node, Burns build their own image, One-line install):
1. After this feature: the human runs a real burn on the VPS. Stop here before merging, and say how to get this branch onto the VPS.
2. Before the move: it handles the human's real data, so stop before merging that feature and before anything is run against real data.
Everything else is carried through to merged without stopping. Publishing a release needs the human's yes.
