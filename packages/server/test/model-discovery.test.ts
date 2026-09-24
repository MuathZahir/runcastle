import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk'
import {
  discoverClaudeModels,
  discoverCodexModels,
  refreshModelDiscovery,
  startModelDiscovery,
} from '../src/services/model-discovery'
import { listByProject } from '../src/services/events'
import { makeTestCtx } from './helpers/db'

describe('Claude model discovery', () => {
  it('uses pinned ids, deduplicates them, never sends a prompt, and closes the query', async () => {
    const close = vi.fn()
    let prompt: AsyncIterable<unknown> | undefined
    const models: ModelInfo[] = [
      {
        value: 'opus',
        resolvedModel: 'claude-opus-5-5',
        displayName: 'Opus 5.5',
        description: 'Most capable',
      },
      {
        value: 'claude-opus-5-5',
        displayName: 'Opus duplicate',
        description: 'Duplicate alias target',
      },
      { value: '', displayName: 'Empty', description: 'Ignored' },
      { value: 'sonnet', displayName: 'Sonnet', description: 'Fast' },
    ]

    const result = await discoverClaudeModels({
      resolveBinary: () => '/host/bin/claude',
      createQuery: (input) => {
        prompt = input.prompt
        expect(input.pathToClaudeCodeExecutable).toBe('/host/bin/claude')
        return { initializationResult: async () => ({ models }), close }
      },
      timeoutMs: 1_000,
    })

    expect(await prompt?.[Symbol.asyncIterator]().next()).toEqual({ done: true, value: undefined })
    expect(result).toEqual([
      {
        id: 'claude-opus-5-5',
        runtime: 'claude-code',
        displayName: 'Opus 5.5',
        description: 'Most capable',
      },
      {
        id: 'sonnet',
        runtime: 'claude-code',
        displayName: 'Sonnet',
        description: 'Fast',
      },
    ])
    expect(close).toHaveBeenCalledOnce()
  })

  it('closes a timed-out query and reports a readable failure', async () => {
    const close = vi.fn()
    await expect(
      discoverClaudeModels({
        resolveBinary: () => 'claude',
        createQuery: () => ({ initializationResult: () => new Promise(() => {}), close }),
        timeoutMs: 5,
      }),
    ).rejects.toThrow('Claude model discovery timed out')
    expect(close).toHaveBeenCalledOnce()
  })
})

describe('Codex model discovery', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
    dirs.length = 0
  })

  it('reads CODEX_HOME, keeps list entries in priority order, and carries retirement', async () => {
    const codexHome = mkdtempSync(join(tmpdir(), 'runcastle-codex-models-'))
    dirs.push(codexHome)
    let readPath = ''
    const fixture = JSON.stringify({
      fetched_at: '2026-09-01T00:00:00Z',
      client_version: '1.2.3',
      ignored: true,
      models: [
        {
          slug: 'gpt-later',
          display_name: 'GPT Later',
          description: 'Later',
          visibility: 'list',
          priority: 20,
          upgrade: null,
          unknown: 'ignored',
        },
        {
          slug: 'gpt-hidden',
          display_name: 'Hidden',
          description: 'Hidden',
          visibility: 'hide',
          priority: 1,
          upgrade: null,
        },
        {
          slug: 'gpt-first',
          display_name: 'GPT First',
          description: 'First',
          visibility: 'list',
          priority: 2,
          upgrade: {
            model: 'gpt-replacement',
            migration_markdown: 'Move soon',
            retirement_at: '2026-10-14',
          },
        },
      ],
    })

    const result = await discoverCodexModels({
      env: { CODEX_HOME: codexHome },
      readFile: async (path) => {
        readPath = path
        return fixture
      },
    })

    expect(readPath).toBe(join(codexHome, 'models_cache.json'))
    expect(result).toEqual([
      {
        id: 'gpt-first',
        runtime: 'codex',
        displayName: 'GPT First',
        description: 'First',
        retirement: { at: '2026-10-14', replacement: 'gpt-replacement' },
      },
      {
        id: 'gpt-later',
        runtime: 'codex',
        displayName: 'GPT Later',
        description: 'Later',
      },
    ])
  })

  it('reports missing and malformed caches readably', async () => {
    await expect(
      discoverCodexModels({
        env: { CODEX_HOME: '/missing' },
        readFile: async () => {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        },
      }),
    ).rejects.toThrow('no Codex models cache — log in to Codex')

    await expect(
      discoverCodexModels({ env: {}, readFile: async () => readFileSync(import.meta.filename, 'utf8') }),
    ).rejects.toThrow('invalid Codex models cache')
  })
})

describe('model discovery refresh', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
    dirs.length = 0
  })

  it('persists successes, tracks new ids, keeps last-good data on failure, and emits only changes', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'runcastle-discovery-service-'))
    dirs.push(dataDir)
    const previousDataDir = process.env.RUNCASTLE_DATA_DIR
    process.env.RUNCASTLE_DATA_DIR = dataDir
    const ctx = await makeTestCtx()
    let now = 100
    let claudeModels = [
      { id: 'claude-one', runtime: 'claude-code' as const, displayName: 'Claude One' },
    ]
    let codexFailure: Error | undefined
    const deps = {
      discoverClaude: async () => claudeModels,
      discoverCodex: async () => {
        if (codexFailure) throw codexFailure
        return [{ id: 'gpt-one', runtime: 'codex' as const }]
      },
      now: () => now,
    }

    try {
      const first = await refreshModelDiscovery(ctx, deps)
      expect(first.sources['claude-code']).toMatchObject({
        status: 'ok',
        lastAttemptAt: 100,
        lastSuccessAt: 100,
        newIds: [],
      })
      expect(first.sources.codex.newIds).toEqual([])
      expect(JSON.parse(readFileSync(join(dataDir, 'discovered-models.json'), 'utf8'))).toEqual(first)
      expect(listByProject(ctx, 'global').filter((event) => event.type === 'settings.updated')).toHaveLength(1)

      now = 200
      await refreshModelDiscovery(ctx, deps)
      expect(listByProject(ctx, 'global').filter((event) => event.type === 'settings.updated')).toHaveLength(1)

      now = 300
      claudeModels = [
        ...claudeModels,
        { id: 'claude-two', runtime: 'claude-code' as const, displayName: 'Claude Two' },
      ]
      const changed = await refreshModelDiscovery(ctx, deps)
      expect(changed.sources['claude-code'].newIds).toEqual(['claude-two'])

      now = 400
      codexFailure = new Error('Codex cache broke')
      const failed = await refreshModelDiscovery(ctx, deps)
      expect(failed.sources.codex).toMatchObject({
        status: 'failed',
        error: 'Codex cache broke',
        lastAttemptAt: 400,
        lastSuccessAt: 300,
        models: [{ id: 'gpt-one', runtime: 'codex' }],
        newIds: [],
      })
      expect(listByProject(ctx, 'global').filter((event) => event.type === 'settings.updated')).toHaveLength(3)

      now = 500
      const claudeFailed = await refreshModelDiscovery(ctx, {
        ...deps,
        discoverClaude: async () => {
          throw new Error('Claude is not logged in')
        },
      })
      expect(claudeFailed.sources['claude-code']).toMatchObject({
        status: 'failed',
        error: 'Claude is not logged in',
        models: changed.sources['claude-code'].models,
        newIds: ['claude-two'],
      })
    } finally {
      if (previousDataDir === undefined) delete process.env.RUNCASTLE_DATA_DIR
      else process.env.RUNCASTLE_DATA_DIR = previousDataDir
    }
  })

  it('shares one provider run between concurrent refresh calls', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'runcastle-discovery-concurrent-'))
    dirs.push(dataDir)
    const previousDataDir = process.env.RUNCASTLE_DATA_DIR
    process.env.RUNCASTLE_DATA_DIR = dataDir
    const ctx = await makeTestCtx()
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const discoverClaude = vi.fn(async () => {
      await gate
      return []
    })
    const discoverCodex = vi.fn(async () => {
      await gate
      return []
    })

    try {
      const first = refreshModelDiscovery(ctx, { discoverClaude, discoverCodex, now: () => 1 })
      const second = refreshModelDiscovery(ctx, { discoverClaude, discoverCodex, now: () => 1 })
      expect(second).toBe(first)
      release?.()
      await Promise.all([first, second])
      expect(discoverClaude).toHaveBeenCalledOnce()
      expect(discoverCodex).toHaveBeenCalledOnce()
    } finally {
      if (previousDataDir === undefined) delete process.env.RUNCASTLE_DATA_DIR
      else process.env.RUNCASTLE_DATA_DIR = previousDataDir
    }
  })

  it('can be started without awaiting provider completion', async () => {
    const ctx = await makeTestCtx()
    let release: (() => void) | undefined
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    let called = false

    const result = startModelDiscovery(ctx, async () => {
      called = true
      await pending
    })

    expect(result).toBeUndefined()
    expect(called).toBe(true)
    release?.()
  })
})
