/**
 * Test-env firewall.
 *
 * Runs in every worker before any test file. It deletes every `RUNCASTLE_*`
 * variable it finds, so a test process can never inherit the developer's live
 * runcastle state.
 *
 * The footgun this closes: a test run started from a shell that has runcastle
 * env exported — `bun run dev` sets `RUNCASTLE_DATA_DIR`, and a talk session
 * spawns its agent with the whole runcastle env — silently reads the real
 * install. `RUNCASTLE_DATA_DIR` in particular OUTRANKS the home override in
 * core's `dataDir()`, so the temp-`HOME` isolation the git/runner/session tests
 * rely on is bypassed entirely and they run against the developer's actual
 * `~/.runcastle`: stale migrations, real projects, real worktrees.
 *
 * Deleting is safe because no test reads an inherited value: the ones that
 * exercise env handling either inject an env object (`resolveTool({ env })`,
 * `getSettings(…, io({…}))`) or set the variable themselves and restore it
 * afterwards.
 */
for (const key of Object.keys(process.env)) {
  if (key.startsWith('RUNCASTLE_')) delete process.env[key]
}
