// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PhoneNotificationsRow } from '../src/components/phone/PhoneNotificationsRow'
import { fakeTrpc } from './fake-trpc'

/**
 * The phone's Notifications row (`agents-can-notify-your-phone`, decision 5). The
 * browser's push machinery is the boundary, so it is the one thing faked here.
 */

const SUBSCRIPTION = {
  endpoint: 'https://push.example/1',
  toJSON: () => ({ endpoint: 'https://push.example/1', keys: { p256dh: 'k', auth: 'a' } }),
  unsubscribe: vi.fn(async () => true),
}

function browser({
  permission = 'default',
  answer = 'granted',
  subscribed = false,
}: { permission?: string; answer?: string; subscribed?: boolean } = {}) {
  const state = { subscribed }
  const pushManager = {
    getSubscription: async () => (state.subscribed ? SUBSCRIPTION : null),
    subscribe: vi.fn(async () => {
      state.subscribed = true
      return SUBSCRIPTION
    }),
  }
  SUBSCRIPTION.unsubscribe.mockImplementation(async () => {
    state.subscribed = false
    return true
  })
  const registration = { pushManager }
  vi.stubGlobal('Notification', { permission, requestPermission: vi.fn(async () => answer) })
  vi.stubGlobal('PushManager', class {})
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      register: vi.fn(async () => registration),
      getRegistration: async () => registration,
      ready: Promise.resolve(registration),
    },
  })
  vi.spyOn(window, 'location', 'get').mockReturnValue({ protocol: 'https:' } as Location)
  return pushManager
}

function row(handlers: Record<string, (input: never) => unknown> = {}) {
  const { Wrapper, calls } = fakeTrpc({
    'push.publicKey': () => 'AQAB',
    'push.subscribe': () => undefined,
    'push.unsubscribe': () => undefined,
    ...handlers,
  })
  render(<PhoneNotificationsRow projectId="proj_1" />, { wrapper: Wrapper })
  return calls
}

beforeEach(() => {
  SUBSCRIPTION.unsubscribe.mockClear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'serviceWorker')
})

describe('the Notifications row', () => {
  it('turning on asks permission, subscribes and tells the server', async () => {
    const pushManager = browser()
    const calls = row()

    fireEvent.click(await screen.findByRole('switch', { name: 'Notifications' }))

    await screen.findByText('On for this phone')
    expect(Notification.requestPermission).toHaveBeenCalledOnce()
    expect(pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }))
    expect(calls.find((c) => c.path === 'push.subscribe')?.input).toEqual({
      projectId: 'proj_1',
      subscription: { endpoint: 'https://push.example/1', keys: { p256dh: 'k', auth: 'a' } },
    })
  })

  it('stays off when the human says no, and tells the server nothing', async () => {
    browser({ answer: 'default' })
    const calls = row()

    fireEvent.click(await screen.findByRole('switch', { name: 'Notifications' }))

    await waitFor(() => expect(Notification.requestPermission).toHaveBeenCalled())
    await screen.findByText('When an agent needs you')
    expect(calls.some((c) => c.path === 'push.subscribe')).toBe(false)
  })

  it('reads this phone’s own state, and turning off forgets it on both sides', async () => {
    browser({ subscribed: true })
    const calls = row()

    fireEvent.click(await screen.findByRole('switch', { name: 'Notifications' }))

    await screen.findByText('When an agent needs you')
    expect(SUBSCRIPTION.unsubscribe).toHaveBeenCalledOnce()
    expect(calls.find((c) => c.path === 'push.unsubscribe')?.input).toEqual({
      projectId: 'proj_1',
      endpoint: 'https://push.example/1',
    })
  })

  it('when the test cannot be sent, says so and leaves the phone off', async () => {
    browser()
    row({
      'push.subscribe': () => {
        throw new Error('The test notification could not be sent.')
      },
    })

    fireEvent.click(await screen.findByRole('switch', { name: 'Notifications' }))

    await screen.findByText('The test notification could not be sent.')
    expect(SUBSCRIPTION.unsubscribe).toHaveBeenCalledOnce()
    expect(screen.getByRole('switch', { name: 'Notifications' }).getAttribute('aria-checked')).toBe('false')
  })

  it('when blocked, says how to allow it and offers no switch', async () => {
    browser({ permission: 'denied' })
    row()

    await screen.findByText(/Allow notifications for this site/)
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('on an iPhone not yet on the Home Screen, says to add it', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')
    row()

    await screen.findByText(/Add Runcastle to your Home Screen/)
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('where this browser cannot do it, says so', async () => {
    row()

    await screen.findByText(/in a browser that supports this/)
    expect(screen.queryByRole('switch')).toBeNull()
  })
})
