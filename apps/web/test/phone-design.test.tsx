// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesignEntry } from '@runcastle/core'
import { PhoneDesignView } from '../src/components/phone/PhoneDesignView'
import { ToastProvider } from '../src/lib/toast'
import { fakeTrpc } from './fake-trpc'

/**
 * The phone's Design screen (designs-and-the-plan-get-their-own-place
 * decisions 16, 24, 26): a recorded design opened from its card under its own
 * title, marked seen, Approve & next walking the waiting designs and the last
 * Approve back to the chat; the frame only ever through the pass-through on
 * the page's own host — here a Tailscale name, not localhost. Tier 2: taps
 * over a faked server at the tRPC edge and a faked probe at `fetch`.
 */

type Happy = { happyDOM: { setURL: (url: string) => void; settings: { disableIframePageLoading: boolean } } }
const happy = (window as unknown as Happy).happyDOM
// The frame points at a pass-through that is not there; nothing should try to load it.
happy.settings.disableIframePageLoading = true
const HOST = 'desk.tail1234.ts.net'

const design = (id: string, title: string, shownAt: number, state: DesignEntry['state'] = 'waiting'): DesignEntry => ({
  id,
  title,
  path: `/preview/${id}.html`,
  width: 390,
  state,
  isNew: state === 'waiting',
  shownAt,
  report: null,
})

function server(designs: DesignEntry[]) {
  let record = designs
  return fakeTrpc({
    'design.list': () => ({ designs: record, plan: { isNew: false } }),
    'design.status': () => ({ running: true, url: 'http://localhost:30001/', port: 30001, hasRecordedCommand: true, passPort: 4514 }),
    'design.heartbeat': () => ({ running: true }),
    'design.showPath': () => ({}),
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

/** The screen as the phone holds it: the open design's page is the panel's path; Back is the chat. */
function Screen({ start, onBack }: { start: string; onBack: () => void }) {
  const [path, setPath] = useState(start)
  return (
    <ToastProvider>
      <PhoneDesignView featureId="f1" path={path} title="Design" sub="Export notes" onOpen={setPath} onBack={onBack} />
    </ToastProvider>
  )
}

let pings: string[]
let answers: boolean
beforeEach(() => {
  happy.setURL(`https://${HOST}/p/proj/f/export/design`)
  pings = []
  answers = true
  vi.stubGlobal('fetch', async (url: RequestInfo | URL) => {
    pings.push(String(url))
    if (!answers) throw new TypeError('Failed to fetch')
    return new Response(null, { status: 204 })
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the phone’s Design screen', () => {
  it('opens a design through the pass-through on the page’s own host, under its title, and marks it seen', async () => {
    const api = server([design('cart', 'Cart', 1)])
    render(<Screen start="/preview/cart.html" onBack={vi.fn()} />, { wrapper: api.Wrapper })
    const frame = await screen.findByTitle('The design')
    expect(frame.getAttribute('src')).toBe(`https://${HOST}:4514/__runcastle/open/f1?path=%2Fpreview%2Fcart.html`)
    expect(pings).toEqual([`https://${HOST}:4514/__runcastle/ping`])
    expect(screen.getByRole('region', { name: 'Cart' })).toBeTruthy()
    // Laid out at the width the design was recorded at.
    expect((frame as HTMLIFrameElement).style.width).toBe('390px')
    await waitFor(() => expect(api.inputs('design.seen')).toEqual([{ designId: 'cart' }]))
  })

  it('walks the waiting designs with Approve & next, and the last Approve goes back to the chat', async () => {
    const api = server([design('a', 'Alpha', 3), design('b', 'Beta', 2), design('c', 'Gamma', 1, 'approved')])
    const onBack = vi.fn()
    render(<Screen start="/preview/a.html" onBack={onBack} />, { wrapper: api.Wrapper })
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: /Approve & next/ })))

    await screen.findByRole('region', { name: 'Beta' })
    expect(api.inputs('design.approve')).toEqual([{ designId: 'a' }])
    const last = await screen.findByRole('button', { name: 'Approve' })
    expect(onBack).not.toHaveBeenCalled()
    await act(async () => fireEvent.click(last))

    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1))
    expect(api.inputs('design.approve')).toEqual([{ designId: 'a' }, { designId: 'b' }])
  })

  it('offers no Approve on a design already approved', async () => {
    const api = server([design('c', 'Gamma', 1, 'approved'), design('d', 'Delta', 2)])
    render(<Screen start="/preview/c.html" onBack={vi.fn()} />, { wrapper: api.Wrapper })
    await screen.findByTitle('The design')
    await screen.findByRole('region', { name: 'Gamma' })
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull()
  })

  it('says which port to forward, with Retry, when the pass-through cannot be reached — and offers no Approve', async () => {
    answers = false
    const api = server([design('cart', 'Cart', 1)])
    render(<Screen start="/preview/cart.html" onBack={vi.fn()} />, { wrapper: api.Wrapper })
    await screen.findByText(new RegExp(`cannot reach port 4514 on ${HOST.replace(/\./g, '\\.')}`))
    expect(screen.queryByTitle('The design')).toBeNull()
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull()

    answers = true
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTitle('The design')).toBeTruthy()
    expect(pings).toHaveLength(2)
  })
})
