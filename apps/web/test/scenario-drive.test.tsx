// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveScenario, ScenarioEntry } from '@runcastle/core'
import { openMenu } from './floating'

/**
 * A running drive's scenarios (drive-scenarios decisions 3, 7, 8): the Scenario
 * menu runs one against the live drive, the panel follows each landing, a
 * failure shows its actual error with Fix it, and ＋ New scenario docks the
 * scenario chat beside the panel. Tier 2: menus are portals and the dock opens
 * and closes on clicks and on the session ending.
 *
 * The server is the boundary: the scenario list, and the two mutations, whose
 * calls are what is asserted.
 */
const SCENARIOS: ScenarioEntry[] = [
  { file: '.runcastle/scenarios/checkout/expired-coupon.ts', name: 'Expired coupon', group: 'Checkout', own: true },
  { file: '.runcastle/scenarios/auth/signed-out.ts', name: 'Signed out', group: 'Auth', own: false },
]
const runScenario = vi.fn()
const openScenarioChat = vi.fn()

vi.mock('../src/trpc', () => ({
  trpc: {
    useUtils: () => ({
      feature: { driveInfo: { invalidate: vi.fn() } },
      notes: { list: { invalidate: vi.fn() } },
    }),
    notes: { add: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
    feature: {
      driveScenarios: { useQuery: () => ({ data: { runnerConfigured: true, scenarios: SCENARIOS } }) },
      runScenario: {
        useMutation: () => ({ isPending: false, mutate: (input: unknown) => runScenario(input) }),
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

function mount(scenario?: DriveScenario, scenarioSessionId?: string) {
  const el = (s?: DriveScenario, sid?: string) => (
    <ScenarioDrive
      projectId="proj_1"
      featureId="feat_1"
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

  it('names the current scenario and lists This feature, the others, Blank app and New scenario', () => {
    mount(landed('l1'))
    openMenu(screen.getByRole('button', { name: /Scenario: Expired coupon/ }))

    const menu = screen.getByRole('menu')
    expect(menu.textContent).toContain('This feature')
    expect(menu.textContent).toContain('Other scenarios')
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Expired couponCheckout',
      'Signed outAuth',
      'Blank app',
      'New scenario',
    ])
  })

  it('runs the scenario picked against the live drive', () => {
    mount()
    openMenu(screen.getByRole('button', { name: 'Scenario' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Signed out/ }))
    expect(runScenario).toHaveBeenCalledWith({ projectId: 'proj_1', file: SCENARIOS[1]!.file })
  })

  it('goes back to the plain URL on Blank app', () => {
    mount(landed('l1'))
    expect(frame().getAttribute('src')).toBe(`${DEV}#cart`)
    openMenu(screen.getByRole('button', { name: /Scenario: Expired coupon/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Blank app' }))
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

  it('opens the scenario chat on that file from Fix it, and docks it', () => {
    mount(failed)
    fireEvent.click(screen.getByRole('button', { name: 'Fix it' }))
    expect(openScenarioChat).toHaveBeenCalledWith({ projectId: 'proj_1', fixFile: SCENARIOS[0]!.file })
    expect(screen.getByRole('complementary', { name: 'Scenario chat' })).toBeTruthy()
  })
})

describe('the docked scenario chat', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  const dock = () => screen.queryByRole('complementary', { name: 'Scenario chat' })

  it('opens from New scenario beside the panel', () => {
    mount()
    expect(dock()).toBeNull()
    openMenu(screen.getByRole('button', { name: 'Scenario' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'New scenario' }))

    expect(openScenarioChat).toHaveBeenCalledWith({ projectId: 'proj_1' })
    expect(dock()?.textContent).toContain('New scenario · Describe the state you want to land in')
    expect(dock()?.querySelector('[data-terminal="sess_scn"]')).toBeTruthy()
  })

  it('docks the drive’s live scenario session, hides on close, and reopens from New scenario', () => {
    mount(undefined, 'sess_live')
    expect(dock()?.querySelector('[data-terminal="sess_live"]')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Hide the scenario chat' }))
    expect(dock()).toBeNull()

    openMenu(screen.getByRole('button', { name: 'Scenario' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'New scenario' }))
    expect(dock()).toBeTruthy()
  })

  it('closes when the session ends', () => {
    mount(undefined, 'sess_live')
    fireEvent.click(dock()!.querySelector('[data-terminal]')!)
    expect(dock()).toBeNull()
  })
})
