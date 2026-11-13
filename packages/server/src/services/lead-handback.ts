import { type Feature, type Need, readyToTestWhy, type WorkerRow } from '@runcastle/core'
import { appendThreadEvent } from '../threads/log'
import { seedFromTranscript } from '../threads/read'
import type { AppCtx } from '../db/types'
import { GateError } from '../errors'
import { agentHost } from '../threads/types'
import { mayStartInBackground } from './database-copy'
import { emit } from './events'
import { getSessionRow } from '../launcher/sessions'
import { chatNameOf, holderName } from './holding'
import { waitOf } from './waits'
import { listWorkers } from '../workers/service'

/** The event a lead's handback leaves on its feature's timeline. */
export const LEAD_HANDED_BACK = 'lead.handed_back'

/**
 * The one line of the feature's state runcastle adds to a lead's handback
 * (`agents-are-woken-only-when-it-matters` decision 21): ready to test or not,
 * what it waits on, and how many of its workers are at work, so the
 * orchestrator needs no fetch.
 */
export function handbackStateLine(wait: Pick<Need, 'why'> | null, workers: readonly Pick<WorkerRow, 'status'>[]): string {
  const ready = !!wait?.why.startsWith(readyToTestWhy(''))
  const parts = [ready ? 'Ready to test' : 'Not declared ready']
  if (wait && !ready) parts.push(`waits on the human: ${wait.why}`)
  const working = workers.filter((w) => w.status === 'working' || w.status === 'queued').length
  parts.push(working ? `${working} ${working === 1 ? 'worker' : 'workers'} at work` : 'no workers at work')
  return parts.join(' · ')
}

/**
 * A lead hands back (decisions 20–22; every-feature-has-one-owner decisions 14,
 * 20): one runcastle prompt into a chat, shown as a feature handback card,
 * waking it once. It goes to the owner chat; on a human-owned feature, to its
 * chat, as a question that leaves the owner as it is (a handback never moves
 * the owner: one-place-to-answer decision 8). Refused when the feature has
 * neither. In a test drive's copied
 * database it never starts a chat the drive has not started
 * (drives-never-touch-real-conversations decision 9), and says so to the lead.
 */
export async function handBackToOrchestrator(
  ctx: AppCtx,
  feature: Feature,
  summary: string,
  leadSessionId?: string,
): Promise<{ deliveredTo: string; state: string }> {
  const live = feature.status !== 'shipped'
  const targetId = live ? (feature.heldBy ?? feature.chatId) : null
  const holder = targetId ? getSessionRow(ctx, targetId) : null
  if (!holder || holder.kind !== 'project') {
    throw new GateError(
      'this feature has no orchestrator chat to hand back to: ask the human in your chat with wait_for_you instead',
    )
  }
  if (!mayStartInBackground(holder)) {
    throw new GateError('this test drive has not started the orchestrator chat of this feature, so the handback was not sent')
  }
  const state = handbackStateLine(leadSessionId ? waitOf(ctx, leadSessionId) : null, listWorkers(ctx, feature.id))
  const text =
    `[runcastle] ${feature.slug} handed back:\n${summary.trim()}\n` +
    `State: ${state}. ` +
    (feature.heldBy === holder.id
      ? `Reply with send_to_feature({ slug: "${feature.slug}" }), or merge it when it is ready.`
      : `The human owns this feature: answer its lead with send_to_feature({ slug: "${feature.slug}" }), giving facts and your recommendation even when the call is the human's. The lead asks them in the feature's chat; do not ask them here. Nothing else changes it.`)
  await agentHost(ctx).prompt(
    holder.id,
    { text },
    { source: 'runcastle', display: { featureHandback: { featureId: feature.id, title: feature.title, summary: summary.trim(), state } } },
  )
  const name = holderName(holder)
  emit(ctx, feature.id, {
    type: LEAD_HANDED_BACK,
    message: `handed back to the orchestrator chat "${name}"`,
    data: { holderId: holder.id, summary: summary.trim(), state, owner: feature.heldBy ?? null },
  })
  return { deliveredTo: name, state }
}

/** The line the feature's chat shows when it became the human's because it needed them (one-place-to-answer decision 13). */
export function handOverLine(epicName: string): string {
  return `This is yours now: it needed you. ${epicName} carries on with the rest of the batch.`
}

/** What the epic tells the human, once, when a feature it ran became theirs (decision 13). */
export function needsYouLine(featureTitle: string): string {
  return `${featureTitle} needs you, so it's yours now. Open its chat to answer.`
}

/**
 * The runcastle line in the lead's chat at the point the feature became the
 * human's because it needed them (decision 13): a quiet notice, not the
 * agent's words, above the question it is about to wait on. Only this release
 * writes it; a typed take or the owner button never does.
 */
export function sayHandOver(ctx: AppCtx, leadThreadId: string, epicId: string): void {
  seedFromTranscript(ctx, leadThreadId)
  appendThreadEvent(leadThreadId, { type: 'notice', text: handOverLine(chatNameOf(ctx, epicId)) })
}

/**
 * Wake the epic that owned a feature which became the human's because it
 * needed them (one-place-to-answer decision 9), once, to tell the human the one
 * line and carry on with the rest of the batch. Skipped in a test drive's
 * copied database that has not started that chat.
 */
export async function wakeEpicNeedsYou(ctx: AppCtx, feature: Feature, epicId: string): Promise<void> {
  const epic = getSessionRow(ctx, epicId)
  if (!epic || epic.kind !== 'project' || !mayStartInBackground(epic)) return
  const text =
    `[runcastle] ${feature.title} (${feature.slug}) needed the human, so it is theirs now. ` +
    `Tell them in one line: "${needsYouLine(feature.title)}" and nothing more about it; ` +
    'carry on with the rest of the batch.'
  await agentHost(ctx).prompt(
    epic.id,
    { text },
    {
      source: 'runcastle',
      display: {
        news: [{ featureId: feature.id, title: feature.title, events: [{ tone: 'needsYou', words: 'Needs you, so it is yours now' }] }],
      },
    },
  )
}
