// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppAt } from '../../../.runcastle/preview/app-at'
import { fakeTrpcFetch, type TrpcFakes } from '../../../.runcastle/preview/fake-api'
import { PROJECT_ID, withShell } from '../../../.runcastle/preview/shell-fakes'
import { ToastProvider } from '../src/lib/toast'
import { PHONE_QUERY } from '../src/lib/use-phone'
import { trpc, trpcLinks } from '../src/trpc'
import { TooltipProvider } from '../src/ui/tooltip'
import { full, listItem } from './fixtures'
import type { ThreadEntry } from '@runcastle/core'

/**
 * The phone view (runcastle-on-your-phone ticket 1): at a phone's width the app
 * opens on the list, a feature's chat takes the whole screen, Back returns, and
 * the list warns while the computer cannot be reached. Tier 2 at the app level:
 * the real shell over faked tRPC answers at the `fetch` edge, the address and
 * the live stream being what is driven.
 */

const SLUG = 'export-pdf'
const FEATURE = { id: 'feat_pdf', slug: SLUG, title: 'Export notes as PDF' }

/** A phone screen: only the phone query matches, so the theme and motion queries read as usual. */
function stubPhone() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === PHONE_QUERY,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  }))
}

/** The live stream, held so a test can drop it and bring it back. */
class TestEventSource extends EventTarget {
  static readonly CLOSED = 2
  static last: TestEventSource | null = null
  readyState = 0
  readonly url: string
  onopen = null
  onmessage = null
  onerror = null
  constructor(url: string | URL) {
    super()
    this.url = String(url)
    TestEventSource.last = this
  }
  close() {
    this.readyState = 2
  }
}

function fakes(threads: ThreadEntry[]): TrpcFakes {
  const item = listItem({ id: FEATURE.id, slug: SLUG, waitingReason: 'question', leadAwaitsHuman: true })
  const feature = full({ id: FEATURE.id, slug: SLUG })
  return withShell({
    feature: {
      list: () => [{ ...item, title: FEATURE.title }],
      get: () =>
        ({
          ...feature,
          feature: { ...feature.feature, title: FEATURE.title },
          docs: [{ relPath: 'decisions.md', title: 'Decisions', updatedAt: 1 }],
        }) as never,
      driveInfo: () => null,
    },
    thread: { list: () => threads },
  } as TrpcFakes)
}

function Root({ path, threads = [] }: { path: string; threads?: ThreadEntry[] }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  const [client] = useState(() => trpc.createClient({ links: trpcLinks('/api/trpc', fakeTrpcFetch('/api/trpc', fakes(threads))) }))
  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ToastProvider>
            <AppAt path={path} />
          </ToastProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </trpc.Provider>
  )
}

const LIST = `/p/${PROJECT_ID}`
const CHAT = `/p/${PROJECT_ID}/f/${SLUG}/chat`

/** The list has arrived: its Orchestrator door and the feature's row. */
async function onList() {
  await screen.findByRole('button', { name: /Export notes as PDF/ })
  expect(screen.getByRole('button', { name: /^Orchestrator/ })).toBeTruthy()
}

/** happy-dom keeps no back stack, so the browser's Back is the address it lands on and a popstate. */
function browserBack(to: string) {
  act(() => {
    window.history.replaceState(null, '', to)
    window.dispatchEvent(new Event('popstate'))
  })
}

beforeEach(() => {
  stubPhone()
  vi.stubGlobal('EventSource', TestEventSource)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('runcastle on a phone', () => {
  it('opens on the list — no search, no foot, no hover menus — and nothing opens by itself', async () => {
    render(<Root path={LIST} />)
    await onList()
    expect(screen.queryByRole('button', { name: 'Search or jump to' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Hide sidebar' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Feature actions|Project actions/ })).toBeNull()
    expect(screen.queryByRole('main')).toBeNull()
    expect(window.location.pathname).toBe(LIST)
  })

  it('opens a tapped feature on its chat, full screen, and Back returns to the list', async () => {
    render(<Root path={LIST} />)
    await onList()
    fireEvent.click(screen.getByRole('button', { name: /Export notes as PDF/ }))
    await screen.findByRole('button', { name: 'Back to the list' })
    expect(window.location.pathname).toBe(CHAT)
    expect(screen.queryByRole('navigation', { name: 'Project' })).toBeNull()

    browserBack(LIST)
    await onList()
    expect(screen.queryByRole('button', { name: 'Back to the list' })).toBeNull()
  })

  it('lands a reload at the chat on the chat', async () => {
    render(<Root path={CHAT} />)
    await screen.findByRole('button', { name: 'Back to the list' })
    expect(window.location.pathname).toBe(CHAT)
  })

  it('opens the Plan full screen from the chat’s “…”, never Details, and its Back is the chat', async () => {
    render(<Root path={CHAT} />)
    fireEvent.click(await screen.findByRole('button', { name: 'More' }))
    const views = screen.getByRole('dialog', { name: 'Views' })
    expect(within(views).queryByRole('button', { name: /Details/ })).toBeNull()
    fireEvent.click(within(views).getByRole('button', { name: /^Plan/ }))
    await waitFor(() => expect(window.location.pathname).toBe(`/p/${PROJECT_ID}/f/${SLUG}/plan`))
    fireEvent.click(screen.getByRole('button', { name: 'Back to the chat' }))
    await waitFor(() => expect(window.location.pathname).toBe(CHAT))
    expect(screen.getByRole('button', { name: 'Back to the list' })).toBeTruthy()
  })

  it('shows the chat for an address naming Details', async () => {
    render(<Root path={`/p/${PROJECT_ID}/f/${SLUG}/details`} />)
    await screen.findByRole('button', { name: 'Back to the list' })
    expect(screen.queryByRole('region', { name: 'Details' })).toBeNull()
  })

  it('switches the Orchestrator’s threads from its title, which also offers New thread', async () => {
    const thread = (id: string, title: string, createdAt: number): ThreadEntry => ({
      id,
      title,
      role: 'project',
      state: 'idle',
      createdAt,
      updatedAt: createdAt,
      runtime: 'claude-code',
    })
    render(<Root path={`/p/${PROJECT_ID}/chat`} threads={[thread('th_new', 'Plan the export', 2), thread('th_old', 'Audit the journal', 1)]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Orchestrator — switch thread' }))
    const sheet = screen.getByRole('dialog', { name: 'Threads' })
    expect(within(sheet).getByRole('button', { name: 'New thread' })).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Audit the journal' }))
    expect(screen.queryByRole('dialog', { name: 'Threads' })).toBeNull()
    await waitFor(() => expect(window.location.search).toBe('?thread=th_old'))
  })

  it('starts a new Orchestrator chat and opens note capture from the list’s +', async () => {
    render(<Root path={LIST} />)
    await onList()
    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New' })).getByRole('button', { name: /Jot a note/ }))
    await screen.findByRole('textbox', { name: /what did you just notice/i })

    cleanup()
    render(<Root path={LIST} />)
    await onList()
    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'New' })).getByRole('button', { name: /New chat/ }))
    await waitFor(() => expect(window.location.pathname).toBe(`/p/${PROJECT_ID}/chat`))
    expect(await screen.findByRole('button', { name: 'Back to the list' })).toBeTruthy()
  })

  it('warns on the list while the live stream is down, and clears on reconnect', async () => {
    render(<Root path={LIST} />)
    await onList()
    expect(screen.queryByText(/Can’t reach your computer/)).toBeNull()
    const stream = TestEventSource.last as TestEventSource
    act(() => {
      stream.readyState = 2
      stream.dispatchEvent(new Event('error'))
    })
    expect(screen.getByText(/Can’t reach your computer/)).toBeTruthy()
    act(() => {
      stream.dispatchEvent(new Event('ready'))
    })
    expect(screen.queryByText(/Can’t reach your computer/)).toBeNull()
  })
})
