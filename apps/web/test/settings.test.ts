import { describe, expect, it } from 'vitest'
import {
  describeField,
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
