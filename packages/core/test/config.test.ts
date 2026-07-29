import { describe, expect, it } from 'vitest'
import {
  CURATED_MODELS,
  MODEL_STEPS,
  ModelStep,
  RuncastleConfig,
  resolveModel,
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

describe('resolveModel — chain runOverride ?? stepModels[step] ?? project.model ?? global.model', () => {
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

  it('a step override wins over a project override', () => {
    expect(resolveModel('implement', config, { model: 'project-model' })).toBe('step-implement')
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
