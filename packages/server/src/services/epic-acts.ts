import type { Feature } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { GateError } from '../errors'
import { chatNameOf } from '../threads/chat-name'

/**
 * What an orchestrator chat (an epic) may do to a feature
 * (`autopilot-retires` decision 12): one rule. It acts only on its own epic's
 * features (`feature.chatId` is the chat): starting, setting dependencies,
 * messaging the lead and merging pass on them; a brief edit passes only while
 * the feature is a draft, since a started feature's brief is the lead's and
 * the human's. Creating needs no check (what it creates is its own), and
 * reading any feature of the project is not gated.
 */
export type EpicAction = 'start' | 'brief' | 'dependencies' | 'message' | 'merge'

/** The feature's link, as the orchestrator hands it to the human. */
function featureLink(feature: Pick<Feature, 'slug' | 'projectId' | 'title'>): string {
  return `[${feature.title}](/p/${encodeURIComponent(feature.projectId)}/f/${encodeURIComponent(feature.slug)}/chat)`
}

/** May the orchestrator chat `chatId` do `action` on `feature`? A refusal says what to do instead. */
export function mayAct(
  ctx: AppCtx,
  chatId: string,
  feature: Feature,
  action: EpicAction,
): { ok: true } | { ok: false; reason: string } {
  if (feature.chatId !== chatId) {
    const whose = feature.chatId ? `the epic "${chatNameOf(ctx, feature.chatId)}"` : 'no epic (the human made it with New feature)'
    return {
      ok: false,
      reason:
        `\`${feature.slug}\` is not one of this epic's features (it belongs to ${whose}), so nothing was done. ` +
        `Link the human to its chat: ${featureLink(feature)}.`,
    }
  }
  if (action === 'brief' && feature.status !== 'draft') {
    return {
      ok: false,
      reason:
        `\`${feature.slug}\` has started, so its brief belongs to its lead and the human, and nothing was done. ` +
        `Tell its lead with send_to_feature, or link the human to its chat: ${featureLink(feature)}.`,
    }
  }
  return { ok: true }
}

/** {@link mayAct}, throwing its refusal; the feature when it passes. */
export function requireMayAct(ctx: AppCtx, chatId: string, feature: Feature, action: EpicAction): Feature {
  const verdict = mayAct(ctx, chatId, feature, action)
  if (!verdict.ok) throw new GateError(verdict.reason)
  return feature
}
