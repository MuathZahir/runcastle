import type { Feature } from '@runcastle/core'
import { and, asc, eq } from 'drizzle-orm'
import { features } from '../db/schema'
import type { AppCtx } from '../db/types'
import { chatNameOf } from '../threads/chat-name'
import { epicOnAutopilot } from './autopilot'

/**
 * The epic's other features in progress when one of its features merges
 * (`the-epic-hears-when-its-features-merge` decisions 2, 5): what the merge news
 * and `merge_feature`'s answer list, and what decides whether the merge wakes
 * the epic.
 */

/** A feature row as the wake test reads it. */
export type SiblingRow = {
  id: string
  slug: string
  title: string
  status: Feature['status']
  chatId?: string | null
}

/**
 * The wake test's set: the epic's other features (same `chatId`, not the merged
 * one) that are started. Drafts, shipped and archived features do not count.
 * Pure; read it after the merge has started its up-next drafts, so those count.
 */
export function inProgressSiblings<T extends SiblingRow>(
  rows: readonly T[],
  merged: { id: string; chatId?: string | null },
): T[] {
  if (!merged.chatId) return []
  return rows.filter((r) => r.id !== merged.id && r.chatId === merged.chatId && r.status === 'active')
}

/**
 * Whether the merge news wakes the epic (decisions 2, 6, 9): only while a sibling
 * is in progress, and never when the epic merged the feature itself (it checks
 * fit in the turn that called `merge_feature`).
 */
export function mergeWakesEpic(input: { siblings: number; epicId: string; mergedBy: string | null }): boolean {
  return input.siblings > 0 && input.mergedBy !== input.epicId
}

/** One in-progress sibling as the epic reads it: who runs it, in the epic's words. */
export interface EpicSibling {
  slug: string
  title: string
  /** `this epic, on autopilot` when it is locked to the epic; else `the human`. */
  owner: string
}

/** Who merged, said to the epic `epicId`: the human, this chat, or another chat by name. */
export function ownerWords(ctx: AppCtx, threadId: string | null, epicId: string): string {
  if (!threadId) return 'the human'
  if (threadId === epicId) return 'this chat'
  return `the chat "${chatNameOf(ctx, threadId)}"`
}

/** The merged feature's epic's in-progress siblings, read now. Empty for a feature with no epic. */
export function epicSiblingsInProgress(ctx: AppCtx, merged: Pick<Feature, 'id' | 'chatId' | 'projectId'>): EpicSibling[] {
  const epicId = merged.chatId
  if (!epicId) return []
  const rows = ctx.db
    .select({
      id: features.id,
      slug: features.slug,
      title: features.title,
      status: features.status,
      chatId: features.chatId,
      inRun: features.inRun,
    })
    .from(features)
    .where(and(eq(features.projectId, merged.projectId), eq(features.chatId, epicId)))
    .orderBy(asc(features.createdAt))
    .all()
  const on = epicOnAutopilot(ctx, epicId)
  return inProgressSiblings(rows, merged).map((r) => ({
    slug: r.slug,
    title: r.title,
    owner: on && r.inRun ? 'this epic, on autopilot' : 'the human',
  }))
}
