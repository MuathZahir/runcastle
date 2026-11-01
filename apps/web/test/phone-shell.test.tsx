// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeTrpcFetch, type TrpcFakes } from '../../../.runcastle/preview/fake-api'
import { PROJECT_ID, withShell } from '../../../.runcastle/preview/shell-fakes'
import { App } from '../src/App'
import { phoneDesignSrc } from '../src/components/phone/PhoneDesignView'
import type { RouterOutputs } from '../src/lib/api'
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

function fakes(threads: ThreadEntry[], extra: TrpcFakes = {}): TrpcFakes {
  const item = listItem({ id: FEATURE.id, slug: SLUG, waitingReason: 'question', leadAwaitsHuman: true })
  const feature = full({ id: FEATURE.id, slug: SLUG })
  return withShell({
    ...extra,
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

/**
 * The app standing at an address, as `.runcastle/preview/app-at.tsx` does for a
 * preview. That file belongs to no workspace, so under an isolated install it
 * cannot resolve react from a test.
 */
function AppAt({ path }: { path: string }) {
  useState(() => {
    localStorage.clear()
    sessionStorage.clear()
    window.history.replaceState(null, '', path)
    return null
  })
  return <App />
}

function Root({ path, threads = [], extra }: { path: string; threads?: ThreadEntry[]; extra?: TrpcFakes }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  const [client] = useState(() =>
    trpc.createClient({ links: trpcLinks('/api/trpc', fakeTrpcFetch('/api/trpc', fakes(threads, extra))) }),
  )
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
  // The back stack happy-dom lacks: what the on-screen Back steps through.
  const behind: string[] = []
  const push = window.history.pushState.bind(window.history)
  vi.spyOn(window.history, 'pushState').mockImplementation((state, title, url) => {
    behind.push(window.location.pathname)
    push(state, title, url)
  })
  vi.spyOn(window.history, 'back').mockImplementation(() => browserBack(behind.pop() ?? '/'))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
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

  it('takes the same step on its Back as the system’s, so the two never loop through the chat', async () => {
    render(<Root path={LIST} />)
    await onList()
    fireEvent.click(screen.getByRole('button', { name: /Export notes as PDF/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Back to the list' }))
    await waitFor(() => expect(window.location.pathname).toBe(LIST))
    await onList()
    expect(window.history.back).toHaveBeenCalledTimes(1)
    expect(window.history.pushState).toHaveBeenCalledTimes(1)
  })

  it('still reaches the list from a chat opened straight by its link', async () => {
    render(<Root path={CHAT} />)
    await screen.findByRole('button', { name: 'Back to the list' })
    await act(() => new Promise((settled) => setTimeout(settled, 50))) // the shell lands on the address
    fireEvent.click(await screen.findByRole('button', { name: 'Back to the list' }))
    await waitFor(() => expect(window.location.pathname).toBe(LIST))
    expect(window.history.back).not.toHaveBeenCalled()
  })

  it('jots a note with buttons: Enter is a new line, and no key hints show', async () => {
    render(<Root path={LIST} />)
    await onList()
    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    fireEvent.click(await screen.findByRole('button', { name: /Jot a note/ }))
    const field = await screen.findByRole('textbox', { name: 'what did you just notice?' })
    fireEvent.change(field, { target: { value: 'The chevron is small' } })
    expect(fireEvent.keyDown(field, { key: 'Enter' })).toBe(true)
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save.hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
    expect(screen.queryByText('new line')).toBeNull()
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

  it.each([
    ['a thread that no longer exists', `/p/${PROJECT_ID}/chat?thread=sess_gone`],
    ['no thread, with none active', `/p/${PROJECT_ID}/chat`],
  ])('lists the conversations for an Orchestrator address naming %s', async (_name, path) => {
    const old: ThreadEntry = {
      id: 'th_old',
      title: 'Audit the journal',
      role: 'project',
      state: 'idle',
      createdAt: 1,
      updatedAt: 1,
      runtime: 'claude-code',
    }
    render(<Root path={path} threads={[old]} />)
    expect(await screen.findByRole('button', { name: /Audit the journal/ })).toBeTruthy()
    expect(screen.queryByText('Loading feature…')).toBeNull()
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

describe('a design on a phone', () => {
  // The frame points at a design server that is not there; nothing should try to load it.
  ;(window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } }).happyDOM.settings.disableIframePageLoading = true

  const DESIGN = `/p/${PROJECT_ID}/f/${SLUG}/design`
  type DesignStatus = RouterOutputs['design']['status']

  /** The design server in `status`, the app opened on the phone link's machine, and what the view asks of the server. */
  function designFakes(status: DesignStatus) {
    const calls = { heartbeat: [] as unknown[], start: [] as unknown[] }
    const host = window.location.hostname
    const extra: TrpcFakes = {
      design: {
        status: () => status,
        heartbeat: (input: unknown) => (calls.heartbeat.push(input), { running: true }),
        start: (input: unknown) => (calls.start.push(input), { url: 'http://localhost:30001/', port: 30001, command: 'vite' }),
      },
      phoneLink: {
        status: () => ({
          tailscale: 'running' as const,
          on: true,
          url: `https://${host}:4512`,
          designUrl: `https://${host}:4514`,
          commands: [],
        }),
      },
    }
    return { calls, extra, host }
  }

  it('shows the live page through the phone link at desktop width, then the phone’s, and keeps the server alive', async () => {
    const { calls, extra, host } = designFakes({
      running: true,
      url: 'http://localhost:30001/',
      port: 30001,
      hasRecordedCommand: true,
      lastPath: '/preview/x.html',
    })
    render(<Root path={DESIGN} extra={extra} />)
    const frame = (await screen.findByTitle('The design')) as HTMLIFrameElement
    await waitFor(() =>
      expect(frame.getAttribute('src')).toBe(`https://${host}:4514/__runcastle/open/${FEATURE.id}?path=%2Fpreview%2Fx.html`),
    )
    expect(frame.style.width).toBe('1440px')
    expect(screen.getByText('Tap around it. Say what to change in the chat.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Select area/ })).toBeNull()
    await waitFor(() => expect(calls.heartbeat).toEqual([{ featureId: FEATURE.id }]))

    fireEvent.click(screen.getByRole('button', { name: 'Show at the phone’s width' }))
    expect(frame.style.width).not.toBe('1440px')
    expect(screen.getByRole('button', { name: 'Show at desktop width' }).textContent).toBe('Phone')

    fireEvent.click(screen.getByRole('button', { name: 'Back to the chat' }))
    await waitFor(() => expect(window.location.pathname).toBe(CHAT))
  })

  it('starts a stopped server from its recorded command', async () => {
    const { calls, extra } = designFakes({ running: false, hasRecordedCommand: true })
    render(<Root path={DESIGN} extra={extra} />)
    await waitFor(() => expect(calls.start).toEqual([{ featureId: FEATURE.id }]))
  })
})

describe('phoneDesignSrc', () => {
  it('goes through the pass-through only when the app is open on the link’s machine', () => {
    const designUrl = 'https://desk.tail1234.ts.net:4514'
    expect(phoneDesignSrc('http://localhost:30001/', '/a b', 'f1', designUrl, 'desk.tail1234.ts.net')).toBe(
      `${designUrl}/__runcastle/open/f1?path=%2Fa%20b`,
    )
    expect(phoneDesignSrc('http://localhost:30001/', '/a', 'f1', designUrl, 'localhost')).toBe('http://localhost:30001/a')
    expect(phoneDesignSrc('http://localhost:30001/', undefined, 'f1', undefined, 'localhost')).toBe('http://localhost:30001/')
  })
})
