# Outcome — Review reads project verify commands and explains a failed browser check

Review tickets claim "this project has no verify commands configured" on every project, even ones with verifyCommands set. Cause: packages/server/src/workflows/review-ticket.ts (~line 644) renders `GATE_NOTES: buildGateNotes(deps.config)` from the raw GLOBAL RuncastleConfig, while implementation tickets layer the project's own settings over global via `resolvePreparedSettings(deps.config, ctx.project)` (packages/core/src/config.ts ~line 456; used at ticket-burner.ts ~line 4407 for VERIFY_NOTES). Verify commands and known failures are normally stored on the project row, so the review never sees them and Gates mode degrades to a diff read. Fix: build the review's gate notes from `resolvePreparedSettings(deps.config, project)` (verifyCommands + knownFailures), exactly as the burner does. Test: a project with its own verifyCommands/knownFailures and an empty global config renders those commands in GATE_NOTES; a project with none falls back to global; neither set still renders the 'no verify commands' line.

- Shipped: 2026-09-26
- Laps run: 1

## What shipped

4 commits · 3 files

### Lap 1
- 2 tickets landed: #1 Review tickets claim "this project has no verify commands configured"…; #2 The review's browser health check fails with no recorded cause.…
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: ca10461b7aa72503f38c6b5dcdc1f2483744c20c
- Landed since: 0
- Outcome: done

- **Gates pass: both tickets landed as briefed; no verify gates were available to this review** — open
- **A health-check failure that the retry recovers from is never logged** — open
- **buildGateNotes hand-copies resolvePreparedSettings' inline project type** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 2. The review's browser health check fails with no recorded cause.…

## What was done
- Replaced the boolean `executableIsHealthy` in `packages/server/src/workflows/review-ticket.ts` with `checkExecutableHealth(path, spawn?)`. It returns an `ExecutableHealth` record: ok, path, status, signal, error code/message and elapsedMs.
- The probe is still `spawnSync(path, ['--version'], { timeout: 3_000, stdio: 'ignore' })` with no shell. It retries once when the first attempt fails, so each attempt still has 3s.
- `describeHealthFailure(health)` turns a failed probe into a short line, e.g. `C:\bin\agent-browser.CMD --version: ETIMEDOUT after 3001ms`. It uses the error code, then "killed by <signal>", then "exited with status N".
- `driveWithheldReason`, `buildDriveAvailability` and the private `missingDrivePieces` now take `browserFailure: string | undefined` instead of `browserHealthy: boolean`; `undefined` means healthy. The prose now reads "... failed its health check (<failure>)", so both the recorded reason and the DRIVE_AVAILABILITY prompt block carry the cause. `executeReviewTicket` also logs it with `console.error`.
- Tests in `packages/server/test/review-ticket.test.ts` use an injected `ProbeSpawn`, the process boundary. They cover the reason text for a non-zero exit, a spawn error (ENOENT) and a timeout (ETIMEDOUT). They also check that a failure followed by a success yields an available drive, and that a healthy first probe spawns only once. Existing boolean call sites were updated.

## Surprises
- The full `bun run test` found 295 files, not the 118 in the baseline. It had 2 failures in files this change doesn't touch:
  - `apps/web/test/settings-dialog.test.tsx`: a 5s timeout under load. It passes when run alone.
  - `packages/server/test/dev-pane.test.ts`, "kills the child process tree": `pidAlive(-pgid)` is still true. It fails again when run alone, and looks like process-group reaping in this sandbox.
- Typecheck is clean.

## Left undone
- The first failed attempt is not logged separately; only the final failure is reported.
- No drive machinery changes were needed: no new service, env var, seed or process.
