import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, hostname, tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import {
  SERVICE_FILE_PATH,
  SERVICE_NAME,
  renderServiceFile,
  servicePath,
} from '../services/service-file'
import { resolveTool } from '../util/resolve-executable'
import { ROOT_BURN_REFUSED, runningAsRoot } from '../workflows/burn-user'

export const SERVICE_USAGE = [
  'usage: runcastle service install | remove',
  '  install  keep runcastle running on this Linux machine: starts at boot, restarts if it crashes',
  '  remove   stop and remove that service',
].join('\n')

/** Runs one command with inherited stdio, so `sudo` can ask for a password. Returns its exit code. */
export type ServiceStepRunner = (command: string, args: string[]) => number

export interface ServiceDeps {
  log?: (line: string) => void
  platform?: NodeJS.Platform
  runningAsRoot?: boolean
  systemdPresent?: boolean
  user?: string
  home?: string
  host?: string
  processPath?: string
  /** Absolute path to the `runcastle` executable. */
  runcastleBin?: string
  serviceFileExists?: boolean
  /** Writes the unit text to a temp file and returns its path. */
  writeTemp?: (text: string) => string
  runStep?: ServiceStepRunner
}

const inheritStdio: ServiceStepRunner = (command, args) =>
  spawnSync(command, args, { stdio: 'inherit' }).status ?? 1

function writeTempFile(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-service-'))
  const file = join(dir, 'runcastle.service')
  writeFileSync(file, text, 'utf8')
  return file
}

/** Runs each sudo step in order, stopping at the first failure. */
function runSteps(steps: string[][], run: ServiceStepRunner, log: (line: string) => void): boolean {
  for (const step of steps) {
    if (run('sudo', step) !== 0) {
      log(`\`sudo ${step.join(' ')}\` failed. Stopped there.`)
      return false
    }
  }
  return true
}

/** `runcastle service install|remove`: keep runcastle running on Linux. Returns the exit code. */
export async function runService(argv: string[], deps: ServiceDeps = {}): Promise<number> {
  const log = deps.log ?? console.log
  const action = argv.length === 1 ? argv[0] : undefined
  if (action !== 'install' && action !== 'remove') {
    log(SERVICE_USAGE)
    return 1
  }

  const platform = deps.platform ?? process.platform
  const systemdPresent = deps.systemdPresent ?? existsSync('/run/systemd/system')
  if (platform !== 'linux' || !systemdPresent) {
    log('A background service is not supported here: it needs Linux with systemd.')
    return 1
  }
  if (deps.runningAsRoot ?? runningAsRoot()) {
    log(ROOT_BURN_REFUSED)
    return 1
  }

  const run = deps.runStep ?? inheritStdio
  const existed = deps.serviceFileExists ?? existsSync(SERVICE_FILE_PATH)

  if (action === 'remove') {
    if (!existed) {
      log('No runcastle service is installed. Nothing to remove.')
      return 0
    }
    const ok = runSteps(
      [
        ['systemctl', 'disable', '--now', SERVICE_NAME],
        ['rm', '-f', SERVICE_FILE_PATH],
        ['systemctl', 'daemon-reload'],
      ],
      run,
      log,
    )
    if (ok) log('Removed the runcastle service.')
    return ok ? 0 : 1
  }

  const user = deps.user ?? userInfo().username
  const home = deps.home ?? homedir()
  const text = renderServiceFile({
    user,
    home,
    runcastleBin: deps.runcastleBin ?? resolveTool('runcastle'),
    path: servicePath(deps.processPath ?? process.env.PATH, home),
  })
  const tmp = (deps.writeTemp ?? writeTempFile)(text)
  try {
    const ok = runSteps(
      [
        ['install', '-m', '644', tmp, SERVICE_FILE_PATH],
        ['systemctl', 'daemon-reload'],
        ['systemctl', 'enable', SERVICE_NAME],
        ['systemctl', 'restart', SERVICE_NAME],
      ],
      run,
      log,
    )
    if (!ok) return 1
  } finally {
    if (!deps.writeTemp) rmSync(join(tmp, '..'), { recursive: true, force: true })
  }

  log(existed ? 'Replaced the existing runcastle service.' : 'Installed the runcastle service.')
  log('Check it with: systemctl status runcastle')
  log(`Reach the app from your own machine with: ssh -L 4512:localhost:4512 ${user}@${deps.host ?? hostname()}`)
  return 0
}
