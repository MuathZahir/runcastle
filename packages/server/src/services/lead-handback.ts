import { type Feature, type Need, readyToTestWhy, type ShownWorkerStatus } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { GateError } from '../errors'
import { agentHost } from '../threads/types'
import { autopilotOf } from './autopilot'
import { mayStartInBackground } from './database-copy'
import { emit } from './events'
import { getSessionRow, newestThread } from '../launcher/sessions'
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

/** The refusal of a handback off autopilot: the lead talks to the human, in its own chat. */
export const NOT_ON_AUTOPILOT =
  'this feature is not on autopilot, so it is the human\'s and there is no epic to hand back to: ' +
  'ask the human in your reply and call wait_for_you instead'

/**
 * A lead reports to its epic (`epics-on-autopilot` decisions 3, 17): one
 * runcastle prompt into the epic's chat, shown as a feature handback card,
 * waking it once. Only on autopilot: off it the feature is the human's, and the
 * handback is refused with a pointer to `wait_for_you`. `asks` is a
 * `wait_for_you` the lead, or one of its workers (`worker`, the worker's
 * label), called anyway, delivered the same way, with no need set on the
 * feature or the worker. In a test drive's copied database it never starts a chat
 * the drive has not started (drives-never-touch-real-conversations decision 9),
 * and says so to the lead.
 */
export async function handBackToOrchestrator(
  ctx: AppCtx,
  feature: Feature,
  summary: string,
  leadSessionId?: string,
  opts: { asks?: boolean; worker?: string } = {},
): Promise<{ deliveredTo: string; state: string }> {
  const lock = autopilotOf(ctx, feature)
  const epic = lock ? getSessionRow(ctx, lock.epicId) : null
  if (!lock || !epic || epic.kind !== 'project') throw new GateError(NOT_ON_AUTOPILOT)
  if (!mayStartInBackground(epic)) {
    throw new GateError('this test drive has not started the epic of this feature, so the handback was not sent')
  }
  const said = summary.trim()
  const state = handbackStateLine(
    leadSessionId ? waitOf(ctx, leadSessionId) : null,
    listWorkers(ctx, feature.id).map((w) => shownStatusOf(ctx, w)),
  )
  const who = opts.worker ? `its worker "${opts.worker}"` : 'its lead'
  const head = opts.asks
    ? `[runcastle] ${feature.slug} asks for the human (${who} called wait_for_you; it is on autopilot, so it comes to you):\n${said}\n`
    : `[runcastle] ${feature.slug} handed back:\n${said}\n`
  const answer = opts.worker
    ? `Answer through its lead with send_to_feature({ slug: "${feature.slug}" }), naming the worker, when you can`
    : `Answer its lead with send_to_feature({ slug: "${feature.slug}" }) when you can`
  const text = head + `State: ${state}. ` + `${answer}; ask the human here only what you cannot decide for them.`
  await agentHost(ctx).prompt(
    epic.id,
    { text },
    { source: 'runcastle', display: { featureHandback: { featureId: feature.id, title: feature.title, summary: said, state } } },
  )
  emit(ctx, feature.id, {
    type: LEAD_HANDED_BACK,
    message: `${opts.asks ? `${opts.worker ? `the worker "${opts.worker}" ` : ''}asked` : 'handed back to'} the epic "${lock.epicName}"`,
    data: { holderId: epic.id, summary: said, state, ...(opts.asks ? { asks: true } : {}), ...(opts.worker ? { worker: opts.worker } : {}) },
  })
  return { deliveredTo: lock.epicName, state }
}

/**
 * A worker of a locked feature called `wait_for_you` (`epics-on-autopilot`
 * decision 17): its question goes to the epic as its lead's does, and the
 * worker reads no "needs you". The state line reads the lead's own wait.
 */
export function workerAsksEpic(ctx: AppCtx, feature: Feature, workerLabel: string, why: string): Promise<{ deliveredTo: string; state: string }> {
  const lead = newestThread(ctx, { featureId: feature.id }, 'chat')
  return handBackToOrchestrator(ctx, feature, why, lead?.id, { asks: true, worker: workerLabel })
}
