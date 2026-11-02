import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { delimiter, join } from 'node:path'
import { SERVICE_FILE_PATH } from '../services/service-file'
import { resolveExecutable, resolveSpawnTarget } from '../util/resolve-executable'
import { LINUX_PACKAGE_MANAGERS, type MachineFacts, type PackageManager } from './plan'
import type { StepRunner } from './runner'

const PACKAGE_MANAGERS: readonly PackageManager[] = [...LINUX_PACKAGE_MANAGERS, 'brew', 'winget']

/** The `ID=` of an os-release file, unquoted; null when there is none. */
export function parseOsReleaseId(text: string): string | null {
  const id = /^ID=(.*)$/m.exec(text)?.[1]?.trim().replace(/^["']|["']$/g, '')
  return id || null
}

function readDistroId(): string | null {
  try {
    return parseOsReleaseId(readFileSync('/etc/os-release', 'utf8'))
  } catch {
    return null
  }
}

/** The facts the plan needs, read from this machine. */
export function readMachineFacts(env: NodeJS.ProcessEnv = process.env): MachineFacts {
  const platform = process.platform
  return {
    platform,
    distroId: platform === 'linux' ? readDistroId() : null,
    packageManagers: PACKAGE_MANAGERS.filter((pm) => resolveExecutable(pm) !== pm),
    hasDesktop: Boolean(env.DISPLAY || env.WAYLAND_DISPLAY),
    serviceFileExists: platform === 'linux' && existsSync(SERVICE_FILE_PATH),
    user: userInfo().username,
    pathChanged: env.RUNCASTLE_PATH_CHANGED === '1',
  }
}

/**
 * The real {@link StepRunner}. Unlike the doctor's exec it inherits the terminal
 * and has no timeout: `sudo` must be able to ask for a password, an installer's
 * progress must show, and a slow download is not a hung probe.
 *
 * Codex's installer ends by asking to start Codex, on the terminal itself. That
 * is a second question after the one yes, and it would hang a `--yes` run forever.
 */
export function createStepRunner(): StepRunner {
  return (command) =>
    new Promise((resolve) => {
      const { file, args } = resolveSpawnTarget(command.file, command.args)
      const child = spawn(file, args, {
        stdio: 'inherit',
        env: { ...process.env, CODEX_NON_INTERACTIVE: '1' },
      })
      child.on('error', () => resolve(false))
      child.on('close', (code) => resolve(code === 0))
    })
}

/** Add the folders Bun and the agent installers write to, so the re-check finds what just landed. */
export function addInstallerDirsToPath(env: NodeJS.ProcessEnv = process.env): void {
  const dirs = (env.PATH ?? '').split(delimiter)
  const added = [join(homedir(), '.bun', 'bin'), join(homedir(), '.local', 'bin')].filter((d) => !dirs.includes(d))
  env.PATH = [...added, ...dirs].filter(Boolean).join(delimiter)
}

/** Ask a question answered with one keypress. Enter answers with the default, the empty string. */
export function askKey(question: string): Promise<string> {
  const stdin = process.stdin
  process.stdout.write(question)
  return new Promise((resolve) => {
    stdin.setRawMode(true)
    stdin.resume()
    stdin.once('data', (data: Buffer) => {
      stdin.setRawMode(false)
      stdin.pause()
      const key = data.toString()
      // Raw mode swallows Ctrl-C, so honour it here.
      if (key === '\u0003') {
        process.stdout.write('\n')
        process.exit(130)
      }
      const answer = /^[\r\n]/.test(key) ? '' : key
      process.stdout.write(`${answer}\n`)
      resolve(answer)
    })
  })
}
