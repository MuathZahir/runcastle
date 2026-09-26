# Outcome — Install runcastle from local main without publishing

Add `scripts/install-local.ts` and a root script `"install:local": "bun run scripts/install-local.ts"` that installs the CURRENT LOCAL `main` as the global `runcastle` package, with no npm publish, so the owner (who runs the installed runcastle as their orchestrator, never from source) can pick up merged fixes in one command. Style and helpers should mirror `scripts/release.ts` (die/step/run/capture, Bun `$`, node:path). Steps: (1) Build from an isolated snapshot, never from the human's checkout: that checkout is also runcastle's test-drive target and may be parked on a feature branch or dirty. `git worktree add --detach <tmp> main` in a temp dir (os.tmpdir()), always removed in a finally (`git worktree remove --force` + prune). Accept an optional ref arg (`bun run install:local [ref]`, default `main`). (2) In the snapshot: `bun install --frozen-lockfile`, then build the package exactly as `.github/workflows/release.yml` does (`bun run build:pkg` in packages/server; read the workflow step for the env it sets, e.g. the injected release version). Version stamp: `<latest v* tag without v>-local.<short sha>` (e.g. `1.4.1-local.ebc6eaab`) so `runcastle --version`/doctor shows it is a local build. Run the same built-manifest sanity check as the workflow (name === 'runcastle'). (3) Pack `packages/server/build` into a tarball (`bun pm pack` or `npm pack`; verify which works with the built manifest) into the temp dir, then `bun add -g <tarball>`; verify with context7/bun docs that bun global install from a local tarball path works on Windows, and fall back to `npm install -g <tarball>` only if it does not. (4) Refuse (exit 1, clear message) if something is listening on port 4512 — a running server holds the global install's files on Windows and stopping it would kill every live session's PTY, so the human stops it themselves; message: 'runcastle is running on :4512 — stop it (close its window / Ctrl+C), then re-run'. Add `--skip-running-check` to bypass. (5) Flags: `--no-install` skips `bun install` (reuse nothing else); default runs typecheck? NO — keep it fast: do not run typecheck/tests by default, add `--check` to run `bun run typecheck` and `bun run test` in the snapshot before packing. (6) Print a final summary: version installed, ref + sha, and 'start it with: runcastle'. Also add a short 'Installing a local build' section to docs/RELEASE.md describing usage and that `bun add -g runcastle@latest` returns to the published version. No tests required beyond the script typechecking under scripts/tsconfig.json (it is included in `bun run typecheck`); keep pure helpers (version stamp, arg parsing) small and unit-test them if trivial.

- Shipped: 2026-09-26
- Laps run: 1

## What shipped

10 commits · 8 files

### Lap 1
- 4 tickets landed: #1 Add `scripts/install-local.ts` and a root script `"install:local": "bun…; #3 --no-install always fails: the fresh snapshot has no node_modules, so build:pkg cannot resolve anything; #4 A local build ranks below its base tag, so the update banner tells the owner to install the published version over their fixes; #5 The running-server guard probes a hardcoded 4512 and ignores the configured serverPort
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 0172d746304ef37866d44017a7b020342bbe8b63
- Landed since: 3
- Outcome: done

### Lap 1 · verification

- Reviewed commit: bda98c3a691f6fc764071ec2c9c96e9594055a20
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 4. A local build ranks below its base tag, so the update banner tells the owner to install the published version over their fixes

**What was done.** Fixed the version ordering in `compareSemver` (`packages/server/src/services/update-check.ts`). A version whose prerelease starts with `local` now ranks above the release it was built on, so 1.4.1 < 1.4.1-local.x < 1.4.2. That means `checkForUpdate` does not offer the published base release to a local install, and it still offers a genuinely newer release. The `local` marker is now a single exported constant, `LOCAL_BUILD_PRERELEASE`, which `localBuildVersion` in `dev/install-local.ts` uses to stamp builds, so the stamp and the comparison can't drift apart. I added tests at the `compareSemver` and `checkForUpdate` seams. I chose to fix the ordering rather than hide the banner for local builds, so a local build still hears about a real 1.4.2.

**Repro re-run.** `compareSemver('1.4.1', '1.4.1-local.ebc6eaab')` now returns -1. `checkForUpdate({ current: '1.4.1-local.ebc6eaab' })` with a fetch that answers latest 1.4.1 now gives `updateAvailable: false`. I did not run the end-to-end step (install:local, then the UI banner), because this sandbox has no app or host install.

**Surprises.** Typecheck passed. The full test suite had 2 failures that don't match the stated baseline. Neither involves my change:
- `apps/web/test/settings-dialog.test.tsx` timed out under full-suite load and passes when run on its own.
- `packages/server/test/dev-pane.test.ts` "kills the child process tree so the port-holder is not orphaned" fails even when run on its own. It tests process-tree killing, doesn't touch the update check, and looks like a sandbox environment issue.

**Left undone.** Two local builds of the same base compare by sha string, which is a deterministic order but not a meaningful one. This is harmless because npm `latest` is never a local build. No drive machinery changes were needed.
