import { basename, dirname } from 'node:path'
import { run } from './shell'
import type { DestinationAnswer, DestinationQuestion } from './types'

/**
 * The SSH half of one-command `move`. A non-interactive `ssh` session may not
 * have Bun's bin on its PATH, and the `runcastle` there is a script that needs
 * `bun` to run, so every remote command puts that folder on the PATH itself.
 */
export const REMOTE_PATH = 'PATH="$HOME/.bun/bin:$PATH"'

/**
 * Prepended to every remote command as-is. The rehearsal uses it to point the
 * destination at a scratch data dir and Claude dir, and leave the real ones alone.
 */
function remoteEnv(): string {
  const extra = process.env.RUNCASTLE_MOVE_REMOTE_ENV?.trim()
  return extra ? `${REMOTE_PATH} ${extra}` : REMOTE_PATH
}

export interface RemoteFlags {
  replace: boolean
  reposDir?: string
}

function flagWords(flags: RemoteFlags): string {
  return [
    ...(flags.replace ? ['--replace'] : []),
    ...(flags.reposDir ? ['--repos-dir', `"${flags.reposDir}"`] : []),
  ].join(' ')
}

/** The shell line that brings a pack in on the destination, copied to its home folder. */
export function remoteMoveInCommand(packName: string, flags: RemoteFlags): string {
  return [remoteEnv(), `runcastle move-in "$HOME/${packName}"`, flagWords(flags)].filter(Boolean).join(' ')
}

function remoteCheckCommand(flags: RemoteFlags): string {
  return [remoteEnv(), 'runcastle move-in --check', flagWords(flags)].filter(Boolean).join(' ')
}

/** The two commands that finish a move by hand, ready to paste. */
export function manualSteps(pack: string, host: string | undefined, flags: RemoteFlags): string[] {
  const target = host ?? '<user@host>'
  return [
    `scp "${pack}" ${target}:`,
    `ssh ${target} '${remoteMoveInCommand(basename(pack), flags)}'`,
  ]
}

/** What to tell the human when the copy or the remote step fails. */
export function failureMessage(step: string, detail: string, pack: string, host: string, flags: RemoteFlags): string {
  return [
    `${step} failed: ${detail}`,
    '',
    `Nothing was lost. The pack is kept at ${pack}, and this machine is unchanged.`,
    'Finish by hand with:',
    ...manualSteps(pack, host, flags).map((line) => `  ${line}`),
  ].join('\n')
}

/** Ask the destination what only it can know. `null` means it could not answer. */
export function askDestination(
  host: string,
  question: DestinationQuestion,
  flags: RemoteFlags,
): { answer: DestinationAnswer | null; detail: string } {
  const result = run('ssh', [host, remoteCheckCommand(flags)], {
    input: JSON.stringify(question),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const last = result.stdout.trim().split('\n').pop() ?? ''
  try {
    const parsed = JSON.parse(last) as DestinationAnswer
    if (Array.isArray(parsed.blockers)) return { answer: parsed, detail: '' }
  } catch {
    // an older runcastle answers with its usage text
  }
  const detail = result.stderr.trim() || 'it does not have a runcastle with move-in; install this version there'
  return { answer: null, detail }
}

/** Copy the pack into the destination's home folder. By relative name: Windows `scp` can read `C:` as a host. */
export function copyPack(pack: string, host: string): { ok: boolean; detail: string } {
  const result = run('scp', [basename(pack), `${host}:`], { cwd: dirname(pack), stdio: 'inherit' })
  return { ok: result.ok, detail: result.ok ? '' : `scp to ${host} did not finish` }
}

export function runRemoteMoveIn(pack: string, host: string, flags: RemoteFlags): { ok: boolean; detail: string } {
  const result = run('ssh', [host, remoteMoveInCommand(basename(pack), flags)], { stdio: 'inherit' })
  return { ok: result.ok, detail: result.ok ? '' : `move-in on ${host} did not finish` }
}
