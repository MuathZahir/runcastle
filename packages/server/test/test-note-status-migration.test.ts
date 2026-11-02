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
import { listByFeature, sendNotes } from '../src/services/test-notes'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Test notes keep one status, `open` (0057). A note left `done`, `promoted` or
 * `carried` by an older runcastle was dealt with long ago: it comes back open
 * and stamped sent, so the next "Send to agent" never carries it again.
 */

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

/** A migrations dir holding only the files strictly before `0057`. */
function preOpenOnlyDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-note-status-migrate-'))
  for (const f of readdirSync(DRIZZLE_DIR)) {
    if (f.endsWith('.sql') && f < '0057') copyFileSync(join(DRIZZLE_DIR, f), join(dir, f))
  }
  return dir
}

function insertNote(db: Db, featureId: string, id: string, status: string, sentAt: number | null): void {
  db.run(
    sql.raw(
      'INSERT INTO test_notes (id, feature_id, text, status, author, sent_at, created_at, updated_at)' +
        ` VALUES ('${id}', '${featureId}', 'note ${id}', '${status}', 'human', ${sentAt ?? 'NULL'}, 100, 100)`,
    ),
  )
}

describe('test notes keep only the open status (0057)', () => {
  it('reopens old notes as already sent, so Send to agent never carries them again', async () => {
    const SQL = await initSqlJs()
    const db = drizzle(new SQL.Database(), { schema }) as unknown as Db
    const ctx: AppCtx = { db, config: RuncastleConfig.parse({}) }
    runMigrations(db, preOpenOnlyDir())
    const featureId = seedFeature(ctx, seedProject(ctx).id).id
    insertNote(db, featureId, 'note_done', 'done', null)
    insertNote(db, featureId, 'note_promoted', 'promoted', null)
    insertNote(db, featureId, 'note_carried', 'carried', 500)
    insertNote(db, featureId, 'note_open', 'open', null)

    runMigrations(db, DRIZZLE_DIR)

    const byId = Object.fromEntries(listByFeature(ctx, featureId).map((n) => [n.id, n]))
    expect(byId.note_done).toMatchObject({ status: 'open', sentAt: 100 })
    expect(byId.note_promoted).toMatchObject({ status: 'open', sentAt: 100 })
    expect(byId.note_carried).toMatchObject({ status: 'open', sentAt: 500 })
    expect(byId.note_open?.sentAt).toBeUndefined()

    await expect(sendNotes(ctx, featureId)).resolves.toMatchObject({ sent: 1 })
  })
})
