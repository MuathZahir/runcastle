import { READY_TO_TEST, type Feature, type RoundSummary } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { GateError } from '../errors'
import { agentHost } from '../threads/types'
import { mayStartInBackground } from './database-copy'
import { emit } from './events'
import { holderName, holderOf } from './holding'
import { listRounds } from './runs'

/** The event a lead's handback leaves on its feature's timeline. */
export const LEAD_HANDED_BACK = 'lead.handed_back'

const ROUND_WORDS: Record<RoundSummary['status'], string> = {
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
  cancelled: 'cancelled',
}

/**
 * The one line of the feature's state runcastle adds to a lead's handback
 * (`agents-are-woken-only-when-it-matters` decision 21): ready to test or not,
 * what it waits on, and its latest round, so the orchestrator needs no fetch.
 */
export function handbackStateLine(feature: Pick<Feature, 'waitingReason'>, rounds: readonly RoundSummary[]): string {
  const ready = feature.waitingReason === READY_TO_TEST
  const parts = [ready ? 'Ready to test' : 'Not declared ready']
  if (feature.waitingReason && !ready) parts.push(`waits on the human: ${feature.waitingReason}`)
  const latest = rounds.at(-1)
  parts.push(latest ? `round ${latest.round} ${ROUND_WORDS[latest.status]}` : 'no rounds yet')
  return parts.join(' · ')
}

/**
 * A lead hands back to the orchestrator thread that holds its feature
 * (decisions 20–22): one runcastle prompt into the holder, shown as a feature
 * handback card, waking it once. Refused when no orchestrator holds the
 * feature. In a test drive's copied database it never starts a holder the drive
 * has not started (drives-never-touch-real-conversations decision 9), and says
 * so to the lead.
 */
export async function handBackToOrchestrator(
  ctx: AppCtx,
  feature: Feature,
  summary: string,
): Promise<{ deliveredTo: string; state: string }> {
  const holder = feature.status === 'shipped' ? null : holderOf(ctx, feature)
  if (!holder || holder.kind !== 'project') {
    throw new GateError(
      'no orchestrator holds this feature, so there is nobody to hand back to: tell the human in your chat instead',
    )
  }
  if (!mayStartInBackground(holder)) {
    throw new GateError('this test drive has not started the orchestrator chat that holds this feature, so the handback was not sent')
  }
  const state = handbackStateLine(feature, listRounds(ctx, feature.id))
  const text =
    `[runcastle] ${feature.slug} handed back:\n${summary.trim()}\n` +
    `State: ${state}. Reply with send_to_feature({ slug: "${feature.slug}" }), or merge it when it is ready.`
  await agentHost(ctx).prompt(
    holder.id,
    { text },
    { source: 'runcastle', display: { featureHandback: { featureId: feature.id, title: feature.title, summary: summary.trim(), state } } },
  )
  const name = holderName(holder)
  emit(ctx, feature.id, {
    type: LEAD_HANDED_BACK,
    message: `handed back to the orchestrator chat "${name}"`,
    data: { holderId: holder.id, summary: summary.trim(), state },
  })
  return { deliveredTo: name, state }
}
