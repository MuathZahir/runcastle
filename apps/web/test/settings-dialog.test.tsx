// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingField, SettingsView } from '../src/lib/api'
import type { SettingsLocation } from '../src/lib/settings'

/**
 * The settings dialog (flow-redesign-settings, ticket 6). Tier 2: the shell is a
 * portalled dialog, the filter moves focus and switches pages, and the whole
 * save-feedback model — "Saved ✓", the inline refusal, the restart line — only
 * exists after an event has been dispatched. None of that shows in a string.
 *
 * The one data boundary is `settings.get` / `settings.update`, so the tRPC
 * client is stood up here rather than a QueryClient and a server: the dialog
 * reaches for exactly four hooks, and what matters is the mutations it issues.
 */
const server = vi.hoisted(() => ({
  globals: { fields: [] } as { projectId?: string; fields: unknown[] },
  scoped: { fields: [] } as { projectId?: string; fields: unknown[] },
  updates: [] as Record<string, unknown>[],
  /** Set to make the next commit come back refused, with this message. */
  reject: null as string | null,
}))

vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: () => undefined }) }))

vi.mock('../src/trpc', () => ({
  // Cast because tRPC's generated proxy type cannot be partially implemented;
  // everything below is exactly what the dialog calls.
  trpc: {
    useUtils: () => ({
      settings: { get: { invalidate: () => undefined } },
      project: { prep: { invalidate: () => undefined } },
      setup: { doctor: { invalidate: () => undefined } },
      system: { burnCache: { status: { invalidate: () => undefined } } },
    }),
    // The Burns page's prerequisites checklist. It has its own suite
    // (`settings-burns.test.tsx`); here it only has to render.
    setup: {
      doctor: { useQuery: () => ({ data: undefined, isLoading: true, error: null }) },
      runtimeGuide: { useQuery: () => ({ data: undefined }) },
      startTerminal: { useMutation: () => ({ isPending: false, mutate: () => undefined }) },
      afkToken: { useMutation: () => ({ isPending: false, mutate: () => undefined }) },
    },
    system: {
      burnCache: {
        status: { useQuery: () => ({ data: undefined }) },
        clear: { useMutation: () => ({ isPending: false, mutate: () => undefined }) },
      },
    },
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
    key: 'serverPort',
    value: 4512,
    source: 'file',
    editable: true,
    restartRequired: false,
    scope: 'global',
    ...over,
  }) as SettingField

const view = (fields: SettingField[]): SettingsView => ({ fields }) as SettingsView

/** General's four fields, plus one Burns field and the two project rows. */
const globalFields = (over: Partial<SettingField> = {}): SettingField[] => [
  field({ key: 'serverPort', value: 4512, restartRequired: true, ...over }),
  field({ key: 'sandbox', value: 'docker' }),
  field({ key: 'sandboxImage', value: '' }),
  field({ key: 'sessionMcp', value: 'inherit' }),
  field({ key: 'burnConcurrency', value: 3, source: 'default' }),
]

const projectFields: SettingField[] = [
  field({ key: 'model', value: 'claude-opus-5', scope: 'project', source: 'file' }),
  field({ key: 'devCommand', value: 'bun dev', scope: 'project' }),
]

function open(location: SettingsLocation = { page: 'general' }) {
  return render(
    <SettingsDialog
      projectId="proj_1"
      projectName="runcastle"
      location={location}
      onClose={() => undefined}
    />,
  )
}

describe('SettingsDialog', () => {
  beforeEach(() => {
    server.globals = view(globalFields())
    server.scoped = view(projectFields)
    server.updates = []
    server.reject = null
  })
  afterEach(cleanup)

  it('opens as a labelled xl dialog with the four pages and a filter', () => {
    open()

    const panel = screen.getByRole('dialog')
    expect(panel.getAttribute('aria-label')).toBe('Settings')
    expect(panel.className).toContain('max-w-[940px]')
    for (const name of ['General', 'Models', 'Burns', 'This project']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
    expect(screen.getByLabelText('Filter settings')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'General' }).getAttribute('aria-current')).toBe(
      'page',
    )
    // The rail names the project whose page sits at the bottom of it.
    expect(screen.getByText('runcastle')).toBeTruthy()
  })

  it('renders General as four named fields, each with its explanation on demand', () => {
    open()

    expect(screen.getByLabelText('Server port')).toBeTruthy()
    expect(screen.getByLabelText('Sandbox')).toBeTruthy()
    expect(screen.getByLabelText('Sandbox image')).toBeTruthy()
    expect(screen.getByLabelText('MCP servers in sessions')).toBeTruthy()

    // The full explanation is behind the ⓘ, never a paragraph under the field.
    expect(screen.getByRole('button', { name: 'About Sandbox image' })).toBeTruthy()
    expect(
      screen.getByText(/The Docker image sessions and burns are sandboxed in/),
    ).toBeTruthy()
    // …and the placeholder carries the example value instead.
    expect(screen.getByLabelText('Sandbox image').getAttribute('placeholder')).toBe(
      'sandcastle:runcastle',
    )
  })

  it('locks a field the environment owns and names the variable that set it', () => {
    server.globals = view(globalFields({ source: 'env', editable: false }))
    open()

    const port = screen.getByLabelText('Server port') as HTMLInputElement
    expect(port.disabled).toBe(true)
    const chip = screen.getByTitle('Set by RUNCASTLE_SERVER_PORT')
    expect(chip.textContent).toContain('Env')
  })

  it('commits a change and says so beside the label', () => {
    open()

    const image = screen.getByLabelText('Sandbox image')
    fireEvent.change(image, { target: { value: 'sandcastle:mine' } })
    fireEvent.blur(image)

    expect(server.updates).toEqual([{ key: 'sandboxImage', value: 'sandcastle:mine' }])
    expect(screen.getByText('Saved ✓')).toBeTruthy()
  })

  it('shows the server’s refusal beside the field and snaps the draft back', () => {
    server.reject = 'sandboxImage must be a tag'
    open()

    const image = screen.getByLabelText('Sandbox image') as HTMLInputElement
    fireEvent.change(image, { target: { value: 'nope!' } })
    fireEvent.blur(image)

    expect(screen.getByRole('alert').textContent).toBe('sandboxImage must be a tag')
    expect(image.value).toBe('')
    expect(screen.queryByText('Saved ✓')).toBeNull()

    // It stays until the next edit — which is the answer to it.
    fireEvent.change(image, { target: { value: 'sandcastle:mine' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('asks for a restart only once the port has actually been changed', () => {
    open()

    expect(screen.queryByText('Restart the server to apply')).toBeNull()
    const port = screen.getByLabelText('Server port')
    fireEvent.change(port, { target: { value: '4600' } })
    fireEvent.blur(port)

    expect(server.updates).toEqual([{ key: 'serverPort', value: 4600 }])
    expect(screen.getByText('Restart the server to apply')).toBeTruthy()
  })

  it('filters every page at once, counting the hits beside each page name', () => {
    open()

    fireEvent.change(screen.getByLabelText('Filter settings'), { target: { value: 'image' } })

    expect(screen.getByLabelText('Sandbox image')).toBeTruthy()
    expect(screen.queryByLabelText('Server port')).toBeNull()
    expect(screen.queryByLabelText('Sandbox')).toBeNull()
    // The group heading goes with its rows rather than standing over nothing.
    expect(screen.queryByText('Server')).toBeNull()
    expect(screen.getByRole('button', { name: /General/ }).textContent).toContain('1')
  })

  it('moves to the first page with hits when the open one has none', () => {
    open()

    fireEvent.change(screen.getByLabelText('Filter settings'), {
      target: { value: 'concurrency' },
    })

    expect(screen.getByRole('button', { name: /Burns/ }).getAttribute('aria-current')).toBe(
      'page',
    )
  })

  it('says so when nothing matches, rather than showing an empty page', () => {
    open()

    fireEvent.change(screen.getByLabelText('Filter settings'), { target: { value: 'zzz' } })

    expect(screen.getByText(/Nothing matches/)).toBeTruthy()
  })

  it('puts the caret in the filter box on Ctrl+F', () => {
    open()

    fireEvent.keyDown(screen.getByLabelText('Sandbox image'), { key: 'f', ctrlKey: true })

    expect(document.activeElement).toBe(screen.getByLabelText('Filter settings'))
  })

  it('opens on the page a deep link named', () => {
    open({ page: 'burns' })

    expect(screen.getByRole('button', { name: 'Burns' }).getAttribute('aria-current')).toBe(
      'page',
    )
    expect(screen.getByRole('heading', { name: 'Burns' })).toBeTruthy()
  })

  it('scrolls to and flashes the field a deep link named', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    open({ page: 'general', field: 'sandboxImage' })

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
    const row = screen.getByLabelText('Sandbox image').closest('div.border-b')
    expect(row?.className).toContain('outline-accent')
    // The rows the link did not name are left alone.
    expect(screen.getByLabelText('Server port').closest('div.border-b')?.className).not.toContain(
      'outline-accent',
    )
  })
})
