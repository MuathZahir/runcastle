import {
  asksDecisions,
  DECIDED_WITHOUT_YOU_MARK,
  type Feature,
  humanMerges,
  INVOLVEMENT_LABEL,
  INVOLVEMENT_NAME,
  type Involvement,
  isReadyToTestWhy,
  showsDesigns,
} from '@runcastle/core'
import { and, eq, inArray } from 'drizzle-orm'
import { features } from '../db/schema'
import type { AppCtx } from '../db/types'
import { GateError } from '../errors'
import { newestThread } from '../launcher/sessions'
import { appendThreadEvent, hasThreadLog } from '../threads/log'
import { seedFromTranscript } from '../threads/read'
import { emit } from './events'
import { deliverToLead } from './lead-delivery'
import { getFeatureRow, rowToFeature } from './repo'
import { waitOf } from './waits'

/**
 * "Involve me in" (`how-involved-am-i`): the one writer of a feature's level.
 * A change emits {@link INVOLVEMENT_CHANGED} on the feature and tells its lead
 * (decision 3): when the lead waits on the human's answer and the new level no
 * longer asks, it is woken to decide the question itself; otherwise it hears
 * the new level as news.
 */

/** The event every level change emits, on the feature's timeline; its data is `{ from, to }`. */
export const INVOLVEMENT_CHANGED = 'feature.involvement_changed'

/**
 * What each level stops for, in the lead's terms: what `get_feature_context`
 * carries and what a lead is told when its level changes. (`INVOLVEMENT_HINT`
 * says the same to the human.)
 */
export const INVOLVEMENT_STOPS_FOR: Record<Involvement, string> = {
  everything: 'Ask the human the decisions, show them new screens for a yes; they try it and merge.',
  designsAndResult: `Decide the small things yourself (each marked ${DECIDED_WITHOUT_YOU_MARK}); show the human new screens for a yes; they try it and merge.`,
  resultOnly: `Plan, design and build it all yourself (each decision marked ${DECIDED_WITHOUT_YOU_MARK}); the human tries it and merges.`,
  nothing: `Plan, design and build it all yourself (each decision marked ${DECIDED_WITHOUT_YOU_MARK}); declare ready with checksPassed: true once your checks pass, and runcastle merges it when no defect is open (record a subagent review's defects with report_finding).`,
}

/** What each level now means, in the human's terms: the second half of the chat's notice row. */
export const INVOLVEMENT_NOTICE_MEANS: Record<Involvement, string> = {
  everything: 'the lead asks you its open questions',
  designsAndResult: 'the lead decides the small things itself',
  resultOnly: 'the lead decides its open questions and screens itself',
  nothing: 'runcastle merges it once it is ready and the review is clean',
}

/** The notice row a level change leaves in the lead's chat: "Involve me in: Result only · the lead decides …". */
export function involvementNotice(level: Involvement): string {
  return `${involvementLine(level)} · ${INVOLVEMENT_NOTICE_MEANS[level]}`
}

/** A feature's level as `get_feature_context` carries it. */
export function involvementView(level: Involvement): { level: Involvement; label: string; stopsFor: string } {
  return { level, label: INVOLVEMENT_LABEL[level], stopsFor: INVOLVEMENT_STOPS_FOR[level] }
}

/** The line `get_feature_context` and the lead's news name a level by. */
export function involvementLine(level: Involvement): string {
  return `${INVOLVEMENT_NAME}: ${INVOLVEMENT_LABEL[level]}`
}

/**
 * Set the feature's level. Refused for a shipped or archived feature (the
 * same features "Set all to…" skips); a level it already has changes nothing
 * and emits nothing. Returns the feature as it now is.
 */
export async function setInvolvement(
  ctx: AppCtx,
  featureId: string,
  level: Involvement,
  opts: { by?: ChangedBy } = {},
): Promise<Feature> {
  const feature = getFeatureRow(ctx, featureId)
  if (feature.status === 'shipped' || feature.status === 'archived') {
    throw new GateError(`\`${feature.slug}\` is ${feature.status}, so its "${INVOLVEMENT_NAME}" no longer changes.`)
  }
  return change(ctx, feature, level, opts.by ?? 'human')
}

/**
 * "Set all to…" on an epic (decision 4): every feature of the orchestrator
 * chat `chatId` that is neither shipped nor archived gets `level`, each with
 * its own event and its own line to its lead. No memory of the old levels is
 * kept (decision 7).
 */
export async function setEpicInvolvement(ctx: AppCtx, chatId: string, level: Involvement): Promise<{ changed: number }> {
  const open = ctx.db
    .select()
    .from(features)
    .where(and(eq(features.chatId, chatId), inArray(features.status, ['draft', 'active'])))
    .orderBy(features.createdAt)
    .all()
    .map(rowToFeature)
  let changed = 0
  for (const feature of open) {
    if (feature.involvement === level) continue
    await change(ctx, feature, level, 'human')
    changed += 1
  }
  return { changed }
}

/** Who changed a level: the human, or runcastle's one-off upgrade off autopilot (autopilot-retires decision 13). */
export type ChangedBy = 'human' | 'upgrade'

async function change(ctx: AppCtx, feature: Feature, to: Involvement, by: ChangedBy): Promise<Feature> {
  const from = feature.involvement
  if (from === to) return feature
  ctx.db.update(features).set({ involvement: to }).where(eq(features.id, feature.id)).run()
  const updated: Feature = { ...feature, involvement: to }
  emit(ctx, feature.id, {
    type: INVOLVEMENT_CHANGED,
    message: involvementLine(to),
    data: { from, to },
  })
  // The level is set; a lead that cannot be told now reads it from its context.
  await tellLead(ctx, updated, to, by).catch((err) => console.error(`telling ${feature.slug}'s lead its level changed failed`, err))
  return updated
}

/** The feature's lead chat when it has a conversation to tell: a draft or a never-opened chat has none. */
function leadToTell(ctx: AppCtx, feature: Feature): { id: string } | null {
  const lead = newestThread(ctx, { featureId: feature.id }, 'chat')
  return lead && (lead.ccSessionId || hasThreadLog(lead.id)) ? lead : null
}

/** What the lead's own wait is on: an answer, a test drive (its "ready"), or nothing of its own. */
function leadWait(ctx: AppCtx, leadId: string): 'answer' | 'ready' | null {
  const wait = waitOf(ctx, leadId)
  if (!wait || wait.by !== 'agent') return null
  return isReadyToTestWhy(wait.why) ? 'ready' : 'answer'
}

/**
 * Tell the lead its level changed: a notice row in its chat for the human,
 * then the line for the lead. Only a chat with a conversation gets either, so
 * a notice never makes a never-opened chat look started. `background` (as the spec asks) keeps a
 * test drive's copied database from waking a conversation it did not start.
 */
async function tellLead(ctx: AppCtx, feature: Feature, to: Involvement, by: ChangedBy): Promise<void> {
  const who = by === 'upgrade' ? 'Runcastle, retiring autopilot,' : 'The human'
  const lead = leadToTell(ctx, feature)
  if (!lead) return
  // The human sees the change in the chat as a notice row, ahead of the line the lead is sent.
  seedFromTranscript(ctx, lead.id)
  appendThreadEvent(lead.id, { type: 'notice', text: involvementNotice(to) })
  const label = INVOLVEMENT_LABEL[to]
  const waiting = leadWait(ctx, lead.id)
  if (!asksDecisions(to) && waiting === 'answer') {
    const designs = showsDesigns(to) ? ' (a new screen’s design still waits for their yes)' : ''
    await deliverToLead(ctx, feature, {
      source: 'runcastle',
      reason: 'question',
      text:
        `${who} changed "${INVOLVEMENT_NAME}" to ${label}; you no longer wait on them for decisions${designs}. ` +
        'If your wait is on something this level still asks (a design’s yes while designs are shown; money, accounts, ' +
        'anything outside git that cannot be undone, or what the brief names as the human’s), keep waiting. ' +
        'Otherwise decide your open question yourself (your recommendation), record it under your decisions with the mark ' +
        `${DECIDED_WITHOUT_YOU_MARK}, withdraw your wait (wait_for_you({ withdraw: true })) and carry on. ` +
        `From now on: ${INVOLVEMENT_STOPS_FOR[to]}`,
      background: true,
    })
    return
  }
  if (!humanMerges(to) && waiting === 'ready') {
    await deliverToLead(ctx, feature, {
      source: 'runcastle',
      reason: 'question',
      text:
        `${who} changed "${INVOLVEMENT_NAME}" to ${label} while the feature waits as Ready to test. ` +
        'Call declare_ready again with the same scenario and checksPassed: true once your checks pass, and runcastle merges it when no defect is open.',
      background: true,
    })
    return
  }
  await deliverToLead(ctx, feature, {
    source: 'runcastle',
    reason: 'news',
    text: `${who} changed "${INVOLVEMENT_NAME}" to ${label}. From now on: ${INVOLVEMENT_STOPS_FOR[to]}`,
    background: true,
  })
}
