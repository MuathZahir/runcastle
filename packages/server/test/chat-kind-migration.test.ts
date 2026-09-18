import { copyFileSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SessionRow } from '@runcastle/core'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sql-js'
import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'
import { runMigrations } from '../src/db/migrate'
import { schema } from '../src/db/schema'
import type { Db } from '../src/db/types'

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')
const CHAT_MIGRATION = '0039_chat_session_kind.sql'

function preChatDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-chat-migrate-'))
  for (const file of readdirSync(DRIZZLE_DIR)) {
    if (file.endsWith('.sql') && file < CHAT_MIGRATION) copyFileSync(join(DRIZZLE_DIR, file), join(dir, file))
  }
  return dir
}

describe('chat session kind migration', () => {
  it('rewrites every collapsed kind into rows accepted by SessionRow', async () => {
    const SQL = await initSqlJs()
    const db = drizzle(new SQL.Database(), { schema }) as unknown as Db
    runMigrations(db, preChatDir())
    for (const [index, kind] of ['ideation', 'qa', 'revisit'].entries()) {
      db.run(sql.raw(`INSERT INTO sessions (id, feature_id, lap, kind, status, awaiting_input, worktree_path, created_at) VALUES ('session_${index}', 'feature_1', 1, '${kind}', 'ended', 0, '/tmp/work', 1)`))
    }

    runMigrations(db, DRIZZLE_DIR)
    const rows = db.all(sql.raw('SELECT id, feature_id AS featureId, lap, kind, status, awaiting_input AS awaitingInput, worktree_path AS worktreePath, created_at AS createdAt FROM sessions'))
    expect(rows.map((row) => SessionRow.parse({ ...row, awaitingInput: row.awaitingInput === 1 }).kind)).toEqual(['chat', 'chat', 'chat'])
  })
})
