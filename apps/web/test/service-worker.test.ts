import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The service worker (`agents-can-notify-your-phone`). It is a plain script the
 * browser runs, so the test runs that same file against a fake `self`.
 */

type Listener = (event: never) => void

const source = readFileSync(join(import.meta.dirname, '..', 'public', 'sw.js'), 'utf8')

function worker(fetchImpl: (request: unknown) => Promise<Response> = async () => new Response('ok')) {
  const listeners = new Map<string, Listener>()
  const self = {
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    location: { origin: 'https://desk.ts.net:4512' },
    registration: { showNotification: vi.fn(async () => {}) },
    clients: {
      matchAll: vi.fn(async (): Promise<unknown[]> => []),
      openWindow: vi.fn(async () => null),
      claim: vi.fn(async () => {}),
    },
    skipWaiting: vi.fn(),
  }
  new Function('self', 'fetch', source)(self, fetchImpl)
  /** Fire one event; the promise it asked the browser to keep alive for. */
  const fire = (type: string, event: object): Promise<unknown> => {
    let kept: Promise<unknown> = Promise.resolve()
    const hold = (promise: Promise<unknown>) => {
      kept = promise
    }
    listeners.get(type)?.({ ...event, waitUntil: hold, respondWith: hold } as never)
    return kept
  }
  return { self, fire }
}

function tap(url?: string) {
  return { notification: { close: vi.fn(), data: url ? { url } : undefined } }
}

describe('the service worker', () => {
  let page: ReturnType<typeof worker>

  beforeEach(() => {
    page = worker()
  })

  it('turns a push into a notification carrying where a tap goes', async () => {
    const data = { json: () => ({ title: 'Checkout', body: 'Ready.', url: '/p/x/chat' }) }

    await page.fire('push', { data })

    expect(page.self.registration.showNotification).toHaveBeenCalledWith(
      'Checkout',
      expect.objectContaining({ body: 'Ready.', data: { url: '/p/x/chat' } }),
    )
  })

  it('a tap brings an open window to the sending chat', async () => {
    const open = { focus: vi.fn(async () => {}), navigate: vi.fn(async () => {}) }
    page.self.clients.matchAll.mockResolvedValue([open])
    const event = tap('/p/x/f/y/chat?thread=sess_1')

    await page.fire('notificationclick', event)

    expect(event.notification.close).toHaveBeenCalled()
    expect(open.navigate).toHaveBeenCalledWith('https://desk.ts.net:4512/p/x/f/y/chat?thread=sess_1')
    expect(page.self.clients.openWindow).not.toHaveBeenCalled()
  })

  it('a tap opens a window when none is open, or none can be navigated', async () => {
    await page.fire('notificationclick', tap('/p/x/chat'))
    expect(page.self.clients.openWindow).toHaveBeenCalledWith('https://desk.ts.net:4512/p/x/chat')

    page.self.clients.openWindow.mockClear()
    const uncontrolled = { focus: vi.fn(async () => {}), navigate: vi.fn(async () => Promise.reject(new TypeError('no'))) }
    page.self.clients.matchAll.mockResolvedValue([uncontrolled])
    await page.fire('notificationclick', tap('/p/x/chat'))
    expect(page.self.clients.openWindow).toHaveBeenCalledOnce()
  })

  describe('loading a page', () => {
    const navigate = { request: { mode: 'navigate' } }

    it('passes a good page straight through', async () => {
      const response = (await page.fire('fetch', navigate)) as Response
      expect(await response.text()).toBe('ok')
    })

    it('shows its own page when the computer cannot be reached', async () => {
      const offline = worker(() => Promise.reject(new TypeError('failed to fetch')))

      const response = (await offline.fire('fetch', navigate)) as Response

      expect(response.status).toBe(503)
      expect(await response.text()).toContain('Can’t reach your computer')
    })

    it.each([502, 503, 504])('shows it for a %i, Tailscale’s answer while runcastle is down', async (status) => {
      const down = worker(async () => new Response('bad gateway', { status }))
      const response = (await down.fire('fetch', navigate)) as Response
      expect(await response.text()).toContain('Can’t reach your computer')
    })

    it('leaves every other request alone', async () => {
      const seen = vi.fn(async () => new Response('x'))
      const quiet = worker(seen)
      await quiet.fire('fetch', { request: { mode: 'cors' } })
      expect(seen).not.toHaveBeenCalled()
    })
  })
})
