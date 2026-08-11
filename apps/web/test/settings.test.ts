import { describe, expect, it } from 'vitest'
import {
  describeField,
  driveCapabilities,
  effectiveStepModel,
  globalRows,
  projectRows,
  stepModelRows,
  unsetStepKeys,
} from '../src/lib/settings'
import type { SettingField, SettingsView } from '../src/lib/api'

/**
 * Issue #47 — the settings overlay's pure presentation logic. `settings.get`
 * hands back the per-field value/source/editable contract; these helpers turn
 * that into the rows the overlay renders (labels, control kind, read-only /
 * restart / env-lock / override notes) with no DOM.
 */

const field = (over: Partial<SettingField>): SettingField =>
  ({
    key: 'model',
    value: 'claude',
    source: 'default',
    editable: true,
    restartRequired: false,
    scope: 'global',
    ...over,
  }) as SettingField

describe('describeField', () => {
  it('locks an env-driven field and names the variable that set it', () => {
    const row = describeField(field({ key: 'model', source: 'env', editable: false }))
    expect(row.readOnly).toBe(true)
    expect(row.note).toBe('Set by RUNCASTLE_MODEL')
  })

  it('flags serverPort as restart-required and renders it as a number control', () => {
    const row = describeField(
      field({ key: 'serverPort', value: 4512, restartRequired: true }),
    )
    expect(row.control).toBe('number')
    expect(row.restartRequired).toBe(true)
    expect(row.value).toBe('4512')
  })

  it('shows mainBranch read-only as a git-detected field', () => {
    const row = describeField(field({ key: 'mainBranch', value: 'main', source: 'file' }))
    expect(row.readOnly).toBe(true)
    expect(row.note?.toLowerCase()).toContain('git')
  })

  it('renders sandbox as a select with its options', () => {
    const row = describeField(field({ key: 'sandbox', value: 'docker' }))
    expect(row.control).toBe('select')
    expect(row.options).toEqual(['docker', 'noSandbox'])
  })

  /**
   * Findings F17.7 — the overlay read out config identifiers and one raw
   * camelCase key amid otherwise humanized labels.
   */
  it('reads out what a config identifier means rather than the identifier', () => {
    const sandbox = describeField(field({ key: 'sandbox', value: 'docker' }))
    expect(sandbox.optionLabels.noSandbox).toMatch(/no sandbox/i)
    expect(sandbox.optionLabels.docker).toMatch(/docker/i)

    const mcp = describeField(field({ key: 'sessionMcp', value: 'inherit' }))
    expect(mcp.optionLabels.inherit).not.toBe('inherit')
    expect(mcp.optionLabels.runcastleOnly).not.toBe('runcastleOnly')
  })

  it('labels every option a select offers', () => {
    for (const key of ['sandbox', 'sessionMcp']) {
      const row = describeField(field({ key, value: '' }))
      for (const opt of row.options) expect(row.optionLabels[opt]).toBeTruthy()
    }
  })

  it('gives burnMaxIterations a human label instead of printing the key', () => {
    const row = describeField(field({ key: 'burnMaxIterations', value: 3 }))
    expect(row.label).toBe('Burn iterations')
    expect(row.control).toBe('number')
    expect(row.help).not.toBe('')
    expect(
      describeField(field({ key: 'burnMaxIterations', source: 'env', editable: false })).note,
    ).toBe('Set by RUNCASTLE_BURN_MAX_ITERATIONS')
  })

  it('leaves model ids to speak for themselves', () => {
    expect(describeField(field({ key: 'model', value: 'claude-opus-5' })).optionLabels).toEqual({})
  })

  it('renders burnConcurrency as an editable number control with an env-lock note when locked', () => {
    const row = describeField(field({ key: 'burnConcurrency', value: 3 }))
    expect(row.label).toBe('Burn concurrency')
    expect(row.control).toBe('number')
    expect(row.value).toBe('3')
    expect(row.readOnly).toBe(false)

    const locked = describeField(
      field({ key: 'burnConcurrency', value: 4, source: 'env', editable: false }),
    )
    expect(locked.readOnly).toBe(true)
    expect(locked.note).toBe('Set by RUNCASTLE_BURN_CONCURRENCY')
  })

  it('marks a project-sourced field as overridden', () => {
    const row = describeField(field({ key: 'model', source: 'project', scope: 'project' }))
    expect(row.overridden).toBe(true)
    expect(row.note).toBe('Overridden for this project')
  })

  it('marks an inherited project-scope field as inherited from global', () => {
    const row = describeField(field({ key: 'model', source: 'file', scope: 'project' }))
    expect(row.overridden).toBe(false)
    expect(row.note).toBe('Inherited from global')
  })

  it('coerces a null value to an empty display string', () => {
    const row = describeField(field({ key: 'devCommand', value: null, scope: 'project' }))
    expect(row.value).toBe('')
  })

  it('renders the default model as a curated combobox (issue #48)', () => {
    const row = describeField(field({ key: 'model', value: 'claude-opus-4-8' }))
    expect(row.control).toBe('select')
    expect(row.allowCustom).toBe(true)
    expect(row.options).toContain('claude-opus-4-8')
  })

  it('labels a per-step model field and allows custom input', () => {
    const row = describeField(field({ key: 'stepModels.implement', value: 'claude-sonnet-5' }))
    expect(row.label).toBe('Implement')
    expect(row.control).toBe('select')
    expect(row.allowCustom).toBe(true)
  })
})

describe('per-step model rows (#48)', () => {
  it('lists only set steps, in canonical order, and hides them from global rows', () => {
    const v = view([
      { key: 'model', source: 'default' },
      { key: 'stepModels.smoke', value: 'claude-haiku-4-5-20251001', source: 'file' },
      { key: 'stepModels.implement', value: 'x', source: 'default', scope: 'global' },
      { key: 'stepModels.research', value: 'claude-sonnet-5', source: 'file' },
    ])
    const rows = stepModelRows(v)
    expect(rows.map((r) => r.key)).toEqual(['stepModels.research', 'stepModels.smoke'])
    // step fields never leak into the flat Global section
    expect(globalRows(v).map((r) => r.key)).toEqual(['model'])
  })

  it('offers the unset steps (never review) for adding', () => {
    const v = view([{ key: 'stepModels.smoke', value: 'h', source: 'file' }])
    const keys = unsetStepKeys(v).map((s) => s.key)
    expect(keys).toContain('stepModels.implement')
    expect(keys).not.toContain('stepModels.smoke')
    expect(keys).not.toContain('stepModels.review')
  })
})

describe('effectiveStepModel — mirrors core resolveModel', () => {
  it("prefers the project's own model over a global step model", () => {
    const v = view([
      { key: 'model', value: 'project-model', source: 'project', scope: 'project' },
      { key: 'stepModels.implement', value: 'step-model', source: 'file' },
    ])
    expect(effectiveStepModel(v, 'implement')).toBe('project-model')
  })

  it('uses the global step model when the project sets no model of its own', () => {
    const v = view([
      { key: 'model', value: 'global-default', source: 'file', scope: 'project' },
      { key: 'stepModels.implement', value: 'step-model', source: 'file' },
    ])
    expect(effectiveStepModel(v, 'implement')).toBe('step-model')
  })

  it('falls back to the default model when the step is unset', () => {
    const v = view([
      { key: 'model', value: 'global-default', source: 'file' },
      { key: 'stepModels.implement', value: null, source: 'default' },
    ])
    expect(effectiveStepModel(v, 'implement')).toBe('global-default')
  })

  it('reports nothing while the view is still loading', () => {
    expect(effectiveStepModel(undefined, 'implement')).toBeUndefined()
  })
})

const view = (fields: Partial<SettingField>[], projectId?: string): SettingsView => ({
  projectId,
  fields: fields.map(field),
})

describe('globalRows', () => {
  it('maps every field in the global view to a row', () => {
    const rows = globalRows(
      view([{ key: 'serverPort' }, { key: 'model' }, { key: 'mainBranch' }]),
    )
    expect(rows.map((r) => r.key)).toEqual(['serverPort', 'model', 'mainBranch'])
  })
})

describe('projectRows', () => {
  it('keeps only the fields a project can override', () => {
    const rows = projectRows(
      view(
        [
          { key: 'serverPort', scope: 'global' },
          { key: 'model', scope: 'project' },
          { key: 'sandbox', scope: 'project' },
          { key: 'devCommand', scope: 'project' },
        ],
        'proj_1',
      ),
    )
    expect(rows.map((r) => r.key)).toEqual(['model', 'sandbox', 'devCommand'])
  })
})

/**
 * What a test drive will actually do here, read off the same values the server
 * branches on. `runDriveHookStep` skips an empty command and the dev pane is
 * spawned only `if (project.devCommand)` — so "configured" has to mean a
 * non-blank string, or the review page promises a database nobody creates.
 */
describe('driveCapabilities', () => {
  it('reports nothing configured on a project with no drive fields set', () => {
    expect(driveCapabilities(view([{ key: 'model', value: 'claude' }]))).toEqual({
      env: false,
      setup: false,
      dev: false,
      teardown: false,
    })
  })

  it('reports each drive field that carries a command', () => {
    expect(
      driveCapabilities(
        view([
          { key: 'driveEnv', value: 'DATABASE_URL=postgres:///myapp_{{id}}' },
          { key: 'driveSetupCommand', value: 'createdb myapp_{{id}}' },
          { key: 'devCommand', value: 'bun dev' },
          { key: 'driveStopCommand', value: 'dropdb myapp_{{id}}' },
        ]),
      ),
    ).toEqual({ env: true, setup: true, dev: true, teardown: true })
  })

  // A field cleared back to blank (or to whitespace) is a field the drive skips.
  it('treats a blank or whitespace-only value as not configured', () => {
    expect(
      driveCapabilities(
        view([
          { key: 'devCommand', value: '' },
          { key: 'driveSetupCommand', value: '   ' },
          { key: 'driveEnv', value: null },
        ]),
      ),
    ).toEqual({ env: false, setup: false, dev: false, teardown: false })
  })

  // Before settings land there is no answer, and guessing "false" would print
  // "this project has no drive commands" at every mount of the review page.
  it('has no answer until the settings view has loaded', () => {
    expect(driveCapabilities(undefined)).toBeUndefined()
  })
})
