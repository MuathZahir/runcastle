// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RouterOutputs } from '../src/lib/api'
import type { FilterState } from '../src/components/settings/types'

/**
 * Settings → General → "On your phone" (runcastle-on-your-phone, ticket 3).
 * Tier 2: what matters is that pressing Turn on or Turn off swaps the section
 * to the state the server answered, with no refetch in between.
 *
 * The tRPC client is stood up here with a one-entry cache for
 * `phoneLink.status`, so `setData` re-renders exactly as React Query would.
 */
type Status = RouterOutputs['phoneLink']['status']

const server = vi.hoisted(() => ({
  status: undefined as unknown,
  listeners: new Set<() => void>(),
  /** What the next turnOn / turnOff answers. */
  answer: undefined as unknown,
  calls: [] as { procedure: string; input: unknown }[],
}))

const setStatus = (next: unknown) => {
  server.status = next
  for (const l of server.listeners) l()
}

vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: () => undefined }) }))

vi.mock('../src/trpc', () => {
  const mutation = (procedure: string) => ({
    useMutation: (opts?: { onSuccess?: (data: unknown) => void }) => ({
      isPending: false,
      mutate: (input: unknown) => {
        server.calls.push({ procedure, input })
        opts?.onSuccess?.(server.answer)
      },
    }),
  })
  return {
    trpc: {
      useUtils: () => ({
        phoneLink: { status: { setData: (_: undefined, next: unknown) => setStatus(next) } },
      }),
      phoneLink: {
        status: {
          useQuery: () => {
            const data = useSyncExternalStore(
              (l) => {
                server.listeners.add(l)
                return () => server.listeners.delete(l)
              },
              () => server.status,
            )
            return { data, isLoading: false, error: null }
          },
        },
        turnOn: mutation('turnOn'),
        turnOff: mutation('turnOff'),
      },
    } as unknown as typeof import('../src/trpc').trpc,
  }
})

const { PhoneLinkSection } = await import('../src/components/settings/PhoneLinkSection')

const URL = 'https://desktop-mmp9qrd.tail69a80a.ts.net:4512'
const COMMANDS = [
  'tailscale serve --bg --https=4512 http://127.0.0.1:4512',
  'tailscale serve --bg --https=4514 http://127.0.0.1:4514',
]
const running = (over: Partial<Status> = {}): Status => ({
  tailscale: 'running',
  on: false,
  url: URL,
  designUrl: 'https://desktop-mmp9qrd.tail69a80a.ts.net:4514',
  commands: COMMANDS,
  ...over,
})

const noFilter: FilterState = {
  query: '',
  matches: new Set(),
  counts: { general: 0, models: 0, burns: 0, project: 0 },
}
const show = () => render(<PhoneLinkSection projectId="proj_1" filter={noFilter} />)

beforeEach(() => {
  server.calls = []
  server.listeners.clear()
  server.status = undefined
})
afterEach(cleanup)

describe('On your phone', () => {
  it('points to the download when Tailscale is missing', () => {
    setStatus({ tailscale: 'missing', on: false, commands: COMMANDS })
    show()
    expect(screen.getByText('On your phone')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Get Tailscale' })
    expect(link.getAttribute('href')).toBe('https://tailscale.com/download')
  })

  it('says to start Tailscale when it is stopped', () => {
    setStatus({ tailscale: 'stopped', on: false, commands: COMMANDS })
    show()
    expect(screen.getByText('Tailscale is not running on this computer')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Turn on' })).toBeNull()
  })

  it('turns the link on for this project and shows it with its QR code at once', () => {
    setStatus(running())
    show()
    expect(screen.queryByRole('img', { name: /QR code/ })).toBeNull()

    server.answer = running({ on: true })
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Turn on' })))

    expect(server.calls).toEqual([{ procedure: 'turnOn', input: { projectId: 'proj_1' } }])
    expect(screen.getByText(URL)).toBeTruthy()
    const qr = screen.getByRole('img', { name: `QR code for ${URL}` })
    // A scannable code: a light ground under dark modules, and modules drawn.
    expect(qr.querySelector('rect')?.getAttribute('fill')).toBe('#fff')
    expect(qr.querySelector('path')?.getAttribute('d')).toMatch(/^M\d+,\d+h1v1h-1z/)
    expect(screen.getByText('Scan the code')).toBeTruthy()
  })

  it('turns the link off and goes back to the Turn on button at once', () => {
    setStatus(running({ on: true }))
    show()

    server.answer = running()
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Turn off' })))

    expect(server.calls).toEqual([{ procedure: 'turnOff', input: { projectId: 'proj_1' } }])
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeTruthy()
    expect(screen.queryByText(URL)).toBeNull()
  })

  it('shows the CLI message and the commands to run by hand when turning on fails', () => {
    setStatus(running())
    show()

    server.answer = running({
      error: 'Access denied: serve config denied',
      commands: ['sudo tailscale set --operator=$USER', ...COMMANDS],
    })
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Turn on' })))

    expect(screen.getByText('Access denied: serve config denied')).toBeTruthy()
    const block = screen.getByText(/--operator/)
    expect(block.textContent).toBe(['sudo tailscale set --operator=$USER', ...COMMANDS].join('\n'))
  })

  it('shows the phone steps greyed before the link is on, under the Turn on button', () => {
    setStatus(running())
    show()
    expect(screen.getByText('Once the link is on, on your phone:')).toBeTruthy()
    expect(screen.getByText('Install Tailscale on your phone')).toBeTruthy()
    expect(screen.getByText('Add it to your home screen')).toBeTruthy()
  })

  it('asks for HTTPS on the tailnet once, links to Tailscale, and tries again from there', () => {
    const page = 'https://login.tailscale.com/f/serve?node=nT8fKz2CNTRL'
    setStatus(running())
    show()

    server.answer = running({ httpsNeeded: page })
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Turn on' })))

    expect(screen.getByText('Turn on HTTPS for your tailnet, once')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open Tailscale' }).getAttribute('href')).toBe(page)
    expect(screen.queryByRole('button', { name: 'Turn on' })).toBeNull()
    expect(screen.queryByText(/Could not change the link/)).toBeNull()

    server.answer = running({ on: true })
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Try again' })))

    expect(server.calls.map((c) => c.procedure)).toEqual(['turnOn', 'turnOn'])
    expect(screen.getByRole('img', { name: `QR code for ${URL}` })).toBeTruthy()
    expect(screen.queryByText('Turn on HTTPS for your tailnet, once')).toBeNull()
  })
})
