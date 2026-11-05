/**
 * Scenario: runcastle as a brand-new install, with a sample repo ready to open.
 *
 * Run by the project's scenario runner (`bun {file}`) inside a test drive of
 * runcastle that `.runcastle/drive-setup.ts` started empty for this scenario —
 * no database, config or .env of the owner's runcastle; the machine's own git
 * identity and coding-agent login stay, as on a typical new user's machine. So
 * the drive opens on runcastle's first screen for that machine (the setup
 * wizard only when something is missing), and this file only prepares what the
 * human opens: a fresh copy of the tiny-notes fixture, one commit on `main`, in
 * the drive's data dir. It touches no database. Prints `SAMPLE_REPO=<path>` and
 * `ENTRY_URL=/`.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DRIVE_PREFIX, isDriveDataDir } from '../../drive-dir.ts'

const FIXTURE = resolve(import.meta.dirname, '..', '_fixtures', 'tiny-notes')

/** Only ever the drive's own tree — see feature-at-review.ts. */
function driveDataDir(): string {
  const dir = process.env.RUNCASTLE_DATA_DIR
  if (!dir) throw new Error('RUNCASTLE_DATA_DIR is not set — run this inside a test drive')
  if (!isDriveDataDir(resolve(dir))) {
    throw new Error(`refusing to write into ${resolve(dir)} — not a ${DRIVE_PREFIX}* data dir`)
  }
  return resolve(dir)
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`)
}

function main(): void {
  const repo = join(driveDataDir(), 'tiny-notes')
  rmSync(repo, { recursive: true, force: true })
  cpSync(FIXTURE, repo, { recursive: true })

  // The drive's global git config is empty by design, so the identity is explicit.
  git(repo, ['init', '-b', 'main'])
  git(repo, ['add', '-A'])
  git(repo, [
    '-c',
    'user.name=Tiny Notes',
    '-c',
    'user.email=tiny-notes@example.com',
    'commit',
    '-m',
    'Initial commit',
  ])

  console.log(`SAMPLE_REPO=${repo}`)
  console.log('ENTRY_URL=/')
}

try {
  main()
} catch (e) {
  console.error(`[brand-new-install] ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
