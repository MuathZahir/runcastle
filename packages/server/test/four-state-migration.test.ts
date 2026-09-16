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
import { getFeatureRow } from '../src/services/repo'

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')
const FOUR_STATE_MIGRATION = '0037_amusing_steve_rogers.sql'

function preFourStateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-four-state-migrate-'))
  for (const file of readdirSync(DRIZZLE_DIR)) {
    if (file.endsWith('.sql') && file < FOUR_STATE_MIGRATION) {
      copyFileSync(join(DRIZZLE_DIR, file), join(dir, file))
    }
  }
  return dir
}

describe('four-state migration', () => {
  it('maps every legacy phase through the ordinary feature reader and drops overrides', async () => {
    const SQL = await initSqlJs()
    const db = drizzle(new SQL.Database(), { schema }) as unknown as Db
    runMigrations(db, preFourStateDir())

    for (const [index, phase] of ['ideation', 'spec', 'tickets', 'implementation', 'review', 'shipped'].entries()) {
      db.run(sql.raw(
        `INSERT INTO features (id, project_id, slug, title, one_liner, phase, branch, status, created_at)` +
        ` VALUES ('feat_${index}', 'proj_1', 'feature-${index}', 'Feature ${index}', 'one line', '${phase}', 'feature/${index}', 'active', 1)`,
      ))
    }
    db.run(sql.raw("INSERT INTO gate_overrides (feature_id, gate, reason, ts) VALUES ('feat_0', 'G1', 'old', 1)"))

    runMigrations(db, DRIZZLE_DIR)
    const ctx: AppCtx = { db, config: RuncastleConfig.parse({}) }

    expect(Array.from({ length: 6 }, (_, index) => getFeatureRow(ctx, `feat_${index}`).phase)).toEqual([
      'planning', 'planning', 'planning', 'building', 'review', 'shipped',
    ])
    expect(() => db.all(sql.raw('SELECT * FROM gate_overrides'))).toThrow()
  })
})
