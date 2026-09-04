// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectFinding, SettingField, SettingsView } from '../src/lib/api'

/**
 * "This project" (flow-redesign-settings, ticket 8). Tier 2: the whole point of
 * the page is what an interaction does — the chip that flips when a value is
 * set, the link that hands the field back to the global, the popover the
 * provenance chip opens and the Escape that must close only that popover. None
 * of it is visible in a rendered string.
 *
 * The two data boundaries are `settings.get` / `settings.update` (with a
 * `projectId`) and `project.prep`, so the tRPC client is stood up here rather
 * than a QueryClient and a server: what matters is the mutations the page
 * issues and the queries it invalidates afterwards.
 */
const DAY = 24 * 60 * 60 * 1000
const now = Date.now()

const server = vi.hoisted(() => ({
  globals: { fields: [] } as { fields: unknown[] },
  scoped: { fields: [] } as { fields: unknown[] },
  findings: [] as unknown[],
  updates: [] as Record<string, unknown>[],
  invalidated: [] as string[],
}))

vi.mock('../src/trpc', () => ({
  // Cast because tRPC's generated proxy type cannot be partially implemented;
  // everything below is exactly what the dialog calls.
  trpc: {
    useUtils: () => ({
      settings: { get: { invalidate: () => server.invalidated.push('settings.get') } },
      project: { prep: { invalidate: () => server.invalidated.push('project.prep') } },
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
        useMutation: (opts?: { onSuccess?: () => void }) => ({
          isPending: false,
          mutate: (input: Record<string, unknown>) => {
            server.updates.push(input)
            opts?.onSuccess?.()
          },
        }),
      },
    },
    project: {
      prep: { useQuery: () => ({ data: { findings: server.findings }, isLoading: false }) },
    },
  } as unknown as typeof import('../src/trpc').trpc,
}))

const { SettingsDialog } = await import('../src/components/settings/SettingsDialog')

const field = (over: Partial<SettingField>): SettingField =>
  ({
    value: '',
    source: 'default',
    editable: true,
    restartRequired: false,
    scope: 'project',
    ...over,
  }) as SettingField

const view = (fields: SettingField[]): SettingsView => ({ fields }) as SettingsView

/** The ten fields a project may set, as the scoped view reports them. */
const projectFields: SettingField[] = [
  // Twins, unset: the global value is what the ghost shows.
  field({ key: 'model', value: 'claude-opus-5[1m]', source: 'file' }),
  field({ key: 'sandbox', value: 'docker', source: 'default' }),
  // Twin, set here — and prepared, long enough ago to be stale.
  field({ key: 'setupCommand', value: 'bun install', source: 'project' }),
  field({ key: 'verifyCommands', value: 'bun run test', source: 'file' }),
  field({ key: 'knownFailures', value: '', source: 'default' }),
  // Project-only: no twin to inherit from, so no chip.
  field({ key: 'devCommand', value: 'bun dev', source: 'project' }),
  field({ key: 'driveSetupCommand', value: 'bun .runcastle/drive-setup.ts', source: 'project' }),
  field({ key: 'driveStopCommand', value: 'bun .runcastle/drive-stop.ts', source: 'project' }),
  field({ key: 'dbResetCommand', value: 'del runcastle.db', source: 'project' }),
  field({ key: 'sessionBranch', value: '', source: 'default' }),
]

const SETUP_EVIDENCE = 'Root package.json is still a bun workspace, so one root install covers all.'

const findings: ProjectFinding[] = [
  {
    key: 'setupCommand',
    source: 'prep',
    evidence: SETUP_EVIDENCE,
    establishedAt: now - 11 * DAY,
    staleCommits: 213,
  },
  {
    key: 'devCommand',
    source: 'session',
    evidence: 'Pane spawned: devConfigured true, devPaneLive true.',
    establishedAt: now - 11 * DAY,
    verifiedAt: now - 10 * DAY,
  },
  // No evidence: the chip stays a chip, with nothing to open.
  { key: 'dbResetCommand', source: 'human', establishedAt: now - 17 * DAY },
] as ProjectFinding[]

function open(onClose: () => void = () => undefined) {
  return render(
    <SettingsDialog
      projectId="proj_1"
      projectName="runcastle"
      location={{ page: 'project' }}
      onClose={onClose}
    />,
  )
}

/** The provenance chip of one row, by the text it carries. */
const chip = (text: string) => screen.getByText(text)

describe('Settings — This project', () => {
  beforeEach(() => {
    server.globals = view([field({ key: 'serverPort', value: 4512, scope: 'global' })])
    server.scoped = view(projectFields)
    server.findings = findings
    server.updates = []
    server.invalidated = []
  })
  afterEach(cleanup)

  it('shows the ten fields in three groups, with example placeholders and no retired text', () => {
    open()

    for (const title of ['Model & sandbox', 'Commands', 'Project chat']) {
      expect(screen.getByText(title)).toBeTruthy()
    }
    const labels = [
      'Model',
      'Sandbox',
      'Setup',
      'Verify',
      'Known failing tests',
      'Dev server',
      'Before a test drive',
      'After a test drive',
      'Reset dev database',
      'Commits land on',
    ]
    for (const label of labels) expect(screen.getByLabelText(label)).toBeTruthy()

    expect(screen.getByLabelText('Commits land on').getAttribute('placeholder')).toBe(
      'main (detected)',
    )
    expect(screen.getByLabelText('Known failing tests').getAttribute('placeholder')).toContain(
      'e.g. 2 failing',
    )

    // The three redundant signals the redesign replaced with one chip, and the
    // evidence that used to be a wall of prose under the control.
    for (const gone of [/OVERRIDDEN/i, /Clear override/i, /Inherited from global/i]) {
      expect(screen.queryByText(gone)).toBeNull()
    }
    expect(screen.queryByText(SETUP_EVIDENCE)).toBeNull()
  })

  it('shows an unset twin as ghost text under a Global chip', () => {
    open()

    // A text control ghosts through its placeholder…
    expect(screen.getByLabelText('Verify').getAttribute('placeholder')).toBe('bun run test')
    // …and a select through a first option that states what it inherits.
    const sandbox = screen.getByLabelText('Sandbox') as HTMLSelectElement
    expect(sandbox.value).toBe('')
    expect(sandbox.options[0]?.textContent).toBe('Use global (Docker container (isolated))')
    expect(screen.getByLabelText('Model').closest('div')?.textContent).toContain(
      'Use global (claude-opus-5[1m])',
    )

    expect(screen.getAllByText('Global').length).toBe(4)
    // Project-only fields have no twin, so nothing to say about where the
    // value came from.
    const devRow = screen.getByLabelText('Dev server').closest('div.border-b')
    expect(devRow?.textContent).not.toContain('Global')
  })

  it('flips the chip to This project when the field is set, and hands it back', () => {
    open()

    const setupRow = screen.getByLabelText('Setup').closest('div.border-b')
    expect(setupRow?.textContent).toContain('This project')

    fireEvent.click(screen.getAllByRole('button', { name: 'Use global' })[0]!)

    expect(server.updates).toEqual([
      { projectId: 'proj_1', key: 'setupCommand', value: null },
    ])
    // The chip is only offered where there is a global to fall back to.
    expect(screen.getAllByRole('button', { name: 'Use global' }).length).toBe(1)
  })

  it('writes a picked model against this project', () => {
    open()

    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'claude-sonnet-5' } })

    expect(server.updates).toEqual([
      { projectId: 'proj_1', key: 'model', value: 'claude-sonnet-5' },
    ])
  })

  it('refetches the findings as well as the settings after a write', () => {
    open()

    const branch = screen.getByLabelText('Commits land on')
    fireEvent.change(branch, { target: { value: 'trunk' } })
    fireEvent.blur(branch)

    // A human edit re-sources the finding and clears its dry-run stamp, so the
    // chip under the field has to be refetched with the value.
    expect(server.invalidated).toEqual(['settings.get', 'project.prep'])
  })

  it('states who established each prepared value, in one chip', () => {
    open()

    expect(chip('Prepared · 11d ago · main +213')).toBeTruthy()
    expect(chip('Set in a session · 11d ago · verified by a dry run 10d ago')).toBeTruthy()
    expect(chip('You · 17d ago')).toBeTruthy()
  })

  it('flags a value the repo has moved a long way past', () => {
    open()

    const stale = screen.getByText('Stale')
    expect(stale.getAttribute('title')).toContain('Re-prepare the project')
    // The setup finding is the stale one; the fresher two carry no flag.
    expect(screen.getAllByText('Stale').length).toBe(1)
  })

  it('keeps the evidence behind the chip, and closes it on Escape without closing the dialog', () => {
    const onClose = vi.fn()
    open(onClose)

    fireEvent.click(chip('Prepared · 11d ago · main +213'))

    expect(screen.getByText(/Evidence · established by preparation/)).toBeTruthy()
    expect(screen.getByText(SETUP_EVIDENCE)).toBeTruthy()

    fireEvent.keyDown(chip('Prepared · 11d ago · main +213'), { key: 'Escape' })

    expect(screen.queryByText(SETUP_EVIDENCE)).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes the evidence on a click outside it', () => {
    open()

    fireEvent.click(chip('Set in a session · 11d ago · verified by a dry run 10d ago'))
    expect(screen.getByText(/Evidence · established in a conversation/)).toBeTruthy()

    fireEvent.mouseDown(document.body)

    expect(screen.queryByText(/Evidence ·/)).toBeNull()
  })

  it('leaves a finding with nothing behind it as a plain chip', () => {
    open()

    expect(screen.queryByRole('button', { name: /You · 17d ago/ })).toBeNull()
    expect(chip('You · 17d ago')).toBeTruthy()
  })

  it('filters this page and highlights the field a deep link named', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const { unmount } = render(
      <SettingsDialog
        projectId="proj_1"
        projectName="runcastle"
        location={{ page: 'project', field: 'dbResetCommand' }}
        onClose={() => undefined}
      />,
    )

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
    expect(
      screen.getByLabelText('Reset dev database').closest('div.border-b')?.className,
    ).toContain('outline-accent')
    unmount()

    open()
    fireEvent.change(screen.getByLabelText('Filter settings'), { target: { value: 'verify' } })

    expect(screen.getByLabelText('Verify')).toBeTruthy()
    expect(screen.queryByLabelText('Setup')).toBeNull()
    expect(screen.queryByText('Project chat')).toBeNull()
  })
})
