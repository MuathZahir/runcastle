import { copyFileSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sql-js'
import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'
import { schema } from '../src/db/schema'
import { runMigrations } from '../src/db/migrate'
import type { Db } from '../src/db/types'

/**
 * The orchestrator mode leaves the schema (one-orchestrator-no-mode decisions 1
 * and 2): 0054 drops the project's Orchestrator setting and the feature's
 * ownership column, and an old `orchestrate` session purpose reads as none,
 * since every project session is the orchestrator now.
 */

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

/** A migrations dir holding every file strictly before `0054`. */
function withModeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-orchestrator-mode-drop-'))
  for (const f of readdirSync(DRIZZLE_DIR)) {
    if (f.endsWith('.sql') && f < '0054') copyFileSync(join(DRIZZLE_DIR, f), join(dir, f))
  }
  return dir
}

async function freshDb(): Promise<Db> {
  const SQL = await initSqlJs()
  return drizzle(new SQL.Database(), { schema }) as unknown as Db
}

function columns(db: Db, table: string): string[] {
  return db.all<{ name: string }>(sql.raw(`PRAGMA table_info(${table})`)).map((c) => c.name)
}

function row(db: Db, query: string): Record<string, unknown> {
  return db.all<Record<string, unknown>>(sql.raw(query))[0]
}

function seed(db: Db): void {
  for (const statement of [
    "INSERT INTO projects (id, name, repo_path, orchestrator) VALUES ('proj_1', 'P', '/repo', 1)",
    'INSERT INTO features (id, project_id, slug, title, one_liner, branch, status, created_at, orchestrated)' +
      " VALUES ('feat_1', 'proj_1', 'grain', 'Grain', 'make it visible', 'feature/grain', 'active', 10, 1)",
    "INSERT INTO sessions (id, project_id, kind, purpose, status, worktree_path) VALUES ('ses_1', 'proj_1', 'project', 'orchestrate', 'ended', '/repo')",
    "INSERT INTO sessions (id, feature_id, kind, purpose, status, worktree_path) VALUES ('ses_2', 'feat_1', 'chat', 'self-plan', 'ended', '/w')",
  ]) {
    db.run(sql.raw(statement))
  }
}

describe('orchestrator mode drop (0054)', () => {
  it('drops the Orchestrator setting and the ownership column', async () => {
    const db = await freshDb()
    runMigrations(db, DRIZZLE_DIR)

    expect(columns(db, 'projects')).not.toContain('orchestrator')
    expect(columns(db, 'features')).not.toContain('orchestrated')
  })

  it('keeps existing projects, features and sessions, and clears the orchestrate purpose', async () => {
    const db = await freshDb()
    runMigrations(db, withModeDir())
    seed(db)

    runMigrations(db, DRIZZLE_DIR)

    expect(row(db, "SELECT * FROM projects WHERE id = 'proj_1'")).toEqual(
      expect.objectContaining({ name: 'P', repo_path: '/repo' }),
    )
    expect(row(db, "SELECT * FROM features WHERE id = 'feat_1'")).toEqual(
      expect.objectContaining({ slug: 'grain', title: 'Grain', branch: 'feature/grain', status: 'active', created_at: 10 }),
    )
    expect(row(db, "SELECT * FROM sessions WHERE id = 'ses_1'")).toEqual(
      expect.objectContaining({ project_id: 'proj_1', kind: 'project', purpose: null, status: 'ended' }),
    )
    expect(row(db, "SELECT purpose FROM sessions WHERE id = 'ses_2'")).toEqual({ purpose: 'self-plan' })
    expect(() => runMigrations(db, DRIZZLE_DIR)).not.toThrow()
  })
})
