// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveCallResult, DriveScenario, ScenarioEntry } from '@runcastle/core'
import { openList } from './floating'

/**
 * A running drive's scenarios (drive-scenarios decisions 3, 7, 8): the Scenario
 * menu runs one against the live drive, the panel follows each landing, a
 * failure shows its actual error with Fix it, and ＋ New scenario opens the
 * scenario chat — in the page's chat column, never beside the panel. Tier 2:
 * menus are portals.
 *
 * The server is the boundary: the scenario list, and the two mutations, whose
 * calls are what is asserted.
 */
const SCENARIOS: ScenarioEntry[] = [
  { file: '.runcastle/scenarios/checkout/expired-coupon.ts', name: 'Expired coupon', group: 'Checkout', own: true, hasCall: false },
  { file: '.runcastle/scenarios/auth/signed-out.ts', name: 'Signed out', group: 'Auth', own: false, hasCall: false },
]
const CALL: ScenarioEntry = {
  file: '.runcastle/scenarios/feed/blocked-only.ts',
  name: 'Blocked only',
  group: 'Feed',
  own: false,
  hasCall: true,
}
// What the drive lists; a test swaps it before mounting.
let listed: ScenarioEntry[] = SCENARIOS
const runScenario = vi.fn()
const openScenarioChat = vi.fn()
const sendCall = vi.fn()
const SENT: DriveCallResult = {
  ok: true,
  status: 201,
  statusText: 'Created',
  durationMs: 42,
  headers: [['content-type', 'application/json']],
  body: '{"id":7,"blocked":true}',
  truncated: false,
}

vi.mock('../src/trpc', () => ({
  trpc: {
    useUtils: () => ({
      feature: { driveInfo: { invalidate: vi.fn() } },
      notes: { list: { invalidate: vi.fn() } },
    }),
    notes: { add: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
    feature: {
      driveScenarios: { useQuery: () => ({ data: { runnerConfigured: true, scenarios: listed } }) },
      runScenario: {
        useMutation: () => ({ isPending: false, mutate: (input: unknown) => runScenario(input) }),
      },
      sendCall: {
        useMutation: () => ({
          isPending: false,
          mutate: (input: unknown, opts?: { onSuccess?: (r: DriveCallResult) => void }) => {
            sendCall(input)
            opts?.onSuccess?.(SENT)
          },
        }),
      },
      openScenarioChat: {
        useMutation: (opts: { onSuccess: (r: { sessionId: string }) => void }) => ({
          isPending: false,
          mutate: (input: unknown) => {
            openScenarioChat(input)
            opts.onSuccess({ sessionId: 'sess_scn' })
          },
        }),
      },
    },
  },
}))
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: vi.fn() }) }))
// The terminal is a websocket client; the stand-in names its session and ends
// it on a click, which is all the dock reads from it.
vi.mock('../src/components/TerminalView', async () => {
  const { createElement } = await import('react')
  return {
    TerminalView: (props: { sessionId: string; onEnded?: () => void }) =>
      createElement('div', { 'data-terminal': props.sessionId, onClick: props.onEnded }),
  }
})

const { ScenarioDrive } = await import('../src/components/review/ScenarioDrive')

const DEV = 'about:blank'

const onToChat = vi.fn()

function mount(scenario?: DriveScenario, scenarioSessionId?: string) {
  const el = (s?: DriveScenario, sid?: string) => (
    <ScenarioDrive
      projectId="proj_1"
      featureId="feat_1"
      onToChat={onToChat}
      drive={{ devUrl: DEV, ...(s ? { scenario: s } : {}), ...(sid ? { scenarioSessionId: sid } : {}) }}
    />
  )
  const view = render(el(scenario, scenarioSessionId))
  return { rerender: (s?: DriveScenario, sid?: string) => view.rerender(el(s, sid)) }
}

const frame = () => screen.getByTitle('the app on this branch') as HTMLIFrameElement
const landed = (landingId: string): DriveScenario => ({
  file: SCENARIOS[0]!.file,
  name: 'Expired coupon',
  status: 'landed',
  entryUrl: `${DEV}#cart`,
  landingId,
})

describe('the running drive’s Scenario menu', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('sits in the drive’s one toolbar row above the app, which nothing overlaps', () => {
    mount(landed('l1'))
    const [bar, ...more] = screen.getAllByRole('toolbar')
    expect(more).toHaveLength(0)
    expect(bar!.contains(screen.getByRole('button', { name: /Expired coupon/ }))).toBe(true)
    expect(bar!.contains(screen.getByRole('button', { name: 'Reload' }))).toBe(true)
    expect(frame().parentElement!.contains(bar!)).toBe(false)
    // Nothing but the selection layers is placed over the frame.
    expect(frame().parentElement!.querySelectorAll('button, a, [role="combobox"]')).toHaveLength(0)
  })

  it('names the current scenario and lists This feature, the others, Blank app and New scenario', () => {
    mount(landed('l1'))
    expect(openList(screen.getByRole('button', { name: /Expired coupon/ }))).toEqual([
      'Expired coupon',
      'Signed out',
      'Blank app',
      'New scenario',
    ])
    const list = screen.getByRole('listbox')
    expect(list.textContent).toContain('This feature')
    expect(list.textContent).toContain('Auth')
  })

  it('runs the scenario picked against the live drive', () => {
    mount()
    openList(screen.getByRole('button', { name: /Blank app/ }))
    fireEvent.click(screen.getByRole('option', { name: /Signed out/ }))
    expect(runScenario).toHaveBeenCalledWith({ projectId: 'proj_1', file: SCENARIOS[1]!.file })
  })

  it('goes back to the plain URL on Blank app', () => {
    mount(landed('l1'))
    expect(frame().getAttribute('src')).toBe(`${DEV}#cart`)
    openList(screen.getByRole('button', { name: /Expired coupon/ }))
    fireEvent.click(screen.getByRole('option', { name: 'Blank app' }))
    expect(frame().getAttribute('src')).toBe(DEV)
    expect(runScenario).not.toHaveBeenCalled()
  })
})

describe('landing', () => {
  afterEach(cleanup)

  it('shows the live output while a scenario runs, on the plain URL', () => {
    mount({ file: SCENARIOS[0]!.file, name: 'Expired coupon', status: 'running', output: 'seeding buyer_7f3a' })
    expect(screen.getByRole('status').textContent).toContain('Running Expired coupon…')
    expect(screen.getByText('seeding buyer_7f3a')).toBeTruthy()
    expect(frame().getAttribute('src')).toBe(DEV)
  })

  it('navigates to the entry URL and reloads on a repeat landing at the same URL', () => {
    const { rerender } = mount(landed('l1'))
    const first = frame()
    expect(first.getAttribute('src')).toBe(`${DEV}#cart`)

    rerender(landed('l1'))
    expect(frame()).toBe(first)
    rerender(landed('l2'))
    expect(frame()).not.toBe(first)
    expect(frame().getAttribute('src')).toBe(`${DEV}#cart`)
  })
})

describe('a failed scenario', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  const failed: DriveScenario = {
    file: SCENARIOS[0]!.file,
    name: 'Expired coupon',
    status: 'failed',
    failure: { reason: 'exit', exitCode: 1, outputTail: 'TypeError: Coupon.create: unknown field "expiresAt"' },
  }

  it('shows which scenario, why and its output, with the app left on its plain URL', () => {
    mount(failed)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Scenario “Expired coupon” failed: exit 1')
    expect(alert.textContent).toContain('TypeError: Coupon.create: unknown field "expiresAt"')
    expect(frame().getAttribute('src')).toBe(DEV)
  })

  it('opens the scenario chat on that file from Fix it, and goes to the chat page for it', () => {
    mount(failed)
    fireEvent.click(screen.getByRole('button', { name: 'Fix it' }))
    expect(onToChat).toHaveBeenCalledTimes(1)
    expect(openScenarioChat).toHaveBeenCalledWith({ projectId: 'proj_1', fixFile: SCENARIOS[0]!.file })
    // The chat is the page's chat column's (design-mode decision 9), never an
    // aside inside the drive — chat-column.test covers where it lands.
    expect(screen.queryByRole('complementary', { name: 'Scenario chat' })).toBeNull()
    expect(document.querySelector('[data-terminal]')).toBeNull()
  })
})

describe('the API view', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    listed = SCENARIOS
  })

  const toggle = () => screen.queryByRole('radiogroup', { name: 'Drive view' })
  const field = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement
  const landedCall = (landingId: string, body = '{"blocked":true}'): DriveScenario => ({
    file: CALL.file,
    name: CALL.name,
    status: 'landed',
    entryUrl: DEV,
    landingId,
    token: 't0k',
    call: {
      method: 'POST',
      url: 'http://localhost:5173/api/feed',
      headers: [['Authorization', 'Bearer t0k']],
      body,
    },
  })

  it('offers App | API only when some scenario has a call, App first, with the app left mounted', () => {
    mount()
    expect(toggle()).toBeNull()
    cleanup()

    listed = [...SCENARIOS, CALL]
    mount()
    expect(screen.getByRole('radio', { name: 'App' }).getAttribute('aria-checked')).toBe('true')
    const app = frame()
    fireEvent.click(screen.getByRole('radio', { name: 'API' }))
    expect(screen.getByRole('navigation', { name: 'Calls' }).textContent).toContain('Blocked only')
    expect(screen.queryByRole('button', { name: /Signed out/ })).toBeNull()
    expect(frame()).toBe(app)

    fireEvent.click(screen.getAllByRole('radio', { name: 'App' })[0]!)
    expect(screen.queryByRole('navigation', { name: 'Calls' })).toBeNull()
    expect(frame()).toBe(app)
  })

  it('runs the picked call’s scenario, fills its request, and sends the edit with Try it', () => {
    listed = [...SCENARIOS, CALL]
    const { rerender } = mount()
    fireEvent.click(screen.getByRole('radio', { name: 'API' }))
    fireEvent.click(screen.getByRole('button', { name: /Blocked only/ }))
    expect(runScenario).toHaveBeenCalledWith({ projectId: 'proj_1', file: CALL.file })

    rerender(landedCall('l1'))
    expect(field('URL').value).toBe('http://localhost:5173/api/feed')
    expect(field('Header 1 name').value).toBe('Authorization')
    expect(field('Header 1 value').value).toBe('Bearer t0k')
    expect(field('Body').value).toBe('{"blocked":true}')

    fireEvent.change(field('Body'), { target: { value: '{"blocked":false}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Try it' }))
    expect(sendCall).toHaveBeenCalledWith({
      projectId: 'proj_1',
      request: {
        method: 'POST',
        url: 'http://localhost:5173/api/feed',
        headers: [['Authorization', 'Bearer t0k']],
        body: '{"blocked":false}',
      },
    })
    const response = screen.getByRole('region', { name: 'Response' })
    expect(response.textContent).toContain('201 Created')
    expect(response.textContent).toContain('42 ms')
    expect(response.querySelector('pre')?.textContent).toBe('{\n  "id": 7,\n  "blocked": true\n}')

    // Send again keeps the seeded state and the edit.
    fireEvent.click(screen.getByRole('button', { name: 'Send again' }))
    expect(sendCall).toHaveBeenCalledTimes(2)
    expect(sendCall.mock.calls[1]![0].request.body).toBe('{"blocked":false}')
    expect(runScenario).toHaveBeenCalledTimes(1)

    // Re-run reseeds, and the new landing discards the edit.
    fireEvent.click(screen.getByRole('button', { name: 'Re-run scenario' }))
    expect(runScenario).toHaveBeenCalledTimes(2)
    rerender(landedCall('l2'))
    expect(field('Body').value).toBe('{"blocked":true}')
    expect(screen.queryByRole('region', { name: 'Response' })).toBeNull()
  })

  it('shows a failed call scenario with Fix it', () => {
    listed = [...SCENARIOS, CALL]
    const { rerender } = mount()
    fireEvent.click(screen.getByRole('radio', { name: 'API' }))
    fireEvent.click(screen.getByRole('button', { name: /Blocked only/ }))
    rerender({ file: CALL.file, name: CALL.name, status: 'failed', failure: { reason: 'exit', exitCode: 2, outputTail: 'boom' } })

    expect(screen.getByRole('alert').textContent).toContain('Scenario “Blocked only” failed: exit 2')
    fireEvent.click(screen.getByRole('button', { name: 'Fix it' }))
    expect(openScenarioChat).toHaveBeenCalledWith({ projectId: 'proj_1', fixFile: CALL.file })
  })
})

describe('the Blank app nudge', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    listed = SCENARIOS
  })

  const nudge = () => screen.queryByText(/Setting this up by hand every time\?/)

  it('opens New scenario from its link on a project with no scenarios, and ✕ hides it', () => {
    listed = []
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Make it a scenario.' }))
    expect(openScenarioChat).toHaveBeenCalledWith({ projectId: 'proj_1' })

    fireEvent.click(screen.getByRole('button', { name: 'Hide this hint' }))
    expect(nudge()).toBeNull()
  })

  it('is absent once any scenario exists', () => {
    mount()
    expect(nudge()).toBeNull()
  })
})
