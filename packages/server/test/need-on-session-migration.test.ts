import { copyFileSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sql-js'
import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'
import { schema, sessions } from '../src/db/schema'
import { runMigrations } from '../src/db/migrate'
import type { Db } from '../src/db/types'

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

function beforeNeedDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-need-migrate-'))
  for (const file of readdirSync(DRIZZLE_DIR)) {
    if (file.endsWith('.sql') && file < '0072') copyFileSync(join(DRIZZLE_DIR, file), join(dir, file))
  }
  return dir
}

async function freshDb(): Promise<Db> {
  const SQL = await initSqlJs()
  return drizzle(new SQL.Database(), { schema }) as unknown as Db
}

function feature(db: Db, id: string, reason: string | null, kind: string | null, status = 'active'): void {
  db.run(sql.raw(
    'INSERT INTO features (id, project_id, slug, title, one_liner, branch, status, created_at, waiting_reason, waiting_kind)' +
      ` VALUES ('${id}', 'proj_a', '${id}', '${id}', 'd', 'feature/${id}', '${status}', 1, ${reason ? `'${reason}'` : 'NULL'}, ${kind ? `'${kind}'` : 'NULL'})`,
  ))
}

function chat(db: Db, id: string, featureId: string): void {
  db.run(sql.raw(`INSERT INTO sessions (id, feature_id, kind, status, worktree_path) VALUES ('${id}', '${featureId}', 'chat', 'ended', '/w')`))
}

describe('the wait moves onto the session row (0072, needs-you-is-the-agent-s-call)', () => {
  it('carries a lead’s real question onto its newest chat, and drops stops, ready marks and the old columns', async () => {
    const db = await freshDb()
    runMigrations(db, beforeNeedDir())
    db.run(sql.raw("INSERT INTO projects (id, name, repo_path) VALUES ('proj_a', 'a', '/a')"))
    feature(db, 'asks', 'Which model?', 'answer')
    feature(db, 'stopped', 'stopped', null)
    feature(db, 'ready', 'ready to test', null)
    feature(db, 'shipped', 'Which model?', 'answer', 'shipped')
    chat(db, 'chat_old', 'asks')
    chat(db, 'chat_new', 'asks')
    chat(db, 'chat_stopped', 'stopped')
    chat(db, 'chat_ready', 'ready')
    chat(db, 'chat_shipped', 'shipped')

    runMigrations(db, DRIZZLE_DIR)

    const waits = Object.fromEntries(db.select().from(sessions).all().map((s) => [s.id, s.waitWhy ? { why: s.waitWhy, by: s.waitBy } : null]))
    expect(waits).toEqual({
      chat_old: null,
      chat_new: { why: 'Which model?', by: 'agent' },
      chat_stopped: null,
      chat_ready: null,
      chat_shipped: null,
    })
    const columns = (db.all(sql.raw('PRAGMA table_info(features)')) as { name: string }[]).map((c) => c.name)
    expect(columns).not.toContain('waiting_reason')
    expect(columns).not.toContain('handback_at')
  })
})
