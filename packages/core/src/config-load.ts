import { existsSync, readFileSync } from 'node:fs'
import { totalmem } from 'node:os'
import { RuncastleConfig, resolveDefaultWorkersAtOnce } from './config'
import { configPath } from './paths'

/**
 * Read-compat for session kinds collapsed into `chat`: legacy `ideation`
 * becomes `chat` unless `chat` is set, and `qa`/`revisit` are dropped. This
 * applies only to persisted config, and is the one migration both
 * {@link loadConfig} and the settings view/write-through run, so what Settings
 * shows is what a launch uses — and the settings write-through persists the
 * migrated map, so the removed keys disappear on the next write.
 */
export const migrateCollapsedModelSteps = (raw: unknown): unknown => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw

  const config = { ...(raw as Record<string, unknown>) }
  if (
    typeof config.stepModels !== 'object' ||
    config.stepModels === null ||
    Array.isArray(config.stepModels)
  ) {
    return config
  }

  const stepModels = { ...(config.stepModels as Record<string, unknown>) }
  if (stepModels.chat === undefined && stepModels.ideation !== undefined) {
    stepModels.chat = stepModels.ideation
  }
  delete stepModels.ideation
  delete stepModels.qa
  delete stepModels.revisit
  config.stepModels = stepModels
  return config
}

/**
 * Node-only config loader. Pulls in `node:fs` + `./paths` (which imports
 * `node:os`/`node:path`), so it is deliberately kept OUT of the core barrel and
 * imported directly via `@runcastle/core/config-load`. The schema it validates
 * against is the pure one in `./config`.
 *
 * `loadConfig` merges `~/.runcastle/config.json` (if present) with a handful of
 * env overrides. The file read is lazy (inside the function) so that importing
 * this module performs no IO — only calling `loadConfig()` touches disk. A
 * missing/invalid file falls back to schema defaults, except for the one
 * default that depends on the machine: `burnConcurrency`, resolved here from
 * {@link hostTotalMemory} because core's schema may not read the host.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  /** Host memory in bytes behind the `burnConcurrency` default; injected by tests. */
  totalMemBytes: number = hostTotalMemory(),
): RuncastleConfig {
  let fileConfig: unknown = {}
  const path = configPath()
  if (existsSync(path)) {
    try {
      fileConfig = migrateCollapsedModelSteps(JSON.parse(readFileSync(path, 'utf8')))
    } catch {
      fileConfig = {}
    }
  }

  const overrides: Record<string, unknown> = {}
  /**
   * Set a numeric override from an env var. An UNSET variable and an
   * exported-but-EMPTY one (`export RUNCASTLE_BURN_CONCURRENCY=`, or a CI matrix that
   * declares a variable without giving it a value) both mean "no override":
   * `Number('')` is `0`, which is a meaningful setting for some of these keys
   * and would otherwise land silently.
   *
   * Every other value goes through `Number()` and is left for
   * `RuncastleConfig.parse` to accept or reject — so an explicit `0` reaches the
   * schema, and an out-of-range or unparseable one fails loudly instead of being
   * dropped on the floor.
   */
  const num = (key: string, raw: string | undefined): void => {
    if (raw !== undefined && raw !== '') overrides[key] = Number(raw)
  }

  num('serverPort', env.RUNCASTLE_SERVER_PORT)
  if (env.RUNCASTLE_MODEL) overrides.model = env.RUNCASTLE_MODEL
  // Legacy env var (issue #48): folded into `stepModels.smoke` by the schema's
  // read-compat preprocess unless the smoke step is already set explicitly.
  if (env.RUNCASTLE_SMOKE_MODEL) overrides.smokeModel = env.RUNCASTLE_SMOKE_MODEL
  if (env.RUNCASTLE_SESSION_MCP) overrides.sessionMcp = env.RUNCASTLE_SESSION_MCP
  if (env.RUNCASTLE_USAGE_SIGNAL) overrides.usageSignal = env.RUNCASTLE_USAGE_SIGNAL
  if (env.RUNCASTLE_CARRY_ON_AFTER_LIMIT) overrides.carryOnAfterLimit = env.RUNCASTLE_CARRY_ON_AFTER_LIMIT
  num('burnConcurrency', env.RUNCASTLE_BURN_CONCURRENCY)
  if (env.RUNCASTLE_SETUP_COMMAND) overrides.setupCommand = env.RUNCASTLE_SETUP_COMMAND
  if (env.RUNCASTLE_VERIFY_COMMANDS) overrides.verifyCommands = env.RUNCASTLE_VERIFY_COMMANDS
  if (env.RUNCASTLE_KNOWN_FAILURES) overrides.knownFailures = env.RUNCASTLE_KNOWN_FAILURES

  const base = typeof fileConfig === 'object' && fileConfig !== null ? fileConfig : {}
  const merged: Record<string, unknown> = { ...base, ...overrides }
  // The one default that depends on the machine. The schema cannot read memory,
  // so a number nobody chose is resolved here instead; a file or env value is
  // already in `merged` and therefore wins untouched.
  if (merged.burnConcurrency === undefined) {
    merged.burnConcurrency = resolveDefaultWorkersAtOnce(totalMemBytes)
  }
  return RuncastleConfig.parse(merged)
}

/** This host's total memory in bytes, behind the default number of workers at once. */
export function hostTotalMemory(): number {
  return totalmem()
}
