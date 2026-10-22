// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The panel's design view (design-mode spec, "The design loop" steps 4-5 and
 * "Stopping the design server"): the live preview in the drive's frame, the
 * server started from its recorded command when needed, a heartbeat while it
 * is on screen, and the stopped state once the server goes.
 *
 * Tier 2: what it does depends on effects over time. The tRPC hooks are the
 * boundary and are stubbed; what Select area sends is `drive-panel-target`'s.
 */

type Status = {
  running: boolean
  url?: string
  port?: number
  paneId?: string
  hasRecordedCommand: boolean
  lastPath?: string
  lastError?: string
}
let status: Status | undefined
let start: { isPending: boolean; isError: boolean; error: { message: string } | null }
let restart: { isPending: boolean }
const startMutate = vi.fn()
const restartMutate = vi.fn()
const heartbeat = vi.fn()
const showPath = vi.fn()

vi.mock('../src/trpc', () => ({
  trpc: {
    useUtils: () => ({ design: { status: { invalidate: vi.fn() } } }),
    design: {
      status: { useQuery: () => ({ data: status }) },
      start: { useMutation: () => ({ mutate: startMutate, ...start }) },
      restart: { useMutation: () => ({ mutate: restartMutate, ...restart }) },
      heartbeat: { useMutation: () => ({ mutate: heartbeat }) },
      showPath: { useMutation: () => ({ mutate: showPath }) },
    },
    notes: { add: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
  },
}))
vi.mock('../src/lib/live', () => ({ useLivePoll: () => 1500 }))
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: vi.fn() }) }))
vi.mock('../src/lib/reviews', () => ({ uploadScreenshot: vi.fn() }))
vi.mock('../src/lib/project-notes', () => ({ uploadProjectNoteScreenshot: vi.fn() }))
// The terminal websocket is a boundary: the stand-in shows which pane it streams.
vi.mock('../src/components/TerminalView', () => ({
  TerminalView: ({ sessionId }: { sessionId: string }) => <div data-testid="terminal">{sessionId}</div>,
}))

const { DesignView, DESIGN_HEARTBEAT_MS } = await import('../src/components/design/DesignView')

const RUNNING: Status = { running: true, url: 'http://localhost:30001/', port: 30001, hasRecordedCommand: true }

// The frame points at a dev server that is not there; nothing should try to load it.
;(window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } }).happyDOM.settings.disableIframePageLoading = true

let visibility: DocumentVisibilityState
beforeEach(() => {
  status = undefined
  start = { isPending: false, isError: false, error: null }
  restart = { isPending: false }
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  // A Chromium that can capture its own tab, so Select area is offered.
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getDisplayMedia: vi.fn() },
  })
  Object.defineProperty(navigator, 'userAgentData', { configurable: true, value: {} })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('DesignView', () => {
  it('shows the running server at its URL plus the path, under the drive toolbar', () => {
    status = RUNNING
    render(<DesignView featureId="f1" path="/preview/invites" />)

    const frame = document.querySelector('iframe')!
    expect(frame.getAttribute('src')).toBe('http://localhost:30001/preview/invites')
    expect(frame.getAttribute('title')).toBe('the design preview')
    expect(screen.getByRole('button', { name: 'Select area' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open in a new tab' }).getAttribute('href')).toBe(
      'http://localhost:30001/preview/invites',
    )
    expect(startMutate).not.toHaveBeenCalled()
  })

  it('puts its toolbar in a bar above the preview, not over it', () => {
    status = RUNNING
    render(<DesignView featureId="f1" path="/preview/invites" />)

    const frame = document.querySelector('iframe')!
    const reload = screen.getByRole('button', { name: 'Reload' })
    expect(frame.parentElement!.contains(reload)).toBe(false)
    expect(reload.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('tells the server the path it opened, so a bare reopen lands there', () => {
    status = RUNNING
    render(<DesignView featureId="f1" path="/preview/invites" />)
    expect(showPath).toHaveBeenCalledWith({ featureId: 'f1', path: '/preview/invites' })
  })

  it('reopened with no path, loads the last path the server remembers, else the root', () => {
    status = { ...RUNNING, lastPath: '/preview/invites' }
    const { rerender } = render(<DesignView featureId="f1" />)
    expect(document.querySelector('iframe')?.getAttribute('src')).toBe('http://localhost:30001/preview/invites')
    expect(showPath).not.toHaveBeenCalled()

    rerender(<DesignView featureId="f1" path="/preview/empty" />)
    expect(document.querySelector('iframe')?.getAttribute('src')).toBe('http://localhost:30001/preview/empty')

    status = RUNNING
    rerender(<DesignView featureId="f1" />)
    expect(document.querySelector('iframe')?.getAttribute('src')).toBe('http://localhost:30001/')
  })

  it('starts the server from the recorded command when none runs, saying so', () => {
    status = { running: false, hasRecordedCommand: true }
    const { rerender } = render(<DesignView featureId="f1" path="/preview/invites" />)
    expect(startMutate).toHaveBeenCalledTimes(1)
    expect(startMutate).toHaveBeenCalledWith({ featureId: 'f1' })

    start = { ...start, isPending: true }
    rerender(<DesignView featureId="f1" path="/preview/invites" />)
    expect(screen.getByText('Starting the design server…')).toBeTruthy()

    start = { ...start, isPending: false }
    status = RUNNING
    rerender(<DesignView featureId="f1" path="/preview/invites" />)
    expect(document.querySelector('iframe')?.getAttribute('src')).toBe('http://localhost:30001/preview/invites')
    expect(startMutate).toHaveBeenCalledTimes(1)
  })

  it('with neither a server nor a recorded command, says the chat starts it', () => {
    status = { running: false, hasRecordedCommand: false }
    render(<DesignView featureId="f1" />)

    expect(screen.getByText('No design server yet')).toBeTruthy()
    expect(document.querySelector('iframe')).toBeNull()
    expect(startMutate).not.toHaveBeenCalled()
  })

  it('heartbeats every 60s while visible, and not while hidden', () => {
    vi.useFakeTimers()
    status = RUNNING
    render(<DesignView featureId="f1" />)
    expect(heartbeat).toHaveBeenCalledTimes(1)
    expect(heartbeat).toHaveBeenCalledWith({ featureId: 'f1' })

    act(() => void vi.advanceTimersByTime(DESIGN_HEARTBEAT_MS - 1))
    expect(heartbeat).toHaveBeenCalledTimes(1)
    act(() => void vi.advanceTimersByTime(1))
    expect(heartbeat).toHaveBeenCalledTimes(2)

    visibility = 'hidden'
    act(() => void vi.advanceTimersByTime(DESIGN_HEARTBEAT_MS * 3))
    expect(heartbeat).toHaveBeenCalledTimes(2)

    visibility = 'visible'
    act(() => void vi.advanceTimersByTime(DESIGN_HEARTBEAT_MS))
    expect(heartbeat).toHaveBeenCalledTimes(3)
  })

  it('shows the stopped state once the server stops, without restarting it behind the human', () => {
    vi.useFakeTimers()
    status = RUNNING
    const { rerender } = render(<DesignView featureId="f1" />)

    // design.server_stopped invalidates the status; the refetch says it is down.
    status = { running: false, hasRecordedCommand: true }
    rerender(<DesignView featureId="f1" />)

    expect(screen.getByText('The design server stopped')).toBeTruthy()
    expect(document.querySelector('iframe')).toBeNull()
    expect(startMutate).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(DESIGN_HEARTBEAT_MS * 2))
    expect(heartbeat).toHaveBeenCalledTimes(1)

    act(() => screen.getByRole('button', { name: 'Start it again' }).click())
    expect(startMutate).toHaveBeenCalledWith({ featureId: 'f1' })
  })

  it('after the frame navigates away, Back returns it to the agent’s page', () => {
    status = { ...RUNNING, lastPath: '/preview/invites' }
    render(<DesignView featureId="f1" />)
    const before = document.querySelector('iframe')!
    // A link inside the cross-origin preview took the frame to the project's own route.
    before.setAttribute('src', 'http://localhost:30001/dashboard')

    act(() => screen.getByRole('button', { name: 'Back to /preview/invites' }).click())

    const after = document.querySelector('iframe')!
    expect(after).not.toBe(before)
    expect(after.getAttribute('src')).toBe('http://localhost:30001/preview/invites')
  })

  it('Back names the root when no path was opened', () => {
    status = RUNNING
    render(<DesignView featureId="f1" />)
    expect(screen.getByRole('button', { name: 'Back to /' })).toBeTruthy()
  })

  it('Restart server restarts it, says it is starting, then reloads the frame at the path', () => {
    status = RUNNING
    const { rerender } = render(<DesignView featureId="f1" path="/preview/invites" />)
    const before = document.querySelector('iframe')!

    act(() => screen.getByRole('button', { name: 'Restart server' }).click())
    expect(restartMutate).toHaveBeenCalledWith({ featureId: 'f1' }, expect.anything())

    restart = { isPending: true }
    status = { running: false, hasRecordedCommand: true }
    rerender(<DesignView featureId="f1" path="/preview/invites" />)
    expect(screen.getByText('Starting the design server…')).toBeTruthy()

    restart = { isPending: false }
    status = RUNNING
    act(() => restartMutate.mock.calls[0][1].onSuccess())
    rerender(<DesignView featureId="f1" path="/preview/invites" />)
    const after = document.querySelector('iframe')!
    expect(after).not.toBe(before)
    expect(after.getAttribute('src')).toBe('http://localhost:30001/preview/invites')
  })

  it('Show output opens the design server’s own terminal', () => {
    status = { ...RUNNING, paneId: 'design:f1' }
    render(<DesignView featureId="f1" />)
    expect(screen.queryByTestId('terminal')).toBeNull()

    act(() => screen.getByRole('button', { name: 'Show output' }).click())

    expect(screen.getByTestId('terminal').textContent).toBe('design:f1')
    act(() => screen.getByRole('button', { name: 'Hide output' }).click())
    expect(screen.queryByTestId('terminal')).toBeNull()
  })

  it('when the server dies, shows that it stopped with its last output and Restart server', () => {
    status = RUNNING
    const { rerender } = render(<DesignView featureId="f1" />)

    status = {
      running: false,
      hasRecordedCommand: true,
      lastError: "Module not found: Can't resolve <dynamic>\n  in @met4citizen/talkinghead",
    }
    rerender(<DesignView featureId="f1" />)

    expect(screen.getByText('The design server stopped')).toBeTruthy()
    expect(screen.getByText(/Module not found: Can't resolve <dynamic>/).textContent).toContain(
      '@met4citizen/talkinghead',
    )
    expect(document.querySelector('iframe')).toBeNull()
    act(() => screen.getByRole('button', { name: 'Restart server' }).click())
    expect(restartMutate).toHaveBeenCalledWith({ featureId: 'f1' }, expect.anything())
  })
})
