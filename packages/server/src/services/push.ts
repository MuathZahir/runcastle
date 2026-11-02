import { eq } from 'drizzle-orm'
import webpush, { WebPushError } from 'web-push'
import { pushKeys, pushSubscriptions } from '../db/schema'
import type { AppCtx } from '../db/types'

/**
 * Sending to the human's phone (`agents-can-notify-your-phone`, decision 1):
 * standard browser push, with no account, paid service or app, so it works for
 * anyone running runcastle. The text is encrypted between here and the phone;
 * Apple or Google see only when a message went, its size and which device.
 *
 * Nothing here decides when to send. Who may call is the tool's rule, and only
 * an agent's own judgement ever starts a send.
 */

/** The subject push services ask for. Apple's refuses a localhost one, so it is never the machine's. */
const VAPID_SUBJECT = 'https://runcastle.dev'

/** How long a push service keeps a message for a phone that is off: a day, then it is stale. */
const TTL_SECONDS = 86_400

/** Long enough for a slow push service, short enough that an agent is not left waiting. */
const SEND_TIMEOUT_MS = 10_000

/** A push service's answer that means this subscription is gone for good. */
const GONE = new Set([404, 410])

export interface PushMessage {
  title: string
  body: string
  /** The address a tap opens, as a path on this runcastle. */
  url: string
}

export interface PushTarget {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/** Hands one message to a push service. Rejects with the service's status when it refuses. */
export type PushSender = (
  target: PushTarget,
  message: PushMessage,
  keys: { publicKey: string; privateKey: string },
) => Promise<void>

const webPushSender: PushSender = async (target, message, keys) => {
  await webpush.sendNotification(target, JSON.stringify(message), {
    vapidDetails: { subject: VAPID_SUBJECT, ...keys },
    TTL: TTL_SECONDS,
    // A sleeping Android phone holds back anything less.
    urgency: 'high',
  })
}

/** Give up on a send. `web-push`'s own timeout misses a connection stalled before it is up. */
async function withinTimeLimit(sending: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('the push service did not answer')), SEND_TIMEOUT_MS)
  })
  try {
    await Promise.race([sending, limit])
  } finally {
    clearTimeout(timer)
  }
}

/** This install's key pair, made the first time anything needs it. */
function vapidKeys(ctx: AppCtx): { publicKey: string; privateKey: string } {
  const stored = ctx.db.select().from(pushKeys).where(eq(pushKeys.id, 1)).get()
  if (stored) return { publicKey: stored.publicKey, privateKey: stored.privateKey }
  const made = webpush.generateVAPIDKeys()
  ctx.db.insert(pushKeys).values({ id: 1, ...made }).onConflictDoNothing().run()
  const kept = ctx.db.select().from(pushKeys).where(eq(pushKeys.id, 1)).get()
  return kept ? { publicKey: kept.publicKey, privateKey: kept.privateKey } : made
}

/** The key a browser subscribes with. */
export function pushPublicKey(ctx: AppCtx): string {
  return vapidKeys(ctx).publicKey
}

/** Remember a phone. Subscribing again replaces its keys. */
export function addPushSubscription(ctx: AppCtx, target: PushTarget): void {
  const row = { endpoint: target.endpoint, ...target.keys, createdAt: Date.now() }
  ctx.db
    .insert(pushSubscriptions)
    .values(row)
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: target.keys })
    .run()
}

export function removePushSubscription(ctx: AppCtx, endpoint: string): void {
  ctx.db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).run()
}

/** The push service's status when a send was refused, undefined for any other failure. */
function refusalStatus(error: unknown): number | undefined {
  if (error instanceof WebPushError) return error.statusCode
  const status = (error as { statusCode?: unknown } | null)?.statusCode
  return typeof status === 'number' ? status : undefined
}

/** One send, with a subscription the service says is gone dropped. True when it was handed over. */
async function deliver(
  ctx: AppCtx,
  target: PushTarget,
  message: PushMessage,
  send: PushSender,
): Promise<boolean> {
  try {
    await withinTimeLimit(send(target, message, vapidKeys(ctx)))
    return true
  } catch (error) {
    const status = refusalStatus(error)
    if (status !== undefined && GONE.has(status)) removePushSubscription(ctx, target.endpoint)
    console.warn(`[push] a send failed${status ? ` with ${status}` : ''}: ${String(error)}`)
    return false
  }
}

/** Send to one phone, as the test notification does. */
export function sendPushTo(
  ctx: AppCtx,
  target: PushTarget,
  message: PushMessage,
  send: PushSender = webPushSender,
): Promise<boolean> {
  return deliver(ctx, target, message, send)
}

/** How a send to every phone went. `phones` counts those known when it started. */
export interface PushOutcome {
  phones: number
  sent: number
}

/** Send to every phone with notifications on. */
export async function sendPushToAll(
  ctx: AppCtx,
  message: PushMessage,
  send: PushSender = webPushSender,
): Promise<PushOutcome> {
  const rows = ctx.db.select().from(pushSubscriptions).all()
  const results = await Promise.all(
    rows.map(({ endpoint, p256dh, auth }) =>
      deliver(ctx, { endpoint, keys: { p256dh, auth } }, message, send),
    ),
  )
  return { phones: rows.length, sent: results.filter(Boolean).length }
}
