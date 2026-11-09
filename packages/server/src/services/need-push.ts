import { FEATURE_NEEDS_YOU, type EventRow, type Feature, type NeedsYouData, needPings } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { subscribeLive } from './bus'
import { emit, getEventRow } from './events'
import { type PushOutcome, type PushSender, sendPushToAll } from './push'
import { tryGetFeature } from './repo'

/**
 * Runcastle's own phone pings (you-always-know-what-s-waiting decision 12): one
 * push to every subscribed phone each time a feature enters a need the desktop
 * pings for — the same {@link needPings} rule, so the two never disagree. A
 * stalled agent cannot ask to be pinged, so this does not wait for one to;
 * `notify_human` stays for what agents want to say beyond a wait.
 */

const path = (...segments: string[]): string =>
  `/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`

/** `text` as a sentence: a full stop added unless it already ends in one. */
function sentence(text: string): string {
  return /[.?!…]$/.test(text) ? text : `${text}.`
}

/** The one plain sentence a push says for a need. */
export function needPushBody(need: NeedsYouData): string {
  const why = need.why ?? ''
  switch (need.kind) {
    case 'permission':
      return sentence(`Waiting for your permission to run ${why}`)
    case 'conflict':
      return 'A merge stopped on a conflict.'
    case 'worker':
      return sentence(`${why} needs you`)
    case 'answer':
      return why ? sentence(`Needs your answer: ${why}`) : 'Needs your answer.'
    case 'plan':
      return 'Plan to approve.'
    case 'design':
      return 'Design to approve.'
    case 'stopped':
      return sentence(`Stopped: ${why}`)
    case 'test':
      return why ? sentence(`Ready to test: ${why}`) : 'Ready to test.'
    case 'merge':
      return 'Ready to merge.'
    case 'handback':
      // Only after the orchestrator left it an hour, or let go (the-status-tells-the-truth decision 2).
      return why ? sentence(`Handed back, unanswered: ${why}`) : 'Handed back, unanswered.'
  }
}

/**
 * Where a need's tap lands: the feature's chat, and for a worker's need that
 * worker's thread, named the way the web addresses an open thread (`?thread=`).
 */
function needUrl(feature: Pick<Feature, 'projectId' | 'slug'>, need: NeedsYouData): string {
  const chat = path('p', feature.projectId, 'f', feature.slug, 'chat')
  return need.kind === 'worker' && need.threadId ? `${chat}?${new URLSearchParams({ thread: need.threadId })}` : chat
}

/**
 * Push `event` to every phone when it is a need that pings; null when it is not
 * one. No phone subscribed sends nothing, quietly. A push that reached a phone
 * leaves one timeline line, as `notify_human`'s does.
 */
export async function pushNeed(ctx: AppCtx, event: EventRow, send?: PushSender): Promise<PushOutcome | null> {
  if (event.type !== FEATURE_NEEDS_YOU || !event.featureId || !needPings(event.data)) return null
  const feature = tryGetFeature(ctx, event.featureId)
  if (!feature) return null
  const outcome = await sendPushToAll(
    ctx,
    {
      title: feature.title,
      body: needPushBody(event.data),
      url: needUrl(feature, event.data),
    },
    send,
  )
  if (outcome.sent > 0) {
    emit(ctx, feature.id, {
      type: 'notification.sent',
      message: `pinged your phone: ${event.data.words}`,
      data: { sent: outcome.sent, need: event.data.kind },
    })
  }
  return outcome
}

/**
 * Subscribe the phone pings to the live event bus; returns the unsubscribe.
 * Called once at boot, beside the need watch. Nothing here throws into the
 * emitter.
 */
export function startNeedPush(ctx: AppCtx, send?: PushSender): () => void {
  return subscribeLive((signal) => {
    if (signal.kind !== 'event') return
    const event = getEventRow(ctx, signal.eventId)
    if (!event || event.type !== FEATURE_NEEDS_YOU) return
    pushNeed(ctx, event, send).catch((err) => console.error('need push failed', err))
  })
}
