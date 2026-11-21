import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Feature } from '@runcastle/core'
import { dataDir } from '@runcastle/core/paths'
import type { AppCtx } from '../src/db/types'
import { createSessionRow, getSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import { toolStartWorker } from '../src/mcp/server'
import { setAgentHostForTests } from '../src/threads/host'
import { setSandboxEngineForTests } from '../src/workers/engine'
import { IN, cachePrepareScript, cacheTmpSweepScript, guardInstallScript, runArgs } from '../src/workers/sandbox'
import { getWorker } from '../src/workers/service'
import { workerBriefing, workerLabels } from '../src/workers/worker'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'
import { fakeEngine, fakeHost, initRepo, type FakeEngine } from './support/fake-workers'

/**
 * What is left of the sandbox for an old worker, and what a host worker gets (burns-become-workers
 * decisions 11, 12, 13, 18): the container command line (cache volume, CPU cap, labels), the cache temp
 * sweep, runcastle's test-suite guard install script, and the briefing's check rule. A new worker runs on
 * the host, with no image, cache volume or setup copy.
 */

let ctx: AppCtx
let home: string
let restoreDataDir: () => void
let repo: string
let feature: Feature
let lead: string
let engine: FakeEngine

beforeEach(async () => {
  home = tmpRepo()
  restoreDataDir = useDataDir(home)
  ctx = await makeTestCtx()
  repo = initRepo('work')
  feature = seedFeature(ctx, seedProject(ctx, repo).id, { slug: 'work' })
  lead = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: '/wt' }).id
  markSessionLive(ctx, lead, { ccSessionId: `cc-${lead}` })
  markSessionEnded(ctx, lead)
  engine = fakeEngine()
  setSandboxEngineForTests(engine)
  setAgentHostForTests(fakeHost().host)
  vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'test-token')
  vi.stubEnv('HOME', home)
})

afterEach(() => {
  setAgentHostForTests(undefined)
  setSandboxEngineForTests(undefined)
  vi.unstubAllEnvs()
  restoreDataDir()
  rmTemp(home)
  rmTemp(repo)
})

const leadSession = () => getSessionRow(ctx, lead)!

async function startWorker(): Promise<string> {
  const { workerId } = await toolStartWorker(ctx, leadSession(), { label: 'Header', purpose: 'The header', kind: 'on-its-own', goal: 'Build it' })
  return workerId
}

describe('the start', () => {
  it('puts the cache volume, its env and the CPU cap on the container command line', () => {
    const args = runArgs({
      engine: 'docker', container: 'c', image: 'img', port: 41000, originDir: '/o', runtimeDir: '/r', uid: 1, gid: 2,
      cache: { volume: 'runcastle-proj', env: { BUN_INSTALL_CACHE_DIR: '/home/agent/cache/store/bun' } },
      cpus: 1.5,
      labels: {},
    })
    expect(args.join(' ')).toContain('--cpus 1.5')
    expect(args.join(' ')).toContain('-v runcastle-proj:/home/agent/cache')
    expect(args.join(' ')).toContain('-e BUN_INSTALL_CACHE_DIR=/home/agent/cache/store/bun')
    expect(runArgs({ engine: 'docker', container: 'c', image: 'img', port: 1, originDir: '/o', runtimeDir: '/r', uid: 1, gid: 2, labels: {} }).join(' ')).not.toMatch(/--cpus|cache/)
  })

  it('labels the container with runcastle, this data folder, its worker and its project (cleans-up decision 5)', () => {
    const args = runArgs({
      engine: 'docker', container: 'c', image: 'img', port: 1, originDir: '/o', runtimeDir: '/r', uid: 1, gid: 2,
      labels: workerLabels('sess_w1', 'proj_p1'),
    })
    const labels = args.flatMap((a, i) => (args[i - 1] === '--label' ? [a] : []))
    expect(labels).toEqual([
      'runcastle.owner=runcastle',
      `runcastle.data-dir=${dataDir()}`,
      'runcastle.worker=sess_w1',
      'runcastle.project=proj_p1',
    ])
    // Before the image, which ends the options.
    expect(args.lastIndexOf('--label')).toBeLessThan(args.indexOf('img'))
  })

  it('deletes only temp files older than a day, in the cache volume’s temp folder, before the agent starts (cleans-up decision 9)', async () => {
    expect(cacheTmpSweepScript()).toBe('[ -d /home/agent/cache/tmp ] && find /home/agent/cache/tmp -mindepth 1 -mtime +1 -delete 2>/dev/null; true')
    // The setup runs it right after making the cache's dirs, long before the agent's first turn.
    expect(cachePrepareScript(['/home/agent/cache/store/bun'])).toBe(`mkdir -p '/home/agent/cache/store/bun' && ${cacheTmpSweepScript()}`)
  })
})

describe("runcastle's test-suite guard", () => {
  it('installs its script and merges only a PreToolUse hook over the copied settings', () => {
    const script = guardInstallScript()
    expect(script).toContain('/.claude/hooks/burn-guard.sh')
    expect(script).toContain(`${IN.home}/.claude/settings.json`)
    expect(script).toContain('c.hooks=g.hooks')
  })
})

describe('the briefing', () => {
  it('carries the check rule: targeted tests, one static check, never the whole suite', async () => {
    const id = await startWorker()
    const w = getWorker(ctx, id)!
    const text = workerBriefing(
      { id, engine: 'docker', runtime: 'claude-code', container: w.container!, repoPath: repo, featureBranch: w.featureBranch, branch: w.branch!, port: 41001, previewUrl: 'http://localhost:41001/' },
      { label: w.label, kind: w.kind, goal: w.goal, doneWhen: w.doneWhen },
    )
    expect(text).toMatch(/run only the tests that cover each slice/)
    expect(text).toMatch(/static check .* once at the end/)
    expect(text).toMatch(/Never run the full test suite/)
  })

  it('steps back after the second failed try and stops after the third (agents-test-like-owners decision 8)', async () => {
    const id = await startWorker()
    const w = getWorker(ctx, id)!
    const sb = { id, engine: 'docker' as const, runtime: 'claude-code' as const, container: w.container!, repoPath: repo, featureBranch: w.featureBranch, branch: w.branch!, port: 41001, previewUrl: 'http://localhost:41001/' }
    const brief = (kind: 'on-its-own' | 'with-you' | 'unassigned' | 'review'): string => workerBriefing(sb, { label: w.label, kind, goal: w.goal, doneWhen: w.doneWhen })
    expect(brief('review')).not.toContain('step back')
    expect(brief('review')).not.toContain('After the third')
    for (const kind of ['on-its-own', 'with-you', 'unassigned'] as const) {
      expect(brief(kind)).toContain('After the second, step back before a third: ask whether the approach is wrong')
    }
    expect(brief('on-its-own')).toContain('After the third, stop and hand back with what you tried and what each check showed.')
    expect(brief('with-you')).toContain('After the third, stop and tell the human here what you tried')
    expect(brief('unassigned')).toContain('After the third, stop and tell the human here what you tried')
  })
})
