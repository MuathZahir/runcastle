// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
      phoneLink: { status: { setData: () => undefined } },
    }),
    // General's "On your phone". It has its own suite (`settings-phone-link.test.tsx`).
    phoneLink: {
      status: {
        useQuery: () => ({
          data: { tailscale: 'running', on: false, commands: [] },
          isLoading: false,
          error: null,
        }),
      },
      turnOn: { useMutation: () => ({ isPending: false, mutate: () => undefined }) },
      turnOff: { useMutation: () => ({ isPending: false, mutate: () => undefined }) },
    },
    setup: {
      doctor: { useQuery: () => ({ data: undefined, isLoading: true, error: null }) },
    },
    // "This project" reads the preparation findings for its provenance chips.
    // What they say has its own suite (`settings-project.test.tsx`).
    project: {
      prep: { useQuery: () => ({ data: { findings: [] }, isLoading: false }) },
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
      refreshModels: {
        useMutation: () => ({ isPending: false, error: null, mutate: () => undefined }),
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

/**
 * General's three fields, plus the retired sandbox keys an older server still
 * sends — which no page may render.
 */
const globalFields = (over: Partial<SettingField> = {}): SettingField[] => [
  field({ key: 'serverPort', value: 4512, restartRequired: true, ...over }),
  field({ key: 'sandbox', value: 'docker' }),
  field({ key: 'sandboxImage', value: '' }),
  field({ key: 'burnCpus', value: null }),
  field({ key: 'sessionMcp', value: 'inherit' }),
  field({ key: 'burnConcurrency', value: 3, source: 'default' }),
]

const projectFields: SettingField[] = [
  field({ key: 'model', value: 'claude-opus-5', scope: 'project', source: 'file' }),
  field({ key: 'devCommand', value: 'bun dev', scope: 'project' }),
]

/** The class that fixes the panel's height — where the scroll chain starts. */
const FRAME_HEIGHT = 'h-[min(720px,84vh)]'

const classes = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/)

/**
 * Every element between the scrolling body and the fixed-height frame, or
 * `null` if walking up never reaches the frame at all.
 */
function heightChain(from: Element): Element[] | null {
  const chain: Element[] = []
  for (let el: Element | null = from; el; el = el.parentElement) {
    if (classes(el).includes(FRAME_HEIGHT)) return chain
    chain.push(el)
  }
  return null
}

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

  it('opens as a labelled xl dialog with the three pages and a filter', () => {
    open()

    const panel = screen.getByRole('dialog')
    expect(panel.getAttribute('aria-label')).toBe('Settings')
    expect(panel.className).toContain('max-w-[940px]')
    for (const name of ['General', 'Models', 'This project']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
    expect(screen.queryByRole('button', { name: /Sandboxes/ })).toBeNull()
    expect(screen.getByLabelText('Filter settings')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'General' }).getAttribute('aria-current')).toBe(
      'page',
    )
    // The rail names the project whose page sits at the bottom of it.
    expect(screen.getByText('runcastle')).toBeTruthy()
  })

  /**
   * The rail is three buttons over one piece of state — no address, no anchor,
   * nothing the browser acts on. Each one has to reach its own page from any
   * other, which is what "Burns is unreachable" was a report of: the header, the
   * `aria-current` and the body all move together, and the dialog stays open.
   */
  it('reaches every page from every other, in place', () => {
    open()

    const pages = ['General', 'Models', 'This project']
    for (const from of pages) {
      for (const to of pages) {
        fireEvent.click(screen.getByRole('button', { name: from }))
        fireEvent.click(screen.getByRole('button', { name: to }))

        expect(screen.getByRole('dialog')).toBeTruthy()
        expect(screen.getByRole('heading', { name: to })).toBeTruthy()
        // One page is current, and it is the one just asked for.
        const current = pages.filter(
          (p) => screen.getByRole('button', { name: p }).getAttribute('aria-current') === 'page',
        )
        expect(current).toEqual([to])
      }
    }
  })

  /**
   * The panel's height is fixed, so exactly one element under it may scroll: the
   * body beside the rail, whichever page is in it. Nothing here can measure a
   * scroll — happy-dom lays nothing out — so what is asserted is the chain that
   * decides it. A grid item's automatic minimum size is its content, and a
   * `minmax(0,1fr)` row under an indefinite height resolves to its item's
   * max-content contribution, so ONE intermediate element without `min-h-0`
   * grows the frame to the whole page's height instead of bounding it: the body
   * is then exactly as tall as its content and never scrolls, and the panel's
   * `overflow-hidden` cuts off everything past 700px — which is how every page
   * lost its last control with no way to reach past it.
   */
  it('scrolls one shared body on every page, with room past the last control', () => {
    open()
    const panel = screen.getByRole('dialog')
    const bodies = new Set<Element>()

    for (const page of ['General', 'Models', 'This project']) {
      fireEvent.click(screen.getByRole('button', { name: page }))

      // One page scroller, not one per page and not a second one nested inside
      // it. Mapped to class lists so an unexpected one names itself here.
      const scrollers = [...panel.querySelectorAll('*')].filter((el) =>
        classes(el).includes('overflow-y-auto'),
      )
      expect(scrollers.map((el) => el.getAttribute('class'))).toHaveLength(1)
      const body = scrollers[0]!
      bodies.add(body)

      // Room under the last control, or it sits flush against the bottom edge.
      expect(classes(body).some((c) => /^pb-\d/.test(c))).toBe(true)

      const chain = heightChain(body)
      expect(chain, `${page}: the body is not inside the fixed-height frame`).not.toBeNull()
      for (const el of chain!) {
        expect(classes(el), `${page}: ${el.tagName} may not shrink`).toContain('min-h-0')
      }
    }

    // The same container throughout — one scroll position and one set of
    // paddings, not a fresh one per page.
    expect(bodies.size).toBe(1)
  })

  it('renders General as its named fields, each with its explanation beneath its label, and no sandbox rows', () => {
    open()

    expect(screen.getByLabelText('Server port')).toBeTruthy()
    expect(screen.getByLabelText('MCP servers in chats')).toBeTruthy()
    expect(screen.queryByLabelText('Sandbox')).toBeNull()
    expect(screen.queryByLabelText('Sandbox image')).toBeNull()
    expect(screen.queryByText(/CPU/)).toBeNull()

    // The explanation is the row's description: one quiet line under the
    // label, and the control's accessible description — no hover to find it.
    const about = screen.getByText(/Workers mid-turn at once across the machine/)
    expect(about.className).toContain('text-text-tertiary')
    expect(
      screen.getByLabelText('Agents working at once').getAttribute('aria-describedby'),
    ).toContain(about.id)
  })

  // The one worker number moved here from the retired Sandboxes page, under a
  // Workers heading of its own.
  it('shows how many workers run at once on General, under Workers', () => {
    open()

    const width = screen.getByLabelText('Agents working at once') as HTMLInputElement
    // Unset, so the default shows as a ghost to type over.
    expect(width.value).toBe('')
    expect(width.getAttribute('placeholder')).toBe('3')
    expect(screen.getByText('Workers')).toBeTruthy()
    expect(screen.getByText(/^workers at once/)).toBeTruthy()
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

    const width = screen.getByLabelText('Agents working at once')
    fireEvent.change(width, { target: { value: '4' } })
    fireEvent.blur(width)

    expect(server.updates).toEqual([{ key: 'burnConcurrency', value: 4 }])
    expect(screen.getByText('Saved')).toBeTruthy()
  })

  it('shows the server’s refusal beside the field and snaps the draft back', () => {
    server.reject = 'burnConcurrency must be 1–8'
    open()

    const width = screen.getByLabelText('Agents working at once') as HTMLInputElement
    fireEvent.change(width, { target: { value: '99' } })
    fireEvent.blur(width)

    expect(screen.getByRole('alert').textContent).toBe('burnConcurrency must be 1–8')
    expect(width.value).toBe('')
    expect(screen.queryByText('Saved')).toBeNull()

    // It stays until the next edit — which is the answer to it.
    fireEvent.change(width, { target: { value: '4' } })
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

    fireEvent.change(screen.getByLabelText('Filter settings'), { target: { value: 'concurrency' } })

    expect(screen.getByLabelText('Agents working at once')).toBeTruthy()
    expect(screen.queryByLabelText('Server port')).toBeNull()
    // The group heading goes with its rows rather than standing over nothing.
    expect(screen.queryByText('Server')).toBeNull()
    expect(screen.getByRole('button', { name: /General/ }).textContent).toContain('1')
  })

  it('finds the phone link by what a reader calls it', () => {
    open()
    expect(screen.getByText('On your phone')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Filter settings'), { target: { value: 'tailscale' } })
    expect(screen.getByText('On your phone')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Filter settings'), { target: { value: 'concurrency' } })
    expect(screen.queryByText('On your phone')).toBeNull()
  })

  // The usage ping's switch stores 'on'/'off', not a boolean, and an unset
  // value is the default (on) — so the switch reads it and writes the word.
  it('turns the usage ping off and on from General, writing the setting’s words', () => {
    server.globals = view([...globalFields(), field({ key: 'usageSignal', value: null, source: 'default' })])
    open()

    const ping = screen.getByRole('switch', { name: 'Usage ping' })
    expect(ping.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(ping)
    expect(server.updates).toEqual([{ key: 'usageSignal', value: 'off' }])

    cleanup()
    server.updates = []
    server.globals = view([...globalFields(), field({ key: 'usageSignal', value: 'off' })])
    open()
    const off = screen.getByRole('switch', { name: 'Usage ping' })
    expect(off.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(off)
    expect(server.updates).toEqual([{ key: 'usageSignal', value: 'on' }])
  })

  it.each(['telemetry', 'ping', 'privacy'])('finds the usage ping by “%s”', (query) => {
    server.globals = view([...globalFields(), field({ key: 'usageSignal', value: 'on' })])
    open()

    fireEvent.change(screen.getByLabelText('Filter settings'), { target: { value: query } })
    expect(screen.getByRole('switch', { name: 'Usage ping' })).toBeTruthy()
    expect(screen.queryByLabelText('Agents working at once')).toBeNull()
  })

  it('moves to the first page with hits when the open one has none', () => {
    open({ page: 'models' })

    fireEvent.change(screen.getByLabelText('Filter settings'), {
      target: { value: 'concurrency' },
    })

    expect(screen.getByRole('button', { name: /General/ }).getAttribute('aria-current')).toBe(
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

    fireEvent.keyDown(screen.getByLabelText('Server port'), { key: 'f', ctrlKey: true })

    expect(document.activeElement).toBe(screen.getByLabelText('Filter settings'))
  })

  it('opens on the page a deep link named', () => {
    open({ page: 'models' })

    expect(screen.getByRole('button', { name: 'Models' }).getAttribute('aria-current')).toBe(
      'page',
    )
    expect(screen.getByRole('heading', { name: 'Models' })).toBeTruthy()
  })

  it('scrolls to and flashes the field a deep link named', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    open({ page: 'general', field: 'burnConcurrency' })

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
    const row = screen.getByLabelText('Agents working at once').closest('div.border-b')
    expect(row?.className).toContain('outline-accent')
    // The rows the link did not name are left alone.
    expect(screen.getByLabelText('Server port').closest('div.border-b')?.className).not.toContain(
      'outline-accent',
    )
  })

  /**
   * `theme.css` imports Tailwind without preflight on purpose, so a `<button>`
   * that names nothing would keep Chrome's `buttonface` background and 2px
   * outset border: a light-grey pill with near-invisible text on this dark
   * theme. That is what the rail's pages, every ⓘ and the close ✕ used to render
   * as. The dialog's buttons are all primitives now, and the base layer resets
   * a raw button — so what is asserted is that no button here is left to the
   * user agent: each is a primitive (it carries its own ground) or sits on the
   * base reset, and none names a retired class the legacy sheet would restyle.
   */
  it('leaves no button to the browser’s own paint', () => {
    server.globals = view([
      ...globalFields(),
      field({ key: 'model', value: 'claude-opus-5' }),
      field({ key: 'models', value: [{ id: 'my-proxy', runtime: 'codex', note: 'a spare' }] }),
      field({ key: 'stepModels.implement', value: 'my-proxy' }),
    ])
    server.scoped = view(
      projectFields.map((f) => (f.key === 'model' ? { ...f, source: 'project' } : f)),
    )
    open()

    const theme = readFileSync(join(__dirname, '../src/theme.css'), 'utf8')
    expect(theme).toMatch(/@layer base\s*{[\s\S]*?\bbutton\s*{[\s\S]*?background:\s*none/)

    const retired: string[] = []
    for (const page of ['General', 'Models', 'This project']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(page) }))
      for (const button of screen.getAllByRole('button')) {
        if (/(?:^| )(?:btn|chip|settings-)/.test(button.className))
          retired.push(`${page} / ${button.getAttribute('aria-label') ?? button.textContent}`)
      }
    }
    expect(retired).toEqual([])
  })
})
