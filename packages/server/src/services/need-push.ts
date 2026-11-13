import { FEATURE_NEEDS_YOU, type EventRow, needPings } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { getSessionRow } from '../launcher/sessions'
import { subscribeLive } from './bus'
import { emitScoped, getEventRow } from './events'
import { chatName } from '../threads/chat-name'
import { type PushOutcome, type PushSender, sendPushToAll } from './push'
import { tryGetFeature } from './repo'

/**
 * Runcastle's own phone pings (needs-you-is-the-agent-s-call decision 14): one
 * push to every subscribed phone each time a chat enters a need, saying the
 * agent's line — the same {@link needPings} rule as the desktop, so the two
 * never disagree. `notify_human` stays for what agents want to say beyond a wait.
 */

const path = (...segments: string[]): string =>
  `/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`

/** `text` as a sentence: a full stop added unless it already ends in one. */
function sentence(text: string): string {
  return /[.?!…]$/.test(text) ? text : `${text}.`
}

/** What a push for a need says: the agent's line, as a sentence. */
export function needPushBody(why: string): string {
  return sentence(why)
}

/**
 * Push `event` to every phone when it is a need that pings; null when it is not
 * one. The tap opens the exact chat the need waits in (decision 3): a feature's
 * chat, or an orchestrator chat. No phone subscribed sends nothing, quietly. A
 * push that reached a phone leaves one timeline line, as `notify_human`'s does.
 */
export async function pushNeed(ctx: AppCtx, event: EventRow, send?: PushSender): Promise<PushOutcome | null> {
  if (event.type !== FEATURE_NEEDS_YOU || !needPings(event.data)) return null
  const need = event.data
  const thread = `?${new URLSearchParams({ thread: need.threadId })}`
  const feature = need.featureId ? tryGetFeature(ctx, need.featureId) : null
  let message: { title: string; url: string }
  if (feature) {
    message = { title: feature.title, url: `${path('p', feature.projectId, 'f', feature.slug, 'chat')}${thread}` }
  } else {
    const chat = getSessionRow(ctx, need.threadId)
    if (!chat?.projectId) return null
    message = { title: chatName(chat), url: `${path('p', chat.projectId, 'chat')}${thread}` }
  }
  const outcome = await sendPushToAll(ctx, { ...message, body: needPushBody(need.why) }, send)
  if (outcome.sent > 0) {
    emitScoped(ctx, feature ? { featureId: feature.id } : { projectId: event.projectId }, {
      type: 'notification.sent',
      message: `pinged your phone: ${need.why}`,
      data: { sent: outcome.sent, threadId: need.threadId },
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
