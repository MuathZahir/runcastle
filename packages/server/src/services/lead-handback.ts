import { READY_TO_TEST, type Feature, type WorkerRow } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { GateError } from '../errors'
import { agentHost } from '../threads/types'
import { mayStartInBackground } from './database-copy'
import { emit } from './events'
import { getSessionRow } from '../launcher/sessions'
import { holderName, passAtPlanYes } from './holding'
import { getFeatureRow } from './repo'
import { setHandback } from './lead-status'
import { listWorkers } from '../workers/service'

/** The event a lead's handback leaves on its feature's timeline. */
export const LEAD_HANDED_BACK = 'lead.handed_back'

/**
 * The one line of the feature's state runcastle adds to a lead's handback
 * (`agents-are-woken-only-when-it-matters` decision 21): ready to test or not,
 * what it waits on, and how many of its workers are at work, so the
 * orchestrator needs no fetch.
 */
export function handbackStateLine(feature: Pick<Feature, 'waitingReason'>, workers: readonly Pick<WorkerRow, 'status'>[]): string {
  const ready = feature.waitingReason === READY_TO_TEST
  const parts = [ready ? 'Ready to test' : 'Not declared ready']
  if (feature.waitingReason && !ready) parts.push(`waits on the human: ${feature.waitingReason}`)
  const working = workers.filter((w) => w.status === 'working' || w.status === 'queued').length
  parts.push(working ? `${working} ${working === 1 ? 'worker' : 'workers'} at work` : 'no workers at work')
  return parts.join(' · ')
}

/**
 * A lead hands back (decisions 20–22; every-feature-has-one-owner decisions 14,
 * 20): one runcastle prompt into a chat, shown as a feature handback card,
 * waking it once. It goes to the owner chat; on a human-owned feature, to its
 * chat, as a question that leaves the owner as it is, except at the plan's yes
 * (`planAgreed`) on a feature its chat finishes, which first passes the feature
 * to that chat. Refused when the feature has neither. In a test drive's copied
 * database it never starts a chat the drive has not started
 * (drives-never-touch-real-conversations decision 9), and says so to the lead.
 */
export async function handBackToOrchestrator(
  ctx: AppCtx,
  feature: Feature,
  summary: string,
  opts: { planAgreed?: boolean } = {},
): Promise<{ deliveredTo: string; state: string; passed?: true }> {
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
  const passed = opts.planAgreed === true && passAtPlanYes(ctx, feature)
  if (passed) feature = getFeatureRow(ctx, feature.id)
  const state = handbackStateLine(feature, listWorkers(ctx, feature.id))
  const text =
    `[runcastle] ${feature.slug} handed back:\n${summary.trim()}\n` +
    `State: ${state}. ` +
    (feature.heldBy === holder.id
      ? `${passed ? 'Its plan has the yes, so you own it now. ' : ''}Reply with send_to_feature({ slug: "${feature.slug}" }), or merge it when it is ready.`
      : `The human owns this feature: answer its lead with send_to_feature({ slug: "${feature.slug}" }); nothing else changes it.`)
  await agentHost(ctx).prompt(
    holder.id,
    { text },
    { source: 'runcastle', display: { featureHandback: { featureId: feature.id, title: feature.title, summary: summary.trim(), state } } },
  )
  const name = holderName(holder)
  // Outstanding until the orchestrator acts, the human writes, or the hold moves
  // (the-status-tells-the-truth decisions 5, 7); a newer handback replaces it.
  setHandback(ctx, feature.id, summary.trim())
  emit(ctx, feature.id, {
    type: LEAD_HANDED_BACK,
    message: `handed back to the orchestrator chat "${name}"`,
    data: { holderId: holder.id, summary: summary.trim(), state, owner: feature.heldBy ?? null },
  })
  return { deliveredTo: name, state, ...(passed ? { passed: true as const } : {}) }
}
