import { configuredRuntimes, resolveSandboxImage, type AgentRuntime } from '@runcastle/core'
import { loadConfig } from '@runcastle/core/config-load'
import { envWithAfkCredentials } from './afk-env'
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
