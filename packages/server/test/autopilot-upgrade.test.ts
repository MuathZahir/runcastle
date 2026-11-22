import { copyFileSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RuncastleConfig } from '@runcastle/core'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sql-js'
import initSqlJs from 'sql.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { events, schema } from '../src/db/schema'
import { runMigrations } from '../src/db/migrate'
import type { AppCtx, Db } from '../src/db/types'
import {
  AUTOPILOT_GONE_NOTE,
  AUTOPILOT_RETIRED,
  AUTOPILOT_UPGRADED,
  upgradeAutopilotFeatures,
} from '../src/services/autopilot-upgrade'
import { INVOLVEMENT_CHANGED } from '../src/services/involvement'
import { getFeatureRow } from '../src/services/repo'
import { waitOf } from '../src/services/waits'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import type { AgentHost } from '../src/threads/types'
import { withTempDataDir } from './helpers/data-dir'
import { createFakeAcp, FAKE_LAUNCH } from './support/fake-acp-agent'
import { promptsOf } from './support/thread-launch'

/**
 * Autopilot retires (`autopilot-retires` decision 13): migration 0079 marks
 * every open feature of an epic on autopilot before it drops the column, and
 * the boot step moves each marked feature off autopilot once.
 */

const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

function beforeDropDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-autopilot-drop-'))
  for (const file of readdirSync(DRIZZLE_DIR)) {
    if (file.endsWith('.sql') && file < '0079') copyFileSync(join(DRIZZLE_DIR, file), join(dir, file))
  }
  return dir
}

/** A database as it stood before 0079, seeded with two epics (one on autopilot) and their features. */
async function seededOldDb(): Promise<Db> {
  const SQL = await initSqlJs()
  const db = drizzle(new SQL.Database(), { schema }) as unknown as Db
  runMigrations(db, beforeDropDir())
  db.run(sql.raw("INSERT INTO projects (id, name, repo_path) VALUES ('proj_a', 'a', '/a')"))
  db.run(sql.raw(
    "INSERT INTO sessions (id, project_id, feature_id, kind, status, worktree_path, autopilot, created_at) VALUES " +
      "('sess_auto', 'proj_a', NULL, 'project', 'live', '/a', 1, 1), " +
      "('sess_hand', 'proj_a', NULL, 'project', 'live', '/a', 0, 1)",
  ))
  db.run(sql.raw(
    "INSERT INTO features (id, project_id, slug, title, one_liner, branch, status, created_at, chat_id, involvement) VALUES " +
      "('feat_all', 'proj_a', 'all', 'All', 'a', 'feature/all', 'active', 1, 'sess_auto', 'everything'), " +
      "('feat_set', 'proj_a', 'set', 'Set', 's', 'feature/set', 'active', 2, 'sess_auto', 'designsAndResult'), " +
      "('feat_draft', 'proj_a', 'draft', 'Draft', 'd', 'feature/draft', 'draft', 3, 'sess_auto', 'everything'), " +
      "('feat_done', 'proj_a', 'done', 'Done', 'x', 'feature/done', 'shipped', 4, 'sess_auto', 'everything'), " +
      "('feat_off', 'proj_a', 'off', 'Off', 'o', 'feature/off', 'active', 5, 'sess_hand', 'everything')",
  ))
  // The lead of `all` handed a question to its epic on autopilot; a later one on `set` moved on.
  db.run(sql.raw(
    "INSERT INTO sessions (id, project_id, feature_id, kind, status, worktree_path, cc_session_id, created_at) VALUES " +
      "('sess_lead', 'proj_a', 'feat_all', 'chat', 'live', '/wt', 'cc-lead', 2)",
  ))
  db.run(sql.raw(
    "INSERT INTO events (project_id, feature_id, ts, type, message, data) VALUES " +
      "('proj_a', 'feat_all', 1, 'lead.handed_back', 'asked', json_object('holderId', 'sess_auto', 'summary', 'Which   currency?', 'asks', json('true')))",
  ))
  return db
}

describe('the autopilot upgrade', () => {
  let restoreDataDir: () => void
  let host: AgentHost

  beforeEach(() => {
    restoreDataDir = withTempDataDir()
  })

  afterEach(async () => {
    await host?.stopAll('shutdown')
    setAgentHostForTests(undefined)
    restoreDataDir()
  })

  it('0079 marks the open features of an epic on autopilot, then drops the column', async () => {
    const db = await seededOldDb()
    runMigrations(db, DRIZZLE_DIR)

    const marks = db.select().from(events).where(eq(events.type, AUTOPILOT_RETIRED)).all()
    expect(marks.map((m) => m.featureId).sort()).toEqual(['feat_all', 'feat_draft', 'feat_set'])
    expect(marks[0]?.data).toEqual({ epicId: 'sess_auto' })
    const columns = db.all<{ name: string }>(sql.raw('PRAGMA table_info(sessions)')).map((c) => c.name)
    expect(columns).not.toContain('autopilot')
  })

  it('moves Everything to Result only, keeps a hand-set level, returns the open ask, and runs once', async () => {
    const db = await seededOldDb()
    runMigrations(db, DRIZZLE_DIR)
    const ctx: AppCtx = { db, config: RuncastleConfig.parse({}) }
    host = createAgentHost({ ctx, transport: createFakeAcp().transport, launch: FAKE_LAUNCH })
    setAgentHostForTests(host)

    const done = await upgradeAutopilotFeatures(ctx)

    expect(done.sort((a, b) => a.featureId.localeCompare(b.featureId))).toEqual([
      { featureId: 'feat_all', leveled: true, returnedWait: 'Which currency?' },
      { featureId: 'feat_draft', leveled: true, returnedWait: null },
      { featureId: 'feat_set', leveled: false, returnedWait: null },
    ])
    expect(getFeatureRow(ctx, 'feat_all').involvement).toBe('resultOnly')
    expect(getFeatureRow(ctx, 'feat_draft').involvement).toBe('resultOnly')
    expect(getFeatureRow(ctx, 'feat_set').involvement).toBe('designsAndResult')
    expect(getFeatureRow(ctx, 'feat_off').involvement).toBe('everything')
    expect(getFeatureRow(ctx, 'feat_done').involvement).toBe('everything')
    expect(db.select().from(events).where(eq(events.type, INVOLVEMENT_CHANGED)).all().map((e) => e.featureId).sort()).toEqual([
      'feat_all',
      'feat_draft',
    ])

    // The question comes back as the lead chat's wait; the lead hears autopilot is gone.
    expect(waitOf(ctx, 'sess_lead')).toMatchObject({ why: 'Which currency?', by: 'agent' })
    expect(promptsOf('sess_lead').map((p) => p.text)).toContain(AUTOPILOT_GONE_NOTE)

    expect(await upgradeAutopilotFeatures(ctx)).toEqual([])
    expect(db.select().from(events).where(eq(events.type, AUTOPILOT_UPGRADED)).all()).toHaveLength(3)
    expect(db.select().from(events).where(eq(events.type, INVOLVEMENT_CHANGED)).all()).toHaveLength(2)
  })
})
