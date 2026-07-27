import { describe, expect, it } from 'vitest'
import { PREPARED_KEYS, resolvePreparedSettings } from '@runcastle/core'
import type { Project } from '@runcastle/core'
import { migrationPaths } from '../src/services/git'
import {
  buildRequestedKeysBlock,
  parsePrepFindings,
  prepRun,
  renderPrepPrompt,
  type PrepCtx,
  type PrepDeps,
  type PrepOutcome,
} from '../src/workflows/project-prep'

/**
 * Pure units of project preparation. The sandcastle boundary is injected
 * (`PrepDeps.executePrepRun`), so the control flow — auth precheck, the
 * nothing-to-do short circuit, the summary — is exercised with no container.
 */

const project: Project = {
  id: 'proj_1',
  name: 'acme',
  repoPath: '/repo',
  mainBranch: 'main',
}

function makeCtx(keys: PrepCtx['keys'], events: { type: string; message: string }[] = []): PrepCtx {
  return {
    project,
    keys,
    emitEvent: (e) => events.push({ type: e.type, message: e.message }),
    signal: new AbortController().signal,
  }
}

function deps(over: Partial<PrepDeps> = {}): PrepDeps {
  return {
    config: { sandbox: 'noSandbox' } as PrepDeps['config'],
    hasAuthToken: true,
    executePrepRun: async () => ({ status: 'done', findings: { values: {} }, warnings: [] }),
    ...over,
  }
}

describe('parsePrepFindings', () => {
  it('reads {value, evidence} pairs', () => {
    const { findings, warnings } = parsePrepFindings(
      JSON.stringify({
        verifyCommands: { value: 'pnpm test', evidence: 'ran it; exit 0' },
        notes: 'e2e needs postgres',
      }),
    )
    expect(findings.values.verifyCommands).toEqual({
      value: 'pnpm test',
      evidence: 'ran it; exit 0',
    })
    expect(findings.notes).toBe('e2e needs postgres')
    expect(warnings).toEqual([])
  })

  it('accepts a bare string as the value', () => {
    const { findings } = parsePrepFindings(JSON.stringify({ devCommand: 'bun dev' }))
    expect(findings.values.devCommand).toEqual({ value: 'bun dev' })
  })

  // "Could not establish this" is a correct, expected outcome. It must never
  // reach the settings as an empty string that reads like a real answer.
  it('drops empty, whitespace and null values instead of storing them', () => {
    const { findings } = parsePrepFindings(
      JSON.stringify({
        setupCommand: { value: '' },
        verifyCommands: { value: '   ' },
        knownFailures: { value: null },
        dbResetCommand: { value: 'bun run db:reset' },
      }),
    )
    expect(Object.keys(findings.values)).toEqual(['dbResetCommand'])
  })

  it('warns about unknown keys but keeps the rest of the document', () => {
    const { findings, warnings } = parsePrepFindings(
      JSON.stringify({ lintCommand: 'eslint .', devCommand: 'bun dev' }),
    )
    expect(findings.values.devCommand).toEqual({ value: 'bun dev' })
    expect(warnings).toEqual(['ignored unknown key "lintCommand"'])
  })

  it('warns instead of throwing when one key has the wrong shape', () => {
    const { findings, warnings } = parsePrepFindings(
      JSON.stringify({ verifyCommands: ['a', 'b'], devCommand: 'bun dev' }),
    )
    expect(findings.values.devCommand).toBeDefined()
    expect(warnings[0]).toContain('verifyCommands')
  })

  it('throws only when the document is unparseable', () => {
    expect(() => parsePrepFindings('not json')).toThrow(/not valid JSON/)
    expect(() => parsePrepFindings('[1,2,3]')).toThrow(/not a JSON object/)
  })
})

describe('buildRequestedKeysBlock', () => {
  it('lists only the requested keys, in canonical order', () => {
    const block = buildRequestedKeysBlock(['knownFailures', 'setupCommand'])
    expect(block.indexOf('setupCommand')).toBeLessThan(block.indexOf('knownFailures'))
    expect(block).not.toContain('devCommand')
  })

  it('tells the agent to stop when nothing is requested', () => {
    expect(buildRequestedKeysBlock([])).toContain('already established')
  })

  it('covers every prepared key', () => {
    const block = buildRequestedKeysBlock(PREPARED_KEYS)
    for (const key of PREPARED_KEYS) expect(block).toContain(key)
  })
})

describe('renderPrepPrompt', () => {
  it('substitutes every placeholder, including values containing $', () => {
    const out = renderPrepPrompt('keys: {{REQUESTED_KEYS}} / setup: {{SETUP_COMMAND}}', {
      REQUESTED_KEYS: '- a',
      SETUP_COMMAND: 'echo "$HOME"',
    })
    expect(out).toBe('keys: - a / setup: echo "$HOME"')
    expect(out).not.toContain('{{')
  })
})

describe('prepRun', () => {
  it('short-circuits when there is nothing to establish', async () => {
    const events: { type: string; message: string }[] = []
    const result = await prepRun(makeCtx([], events), deps())
    expect(result.status).toBe('succeeded')
    expect(events.map((e) => e.type)).toEqual(['prep.skipped'])
  })

  it('refuses to start a container run with no auth token', async () => {
    const events: { type: string; message: string }[] = []
    const result = await prepRun(
      makeCtx(['verifyCommands'], events),
      deps({ config: { sandbox: 'docker' } as PrepDeps['config'], hasAuthToken: false }),
    )
    expect(result.status).toBe('failed')
    expect(events.map((e) => e.type)).toContain('auth.missing')
  })

  it('runs on the host with no token (noSandbox needs none)', async () => {
    const result = await prepRun(makeCtx(['devCommand']), deps({ hasAuthToken: false }))
    expect(result.status).toBe('succeeded')
  })

  it('reports which requested keys the agent could not establish', async () => {
    const outcome: PrepOutcome = {
      status: 'done',
      findings: { values: { verifyCommands: { value: 'bun test' } } },
      warnings: [],
    }
    const result = await prepRun(
      makeCtx(['verifyCommands', 'knownFailures']),
      deps({ executePrepRun: async () => outcome }),
    )
    expect(result.summary).toContain('established verifyCommands')
    expect(result.summary).toContain('could not establish knownFailures')
    expect(result.findings?.values.verifyCommands?.value).toBe('bun test')
  })

  it('surfaces parse warnings as events without failing the run', async () => {
    const events: { type: string; message: string }[] = []
    const result = await prepRun(
      makeCtx(['devCommand'], events),
      deps({
        executePrepRun: async () => ({
          status: 'done',
          findings: { values: {} },
          warnings: ['ignored unknown key "x"'],
        }),
      }),
    )
    expect(result.status).toBe('succeeded')
    expect(events.some((e) => e.type === 'prep.warning')).toBe(true)
  })

  it('fails with the agent error when the sandbox run fails', async () => {
    const result = await prepRun(
      makeCtx(['verifyCommands']),
      deps({ executePrepRun: async () => ({ status: 'failed', error: 'fatal: boom' }) }),
    )
    expect(result.status).toBe('failed')
    expect(result.summary).toBe('fatal: boom')
  })

  it('propagates an abort so the caller can mark the run cancelled', async () => {
    await expect(
      prepRun(
        makeCtx(['verifyCommands']),
        deps({
          executePrepRun: async () => {
            throw new Error('aborted')
          },
        }),
      ),
    ).rejects.toThrow('aborted')
  })
})

describe('resolvePreparedSettings', () => {
  const config = {
    setupCommand: 'global install',
    verifyCommands: 'global test',
    knownFailures: 'global baseline',
  }

  it("prefers the project's own value over the machine-wide one", () => {
    const resolved = resolvePreparedSettings(config, { verifyCommands: 'pnpm --filter web test' })
    expect(resolved.verifyCommands).toBe('pnpm --filter web test')
    expect(resolved.setupCommand).toBe('global install')
  })

  it('treats a blank project value as unset so the global is inherited', () => {
    const resolved = resolvePreparedSettings(config, { verifyCommands: '   ' })
    expect(resolved.verifyCommands).toBe('global test')
  })

  it('returns undefined when neither layer has a value', () => {
    expect(resolvePreparedSettings({}, null).verifyCommands).toBeUndefined()
  })
})

describe('migrationPaths', () => {
  it('matches the migration layouts of the common ORMs', () => {
    expect(
      migrationPaths([
        'prisma/migrations/20260101_init/migration.sql',
        'supabase/migrations/0001_x.sql',
        'db/migrate/20260101_add_users.rb',
        'apps/api/migrations/003_add_index.py',
        'packages/server/drizzle/0010_misty.sql',
      ]),
    ).toHaveLength(5)
  })

  it('ignores files that merely mention migration', () => {
    expect(
      migrationPaths(['src/lib/migration-utils.ts', 'docs/migrating.md', 'README.md']),
    ).toEqual([])
  })
})
