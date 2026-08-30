// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingField, SettingsView } from '../src/lib/api'

/**
 * The Models page (flow-redesign-settings, ticket 7). Tier 2: nothing here is
 * markup — the default is in two places that have to agree, a note commits when
 * it is left, removing a model in use is refused, and every write is a mutation
 * whose payload is the whole point.
 *
 * The one data boundary is `settings.get` / `settings.update`, so the tRPC
 * client is stood up here and what is asserted is the writes the page issues.
 */
const server = vi.hoisted(() => ({
  globals: { fields: [] } as { fields: unknown[] },
  scoped: { fields: [] } as { fields: unknown[] },
  updates: [] as Record<string, unknown>[],
  /** Set to make the next commit come back refused, with this message. */
  reject: null as string | null,
}))

vi.mock('../src/trpc', () => ({
  // Cast because tRPC's generated proxy type cannot be partially implemented;
  // everything below is exactly what the dialog calls.
  trpc: {
    useUtils: () => ({
      settings: { get: { invalidate: () => undefined } },
      project: { prep: { invalidate: () => undefined } },
    }),
    settings: {
      get: {
        useQuery: (input?: { projectId?: string }) => ({
          data: input?.projectId ? server.scoped : server.globals,
          isLoading: false,
          error: null,
        }),
      },
      update: {
        useMutation: (opts?: {
          onSuccess?: () => void
          onError?: (e: { message: string }) => void
        }) => ({
          isPending: false,
          mutate: (input: Record<string, unknown>) => {
            server.updates.push(input)
            if (server.reject) opts?.onError?.({ message: server.reject })
            else opts?.onSuccess?.()
          },
        }),
      },
    },
  } as unknown as typeof import('../src/trpc').trpc,
}))

const { SettingsDialog } = await import('../src/components/settings/SettingsDialog')

const field = (over: Partial<SettingField>): SettingField =>
  ({
    key: 'model',
    value: null,
    source: 'file',
    editable: true,
    restartRequired: false,
    scope: 'global',
    ...over,
  }) as SettingField

const view = (fields: SettingField[]): SettingsView => ({ fields }) as SettingsView

/** The operator's own roster: one annotated curated model and two proxies. */
const customModels = [
  { id: 'gpt-5.6-sol', runtime: 'codex', note: 'Logic and backend' },
  { id: 'my-proxy', runtime: 'codex' },
  { id: 'spare-proxy', runtime: 'codex' },
]

const globalFields: SettingField[] = [
  field({ key: 'model', value: 'claude-opus-5' }),
  field({ key: 'models', value: customModels }),
  field({ key: 'stepModels.implement', value: 'gpt-5.6-sol', source: 'file' }),
  field({ key: 'stepModels.smoke', value: 'my-proxy', source: 'file' }),
  // Unset steps report the default model with a `default` source.
  field({ key: 'stepModels.review', value: 'claude-opus-5', source: 'default' }),
]

/** The open project, which by default takes the global model rather than its own. */
const projectFields = (over: Partial<SettingField> = {}): SettingField[] => [
  field({ key: 'model', value: 'claude-opus-5', scope: 'project', source: 'default', ...over }),
]

function open() {
  return render(
    <SettingsDialog
      projectId="proj_1"
      projectName="runcastle"
      location={{ page: 'models' }}
      onClose={() => undefined}
    />,
  )
}

/** A roster row, found by the note cell only that row has. */
const rowOf = (id: string) =>
  screen.getByLabelText(`Note for ${id}`).closest('div.group') as HTMLElement

const lastUpdate = () => server.updates[server.updates.length - 1]

describe('Models page', () => {
  beforeEach(() => {
    server.globals = view(globalFields)
    server.scoped = view(projectFields())
    server.updates = []
    server.reject = null
  })
  afterEach(cleanup)

  it('renders the default card, then the roster, then the per-step table', () => {
    open()

    const text = screen.getByRole('dialog').textContent ?? ''
    expect(text.indexOf('Default model')).toBeGreaterThan(-1)
    expect(text.indexOf('Default model')).toBeLessThan(text.indexOf('Roster'))
    expect(text.indexOf('Roster')).toBeLessThan(text.indexOf('Per step'))
    expect(
      screen.getByText(/Runs every step that has no model of its own below/),
    ).toBeTruthy()
  })

  it('states the default in the card and as the roster’s DEFAULT chip', () => {
    open()

    expect((screen.getByLabelText('Default model') as HTMLSelectElement).value).toBe(
      'claude-opus-5',
    )
    const chip = within(rowOf('claude-opus-5'))
      .getAllByText('Default')
      .find((el) => el.className.includes('rounded-pill'))
    expect(chip).toBeTruthy()
    // The default row is the one with nothing to make default.
    expect(screen.queryByRole('button', { name: 'Make claude-opus-5 the default' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Make gpt-5.6-sol the default' })).toBeTruthy()
  })

  it('writes the default model from the card and from a row alike', () => {
    open()

    fireEvent.change(screen.getByLabelText('Default model'), {
      target: { value: 'claude-sonnet-5' },
    })
    expect(lastUpdate()).toEqual({ key: 'model', value: 'claude-sonnet-5' })
    expect(screen.getByText('Saved ✓')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Make gpt-5.6-sol the default' }))
    expect(lastUpdate()).toEqual({ key: 'model', value: 'gpt-5.6-sol' })
  })

  it('lists what each model is used for, the default first', () => {
    open()

    const used = rowOf('claude-opus-5').textContent ?? ''
    expect(used).toContain('Default')
    expect(used).toContain('Ideation')
    // The steps that have their own model are not on the default's list.
    expect(used).not.toContain('Implement')
    expect(rowOf('gpt-5.6-sol').textContent).toContain('Implement')
    expect(rowOf('spare-proxy').textContent).toContain('—')
  })

  it('annotates a curated model by upserting it with its curated runtime', () => {
    open()

    const note = screen.getByLabelText('Note for claude-opus-5')
    fireEvent.change(note, { target: { value: 'UI/UX work' } })
    fireEvent.blur(note)

    expect(lastUpdate()).toEqual({
      key: 'models',
      value: [...customModels, { id: 'claude-opus-5', runtime: 'claude-code', note: 'UI/UX work' }],
    })
  })

  it('drops a curated model’s entry when its note is cleared', () => {
    open()

    const note = screen.getByLabelText('Note for gpt-5.6-sol')
    expect((note as HTMLInputElement).value).toBe('Logic and backend')
    fireEvent.change(note, { target: { value: '  ' } })
    fireEvent.blur(note)

    expect(lastUpdate()).toEqual({
      key: 'models',
      value: [
        { id: 'my-proxy', runtime: 'codex' },
        { id: 'spare-proxy', runtime: 'codex' },
      ],
    })
  })

  it('refuses to add a model without an explicit runtime, and writes nothing', () => {
    open()

    fireEvent.change(screen.getByLabelText('New model id'), { target: { value: 'my-new-proxy' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add model' }))

    expect(screen.getByRole('alert').textContent).toBe('Choose which runtime this model runs on.')
    expect(server.updates).toEqual([])

    fireEvent.change(screen.getByLabelText('Runtime (required)'), { target: { value: 'codex' } })
    fireEvent.change(screen.getByLabelText('New model note'), { target: { value: 'cheap' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add model' }))

    expect(lastUpdate()).toEqual({
      key: 'models',
      value: [...customModels, { id: 'my-new-proxy', runtime: 'codex', note: 'cheap' }],
    })
  })

  it('removes a custom model, but not one a step is running', () => {
    open()

    fireEvent.click(screen.getByRole('button', { name: 'Remove my-proxy' }))
    expect(screen.getByRole('alert').textContent).toBe(
      'my-proxy runs Smoke — reset those steps first.',
    )
    expect(server.updates).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Remove spare-proxy' }))
    expect(lastUpdate()).toEqual({
      key: 'models',
      value: [customModels[0], customModels[1]],
    })
    // A curated model is not the operator's to remove.
    expect(screen.queryByRole('button', { name: 'Remove claude-opus-5' })).toBeNull()
  })

  it('collapses curated models nobody uses behind “show all”', () => {
    open()

    expect(screen.queryByLabelText('Note for claude-sonnet-5')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'show all' }))

    expect(screen.getByLabelText('Note for claude-sonnet-5')).toBeTruthy()
  })

  it('names every one of the eleven step selects', () => {
    open()

    const steps = [
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
    ]
    for (const step of steps) {
      expect(screen.getByLabelText(`Model for ${step}`)).toBeTruthy()
    }
    // An unset step reads out what it will actually run.
    expect(within(screen.getByLabelText('Model for Converge')).getByText('Default (claude-opus-5)'))
      .toBeTruthy()
    expect((screen.getByLabelText('Model for Implement') as HTMLSelectElement).value).toBe(
      'gpt-5.6-sol',
    )
  })

  it('writes a step’s model, and clears it on reset', () => {
    open()

    fireEvent.change(screen.getByLabelText('Model for Review'), {
      target: { value: 'claude-haiku-4-5' },
    })
    expect(lastUpdate()).toEqual({ key: 'stepModels.review', value: 'claude-haiku-4-5' })

    fireEvent.click(screen.getByRole('button', { name: 'Reset Implement to default' }))
    expect(lastUpdate()).toEqual({ key: 'stepModels.implement', value: null })
    // Only a step with a model of its own has anything to reset.
    expect(screen.queryByRole('button', { name: 'Reset Converge to default' })).toBeNull()
  })

  it('says the per-step models apply elsewhere only when this project sets one', () => {
    open()
    expect(screen.queryByText(/these apply to other projects/)).toBeNull()
    cleanup()

    server.scoped = view(projectFields({ value: 'gpt-5.6-sol', source: 'project' }))
    open()
    expect(screen.getByText(/these apply to other projects/).textContent).toContain('gpt-5.6-sol')
  })

  it('shows the server’s refusal beside the model it refused', () => {
    server.reject = 'models must declare a runtime'
    open()

    const note = screen.getByLabelText('Note for my-proxy')
    fireEvent.change(note, { target: { value: 'cheap runs' } })
    fireEvent.blur(note)

    expect(within(rowOf('my-proxy')).getByRole('alert').textContent).toBe(
      'models must declare a runtime',
    )
  })

  it('hides the roster and step rows the filter leaves out', () => {
    open()

    fireEvent.change(screen.getByLabelText('Filter settings'), { target: { value: 'proxy' } })

    expect(screen.getByLabelText('Note for my-proxy')).toBeTruthy()
    expect(screen.queryByLabelText('Note for claude-opus-5')).toBeNull()
    expect(screen.queryByLabelText('Model for Implement')).toBeNull()
    expect(screen.queryByLabelText('Default model')).toBeNull()
    // A step is found by its name, not only by its key.
    fireEvent.change(screen.getByLabelText('Filter settings'), { target: { value: 'waypoint' } })
    expect(screen.getByLabelText('Model for Waypoint')).toBeTruthy()
    expect(screen.queryByLabelText('Note for my-proxy')).toBeNull()
  })
})
