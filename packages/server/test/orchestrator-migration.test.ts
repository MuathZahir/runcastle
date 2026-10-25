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
import { getFeatureRow, getProjectById, listSessionsByFeature } from '../src/services/repo'

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')
const ORCHESTRATOR_MIGRATION = '0045_nappy_adam_destine.sql'

function preOrchestratorDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-orchestrator-migrate-'))
  for (const file of readdirSync(DRIZZLE_DIR)) {
    if (file.endsWith('.sql') && file < ORCHESTRATOR_MIGRATION) {
      copyFileSync(join(DRIZZLE_DIR, file), join(dir, file))
    }
  }
  return dir
}

describe('orchestrator migration', () => {
  it('migrates an existing database: rows survive and sessions have terminals', async () => {
    const SQL = await initSqlJs()
    const db = drizzle(new SQL.Database(), { schema }) as unknown as Db
    runMigrations(db, preOrchestratorDir())

    db.run(sql.raw("INSERT INTO projects (id, name, repo_path) VALUES ('proj_1', 'P', '/repo')"))
    db.run(sql.raw(
      'INSERT INTO features (id, project_id, slug, title, one_liner, phase, branch, status, created_at)' +
      " VALUES ('feat_1', 'proj_1', 'one', 'One', 'one line', 'planning', 'feature/one', 'active', 1)",
    ))
    db.run(sql.raw(
      'INSERT INTO sessions (id, feature_id, kind, status, worktree_path)' +
      " VALUES ('sess_1', 'feat_1', 'chat', 'ended', '/wt')",
    ))

    runMigrations(db, DRIZZLE_DIR)
    const ctx: AppCtx = { db, config: RuncastleConfig.parse({}) }

    expect(getFeatureRow(ctx, 'feat_1').slug).toBe('one')
    expect(listSessionsByFeature(ctx, 'feat_1').map((s) => s.headless)).toEqual([false])
    expect(getProjectById(ctx, 'proj_1')?.name).toBe('P')
  })
})
