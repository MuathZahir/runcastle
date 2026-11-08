import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Feature } from '@runcastle/core'
import { sessionDir } from '@runcastle/core/paths'
import type { AppCtx } from '../src/db/types'
import { createSessionRow, getSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import { toolDropWorker, toolStartWorker } from '../src/mcp/server'
import { composeOutcomeDoc } from '../src/services/outcome'
import { setAgentHostForTests } from '../src/threads/host'
import { setSandboxEngineForTests } from '../src/workers/engine'
import { IN, guardInstallScript, runArgs } from '../src/workers/sandbox'
import { getWorker, keptConversationPath, listWorkers, withWorkers } from '../src/workers/service'
import { workerBriefing } from '../src/workers/worker'
import { createFakeAcp } from './support/fake-acp-agent'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'
import { fakeEngine, fakeHost, initRepo, type FakeEngine } from './support/fake-workers'

/**
 * A worker's sandbox, warm and bounded (burns-become-workers decisions 11, 12,
 * 13, 18): the image built before it, the project's cache and CPU cap and setup
 * command, runcastle's test-suite guard, the briefing's check rule, and the
 * conversation file and tokens kept before the sandbox goes. A fake engine
 * records what the real one is asked.
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
  it('has the engine build the project image and make the cache before the sandbox is created', async () => {
    await startWorker()
    expect(engine.order).toEqual(['prepare', 'create'])
    expect(engine.prepares[0]!.image.project.id).toBe(feature.projectId)
  })

  it('fails like a setup failure when the image will not build, creating no sandbox', async () => {
    engine.prepareFailure = 'the sandbox image did not build'
    await expect(startWorker()).rejects.toThrow(/could not start its sandbox: the sandbox image did not build/)
    expect(engine.created).toEqual([])
    expect(listWorkers(ctx, feature.id).map((w) => w.status)).toEqual(['failed'])
  })

  it('seeds the install from the project cache, with the CPU cap and the setup command', async () => {
    writeFileSync(join(repo, 'package.json'), '{}')
    writeFileSync(join(repo, 'bun.lock'), '')
    ctx.config.burnCpus = 2
    ctx.config.setupCommand = 'bun run prepare'
    await startWorker()
    const made = engine.created[0]!
    expect(made.cpus).toBe(2)
    expect(made.setupCommand).toBe('bun run prepare')
    expect(made.cache).toMatchObject({ volume: `runcastle-${feature.projectId}` })
    expect(made.cache!.env.BUN_INSTALL_CACHE_DIR).toBe('/home/agent/cache/store/bun')
    expect(made.cache!.dirs).toContain('/home/agent/cache/store/bun')
  })

  it('never points pnpm at the volume, and mounts nothing with burnCache off', async () => {
    writeFileSync(join(repo, 'package.json'), '{}')
    writeFileSync(join(repo, 'pnpm-lock.yaml'), '')
    await startWorker()
    expect(engine.created[0]!.cache!.env).toEqual({})
    expect(engine.created[0]!.cache!.dirs.some((d) => d.includes('/store/'))).toBe(false)

    ctx.config.burnCache = 'off'
    await startWorker()
    expect(engine.created[1]!.cache).toBeUndefined()
    expect(engine.created[1]!.cpus).toBeUndefined()
  })

  it('puts the cache volume, its env and the CPU cap on the container command line', () => {
    const args = runArgs({
      engine: 'docker', container: 'c', image: 'img', port: 41000, originDir: '/o', runtimeDir: '/r', uid: 1, gid: 2,
      cache: { volume: 'runcastle-proj', env: { BUN_INSTALL_CACHE_DIR: '/home/agent/cache/store/bun' } },
      cpus: 1.5,
    })
    expect(args.join(' ')).toContain('--cpus 1.5')
    expect(args.join(' ')).toContain('-v runcastle-proj:/home/agent/cache')
    expect(args.join(' ')).toContain('-e BUN_INSTALL_CACHE_DIR=/home/agent/cache/store/bun')
    expect(runArgs({ engine: 'docker', container: 'c', image: 'img', port: 1, originDir: '/o', runtimeDir: '/r', uid: 1, gid: 2 }).join(' ')).not.toMatch(/--cpus|cache/)
  })
})

describe("runcastle's test-suite guard", () => {
  async function copyOnce(): Promise<void> {
    const id = await startWorker()
    engine.transport = createFakeAcp().transport
    const transport = withWorkers(ctx, () => {
      throw new Error('only workers run here')
    })
    await transport({} as never, getSessionRow(ctx, id)!)
  }

  it('rides every setup copy of a Claude Code worker while the guard is on', async () => {
    await copyOnce()
    expect(engine.setups.map((s) => s.guard)).toEqual([true])
    expect(engine.fingerprints.get(engine.setups[0]!.container)).toMatch(/-guard$/)
  })

  it('is left out with burnGuard off', async () => {
    ctx.config.burnGuard = false
    await copyOnce()
    expect(engine.setups.map((s) => s.guard)).toEqual([false])
  })

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
})

describe('the conversation kept before the sandbox goes', () => {
  const line = (output: number): string =>
    JSON.stringify({
      type: 'assistant',
      timestamp: new Date().toISOString(),
      message: { id: `m${output}`, role: 'assistant', usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: output } },
    })

  it('copies the agent’s file into the thread’s session dir, records the tokens, and only then removes the sandbox', async () => {
    const id = await startWorker()
    markSessionLive(ctx, id, { ccSessionId: 'conv-1' })
    engine.conversationPaths.set('conv-1', '/home/agent/.claude/projects/-repo/conv-1.jsonl')
    engine.sandboxFiles.set('/home/agent/.claude/projects/-repo/conv-1.jsonl', `${line(30)}\n${line(12)}\n`)

    await toolDropWorker(ctx, leadSession(), { workerId: id })

    expect(engine.order.slice(-2)).toEqual(['copyOut', 'remove'])
    expect(keptConversationPath(id)).toBe(join(sessionDir(id), 'agent-conversation.jsonl'))
    expect(readFileSync(keptConversationPath(id), 'utf8')).toContain('"output_tokens":30')
    expect(getWorker(ctx, id)!.tokens).toBe(42)
  })

  it('still removes a sandbox whose conversation file cannot be found, leaving the tokens uncounted', async () => {
    const id = await startWorker()
    markSessionLive(ctx, id, { ccSessionId: 'conv-2' })
    await toolDropWorker(ctx, leadSession(), { workerId: id })
    expect(engine.order.at(-1)).toBe('remove')
    expect(existsSync(keptConversationPath(id))).toBe(false)
    expect(getWorker(ctx, id)!.tokens).toBeNull()
  })

  it('lists each worker with its tokens in the outcome', async () => {
    const id = await startWorker()
    markSessionLive(ctx, id, { ccSessionId: 'conv-1' })
    engine.conversationPaths.set('conv-1', '/c.jsonl')
    engine.sandboxFiles.set('/c.jsonl', `${line(42)}\n`)
    await toolDropWorker(ctx, leadSession(), { workerId: id })
    const doc = composeOutcomeDoc({
      feature,
      tickets: [],
      workers: [getWorker(ctx, id)!],
      findings: [],
      notes: [],
      artifacts: [],
      shippedAt: 0,
      delta: { commits: 1, files: 1 },
    })
    expect(doc).toContain('## Workers\n\n- Header (on-its-own) — dropped · 42 tokens')
  })
})
