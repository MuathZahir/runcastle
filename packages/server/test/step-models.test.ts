import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { InvalidInputError } from '../src/errors'
import { getSettings, updateSettings } from '../src/services/settings'
import { makeTestCtx } from './helpers/db'

/**
 * Per-step model settings surface (issue #48). Step overrides live under
 * `stepModels` in the global config file, exposed as `stepModels.<step>` fields;
 * `review` is never exposed. A legacy `smokeModel` file folds into
 * `stepModels.smoke`, and the next write persists the new shape.
 */

function field(view: { fields: { key: string }[] }, key: string) {
  const f = view.fields.find((x) => x.key === key)
  if (!f) throw new Error(`no field ${key} in view`)
  return f as { key: string; value: unknown; source: string; scope: string }
}

describe('per-step models (#48)', () => {
  let ctx: AppCtx
  let configFile: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    configFile = join(mkdtempSync(join(tmpdir(), 'runcastle-step-')), 'config.json')
  })

  const io = (env: Record<string, string | undefined> = {}) => ({ env, configFile })

  it('exposes a field per step and never a review step', () => {
    const view = getSettings(ctx, undefined, io())
    for (const step of ['ideation', 'qa', 'waypoint', 'converge', 'research', 'implement', 'smoke']) {
      expect(view.fields.find((f) => f.key === `stepModels.${step}`)).toBeDefined()
    }
    expect(view.fields.find((f) => f.key === 'stepModels.review')).toBeUndefined()
  })

  it('an unset step reports the default; smoke seeds a cheap model', () => {
    const view = getSettings(ctx, undefined, io())
    expect(field(view, 'stepModels.smoke').value).toBe('claude-haiku-4-5-20251001')
    expect(field(view, 'stepModels.smoke').source).toBe('default')
    expect(field(view, 'stepModels.implement').value).toBeNull()
    expect(field(view, 'stepModels.implement').source).toBe('default')
  })

  it('writes a sparse step override to the config file and refreshes ctx.config', () => {
    updateSettings(ctx, { key: 'stepModels.implement', value: 'claude-sonnet-5' }, io())
    expect(ctx.config.stepModels.implement).toBe('claude-sonnet-5')

    const view = getSettings(ctx, undefined, io())
    expect(field(view, 'stepModels.implement').value).toBe('claude-sonnet-5')
    expect(field(view, 'stepModels.implement').source).toBe('file')

    const raw = JSON.parse(readFileSync(configFile, 'utf8'))
    expect(raw.stepModels).toEqual({ implement: 'claude-sonnet-5' })
  })

  it('clears a step override with a null value', () => {
    updateSettings(ctx, { key: 'stepModels.implement', value: 'claude-sonnet-5' }, io())
    updateSettings(ctx, { key: 'stepModels.implement', value: null }, io())
    expect(ctx.config.stepModels.implement).toBeUndefined()
    expect(field(getSettings(ctx, undefined, io()), 'stepModels.implement').source).toBe('default')
  })

  it('rejects an unknown / reserved step', () => {
    expect(() => updateSettings(ctx, { key: 'stepModels.review', value: 'x' }, io())).toThrow(
      InvalidInputError,
    )
    expect(() => updateSettings(ctx, { key: 'stepModels.bogus', value: 'x' }, io())).toThrow(
      InvalidInputError,
    )
  })

  it('reads a legacy smokeModel file and persists the new shape on the next write', () => {
    writeFileSync(configFile, JSON.stringify({ model: 'claude-opus-4-8', smokeModel: 'claude-legacy' }))

    // legacy value is visible through the new field
    expect(field(getSettings(ctx, undefined, io()), 'stepModels.smoke').value).toBe('claude-legacy')

    // the next write drops smokeModel and persists stepModels
    updateSettings(ctx, { key: 'stepModels.research', value: 'claude-sonnet-5' }, io())
    const raw = JSON.parse(readFileSync(configFile, 'utf8'))
    expect(raw.smokeModel).toBeUndefined()
    expect(raw.stepModels).toEqual({ smoke: 'claude-legacy', research: 'claude-sonnet-5' })
  })

  it('emits a settings.updated event on a step write', () => {
    updateSettings(ctx, { key: 'stepModels.qa', value: 'claude-haiku-4-5-20251001' }, io())
    const raw = JSON.parse(readFileSync(configFile, 'utf8'))
    expect(raw.stepModels.qa).toBe('claude-haiku-4-5-20251001')
  })
})
