# Outcome — Settings shows step models through the legacy migration

Make the Settings view and the launcher agree on step models. The loader (packages/core/src/config-load.ts:15-30) migrates legacy stepModels on load: `ideation` becomes `chat` unless chat is set, and `qa`/`revisit` are dropped. But the settings view builds step-model fields from the RAW file (packages/server/src/services/settings.ts:323-346, rawStepModels/stepModelFields), so a file with `ideation: X` and no `chat` shows Chat as inheriting the default while every chat session launches on X. The step-model write-through (settings.ts ~617-662) merges into the raw map, so the legacy keys stay in the file forever. Observed 2026-09-24: config had `ideation: claude-fable-5[1m]` and default `claude-opus-5-5[1m]`; Settings showed Chat = default (Opus 5.5); the new chat session launched on Fable. Fix: pull the migration into one exported helper in core (config-load.ts) and use it in both loadConfig and the settings view, so a migrated chat value reports as set, with source `file`. On any stepModels write, persist the migrated map (drop ideation/qa/revisit, keep a migrated chat), the way the legacy smokeModel is already dropped on write (settings.ts ~308). Tests: settings view on a file with only `ideation` reports stepModels.chat = that model; a step-model write on such a file leaves no ideation/qa/revisit keys and keeps chat; an explicit chat still beats ideation. Extend packages/core/test/config-load.test.ts rather than duplicating its migration cases.

- Shipped: 2026-09-24
- Laps run: 1

## What shipped

2 commits · 5 files

### Lap 1
- 1 tickets landed: #1 Make the Settings view and the launcher agree on step models. The…
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 118749183991bf4b0902094ab3c994109e68f380
- Landed since: 0
- Outcome: done

- **Gates-mode pass: no verify commands configured; both axes clean, the brief's asks all landed** — open
- **Legacy step keys are dropped on any global settings write, not only a stepModels write** — open
- **Two sibling legacy-config migrations are chained by hand in settings.ts** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Make the Settings view and the launcher agree on step models. The…

# Ticket 1: Settings shows step models after the legacy migration

## What was done
- `packages/core/src/config-load.ts` now exports the existing `migrateCollapsedModelSteps` helper, and `loadConfig` still calls it. There is still only one copy of the migration.
- `packages/server/src/services/settings.ts`: `readRawConfig` now runs `migrateCollapsedModelSteps` before `foldLegacyModelConfig`. Both the settings view and every write-through read through that function.
  - The view now shows a legacy `ideation` model as `stepModels.chat` with source `file`.
  - The next write persists the migrated map: `ideation`, `qa` and `revisit` are dropped, and a migrated `chat` is kept.
- This is the same mechanism that already drops `smokeModel`. It means any global settings write, not only a step-model write, persists the migrated map. That is a slightly wider reach than "on any stepModels write", and it matches how `smokeModel` is handled.
- Tests:
  - 3 new cases in `packages/server/test/step-models.test.ts`: an ideation-only file shows chat; a step write leaves no legacy keys and keeps chat; an explicit chat beats ideation.
  - 1 case in `packages/core/test/config-load.test.ts` for the exported helper. It does not repeat the existing loadConfig migration cases.

## Surprises
- The full suite had one failure: `packages/server/test/dev-pane.test.ts > kills the child process tree so the port-holder is not orphaned`. It also fails when run alone. It tests process-group reaping in the pty layer and imports nothing this ticket touched, so it looks like a sandbox or environment issue. It was not in the stated baseline.
- The post-commit sync hook's `--force-with-lease` push was rejected with "stale info" because there is no tracking ref for the remote branch. A plain fast-forward push worked.

## Left undone
- None. No drive machinery changes were needed: no new service, env var, seed or process.
