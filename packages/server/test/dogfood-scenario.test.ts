import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { RuncastleConfig } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sql-js'
import { simpleGit } from 'simple-git'
import initSqlJs from 'sql.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { features, schema, tickets } from '../src/db/schema'
import { runMigrations } from '../src/db/migrate'
import type { AppCtx, Db } from '../src/db/types'
import { openProject } from '../src/services/projects'
import { resolveBun } from './helpers/bun'
import { rmTemp } from './helpers/fixtures'

/**
 * Runcastle's dogfood scenario, `.runcastle/scenarios/review/feature-at-review.ts`,
 * run the way the scenario runner (`bun {file}`) runs it: a bun child at the
 * repo root, env in, `ENTRY_URL=` out. The suite runs under node, which cannot
 * open `bun:sqlite`, so the drive's db file is written and read back here with
 * sql.js, and the child is the only bun in the picture.
 */

const BUN = resolveBun()
const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..')
const SCENARIO = join('.runcastle', 'scenarios', 'review', 'feature-at-review.ts')

/** The child's env: nothing runcastle inherited, plus what a drive would hand it. */
function scenarioEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('RUNCASTLE_')) env[key] = value
  }
  return {
    ...env,
    RUNCASTLE_MIGRATIONS_DIR: join(REPO_ROOT, 'packages', 'server', 'drizzle'),
    ...extra,
  }
}

function runScenario(extra: Record<string, string>): { status: number | null; stdout: string; stderr: string } {
  const out = spawnSync(BUN as string, [SCENARIO], {
    cwd: REPO_ROOT,
    env: scenarioEnv(extra),
    encoding: 'utf8',
    timeout: 60_000,
  })
  return { status: out.status, stdout: out.stdout, stderr: out.stderr }
}

async function openDbFile(path: string): Promise<{ ctx: AppCtx; save: () => void }> {
  const SQL = await initSqlJs()
  let sqlite: InstanceType<typeof SQL.Database>
  try {
    sqlite = new SQL.Database(readFileSync(path))
  } catch {
    sqlite = new SQL.Database()
  }
  const db = drizzle(sqlite, { schema }) as unknown as Db
  return {
    ctx: { db, config: RuncastleConfig.parse({}) },
    save: () => writeFileSync(path, Buffer.from(sqlite.export())),
  }
}

describe.skipIf(!BUN)('dogfood scenario: Feature at review', () => {
  let root: string
  let dataDir: string
  let repoPath: string
  let projectId: string

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'rc-scenario-'))
    dataDir = join(root, `.runcastle-drive-test-${Math.random().toString(16).slice(2, 8)}`)
    mkdirSync(dataDir)
    repoPath = join(root, 'runcastle-demo')
    mkdirSync(repoPath)
    const g = simpleGit(repoPath)
    await g.init(['-b', 'main'])
    await g.addConfig('user.email', 'test@runcastle.dev')
    await g.addConfig('user.name', 'Runcastle Test')
    await g.addConfig('core.autocrlf', 'false')
    writeFileSync(join(repoPath, 'README.md'), 'base\n')
    await g.add(['README.md'])
    await g.commit('initial commit')

    const { ctx, save } = await openDbFile(join(dataDir, 'runcastle.db'))
    runMigrations(ctx.db)
    projectId = (await openProject(ctx, repoPath)).id
    save()
  })

  afterEach(() => rmTemp(root))

  it('seeds a feature at review with its tickets done and prints its page', async () => {
    const out = runScenario({
      RUNCASTLE_DATA_DIR: dataDir,
      RUNCASTLE_SCENARIO_RUN: 'abc123',
    })
    expect(out.stderr).not.toMatch(/\[feature-at-review\]/)
    expect(out.status).toBe(0)

    const entries = out.stdout.split(/\r?\n/).filter((l) => l.startsWith('ENTRY_URL='))
    expect(entries).toEqual([`ENTRY_URL=/p/${projectId}/f/scenario-feature-abc123`])

    const { ctx } = await openDbFile(join(dataDir, 'runcastle.db'))
    const feature = ctx.db.select().from(features).where(eq(features.slug, 'scenario-feature-abc123')).get()
    expect(feature).toMatchObject({ projectId, phase: 'review', status: 'active' })
    const rows = ctx.db.select().from(tickets).where(eq(tickets.featureId, feature!.id)).all()
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((t) => t.status === 'done')).toBe(true)

    const branches = await simpleGit(repoPath).branchLocal()
    expect(branches.all).toContain('feature/scenario-feature-abc123')
  })

  it('exits non-zero with a readable message when the project is not registered', () => {
    const out = runScenario({ RUNCASTLE_DATA_DIR: dataDir, SCENARIO_PROJECT: 'no-such-project' })
    expect(out.status).toBe(1)
    expect(out.stderr).toContain("no-such-project is not registered in this drive's data dir")
    expect(out.stdout).not.toContain('ENTRY_URL=')
  })

  it('refuses the real data dir', () => {
    const out = runScenario({ RUNCASTLE_DATA_DIR: join(homedir(), '.runcastle') })
    expect(out.status).toBe(1)
    expect(out.stderr).toContain('refusing to seed')
    expect(out.stdout).not.toContain('ENTRY_URL=')
  })
})
