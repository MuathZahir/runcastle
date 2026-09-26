# Outcome — Merge is not blocked by another project's drive

Merging a feature is refused whenever ANY drive holds the global drive slot, even a drive in a different project. Expected: a drive in project B never blocks a merge in project A. Actual: `mergeFeature` (packages/server/src/services/git.ts, the `if (testDriveState) throw new GateError('Cannot merge while a test drive is active — stop it first')` guard near line 3265) checks the slot's existence, not whose it is. The guard exists to protect THIS repo's checkout from being switched mid-merge; a drive of another project never touches this repo. Fix: deny only when the slot-holder belongs to the same project as the merge. `dryRun` and `project` DriveState variants already carry `projectId`; the `feature` variant does not — add `projectId` to it (set where the feature drive starts, same as the others) or resolve it from `featureId`, then compare against `project.id` in `mergeFeature`. Keep the single shared drive slot exactly as is (decision 9: drives of any kind/project collide over ports, dev pane and database server) — this ticket does NOT allow concurrent drives, only unblocks merges. Keep the same-project behaviour unchanged (the tRPC merge handler in packages/server/src/trpc/routers/feature.ts ~line 210 still stops a same-project project drive first; a same-project feature/dry-run drive still denies). Add tests: a merge in project A succeeds while project B holds a feature drive, a project drive, and a dry run; a merge in A is still denied while A holds a drive.

- Shipped: 2026-09-26
- Laps run: 1

## What shipped

2 commits · 3 files

### Lap 1
- 1 tickets landed: #1 Merging a feature is refused whenever ANY drive holds the global drive…
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 54da2546fa532cfe9faa422b242069a5e5dc5828
- Landed since: 0
- Outcome: done

- **Gates-mode pass: no verify gates configured; both review axes clean** — open

## Notes record

- No human notes
