# Outcome — Burn bootstrap mechanics

Create the burn cache directories that burnCacheEnv points at. packages/server/src/workflows/burn-cache.ts:102-103 sets TMPDIR to ${BURN_CACHE_MOUNT}/tmp and NODE_COMPILE_CACHE to ${BURN_CACHE_MOUNT}/node-compile, but nothing creates either: ensureBurnCacheVolume (burn-cache.ts:204-232) only creates the volume and chowns it, buildSlotSetupCommand (ticket-burner.ts:1513-1528) only mkdirs the slot dir, and the host-side mkdirSync at ticket-burner.ts:4069 is skipped for volume mounts. Result observed on a real project: every ticket died on a missing /home/agent/cache/tmp until the operator pasted `mkdir -p /home/agent/cache/tmp &&` into their setup command. Fix: mkdir -p tmp, node-compile and the store/<pm> path (storePath at burn-cache.ts:79) inside the slot setup command, before the project's setup command runs, for both the slotted path and the no-slot fallback. Unit test: the rendered slot setup command contains the mkdir for every path burnCacheEnv references, derived from the same constants so they cannot drift.

- Shipped: 2026-09-15
- Laps run: 1

## What shipped

20 commits · 41 files

### Lap 1
- 7 tickets landed: #1 Create the burn cache directories that burnCacheEnv points at.…; #2 Stop preflight-probing binaries that setup itself shims, and surface…; #3 Commit runcastle's own docs checkpoints with hooks off. Every docs…; #4 Teach the burn timing categoriser Codex tool names. classifyToolCall…; #5 Make the sandbox mirror-push hook tolerate an amended commit. A burn…; #6 Rebuild-image says which Dockerfile it is about to build. The settings…; #7 Loud recovery after a server restart kills a burn. When the server…
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: fa6885ca397a3d60412768a6c028a414dea88cd1
- Landed since: 0
- Outcome: done

- **Drive could not start because the checkout is dirty** — open
- **Image-build disclosure could not be exercised in the demo snapshot** — open
- **Run-card unrunnable-gate state was not present in the available demo data** — open
- **Restart-recovery alert could not be preserved across the managed restart** — open

## Notes record

- No human notes
