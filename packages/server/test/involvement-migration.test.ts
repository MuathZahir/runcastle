import { copyFileSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sql-js'
import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'
import { features, schema } from '../src/db/schema'
import { runMigrations } from '../src/db/migrate'
import type { Db } from '../src/db/types'

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

function beforeInvolvementDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-involvement-migrate-'))
  for (const file of readdirSync(DRIZZLE_DIR)) {
    if (file.endsWith('.sql') && file < '0076') copyFileSync(join(DRIZZLE_DIR, file), join(dir, file))
  }
  return dir
}

describe('involvement migration (0076, how-involved-am-i)', () => {
  it('gives every existing feature "Involve me in: Everything"', async () => {
    const SQL = await initSqlJs()
    const db = drizzle(new SQL.Database(), { schema }) as unknown as Db
    runMigrations(db, beforeInvolvementDir())
    db.run(sql.raw("INSERT INTO projects (id, name, repo_path) VALUES ('proj_a', 'a', '/a')"))
    db.run(sql.raw(
      "INSERT INTO features (id, project_id, slug, title, one_liner, branch, status, created_at) VALUES " +
        "('feat_1', 'proj_a', 'one', 'One', 'o', 'feature/one', 'active', 1), " +
        "('feat_2', 'proj_a', 'two', 'Two', 't', 'feature/two', 'shipped', 2)",
    ))

    runMigrations(db, DRIZZLE_DIR)

    expect(db.select({ id: features.id, involvement: features.involvement }).from(features).all()).toEqual([
      { id: 'feat_1', involvement: 'everything' },
      { id: 'feat_2', involvement: 'everything' },
    ])
  })
})
