// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveScenario } from '@runcastle/core'
import type { FeatureFull } from '../src/lib/api'
import { openMenu } from './floating'

/**
 * The scenario chat in the chat column (design-mode decision 9): a drive
 * errand opens it there, the switcher lists it beside the feature chat, and
 * picking, closing or the session ending hands the column back — with both
 * terminals kept mounted so xterm keeps its buffers. The drive keeps the whole
 * panel.
 *
 * Tier 2: the switcher is a portalled menu, and every assertion is about what
 * a click did. The seam is the column the feature page assembles: its hook, the
 * switcher, the scenario chat view and the drive that opens it. The server is
 * the boundary: `openScenarioChat` answers with the errand's session.
 */
vi.mock('../src/trpc', () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })
  return {
    trpc: {
      useUtils: () => ({
        feature: { driveInfo: { invalidate: vi.fn() }, get: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } },
      }),
      notes: { add: { useMutation: mutation } },
      feature: {
        driveScenarios: { useQuery: () => ({ data: { runnerConfigured: true, scenarios: [] } }) },
        runScenario: { useMutation: mutation },
        endSession: { useMutation: mutation },
        openScenarioChat: {
          useMutation: (opts: { onSuccess: (r: { sessionId: string }) => void }) => ({
            isPending: false,
            mutate: () => opts.onSuccess({ sessionId: 'sess_scn' }),
          }),
        },
      },
    },
  }
})
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: vi.fn() }) }))
// The terminal is a websocket client; the stand-in names its session and ends
// it on a click, which is all the column reads from it.
vi.mock('../src/components/TerminalView', async () => {
  const { createElement } = await import('react')
  return {
    TerminalView: (props: { sessionId: string; onEnded?: () => void }) =>
      createElement('div', { 'data-terminal': props.sessionId, onClick: props.onEnded }),
  }
})

// The live session's notices read the event log; nothing here is about them.
vi.mock('../src/components/chat/SessionNotices', () => ({ SessionNotices: () => null }))

const { FeatureChat } = await import('../src/components/workspace/FeatureChat')
const { ScenarioChatContext, ScenarioChatView } = await import('../src/components/chat/ScenarioChat')
const { FeatureSessionSwitcher } = await import('../src/components/chat/FeatureSessionSwitcher')
const { useFeatureChatColumn } = await import('../src/components/chat/use-feature-chat-column')
const { ScenarioDrive } = await import('../src/components/review/ScenarioDrive')
const { FEATURE_CHAT } = await import('../src/lib/chat-sessions')

const FAILED: DriveScenario = {
  file: '.runcastle/scenarios/checkout/expired-coupon.ts',
  name: 'Expired coupon',
  status: 'failed',
  failure: { reason: 'exit', exitCode: 1, outputTail: 'boom' },
}

type Session = FeatureFull['sessions'][number]
const session = (id: string, kind: Session['kind']): Session =>
  ({ id, kind, status: 'live', lap: 1, headless: false, awaitingInput: false, worktreePath: '/wt' }) as Session
const FEATURE_LIVE = [session('sess_feat', 'chat')]

/** The feature page's column beside its drive panel, as the page assembles them. */
function Page({
  sessions = FEATURE_LIVE,
  driveSessionId,
  scenario,
}: {
  sessions?: Session[]
  driveSessionId?: string
  scenario?: DriveScenario
}) {
  const column = useFeatureChatColumn({ sessions, driveSessionId })
  const full = { feature: { id: 'feat_1' }, sessions, tickets: [] } as unknown as FeatureFull
  return (
    <ScenarioChatContext.Provider value={column.scenario}>
      <header>
        <FeatureSessionSwitcher column={column} featureId="feat_1" liveSessionId="sess_feat" />
      </header>
      <div data-column="">
        <FeatureChat
          full={full}
          events={[]}
          hidden={column.inFront !== FEATURE_CHAT}
          launching={false}
          onLaunch={() => {}}
          onView={() => {}}
        />
        <ScenarioChatView chat={column.scenario} hidden={column.inFront !== column.scenario.sessionId} />
      </div>
      <div data-panel="">
        <ScenarioDrive
          projectId="proj_1"
          featureId="feat_1"
          drive={{ devUrl: 'about:blank', ...(scenario ? { scenario } : {}) }}
        />
      </div>
    </ScenarioChatContext.Provider>
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const shown = (el: Element): boolean => el.closest('[hidden], .hidden') === null
const terminal = (id: string): Element => document.querySelector(`[data-terminal="${id}"]`)!
/** The page header's one switcher (design-mode decision 12). */
const switcher = (): HTMLElement => screen.getByRole('button', { name: 'Chat session' })
const options = (): string[] => {
  openMenu(switcher())
  const labels = screen.getAllByRole('menuitemradio').map((o) => o.textContent ?? '')
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
  return labels
}
/** Pick a session, or one of the menu's actions, from the switcher. */
const pick = (name: string): void => {
  openMenu(switcher())
  fireEvent.click(screen.getByRole('menuitemradio', { name }))
}
const menuAction = (name: string): void => {
  openMenu(switcher())
  fireEvent.click(screen.getByRole('menuitem', { name }))
}
const newScenario = (): void => {
  openMenu(screen.getByRole('button', { name: 'Scenario' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'New scenario' }))
}

describe('the chat column’s session switcher', () => {
  it('lists the feature chat alone while no errand is live', () => {
    render(<Page />)
    expect(switcher().textContent).toContain('Feature chat')
    expect(options()).toEqual(['Feature chat'])
  })

  it('switches the column to the scenario chat an errand opens, and lists it', () => {
    render(<Page />)
    newScenario()

    expect(shown(terminal('sess_scn'))).toBe(true)
    expect(shown(terminal('sess_feat'))).toBe(false)
    expect(switcher().textContent).toContain('Scenario chat · New scenario')
    expect(options()).toEqual(['Feature chat', 'Scenario chat · New scenario'])
    // The drive keeps the panel: no chat is docked inside it.
    const panel = document.querySelector('[data-panel]') as HTMLElement
    expect(panel.querySelector('[data-terminal]')).toBeNull()
    expect(within(panel).getByTitle('the app on this branch')).toBeTruthy()
  })

  it('names a Fix it errand by its scenario', () => {
    render(<Page scenario={FAILED} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fix it' }))
    expect(switcher().textContent).toContain('Scenario chat · Fix Expired coupon')
  })

  it('switches back on picking the feature chat, keeping both terminals mounted', () => {
    render(<Page />)
    newScenario()
    pick('Feature chat')

    expect(shown(terminal('sess_feat'))).toBe(true)
    // hidden, never unmounted: xterm keeps its buffer
    expect(terminal('sess_scn')).toBeTruthy()
    expect(shown(terminal('sess_scn'))).toBe(false)

    pick('Scenario chat · New scenario')
    expect(shown(terminal('sess_scn'))).toBe(true)
    expect(terminal('sess_feat')).toBeTruthy()
  })

  it('switches back when the errand is closed, and New scenario brings the same chat back', () => {
    render(<Page />)
    newScenario()
    menuAction('Close the scenario chat')

    expect(shown(terminal('sess_feat'))).toBe(true)
    expect(options()).toEqual(['Feature chat'])

    newScenario()
    expect(shown(terminal('sess_scn'))).toBe(true)
  })

  it('holds End session and the one-transcript note in its menu, where the chat header row was', () => {
    render(<Page />)
    openMenu(switcher())
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'End session' })).toBeTruthy()
    expect(menu.textContent).toContain('One transcript per feature')
    expect(document.querySelector('[data-column]')?.textContent).not.toContain('End session')
  })

  it('speaks for the scenario chat while it is in front: its errand, its close and End session', () => {
    render(<Page />)
    newScenario()
    openMenu(switcher())
    const menu = screen.getByRole('menu')
    expect(menu.textContent).toContain('Describe the state you want to land in')
    expect(within(menu).getByRole('menuitem', { name: 'Close the scenario chat' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: 'End session' })).toBeTruthy()
  })

  it('lists a scenario chat the live drive already has, without taking the column', () => {
    render(<Page driveSessionId="sess_live" />)
    expect(shown(terminal('sess_feat'))).toBe(true)
    expect(terminal('sess_live')).toBeTruthy()
    expect(options()).toEqual(['Feature chat', 'Scenario chat · New scenario'])
  })

  it('drops the scenario chat once its session ends', () => {
    render(<Page />)
    newScenario()
    fireEvent.click(terminal('sess_scn'))

    expect(document.querySelector('[data-terminal="sess_scn"]')).toBeNull()
    expect(shown(terminal('sess_feat'))).toBe(true)
    expect(options()).toEqual(['Feature chat'])
  })
})

/**
 * design-mode ticket 12: the scenario session is a row of the feature's own
 * sessions too. It used to be picked up as the feature's live session, so the
 * switcher offered "Scenario" in the feature chat's place, and the Agent region
 * mounted a second, 0×0 terminal on the errand's session.
 */
describe('the column with a live scenario session among the feature’s sessions', () => {
  const terminals = (id: string): number => document.querySelectorAll(`[data-terminal="${id}"]`).length

  it('lists Feature chat and the errand’s chat, not the errand twice', () => {
    render(<Page sessions={[session('sess_live', 'scenario')]} driveSessionId="sess_live" />)
    expect(options()).toEqual(['Feature chat', 'Scenario chat · New scenario'])
  })

  it('shows each session’s own terminal, one per session id', () => {
    render(<Page sessions={[session('sess_live', 'scenario')]} driveSessionId="sess_live" />)
    expect(terminals('sess_live')).toBe(1)
    // The feature chat, with nothing of its own up, offers its own launch.
    const agent = screen.getByRole('region', { name: 'Agent', hidden: true })
    expect(agent.querySelector('[data-terminal]')).toBeNull()

    pick('Scenario chat · New scenario')
    expect(shown(terminal('sess_live'))).toBe(true)
    expect(terminals('sess_live')).toBe(1)
  })

  it('keeps the feature’s own live chat beside it, each in its own terminal', () => {
    render(<Page sessions={[session('sess_live', 'scenario'), session('sess_feat', 'chat')]} driveSessionId="sess_live" />)
    expect(options()).toEqual(['Feature chat', 'Scenario chat · New scenario'])
    expect(terminals('sess_feat')).toBe(1)
    expect(terminals('sess_live')).toBe(1)
    expect(shown(terminal('sess_feat'))).toBe(true)
  })
})
