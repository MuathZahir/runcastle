import { existsSync, readFileSync } from 'node:fs'
import * as z from 'zod'
import { configPath } from './paths'

/**
 * Runtime configuration. `loadConfig` merges `~/.runcastle/config.json` with a
 * handful of env overrides. The file read is lazy (inside the function) so that
 * importing core performs no IO — only calling `loadConfig()` touches disk.
 */

export const RuncastleConfig = z.object({
  serverPort: z.number().default(4512),
  model: z.string().default('claude-opus-4-8'),
  smokeModel: z.string().default('claude-haiku-4-5-20251001'),
  sandbox: z.enum(['docker', 'noSandbox']).default('docker'),
  mainBranch: z.string().default('main'),
  /**
   * Docker image name for the sandcastle burner sandbox (B3 / SPEC §8). When
   * unset, sandcastle derives its default (`sandcastle:<repo-dir-name>`). The
   * demo image is tagged `sandcastle:runcastle-demo`. Ignored for `noSandbox`.
   */
  sandboxImage: z.string().optional(),
})
export type RuncastleConfig = z.infer<typeof RuncastleConfig>

/**
 * Load config from `~/.runcastle/config.json` (if present) merged with env
 * overrides. Missing/invalid file falls back to schema defaults.
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
  if (env.RUNCASTLE_SMOKE_MODEL) overrides.smokeModel = env.RUNCASTLE_SMOKE_MODEL
  if (env.RUNCASTLE_SANDBOX) overrides.sandbox = env.RUNCASTLE_SANDBOX
  if (env.RUNCASTLE_MAIN_BRANCH) overrides.mainBranch = env.RUNCASTLE_MAIN_BRANCH
  if (env.RUNCASTLE_SANDBOX_IMAGE) overrides.sandboxImage = env.RUNCASTLE_SANDBOX_IMAGE

  const base = typeof fileConfig === 'object' && fileConfig !== null ? fileConfig : {}
  return RuncastleConfig.parse({ ...base, ...overrides })
}
