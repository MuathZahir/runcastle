import { type Feature, type Need, readyToTestWhy, type ShownWorkerStatus } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { GateError } from '../errors'
import { agentHost } from '../threads/types'
import { mayStartInBackground } from './database-copy'
import { emit } from './events'
import { getSessionRow } from '../launcher/sessions'
import { chatName } from '../threads/chat-name'
import { waitOf } from './waits'
import { listWorkers, shownStatusOf } from '../workers/service'

/** The event a lead's handback leaves on its feature's timeline. */
export const LEAD_HANDED_BACK = 'lead.handed_back'

/**
 * The one line of the feature's state runcastle adds to a lead's handback
 * (`agents-are-woken-only-when-it-matters` decision 21): ready to test or not,
 * what it waits on, and how many of its workers are at work, so the
 * orchestrator needs no fetch.
 */
export function handbackStateLine(wait: Pick<Need, 'why'> | null, shown: readonly ShownWorkerStatus[]): string {
  const ready = !!wait?.why.startsWith(readyToTestWhy(''))
  const parts = [ready ? 'Ready to test' : 'Not declared ready']
  if (wait && !ready) parts.push(`waits on the human: ${wait.why}`)
  // As shown: a worker with no turn running is not at work (a-worker-never-shows-working-with-nothing-running decision 1).
  const working = shown.filter((s) => s === 'working' || s === 'queued').length
  parts.push(working ? `${working} ${working === 1 ? 'worker' : 'workers'} at work` : 'no workers at work')
  const stalled = shown.filter((s) => s === 'stalled').length
  if (stalled) parts.push(`${stalled} stalled`)
  return parts.join(' · ')
}

/** The refusal of a handback from a feature with no epic: the human made it, so there is nobody else to tell. */
export const NO_EPIC =
  'this feature has no epic (the human made it with New feature), so there is no orchestrator to hand back to: ' +
  'tell the human in your reply and call wait_for_you instead'

/**
 * A lead tells its epic about trouble that crosses features
 * (`autopilot-retires` decision 9): a merge conflict it cannot settle, stuck
 * after three tries, or a stop for money, accounts or anything outside git that
 * cannot be undone (those also wait on the human in the feature's chat). One
 * runcastle prompt into the epic's chat, shown as a feature handback card,
 * waking it once. Refused for a feature with no epic. In a test drive's copied
 * database it never starts a chat the drive has not started
 * (drives-never-touch-real-conversations decision 9), and says so to the lead.
 */
export async function handBackToOrchestrator(
  ctx: AppCtx,
  feature: Feature,
  summary: string,
  leadSessionId?: string,
): Promise<{ deliveredTo: string; state: string }> {
  const epic = feature.chatId ? getSessionRow(ctx, feature.chatId) : null
  if (!epic || epic.kind !== 'project') throw new GateError(NO_EPIC)
  if (!mayStartInBackground(epic)) {
    throw new GateError('this test drive has not started the epic of this feature, so the handback was not sent')
  }
  const said = summary.trim()
  const state = handbackStateLine(
    leadSessionId ? waitOf(ctx, leadSessionId) : null,
    listWorkers(ctx, feature.id).map((w) => shownStatusOf(ctx, w)),
  )
  const text =
    `[runcastle] ${feature.slug} hit trouble that crosses features:\n${said}\n` +
    `State: ${state}. Answer its lead with send_to_feature({ slug: "${feature.slug}" }) when you can; ` +
    'what the human must decide, its lead asks them in the feature\'s own chat.'
  await agentHost(ctx).prompt(
    epic.id,
    { text },
    { source: 'runcastle', display: { featureHandback: { featureId: feature.id, title: feature.title, summary: said, state } } },
  )
  const epicName = chatName(epic)
  emit(ctx, feature.id, {
    type: LEAD_HANDED_BACK,
    message: `handed back to the epic "${epicName}"`,
    data: { holderId: epic.id, summary: said, state },
  })
  return { deliveredTo: epicName, state }
}
