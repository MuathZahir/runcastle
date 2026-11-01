import type { SessionRow } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { GateError } from '../errors'
import { emitForSession } from '../services/events'
import { holderName, holderOf } from '../services/holding'
import { type PushMessage, type PushSender, sendPushToAll } from '../services/push'
import { getFeatureRow } from '../services/repo'
import { requireOrchestratorSession } from './orchestrator-tools'

/**
 * The tool that notifies the human's phone (`agents-can-notify-your-phone`).
 * An agent's call is the only thing that ever sends: no event, wait or failure
 * does. Who may call follows who runs the feature (decision 3), and is checked
 * here because the rule must hold whatever an agent's instructions say. The
 * server does not look at when the human last typed (decision 2).
 */

/** The most a notification's sentence may hold (decision 6). */
export const NOTIFY_MAX_CHARS = 200

/** What the human should turn on, for a tool answer the agent passes on. */
const NO_PHONE_NOTE =
  'No phone has notifications on, so nothing was sent. Tell the human in this chat: with the ' +
  'phone link on (Settings, On your phone), switch on Notifications at the foot of the feature ' +
  'list on their phone. If it already says on, switch it off and on again.'

const NOT_SENT_NOTE =
  'The notification could not be sent to any phone. Tell the human in this chat, and do not ' +
  'count on them having seen it.'

const path = (...segments: string[]): string =>
  `/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`

/** Who a notification comes from, or the refusal: the title it shows and the chat a tap opens. */
function sender(ctx: AppCtx, session: SessionRow): Pick<PushMessage, 'title' | 'url'> {
  const thread = `?thread=${encodeURIComponent(session.id)}`
  if (session.kind === 'project') {
    const projectId = requireOrchestratorSession(session)
    return { title: holderName(session), url: `${path('p', projectId, 'chat')}${thread}` }
  }
  if (session.kind !== 'chat' || !session.featureId) {
    throw new GateError(
      `only an orchestrator thread or a feature's main chat may notify the human, and this is a ${session.kind} session.`,
    )
  }
  const feature = getFeatureRow(ctx, session.featureId)
  const holder = holderOf(ctx, feature)
  if (holder) {
    throw new GateError(
      `the thread "${holderName(holder)}" holds this feature, so only it may notify the human. ` +
        'Say in this chat that you cannot ping them and why; they can ask that thread.',
    )
  }
  return {
    title: feature.title,
    url: `${path('p', feature.projectId, 'f', feature.slug, 'chat')}${thread}`,
  }
}

export interface NotifyResult {
  sent: number
  note?: string
}

/** Send the agent's sentence to every phone with notifications on. */
export async function toolNotifyHuman(
  ctx: AppCtx,
  session: SessionRow,
  input: { message: string },
  send?: PushSender,
): Promise<NotifyResult> {
  const from = sender(ctx, session)
  const { phones, sent } = await sendPushToAll(ctx, { ...from, body: input.message }, send)
  if (phones === 0) return { sent, note: NO_PHONE_NOTE }
  if (sent === 0) return { sent, note: NOT_SENT_NOTE }
  // The only record: the sentence itself is not kept (decision 6).
  emitForSession(ctx, session, {
    type: 'notification.sent',
    message: sent === 1 ? 'sent a phone notification' : `sent a phone notification to ${sent} phones`,
    data: { sent },
  })
  return { sent }
}
