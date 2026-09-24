import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk'
import {
  discoverClaudeModels,
  discoverCodexModels,
} from '../src/services/model-discovery'

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
