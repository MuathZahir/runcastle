import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { sameDataDir } from '@runcastle/core/paths'
import { bundledMigrations } from '../db/migrate'
import { freeBytes, formatBytes } from './shell'
import type { DestinationAnswer, DestinationQuestion, MoveEnv, OpenSql } from './types'

/** The checks only the new machine can make, run before it writes anything. */

export const DEFAULT_REPOS_FOLDER = 'projects'

export function reposDirOf(env: MoveEnv, override: string | undefined): string {
  return override ?? join(env.home, DEFAULT_REPOS_FOLDER)
}

/** The port this data dir's server listens on: what its config says, else the default. */
function serverPort(env: MoveEnv): number {
  try {
    const config = JSON.parse(readFileSync(join(env.dataDir, 'config.json'), 'utf8')) as { serverPort?: number }
    return config.serverPort ?? 4512
  } catch {
    return 4512
  }
}

/**
 * Whether this data dir's server is up. Its `/health` names the tree it serves,
 * so a server on the same port for another data dir does not count. A reply that
 * cannot be read does count: something is there, and guessing wrong here means
 * copying a database in use.
 */
export async function serverRunning(env: MoveEnv): Promise<boolean> {
  try {
    const reply = await fetch(`http://127.0.0.1:${serverPort(env)}/health`, {
      signal: AbortSignal.timeout(1500),
    })
    const body = (await reply.json()) as { dataDir?: string }
    return !body.dataDir || sameDataDir(body.dataDir, env.dataDir)
  } catch (err) {
    if (err instanceof SyntaxError) return true
    return false
  }
}

/** How many projects the destination holds, 0 when it has no database yet. */
function existingProjects(env: MoveEnv, open: OpenSql): string[] {
  const path = join(env.dataDir, 'runcastle.db')
  if (!existsSync(path)) return []
  const sql = open(path, { readonly: true })
  try {
    return sql.all<{ name: string }>('SELECT name FROM projects').map((row) => row.name)
  } catch {
    return []
  } finally {
    sql.close()
  }
}

/** Room for the pack, its unpacked copy and the rebuilt repos' checkouts. */
export function bytesNeeded(question: Pick<DestinationQuestion, 'dataBytes' | 'repoBytes'>): number {
  return question.dataBytes * 2 + question.repoBytes * 4
}

export async function checkDestination(
  question: DestinationQuestion,
  env: MoveEnv,
  opts: { replace: boolean; reposDir?: string; open: OpenSql },
): Promise<DestinationAnswer> {
  const blockers: string[] = []
  const notes: string[] = []
  const reposDir = reposDirOf(env, opts.reposDir)

  if (env.platform === 'win32') blockers.push('a Windows machine cannot be the destination of a move')
  if (!isAbsolute(reposDir)) blockers.push(`--repos-dir must be an absolute path on this machine, not ${reposDir}`)
  if (await serverRunning(env)) blockers.push("this machine's runcastle server is running: stop it first")

  const known = new Set(bundledMigrations())
  const unknown = question.migrations.filter((name) => !known.has(name))
  if (unknown.length > 0) {
    blockers.push(
      `the pack comes from a newer runcastle (${question.runcastleVersion}) than this one: update this machine first`,
    )
  }

  const projects = existingProjects(env, opts.open)
  if (projects.length > 0) {
    const named = `${projects.length} ${projects.length === 1 ? 'project' : 'projects'} (${projects.join(', ')})`
    if (opts.replace) notes.push(`${named} will be set aside, not merged`)
    else blockers.push(`this machine holds ${named}: add --replace to set them aside`)
  }

  for (const folder of question.targetFolders) {
    const path = join(reposDir, folder)
    if (!folderHasContent(path)) continue
    if (opts.replace) notes.push(`${path} will be set aside`)
    else blockers.push(`${path} already exists: add --replace to set it aside, or choose --repos-dir`)
  }

  const free = freeBytes(existsSync(env.home) ? env.home : '/')
  const needed = bytesNeeded(question)
  if (free !== null && free < needed) {
    blockers.push(`not enough disk: about ${formatBytes(needed)} needed, ${formatBytes(free)} free`)
  }

  return { platform: env.platform, blockers, notes, freeBytes: free, reposDir }
}

function folderHasContent(path: string): boolean {
  try {
    return readdirSync(path).length > 0
  } catch {
    return false
  }
}
