/**
 * `bun run burn-cache:probe <repoPath> [--engine docker|podman] [--keep]`
 *
 * Drives two consecutive burn-style containers through the real slot setup path
 * and prints what each cache did between them (decision 7). The work lives in
 * `packages/server/src/workflows/burn-cache-probe.ts` — that is where
 * `@ai-hero/sandcastle` resolves, and where its pure decision logic is unit
 * tested; this file is only the entry point the root script name points at.
 *
 * Exit codes: `0` every expected cache hit, `1` one did not, `2` the probe
 * could not run at all (bad usage, no engine, no image, a failing command).
 */
import {
  ProbeError,
  formatCacheTable,
  parseProbeArgs,
  runBurnCacheProbe,
} from '../packages/server/src/workflows/burn-cache-probe.ts'

export async function probeMain(argv: readonly string[]): Promise<number> {
  try {
    const args = parseProbeArgs(argv)
    const result = await runBurnCacheProbe({ ...args, log: (line) => console.log(line) })
    console.log('')
    console.log(formatCacheTable(result.rows))
    return result.exitCode
  } catch (err) {
    console.error(err instanceof ProbeError ? err.message : err)
    return 2
  }
}

if (import.meta.main) process.exitCode = await probeMain(process.argv.slice(2))
