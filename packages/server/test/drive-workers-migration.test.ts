import { copyFileSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sql-js'
import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'
import { schema, workers } from '../src/db/schema'
import { runMigrations } from '../src/db/migrate'
import type { Db } from '../src/db/types'

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

function beforeOwnerDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-drive-workers-migrate-'))
  for (const file of readdirSync(DRIZZLE_DIR)) {
    if (file.endsWith('.sql') && file < '0066') copyFileSync(join(DRIZZLE_DIR, file), join(dir, file))
  }
  return dir
}

async function freshDb(): Promise<Db> {
  const SQL = await initSqlJs()
  return drizzle(new SQL.Database(), { schema }) as unknown as Db
}

describe('worker owner migration (0066)', () => {
  it("keeps every existing worker, owned by its feature and its feature's project, and lets a worker have no feature", async () => {
    const db = await freshDb()
    runMigrations(db, beforeOwnerDir())
    db.run(sql.raw("INSERT INTO projects (id, name, repo_path) VALUES ('proj_1', 'p', '/repo')"))
    db.run(sql.raw(
      "INSERT INTO features (id, project_id, slug, title, one_liner, branch, status, created_at) VALUES ('feat_1', 'proj_1', 'demo', 'Demo', 'd', 'feature/demo', 'active', 1)",
    ))
    db.run(sql.raw(
      'INSERT INTO workers (id, feature_id, label, purpose, kind, model, runtime, started_by, status, engine, feature_branch, handback_commits, review_mode, created_at, updated_at)' +
        " VALUES ('wkr_1', 'feat_1', 'Header', 'p', 'on-its-own', 'm', 'claude-code', 'lead', 'handed-back', 'docker', 'feature/demo', '[\"abc1234 feat: x\"]', NULL, 1, 2)",
    ))

    runMigrations(db, DRIZZLE_DIR)

    const kept = db.select().from(workers).where(eq(workers.id, 'wkr_1')).get()
    expect(kept).toMatchObject({
      featureId: 'feat_1',
      projectId: 'proj_1',
      label: 'Header',
      status: 'handed-back',
      handbackCommits: ['abc1234 feat: x'],
      createdAt: 1,
      updatedAt: 2,
    })
    db.run(sql.raw(
      'INSERT INTO workers (id, feature_id, project_id, label, purpose, kind, model, runtime, started_by, status, engine, feature_branch, created_at, updated_at)' +
        " VALUES ('wkr_2', NULL, 'proj_1', 'Scenarios', 'p', 'scenario', 'm', 'claude-code', 'human', 'working', 'docker', 'main', 3, 3)",
    ))
    expect(db.select().from(workers).where(eq(workers.id, 'wkr_2')).get()?.featureId).toBeNull()
    expect(() => runMigrations(db, DRIZZLE_DIR)).not.toThrow()
  })
})
