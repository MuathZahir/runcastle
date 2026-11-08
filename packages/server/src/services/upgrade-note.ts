import type { Feature, Ticket } from '@runcastle/core'
import { projects } from '../db/schema'
import type { AppCtx } from '../db/types'
import { newestThread } from '../launcher/sessions'
import { hasThreadLog } from '../threads/log'
import { agentHost } from '../threads/types'
import { emit, latestEventTs } from './events'
import { list as listFeatures } from './features'
import { listByFeature } from './tickets'

/** The event that records a feature's lead was given the note: the "ran once" marker (burns-become-workers decision 20). */
export const UPGRADE_NOTE_EVENT = 'tickets.upgrade_note'

const OPEN: ReadonlySet<Ticket['status']> = new Set(['pending', 'burning', 'failed'])

/** The note itself: each ticket not done, by seq, title and goal, and where its work goes now. */
export function upgradeNoteText(open: readonly Ticket[]): string {
  const lines = open.map((t) => `- #${t.seq} ${t.title} (${t.status}) — ${t.goal}`)
  return [
    '[runcastle] Runcastle no longer runs tickets or rounds: the ticket machinery is gone, and these tickets of yours will never run. They stay in the history as they were.',
    ...lines,
    'Hand any of this work you still want to workers (start_worker).',
  ].join('\n')
}

/**
 * Once per feature, after the migrations: hold one note on the lead's next
 * message for each active feature with tickets not done or cancelled. Held, so
 * it wakes nothing; a feature whose lead has no conversation yet is left for a
 * later boot. Nothing is dropped from the tables.
 */
export async function holdUpgradeNotes(ctx: AppCtx): Promise<number> {
  let held = 0
  const projectIds = ctx.db.select({ id: projects.id }).from(projects).all().map((p) => p.id)
  for (const projectId of projectIds) {
    for (const feature of listFeatures(ctx, projectId)) {
      try {
        if (await holdFor(ctx, feature)) held += 1
      } catch (err) {
        console.error(`could not hold the ticket upgrade note for ${feature.slug}`, err)
      }
    }
  }
  return held
}

async function holdFor(ctx: AppCtx, feature: Feature): Promise<boolean> {
  if (feature.status === 'shipped' || feature.status === 'archived') return false
  if (latestEventTs(ctx, feature.id, UPGRADE_NOTE_EVENT) !== undefined) return false
  const open = listByFeature(ctx, feature.id).filter((t) => t.kind === 'implementation' && OPEN.has(t.status))
  if (open.length === 0) return false
  const lead = newestThread(ctx, { featureId: feature.id }, 'chat')
  if (!lead || !(lead.ccSessionId || hasThreadLog(lead.id))) return false
  await agentHost(ctx).prompt(lead.id, { text: upgradeNoteText(open) }, {
    source: 'runcastle',
    hold: true,
    display: { summary: 'Tickets are gone: a note on your unfinished ones' },
  })
  emit(ctx, feature.id, {
    type: UPGRADE_NOTE_EVENT,
    message: `held a note on ${open.length} unfinished ticket(s) for the lead's next message`,
    data: { seqs: open.map((t) => t.seq) },
  })
  return true
}
