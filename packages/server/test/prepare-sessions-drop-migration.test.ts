import { copyFileSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RuncastleConfig } from '@runcastle/core'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sql-js'
import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'
import { schema } from '../src/db/schema'
import { runMigrations } from '../src/db/migrate'
import type { AppCtx, Db } from '../src/db/types'
import { hasFinding } from '../src/services/findings'

/**
 * The `prepare` session kind is gone (0060): old preparation chats are
 * deleted, and what they established — the findings — stays.
 */

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

/** A migrations dir holding only the files strictly before `0060`. */
function prePrepareDropDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-prepare-drop-migrate-'))
  for (const f of readdirSync(DRIZZLE_DIR)) {
    if (f.endsWith('.sql') && f < '0060') copyFileSync(join(DRIZZLE_DIR, f), join(dir, f))
  }
  return dir
}

function insertSession(db: Db, id: string, kind: string): void {
  db.run(
    sql.raw(
      'INSERT INTO sessions (id, project_id, kind, status, awaiting_input, worktree_path, created_at)' +
        ` VALUES ('${id}', 'proj_1', '${kind}', 'ended', 0, '/repo', 1)`,
    ),
  )
}

describe('old preparation chats are deleted (0060)', () => {
  it('removes prepare sessions and leaves the findings they recorded', async () => {
    const SQL = await initSqlJs()
    const db = drizzle(new SQL.Database(), { schema }) as unknown as Db
    const ctx: AppCtx = { db, config: RuncastleConfig.parse({}) }
    runMigrations(db, prePrepareDropDir())
    db.run(sql.raw("INSERT INTO projects (id, name, repo_path) VALUES ('proj_1', 'P', '/repo')"))
    insertSession(db, 'sess_prep', 'prepare')
    insertSession(db, 'sess_orch', 'project')
    db.run(
      sql.raw(
        'INSERT INTO project_findings (project_id, key, source, evidence, established_at)' +
          " VALUES ('proj_1', 'devCommand', 'session', 'package.json scripts.dev', 1)",
      ),
    )

    runMigrations(db, DRIZZLE_DIR)

    const ids = (db.all(sql.raw('SELECT id FROM sessions ORDER BY id')) as { id: string }[]).map((r) => r.id)
    expect(ids).toEqual(['sess_orch'])
    expect(hasFinding(ctx, 'proj_1', 'devCommand')).toBe(true)
  })
})
