import { describe, expect, it } from 'vitest'
import {
  customModelCommit,
  customModelsFromView,
  describeField,
  effectiveStepModel,
  fieldCommit,
  filterSettings,
  globalRows,
  hiddenCuratedCount,
  modelOptionGroups,
  pageRows,
  projectModelWarning,
  projectRows,
  rosterFromView,
  rosterRows,
  rosterVisibleRows,
  rowSearchTerms,
  settingsLocationFromMessage,
  stepModelRows,
  stepRows,
  unsetStepKeys,
} from '../src/lib/settings'
import type { FindingLike } from '../src/lib/prep-findings'
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
    expect(row.label).toBe('Iterations per attempt')
    expect(row.control).toBe('number')
    expect(row.tooltip).not.toBe('')
    expect(
      describeField(field({ key: 'burnMaxIterations', source: 'env', editable: false })).note,
    ).toBe('Set by RUNCASTLE_BURN_MAX_ITERATIONS')
  })

  it('leaves model ids to speak for themselves', () => {
    expect(describeField(field({ key: 'model', value: 'claude-opus-5' })).optionLabels).toEqual({})
  })

  it('renders burnConcurrency as an editable number control with an env-lock note when locked', () => {
    const row = describeField(field({ key: 'burnConcurrency', value: 3 }))
    expect(row.label).toBe('Concurrency')
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
  // an unset field has to be told which way this machine went — and it belongs
  // beside the input, where the empty control is, not in a tooltip.
  it('says what burn concurrency defaults to on this machine while it is unset', () => {
    expect(describeField(field({ key: 'burnConcurrency', value: 1 })).unit).toBe(
      'tickets at once · default on this machine: 1',
    )
    expect(describeField(field({ key: 'burnConcurrency', value: 3 })).unit).toBe(
      'tickets at once · default on this machine: 3',
    )
  })

  it('drops the machine-default once a width is actually set', () => {
    const row = describeField(field({ key: 'burnConcurrency', value: 5, source: 'file' }))
    expect(row.unit).toBe('tickets at once')
    expect(row.note).toBeNull()
  })

  it('leaves every unset global field without a note', () => {
    expect(describeField(field({ key: 'burnConcurrency', value: 3 })).note).toBeNull()
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
    expect(row.tooltip).not.toContain('Claude')
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

/**
 * The redesign (flow-redesign-settings). Settings is four task pages in one
 * dialog, and every derivation those pages need lives here: which page a field
 * is on, the chips that say where a value came from, the roster and per-step
 * tables, the filter, and the deep link an error message resolves to.
 */

const DAY = 24 * 3600_000

/** Every field the GLOBAL settings view carries, in the server's own order. */
const globalView = (): SettingsView =>
  view([
    { key: 'serverPort', value: 4512 },
    { key: 'model', value: 'claude-opus-5' },
    { key: 'models', value: [] },
    { key: 'sandbox', value: 'docker' },
    { key: 'sandboxImage', value: null },
    { key: 'sessionMcp', value: 'inherit' },
    { key: 'burnConcurrency', value: 3, source: 'file' },
    { key: 'burnMaxIterations', value: 3 },
    { key: 'burnAttempts', value: 3 },
    { key: 'burnConflictAttempts', value: 2 },
    { key: 'burnCpus', value: null },
    { key: 'setupCommand', value: null },
    { key: 'verifyCommands', value: null },
    { key: 'knownFailures', value: null },
    { key: 'stepModels.smoke', value: 'claude-haiku-4-5', source: 'file' },
  ])

/**
 * Every field a project can override, as the project-scoped view reports them.
 * `over` patches a field in place, keyed by its settings key.
 */
const projectView = (over: Record<string, Partial<SettingField>> = {}): SettingsView =>
  view(
    (
      [
        { key: 'serverPort', value: 4512, scope: 'global' },
        { key: 'model', value: 'claude-opus-5', scope: 'project', source: 'file' },
        { key: 'sandbox', value: 'docker', scope: 'project', source: 'default' },
        { key: 'setupCommand', value: 'bun install', scope: 'project', source: 'project' },
        { key: 'verifyCommands', value: 'bun test', scope: 'project', source: 'project' },
        { key: 'knownFailures', value: null, scope: 'project', source: 'default' },
        { key: 'devCommand', value: 'bun dev', scope: 'project', source: 'project' },
        { key: 'sessionBranch', value: null, scope: 'project', source: 'default' },
        { key: 'dbResetCommand', value: null, scope: 'project', source: 'default' },
        { key: 'driveSetupCommand', value: null, scope: 'project', source: 'default' },
        { key: 'driveStopCommand', value: null, scope: 'project', source: 'default' },
      ] satisfies Partial<SettingField>[]
    ).map((f) => ({ ...f, ...over[f.key] })),
    'proj_1',
  )

describe('pageRows — one page per task', () => {
  it('puts the machine-wide fields on General, grouped Server then Sessions', () => {
    const rows = pageRows(globalView(), 'general')
    expect(rows.map((r) => r.key)).toEqual([
      'serverPort',
      'sandbox',
      'sandboxImage',
      'sessionMcp',
    ])
    expect(rows.map((r) => r.group)).toEqual(['server', 'sessions', 'sessions', 'sessions'])
    expect(rows.find((r) => r.key === 'sandboxImage')?.placeholder).toBe('sandcastle:runcastle')
  })

  it('gives Models only the default model — the roster and steps are tables', () => {
    expect(pageRows(globalView(), 'models').map((r) => r.key)).toEqual(['model'])
  })

  it('puts the five burn numbers on Burns, each with the unit it counts', () => {
    const rows = pageRows(globalView(), 'burns')
    expect(rows.map((r) => r.key)).toEqual([
      'burnConcurrency',
      'burnMaxIterations',
      'burnAttempts',
      'burnConflictAttempts',
      'burnCpus',
    ])
    expect(rows.map((r) => r.unit)).toEqual([
      'tickets at once',
      'turns',
      'attempts',
      'passes before asking you',
      'cores',
    ])
    // The one place a label alone is ambiguous, and the only short help line.
    expect(rows.find((r) => r.key === 'burnMaxIterations')?.shortHelp).toBe(
      'Distinct from attempts: an attempt restarts an agent that crashed.',
    )
    expect(rows.find((r) => r.key === 'burnAttempts')?.shortHelp).toBeUndefined()
    expect(rows.find((r) => r.key === 'burnCpus')?.placeholder).toBe('unlimited')
  })

  it('groups This project as model & sandbox, commands, then project chat', () => {
    const rows = pageRows(projectView(), 'project')
    expect(rows.map((r) => r.key)).toEqual([
      'model',
      'sandbox',
      'setupCommand',
      'verifyCommands',
      'knownFailures',
      'devCommand',
      'driveSetupCommand',
      'driveStopCommand',
      'dbResetCommand',
      'sessionBranch',
    ])
    expect(rows.map((r) => r.group)).toEqual([
      'model',
      'model',
      'commands',
      'commands',
      'commands',
      'commands',
      'commands',
      'commands',
      'commands',
      'chat',
    ])
  })

  it('reads the project scope out of the global default model’s name', () => {
    const [model] = pageRows(projectView(), 'project')
    expect(model?.label).toBe('Model')
    expect(pageRows(globalView(), 'models')[0]?.label).toBe('Default model')
  })

  it('gives every command field a mono example to type over', () => {
    const rows = pageRows(projectView(), 'project')
    const placeholder = (key: string) => rows.find((r) => r.key === key)?.placeholder
    expect(placeholder('setupCommand')).toBe(
      'e.g. pnpm install --frozen-lockfile && pnpm prisma:generate',
    )
    expect(placeholder('devCommand')).toBe('e.g. pnpm dev')
    expect(placeholder('driveSetupCommand')).toBe('e.g. docker compose up -d && pnpm db:migrate')
    expect(placeholder('driveStopCommand')).toBe('e.g. docker compose down')
    expect(placeholder('dbResetCommand')).toBe('e.g. pnpm db:reset')
    expect(placeholder('sessionBranch')).toBe('main (detected)')
  })

  it('gives every row a tooltip to hold the explanation the row does not print', () => {
    for (const page of ['general', 'models', 'burns'] as const) {
      for (const row of pageRows(globalView(), page)) expect(row.tooltip).not.toBe('')
    }
    for (const row of pageRows(projectView(), 'project')) expect(row.tooltip).not.toBe('')
  })

  // General and Burns are machine-wide: they read the global view, so the
  // project-scoped copy of `sandbox` never doubles up there (decision 7).
  it('never renders a project-scoped field on a machine-wide page', () => {
    expect(pageRows(projectView(), 'general').map((r) => r.key)).not.toContain('sandbox')
  })
})

describe('describeField — where a value came from', () => {
  const twin = (over: Partial<SettingField>) =>
    describeField(field({ key: 'setupCommand', scope: 'project', ...over }))

  it('shows the inherited global as a ghost with a Global chip while unset', () => {
    const row = twin({ value: 'bun install', source: 'file' })
    expect(row.ghostValue).toBe('bun install')
    expect(row.sourceChip).toBe('global')
  })

  it('flips the chip to This project once the project sets its own', () => {
    const row = twin({ value: 'pnpm install', source: 'project' })
    expect(row.ghostValue).toBeUndefined()
    expect(row.sourceChip).toBe('project')
  })

  it('leaves a project-only key without a chip — it has no global to inherit', () => {
    const row = describeField(field({ key: 'devCommand', value: 'bun dev', scope: 'project' }))
    expect(row.sourceChip).toBeUndefined()
    expect(row.ghostValue).toBeUndefined()
  })

  it('says Env on a locked field, and never offers it a global to fall back to', () => {
    const row = twin({ value: 'bun install', source: 'env', editable: false })
    expect(row.sourceChip).toBe('env')
    expect(row.ghostValue).toBeUndefined()
    expect(row.readOnly).toBe(true)
  })

  it('leaves a machine-wide row unchipped — there is no second scope to name', () => {
    const row = describeField(field({ key: 'sandbox', value: 'docker' }))
    expect(row.sourceChip).toBeUndefined()
    expect(row.ghostValue).toBeUndefined()
  })
})

/**
 * The provenance chip replaces the sentence under a prepared field: who
 * established the value, how long ago, how far main has moved, and whether a dry
 * run ever proved it. The evidence rides along for the popover — never inline.
 */
describe('describeField — the provenance chip', () => {
  const chip = (over: Partial<FindingLike>) =>
    describeField(
      field({ key: over.key ?? 'setupCommand', scope: 'project', source: 'project' }),
      {
        key: 'setupCommand',
        source: 'prep',
        establishedAt: Date.now() - 11 * DAY,
        ...over,
      },
    ).provenanceChip

  it('names preparation and how far main has moved since', () => {
    expect(chip({ staleCommits: 12 })).toEqual({
      text: 'Prepared · 11d ago · main +12',
      tone: 'ok',
    })
  })

  it('drops the distance when main has not moved', () => {
    expect(chip({ staleCommits: 0 })?.text).toBe('Prepared · 11d ago')
    expect(chip({})?.text).toBe('Prepared · 11d ago')
  })

  it('stamps a session value that a dry run proved', () => {
    expect(
      chip({ key: 'devCommand', source: 'session', verifiedAt: Date.now() - 10 * DAY }),
    ).toEqual({
      text: 'Set in a session · 11d ago · verified by a dry run 10d ago',
      tone: 'ok',
    })
  })

  it('dims a drive-loop key no dry run has ever reached', () => {
    expect(chip({ key: 'driveStopCommand', source: 'session' })).toEqual({
      text: 'Set in a session · 11d ago · unverified',
      tone: 'muted',
    })
  })

  it('credits the human, and doubts nothing a dry run cannot prove', () => {
    expect(chip({ key: 'dbResetCommand', source: 'human', staleCommits: 400 })).toEqual({
      text: 'You · 11d ago',
      tone: 'ok',
    })
    expect(chip({ key: 'devCommand', source: 'human' })).toEqual({
      text: 'You · 11d ago · unverified',
      tone: 'muted',
    })
  })

  it('warns once the repo has moved far enough to doubt the measurement', () => {
    expect(chip({ staleCommits: 213 })).toEqual({
      text: 'Prepared · 11d ago · main +213',
      tone: 'warn',
    })
  })

  it('carries the evidence for the popover rather than printing it', () => {
    expect(chip({ evidence: 'exit 0 in 48s' })?.evidence).toBe('exit 0 in 48s')
    expect(chip({})?.evidence).toBeUndefined()
  })
})

/**
 * The roster is the Models page's centre: annotating a model is what offers it
 * to the tickets agent, so "what is this model for" and "what uses it" have to
 * be one table (decision 6/15/16).
 */
describe('rosterRows', () => {
  const rosterView = () =>
    view([
      { key: 'model', value: 'claude-opus-5' },
      {
        key: 'models',
        value: [
          { id: 'claude-haiku-4-5', runtime: 'claude-code', note: 'cheap smoke runs' },
          { id: 'my-proxy/gpt', runtime: 'codex', note: 'mechanical refactors' },
        ],
      },
      { key: 'stepModels.implement', value: 'gpt-5.6-sol', source: 'file' },
    ])

  it('reports what each model is used for, the default among them', () => {
    const rows = rosterRows(rosterView())
    const row = (id: string) => rows.find((r) => r.id === id)
    expect(row('claude-opus-5')?.isDefault).toBe(true)
    // Everything that has no step model of its own falls to the default.
    expect(row('claude-opus-5')?.usedFor).not.toContain('implement')
    expect(row('claude-opus-5')?.usedFor).toContain('ideation')
    expect(row('gpt-5.6-sol')?.usedFor).toEqual(['implement'])
    expect(row('gpt-5.6-sol')?.isDefault).toBe(false)
    expect(row('claude-sonnet-5')?.usedFor).toEqual([])
  })

  it('marks only the ids the operator added as removable, and keeps their notes', () => {
    const rows = rosterRows(rosterView())
    expect(rows.find((r) => r.id === 'my-proxy/gpt')).toEqual({
      id: 'my-proxy/gpt',
      runtime: 'codex',
      note: 'mechanical refactors',
      usedFor: [],
      isDefault: false,
      custom: true,
    })
    // Annotating a curated model writes a roster entry; it is still curated.
    expect(rows.find((r) => r.id === 'claude-haiku-4-5')).toMatchObject({
      note: 'cheap smoke runs',
      custom: false,
    })
  })

  it('collapses the curated models nothing uses and nobody annotated', () => {
    const rows = rosterRows(rosterView())
    expect(rosterVisibleRows(rows).map((r) => r.id)).toEqual([
      'claude-opus-5',
      'claude-haiku-4-5',
      'gpt-5.6-sol',
      'my-proxy/gpt',
    ])
    expect(hiddenCuratedCount(rows)).toBe(rows.length - 4)
    expect(hiddenCuratedCount(rows)).toBeGreaterThan(0)
  })
})

describe('stepRows', () => {
  const stepView = () =>
    view([
      { key: 'model', value: 'claude-opus-5' },
      { key: 'models', value: [{ id: 'my-proxy/gpt', runtime: 'codex' }] },
      { key: 'stepModels.implement', value: 'my-proxy/gpt', source: 'file' },
      { key: 'stepModels.smoke', value: 'claude-haiku-4-5', source: 'default' },
    ])

  // `revisit` and `project` used to render as raw config keys (bug found in the
  // walk); every step is listed now, so every one of them needs a name.
  it('lists all eleven steps, grouped, each with a name and a description', () => {
    const rows = stepRows(stepView())
    expect(rows.map((r) => r.step)).toEqual([
      'ideation',
      'qa',
      'waypoint',
      'converge',
      'revisit',
      'project',
      'research',
      'implement',
      'review',
      'prepare',
      'smoke',
    ])
    expect(rows.map((r) => r.label)).toEqual([
      'Ideation',
      'Q&A',
      'Waypoint',
      'Converge',
      'Revisit',
      'Project chat',
      'Research',
      'Implement',
      'Review',
      'Prepare',
      'Smoke',
    ])
    expect(rows.map((r) => r.group)).toEqual([
      ...Array<string>(6).fill('sessions'),
      ...Array<string>(5).fill('unattended'),
    ])
    for (const row of rows) expect(row.description).not.toBe('')
  })

  it('says what each step will actually run, and on which runtime', () => {
    const rows = stepRows(stepView())
    const row = (step: string) => rows.find((r) => r.step === step)
    expect(row('implement')).toMatchObject({
      value: 'my-proxy/gpt',
      effectiveModel: 'my-proxy/gpt',
      effectiveRuntime: 'codex',
    })
    // Unset — including a step the schema has a default for, which is not a
    // choice anyone made — follows the default model.
    expect(row('smoke')).toMatchObject({
      value: null,
      effectiveModel: 'claude-opus-5',
      effectiveRuntime: 'claude-code',
    })
    expect(row('revisit')?.value).toBeNull()
  })
})

describe('projectModelWarning', () => {
  it('names the model this project runs everything on', () => {
    expect(projectModelWarning(projectView())).toBeNull()
    expect(
      projectModelWarning(projectView({ model: { value: 'gpt-5.6-sol', source: 'project' } })),
    ).toBe('gpt-5.6-sol')
  })

  it('has nothing to say while the view is still loading', () => {
    expect(projectModelWarning(undefined)).toBeNull()
  })
})

describe('filterSettings', () => {
  const items = [
    ...pageRows(globalView(), 'general').map((r) => ({
      id: r.key,
      page: 'general' as const,
      terms: rowSearchTerms(r),
    })),
    ...pageRows(globalView(), 'burns').map((r) => ({
      id: r.key,
      page: 'burns' as const,
      terms: rowSearchTerms(r),
    })),
    { id: 'gpt-5.6-sol', page: 'models' as const, terms: ['gpt-5.6-sol', 'Codex'] },
  ]

  it('shows everything and counts nothing until someone types', () => {
    const all = filterSettings('   ', items)
    expect(all.matches.size).toBe(items.length)
    expect(all.counts).toEqual({ general: 0, models: 0, burns: 0, project: 0 })
  })

  it('counts the hits per page so the rail can say where they are', () => {
    const { counts, matches } = filterSettings('sandbox', items)
    expect(matches).toEqual(new Set(['sandbox', 'sandboxImage']))
    expect(counts).toEqual({ general: 2, models: 0, burns: 0, project: 0 })
  })

  it('matches the key and the tooltip, not just the label', () => {
    expect(filterSettings('burnCpus', items).matches).toEqual(new Set(['burnCpus']))
    expect(filterSettings('--cpus', items).matches).toEqual(new Set(['burnCpus']))
  })

  it('searches the extra strings a page hands it, like a model id', () => {
    const { counts, matches } = filterSettings('GPT-5.6', items)
    expect(matches).toEqual(new Set(['gpt-5.6-sol']))
    expect(counts.models).toBe(1)
  })

  it('finds nothing rather than everything for a query nothing matches', () => {
    expect(filterSettings('zzz', items).matches.size).toBe(0)
  })
})

/**
 * Every pointer at the AFK prerequisites used to be plain text, and the card it
 * pointed at could be a single un-retryable error line. These two messages are
 * the real ones, from the doctor's stale-image probe and the burner's
 * missing-binary precheck.
 */
describe('settingsLocationFromMessage', () => {
  it('turns the doctor’s rebuild advice into a link to the image row', () => {
    expect(settingsLocationFromMessage('Open Settings → AFK burns and click "Rebuild image".')).toEqual(
      { page: 'burns', field: 'sandcastle-image' },
    )
  })

  it('turns the burner’s missing-binary message into the same link', () => {
    expect(
      settingsLocationFromMessage(
        'claude is not installed in image sandcastle:runcastle — the image predates the burner Dockerfile. Rebuild it from Settings → AFK burns (Rebuild image).',
      ),
    ).toEqual({ page: 'burns', field: 'sandcastle-image' })
  })

  it('follows the page to its new name', () => {
    expect(settingsLocationFromMessage('See Settings → Burns.')).toEqual({
      page: 'burns',
      field: 'sandcastle-image',
    })
  })

  it('leaves a message that points nowhere alone', () => {
    expect(settingsLocationFromMessage('The burn failed.')).toBeNull()
  })
})
