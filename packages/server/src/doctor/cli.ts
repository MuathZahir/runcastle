import { existsSync, readFileSync } from 'node:fs'
import {
  AGENT_RUNTIMES,
  configuredRuntimes,
  resolveSandboxImage,
  type AgentRuntime,
} from '@runcastle/core'
import { envPath } from '@runcastle/core/paths'
import { loadConfig } from '@runcastle/core/config-load'
import { parseEnvFile } from '../workflows/ticket-burner'
import { RUNTIME_SPECS, runDoctor, exitCodeFor, type DoctorEnv, type DoctorMode } from './doctor'
import { formatReport } from './report'
import { createSystemExec } from './system-exec'

/**
 * `runcastle doctor` — the prerequisite CLI. Diagnostic by default (reports
 * everything, exit code reflects overall health); `--gate`/`--boot` is the
 * pre-boot gate that hard-stops on Tier-1 only. Everything real (spawning,
 * config, env file) is wired here; the probe library it drives is pure.
 */

/** Pick the run mode from argv. Default `diagnostic`; `--gate`/`--boot` gate. */
export function parseMode(argv: string[]): DoctorMode {
  return argv.includes('--gate') || argv.includes('--boot') ? 'gate' : 'diagnostic'
}

/** Merge every runtime's AFK credential from `~/.runcastle/.env` over `process.env`. */
function envWithAfkCredentials(): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = { ...process.env }
  try {
    const path = envPath()
    if (existsSync(path)) {
      const fromFile = parseEnvFile(readFileSync(path, 'utf8'))
      for (const runtime of AGENT_RUNTIMES) {
        const key = RUNTIME_SPECS[runtime].afkKey
        const value = fromFile[key]
        if (value && value.length > 0) merged[key] = value
      }
    }
  } catch {
    // A malformed/unreadable .env just means the key probes report it unset.
  }
  return merged
}

/** Assemble the production {@link DoctorEnv} from real config + host state. */
export function resolveDoctorEnv(): DoctorEnv {
  let imageName: string | undefined
  // Which runtimes are the operator's problem is a property of their model
  // config: a runtime nothing resolves to is reported, never demanded.
  let runtimes: AgentRuntime[] | undefined
  try {
    const config = loadConfig()
    imageName = resolveSandboxImage(config)
    runtimes = configuredRuntimes(config)
  } catch {
    // Config unreadable — fall back to DEFAULT_SANDBOX_IMAGE and the default runtime.
    imageName = undefined
    runtimes = undefined
  }
  return {
    exec: createSystemExec({ cwd: process.cwd() }),
    env: envWithAfkCredentials(),
    platform: process.platform,
    cwd: process.cwd(),
    ...(imageName ? { imageName } : {}),
    ...(runtimes ? { runtimes } : {}),
  }
}

/** Run the doctor and print the report; returns the process exit code. */
export async function runCli(
  argv: string[],
  log: (line: string) => void = console.log,
): Promise<number> {
  const mode = parseMode(argv)
  const report = await runDoctor(resolveDoctorEnv())
  log(formatReport(report, mode))
  return exitCodeFor(report, mode)
}

if (import.meta.main) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exit(code)
  })
}
