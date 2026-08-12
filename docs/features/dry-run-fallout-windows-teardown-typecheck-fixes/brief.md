# Dry-run fallout: Windows teardown + typecheck fixes

Three small, independent fixes surfaced by the preparation dry run on Windows. All are verified against source; land all three on this branch. They touch disjoint files and have no ordering dependency, EXCEPT the bail-out rule at the end.

---

## 1. `stopDevPane` leaks the dev-pane process tree on Windows (most serious)

**Where:** `packages/server/src/pty/dev-pane.ts:156-169` (`stopDevPane`), with the cause set up at line 61-66 (`devSpawnTarget`).

**Defect:** `stopDevPane` guards its process-group kill with `process.platform !== 'win32'`, so on Windows the only teardown is `reg.kill(paneId)` → `entry.pty.kill()`, which kills the ConPTY's DIRECT child. But `devSpawnTarget` always interposes a `cmd.exe /d /s /c <command>` shim on win32, so the real dev server is a GRANDCHILD and survives. Observed live: after `dry_run_drive stop`, the drive's server stayed bound on its port and held SQLite file locks, so the next drive isn't fresh. This affects EVERY Windows test drive, not any one devCommand.

**Fix:** On win32, kill the whole tree — the standard approach is `taskkill /pid <ptyPid> /T /F` (spawn it, don't shell-interpolate). Keep the POSIX process-group path as is. Preserve idempotency: unknown/already-dead pane stays a no-op, and taskkill failing (tree already gone) must be swallowed like the POSIX catch. Update the doc comment at lines 14-16 and 149-154 — it currently claims ConPTY teardown kills every attached process on Windows, which is false with the cmd shim in place.

**Acceptance:** a test (Windows-meaningful; skip or adapt on POSIX where the group-kill path already covers it) that spawns a pane whose command starts a grandchild (e.g. `cmd /c` wrapping a bun/node child that stays alive), calls `stopDevPane`, and asserts the grandchild is dead / its port freed. After the fix, a full dry-run drive start→stop cycle should leave no orphan process.

---

## 2. `apps/web` typecheck broken on main — AppRouter degrades to `{}`

**Where:** `apps/web/tsconfig.json` — `"types": ["node", "vite/client"]` (no bun-types) while `paths` maps `@runcastle/server` to `packages/server/src/trpc/router.ts`, compiling server source under the web config.

**Defect:** server source uses Bun APIs; without bun-types the router's types collapse and `AppRouter` inference degrades to `{}`. Three downstream errors, currently recorded as the project's known-failure baseline:
- `src/components/EnableAfkCard.tsx(64,81)` TS2339 'results' does not exist on `{}`
- `src/components/SettingsOverlay.tsx(112,36)` TS2741 'fields' missing
- `src/components/SettingsOverlay.tsx(121,7)` TS2322 'unknown' not assignable to ReactNode

These are NOT component bugs — do not patch the components.

**Fix:** make the server router typecheck under the web config with real types. Likely additions of `bun-types` scoped so it does NOT fight the DOM lib in web component files (bun-types vs `lib: ["DOM"]` conflicts are a known hazard). Acceptable shapes: types array addition if it proves clean, a project-references / type-only boundary, or a dedicated tsconfig for the router path. Constraint: web components' DOM typing must not regress, and `AppRouter` must infer real router types (the three baseline errors disappear because the types become correct — not because they're suppressed).

**Acceptance:** `bun run --filter '@runcastle/web' typecheck` exits 0 with zero errors. Note in the ticket result that the project's recorded knownFailures baseline is now stale — clearing it is a human settings action, not repo work.

---

## 3. `project-session.test.ts` EPERM on Windows teardown

**Where:** `packages/server/test/project-session.test.ts` — assertions pass, then `rmSync` cleanup throws EPERM on a held handle. Reproduces 2/2 on Windows.

**Defect:** classic Windows held-handle: something (almost certainly the SQLite client, possibly a PTY/log handle) is still open when teardown removes the temp dir.

**Fix:** close what's open before removal (prefer explicitly closing the db client in afterEach/afterAll), and/or use `rmSync(..., { maxRetries, retryDelay })` which exists for exactly this Windows case. Prefer the real close over retry-masking if both are easy. Check whether sibling test files share the pattern and fix them the same way if they demonstrably fail — don't sweep the whole test tree otherwise.

**Acceptance:** the test file passes with clean teardown on Windows, twice in a row.

---

## Bail-out rule

Fix #2 has rabbit-hole potential (bun-types vs DOM lib). If it isn't converging, LAND #1 and #3 anyway and report #2 back as blocked with what you learned — do not hold the branch hostage to the tsconfig fight. #1 is the fix that unblocks test drives on this machine; it ships regardless.

## Verification

`bun run typecheck` and `env -u GIT_ASKPASS bun run test` must be fully green. `bun run --filter '@runcastle/web' typecheck` green if #2 lands; otherwise unchanged 3-error baseline.
