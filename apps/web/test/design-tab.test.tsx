// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesignEntry } from '@runcastle/core'
import { DesignTab } from '../src/components/design/DesignTab'
import { ToastProvider } from '../src/lib/toast'
import { fakeTrpc } from './fake-trpc'

/**
 * The panel's Design view (designs-and-the-plan-get-their-own-place decisions
 * 6, 7, 8, 24): the list at home with no Approve on its rows, an open design's
 * bar, and Approve & next walking the human through what still waits until the
 * last Approve returns to the list. Tier 2: it is clicks over a live record.
 * The server is faked at the tRPC edge and the pass-through's probe at `fetch`.
 * Approve shows only once the design is on screen: its server up and the
 * pass-through reachable (decision 8).
 */

const design = (id: string, title: string, shownAt: number, state: DesignEntry['state'] = 'waiting'): DesignEntry => ({
  id,
  title,
  path: `/preview/${id}.html`,
  state,
  isNew: state === 'waiting',
  shownAt,
})

/** The design server up at a URL, as `design.status` reports a running one. */
const UP = { running: true, url: 'http://localhost:30001/', port: 30001, hasRecordedCommand: true }

function server(
  designs: DesignEntry[],
  status: { hasRecordedCommand: boolean; lastPath?: string; running?: boolean; url?: string; port?: number } = { hasRecordedCommand: false },
) {
  let record = designs
  return fakeTrpc({
    'design.list': () => ({ designs: record, plan: { isNew: false } }),
    'design.status': () => ({ running: false, passPort: 4514, ...status }),
    'design.heartbeat': () => ({ running: true }),
    'design.approve': ({ designId }: { designId: string }) => {
      record = record.map((d) => (d.id === designId ? { ...d, state: 'approved' as const, isNew: false } : d))
      return { approved: true }
    },
    'design.seen': ({ designId }: { designId: string }) => {
      record = record.map((d) => (d.id === designId ? { ...d, isNew: false } : d))
      return record.find((d) => d.id === designId)
    },
  })
}

/** The tab as the panel holds it: the open design's page is the panel's path. */
function Tab({ start }: { start?: string }) {
  const [path, setPath] = useState<string | undefined>(start)
  return (
    <ToastProvider>
      <DesignTab featureId="f1" {...(path ? { path } : {})} onOpen={setPath} onList={() => setPath(undefined)} />
    </ToastProvider>
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('DesignTab', () => {
  it('opens on the list, waiting designs first, with no Approve on its rows', async () => {
    const api = server([design('cart', 'Cart', 1, 'approved'), design('menu', 'Menu', 2), design('invite', 'Invite', 3)])
    render(<Tab />, { wrapper: api.Wrapper })
    const waiting = await screen.findByRole('region', { name: 'Waiting for you' })
    expect(within(waiting).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Open the design Invite',
      'Open the design Menu',
    ])
    expect(screen.getByText('1 of 3 approved')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull()
  })

  it('walks the waiting designs with Approve & next, and the last Approve returns to the list, every design approved', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 204 }))
    const api = server([design('a', 'Alpha', 3), design('b', 'Beta', 2), design('c', 'Gamma', 1, 'approved')], UP)
    render(<Tab />, { wrapper: api.Wrapper })
    fireEvent.click(await screen.findByRole('button', { name: 'Open the design Alpha' }))

    // Opened: the bar, its place in the list, and Approve that moves on.
    await screen.findByRole('button', { name: 'All designs' })
    expect(screen.getByText('1 of 3')).toBeTruthy()
    await waitFor(() => expect(api.inputs('design.seen')).toEqual([{ designId: 'a' }]))
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: /Approve & next/ })))

    // On the next design still waiting, now the last: plain Approve.
    await waitFor(() => expect(screen.getByText('Beta')).toBeTruthy())
    const approve = await screen.findByRole('button', { name: /^Approve$/ })
    await act(async () => fireEvent.click(approve))

    await screen.findByText('All 3 designs approved.')
    expect(api.inputs('design.approve')).toEqual([{ designId: 'a' }, { designId: 'b' }])
    expect(screen.queryByRole('button', { name: 'All designs' })).toBeNull()
  })

  it('steps to the neighbours with the arrows, and All designs goes back to the list', async () => {
    const api = server([design('a', 'Alpha', 2), design('b', 'Beta', 1)])
    render(<Tab start="/preview/a.html" />, { wrapper: api.Wrapper })
    // Its server is down, so the design is not on screen and cannot be approved unseen.
    await screen.findByText('1 of 2')
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Next design' }))
    await screen.findByText('2 of 2')
    fireEvent.click(screen.getByRole('button', { name: 'All designs' }))
    await screen.findByRole('region', { name: 'Waiting for you' })
  })

  it('with no designs recorded, offers the design server from before the list only when it has a command', async () => {
    const legacy = server([], { hasRecordedCommand: true, lastPath: '/old.html' })
    render(<Tab />, { wrapper: legacy.Wrapper })
    fireEvent.click(await screen.findByRole('button', { name: 'Open the design server' }))
    // The old server's page, live, with only the way back.
    await screen.findByRole('button', { name: 'All designs' })
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull()
    cleanup()

    render(<Tab />, { wrapper: server([]).Wrapper })
    await screen.findByText('No designs yet')
    expect(screen.queryByRole('button', { name: 'Open the design server' })).toBeNull()
  })
})
