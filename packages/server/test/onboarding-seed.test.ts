import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RUNTIME_DEFAULT_MODELS } from '@runcastle/core'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { listByProject } from '../src/services/events'
import { seedModelDefaults } from '../src/services/setup'
import { makeTestCtx } from './helpers/db'

/**
 * Onboarding seeding (decision 7). The wizard finishes by writing the global
 * default and smoke models from the curated pair of a runtime the operator
 * actually authed — as ordinary settings, so they are inspectable and editable
 * afterwards and each write announces itself like any other.
 */
describe('seedModelDefaults', () => {
  let ctx: AppCtx
  let configFile: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    configFile = join(mkdtempSync(join(tmpdir(), 'runcastle-seed-')), 'config.json')
  })

  const io = (env: Record<string, string | undefined> = {}) => ({ env, configFile })

  it("writes the codex pair for a codex-only operator, and refreshes the live config", () => {
    const seeded = seedModelDefaults(ctx, ['codex'], io())
    expect(seeded).toEqual({
      runtime: 'codex',
      model: RUNTIME_DEFAULT_MODELS.codex.flagship,
      smoke: RUNTIME_DEFAULT_MODELS.codex.smoke,
    })
    expect(ctx.config.model).toBe(RUNTIME_DEFAULT_MODELS.codex.flagship)
    expect(ctx.config.stepModels.smoke).toBe(RUNTIME_DEFAULT_MODELS.codex.smoke)

    const raw = JSON.parse(readFileSync(configFile, 'utf8'))
    expect(raw.model).toBe(RUNTIME_DEFAULT_MODELS.codex.flagship)
    expect(raw.stepModels.smoke).toBe(RUNTIME_DEFAULT_MODELS.codex.smoke)
  })

  it('keeps the claude pair when both runtimes are authed', () => {
    const seeded = seedModelDefaults(ctx, ['claude-code', 'codex'], io())
    expect(seeded?.runtime).toBe('claude-code')
    expect(ctx.config.model).toBe(RUNTIME_DEFAULT_MODELS['claude-code'].flagship)
    expect(ctx.config.stepModels.smoke).toBe(RUNTIME_DEFAULT_MODELS['claude-code'].smoke)
  })

  // Ordinary settings writes — the UI learns about them the same way it learns
  // about a value typed in the settings overlay.
  it('emits a settings event per value it seeds', () => {
    seedModelDefaults(ctx, ['codex'], io())
    const messages = listByProject(ctx, 'global', 0)
      .filter((e) => e.type === 'settings.updated')
      .map((e) => e.message)
    expect(messages.some((m) => m.includes(RUNTIME_DEFAULT_MODELS.codex.flagship))).toBe(true)
    expect(messages.some((m) => m.includes(RUNTIME_DEFAULT_MODELS.codex.smoke))).toBe(true)
  })

  // A pinned env value is already a decision; onboarding does not overrule it.
  it('leaves an env-pinned model alone and reports what it actually wrote', () => {
    const seeded = seedModelDefaults(ctx, ['codex'], io({ RUNCASTLE_MODEL: 'claude-opus-5' }))
    expect(seeded?.model).toBeUndefined()
    expect(seeded?.smoke).toBe(RUNTIME_DEFAULT_MODELS.codex.smoke)
    const raw = JSON.parse(readFileSync(configFile, 'utf8'))
    expect(raw.model).toBeUndefined()
  })

  it('writes nothing when no runtime is ready', () => {
    expect(seedModelDefaults(ctx, [], io())).toBeNull()
    expect(listByProject(ctx, 'global', 0).filter((e) => e.type === 'settings.updated')).toHaveLength(
      0,
    )
  })
})
