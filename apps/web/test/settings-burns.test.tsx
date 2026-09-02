// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingField, SettingsView } from '../src/lib/api'
import type { SettingsLocation } from '../src/lib/settings'

/**
 * Settings → Burns (flow-redesign-settings, ticket 9). Tier 2: the page is the
 * prerequisites checklist over one doctor report plus five numeric fields, and
 * the questions worth asking — what a deep link highlights, whether the machine
 * default is a ghost rather than a value, what a "Settings → Burns" message
 * turns into — are all about a rendered tree.
 *
 * Two seams: `settings.get`/`settings.update` for the fields and `setup.doctor`
 * for the checklist. Both are fixtures here.
 */
const server = vi.hoisted(() => ({
  globals: { fields: [] } as { fields: unknown[] },
  probes: [] as Record<string, unknown>[],
  /** The doctor is still shelling out to the container runtime: no report yet. */
  doctorPending: false,
  /** What the checklist asked of the doctor query, in order. */
  doctorCalls: [] as string[],
  /** How many times the checklist has asked for the report again. */
  doctorAsks: 0,
}))

vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: () => undefined }) }))

vi.mock('../src/trpc', () => {
  const mutation = () => ({ isPending: false, mutate: () => undefined })
  return {
    trpc: {
      useUtils: () => ({
        settings: { get: { invalidate: () => undefined } },
        project: { prep: { invalidate: () => undefined } },
        setup: {
          doctor: {
            invalidate: () => undefined,
            cancel: () => {
              server.doctorCalls.push('cancel')
              return Promise.resolve()
            },
          },
        },
        system: { burnCache: { status: { invalidate: () => undefined } } },
      }),
      settings: {
        get: {
          useQuery: () => ({ data: server.globals, isLoading: false, error: null }),
        },
        update: { useMutation: mutation },
      },
      setup: {
        doctor: {
          useQuery: () => ({
            data: server.doctorPending
              ? undefined
              : { results: server.probes, ok: false, tier1Ok: true },
            isLoading: server.doctorPending,
            error: null,
            refetch: () => {
              server.doctorCalls.push('refetch')
              server.doctorAsks += 1
            },
          }),
        },
        runtimeGuide: { useQuery: () => ({ data: undefined }) },
        startTerminal: { useMutation: mutation },
        afkToken: { useMutation: mutation },
      },
      system: {
        burnCache: {
          status: { useQuery: () => ({ data: undefined }) },
          clear: { useMutation: mutation },
        },
      },
    } as unknown as typeof import('../src/trpc').trpc,
  }
})

const { SettingsDialog } = await import('../src/components/settings/SettingsDialog')
const { MessageWithSettingsLink, OpenSettingsProvider } = await import(
  '../src/components/settings/MessageWithSettingsLink'
)

const field = (over: Partial<SettingField>): SettingField =>
  ({
    value: null,
    source: 'default',
    editable: true,
    restartRequired: false,
    scope: 'global',
    ...over,
  }) as SettingField

/** The five burn numbers, as an untouched machine reports them. */
const burnFields: SettingField[] = [
  field({ key: 'burnConcurrency', value: 3, source: 'default' }),
  field({ key: 'burnMaxIterations', value: 3, source: 'file' }),
  field({ key: 'burnAttempts', value: 3, source: 'file' }),
  field({ key: 'burnConflictAttempts', value: 2, source: 'file' }),
  field({ key: 'burnCpus', value: null, source: 'default' }),
]

const probe = (over: Record<string, unknown>) => ({
  tier: 2,
  status: 'ok',
  severity: 'error',
  ...over,
})

const doctorProbes = () => [
  probe({ id: 'container-runtime', label: 'Container runtime', detail: 'docker 28.5.2' }),
  probe({
    id: 'sandcastle-image',
    label: 'Sandcastle image',
    detail: 'sandcastle:runcastle present',
  }),
  probe({
    id: 'afk-token',
    label: 'Claude Code AFK OAuth token',
    detail: 'OAuth token present',
    runtime: 'claude-code',
    check: 'afk-key',
  }),
  probe({
    id: 'codex-auth',
    label: 'Codex login',
    detail: 'credentials at ~/.codex/auth.json',
    runtime: 'codex',
    check: 'auth',
  }),
]

function open(location: SettingsLocation = { page: 'burns' }) {
  return render(
    <SettingsDialog
      projectId="proj_1"
      projectName="runcastle"
      location={location}
      onClose={() => undefined}
    />,
  )
}

describe('Settings → Burns', () => {
  beforeEach(() => {
    server.globals = { fields: burnFields } as unknown as SettingsView
    server.probes = doctorProbes()
    server.doctorPending = false
    server.doctorCalls = []
    server.doctorAsks = 0
  })
  afterEach(cleanup)

  it('opens on the prerequisites checklist, then width & retries', () => {
    open()

    expect(screen.getByText('Prerequisites for unattended burns')).toBeTruthy()
    expect(screen.getByText('Width & retries')).toBeTruthy()
    expect(screen.getByText('Container runtime')).toBeTruthy()
  })

  it('renders the five burn numbers with the unit each one counts', () => {
    open()

    const units: [string, string][] = [
      ['Concurrency', 'tickets at once · default on this machine: 3'],
      ['Iterations per attempt', 'turns'],
      ['Attempts per ticket', 'attempts'],
      ['Conflict resolver passes', 'passes before asking you'],
      ['CPU limit per burn', 'cores · e.g. 4 on a 12-thread box at width 3'],
    ]
    for (const [label, unit] of units) {
      const input = screen.getByLabelText(label) as HTMLInputElement
      expect(input.type).toBe('number')
      expect(screen.getByText(unit)).toBeTruthy()
    }
    // The one line the labels alone cannot carry.
    expect(screen.getByText(/an attempt restarts an agent that crashed/)).toBeTruthy()
  })

  // Nobody chose this width — the machine did — so the control stays empty over
  // it rather than showing a number that reads like a decision.
  it('shows this machine’s default concurrency as a ghost, not as a value', () => {
    open()

    const width = screen.getByLabelText('Concurrency') as HTMLInputElement
    expect(width.value).toBe('')
    expect(width.getAttribute('placeholder')).toBe('3')

    const iterations = screen.getByLabelText('Iterations per attempt') as HTMLInputElement
    expect(iterations.value).toBe('3')
  })

  it('scrolls to and flashes the checklist row a deep link named', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    open({ page: 'burns', field: 'sandcastle-image' })

    // The dialog is portalled, so the rows are under `document`, not the render
    // container.
    const row = (field: string) => document.querySelector(`[data-field="${field}"]`)?.className
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
    expect(row('sandcastle-image')).toContain('outline-accent')
    expect(row('container-runtime')).not.toContain('outline-accent')
  })

  it('filters the checklist rows alongside the fields', () => {
    open()

    fireEvent.change(screen.getByLabelText('Filter settings'), { target: { value: 'image' } })

    expect(screen.getByText('Sandcastle image')).toBeTruthy()
    expect(screen.queryByText('Container runtime')).toBeNull()
    expect(screen.queryByLabelText('Concurrency')).toBeNull()
    expect(screen.queryByText('Width & retries')).toBeNull()
  })

  it('drops the prerequisites heading when the filter leaves no row of it', () => {
    open()

    fireEvent.change(screen.getByLabelText('Filter settings'), { target: { value: 'attempts' } })

    expect(screen.queryByText('Prerequisites for unattended burns')).toBeNull()
    expect(screen.getByLabelText('Attempts per ticket')).toBeTruthy()
  })

  /**
   * The probes shell out to a container runtime that is under no obligation to
   * answer, so "no dead end" (decision 9) has to cover the report that never
   * arrives as well as the one that fails.
   */
  describe('while the doctor has not answered', () => {
    /** Every control the page offers, as the repro asked the live page for them. */
    const dialogButtons = () =>
      [...document.querySelectorAll('[role=dialog] button')].map((b) => b.textContent)

    beforeEach(() => {
      server.doctorPending = true
      vi.useFakeTimers()
    })
    afterEach(() => vi.useRealTimers())

    it('just says it is checking while the wait is still ordinary', () => {
      open()
      act(() => vi.advanceTimersByTime(9_000))

      expect(screen.getByText('checking prerequisites…')).toBeTruthy()
      expect(dialogButtons()).not.toContain('Retry')
    })

    it('says the wait is long, names it, and offers a Retry once it drags', async () => {
      open()
      act(() => vi.advanceTimersByTime(10_000))

      expect(screen.getByText('still checking — this is taking longer than usual')).toBeTruthy()
      expect(screen.getByText(/has not answered yet/)).toBeTruthy()
      expect(screen.getByText(/A runtime that is starting up/)).toBeTruthy()
      expect(dialogButtons()).toContain('Retry')

      // The retry has to interrupt the call already out, or it retries nothing.
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      })
      expect(server.doctorCalls).toEqual(['cancel', 'refetch'])
      expect(server.doctorAsks).toBe(1)
    })

    it('gives the retry its own wait rather than complaining again at once', async () => {
      open()
      act(() => vi.advanceTimersByTime(10_000))
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      })

      expect(dialogButtons()).not.toContain('Retry')
      act(() => vi.advanceTimersByTime(10_000))
      expect(dialogButtons()).toContain('Retry')
    })
  })
})

/**
 * The other half of decision 9: every "Settings → Burns" in the app is a link
 * now, not an instruction to go looking.
 */
describe('MessageWithSettingsLink', () => {
  afterEach(cleanup)

  const burnerFailure =
    'claude is not installed in image sandcastle:runcastle — the image predates the burner ' +
    'Dockerfile. Rebuild it from Settings → Burns (Rebuild image).'

  it('opens Burns on the image row from a burner failure', () => {
    const opened: SettingsLocation[] = []
    render(
      <OpenSettingsProvider open={(l) => opened.push(l)}>
        <MessageWithSettingsLink text={burnerFailure} />
      </OpenSettingsProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Settings → Burns' }))

    expect(opened).toEqual([{ page: 'burns', field: 'sandcastle-image' }])
    // The sentence around it stays prose.
    expect(screen.getByText(/the image predates the burner Dockerfile/)).toBeTruthy()
  })

  it('still links the doctor’s older "AFK burns" wording', () => {
    const opened: SettingsLocation[] = []
    render(
      <OpenSettingsProvider open={(l) => opened.push(l)}>
        <MessageWithSettingsLink text='Open Settings → AFK burns and click "Rebuild image".' />
      </OpenSettingsProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Settings → AFK burns' }))
    expect(opened).toEqual([{ page: 'burns', field: 'sandcastle-image' }])
  })

  it('leaves a message that points nowhere as plain text', () => {
    const { container } = render(
      <OpenSettingsProvider open={() => undefined}>
        <MessageWithSettingsLink text="the burn ran out of iterations" />
      </OpenSettingsProvider>,
    )

    expect(container.querySelector('button')).toBeNull()
    expect(container.textContent).toBe('the burn ran out of iterations')
  })
})
