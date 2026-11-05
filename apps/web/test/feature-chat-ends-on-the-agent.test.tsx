// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeatureNeed } from '@runcastle/core'
import type { FeatureFull } from '../src/lib/api'
import { fakeTrpc } from './fake-trpc'
import { full as fixture, need } from './fixtures'

/**
 * The main chat ends on the agent's own words, even while the feature needs the
 * human: the header and the sidebar say what for (small-fixes decision 1, which
 * retired you-always-know-what-s-waiting decision 4's waiting line). The seam is
 * FeatureChat on its real column, the server faked by path.
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

function Chat({ waits }: { waits: FeatureNeed | null }) {
  const full = { ...fixture({ id: 'feat_1' }), sessions: [], need: waits } as FeatureFull
  column = useFeatureChatColumn({ featureId: 'feat_1', sessions: [], driveSessionId: undefined })
  return <FeatureChat full={full} column={column} events={[]} hidden={false} holdStart start={async () => 'th_main'} onView={() => {}} />
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('the main chat while the feature needs the human', () => {
  it('ends on the agent’s words, with no waiting line or button under them', async () => {
    const api = server()
    render(<Chat waits={need('plan', 'Plan to approve')} />, { wrapper: api.Wrapper })
    await waitFor(() => expect(screen.getByText('Can I start round 1?')).toBeTruthy())
    expect(screen.queryByText(/Plan to approve/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open plan' })).toBeNull()
  })
})
