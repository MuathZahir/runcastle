import { existsSync, readFileSync } from 'node:fs'
import { RuncastleConfig } from './config'
import { configPath } from './paths'

/**
 * Node-only config loader. Pulls in `node:fs` + `./paths` (which imports
 * `node:os`/`node:path`), so it is deliberately kept OUT of the core barrel and
 * imported directly via `@runcastle/core/config-load`. The schema it validates
 * against is the pure one in `./config`.
 *
 * `loadConfig` merges `~/.runcastle/config.json` (if present) with a handful of
 * env overrides. The file read is lazy (inside the function) so that importing
 * this module performs no IO — only calling `loadConfig()` touches disk. A
 * missing/invalid file falls back to schema defaults.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): RuncastleConfig {
  let fileConfig: unknown = {}
  const path = configPath()
  if (existsSync(path)) {
    try {
      fileConfig = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      fileConfig = {}
    }
  }

  const overrides: Record<string, unknown> = {}
  /**
   * Set a numeric override from an env var. An UNSET variable and an
   * exported-but-EMPTY one (`export RUNCASTLE_BURN_CPUS=`, or a CI matrix that
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
  if (env.RUNCASTLE_SANDBOX) overrides.sandbox = env.RUNCASTLE_SANDBOX
  if (env.RUNCASTLE_SESSION_MCP) overrides.sessionMcp = env.RUNCASTLE_SESSION_MCP
  if (env.RUNCASTLE_SANDBOX_IMAGE) overrides.sandboxImage = env.RUNCASTLE_SANDBOX_IMAGE
  num('burnConcurrency', env.RUNCASTLE_BURN_CONCURRENCY)
  num('burnMaxIterations', env.RUNCASTLE_BURN_MAX_ITERATIONS)
  num('burnAttempts', env.RUNCASTLE_BURN_ATTEMPTS)
  // The key that made `num` necessary: `0` is meaningful here (disable in-loop
  // conflict resolution), so truthiness would swallow it — while the presence
  // check it used to have let `''` land as a silent `0`.
  num('burnConflictAttempts', env.RUNCASTLE_BURN_CONFLICT_ATTEMPTS)
  num('burnCpus', env.RUNCASTLE_BURN_CPUS)
  // Kill switch for the in-sandbox PreToolUse guard. Config-file + env only
  // (like `burnWorkspace`): a rarely-touched escape hatch, and the settings
  // overlay has no boolean control. Empty is unset here too — an exported-empty
  // var meant "guard on, explicitly", which is not what the operator said.
  if (env.RUNCASTLE_BURN_GUARD !== undefined && env.RUNCASTLE_BURN_GUARD !== '') {
    overrides.burnGuard = env.RUNCASTLE_BURN_GUARD !== '0' && env.RUNCASTLE_BURN_GUARD !== 'false'
  }
  if (env.RUNCASTLE_SETUP_COMMAND) overrides.setupCommand = env.RUNCASTLE_SETUP_COMMAND
  if (env.RUNCASTLE_VERIFY_COMMANDS) overrides.verifyCommands = env.RUNCASTLE_VERIFY_COMMANDS
  if (env.RUNCASTLE_KNOWN_FAILURES) overrides.knownFailures = env.RUNCASTLE_KNOWN_FAILURES
  if (env.RUNCASTLE_BURN_WORKSPACE) overrides.burnWorkspace = env.RUNCASTLE_BURN_WORKSPACE

  const base = typeof fileConfig === 'object' && fileConfig !== null ? fileConfig : {}
  return RuncastleConfig.parse({ ...base, ...overrides })
}
