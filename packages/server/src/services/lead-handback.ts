import { type Feature, type Need, readyToTestWhy, type WorkerRow } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { GateError } from '../errors'
import { agentHost } from '../threads/types'
import { autopilotOf } from './autopilot'
import { mayStartInBackground } from './database-copy'
import { emit } from './events'
import { getSessionRow } from '../launcher/sessions'
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

/** The refusal of a handback off autopilot: the lead talks to the human, in its own chat. */
export const NOT_ON_AUTOPILOT =
  'this feature is not on autopilot, so it is the human\'s and there is no epic to hand back to: ' +
  'ask the human in your chat with wait_for_you instead'

/**
 * A lead reports to its epic (`epics-on-autopilot` decisions 3, 17): one
 * runcastle prompt into the epic's chat, shown as a feature handback card,
 * waking it once. Only on autopilot: off it the feature is the human's, and the
 * handback is refused with a pointer to `wait_for_you`. `asks` is a
 * `wait_for_you` the lead called anyway, delivered the same way, with no need
 * set on the feature. In a test drive's copied database it never starts a chat
 * the drive has not started (drives-never-touch-real-conversations decision 9),
 * and says so to the lead.
 */
export async function handBackToOrchestrator(
  ctx: AppCtx,
  feature: Feature,
  summary: string,
  leadSessionId?: string,
  opts: { asks?: boolean } = {},
): Promise<{ deliveredTo: string; state: string }> {
  const lock = feature.status !== 'shipped' ? autopilotOf(ctx, feature) : null
  const epic = lock ? getSessionRow(ctx, lock.epicId) : null
  if (!lock || !epic || epic.kind !== 'project') throw new GateError(NOT_ON_AUTOPILOT)
  if (!mayStartInBackground(epic)) {
    throw new GateError('this test drive has not started the epic of this feature, so the handback was not sent')
  }
  const said = summary.trim()
  const state = handbackStateLine(leadSessionId ? waitOf(ctx, leadSessionId) : null, listWorkers(ctx, feature.id))
  const head = opts.asks
    ? `[runcastle] ${feature.slug} asks for the human (its lead called wait_for_you; it is on autopilot, so it comes to you):\n${said}\n`
    : `[runcastle] ${feature.slug} handed back:\n${said}\n`
  const text =
    head +
    `State: ${state}. ` +
    `Answer its lead with send_to_feature({ slug: "${feature.slug}" }) when you can; ask the human here only what you cannot decide for them.`
  await agentHost(ctx).prompt(
    epic.id,
    { text },
    { source: 'runcastle', display: { featureHandback: { featureId: feature.id, title: feature.title, summary: said, state } } },
  )
  emit(ctx, feature.id, {
    type: LEAD_HANDED_BACK,
    message: `${opts.asks ? 'asked' : 'handed back to'} the epic "${lock.epicName}"`,
    data: { holderId: epic.id, summary: said, state, ...(opts.asks ? { asks: true } : {}) },
  })
  return { deliveredTo: lock.epicName, state }
}
