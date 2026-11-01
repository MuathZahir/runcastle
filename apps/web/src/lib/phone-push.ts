/**
 * This browser's side of phone notifications (`agents-can-notify-your-phone`):
 * what it can do, and its push subscription. The browser holds the truth about
 * whether this phone is on, so nothing here asks the server.
 */

const WORKER_PATH = '/sw.js'

/** What the Notifications row has to say about this phone. */
export type PushState = 'off' | 'on' | 'blocked' | 'home-screen' | 'unsupported'

/** The subscription the server stores: the browser's own JSON form, checked. */
export interface PushSubscriptionInput {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/** An iPhone or iPad, the last of which calls itself a Mac. */
function isApplePhone(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

/** Push needs HTTPS, which here means the phone link: plain addresses have no worker. */
function canPush(): boolean {
  return (
    window.location.protocol === 'https:' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/**
 * Start the worker wherever this page could use it, so the "can't reach your
 * computer" page is there before it is needed. A failure costs only that page.
 */
export function registerPhoneWorker(): void {
  if (window.location.protocol !== 'https:' || !('serviceWorker' in navigator)) return
  void navigator.serviceWorker.register(WORKER_PATH).catch(() => undefined)
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration()
  return (await registration?.pushManager.getSubscription()) ?? null
}

/** This phone's state, read fresh from the browser. */
export async function readPushState(): Promise<PushState> {
  if (!canPush()) return isApplePhone() ? 'home-screen' : 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  return (await currentSubscription()) ? 'on' : 'off'
}

/** The bytes the browser wants for a key sent in URL-safe base64. */
function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const base64 = key.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(key.length / 4) * 4, '=')
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
}

function subscriptionInput(subscription: PushSubscription): PushSubscriptionInput {
  const { endpoint, keys } = subscription.toJSON()
  if (!endpoint || !keys?.p256dh || !keys.auth) {
    throw new Error('The browser gave an incomplete subscription.')
  }
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }
}

/**
 * Ask permission and subscribe. Call it from a tap: browsers refuse the question
 * otherwise. Null when the human said no or dismissed it.
 */
export async function subscribeThisPhone(publicKey: string): Promise<PushSubscriptionInput | null> {
  if ((await Notification.requestPermission()) !== 'granted') return null
  const registration = await navigator.serviceWorker.register(WORKER_PATH)
  await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(publicKey),
  })
  return subscriptionInput(subscription)
}

/** Drop this phone's subscription. Its endpoint, for the server, or null if it had none. */
export async function unsubscribeThisPhone(): Promise<string | null> {
  const subscription = await currentSubscription()
  if (!subscription) return null
  await subscription.unsubscribe()
  return subscription.endpoint
}
