import type { Feature } from '@runcastle/core'
import { and, asc, eq } from 'drizzle-orm'
import { features } from '../db/schema'
import type { AppCtx } from '../db/types'
import { chatNameOf } from '../threads/chat-name'

/**
 * The epic's other features in progress when one of its features merges
 * (`the-epic-hears-when-its-features-merge` decisions 2, 5): what the merge news
 * and `merge_feature`'s answer list. Every merge wakes the epic now
 * (`autopilot-retires` decision 2), so this no longer decides that.
 */

/** A feature row as the sibling list reads it. */
export type SiblingRow = {
  id: string
  slug: string
  title: string
  status: Feature['status']
  chatId?: string | null
}

/**
 * The epic's other features (same `chatId`, not the merged one) that are
 * started. Drafts, shipped and archived features do not count. Pure; read it
 * after the merge has started its up-next drafts, so those count.
 */
export function inProgressSiblings<T extends SiblingRow>(
  rows: readonly T[],
  merged: { id: string; chatId?: string | null },
): T[] {
  if (!merged.chatId) return []
  return rows.filter((r) => r.id !== merged.id && r.chatId === merged.chatId && r.status === 'active')
}

/** One in-progress sibling as the epic reads it. */
export interface EpicSibling {
  slug: string
  title: string
}

/**
 * The `mergedBy` of a merge runcastle made by itself: a feature at "Involve me
 * in: Nothing" whose lead declared it ready (how-involved-am-i).
 */
export const MERGED_BY_RUNCASTLE = 'runcastle'

/** Who merged, said to the epic `epicId`: the human, runcastle, this chat, or another chat by name. */
export function ownerWords(ctx: AppCtx, threadId: string | null, epicId: string): string {
  if (!threadId) return 'the human'
  if (threadId === MERGED_BY_RUNCASTLE) return 'runcastle by itself ("Involve me in" is Nothing)'
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
    })
    .from(features)
    .where(and(eq(features.projectId, merged.projectId), eq(features.chatId, epicId)))
    .orderBy(asc(features.createdAt))
    .all()
  return inProgressSiblings(rows, merged).map((r) => ({ slug: r.slug, title: r.title }))
}
