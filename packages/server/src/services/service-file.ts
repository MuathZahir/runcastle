import { posix } from 'node:path'

export const SERVICE_NAME = 'runcastle'
export const SERVICE_FILE_PATH = '/etc/systemd/system/runcastle.service'

export interface ServiceFileInput {
  user: string
  home: string
  /** Absolute path to the `runcastle` executable. */
  runcastleBin: string
  /** The service's `PATH`, already joined. */
  path: string
}

/**
 * The systemd unit that keeps runcastle running. No `Requires=docker.service`
 * (Podman has no such unit) and no `SupplementaryGroups`: a `User=` service gets
 * that user's groups, `docker` included.
 */
export function renderServiceFile(input: ServiceFileInput): string {
  return [
    '[Unit]',
    'Description=runcastle',
    'After=network-online.target docker.service',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `User=${input.user}`,
    `WorkingDirectory=${input.home}`,
    `Environment=HOME=${input.home}`,
    `Environment=PATH=${input.path}`,
    `ExecStart=${input.runcastleBin} serve`,
    'Restart=on-failure',
    'RestartSec=5',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n')
}

/**
 * The service's `PATH`: the process's absolute entries, then the places Bun and
 * the agent CLIs install to, deduped in order. Linux paths, whatever runs this.
 */
export function servicePath(processPath: string | undefined, home: string): string {
  const { delimiter, isAbsolute, join } = posix
  const extra = [join(home, '.bun', 'bin'), join(home, '.local', 'bin'), '/usr/local/bin', '/usr/bin', '/bin']
  const entries = [...(processPath ?? '').split(delimiter).filter((e) => e && isAbsolute(e)), ...extra]
  return [...new Set(entries)].join(delimiter)
}
