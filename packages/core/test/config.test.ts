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
    expect(cfg.model).toBe('claude-opus-4-8')
    expect(cfg.stepModels.smoke).toBe('claude-haiku-4-5-20251001')
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
      'research',
      'implement',
      'smoke',
    ])
    expect(ModelStep.safeParse('review').success).toBe(false)
  })

  it('ships a curated model list', () => {
    expect(CURATED_MODELS.length).toBeGreaterThan(0)
    expect(CURATED_MODELS.map((m) => m.id)).toContain('claude-opus-4-8')
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
