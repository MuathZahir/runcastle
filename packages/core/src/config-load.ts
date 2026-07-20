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
  if (env.RUNCASTLE_SERVER_PORT) overrides.serverPort = Number(env.RUNCASTLE_SERVER_PORT)
  if (env.RUNCASTLE_MODEL) overrides.model = env.RUNCASTLE_MODEL
  // Legacy env var (issue #48): folded into `stepModels.smoke` by the schema's
  // read-compat preprocess unless the smoke step is already set explicitly.
  if (env.RUNCASTLE_SMOKE_MODEL) overrides.smokeModel = env.RUNCASTLE_SMOKE_MODEL
  if (env.RUNCASTLE_SANDBOX) overrides.sandbox = env.RUNCASTLE_SANDBOX
  if (env.RUNCASTLE_MAIN_BRANCH) overrides.mainBranch = env.RUNCASTLE_MAIN_BRANCH
  if (env.RUNCASTLE_SANDBOX_IMAGE) overrides.sandboxImage = env.RUNCASTLE_SANDBOX_IMAGE
  if (env.RUNCASTLE_BURN_CONCURRENCY) {
    overrides.burnConcurrency = Number(env.RUNCASTLE_BURN_CONCURRENCY)
  }
  if (env.RUNCASTLE_BURN_MAX_ITERATIONS) {
    overrides.burnMaxIterations = Number(env.RUNCASTLE_BURN_MAX_ITERATIONS)
  }
  if (env.RUNCASTLE_SETUP_COMMAND) overrides.setupCommand = env.RUNCASTLE_SETUP_COMMAND

  const base = typeof fileConfig === 'object' && fileConfig !== null ? fileConfig : {}
  return RuncastleConfig.parse({ ...base, ...overrides })
}
