// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeatureNeed } from '@runcastle/core'
import type { FeatureFull } from '../src/lib/api'
import type { ActionKind, NextAction } from '../src/lib/feature-ui'
import { fakeTrpc } from './fake-trpc'
import { full as fixture, need } from './fixtures'

/**
 * While the feature needs the human, its main chat ends with a line saying what
 * for, with the header's button beside it (you-always-know-what-s-waiting
 * decision 4). The seam is FeatureChat on its real column, the server faked by path.
 */

vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: () => undefined }) }))
vi.mock('../src/lib/live', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/live')>()),
  useLivePoll: () => false,
}))

const { useFeatureChatColumn } = await import('../src/components/chat/use-feature-chat-column')
const { FeatureChat } = await import('../src/components/workspace/FeatureChat')

const THREADS = [
  { id: 'th_main', title: 'Chat', role: 'main', state: 'idle', createdAt: 1, updatedAt: 1, runtime: 'claude-code' },
  { id: 'th_side', title: 'Side', role: 'side', state: 'idle', createdAt: 2, updatedAt: 2, runtime: 'claude-code' },
]

function server() {
  return fakeTrpc({
    'thread.list': () => THREADS,
    'thread.events': (input) =>
      (input as { after?: number }).after !== undefined
        ? { events: [] }
        : { events: [{ i: 0, at: 1, type: 'agent_text', messageId: 'm1', text: 'Can I start round 1?' }] },
  })
}

let column: ReturnType<typeof useFeatureChatColumn> | undefined

function Chat({ waits, action, onAction = () => {} }: { waits: FeatureNeed | null; action?: NextAction; onAction?: (kind: ActionKind) => void }) {
  const full = { ...fixture({ id: 'feat_1' }), sessions: [], need: waits } as FeatureFull
  column = useFeatureChatColumn({ featureId: 'feat_1', sessions: [], driveSessionId: undefined })
  return (
    <FeatureChat
      full={full}
      column={column}
      events={[]}
      hidden={false}
      holdStart
      start={async () => 'th_main'}
      onView={() => {}}
      needAction={action}
      onAction={onAction}
    />
  )
}

const OPEN_PLAN: NextAction = { label: 'Open plan', kind: 'openPlan' }

afterEach(() => {
  cleanup()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('the main chat’s waiting line', () => {
  it('says the need under the last message, with the header’s button, and goes when the need clears', async () => {
    const onAction = vi.fn()
    const api = server()
    const { rerender } = render(<Chat waits={need('plan', 'Plan to approve')} action={OPEN_PLAN} onAction={onAction} />, { wrapper: api.Wrapper })
    await waitFor(() => expect(screen.getByText('Can I start round 1?')).toBeTruthy())
    expect(screen.getByText('Plan to approve')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open plan' }))
    expect(onAction).toHaveBeenCalledWith('openPlan')

    rerender(<Chat waits={null} onAction={onAction} />)
    expect(screen.queryByText('Plan to approve')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open plan' })).toBeNull()
  })

  it('gives an answer no button: the message box is right below', async () => {
    const api = server()
    render(<Chat waits={need('answer', 'Needs your answer · which model for approvals?')} />, { wrapper: api.Wrapper })
    await waitFor(() => expect(screen.getByText('Needs your answer · which model for approvals?')).toBeTruthy())
    expect(screen.getByText('Needs your answer · which model for approvals?').parentElement?.querySelector('button') ?? null).toBeNull()
  })

  it('shows nothing for a need the orchestrator is handling', async () => {
    const api = server()
    render(<Chat waits={need('plan', 'With the orchestrator · Plan to approve', { held: true })} action={OPEN_PLAN} />, { wrapper: api.Wrapper })
    await waitFor(() => expect(screen.getByText('Can I start round 1?')).toBeTruthy())
    expect(screen.queryByText(/Plan to approve/)).toBeNull()
  })

  it('never shows in a side thread', async () => {
    const api = server()
    render(<Chat waits={need('plan', 'Plan to approve')} action={OPEN_PLAN} />, { wrapper: api.Wrapper })
    await waitFor(() => expect(screen.getByText('Plan to approve')).toBeTruthy())
    await act(async () => column?.pick('th_side'))
    await waitFor(() => expect(column?.inFront).toBe('th_side'))
    await waitFor(() => expect(screen.queryByText('Plan to approve')).toBeNull())
  })
})
