import { and, desc, eq } from 'drizzle-orm'
import { events } from '../db/schema'
import type { AppCtx } from '../db/types'
import { newestThread } from '../launcher/sessions'
import { hasThreadLog } from '../threads/log'
import { agentHost } from '../threads/types'
import { emit } from './events'
import { setInvolvement } from './involvement'
import { LEAD_HANDED_BACK } from './lead-handback'
import { getFeatureRow } from './repo'
import { setWait, waitOf } from './waits'

/**
 * The mark migration 0079 leaves, before it drops `sessions.autopilot`, on
 * every open feature of an epic that had autopilot on (`autopilot-retires`
 * decision 13). Its data is `{ epicId }`.
 */
export const AUTOPILOT_RETIRED = 'feature.autopilot_retired'

/** The mark this step leaves once a feature is upgraded: the "ran once" marker. */
export const AUTOPILOT_UPGRADED = 'feature.autopilot_upgraded'

/** What a feature's lead reads, held for its next message, once autopilot is gone. */
export const AUTOPILOT_GONE_NOTE =
  '[runcastle] Autopilot is retired: your epic no longer answers for you. Ask the human what you need in your reply ' +
  'and call wait_for_you; hand_back is only for trouble that crosses features (a conflict you cannot settle, stuck ' +
  'after three tries, a stop for money, accounts or anything outside git that cannot be undone).'

/** What one feature's upgrade did. */
export interface AutopilotUpgrade {
  featureId: string
  /** The level moved from "Everything" to "Result only". */
  leveled: boolean
  /** The question the lead (or a worker) had asked the epic, now the lead chat's wait. */
  returnedWait: string | null
}

/**
 * Once per marked feature, after the migrations (decision 13): a feature still
 * open at "Everything" moves to "Result only" through the involvement service,
 * so its lead is told; a level the human set by hand stays. A question the lead
 * or a worker had handed to the epic and that nothing has followed goes back to
 * the lead's chat as its wait, so the human sees it as "needs you"; it is set
 * before the level changes, so the involvement service tells the lead to keep
 * it or decide it at the new level. The lead gets one held note that autopilot
 * is gone. Idempotent: a feature with {@link AUTOPILOT_UPGRADED} is skipped.
 */
export async function upgradeAutopilotFeatures(ctx: AppCtx): Promise<AutopilotUpgrade[]> {
  const marked = ctx.db
    .select({ featureId: events.featureId })
    .from(events)
    .where(eq(events.type, AUTOPILOT_RETIRED))
    .all()
  const done: AutopilotUpgrade[] = []
  for (const featureId of new Set(marked.map((m) => m.featureId).filter((id): id is string => !!id))) {
    try {
      const result = await upgradeOne(ctx, featureId)
      if (result) done.push(result)
    } catch (err) {
      console.error(`could not move feature ${featureId} off autopilot`, err)
    }
  }
  return done
}

async function upgradeOne(ctx: AppCtx, featureId: string): Promise<AutopilotUpgrade | null> {
  if (newestOfType(ctx, featureId, AUTOPILOT_UPGRADED)) return null
  const feature = getFeatureRow(ctx, featureId)
  const open = feature.status === 'draft' || feature.status === 'active'
  const lead = newestThread(ctx, { featureId }, 'chat')
  const talked = !!lead && !!(lead.ccSessionId || hasThreadLog(lead.id))
  const ask = open && lead && !waitOf(ctx, lead.id) ? openAsk(ctx, featureId) : null
  const returnedWait = (ask && lead && setWait(ctx, lead.id, ask, 'agent')?.why) || null
  const leveled = open && feature.involvement === 'everything'
  if (leveled) await setInvolvement(ctx, featureId, 'resultOnly', { by: 'upgrade' })
  if (open && talked && lead) {
    await agentHost(ctx)
      .prompt(lead.id, { text: AUTOPILOT_GONE_NOTE }, { source: 'runcastle', hold: true, display: { summary: 'Autopilot is retired' } })
      .catch((err) => console.error(`could not hold the autopilot note for ${feature.slug}`, err))
  }
  emit(ctx, featureId, {
    type: AUTOPILOT_UPGRADED,
    message: leveled ? 'autopilot retired: "Involve me in" moved to Result only' : 'autopilot retired',
    data: { leveled, returnedWait },
  })
  return { featureId, leveled, returnedWait }
}

/**
 * The question the feature last handed to its epic, if it is the newest
 * handback: a `wait_for_you` sent to the epic on autopilot (`asks`), worded for
 * the lead's chat. A later handback means the lead moved on.
 */
function openAsk(ctx: AppCtx, featureId: string): string | null {
  const last = newestOfType(ctx, featureId, LEAD_HANDED_BACK)
  const data = (last?.data ?? null) as { asks?: boolean; summary?: string; worker?: string } | null
  if (!data?.asks || !data.summary?.trim()) return null
  return data.worker ? `${data.worker}: ${data.summary.trim()}` : data.summary.trim()
}

function newestOfType(ctx: AppCtx, featureId: string, type: string): { data: unknown } | undefined {
  return ctx.db
    .select({ data: events.data })
    .from(events)
    .where(and(eq(events.featureId, featureId), eq(events.type, type)))
    .orderBy(desc(events.id))
    .limit(1)
    .get()
}
