// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/trpc', () => ({
  trpc: {
    project: {
      conversationTranscript: {
        useQuery: () => ({ isPending: false, data: { status: 'ok', runtime: 'claude-code', turns: [] } }),
      },
    },
    feature: { endSession: { useMutation: () => ({ mutate: () => undefined, isPending: false }) } },
    useUtils: () => ({
      feature: { get: { invalidate: () => undefined }, list: { invalidate: () => undefined } },
    }),
  },
}))

vi.mock('../src/components/TerminalView', () => ({
  TerminalView: ({ sessionId }: { sessionId: string }) => <div data-terminal={sessionId} />,
}))

import type { Phase } from '@runcastle/core'
import { nextStep, PHASE_ORDER, type ActionKind } from '../src/lib/feature-ui'
import { ToastProvider } from '../src/lib/toast'
import { useWorkspace } from '../src/lib/workspace'
import { ChatDock, ChatPanel } from '../src/components/workspace/ChatPanel'
import { NextStepBar } from '../src/components/workspace/NextStepBar'
import { full } from './fixtures'

/**
 * The workspace's own wiring of the constant Chat door to the docked panel
 * (decisions 8 and 16), small enough to drive in a DOM: the real per-state bar,
 * the real toggle state the shell holds, and a stand-in for whatever body the
 * phase would have rendered.
 */
function Harness({ phase }: { phase: Phase }) {
  const ws = useWorkspace('proj_1')
  const feature = full({ phase })
  const ns = nextStep(feature, { driving: false })
  const onAction = (kind: ActionKind) => {
    if (kind === 'chat') ws.toggleChatPanel()
  }
  return (
    <ToastProvider>
      <NextStepBar ns={ns} guidance={false} busy={false} onAction={onAction} />
      <ChatDock
        open={ws.chatPanelOpen}
        panel={
          <ChatPanel
            featureId="feat_1"
            sessions={feature.sessions}
            busy={false}
            onOpenChat={() => undefined}
            onCollapse={ws.toggleChatPanel}
          />
        }
      >
        <div data-testid="phase-body">{phase} body</div>
      </ChatDock>
    </ToastProvider>
  )
}

/** The label the bar gave this state's chat door — promoted or secondary. */
function chatDoorLabel(phase: Phase): string {
  const ns = nextStep(full({ phase }), { driving: false })
  const action = [ns.primary, ...ns.secondary].find((a) => a?.kind === 'chat')
  if (!action) throw new Error(`no chat door on the ${phase} bar`)
  return action.label
}

describe('the Chat door toggles the docked panel', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  for (const phase of PHASE_ORDER) {
    it(`docks and un-docks the chat beside the ${phase} body`, () => {
      render(<Harness phase={phase} />)
      const door = screen.getByRole('button', { name: chatDoorLabel(phase) })

      expect(screen.queryByLabelText('Feature chat')).toBeNull()

      fireEvent.click(door)
      expect(screen.getByLabelText('Feature chat')).toBeTruthy()
      // The body is not replaced — it keeps doing its phase job beside the chat.
      expect(screen.getByTestId('phase-body').textContent).toBe(`${phase} body`)

      fireEvent.click(door)
      expect(screen.queryByLabelText('Feature chat')).toBeNull()
      expect(screen.getByTestId('phase-body')).toBeTruthy()
    })
  }

  /**
   * The panel's own collapse is the same road as the door's second click — and
   * the choice is remembered, so pinning an earlier phase or coming back to the
   * feature does not quietly send the conversation away.
   */
  it('collapses from inside the panel, and remembers the choice', () => {
    render(<Harness phase="review" />)
    fireEvent.click(screen.getByRole('button', { name: chatDoorLabel('review') }))
    expect(localStorage.getItem('runcastle.chatpanel.open')).toBe('1')

    fireEvent.click(screen.getByRole('button', { name: 'Collapse the chat' }))
    expect(screen.queryByLabelText('Feature chat')).toBeNull()
    expect(localStorage.getItem('runcastle.chatpanel.open')).toBe('0')
  })

  it('opens already docked when that is where it was left', () => {
    localStorage.setItem('runcastle.chatpanel.open', '1')
    render(<Harness phase="building" />)
    expect(screen.getByLabelText('Feature chat')).toBeTruthy()
  })
})
