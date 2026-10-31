import { closeSync, mkdtempSync, openSync, rmSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { runcastleVersion } from '../version'
import { DATA_ENTRIES } from './scan'
import { gitOrThrow, walkFiles } from './shell'
import { TarWriter } from './tar'
import type { CheckoutWip, MoveEnv, MoveManifest, MoveScan, OpenSql } from './types'

/**
 * Build the pack on the old machine. Everything is read from where it sits and
 * written to one file; the only scratch space is a temp folder beside that file
 * for the database copy and git bundles, removed before this returns.
 */

/** Secrets that sit inside folders that otherwise travel. */
function isSecret(entry: string): boolean {
  return /^sessions\/[^/]+\/codex-home\/auth\.json$/.test(entry)
}

async function addTree(tar: TarWriter, dir: string, prefix: string, skip?: (rel: string) => boolean): Promise<void> {
  for (const rel of walkFiles(dir)) {
    if (skip?.(rel)) continue
    await tar.addFile(`${prefix}/${rel}`, join(dir, rel))
  }
}

async function addDataEntries(tar: TarWriter, env: MoveEnv): Promise<void> {
  for (const entry of DATA_ENTRIES) {
    const path = join(env.dataDir, entry)
    let isFile = false
    try {
      isFile = statSync(path).isFile()
    } catch {
      continue
    }
    if (isFile) await tar.addFile(`data/${entry}`, path)
    else await addTree(tar, path, `data/${entry}`, (rel) => isSecret(`${entry}/${rel}`))
  }
}

/**
 * Copy the database as committed, whatever the WAL holds. `VACUUM INTO` writes
 * a clean single file, which a plain file copy of a WAL database would not be.
 */
function snapshotDatabase(env: MoveEnv, open: OpenSql, target: string): {
  rowCounts: Record<string, number>
  migrations: string[]
} {
  const source = open(join(env.dataDir, 'runcastle.db'), { readonly: true })
  try {
    source.run(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  } finally {
    source.close()
  }
  const copy = open(target, { readonly: true })
  try {
    return { rowCounts: countRows(copy), migrations: copy.all<{ name: string }>('SELECT name FROM __migrations ORDER BY name').map((r) => r.name) }
  } finally {
    copy.close()
  }
}

/** Every table's row count, the check that nothing was lost on the way. */
export function countRows(sql: { all<T>(sql: string): T[] }): Record<string, number> {
  const tables = sql.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  )
  const counts: Record<string, number> = {}
  for (const { name } of tables) {
    counts[name] = sql.all<{ n: number }>(`SELECT COUNT(*) AS n FROM "${name}"`)[0].n
  }
  return counts
}

async function addRepo(tar: TarWriter, id: string, repoPath: string, scratch: string): Promise<void> {
  const bundle = join(scratch, `${id}.bundle`)
  gitOrThrow(repoPath, ['bundle', 'create', '-q', bundle, '--all'])
  await tar.addFile(`repos/${id}.bundle`, bundle)
  rmSync(bundle, { force: true })
}

/**
 * Capture a checkout's uncommitted work without changing the checkout: the
 * patch keeps line endings right where git can, and the whole copies mean a
 * patch that will not apply on the other side still loses nothing.
 */
async function addWip(tar: TarWriter, projectId: string, wip: CheckoutWip, scratch: string): Promise<void> {
  const prefix = `wip/${projectId}/${wip.key}`
  if (wip.sha && wip.tracked.length > 0) {
    const patch = join(scratch, 'changes.patch')
    const fd = openSync(patch, 'w')
    try {
      const diff = spawnSync('git', ['-c', 'core.quotepath=off', 'diff', '--binary', 'HEAD'], {
        cwd: wip.path,
        stdio: ['ignore', fd, 'pipe'],
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
        windowsHide: true,
      })
      if (diff.status !== 0) throw new Error(`git diff failed in ${wip.path}: ${String(diff.stderr)}`)
    } finally {
      closeSync(fd)
    }
    await tar.addFile(`${prefix}/changes.patch`, patch)
    rmSync(patch, { force: true })
  }
  for (const rel of [...wip.tracked, ...wip.untracked]) {
    const path = join(wip.path, rel)
    try {
      if (!statSync(path).isFile()) continue
    } catch {
      continue
    }
    await tar.addFile(`${prefix}/files/${rel}`, path)
  }
}

export async function packMove(input: {
  env: MoveEnv
  scan: MoveScan
  open: OpenSql
  out: string
  log?: (line: string) => void
}): Promise<MoveManifest> {
  const { env, scan, open, out } = input
  const log = input.log ?? (() => {})
  const scratch = mkdtempSync(join(dirname(out), 'runcastle-move-'))
  const tar = new TarWriter(out)
  try {
    log('Copying the database')
    const dbCopy = join(scratch, 'runcastle.db')
    const { rowCounts, migrations } = snapshotDatabase(env, open, dbCopy)
    await tar.addFile('db/runcastle.db', dbCopy)
    rmSync(dbCopy, { force: true })

    log('Packing chats, reviews and notes')
    await addDataEntries(tar, env)
    for (const folder of scan.claudeFolders) {
      await addTree(tar, join(env.claudeDir, 'projects', folder.name), `claude/${folder.name}`)
    }

    for (const project of scan.projects) {
      if (!project.repoMoves) continue
      log(`Packing ${project.name}`)
      if (Object.keys(project.refs).length > 0) await addRepo(tar, project.id, project.repoPath, scratch)
      for (const wip of project.wip) await addWip(tar, project.id, wip, scratch)
    }

    const manifest: MoveManifest = {
      formatVersion: 1,
      runcastleVersion: runcastleVersion(),
      createdAt: Date.now(),
      source: env,
      migrations,
      projects: scan.projects,
      claudeFolders: scan.claudeFolders,
      rowCounts,
      files: tar.files,
    }
    await tar.addBuffer('manifest.json', Buffer.from(JSON.stringify(manifest), 'utf8'))
    await tar.finish()
    return manifest
  } catch (err) {
    await tar.finish().catch(() => {})
    rmSync(out, { force: true })
    throw err
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}
