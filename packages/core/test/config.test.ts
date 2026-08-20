import { describe, expect, it } from 'vitest'
import {
  CURATED_MODELS,
  MODEL_STEPS,
  ModelStep,
  RUNTIME_DEFAULT_MODELS,
  RuncastleConfig,
  configuredRuntimes,
  mergeModelEntries,
  modelEntryFor,
  modelRoster,
  resolveModel,
  resolveModelEntry,
} from '../src/config'

describe('RuncastleConfig — model shape', () => {
  it('defaults to opus with a cheap smoke step override', () => {
    const cfg = RuncastleConfig.parse({})
    expect(cfg.model).toBe('claude-opus-5')
    expect(cfg.stepModels.smoke).toBe('claude-haiku-4-5')
  })

  it('folds a legacy smokeModel into stepModels.smoke (read-compat)', () => {
    const cfg = RuncastleConfig.parse({ smokeModel: 'claude-legacy-smoke' })
    expect(cfg.stepModels.smoke).toBe('claude-legacy-smoke')
    // legacy key does not survive onto the parsed shape
    expect((cfg as Record<string, unknown>).smokeModel).toBeUndefined()
  })

  it('an explicit stepModels.smoke wins over a legacy smokeModel', () => {
    const cfg = RuncastleConfig.parse({
      smokeModel: 'legacy',
      stepModels: { smoke: 'explicit' },
    })
    expect(cfg.stepModels.smoke).toBe('explicit')
  })

  it('keeps stepModels sparse and rejects unknown steps', () => {
    const cfg = RuncastleConfig.parse({ stepModels: { implement: 'claude-x' } })
    expect(cfg.stepModels).toEqual({ implement: 'claude-x' })
    expect(RuncastleConfig.safeParse({ stepModels: { review: 'x' } }).success).toBe(false)
  })

  it('exposes the model steps without review (reserved)', () => {
    expect(MODEL_STEPS).toEqual([
      'ideation',
      'qa',
      'waypoint',
      'converge',
      'revisit',
      'research',
      'implement',
      'prepare',
      'project',
      'smoke',
    ])
    expect(ModelStep.safeParse('review').success).toBe(false)
  })

  it('ships a curated model list', () => {
    expect(CURATED_MODELS.length).toBeGreaterThan(0)
    expect(CURATED_MODELS.map((m) => m.id)).toContain('claude-opus-5')
  })

  it('offers a 1M-context variant for every model that has one', () => {
    const ids = CURATED_MODELS.map((m) => m.id)
    for (const id of ['claude-opus-5', 'claude-sonnet-5', 'claude-fable-5']) {
      expect(ids).toContain(`${id}[1m]`)
    }
    // Haiku 4.5 has no 1M tier — a `[1m]` entry would fail the launch.
    expect(ids).not.toContain('claude-haiku-4-5[1m]')
  })
})

describe('model vocabulary — runtime-aware entries', () => {
  it('curates entries from both runtimes, each declaring its own', () => {
    const byId = new Map(CURATED_MODELS.map((m) => [m.id, m.runtime]))
    expect(byId.get('claude-opus-5')).toBe('claude-code')
    expect(byId.get('claude-opus-5[1m]')).toBe('claude-code')
    expect(byId.get('gpt-5.6-sol')).toBe('codex')
    expect(byId.get('gpt-5.6-terra')).toBe('codex')
    expect(byId.get('gpt-5.6-luna')).toBe('codex')
  })

  it('exports a flagship/smoke default pair per runtime', () => {
    expect(RUNTIME_DEFAULT_MODELS['claude-code']).toEqual({
      flagship: 'claude-opus-5',
      smoke: 'claude-haiku-4-5',
    })
    expect(RUNTIME_DEFAULT_MODELS.codex).toEqual({
      flagship: 'gpt-5.6-sol',
      smoke: 'gpt-5.6-luna',
    })
  })

  it('every default-pair model is a curated entry of its own runtime', () => {
    for (const [runtime, pair] of Object.entries(RUNTIME_DEFAULT_MODELS)) {
      for (const id of [pair.flagship, pair.smoke]) {
        expect(CURATED_MODELS.find((m) => m.id === id)?.runtime).toBe(runtime)
      }
    }
  })

  it('merges a custom roster over the curated one, matched by id', () => {
    const roster = modelRoster({
      models: [
        { id: 'gpt-5.6-sol', runtime: 'codex', note: 'mechanical refactors' },
        { id: 'my-proxy/gpt', runtime: 'codex' },
      ],
    })
    // the custom entry replaces the curated one in place, not appended twice
    expect(roster.filter((m) => m.id === 'gpt-5.6-sol')).toEqual([
      { id: 'gpt-5.6-sol', runtime: 'codex', note: 'mechanical refactors' },
    ])
    expect(roster.at(-1)).toEqual({ id: 'my-proxy/gpt', runtime: 'codex' })
    expect(roster.map((m) => m.id)).toContain('claude-opus-5')
  })

  it('mergeModelEntries upserts by id, preserving order', () => {
    const merged = mergeModelEntries(
      [
        { id: 'a', runtime: 'claude-code' },
        { id: 'b', runtime: 'codex' },
      ],
      [
        { id: 'b', runtime: 'codex', note: 'refactors' },
        { id: 'c', runtime: 'claude-code' },
      ],
    )
    expect(merged).toEqual([
      { id: 'a', runtime: 'claude-code' },
      { id: 'b', runtime: 'codex', note: 'refactors' },
      { id: 'c', runtime: 'claude-code' },
    ])
  })

  it('resolves an unknown/bare id to the historical claude-code runtime', () => {
    expect(modelEntryFor('some-unlisted-model', { models: [] })).toEqual({
      id: 'some-unlisted-model',
      runtime: 'claude-code',
    })
  })

  it('resolves a custom roster entry to its declared runtime', () => {
    const config = { models: [{ id: 'my-proxy/gpt', runtime: 'codex' as const, note: 'cheap' }] }
    expect(modelEntryFor('my-proxy/gpt', config)).toEqual({
      id: 'my-proxy/gpt',
      runtime: 'codex',
      note: 'cheap',
    })
  })

  it('round-trips a custom Codex entry with a note through the config schema', () => {
    const cfg = RuncastleConfig.parse({
      models: [{ id: 'gpt-5.6-terra', runtime: 'codex', note: 'gpt-5.6-terra — mechanical work' }],
    })
    expect(cfg.models).toEqual([
      { id: 'gpt-5.6-terra', runtime: 'codex', note: 'gpt-5.6-terra — mechanical work' },
    ])
    // and back out again through a save/load-shaped JSON hop
    expect(RuncastleConfig.parse(JSON.parse(JSON.stringify(cfg))).models).toEqual(cfg.models)
  })

  it('defaults the roster to empty and rejects an undeclared runtime', () => {
    expect(RuncastleConfig.parse({}).models).toEqual([])
    expect(RuncastleConfig.safeParse({ models: [{ id: 'x' }] }).success).toBe(false)
    expect(RuncastleConfig.safeParse({ models: [{ id: 'x', runtime: 'gemini' }] }).success).toBe(
      false,
    )
    expect(RuncastleConfig.safeParse({ models: [{ id: '', runtime: 'codex' }] }).success).toBe(false)
  })
})

describe('RuncastleConfig — burnConcurrency (M2)', () => {
  it('defaults to 3', () => {
    expect(RuncastleConfig.parse({}).burnConcurrency).toBe(3)
  })

  it('accepts the 1..8 range', () => {
    expect(RuncastleConfig.parse({ burnConcurrency: 1 }).burnConcurrency).toBe(1)
    expect(RuncastleConfig.parse({ burnConcurrency: 8 }).burnConcurrency).toBe(8)
  })

  it('rejects out-of-range and non-integer widths', () => {
    expect(RuncastleConfig.safeParse({ burnConcurrency: 0 }).success).toBe(false)
    expect(RuncastleConfig.safeParse({ burnConcurrency: 9 }).success).toBe(false)
    expect(RuncastleConfig.safeParse({ burnConcurrency: 2.5 }).success).toBe(false)
  })
})

describe('RuncastleConfig — burn iteration + setup knobs', () => {
  it('burnMaxIterations defaults to 3 and accepts 1..10', () => {
    expect(RuncastleConfig.parse({}).burnMaxIterations).toBe(3)
    expect(RuncastleConfig.parse({ burnMaxIterations: 1 }).burnMaxIterations).toBe(1)
    expect(RuncastleConfig.parse({ burnMaxIterations: 10 }).burnMaxIterations).toBe(10)
  })

  it('rejects out-of-range and non-integer iteration counts', () => {
    expect(RuncastleConfig.safeParse({ burnMaxIterations: 0 }).success).toBe(false)
    expect(RuncastleConfig.safeParse({ burnMaxIterations: 11 }).success).toBe(false)
    expect(RuncastleConfig.safeParse({ burnMaxIterations: 1.5 }).success).toBe(false)
  })

  it('setupCommand is optional free text, absent by default', () => {
    expect(RuncastleConfig.parse({}).setupCommand).toBeUndefined()
    expect(RuncastleConfig.parse({ setupCommand: 'make deps' }).setupCommand).toBe('make deps')
  })

  it('burnWorkspace defaults to auto and accepts only the three modes (ADR-0005)', () => {
    expect(RuncastleConfig.parse({}).burnWorkspace).toBe('auto')
    expect(RuncastleConfig.parse({ burnWorkspace: 'mounted' }).burnWorkspace).toBe('mounted')
    expect(RuncastleConfig.parse({ burnWorkspace: 'isolated' }).burnWorkspace).toBe('isolated')
    expect(RuncastleConfig.safeParse({ burnWorkspace: 'wsl' }).success).toBe(false)
  })
})

describe('resolveModel — chain runOverride ?? project.model ?? stepModels[step] ?? global.model', () => {
  const config = {
    model: 'global-default',
    stepModels: { implement: 'step-implement', smoke: 'step-smoke' },
  }

  it('falls back to the global default when nothing else is set', () => {
    expect(resolveModel('ideation', config)).toBe('global-default')
  })

  it('uses a project override above the global default', () => {
    expect(resolveModel('ideation', config, { model: 'project-model' })).toBe('project-model')
  })

  it('a project override wins over a global step override', () => {
    expect(resolveModel('implement', config, { model: 'project-model' })).toBe('project-model')
  })

  it('a global step override applies to a project that sets no model of its own', () => {
    expect(resolveModel('implement', config, { model: null })).toBe('step-implement')
    expect(resolveModel('implement', config)).toBe('step-implement')
  })

  it('a run override wins over everything', () => {
    expect(resolveModel('implement', config, { model: 'project-model' }, 'run-model')).toBe(
      'run-model',
    )
  })

  it('ignores a null/undefined project model and run override', () => {
    expect(resolveModel('qa', config, { model: null }, null)).toBe('global-default')
    expect(resolveModel('qa', config, null, undefined)).toBe('global-default')
  })
})

describe('resolveModelEntry — the same chain, resolved to { id, runtime }', () => {
  const config = {
    model: 'claude-opus-5',
    stepModels: { implement: 'gpt-5.6-sol', smoke: 'my-proxy/gpt' },
    models: [{ id: 'my-proxy/gpt', runtime: 'codex' as const, note: 'cheap smoke' }],
  }

  it('yields an entry for every step', () => {
    for (const step of MODEL_STEPS) {
      const entry = resolveModelEntry(step, config)
      expect(typeof entry.id).toBe('string')
      expect(['claude-code', 'codex']).toContain(entry.runtime)
    }
  })

  it('carries the runtime of whichever link of the chain wins', () => {
    expect(resolveModelEntry('ideation', config)).toMatchObject({
      id: 'claude-opus-5',
      runtime: 'claude-code',
    })
    expect(resolveModelEntry('implement', config)).toMatchObject({
      id: 'gpt-5.6-sol',
      runtime: 'codex',
    })
    expect(resolveModelEntry('smoke', config)).toMatchObject({
      id: 'my-proxy/gpt',
      runtime: 'codex',
    })
    expect(resolveModelEntry('implement', config, { model: 'claude-sonnet-5' })).toMatchObject({
      id: 'claude-sonnet-5',
      runtime: 'claude-code',
    })
    expect(
      resolveModelEntry('implement', config, { model: 'claude-sonnet-5' }, 'gpt-5.6-luna'),
    ).toMatchObject({ id: 'gpt-5.6-luna', runtime: 'codex' })
  })

  it('agrees with resolveModel on the id at every link', () => {
    for (const step of MODEL_STEPS) {
      expect(resolveModelEntry(step, config).id).toBe(resolveModel(step, config))
      expect(resolveModelEntry(step, config, { model: 'p' }).id).toBe(
        resolveModel(step, config, { model: 'p' }),
      )
    }
  })

  it('falls back to claude-code for an id no roster knows', () => {
    expect(resolveModelEntry('ideation', { ...config, model: 'mystery-model' })).toEqual({
      id: 'mystery-model',
      runtime: 'claude-code',
    })
  })
})

/**
 * The derivation the doctor's conditional severity rests on: a runtime is only
 * something the operator can be in trouble over once one of their configured
 * models actually runs on it.
 */
describe('configuredRuntimes', () => {
  it('is claude-code alone on a stock config', () => {
    expect(configuredRuntimes(RuncastleConfig.parse({}))).toEqual(['claude-code'])
  })

  it('picks up a runtime a per-step override brought in', () => {
    const config = RuncastleConfig.parse({ stepModels: { implement: 'gpt-5.6-sol' } })
    expect(configuredRuntimes(config)).toEqual(['claude-code', 'codex'])
  })

  it('is codex alone for a codex-only operator', () => {
    const config = RuncastleConfig.parse({
      model: 'gpt-5.6-sol',
      stepModels: { smoke: 'gpt-5.6-luna' },
    })
    expect(configuredRuntimes(config)).toEqual(['codex'])
  })

  it('honours the operator roster for a custom id, and extra ids the caller holds', () => {
    const config = RuncastleConfig.parse({ models: [{ id: 'my-proxy/gpt', runtime: 'codex' }] })
    expect(configuredRuntimes(config, ['my-proxy/gpt'])).toEqual(['claude-code', 'codex'])
    // A project override / ticket assignment nothing knows is claude-code, the
    // historical default — never inferred from the id string.
    expect(configuredRuntimes(config, ['mystery-model'])).toEqual(['claude-code'])
  })

  it('ignores blank extra ids — an unset override selects no runtime', () => {
    const config = RuncastleConfig.parse({ model: 'gpt-5.6-sol', stepModels: {} })
    expect(configuredRuntimes(config, [null, undefined, ''])).toEqual(['codex'])
  })
})
