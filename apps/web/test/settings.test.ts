import { describe, expect, it } from 'vitest'
import {
  customModelCommit,
  customModelsFromView,
  describeField,
  driveCapabilities,
  effectiveStepModel,
  fieldCommit,
  globalRows,
  modelOptionGroups,
  projectRows,
  rosterFromView,
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

  // The burn width defaults off the host's core count, so an operator looking at
  // an unset field has to be told which way this machine went — and the help has
  // to say the rule, since a set field no longer shows the note.
  it('says what burn concurrency defaults to on this machine while it is unset', () => {
    expect(describeField(field({ key: 'burnConcurrency', value: 1 })).note).toBe(
      'Default on this machine: 1.',
    )
    expect(describeField(field({ key: 'burnConcurrency', value: 3 })).note).toBe(
      'Default on this machine: 3.',
    )
    expect(describeField(field({ key: 'burnConcurrency', value: 1 })).help).toContain(
      '8 logical CPUs or fewer',
    )
  })

  it('drops the machine-default note once a width is actually set', () => {
    const row = describeField(field({ key: 'burnConcurrency', value: 5, source: 'file' }))
    expect(row.note).toBeNull()
  })

  it('leaves every other unset global field without a note', () => {
    expect(describeField(field({ key: 'burnCpus', value: null })).note).toBeNull()
    expect(describeField(field({ key: 'model', value: 'claude-opus-5' })).note).toBeNull()
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

  it('describes the default model without naming one runtime', () => {
    const row = describeField(field({ key: 'model', value: 'claude-opus-5' }))
    expect(row.help).not.toContain('Claude')
  })
})

/**
 * The model dropdowns are grouped by runtime (decision 3): the runtime a session
 * or burn launches with is a property of the model chosen, so the choice has to
 * read that way. A custom id the operator added carries the runtime they
 * declared for it — nothing is ever inferred from the id string.
 */
describe('model dropdown — runtime groups', () => {
  const rosterView = (models: unknown) =>
    view([{ key: 'model', value: 'claude-opus-5' }, { key: 'models', value: models }])

  it('groups the curated roster by runtime, each group labelled', () => {
    const groups = modelOptionGroups(rosterFromView(view([])))
    expect(groups.map((g) => g.runtime)).toEqual(['claude-code', 'codex'])
    expect(groups.map((g) => g.label)).toEqual(['Claude Code', 'Codex'])
    expect(groups[0]?.entries.map((m) => m.id)).toContain('claude-opus-5')
    expect(groups[1]?.entries.map((m) => m.id)).toContain('gpt-5.6-sol')
    // no id lands in the wrong group
    expect(groups[1]?.entries.every((m) => m.runtime === 'codex')).toBe(true)
  })

  it('offers a custom entry in the group of the runtime it declared', () => {
    const roster = rosterFromView(
      rosterView([{ id: 'my-proxy/gpt', runtime: 'codex', note: 'mechanical refactors' }]),
    )
    const codex = modelOptionGroups(roster).find((g) => g.runtime === 'codex')
    expect(codex?.entries.map((m) => m.id)).toContain('my-proxy/gpt')
    expect(codex?.entries.find((m) => m.id === 'my-proxy/gpt')?.note).toBe('mechanical refactors')
  })

  it('drops a malformed roster entry rather than breaking the dropdown', () => {
    const roster = rosterFromView(rosterView([{ id: 'no-runtime' }, 'nonsense', null]))
    expect(roster.map((m) => m.id)).not.toContain('no-runtime')
    expect(roster.map((m) => m.id)).toContain('claude-opus-5')
    expect(rosterFromView(rosterView('not-an-array')).map((m) => m.id)).toContain('gpt-5.6-sol')
  })

  it('reads back only the operator’s own entries for a roster write', () => {
    const custom = [{ id: 'my-proxy/gpt', runtime: 'codex', note: 'cheap' }]
    expect(customModelsFromView(rosterView(custom))).toEqual(custom)
    expect(customModelsFromView(view([]))).toEqual([])
  })

  it('carries the runtime groups onto every model row and no other', () => {
    const v = rosterView([{ id: 'my-proxy/gpt', runtime: 'codex' }])
    const modelRow = globalRows(v).find((r) => r.key === 'model')
    expect(modelRow?.modelGroups.map((g) => g.runtime)).toEqual(['claude-code', 'codex'])
    expect(modelRow?.options).toContain('my-proxy/gpt')
    expect(describeField(field({ key: 'sandbox', value: 'docker' })).modelGroups).toEqual([])
  })

  it('never renders the roster itself as a settings row', () => {
    expect(globalRows(rosterView([])).map((r) => r.key)).toEqual(['model'])
  })
})

/**
 * What the custom-id form commits. The runtime picker is required precisely
 * because guessing is the failure we are avoiding: an unanswered picker must
 * stop the write, not quietly pick Claude.
 */
describe('customModelCommit', () => {
  it('builds an entry from an id, a declared runtime, and a note', () => {
    expect(customModelCommit(' my-proxy/gpt ', 'codex', '  mechanical refactors ')).toEqual({
      entry: { id: 'my-proxy/gpt', runtime: 'codex', note: 'mechanical refactors' },
    })
  })

  it('omits the note when it is blank — it is optional', () => {
    expect(customModelCommit('my-proxy/gpt', 'claude-code', '   ')).toEqual({
      entry: { id: 'my-proxy/gpt', runtime: 'claude-code' },
    })
  })

  it('refuses a blank id', () => {
    expect(customModelCommit('  ', 'codex', '')).toEqual({ error: 'Enter a model id.' })
  })

  it('refuses to guess an unanswered or unknown runtime', () => {
    expect(customModelCommit('my-proxy/gpt', '', '')).toEqual({
      error: 'Choose which runtime this model runs on.',
    })
    expect(customModelCommit('my-proxy/gpt', 'gemini', '')).toEqual({
      error: 'Choose which runtime this model runs on.',
    })
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

  it('offers the unset steps — review among them — for adding', () => {
    const v = view([{ key: 'stepModels.smoke', value: 'h', source: 'file' }])
    const offered = unsetStepKeys(v)
    const keys = offered.map((s) => s.key)
    expect(keys).toContain('stepModels.implement')
    expect(keys).not.toContain('stepModels.smoke')
    // The reviewer is chosen here, and reads as a name rather than a config key.
    expect(offered).toContainEqual({ key: 'stepModels.review', label: 'Review' })
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
    const rows = globalRows(view([{ key: 'serverPort' }, { key: 'model' }, { key: 'sandbox' }]))
    expect(rows.map((r) => r.key)).toEqual(['serverPort', 'model', 'sandbox'])
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
      setup: false,
      dev: false,
      teardown: false,
    })
  })

  it('reports each drive field that carries a command', () => {
    expect(
      driveCapabilities(
        view([
          { key: 'driveSetupCommand', value: 'bash .runcastle/drive-setup.sh' },
          { key: 'devCommand', value: 'bun dev' },
          { key: 'driveStopCommand', value: 'bash .runcastle/drive-stop.sh' },
        ]),
      ),
    ).toEqual({ setup: true, dev: true, teardown: true })
  })

  // A field cleared back to blank (or to whitespace) is a field the drive skips.
  it('treats a blank or whitespace-only value as not configured', () => {
    expect(
      driveCapabilities(
        view([
          { key: 'devCommand', value: '' },
          { key: 'driveSetupCommand', value: '   ' },
          { key: 'driveStopCommand', value: null },
        ]),
      ),
    ).toEqual({ setup: false, dev: false, teardown: false })
  })

  // Before settings land there is no answer, and guessing "false" would print
  // "this project has no drive commands" at every mount of the review page.
  it('has no answer until the settings view has loaded', () => {
    expect(driveCapabilities(undefined)).toBeUndefined()
  })
})

/**
 * REPORT 1.20 — the overlay fed every numeric field through `Number(raw)`, and
 * `Number('') === 0`. Blanking "Burn CPU limit" (the documented way to
 * unconstrain it) sent a 0 that `z.number().positive()` rejects, and typing
 * anything non-numeric sent `NaN`.
 */
describe('fieldCommit', () => {
  it('sends a blank numeric field as an unset, not as zero', () => {
    expect(fieldCommit('number', '')).toEqual({ value: null })
    expect(fieldCommit('number', '   ')).toEqual({ value: null })
  })

  it('refuses a non-numeric value instead of sending NaN', () => {
    expect(fieldCommit('number', 'lots')).toEqual({
      error: 'Enter a number, or leave it blank to unset it.',
    })
    expect(fieldCommit('number', '1.2.3')).toEqual({
      error: 'Enter a number, or leave it blank to unset it.',
    })
  })

  it('commits the number a numeric field holds', () => {
    expect(fieldCommit('number', '4')).toEqual({ value: 4 })
    expect(fieldCommit('number', ' 1.5 ')).toEqual({ value: 1.5 })
  })

  it('leaves text fields as trimmed strings, blank included', () => {
    expect(fieldCommit('text', ' main ')).toEqual({ value: 'main' })
    expect(fieldCommit('text', '')).toEqual({ value: '' })
    expect(fieldCommit('textarea', 'bun test\nbun run typecheck')).toEqual({
      value: 'bun test\nbun run typecheck',
    })
  })
})
