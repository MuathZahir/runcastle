import { existsSync, readFileSync } from 'node:fs'
import { envPath } from '@runcastle/core/paths'
import { loadConfig } from '@runcastle/core/config-load'
import { parseEnvFile } from '../workflows/ticket-burner'
import { runDoctor, exitCodeFor, type DoctorEnv, type DoctorMode } from './doctor'
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

/** Merge `CLAUDE_CODE_OAUTH_TOKEN` from `~/.runcastle/.env` over `process.env`. */
function envWithToken(): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = { ...process.env }
  try {
    const path = envPath()
    if (existsSync(path)) {
      const fromFile = parseEnvFile(readFileSync(path, 'utf8')).CLAUDE_CODE_OAUTH_TOKEN
      if (fromFile && fromFile.length > 0) merged.CLAUDE_CODE_OAUTH_TOKEN = fromFile
    }
  } catch {
    // A malformed/unreadable .env just means the token probe reports it unset.
  }
  return merged
}

/** Assemble the production {@link DoctorEnv} from real config + host state. */
export function resolveDoctorEnv(): DoctorEnv {
  let imageName: string | undefined
  try {
    imageName = loadConfig().sandboxImage
  } catch {
    imageName = undefined
  }
  return {
    exec: createSystemExec({ cwd: process.cwd() }),
    env: envWithToken(),
    platform: process.platform,
    cwd: process.cwd(),
    ...(imageName ? { imageName } : {}),
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
