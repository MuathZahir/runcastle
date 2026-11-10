import { copyFileSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { asc, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sql-js'
import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'
import { schema, sessions } from '../src/db/schema'
import { runMigrations } from '../src/db/migrate'
import type { Db } from '../src/db/types'

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

function beforeLookDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-epic-look-migrate-'))
  for (const file of readdirSync(DRIZZLE_DIR)) {
    if (file.endsWith('.sql') && file < '0070') copyFileSync(join(DRIZZLE_DIR, file), join(dir, file))
  }
  return dir
}

async function freshDb(): Promise<Db> {
  const SQL = await initSqlJs()
  return drizzle(new SQL.Database(), { schema }) as unknown as Db
}

function session(db: Db, id: string, kind: string, project: string | null, createdAt: number | null, feature: string | null = null): void {
  db.run(
    sql.raw(
      'INSERT INTO sessions (id, feature_id, project_id, kind, status, worktree_path, created_at)' +
        ` VALUES ('${id}', ${feature ? `'${feature}'` : 'NULL'}, ${project ? `'${project}'` : 'NULL'}, '${kind}', 'ended', '/w', ${createdAt ?? 'NULL'})`,
    ),
  )
}

describe('epic look migration (0070, epics-that-look-alive decision 6)', () => {
  it('gives every old project chat a colour in turn by creation order, per project, and leaves icons unset', async () => {
    const db = await freshDb()
    runMigrations(db, beforeLookDir())
    db.run(sql.raw("INSERT INTO projects (id, name, repo_path) VALUES ('proj_a', 'a', '/a'), ('proj_b', 'b', '/b')"))
    db.run(sql.raw(
      "INSERT INTO features (id, project_id, slug, title, one_liner, branch, status, created_at) VALUES ('feat_1', 'proj_a', 'demo', 'Demo', 'd', 'feature/demo', 'active', 1)",
    ))
    // Inserted out of creation order: the colours follow created_at, not insertion.
    for (let i = 9; i >= 1; i--) session(db, `sess_a${i}`, 'project', 'proj_a', i * 10)
    session(db, 'sess_b1', 'project', 'proj_b', 5)
    session(db, 'sess_chat', 'chat', null, 3, 'feat_1')

    runMigrations(db, DRIZZLE_DIR)

    const rows = db.select().from(sessions).orderBy(asc(sessions.createdAt)).all()
    const of = (id: string) => rows.find((r) => r.id === id)
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => of(`sess_a${i}`)?.epicColor)).toEqual([
      'blue',
      'teal',
      'green',
      'olive',
      'amber',
      'rust',
      'rose',
      'violet',
      'blue',
    ])
    expect(of('sess_b1')?.epicColor).toBe('blue')
    expect(of('sess_chat')?.epicColor).toBeNull()
    expect(rows.every((r) => r.epicIcon === null && r.epicIconByHuman === false)).toBe(true)
    expect(() => runMigrations(db, DRIZZLE_DIR)).not.toThrow()
  })
})
