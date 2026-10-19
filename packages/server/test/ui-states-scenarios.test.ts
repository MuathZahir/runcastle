import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { RuncastleConfig, StoriesManifest, StoryIndex } from '@runcastle/core'
import { STORIES_MANIFEST } from '@runcastle/core/paths'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sql-js'
import initSqlJs from 'sql.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { features, projects, schema } from '../src/db/schema'
import type { AppCtx, Db } from '../src/db/types'
import { resolveBun } from './helpers/bun'
import { rmTemp } from './helpers/fixtures'

/**
 * The "Feature with UI states" scenarios, run the way the scenario runner
 * (`bun {file}`) runs them: a bun child at the repo root, env in, URLs out.
 * `SCENARIO_REPO` points them at a temp repo whose `stories.json` build is a
 * stub writing fixture `index.json` / `preview-stats.json`, so no real
 * Storybook runs. The drive's db is read back with sql.js (the suite runs
 * under node).
 */

const BUN = resolveBun()
const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..')
const REAL = join('.runcastle', 'scenarios', 'feature', 'review', 'feature-with-ui-states.ts')
const EVERY = join('.runcastle', 'scenarios', 'feature', 'review', 'ui-states-every-state.ts')
const DRIVE_BRANCH = 'drive/ui-states'

const STORY_FILES = ['Coupon', 'Cart', 'Price', 'Banner'].map((n) => `.runcastle/stories/shop/${n}.stories.tsx`)
const entry = (file: string) => {
  const name = file.split('/').pop()!.replace('.stories.tsx', '')
  const id = `shop-${name.toLowerCase()}--default`
  return { id, title: `shop/${name}`, name: 'Default', importPath: `./${file}`, type: 'story' }
}
const INDEX = {
  v: 5,
  entries: {
    ...Object.fromEntries(STORY_FILES.map((f) => [entry(f).id, entry(f)])),
    'shop-coupon--docs': { id: 'shop-coupon--docs', title: 'shop/Coupon', name: 'Docs', importPath: `./${STORY_FILES[0]}`, type: 'docs' },
  },
}
const STATS = { modules: STORY_FILES.map((f) => ({ name: `./${f}`, reasons: [] })) }
const STORY_IDS = STORY_FILES.map((f) => entry(f).id)

/** The stub build: writes the fixture output into the `{out}` it is handed. */
const FAKE_BUILD = `import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
const out = process.argv[2]
writeFileSync(join(out, 'index.json'), ${JSON.stringify(JSON.stringify(INDEX))})
writeFileSync(join(out, 'preview-stats.json'), ${JSON.stringify(JSON.stringify(STATS))})
writeFileSync(join(out, 'iframe.html'), '<html></html>')
`

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
}

function write(repo: string, rel: string, text: string): void {
  mkdirSync(dirname(join(repo, rel)), { recursive: true })
  writeFileSync(join(repo, rel), text)
}

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

function runScenario(file: string, extra: Record<string, string>) {
  const out = spawnSync(BUN as string, [file], {
    cwd: REPO_ROOT,
    env: scenarioEnv(extra),
    encoding: 'utf8',
    timeout: 60_000,
  })
  return { status: out.status, stdout: out.stdout, stderr: out.stderr }
}

function printed(stdout: string, key: string): string[] {
  return stdout.split(/\r?\n/).filter((l) => l.startsWith(`${key}=`)).map((l) => l.slice(key.length + 1))
}

async function openDb(path: string): Promise<AppCtx> {
  const SQL = await initSqlJs()
  const db = drizzle(new SQL.Database(readFileSync(path)), { schema }) as unknown as Db
  return { db, config: RuncastleConfig.parse({}) }
}

describe.skipIf(!BUN)('UI states scenarios', () => {
  let root: string
  let dataDir: string
  let repo: string
  let env: Record<string, string>

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rc-ui-scenario-'))
    dataDir = join(root, `.runcastle-drive-test-${Math.random().toString(16).slice(2, 8)}`)
    mkdirSync(dataDir)
    repo = join(root, 'shop')
    mkdirSync(repo)
    git(repo, 'init', '-q', '-b', 'main')
    git(repo, 'config', 'user.email', 'test@runcastle.invalid')
    git(repo, 'config', 'user.name', 'test')
    git(repo, 'config', 'core.autocrlf', 'false')
    write(repo, 'README.md', 'base\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'base')
    // The drive's branch: stories set up, which main does not have.
    git(repo, 'checkout', '-q', '-b', DRIVE_BRANCH)
    write(repo, 'fake-build.ts', FAKE_BUILD)
    write(repo, '.runcastle/stories.json', JSON.stringify({ build: `"${BUN}" fake-build.ts {out}` }))
    for (const file of STORY_FILES) write(repo, file, 'export default {}\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'stories')
    env = {
      RUNCASTLE_DATA_DIR: dataDir,
      RUNCASTLE_BRANCH: DRIVE_BRANCH,
      RUNCASTLE_SCENARIO_RUN: 'abc123',
      SCENARIO_REPO: repo,
    }
  })

  afterEach(() => rmTemp(root))

  async function featureBySlug(slug: string) {
    const ctx = await openDb(join(dataDir, 'runcastle.db'))
    const feature = ctx.db.select().from(features).where(eq(features.slug, slug)).get()
    const project = ctx.db.select().from(projects).where(eq(projects.repoPath, repo)).get()
    expect(feature).toBeDefined()
    expect(project).toBeDefined()
    return { feature: feature!, project: project! }
  }

  function manifestOf(featureId: string): StoriesManifest {
    const path = join(dataDir, 'stories', 'features', featureId, STORIES_MANIFEST)
    return StoriesManifest.parse(JSON.parse(readFileSync(path, 'utf8')))
  }

  it('feature-with-ui-states registers the checkout, builds it for real and shows every story as new', async () => {
    const refsBefore = git(repo, 'for-each-ref')
    const out = runScenario(REAL, env)
    expect(out.stderr).not.toMatch(/\[feature-with-ui-states\]/)
    expect(out.status).toBe(0)
    expect(out.stdout).toContain('[feature-with-ui-states] built: 0 changed, 4 new, 0 also affected')

    const { feature, project } = await featureBySlug('ui-states-abc123')
    expect(printed(out.stdout, 'ENTRY_URL')).toEqual([`/p/${project.id}/f/ui-states-abc123`])
    expect(feature).toMatchObject({
      projectId: project.id,
      phase: 'review',
      status: 'active',
      branch: DRIVE_BRANCH,
      baseBranch: 'main',
    })

    const manifest = manifestOf(feature.id)
    expect(manifest).toMatchObject({ status: 'built', base: 'none', commit: git(repo, 'rev-parse', 'HEAD') })
    expect(manifest.stories.map((s) => s.id).sort()).toEqual([...STORY_IDS].sort())
    expect(manifest.stories.every((s) => s.kind === 'new')).toBe(true)
    expect(existsSync(join(dataDir, 'stories', 'features', feature.id, 'iframe.html'))).toBe(true)

    expect(git(repo, 'for-each-ref')).toBe(refsBefore)
    expect(git(repo, 'worktree', 'list').split('\n')).toHaveLength(1)
  })

  it('ui-states-every-state seeds a compare feature and a failed one', async () => {
    const refsBefore = git(repo, 'for-each-ref')
    const out = runScenario(EVERY, env)
    expect(out.stderr).not.toMatch(/\[ui-states-every-state\]/)
    expect(out.status).toBe(0)

    const compare = await featureBySlug('ui-states-compared-abc123')
    const failed = await featureBySlug('ui-states-failed-abc123')
    expect(printed(out.stdout, 'ENTRY_URL')).toEqual([`/p/${compare.project.id}/f/ui-states-compared-abc123`])
    expect(printed(out.stdout, 'FAILED_URL')).toEqual([`/p/${failed.project.id}/f/ui-states-failed-abc123`])
    for (const { feature } of [compare, failed]) {
      expect(feature).toMatchObject({ phase: 'review', status: 'active', branch: DRIVE_BRANCH })
    }

    const shown = manifestOf(compare.feature.id)
    expect(shown).toMatchObject({ status: 'built', base: 'built' })
    const kinds = shown.stories.map((s) => s.kind)
    expect(kinds.filter((k) => k === 'changed')).toHaveLength(2)
    expect(kinds.filter((k) => k === 'new')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'affected')).toHaveLength(1)
    expect(shown.stories.map((s) => s.id).sort()).toEqual([...STORY_IDS].sort())
    expect(existsSync(join(dataDir, 'stories', 'features', compare.feature.id, 'iframe.html'))).toBe(true)

    const baseDir = join(dataDir, 'stories', 'base', shown.baseCommit!)
    expect(existsSync(join(baseDir, 'iframe.html'))).toBe(true)
    const baseIndex = StoryIndex.parse(JSON.parse(readFileSync(join(baseDir, 'index.json'), 'utf8')))
    const newId = shown.stories.find((s) => s.kind === 'new')!.id
    expect(Object.keys(baseIndex.entries)).not.toContain(newId)
    for (const s of shown.stories.filter((x) => x.kind === 'changed')) {
      expect(Object.keys(baseIndex.entries)).toContain(s.id)
    }

    const broken = manifestOf(failed.feature.id)
    expect(broken).toMatchObject({ status: 'failed', log: 'build.log', stories: [] })
    const log = readFileSync(join(dataDir, 'stories', 'features', failed.feature.id, 'build.log'), 'utf8')
    expect(log).toContain('Build failed')

    expect(git(repo, 'for-each-ref')).toBe(refsBefore)
  })

  it.each([REAL, EVERY])('%s refuses the real data dir', (file) => {
    const refsBefore = git(repo, 'for-each-ref')
    const out = runScenario(file, { ...env, RUNCASTLE_DATA_DIR: join(homedir(), '.runcastle') })
    expect(out.status).toBe(1)
    expect(out.stderr).toContain('refusing to seed')
    expect(out.stdout).not.toContain('ENTRY_URL=')
    expect(git(repo, 'for-each-ref')).toBe(refsBefore)
  })
})
