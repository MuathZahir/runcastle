import { describe, expect, it } from 'vitest'
import { describeField, globalRows, projectRows } from '../src/lib/settings'
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
