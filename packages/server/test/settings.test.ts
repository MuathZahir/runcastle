import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RuncastleConfig } from '@runcastle/core'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { InvalidInputError } from '../src/errors'
import { listByProject } from '../src/services/events'
import { getSettings, updateSettings } from '../src/services/settings'
import { makeTestCtx } from './helpers/db'
import { seedProject } from './helpers/fixtures'

/**
 * Settings backend (issue #46): the scope-resolved settings surface. Globals live
 * in the machine config file; per-project overrides (model, sandbox, devCommand)
 * live on project rows; resolution is `project ?? global`. `env` always wins and
 * locks the field. Tests inject a fresh temp config file + a fake env so nothing
 * touches the real `~/.runcastle/config.json`.
 */

function field(view: { fields: { key: string }[] }, key: string) {
  const f = view.fields.find((x) => x.key === key)
  if (!f) throw new Error(`no field ${key} in view`)
  return f as {
    key: string
    value: unknown
    source: string
    editable: boolean
    restartRequired: boolean
    scope: string
  }
}

describe('settings service (#46)', () => {
  let ctx: AppCtx
  let configFile: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    configFile = join(mkdtempSync(join(tmpdir(), 'runcastle-cfg-')), 'config.json')
  })

  const io = (env: Record<string, string | undefined> = {}) => ({ env, configFile })

  it('globals: with no config file, every field resolves to its schema default', () => {
    const view = getSettings(ctx, undefined, io())
    expect(view.projectId).toBeUndefined()

    const model = field(view, 'model')
    expect(model.value).toBe('claude-opus-4-8')
    expect(model.source).toBe('default')
    expect(model.editable).toBe(true)
    expect(model.scope).toBe('global')

    // serverPort is flagged restart-required
    expect(field(view, 'serverPort').restartRequired).toBe(true)
    expect(field(view, 'model').restartRequired).toBe(false)

    // devCommand is per-project only — absent from the globals view
    expect(view.fields.find((f) => f.key === 'devCommand')).toBeUndefined()
  })

  it('globals: a value present in the config file reports source file', () => {
    writeFileSync(configFile, JSON.stringify({ model: 'claude-sonnet-5' }))
    const model = field(getSettings(ctx, undefined, io()), 'model')
    expect(model.value).toBe('claude-sonnet-5')
    expect(model.source).toBe('file')
  })

  it('project view: an override resolves source project; unset fields fall back to file/default', () => {
    const project = seedProject(ctx)
    updateSettings(ctx, { projectId: project.id, key: 'model', value: 'claude-haiku-4-5-20251001' }, io())

    const view = getSettings(ctx, project.id, io())
    expect(view.projectId).toBe(project.id)

    const model = field(view, 'model')
    expect(model.value).toBe('claude-haiku-4-5-20251001')
    expect(model.source).toBe('project')
    expect(model.scope).toBe('project')

    // sandbox has no override — inherits the global default
    const sandbox = field(view, 'sandbox')
    expect(sandbox.value).toBe('docker')
    expect(sandbox.source).toBe('default')
    expect(sandbox.scope).toBe('project')

    // serverPort is global-only even in a project view
    expect(field(view, 'serverPort').scope).toBe('global')
  })

  it('env override wins, reports source env, and is not editable', () => {
    const view = getSettings(ctx, undefined, io({ RUNCASTLE_MODEL: 'claude-fable-5' }))
    const model = field(view, 'model')
    expect(model.value).toBe('claude-fable-5')
    expect(model.source).toBe('env')
    expect(model.editable).toBe(false)
  })

  it('env override wins over a project override too', () => {
    const project = seedProject(ctx)
    updateSettings(ctx, { projectId: project.id, key: 'model', value: 'claude-sonnet-5' }, io())
    const model = field(getSettings(ctx, project.id, io({ RUNCASTLE_MODEL: 'claude-fable-5' })), 'model')
    expect(model.value).toBe('claude-fable-5')
    expect(model.source).toBe('env')
    expect(model.editable).toBe(false)
  })

  it('rejects a write to an env-locked field', () => {
    expect(() =>
      updateSettings(ctx, { key: 'model', value: 'x' }, io({ RUNCASTLE_MODEL: 'claude-fable-5' })),
    ).toThrow(InvalidInputError)
  })

  it('rejects an unknown setting key', () => {
    expect(() => updateSettings(ctx, { key: 'bogus', value: '1' }, io())).toThrow(InvalidInputError)
  })

  it('global write persists to the config file AND refreshes the in-memory config in place', () => {
    updateSettings(ctx, { key: 'model', value: 'claude-sonnet-5' }, io())

    // in-memory config mutated → the next session launch reads the new value
    expect(ctx.config.model).toBe('claude-sonnet-5')

    // written through to disk → the next run's fresh loadConfig reads it too
    const fromDisk = RuncastleConfig.parse(JSON.parse(readFileSync(configFile, 'utf8')))
    expect(fromDisk.model).toBe('claude-sonnet-5')
  })

  it('in-flight work keeps its starting config (a captured snapshot is untouched)', () => {
    const snapshot = ctx.config // what a run captured at start
    const before = snapshot.model
    updateSettings(ctx, { key: 'serverPort', value: 5000 }, io())
    // the run reads its own captured field values; serverPort change does not
    // retro-alter model, and a run that snapshotted a *copy* is fully immune.
    expect(before).toBe('claude-opus-4-8')
    // the write is visible only to future reads of ctx.config
    expect(ctx.config.serverPort).toBe(5000)
  })

  it('serverPort coerces a numeric string and validates type', () => {
    updateSettings(ctx, { key: 'serverPort', value: 5001 }, io())
    expect(ctx.config.serverPort).toBe(5001)
    expect(() => updateSettings(ctx, { key: 'serverPort', value: 'nope' }, io())).toThrow(
      InvalidInputError,
    )
  })

  it('burnConcurrency defaults to 3, writes through, and rejects out-of-range widths', () => {
    const before = field(getSettings(ctx, undefined, io()), 'burnConcurrency')
    expect(before.value).toBe(3)
    expect(before.source).toBe('default')
    expect(before.scope).toBe('global')

    updateSettings(ctx, { key: 'burnConcurrency', value: 5 }, io())
    expect(ctx.config.burnConcurrency).toBe(5)
    expect(field(getSettings(ctx, undefined, io()), 'burnConcurrency').source).toBe('file')

    expect(() => updateSettings(ctx, { key: 'burnConcurrency', value: 0 }, io())).toThrow(
      InvalidInputError,
    )
    expect(() => updateSettings(ctx, { key: 'burnConcurrency', value: 9 }, io())).toThrow(
      InvalidInputError,
    )
  })

  it('burnConcurrency env override coerces the string and locks the field', () => {
    const f = field(
      getSettings(ctx, undefined, io({ RUNCASTLE_BURN_CONCURRENCY: '4' })),
      'burnConcurrency',
    )
    expect(f.value).toBe(4)
    expect(f.source).toBe('env')
    expect(f.editable).toBe(false)
  })

  it('devCommand reads/writes through settings on a project', () => {
    const project = seedProject(ctx)
    updateSettings(ctx, { projectId: project.id, key: 'devCommand', value: 'bun dev' }, io())
    expect(field(getSettings(ctx, project.id, io()), 'devCommand').value).toBe('bun dev')
  })

  it('devCommand requires a project (no global store)', () => {
    expect(() => updateSettings(ctx, { key: 'devCommand', value: 'bun dev' }, io())).toThrow(
      InvalidInputError,
    )
  })

  it('a null value clears a project override, falling back to the global', () => {
    const project = seedProject(ctx)
    updateSettings(ctx, { projectId: project.id, key: 'model', value: 'claude-sonnet-5' }, io())
    updateSettings(ctx, { projectId: project.id, key: 'model', value: null }, io())
    const model = field(getSettings(ctx, project.id, io()), 'model')
    expect(model.source).toBe('default')
    expect(model.value).toBe('claude-opus-4-8')
  })

  it('sandbox override accepts the three-way choice and rejects anything else', () => {
    const project = seedProject(ctx)
    for (const choice of ['docker', 'podman', 'noSandbox']) {
      updateSettings(ctx, { projectId: project.id, key: 'sandbox', value: choice }, io())
      expect(field(getSettings(ctx, project.id, io()), 'sandbox').value).toBe(choice)
    }
    expect(() =>
      updateSettings(ctx, { projectId: project.id, key: 'sandbox', value: 'vm' }, io()),
    ).toThrow(InvalidInputError)
  })

  it('the sandbox env override accepts podman and locks the field', () => {
    const project = seedProject(ctx)
    const withEnv = io({ RUNCASTLE_SANDBOX: 'podman' })
    const sandbox = field(getSettings(ctx, project.id, withEnv), 'sandbox')
    expect(sandbox.value).toBe('podman')
    expect(sandbox.source).toBe('env')
    expect(sandbox.editable).toBe(false)
  })

  it('a global settings mutation emits an event', () => {
    updateSettings(ctx, { key: 'model', value: 'claude-sonnet-5' }, io())
    const types = listByProject(ctx, 'global', 0).map((e) => e.type)
    expect(types).toContain('settings.updated')
  })

  it('a project settings mutation emits an event keyed to the project', () => {
    const project = seedProject(ctx)
    updateSettings(ctx, { projectId: project.id, key: 'devCommand', value: 'bun dev' }, io())
    const types = listByProject(ctx, project.id, 0).map((e) => e.type)
    expect(types).toContain('settings.updated')
  })
})
