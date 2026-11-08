import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { foldThread, RuncastleConfig, type ThreadEvent } from '@runcastle/core'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sql-js'
import { simpleGit } from 'simple-git'
import initSqlJs from 'sql.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { features, readyDeclarations, reviewFindings, schema, sessions, tickets, workers } from '../src/db/schema'
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

function runScenario(extra: Record<string, string>, scenario = SCENARIO): { status: number | null; stdout: string; stderr: string } {
  const out = spawnSync(BUN as string, [scenario], {
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

  it('seeds a feature declared ready, whose Review worker handed back with findings and a package, and prints its page', async () => {
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
    expect(feature).toMatchObject({ projectId, status: 'active', waitingReason: 'ready to test' })
    expect(ctx.db.select().from(tickets).where(eq(tickets.featureId, feature!.id)).all()).toEqual([])
    const [review] = ctx.db.select().from(workers).where(eq(workers.featureId, feature!.id)).all()
    expect(review).toMatchObject({ kind: 'review', label: 'Review', status: 'handed-back', reviewMode: 'drive' })
    expect(review!.handbackSummary).toMatch(/^Drive review: /)
    const found = ctx.db.select().from(reviewFindings).where(eq(reviewFindings.featureId, feature!.id)).all()
    expect(found.map((f) => [f.kind, f.reviewWorkerId, f.reviewTicketId])).toEqual([
      ['defect', review!.id, null],
      ['observation', review!.id, null],
    ])
    expect(readFileSync(join(dataDir, 'reviews', review!.id, 'saw', 'saw.jsonl'), 'utf8')).toContain('"kind":"shot"')
    const lead = ctx.db.select().from(sessions).where(eq(sessions.featureId, feature!.id)).all().find((s) => s.kind === 'chat')!
    const leadLog = readFileSync(join(dataDir, 'sessions', lead.id, 'thread.jsonl'), 'utf8')
    expect(leadLog).toContain(`"reviewPackage":{"workerId":"${review!.id}","label":"Review"}`)
    const declared = ctx.db.select().from(readyDeclarations).where(eq(readyDeclarations.featureId, feature!.id)).all()
    expect(declared).toEqual([expect.objectContaining({ scenario: 'review/feature-at-review.ts' })])

    const branches = await simpleGit(repoPath).branchLocal()
    expect(branches.all).toContain('feature/scenario-feature-abc123')
  })

  // `.runcastle/scenarios/workers/feature-with-workers.ts` (interactive-workers): the drive lands on its page.
  it('seeds a feature with a lead chat, a worker in every status and an old side chat, and prints its page', async () => {
    const out = runScenario(
      { RUNCASTLE_DATA_DIR: dataDir, RUNCASTLE_SCENARIO_RUN: 'abc123' },
      join('.runcastle', 'scenarios', 'workers', 'feature-with-workers.ts'),
    )
    expect(out.stderr).not.toMatch(/\[feature-with-workers\]/)
    expect(out.status).toBe(0)
    expect(out.stdout.split(/\r?\n/).filter((l) => l.startsWith('ENTRY_URL='))).toEqual([
      `ENTRY_URL=/p/${projectId}/f/workers-feature-abc123`,
    ])

    const { ctx } = await openDbFile(join(dataDir, 'runcastle.db'))
    const feature = ctx.db.select().from(features).where(eq(features.slug, 'workers-feature-abc123')).get()
    const rows = ctx.db.select().from(workers).where(eq(workers.featureId, feature!.id)).all()
    expect(rows.map((w) => w.status).sort()).toEqual(
      ['dropped', 'failed', 'handed-back', 'landed', 'needs-you', 'needs-you', 'queued', 'working', 'working'],
    )
    expect(rows.filter((w) => w.handbackSummary).length).toBe(3)
    const kinds = ctx.db.select().from(sessions).where(eq(sessions.featureId, feature!.id)).all().map((s) => s.kind)
    expect(kinds.filter((k) => k === 'chat')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'side')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'worker')).toHaveLength(rows.length)
  })

  // `.runcastle/scenarios/chat/words-between-work.ts` (every-word-the-agent-writes-stays-in-view): a project chat to read.
  it('seeds a project chat whose turns have words between their work, and prints its page', async () => {
    const out = runScenario(
      { RUNCASTLE_DATA_DIR: dataDir, RUNCASTLE_SCENARIO_RUN: 'abc123' },
      join('.runcastle', 'scenarios', 'chat', 'words-between-work.ts'),
    )
    expect(out.stderr).not.toMatch(/\[words-between-work\]/)
    expect(out.status).toBe(0)
    const { ctx } = await openDbFile(join(dataDir, 'runcastle.db'))
    const chat = ctx.db.select().from(sessions).where(eq(sessions.projectId, projectId)).all().find((s) => s.kind === 'project')!
    expect(out.stdout.split(/\r?\n/).filter((l) => l.startsWith('ENTRY_URL='))).toEqual([`ENTRY_URL=/p/${projectId}/chat?thread=${chat.id}`])

    const log = readFileSync(join(dataDir, 'sessions', chat.id, 'thread.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as ThreadEvent)
    const view = foldThread(log)
    expect(view.items.map((x) => x.kind)).toEqual([
      'user', 'work', 'agent', 'work', 'agent', 'work', 'agent', 'work', 'agent', 'shown', 'agent', 'changes',
      'user', 'agent',
      'user', 'agent', 'work', 'agent', 'work', 'agent', 'work', 'agent', 'work', 'agent', 'work', 'agent', 'changes',
    ])
    const shown = view.items.find((x) => x.kind === 'shown')
    const file = shown?.kind === 'shown' ? shown.files[0] : undefined
    expect(readFileSync(join(dataDir, 'sessions', chat.id, 'shown', file!.src.split('/').pop()!), 'utf8')).toContain('<svg')
  })

  // `.runcastle/scenarios/workers/feature-with-drive-workers.ts` (drive-chats-become-workers): the drive lands on its page.
  it('seeds a feature with its drive workers and an old drive chat, the project’s own Scenarios worker, and prints its page', async () => {
    const out = runScenario(
      { RUNCASTLE_DATA_DIR: dataDir, RUNCASTLE_SCENARIO_RUN: 'abc123' },
      join('.runcastle', 'scenarios', 'workers', 'feature-with-drive-workers.ts'),
    )
    expect(out.stderr).not.toMatch(/\[feature-with-drive-workers\]/)
    expect(out.status).toBe(0)
    expect(out.stdout.split(/\r?\n/).filter((l) => l.startsWith('ENTRY_URL='))).toEqual([
      `ENTRY_URL=/p/${projectId}/f/drive-workers-feature-abc123`,
    ])

    const { ctx } = await openDbFile(join(dataDir, 'runcastle.db'))
    const feature = ctx.db.select().from(features).where(eq(features.slug, 'drive-workers-feature-abc123')).get()
    const rows = ctx.db.select().from(workers).where(eq(workers.projectId, projectId)).all()
    const owned = (w: (typeof rows)[number]) => [w.featureId === feature!.id ? 'feature' : w.featureId === null ? 'project' : 'other', w.kind, w.status, w.featureBranch]
    expect(rows.map(owned).sort()).toEqual(
      [
        ['feature', 'fix-drive', 'handed-back', feature!.branch],
        ['feature', 'on-its-own', 'working', feature!.branch],
        ['feature', 'scenario', 'needs-you', feature!.branch],
        ['project', 'scenario', 'handed-back', 'main'],
      ].sort(),
    )
    const fix = rows.find((w) => w.kind === 'fix-drive')!
    expect(fix.handbackFiles).toEqual(['.runcastle/drive-setup.sh'])
    const kinds = ctx.db.select().from(sessions).where(eq(sessions.featureId, feature!.id)).all().map((s) => s.kind)
    expect(kinds.filter((k) => k === 'drive-fix')).toHaveLength(1)
    const lead = ctx.db.select().from(sessions).where(eq(sessions.featureId, feature!.id)).all().find((s) => s.kind === 'chat')!
    const leadLog = readFileSync(join(dataDir, 'sessions', lead.id, 'thread.jsonl'), 'utf8')
    expect(leadLog).toContain('"held":true')
    expect(leadLog).toContain(`"branch":"${feature!.branch}"`)
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
